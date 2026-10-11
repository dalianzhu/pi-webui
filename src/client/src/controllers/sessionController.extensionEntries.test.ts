import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";

const extensionEntry = (entryId: string, revision: number) => ({
  customType: "task-plan",
  data: { revision },
  entryId,
  timestamp: "2026-01-01T00:00:00.000Z",
});

function createController(entries: ReturnType<typeof extensionEntry>[], socket = new EmitSocket()) {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
  const extensionEntries = vi.fn(() => Promise.resolve({ entries }));
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    {
      socket,
      api: {
        ...defaultApi,
        messages: vi.fn(() => Promise.resolve(emptyPage)),
        status: vi.fn(() => Promise.resolve(status(oldSession.id))),
        streamSnapshot: vi.fn(() => Promise.resolve({ seq: 0, partial: null })),
        extensionEntries,
      },
    },
  );
  return { controller, socket, extensionEntries, state: () => state };
}

describe("SessionController extension entries", () => {
  it("seeds the selected session's extension entries from the join read", async () => {
    const harness = createController([extensionEntry("e1", 1)]);

    await harness.controller.selectSession(oldSession, { updateUrl: false });

    expect(harness.extensionEntries).toHaveBeenCalledWith(oldSession, "local", expect.anything());
    expect(harness.state().sessionExtensionEntries).toEqual([extensionEntry("e1", 1)]);
  });

  it("appends an entry reported by a live event", async () => {
    const harness = createController([extensionEntry("e1", 1)]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.socket.emit({ type: "session.extensionEntry", entry: extensionEntry("e2", 2) });

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);
  });

  it("replaces an entry the join read already contained instead of duplicating it", async () => {
    const harness = createController([extensionEntry("e1", 1)]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.socket.emit({ type: "session.extensionEntry", entry: extensionEntry("e1", 2) });

    expect(harness.state().sessionExtensionEntries).toEqual([extensionEntry("e1", 2)]);
  });

  it("keeps extension entries out of the transcript", async () => {
    const harness = createController([extensionEntry("e1", 1)]);

    await harness.controller.selectSession(oldSession, { updateUrl: false });

    expect(harness.state().messages).toEqual(emptyPage.messages);
  });

  it("treats an unavailable extension-entries route as no extension state", async () => {
    const harness = createController([]);
    harness.extensionEntries.mockImplementationOnce(() => Promise.reject(new Error("Not Found")));

    await harness.controller.selectSession(oldSession, { updateUrl: false });

    expect(harness.state().sessionExtensionEntries).toEqual([]);
    expect(harness.state().selectedSession).toEqual(oldSession);
  });

  it("clears extension entries when the session is deselected", async () => {
    const harness = createController([extensionEntry("e1", 1)]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.controller.deselectSession();

    expect(harness.state().sessionExtensionEntries).toEqual([]);
  });
});
