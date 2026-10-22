// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { saveAttachmentDelivery } from "../attachmentPreferences";
import { initialAppState, type AppState } from "../appState";
import { chatMessageEditDraft } from "./ChatView";
import { PiWebUiApp } from "./PiWebUiApp";
import { PromptEditor } from "./PromptEditor";
import { PromptAttachmentDraftStore } from "../promptAttachmentDrafts";
import { SessionController, type SessionControllerDependencies } from "../controllers/sessionController";
import { defaultApi, FakeSocket, MemoryStorage, oldSession, status, workspace } from "../controllers/sessionController.testSupport";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const restored = {
  kind: "image" as const,
  name: "message.png",
  mimeType: "image/png",
  data: PNG,
  size: 69,
};
type ReplacePromptEditorDraft = NonNullable<SessionControllerDependencies["replacePromptEditorDraft"]>;
const wireAttachment = { kind: restored.kind, name: restored.name, mimeType: restored.mimeType, data: restored.data };

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(store = new PromptAttachmentDraftStore()): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.attachmentDrafts = store;
  editor.machineId = "local";
  editor.sessionId = oldSession.id;
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function root(editor: PromptEditor): ShadowRoot {
  if (editor.shadowRoot === null) throw new Error("No editor DOM");
  return editor.shadowRoot;
}

function selector(editor: PromptEditor): HTMLSelectElement {
  const element = root(editor).querySelector("select");
  if (!(element instanceof HTMLSelectElement)) throw new Error("No delivery selector");
  return element;
}

function send(editor: PromptEditor): void {
  const element = root(editor).querySelector(".send-button");
  if (!(element instanceof HTMLButtonElement)) throw new Error("No send button");
  element.click();
}

function routing(editor: PromptEditor, cancelled = false, sendApi: Partial<typeof defaultApi> = {}): SessionController {
  let state: AppState = {
    ...initialAppState(),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession],
    treeDialog: { nodes: [], activeLeafId: "leaf", activePathIds: ["leaf"] },
  };
  const app = new PiWebUiApp();
  Reflect.set(app, "state", state);
  Object.defineProperty(app, "updateComplete", { value: Promise.resolve(true), configurable: true });
  Object.defineProperty(app, "promptEditor", { value: editor, configurable: true });
  const original: unknown = Reflect.get(app, "sessions");
  if (typeof original !== "object" || original === null) throw new Error("No app session controller");
  const replacement: unknown = Reflect.get(original, "replacePromptEditorDraft");
  if (!isReplacePromptEditorDraft(replacement)) throw new Error("No app restore callback");

  const dependencies: SessionControllerDependencies = {
    api: {
      ...defaultApi,
      editFromHere: () => Promise.resolve(cancelled ? { cancelled: true, aborted: true } : { cancelled: false }),
      navigateTree: () => Promise.resolve(cancelled ? { cancelled: true, aborted: true } : { cancelled: false, editorText: "tree text" }),
      messages: () => Promise.resolve({ messages: [], start: 0, total: 0 }),
      status: () => Promise.resolve(status(oldSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
      ...sendApi,
    },
    socket: new FakeSocket(),
    replacePromptEditorDraft: replacement,
  };
  return new SessionController(
    () => state,
    patch => { state = { ...state, ...patch }; Reflect.set(app, "state", state); },
    () => undefined,
    undefined,
    dependencies,
  );
}

function isReplacePromptEditorDraft(value: unknown): value is ReplacePromptEditorDraft {
  return typeof value === "function";
}

describe("Edit from here attachment restore at the real composer boundary", () => {
  it("passes rich restore data through controller and app, renders and stores the chip, and sends it inline", async () => {
    saveAttachmentDelivery("folder");
    const store = new PromptAttachmentDraftStore();
    const editor = await mount(store);
    const prompt = vi.fn<typeof defaultApi.prompt>().mockResolvedValue({ accepted: true });
    const controller = routing(editor, false, { prompt });
    const applied = vi.spyOn(editor, "replaceDraft");
    let delivered: Promise<boolean> | undefined;
    const sent = vi.fn<NonNullable<PromptEditor["onSend"]>>((...args) => {
      delivered = controller.send(...args);
      return delivered.then(() => undefined);
    });
    editor.onSend = sent;

    await controller.editFromHere("parent", chatMessageEditDraft({
      role: "user",
      parts: [
        { type: "text", text: "revise with pixels" },
        { type: "image", mimeType: "image/png", data: PNG },
      ],
    }));
    await editor.updateComplete;

    expect(applied).toHaveBeenCalledOnce();
    expect(editor.view?.state.doc.toString()).toBe("revise with pixels");
    expect(root(editor).querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(root(editor).querySelector(".attachment-chip")?.getAttribute("title")).toContain("restored from this message; may be a resized copy");
    expect(store.read(`local:${oldSession.id}`).attachments).toHaveLength(1);
    expect(selector(editor).value).toBe("inline");

    send(editor);
    expect(sent).toHaveBeenCalledExactlyOnceWith("revise with pixels", undefined, [wireAttachment], "inline");
    expect(await delivered).toBe(true);
    expect(prompt).toHaveBeenCalledExactlyOnceWith(oldSession, "revise with pixels", undefined, "local", [wireAttachment]);
    controller.dispose();
  });

  it("keeps the stored chip id and folder choice across remount", async () => {
    const store = new PromptAttachmentDraftStore();
    const first = await mount(store);
    first.replaceDraft({ text: "first", restored: [restored] });
    await first.updateComplete;
    const select = selector(first);
    select.value = "folder";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await first.updateComplete;
    const before = store.read(`local:${oldSession.id}`);
    first.remove();

    const second = await mount(store);
    second.replaceDraft({ text: "second", restored: [restored] });
    await second.updateComplete;

    expect(store.read(`local:${oldSession.id}`).attachments.map(item => item.id)).toEqual(before.attachments.map(item => item.id));
    expect(selector(second).value).toBe("folder");
    const sent = vi.fn<NonNullable<PromptEditor["onSend"]>>();
    second.onSend = sent;
    send(second);
    expect(sent).toHaveBeenCalledWith("second", undefined, [wireAttachment], "folder");
  });

  it("keeps the error beside a zero-chip notice and exposes the live-region contract", async () => {
    const store = new PromptAttachmentDraftStore();
    store.write(`local:${oldSession.id}`, { attachments: [], error: "read failed" });
    const editor = await mount(store);
    editor.replaceDraft({ text: "partial", unrestorableImageCount: 1 });
    await editor.updateComplete;

    const notice = root(editor).querySelector(".attachment-notice");
    expect(notice?.textContent).toBe("1 image from this message could not be restored.");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(root(editor).querySelector(".attachment-error")?.textContent).toBe("read failed");
    expect(root(editor).querySelectorAll(".attachment-chip")).toHaveLength(0);
  });

  it("clears a stale notice from storage after a complete rich edit with zero images", async () => {
    const store = new PromptAttachmentDraftStore();
    const editor = await mount(store);
    editor.replaceDraft({ text: "partial", unrestorableImageCount: 1 });
    await editor.updateComplete;
    editor.replaceDraft({ text: "complete", restored: [], unrestorableImageCount: 0 });
    await editor.updateComplete;

    expect(root(editor).querySelector(".attachment-notice")).toBeNull();
    expect(store.read(`local:${oldSession.id}`).notice).toBeUndefined();
  });

  it("applies /tree once through one text write while preserving attachment state", async () => {
    const store = new PromptAttachmentDraftStore();
    store.write(`local:${oldSession.id}`, { attachments: [{ id: "existing", ...restored, restored: true }], notice: "prior notice", deliveryOverride: "folder" });
    const editor = await mount(store);
    const before = store.read(`local:${oldSession.id}`);
    const controller = routing(editor);
    const text = vi.spyOn(editor, "replaceText");
    const rich = vi.spyOn(editor, "replaceDraft");
    let documentWrites = 0;
    const view = editor.view;
    if (view === undefined) throw new Error("No mounted editor view");
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(update => {
      documentWrites += update.transactions.filter(transaction => transaction.docChanged || transaction.selection !== undefined).length;
    })) });

    await controller.navigateTree("root", { mode: "none" });
    await editor.updateComplete;

    expect(editor.view?.state.doc.toString()).toBe("tree text");
    expect(store.read(`local:${oldSession.id}`)).toEqual(before);
    expect(root(editor).querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(documentWrites).toBe(1);
    expect(text).toHaveBeenCalledExactlyOnceWith("tree text");
    expect(rich).not.toHaveBeenCalled();
    controller.dispose();
  });
});
