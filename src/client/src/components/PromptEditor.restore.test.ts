import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAttachmentDelivery } from "../attachmentPreferences";
import type { ChatRestoredAttachment } from "./ChatView";
import { PromptEditor } from "./PromptEditor";
import { templateText } from "../templateInspection.testSupport";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
});

type ReplaceDraft = (this: PromptEditor, draft: {
  text: string;
  restored?: readonly ChatRestoredAttachment[];
  unrestorableImageCount?: number;
}) => void;

type SendPrompt = (this: PromptEditor, streamingBehavior?: "steer" | "followUp") => void;
type ChangeDelivery = (this: PromptEditor, event: Event) => void;

function restoredAttachment(name = "message.png"): ChatRestoredAttachment {
  return { kind: "image", name, mimeType: "image/png", data: PNG, size: 69 };
}

function replaceDraft(editor: PromptEditor, draft: Parameters<ReplaceDraft>[0]): void {
  const method: unknown = Reflect.get(editor, "replaceDraft");
  if (!isReplaceDraft(method)) throw new Error("PromptEditor.replaceDraft is not callable");
  method.call(editor, draft);
}

function send(editor: PromptEditor): void {
  const method: unknown = Reflect.get(editor, "send");
  if (!isSendPrompt(method)) throw new Error("PromptEditor.send is not callable");
  method.call(editor);
}

describe("PromptEditor attachment restore", () => {
  it("restores images into the scoped draft and sends them inline despite a folder preference", () => {
    saveAttachmentDelivery("folder");
    const editor = new PromptEditor();
    const store = editor.attachmentDrafts;
    editor.machineId = "local";
    editor.sessionId = "session-1";
    const onSend = vi.fn<NonNullable<PromptEditor["onSend"]>>();
    editor.onSend = onSend;

    replaceDraft(editor, { text: "revise this", restored: [restoredAttachment()] });

    expect(store.read("local:session-1").attachments).toEqual([{
      id: "attachment-1",
      ...restoredAttachment(),
      restored: true,
    }]);
    send(editor);
    expect(onSend).toHaveBeenCalledExactlyOnceWith("revise this", undefined, [{
      kind: "image",
      name: "message.png",
      mimeType: "image/png",
      data: PNG,
    }], "inline");
  });

  it("keeps a folder delivery choice across repeated restore and renders provenance", () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-2";
    replaceDraft(editor, { text: "first", restored: [restoredAttachment()] });

    const hadSelectElement = Reflect.has(globalThis, "HTMLSelectElement");
    const previousSelect: unknown = Reflect.get(globalThis, "HTMLSelectElement");
    class TestSelect extends EventTarget { value = "folder"; }
    Reflect.set(globalThis, "HTMLSelectElement", TestSelect);
    try {
      const changeDelivery: unknown = Reflect.get(editor, "changeDelivery");
      if (!isChangeDelivery(changeDelivery)) throw new Error("PromptEditor.changeDelivery is not callable");
      const event = new Event("change");
      Object.defineProperty(event, "target", { value: new TestSelect() });
      changeDelivery.call(editor, event);
    } finally {
      if (!hadSelectElement) Reflect.deleteProperty(globalThis, "HTMLSelectElement");
      else Reflect.set(globalThis, "HTMLSelectElement", previousSelect);
    }

    replaceDraft(editor, { text: "second", restored: [restoredAttachment()] });

    expect(Reflect.get(editor, "attachmentDeliveryOverride")).toBe("folder");
    expect(templateText(editor.render())).toContain("restored from this message; may be a resized copy");
    const sendCallback = vi.fn<NonNullable<PromptEditor["onSend"]>>();
    editor.onSend = sendCallback;
    send(editor);
    expect(sendCallback).toHaveBeenCalledWith("second", undefined, expect.any(Array), "folder");
  });

  it("renders an incomplete-restore notice even when no chip could be restored", () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-3";

    replaceDraft(editor, { text: "keep the text", unrestorableImageCount: 1 });

    expect(templateText(editor.render())).toContain("1 image from this message could not be restored.");
    expect(Reflect.get(editor, "attachments")).toEqual([]);
  });

  it("caps restored attachments and announces the omitted count", () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-4";
    const existing = Array.from({ length: 16 }, (_, index) => ({
      id: `existing-${String(index)}`,
      kind: "file" as const,
      name: `file-${String(index)}.bin`,
      mimeType: "application/octet-stream",
      data: `data-${String(index)}`,
      size: 1,
    }));
    Reflect.set(editor, "attachments", existing);

    replaceDraft(editor, { text: "full", restored: [restoredAttachment()] });

    expect(attachmentCount(editor)).toBe(16);
    expect(templateText(editor.render())).toContain("Only 16 attachments can be sent, so 1 was not added.");
  });

  it("clears and persists a stale notice for a complete rich edit with no images", () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-complete";

    replaceDraft(editor, { text: "partial", unrestorableImageCount: 1 });
    replaceDraft(editor, { text: "complete", restored: [], unrestorableImageCount: 0 });

    expect(Reflect.get(editor, "attachmentNotice")).toBeUndefined();
    expect(editor.attachmentDrafts.read("local:session-complete")).toEqual({ attachments: [] });
  });

  it("does not alter attachment state for a text-only replacement", () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-5";
    Reflect.set(editor, "attachments", [{ id: "existing", ...restoredAttachment(), restored: true }]);

    replaceDraft(editor, { text: "text only", restored: [], unrestorableImageCount: 0 });

    expect(attachmentCount(editor)).toBe(1);
    expect(Reflect.get(editor, "attachmentNotice")).toBeUndefined();
  });
});

function isReplaceDraft(value: unknown): value is ReplaceDraft {
  return typeof value === "function";
}

function isSendPrompt(value: unknown): value is SendPrompt {
  return typeof value === "function";
}

function isChangeDelivery(value: unknown): value is ChangeDelivery {
  return typeof value === "function";
}

function attachmentCount(editor: PromptEditor): number {
  const attachments: unknown = Reflect.get(editor, "attachments");
  if (!Array.isArray(attachments)) throw new Error("PromptEditor attachments were unavailable");
  return attachments.length;
}
