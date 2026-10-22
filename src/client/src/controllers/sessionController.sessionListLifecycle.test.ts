import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { isCachedNewSessionInfo, loadCachedNewSessions, markCachedNewSessionInfo, rememberCachedNewSession } from "../cachedNewSessions";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, MemoryStorage, oldSession, replacementSession, runPendingAnimationFrames, sessionLookupId, status, workspace, type AppState, type SessionInfo, type SessionStatus } from "./sessionController.testSupport";

const controllers: SessionController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });

function harness(session: SessionInfo, overrides: Partial<typeof defaultApi> = {}) {
  const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [session], projectSessions: [session] };
  const socket = new EmitSocket();
  const messages = vi.fn(() => Promise.resolve(emptyPage));
  const controller = new SessionController(() => state, (patch) => { Object.assign(state, patch); }, () => undefined, undefined, {
    socket,
    api: {
      ...defaultApi,
      messages,
      status: (ref) => Promise.resolve({ ...status(sessionLookupId(ref)), ...(session.persisted === undefined ? {} : { persisted: session.persisted }) }),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      extensionEntries: () => Promise.resolve({ entries: [], seq: 0, readRevision: 0 }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
      ...overrides,
    },
  });
  controllers.push(controller);
  return { state, socket, messages, controller };
}

function cachedHarness(overrides: Partial<typeof defaultApi> = {}) {
  vi.stubGlobal("localStorage", new MemoryStorage());
  const transient = { ...oldSession, persisted: false };
  rememberCachedNewSession(transient);
  const cached = markCachedNewSessionInfo(transient);
  const h = harness(cached, overrides);
  h.state.selectedSession = cached;
  return h;
}

describe("authoritative archive-state transitions", () => {
  it("joins the live stream after another client restores the selected history-only session", async () => {
    const live = { ...oldSession, persisted: true };
    const archived = { ...live, archived: true, archivedAt: "now" };
    const h = harness(archived, { prompt: () => Promise.resolve({ accepted: true }) });
    await h.controller.selectSession(archived);
    expect(h.socket.connectedSessionIds).toEqual([]);

    await h.controller.applyRefreshedSessionLists([{ cwd: live.cwd, sessions: [live] }], "local");

    expect(h.socket.connectedSessionIds).toEqual([live.id]);
    expect(h.state.selectedSession).toEqual(live);
    expect(h.state.sessions).toEqual([live]);
    expect(h.state.projectSessions).toEqual([live]);
    expect(await h.controller.send("continue after restore")).toBe(true);
    h.socket.emit({ type: "assistant.delta", text: "visible reply", seq: 1 });
    h.socket.emit({ type: "tool.start", toolName: "bash", toolCallId: "restored-tool", summary: "visible tool", seq: 2 });
    runPendingAnimationFrames();
    expect(h.state.messages).toEqual(expect.arrayContaining([
      { role: "assistant", parts: [{ type: "text", text: "visible reply" }] },
      expect.objectContaining({ role: "tool" }),
    ]));
  });

  it("closes the live stream when another client archives the selection, without reloading unchanged archive metadata", async () => {
    const live = { ...oldSession, persisted: true };
    const archived = { ...live, archived: true, archivedAt: "now" };
    const h = harness(live);
    await h.controller.selectSession(live);
    await h.controller.applyRefreshedSessionLists([{ cwd: live.cwd, sessions: [archived] }], "local");
    const historyReads = h.messages.mock.calls.length;
    h.socket.emit({ type: "assistant.delta", text: "stale stream", seq: 1 });
    runPendingAnimationFrames();
    expect(h.state.messages).toEqual([]);
    expect(h.state.status).toBeUndefined();
    await h.controller.applyRefreshedSessionLists([{ cwd: live.cwd, sessions: [{ ...archived, name: "renamed archive" }] }], "local");
    expect(h.messages).toHaveBeenCalledTimes(historyReads);
    expect(h.socket.connectedSessionIds).toEqual([live.id]);
    expect(h.state.selectedSession?.name).toBe("renamed archive");
  });

  it("does not let a restored-session join overwrite a newer selection", async () => {
    const live = { ...oldSession, persisted: true };
    const archived = { ...live, archived: true, archivedAt: "now" };
    const delayed = deferred<SessionStatus>();
    const h = harness(archived, { status: (ref) => sessionLookupId(ref) === live.id ? delayed.promise : Promise.resolve(status(sessionLookupId(ref))) });
    await h.controller.selectSession(archived);
    const restoring = h.controller.applyRefreshedSessionLists([{ cwd: live.cwd, sessions: [live] }], "local");
    await h.controller.selectSession(replacementSession);
    delayed.resolve({ ...status(live.id), persisted: true });
    await restoring;
    expect(h.state.selectedSession?.id).toBe(replacementSession.id);
    h.socket.emit({ type: "assistant.delta", text: "new selection reply", seq: 1 });
    runPendingAnimationFrames();
    expect(h.state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "new selection reply" }] }]);
  });
});

describe("write acknowledgements and cached-new persistence", () => {
  it.each(["prompt", "shell"] as const)("keeps recovery after an accepted %s without positive persistence evidence", async (kind) => {
    const h = cachedHarness({
      prompt: () => Promise.resolve({ accepted: true }),
      shell: () => Promise.resolve({ accepted: true }),
      status: () => Promise.resolve({ ...status(oldSession.id), persisted: false }),
    });
    expect(await h.controller.send(kind === "shell" ? "!!true" : "hello")).toBe(true);
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([oldSession.id]);
    expect(isCachedNewSessionInfo(h.state.selectedSession)).toBe(true);
    expect(h.state.error).toBe("");
    await h.controller.applyRefreshedSessionLists([{ cwd: oldSession.cwd, sessions: [] }], "local");
    expect(h.state.sessions.map((session) => session.id)).toEqual([oldSession.id]);
  });

  it.each(["missing", "error", "wrong identity"] as const)("keeps recovery and successful send semantics when the probe returns %s", async (result) => {
    const h = cachedHarness({
      shell: () => Promise.resolve({ accepted: true }),
      status: () => result === "error" ? Promise.reject(new Error("temporarily unavailable")) : Promise.resolve({ ...status(result === "wrong identity" ? replacementSession.id : oldSession.id), ...(result === "wrong identity" ? { persisted: true } : {}) }),
    });
    expect(await h.controller.send("!!true")).toBe(true);
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([oldSession.id]);
    expect(h.state.error).toBe("");
  });

  it("applies only positive persistence from a delayed probe, retaining newer message counts and preventing stale-status resurrection", async () => {
    const probe = deferred<SessionStatus>();
    const h = cachedHarness({ shell: () => Promise.resolve({ accepted: true }), status: () => probe.promise });
    const sending = h.controller.send("!!true");
    h.controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), persisted: false, messageCount: 3 } });
    h.controller.flushPendingUpdates();
    probe.resolve({ ...status(oldSession.id), persisted: true, messageCount: 0 });
    expect(await sending).toBe(true);
    expect(loadCachedNewSessions()).toEqual([]);
    expect(h.state.sessions[0]).toMatchObject({ persisted: true, messageCount: 3 });
    expect(h.state.projectSessions[0]).toMatchObject({ persisted: true, messageCount: 3 });
    expect(isCachedNewSessionInfo(h.state.selectedSession)).toBe(false);
    h.controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), persisted: false, messageCount: 3 } });
    h.controller.flushPendingUpdates();
    expect(h.state.selectedSession?.persisted).toBe(true);
  });

  it("retires only the originating machine's cache after navigation while leaving the new machine's row untouched", async () => {
    const probe = deferred<SessionStatus>();
    const h = cachedHarness({ shell: () => Promise.resolve({ accepted: true }), status: () => probe.promise });
    const sending = h.controller.send("!!true");
    await Promise.resolve();
    const remote = { id: "remote", name: "remote", kind: "remote" as const, createdAt: "now", updatedAt: "now" };
    const remoteSession = markCachedNewSessionInfo({ ...oldSession, persisted: false }, remote.id);
    rememberCachedNewSession(remoteSession, remote.id);
    Object.assign(h.state, { selectedMachine: remote, sessions: [remoteSession], projectSessions: [remoteSession], selectedSession: remoteSession });
    probe.resolve({ ...status(oldSession.id), persisted: true });
    expect(await sending).toBe(true);
    expect(loadCachedNewSessions().filter((session) => session.machineId === "local")).toEqual([]);
    expect(loadCachedNewSessions().filter((session) => session.machineId === remote.id).map((session) => session.id)).toEqual([oldSession.id]);
    expect(h.state.selectedSession).toBe(remoteSession);
    expect(h.state.sessions).toEqual([remoteSession]);
  });
});
