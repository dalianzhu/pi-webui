import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SESSION_EXTENSION_ENTRY_LIMIT, type SessionInfo, type SessionUiEvent } from "../../../shared/apiTypes";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";

const extensionEntry = (entryId: string, revision: number) => ({
  customType: "task-plan",
  data: { revision },
  entryId,
  timestamp: "2026-01-01T00:00:00.000Z",
});

const entryEvent = (entryId: string, revision: number, seq: number): SessionUiEvent => ({
  type: "session.extensionEntry",
  entry: extensionEntry(entryId, revision),
  seq,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

interface HarnessOptions {
  entries?: ReturnType<typeof extensionEntry>[];
  /** Watermark the extension read reports. `undefined` models an older daemon with no route. */
  seq?: number;
  messages?: Promise<typeof emptyPage>;
}

function createController(options: HarnessOptions = {}) {
  const socket = new EmitSocket();
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
  const extensionEntries = vi.fn(() => Promise.resolve({ entries: options.entries ?? [], seq: options.seq ?? 0 }));
  const messages = vi.fn(() => options.messages ?? Promise.resolve(emptyPage));
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    {
      socket,
      api: {
        ...defaultApi,
        messages,
        status: vi.fn(() => Promise.resolve(status(oldSession.id))),
        streamSnapshot: vi.fn(() => Promise.resolve({ seq: 0, partial: null })),
        extensionEntries,
      },
    },
  );
  return { controller, socket, extensionEntries, messages, state: () => state };
}

describe("SessionController extension entries", () => {
  it("seeds the selected session's extension entries from the join read", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });

    await harness.controller.selectSession(oldSession, { updateUrl: false });

    expect(harness.extensionEntries).toHaveBeenCalledWith(oldSession, "local", expect.anything());
    expect(harness.state().sessionExtensionEntries).toEqual([extensionEntry("e1", 1)]);
  });

  it("appends an entry reported by a live event", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.socket.emit(entryEvent("e2", 2, 2));

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);
  });

  it("replaces an entry the join read already contained instead of duplicating it", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.socket.emit(entryEvent("e1", 2, 2));

    expect(harness.state().sessionExtensionEntries).toEqual([extensionEntry("e1", 2)]);
  });

  // The transcript watermark says nothing about extension entries: they come from their own read,
  // so an entry event the transcript snapshot covers may still be missing from the entries.
  it("applies a buffered entry event the transcript snapshot covers", async () => {
    const messages = deferred<typeof emptyPage>();
    const harness = createController({
      entries: [extensionEntry("e1", 1)],
      seq: 5,
      messages: messages.promise,
    });

    const selecting = harness.controller.selectSession(oldSession, { updateUrl: false });
    // The transcript snapshot lands at seq 7, so the old shared watermark would have dropped this
    // event even though the extension read (seq 5) never contained it.
    harness.socket.emit(entryEvent("e2", 2, 7));
    messages.resolve(emptyPage);
    await selecting;

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);
  });

  it("does not replay an entry event the extension read already covers", async () => {
    const messages = deferred<typeof emptyPage>();
    const harness = createController({
      entries: [extensionEntry("e2", 2), extensionEntry("e3", 3)],
      seq: 6,
      messages: messages.promise,
    });

    const selecting = harness.controller.selectSession(oldSession, { updateUrl: false });
    // Published at or before the read, so the read is authoritative and replaying it would both
    // duplicate work and push the window's oldest entry out for an entry the window already made
    // a decision about.
    harness.socket.emit(entryEvent("e1", 1, 6));
    messages.resolve(emptyPage);
    await selecting;

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e2", "e3"]);
  });

  // A snapshot is taken before the events that arrived while it was in flight, so applying them
  // immediately and then landing the snapshot would roll them back.
  it("does not roll back an entry event that arrives during a refresh", async () => {
    const messages = deferred<typeof emptyPage>();
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);

    harness.messages.mockImplementationOnce(() => messages.promise);
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1)], seq: 5 }),
    );
    const refreshing = harness.controller.refreshSelectedSession(oldSession.id);
    harness.socket.emit(entryEvent("e2", 2, 7));
    messages.resolve(emptyPage);
    await refreshing;

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);
  });

  // The hub does not replay, and the join read can finish before the subscription is live, so an
  // entry written in that window is only recovered by a read once the subscription exists.
  it("re-reads extension entries when the subscription becomes live", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);

    // Persisted after the join read, before the subscription: no live event is delivered for it.
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 5 }),
    );
    harness.socket.open();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);
  });

  it("keeps extension entries out of the transcript", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });

    await harness.controller.selectSession(oldSession, { updateUrl: false });

    expect(harness.state().messages).toEqual(emptyPage.messages);
  });

  it("treats an unavailable extension-entries route as no extension state", async () => {
    const harness = createController({ entries: [] });
    harness.extensionEntries.mockImplementationOnce(() => Promise.reject(new Error("Not Found")));

    await harness.controller.selectSession(oldSession, { updateUrl: false });

    expect(harness.state().sessionExtensionEntries).toEqual([]);
    expect(harness.state().selectedSession).toEqual(oldSession);
  });

  it("clears extension entries as soon as a selection starts", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries).toHaveLength(1);

    const messages = deferred<typeof emptyPage>();
    harness.messages.mockImplementationOnce(() => messages.promise);
    const selecting = harness.controller.selectSession({ ...oldSession, id: "session-next" }, { updateUrl: false });

    // Asserted before the load settles: the previous session's entries must not stay on screen
    // while the new session loads.
    expect(harness.state().sessionExtensionEntries).toEqual([]);
    messages.resolve(emptyPage);
    await selecting;
  });

  it("clears extension entries when the selected session changes to an archived session", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries).toHaveLength(1);

    // An archived selection loads history only, so nothing would otherwise replace the entries
    // that belong to the session the user just left.
    const archived = { ...oldSession, id: "session-archived", archived: true };
    await harness.controller.selectSession(archived, { updateUrl: false });

    expect(harness.state().sessionExtensionEntries).toEqual([]);
  });

  it("clears extension entries when the selected session becomes a pending start", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });
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
    const harness = createController({ entries: [], seq: 0 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    for (let index = 0; index < SESSION_EXTENSION_ENTRY_LIMIT + 5; index += 1) {
      harness.socket.emit(entryEvent(`e${String(index)}`, index, index + 1));
    }

    const entries = harness.state().sessionExtensionEntries;
    expect(entries).toHaveLength(SESSION_EXTENSION_ENTRY_LIMIT);
    // Oldest entries are dropped, so the window still ends at the newest entry.
    expect(entries[0]?.entryId).toBe("e5");
    expect(entries.at(-1)?.entryId).toBe(`e${String(SESSION_EXTENSION_ENTRY_LIMIT + 4)}`);
  });

  it("keeps deduplicating by entry id while applying the limit", async () => {
    const harness = createController({ entries: [], seq: 0 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    for (let index = 0; index < SESSION_EXTENSION_ENTRY_LIMIT; index += 1) {
      harness.socket.emit(entryEvent(`e${String(index)}`, index, index + 1));
    }
    // A repeat of an entry that is still inside the window updates it in place instead of
    // dropping the oldest entry to make room for a duplicate.
    harness.socket.emit(entryEvent("e10", 99, SESSION_EXTENSION_ENTRY_LIMIT + 1));

    const entries = harness.state().sessionExtensionEntries;
    expect(entries).toHaveLength(SESSION_EXTENSION_ENTRY_LIMIT);
    expect(entries.filter((entry) => entry.entryId === "e10")).toEqual([extensionEntry("e10", 99)]);
    expect(entries[0]?.entryId).toBe("e0");
  });

  it("clears extension entries when the session is deselected", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.controller.deselectSession();

    expect(harness.state().sessionExtensionEntries).toEqual([]);
  });
});
