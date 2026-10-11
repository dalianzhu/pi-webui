import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SESSION_EXTENSION_ENTRY_LIMIT, type SessionInfo } from "../../../shared/apiTypes";
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

  it("clears extension entries when the selected session changes to an archived session", async () => {
    const harness = createController([extensionEntry("e1", 1)]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries).toHaveLength(1);

    // An archived selection loads history only, so nothing would otherwise replace the entries
    // that belong to the session the user just left.
    const archived = { ...oldSession, id: "session-archived", archived: true };
    await harness.controller.selectSession(archived, { updateUrl: false });

    expect(harness.state().sessionExtensionEntries).toEqual([]);
  });

  it("clears extension entries when the selected session becomes a pending start", async () => {
    const harness = createController([extensionEntry("e1", 1)]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries).toHaveLength(1);

    const pendingStart: SessionInfo & { clientPendingStart: true; machineId: string } = {
      ...oldSession,
      id: "session-pending",
      clientPendingStart: true,
      machineId: "local",
    };
    await harness.controller.selectSession(pendingStart, { updateUrl: false });

    expect(harness.state().sessionExtensionEntries).toEqual([]);
  });

  it("holds the retention limit on live updates", async () => {
    const harness = createController([]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    for (let index = 0; index < SESSION_EXTENSION_ENTRY_LIMIT + 5; index += 1) {
      harness.socket.emit({ type: "session.extensionEntry", entry: extensionEntry(`e${String(index)}`, index) });
    }

    const entries = harness.state().sessionExtensionEntries;
    expect(entries).toHaveLength(SESSION_EXTENSION_ENTRY_LIMIT);
    // Oldest entries are dropped, so the window still ends at the newest entry.
    expect(entries[0]?.entryId).toBe("e5");
    expect(entries.at(-1)?.entryId).toBe(`e${String(SESSION_EXTENSION_ENTRY_LIMIT + 4)}`);
  });

  it("keeps deduplicating by entry id while applying the limit", async () => {
    const harness = createController([]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    for (let index = 0; index < SESSION_EXTENSION_ENTRY_LIMIT; index += 1) {
      harness.socket.emit({ type: "session.extensionEntry", entry: extensionEntry(`e${String(index)}`, index) });
    }
    // A repeat of an entry that is still inside the window updates it in place instead of
    // dropping the oldest entry to make room for a duplicate.
    harness.socket.emit({ type: "session.extensionEntry", entry: extensionEntry("e10", 99) });

    const entries = harness.state().sessionExtensionEntries;
    expect(entries).toHaveLength(SESSION_EXTENSION_ENTRY_LIMIT);
    expect(entries.filter((entry) => entry.entryId === "e10")).toEqual([extensionEntry("e10", 99)]);
    expect(entries[0]?.entryId).toBe("e0");
  });

  it("clears extension entries when the session is deselected", async () => {
    const harness = createController([extensionEntry("e1", 1)]);
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.controller.deselectSession();

    expect(harness.state().sessionExtensionEntries).toEqual([]);
  });
});
