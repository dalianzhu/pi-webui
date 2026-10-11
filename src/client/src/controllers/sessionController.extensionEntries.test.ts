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

/**
 * Let a fire-and-forget read settle: awaiting the read's own promise queues this continuation
 * after the controller's, and one microtask lets that continuation apply its state.
 */
const settle = async (read: Promise<unknown>) => {
  await read;
  await Promise.resolve();
};

/**
 * Let scheduled work run to completion without depending on wall-clock timing.
 *
 * A reconnect schedules its read through the refresh coordinator, so the read is issued a few
 * microtasks later; there is no promise to await for that path.
 */
const settleMicrotasks = async (turns = 10) => {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

interface HarnessOptions {
  entries?: ReturnType<typeof extensionEntry>[];
  /** Watermark the extension read reports. `undefined` models an older daemon with no route. */
  seq?: number;
  /** Watermark the transcript snapshot reports, which the extension cursor must not reuse. */
  transcriptSeq?: number;
  messages?: Promise<typeof emptyPage>;
}

function createController(options: HarnessOptions = {}) {
  const socket = new EmitSocket();
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
  // The server orders reads by a per-session revision, so the default mock does the same; a test
  // that cares about ordering sets it explicitly.
  let readRevision = 0;
  const extensionEntries = vi.fn(() => {
    readRevision += 1;
    return Promise.resolve({ entries: options.entries ?? [], seq: options.seq ?? 0, readRevision });
  });
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
        streamSnapshot: vi.fn(() => Promise.resolve({ seq: options.transcriptSeq ?? 0, partial: null })),
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
      // The transcript snapshot really lands at 7 here, so a shared watermark would drop the
      // event below even though the extension read (seq 5) never contained it.
      transcriptSeq: 7,
      messages: messages.promise,
    });

    const selecting = harness.controller.selectSession(oldSession, { updateUrl: false });
    // Published after the extension read, so the extension cursor (5) keeps it even though the
    // transcript watermark (7) covers it.
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
      Promise.resolve({ entries: [extensionEntry("e1", 1)], seq: 5, readRevision: 5 }),
    );
    const refreshing = harness.controller.refreshSelectedSession(oldSession.id);
    harness.socket.emit(entryEvent("e2", 2, 7));
    messages.resolve(emptyPage);
    await refreshing;

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

  // A resync snapshot can carry entries the client missed while disconnected, so it must still be
  // applied even when an entry event has moved past its cursor.
  it("applies a resync snapshot that fills a gap while keeping later entry events", async () => {
    const messages = deferred<typeof emptyPage>();
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    // e2 was written while disconnected, so only the resync read knows about it.
    harness.messages.mockImplementationOnce(() => messages.promise);
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 6, readRevision: 6 }),
    );
    const refreshing = harness.controller.refreshSelectedSession(oldSession.id);
    harness.socket.emit(entryEvent("e3", 3, 7));
    messages.resolve(emptyPage);
    await refreshing;

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2", "e3"]);
  });

  // A refresh that is still in flight queues a trailing pass, and each pass can be overtaken by a
  // newer event, so "the trailing pass will fix it" is not enough: the gap entry has to survive
  // both passes.
  it("keeps a gap entry across a refresh and its trailing pass", async () => {
    const firstMessages = deferred<typeof emptyPage>();
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    const readsAfterJoin = harness.extensionEntries.mock.calls.length;

    harness.messages.mockImplementationOnce(() => firstMessages.promise);
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 6, readRevision: 6 }),
    );
    const inFlight = harness.controller.refreshSelectedSession(oldSession.id);
    // Let the first pass start, so the next request is queued as a trailing pass instead of
    // replacing a pass that has not begun.
    await settleMicrotasks();
    expect(harness.extensionEntries.mock.calls.length).toBe(readsAfterJoin + 1);

    harness.socket.emit(entryEvent("e3", 3, 7));
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({
        entries: [extensionEntry("e1", 1), extensionEntry("e2", 2), extensionEntry("e3", 3)],
        seq: 8,
        readRevision: 8,
      }),
    );
    const trailing = harness.controller.refreshSelectedSession(oldSession.id);
    firstMessages.resolve(emptyPage);
    await inFlight;
    await trailing;

    // The trailing pass ran and consumed its own read, so this covers both passes rather than one.
    expect(harness.extensionEntries.mock.calls.length).toBe(readsAfterJoin + 2);
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2", "e3"]);
  });

  // The subscription reaching the daemon is what makes a read complete, and the browser cannot
  // observe that from its own socket alone, so the daemon reports it.
  it("re-reads extension entries once the subscription is reported live", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);

    // Written after the join read but before the daemon subscription existed, so no live event
    // was delivered for it.
    let barrierRead: Promise<{ entries: ReturnType<typeof extensionEntry>[]; seq: number; readRevision: number }> | undefined;
    harness.extensionEntries.mockImplementationOnce(() => {
      barrierRead = Promise.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 5, readRevision: 5 });
      return barrierRead;
    });
    harness.socket.emit({ type: "session.subscribed" });

    expect(barrierRead).toBeDefined();
    await settle(barrierRead ?? Promise.resolve());

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);
  });

  // Sequence numbers restart with the session daemon, so a baseline from the previous stream must
  // not keep rejecting the new stream's numbers.
  it("re-establishes the baseline after a reconnect to a restarted daemon", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 50 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);

    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 2, readRevision: 2 }),
    );
    harness.socket.reconnect();
    await settleMicrotasks();

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);

    // And a live event from the new stream, below the old baseline, still applies.
    harness.socket.emit(entryEvent("e3", 3, 3));
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2", "e3"]);
  });

  // A reconnect refreshes while the subscription barrier also reads, so the older read can land
  // last. It must fill its gaps without rolling the newer read's entries back.
  it("keeps entries from a newer read when an older read lands after it", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    // The barrier read is slower, and by the time it lands a full refresh has already reported e3.
    const barrier = deferred<{ entries: ReturnType<typeof extensionEntry>[]; seq: number; readRevision: number }>();
    harness.extensionEntries.mockImplementationOnce(() => barrier.promise);
    harness.socket.emit({ type: "session.subscribed" });

    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2), extensionEntry("e3", 3)], seq: 8, readRevision: 8 }),
    );
    await harness.controller.refreshSelectedSession(oldSession.id);

    barrier.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 6, readRevision: 6 });
    await settle(barrier.promise);

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2", "e3"]);
  });

  // The merge above is scoped to one session and one branch: a newer read is authoritative, so
  // entries that are no longer on the branch must not be kept.
  it("drops entries a newer read does not report", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.messages.mockImplementationOnce(() => Promise.resolve(emptyPage));
    harness.extensionEntries.mockImplementationOnce(() => Promise.resolve({ entries: [extensionEntry("e1", 1)], seq: 9, readRevision: 9 }));
    await harness.controller.refreshSelectedSession(oldSession.id);

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);
  });

  // A restarted daemon starts its sequence numbers again, so events journalled under the previous
  // stream must not be replayed onto the new one: the new daemon is the authority on its session.
  it("does not replay entries journalled before a daemon restart", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    // An entry the previous stream reported and the new daemon does not.
    harness.socket.emit(entryEvent("e9", 9, 50));
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e9"]);

    harness.extensionEntries.mockImplementationOnce(() => Promise.resolve({ entries: [extensionEntry("e1", 1)], seq: 2, readRevision: 2 }));
    harness.socket.reconnect();
    await settleMicrotasks();

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);
  });

  // The session branch is shared: another client or an extension can move it, so a read that a
  // newer read has already superseded may describe a branch this client has left. Its entries
  // must not come back.
  it("does not revive entries an older read reports after a newer branch read", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1", "e2"]);

    // A read of the old branch is slow and still in flight.
    const staleBranch = deferred<{ entries: ReturnType<typeof extensionEntry>[]; seq: number; readRevision: number }>();
    harness.extensionEntries.mockImplementationOnce(() => staleBranch.promise);
    harness.socket.emit({ type: "session.subscribed" });

    // The branch moves elsewhere and a newer read reports only what is on it now.
    harness.messages.mockImplementationOnce(() => Promise.resolve(emptyPage));
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1)], seq: 9, readRevision: 9 }),
    );
    await harness.controller.refreshSelectedSession(oldSession.id);
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);

    staleBranch.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 6, readRevision: 6 });
    await settle(staleBranch.promise);

    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e1"]);
  });

  // A reconnect can happen while the initial join is still running, so events buffered from the
  // previous stream must not be replayed onto the new one.
  // The event cursor orders events, not reads: a branch can move inside Pi's tree hooks without
  // publishing anything, so two reads can report the same cursor while describing different
  // branches. Only the read order can drop the superseded one.
  it("drops a superseded read that shares the event cursor", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 5 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    const ids = () => harness.state().sessionExtensionEntries.map((entry) => entry.entryId);

    // An older read of the branch that still carried e2, delayed.
    const staleBranch = deferred<{ entries: ReturnType<typeof extensionEntry>[]; seq: number; readRevision: number }>();
    harness.extensionEntries.mockImplementationOnce(() => staleBranch.promise);
    harness.socket.emit({ type: "session.subscribed" });

    // A later read of the branch where e2 is gone, reporting the same cursor.
    harness.messages.mockImplementationOnce(() => Promise.resolve(emptyPage));
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1)], seq: 5, readRevision: 3 }),
    );
    await harness.controller.refreshSelectedSession(oldSession.id);
    expect(ids()).toEqual(["e1"]);

    staleBranch.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e2", 2)], seq: 5, readRevision: 2 });
    await settle(staleBranch.promise);

    expect(ids()).toEqual(["e1"]);

    // A newer read that shares the cursor must still be applied, so equal cursors cannot simply be
    // rejected.
    harness.extensionEntries.mockImplementationOnce(() =>
      Promise.resolve({ entries: [extensionEntry("e1", 1), extensionEntry("e3", 3)], seq: 5, readRevision: 4 }),
    );
    await harness.controller.refreshSelectedSession(oldSession.id);

    expect(ids()).toEqual(["e1", "e3"]);
  });

  it("does not replay join-buffered events from the previous stream after a reconnect", async () => {
    const joinMessages = deferred<typeof emptyPage>();
    const harness = createController();
    // The join reads the old daemon's window, and the reconnect reads the new daemon's.
    harness.extensionEntries.mockImplementationOnce(() => Promise.resolve({ entries: [extensionEntry("e1", 1)], seq: 49, readRevision: 49 }));
    harness.extensionEntries.mockImplementationOnce(() => Promise.resolve({ entries: [extensionEntry("e2", 2)], seq: 2, readRevision: 2 }));
    harness.messages.mockImplementationOnce(() => joinMessages.promise);

    const selecting = harness.controller.selectSession(oldSession, { updateUrl: false });
    // Let the join's own read be issued and start waiting, so the reconnect lands mid-join.
    await settleMicrotasks();
    // Buffered by the join, not yet applied.
    harness.socket.emit(entryEvent("e1", 1, 50));

    // The reconnect's read is queued behind the join's, so the join has to settle first.
    harness.socket.reconnect();
    joinMessages.resolve(emptyPage);
    await selecting;
    await settleMicrotasks();

    // e1 belongs to the previous stream and is outside the new daemon's window, so the join drain
    // must not replay it over e2.
    expect(harness.state().sessionExtensionEntries.map((entry) => entry.entryId)).toEqual(["e2"]);
  });

  it("clears extension entries when the session is deselected", async () => {
    const harness = createController({ entries: [extensionEntry("e1", 1)], seq: 1 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });

    harness.controller.deselectSession();

    expect(harness.state().sessionExtensionEntries).toEqual([]);
  });
});
