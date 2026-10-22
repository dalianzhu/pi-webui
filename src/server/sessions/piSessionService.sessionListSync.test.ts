import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionRuntime, createAgentSessionFromServices, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SessionInfo } from "../../client/src/api";
import { initialAppState, type AppState } from "../../client/src/appState";
import { loadCachedNewSessions, markCachedNewSessionInfo, rememberCachedNewSession } from "../../client/src/cachedNewSessions";
import { SessionController } from "../../client/src/controllers/sessionController";
import { deferred, emptyPage, FakeSocket, MemoryStorage, oldSession, sessionLookupId, status } from "../../client/src/controllers/sessionController.testSupport";
import { WorkspaceController } from "../../client/src/controllers/workspaceController";
import { PiSessionService } from "./piSessionService";
import { SessionArchiveStore } from "./sessionArchiveStore";
import { CapturingSessionEventHub, fakeAgentSessionServices, fakeRuntime, runtimeCreator, testModel, testModelRuntime } from "./piSessionService.testSupport";

const fixtures: { root: string; service: PiSessionService; clients: (() => void)[] }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const fixture of fixtures.splice(0)) {
    for (const dispose of fixture.clients) dispose();
    await fixture.service.dispose();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// Real SDK storage matters here: a fresh SessionManager has a path but no file,
// whereas appendMessage really creates history. Faking list() hid both regressions.
describe("session list synchronization across the SDK persistence boundary", () => {
  it("keeps a non-creator's published memory-only start in both authoritative lists", async () => {
    const f = await fixture();
    const created = await f.service.start(f.root);
    expect(created.persisted).toBe(false);
    expect(await SessionManager.list(f.root, f.sessionsDir)).toEqual([]);
    expect(await f.service.list(f.root)).toEqual([created]);
    expect(f.hub.globalEvents).toContainEqual({ type: "sessions.changed", cwd: f.root });

    const observer = f.client();
    observer.sessions.applyGlobalEvent({ type: "session.created", session: created });
    expect(observer.state.sessions).toEqual([created]);
    vi.useFakeTimers();
    await refresh(observer.workspaces, [f.root]);
    expect(observer.state.sessions).toEqual([created]);
    expect(observer.state.projectSessions).toEqual([created]);
    expect(loadCachedNewSessions()).toEqual([]);

    // Only an emitted invalidation may trigger the observer's next read.
    const beforeStop = f.hub.globalEvents.length;
    await f.service.stop({ id: created.id, cwd: f.root });
    const invalidations = f.hub.globalEvents.slice(beforeStop).filter((event) => event.type === "sessions.changed");
    expect(invalidations).toEqual([{ type: "sessions.changed", cwd: f.root }]);
    for (const event of invalidations) await refresh(observer.workspaces, [event.cwd]);
    expect(observer.state.sessions).toEqual([]);
    expect(observer.state.projectSessions).toEqual([]);
  });

  it("invalidates removed memory-only membership even when runtime teardown fails", async () => {
    const f = await fixture();
    const created = await f.service.start(f.root);
    vi.spyOn(f.runtime, "dispose").mockRejectedValueOnce(new Error("teardown failed"));
    const beforeStop = f.hub.globalEvents.length;
    await expect(f.service.stop({ id: created.id, cwd: f.root })).rejects.toThrow("teardown failed");
    expect(f.hub.globalEvents.slice(beforeStop)).toContainEqual({ type: "sessions.changed", cwd: f.root });
    expect(await f.service.list(f.root)).toEqual([]);
  });

  it("notifies after final teardown writes so the next catalog read sees durable history", async () => {
    const f = await fixture();
    const created = await f.service.start(f.root);
    const filePresentAtInvalidation: boolean[] = [];
    const publish = f.hub.publishGlobal.bind(f.hub);
    vi.spyOn(f.hub, "publishGlobal").mockImplementation((event) => {
      publish(event);
      if (event.type === "sessions.changed") filePresentAtInvalidation.push(existsSync(created.path));
    });
    vi.spyOn(f.runtime, "dispose").mockImplementationOnce(() => {
      f.manager.appendMessage({ role: "user", content: "final durable write", timestamp: Date.now() });
      return Promise.resolve();
    });
    await f.service.stop({ id: created.id, cwd: f.root });
    expect(filePresentAtInvalidation).toEqual([true]);
    expect((await f.service.list(f.root)).map((session) => session.id)).toEqual([created.id]);
  });

  it("does not invalidate history when stopping a runtime whose file has become durable", async () => {
    const f = await fixture();
    const created = await f.service.start(f.root);
    f.manager.appendMessage({ role: "user", content: "durable history", timestamp: Date.now() });
    expect(await SessionManager.list(f.root, f.sessionsDir)).toHaveLength(1);
    // Do not read the service catalog first: its transient registry has not yet
    // observed the new file, but closing this runtime still removes no history.
    const beforeStop = f.hub.globalEvents.length;
    await f.service.stop({ id: created.id, cwd: f.root });
    expect(f.hub.globalEvents.slice(beforeStop).filter((event) => event.type === "sessions.changed")).toEqual([]);
    expect((await f.service.list(f.root)).map((session) => session.id)).toEqual([created.id]);
  });

  it.each(["!true", "!!true"])("preserves recovery when the bundled SDK accepts %s without writing a session file", async (command) => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const f = await fixture(true);
    const created = await f.service.start(f.root);
    const ended = deferred<undefined>();
    const publish = f.hub.publish.bind(f.hub);
    vi.spyOn(f.hub, "publish").mockImplementation((id, event) => {
      publish(id, event);
      if (event.type === "shell.end") ended.resolve(undefined);
    });
    const creator = f.client(undefined, { shell: async (ref, text) => { await f.service.shell(ref, text); return { accepted: true }; } });
    rememberCachedNewSession(created);
    const cached = markCachedNewSessionInfo(created);
    Object.assign(creator.state, { sessions: [cached], projectSessions: [cached], selectedSession: cached });
    expect(await creator.sessions.send(command)).toBe(true);
    await ended.promise;
    expect(await SessionManager.list(f.root, f.sessionsDir)).toEqual([]);
    expect((await f.service.status({ id: created.id, cwd: f.root })).persisted).toBe(false);
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([created.id]);
    const catalog = await f.service.list(f.root);
    expect(catalog[0]).toMatchObject({ persisted: false, messageCount: 1 });
    await creator.sessions.applyRefreshedSessionLists([{ cwd: f.root, sessions: catalog }], "local");
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([created.id]);

    // Losing the runtime (as in a daemon restart) must not erase the only
    // recovery record just because shell acceptance was reported as success.
    await f.service.stop({ id: created.id, cwd: f.root });
    await creator.sessions.applyRefreshedSessionLists([{ cwd: f.root, sessions: [] }], "local");
    expect(creator.state.sessions.map((session) => session.id)).toEqual([created.id]);
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([created.id]);
  });

  it("retires cached-new identity after a write is confirmed durable, so reconnect cannot resurrect deleted history", async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const f = await fixture();
    const created = await f.service.start(f.root);
    const creator = f.client(() => {
      f.manager.appendMessage({ role: "user", content: "first message", timestamp: Date.now() });
      return Promise.resolve({ accepted: true });
    });
    rememberCachedNewSession(created);
    const cached = markCachedNewSessionInfo(created);
    Object.assign(creator.state, { sessions: [cached], projectSessions: [cached], selectedSession: cached });
    expect(await creator.sessions.send("first message")).toBe(true);
    expect(await SessionManager.list(f.root, f.sessionsDir)).toHaveLength(1);
    expect(loadCachedNewSessions()).toEqual([]);

    // No intervening browser list read: archive + delete are coalesced, or the
    // observer is disconnected for both operations.
    const ref = { id: created.id, cwd: f.root };
    await f.service.archive(ref);
    await f.service.deleteArchived(ref);
    expect(await f.service.list(f.root)).toEqual([]);
    vi.useFakeTimers();
    await refresh(creator.workspaces);
    expect(creator.state.sessions).toEqual([]);
    expect(creator.state.projectSessions).toEqual([]);
    expect(creator.state.selectedSession).toBeUndefined();
  });

  it.each([false, true])("does not revive a deleted start when persisted status beats its delayed ACK (navigate away=%s)", async (navigateAway) => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const f = await fixture();
    const created = await f.service.start(f.root);
    let resolveStart!: (session: typeof created) => void;
    const response = new Promise<typeof created>((resolve) => { resolveStart = resolve; });
    const observer = f.client(undefined, { startSession: () => response });
    const starting = observer.sessions.startSession();
    observer.sessions.applyGlobalEvent({ type: "session.created", session: created });
    if (navigateAway) await observer.workspaces.selectProject(observer.otherProject);
    f.manager.appendMessage({ role: "user", content: "other client wrote before ACK", timestamp: Date.now() });
    const ref = { id: created.id, cwd: f.root };
    const status = await f.service.status(ref);
    expect(status.persisted).toBe(true);
    observer.sessions.applyGlobalEvent({ type: "status.update", status });
    observer.sessions.flushPendingUpdates();
    expect(loadCachedNewSessions()).toEqual([]);
    await f.service.archive(ref);
    await f.service.deleteArchived(ref);
    expect(await f.service.list(f.root)).toEqual([]);
    if (navigateAway) {
      await observer.workspaces.selectProject(observer.otherProject);
      // UI snapshots may be discarded independently (e.g. on machine navigation);
      // cache retirement must not depend on retaining them until the POST settles.
      observer.state.sessionStatuses = {};
    }
    vi.useFakeTimers();
    resolveStart(created);
    await vi.runAllTimersAsync();
    expect(await starting).toBe(true);
    await observer.sessionListRefresh();
    expect(loadCachedNewSessions()).toEqual([]);
    if (navigateAway) await observer.workspaces.selectProject(observer.project);
    expect(observer.state.sessions).toEqual([]);
    expect(observer.state.projectSessions).toEqual([]);
    expect(observer.state.selectedSession).toBeUndefined();
  });

  it("retires an off-project cache on a same-machine persisted status without touching the visible scope", async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const f = await fixture();
    const created = await f.service.start(f.root);
    rememberCachedNewSession(created);
    rememberCachedNewSession(created, "remote");
    const observer = f.client();
    Object.assign(observer.state, {
      selectedProject: { ...observer.project, id: "other", path: "/other" },
      selectedWorkspace: { ...observer.workspace, id: "other", projectId: "other", path: "/other" },
      workspaces: [], sessions: [], projectSessions: [], selectedSession: undefined,
    });
    f.manager.appendMessage({ role: "user", content: "another client wrote", timestamp: Date.now() });
    const ref = { id: created.id, cwd: f.root };
    const status = await f.service.status(ref);
    expect(status.persisted).toBe(true);
    observer.sessions.applyGlobalEvent({ type: "status.update", status });
    observer.sessions.flushPendingUpdates();
    expect(loadCachedNewSessions().map((session) => session.machineId)).toEqual(["remote"]);
    expect(observer.state.sessions).toEqual([]);
    expect(observer.state.projectSessions).toEqual([]);
    await f.service.archive(ref);
    await f.service.deleteArchived(ref);
    Object.assign(observer.state, { selectedProject: observer.project, selectedWorkspace: undefined, workspaces: [observer.workspace] });
    await observer.workspaces.selectWorkspace(observer.workspace);
    expect(observer.state.sessions).toEqual([]);
    expect(observer.state.projectSessions).toEqual([]);
    expect(observer.state.selectedSession).toBeUndefined();
  });

  it.each(["forkFromHere", "/fork"] as const)("keeps a successful first-user memory-only fork live and selected through %s", async (entry) => {
    const { root, sessionDir, first, sourceId, service, runtime, client } = await forkFixture(false);
    const observer = client();
    const ref = { id: sourceId, cwd: root };
    let created: Awaited<ReturnType<typeof service.start>> | undefined;
    if (entry === "forkFromHere") {
      const result = await service.forkFromHere(ref, first);
      if (!result.cancelled) created = result.session;
    } else {
      const selection = await service.runCommand(ref, "/fork");
      if (selection.type !== "select") throw new Error("Expected fork selection");
      const result = await service.respondToCommand(ref, selection.requestId, first);
      if (result.type === "done") created = result.session;
    }
    if (created === undefined) throw new Error("Expected successful fork identity");
    expect(created.persisted).toBe(false);
    expect(runtime.session.sessionId).toBe(created.id);
    expect(await SessionManager.list(root, sessionDir)).toHaveLength(1);
    expect((await service.list(root)).map((session) => session.id)).toContain(created.id);
    observer.sessions.applyGlobalEvent({ type: "session.created", session: created });
    observer.state.selectedSession = created;
    vi.useFakeTimers();
    await refresh(observer.workspaces);
    expect(observer.state.sessions.map((session) => session.id)).toContain(created.id);
    expect(observer.state.projectSessions.map((session) => session.id)).toContain(created.id);
    expect(observer.state.selectedSession).toMatchObject({ id: created.id });
    await service.stop({ id: created.id, cwd: root });
    expect((await service.list(root)).map((session) => session.id)).toEqual([sourceId]);
  });

  it("calibrates both lists after a cached-recreation ACK whose replacement was already deleted, even when its real join fails", async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const f = await fixture();
    const missing = { ...oldSession, id: "missing-memory-start", cwd: f.root, path: join(f.root, "missing.jsonl"), persisted: false };
    rememberCachedNewSession(missing);
    const cached = markCachedNewSessionInfo(missing);
    const createdReady = deferred<SessionInfo>();
    const ack = deferred<SessionInfo>();
    const observer = f.client(undefined, {
      ...selectionApi(f.root, f.service),
      startSession: async () => {
        const created = await f.service.start(f.root);
        createdReady.resolve(created);
        return ack.promise;
      },
    }, true);
    Object.assign(observer.state, { sessions: [cached], projectSessions: [cached] });
    const selecting = observer.sessions.selectSession(cached);
    const created = await createdReady.promise;
    observer.sessions.applyGlobalEvent({ type: "session.created", session: created });
    f.manager.appendMessage({ role: "user", content: "remote writes replacement", timestamp: Date.now() });
    const ref = { id: created.id, cwd: f.root };
    observer.sessions.applyGlobalEvent({ type: "status.update", status: await f.service.status(ref) });
    observer.sessions.flushPendingUpdates();
    await f.service.archive(ref);
    await f.service.deleteArchived(ref);
    expect(await f.service.list(f.root)).toEqual([]);
    vi.useFakeTimers();
    await refresh(observer.workspaces, [f.root]);
    expect(observer.state.sessions.map((session) => session.id)).toEqual([missing.id]);
    ack.resolve(created);
    await selecting;
    await observer.sessionListRefreshRequested;
    await vi.runAllTimersAsync();
    await observer.sessionListRefresh();
    expect(loadCachedNewSessions()).toEqual([]);
    expect(observer.state.sessions).toEqual([]);
    expect(observer.state.projectSessions).toEqual([]);
    expect(observer.state.selectedSession).toBeUndefined();
  });

  it.each(["/clone", "/fork", "forkFromHere"] as const)("calibrates a delayed %s identity after the delete notification has already settled", async (route) => {
    const f = await forkFixture();
    const source = (await f.service.list(f.root)).find((session) => session.id === f.sourceId);
    if (source === undefined || f.second === undefined) throw new Error("Expected durable source messages");
    const ready = deferred<SessionInfo>();
    const ack = deferred<undefined>();
    const delayIdentity = async (session: SessionInfo) => { ready.resolve(session); await ack.promise; };
    const observer = f.client(undefined, {
      ...selectionApi(f.root, f.service),
      runCommand: async (ref, command) => {
        const result = await f.service.runCommand(ref, command);
        if (result.type === "done" && result.session !== undefined) await delayIdentity(result.session);
        return result;
      },
      respondToCommand: async (ref, requestId, value) => {
        const result = await f.service.respondToCommand(ref, requestId, value);
        if (result.type === "done" && result.session !== undefined) await delayIdentity(result.session);
        return result;
      },
      forkFromHere: async (ref, entry) => {
        const result = await f.service.forkFromHere(ref, entry);
        if (!result.cancelled) await delayIdentity(result.session);
        return result;
      },
    }, true);
    Object.assign(observer.state, { sessions: [source], projectSessions: [source], selectedSession: source });
    let command: Promise<unknown>;
    if (route === "/fork") {
      await observer.sessions.runCommand("/fork");
      const dialog = observer.state.commandDialog;
      if (dialog?.type !== "select") throw new Error("Expected fork selection");
      command = observer.sessions.respondToCommand(dialog.requestId, f.second);
    } else command = route === "/clone" ? observer.sessions.runCommand(route) : observer.sessions.forkFromHere(f.second);
    const child = await ready.promise;
    expect(child.persisted).toBe(true);
    observer.sessions.applyGlobalEvent({ type: "session.created", session: child });
    expect((await f.service.list(f.root)).map((session) => session.id)).toContain(child.id);
    await f.service.archive({ id: child.id, cwd: f.root });
    await f.service.deleteArchived({ id: child.id, cwd: f.root });
    expect((await f.service.list(f.root)).map((session) => session.id)).toEqual([source.id]);
    vi.useFakeTimers();
    await refresh(observer.workspaces, [f.root]);
    expect(observer.state.sessions.map((session) => session.id)).toEqual([source.id]);
    ack.resolve(undefined);
    await command;
    await observer.sessionListRefreshRequested;
    await vi.runAllTimersAsync();
    await observer.sessionListRefresh();
    expect(observer.state.sessions.map((session) => session.id)).toEqual([source.id]);
    expect(observer.state.projectSessions.map((session) => session.id)).toEqual([source.id]);
    expect(observer.state.selectedSession?.id).toBe(source.id);
  });

  it("preserves a genuinely unsent creator's recovery cache while using the live authoritative row", async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const f = await fixture();
    const created = await f.service.start(f.root);
    const creator = f.client();
    rememberCachedNewSession(created);
    const cached = markCachedNewSessionInfo(created);
    Object.assign(creator.state, { sessions: [cached], projectSessions: [cached], selectedSession: cached });
    vi.useFakeTimers();
    await refresh(creator.workspaces);
    expect(creator.state.sessions).toEqual([created]);
    expect(creator.state.projectSessions).toEqual([created]);
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([created.id]);

    // Persistence may happen in another client; a positive status is sufficient
    // to retire this browser's cache even without a local send acknowledgment.
    f.manager.appendMessage({ role: "user", content: "other client wrote", timestamp: Date.now() });
    creator.sessions.applySessionStatus({ ...await f.service.status({ id: created.id, cwd: f.root }), persisted: true });
    expect(loadCachedNewSessions()).toEqual([]);
    expect(creator.state.sessions[0]?.persisted).toBe(true);
    expect(creator.state.projectSessions[0]?.persisted).toBe(true);
    expect(creator.state.selectedSession?.persisted).toBe(true);
    expect(creator.state.selectedSession).not.toHaveProperty("browserCachedNew");
  });
});

async function fixture(realSdkRuntime = false) {
  const root = await mkdtemp(join(tmpdir(), "pi-webui-session-list-sync-"));
  const sessionsDir = join(root, "sessions");
  const manager = SessionManager.create(root, sessionsDir);
  const fake = fakeRuntime(manager.getSessionId(), { sessionFile: manager.getSessionFile(), sessionManager: manager });
  const sdkServices = { ...fakeAgentSessionServices(), cwd: root };
  const sdk = realSdkRuntime ? await createAgentSessionFromServices({ services: sdkServices, sessionManager: manager, model: testModel() }) : undefined;
  const runtime = sdk === undefined ? fake.runtime : new AgentSessionRuntime(sdk.session, sdkServices, () => Promise.reject(new Error("Shell fixture must not recreate its runtime")));
  const hub = new CapturingSessionEventHub();
  const service = new PiSessionService(hub, {
    agentDir: join(root, "agent"), modelRuntime: testModelRuntime,
    archiveStore: new SessionArchiveStore(join(root, "archive.json"), join(root, "archive")),
    createAgentRuntime: runtimeCreator(runtime),
    sessionManager: { create: () => manager, open: () => manager, list: () => SessionManager.list(root, sessionsDir) },
    heartbeatIntervalMs: 60_000,
  });
  return { root, sessionsDir, manager, runtime, hub, service, ...registerFixture(root, service) };
}

async function forkFixture(includeSecondUser = true) {
  const root = await mkdtemp(join(tmpdir(), "pi-webui-fork-list-sync-"));
  const sessionDir = join(root, "sessions");
  const manager = SessionManager.create(root, sessionDir);
  const first = manager.appendMessage({ role: "user", content: "edit first message", timestamp: Date.now() });
  const second = includeSecondUser ? manager.appendMessage({ role: "user", content: "fork before this second message", timestamp: Date.now() }) : undefined;
  const sourceId = manager.getSessionId();
  const sdkServices = { ...fakeAgentSessionServices(), cwd: root };
  const original = await createAgentSessionFromServices({ services: sdkServices, sessionManager: manager, model: testModel() });
  const runtime = new AgentSessionRuntime(original.session, sdkServices, async (options) => ({
    ...await createAgentSessionFromServices({ services: sdkServices, sessionManager: options.sessionManager, model: testModel() }),
    services: sdkServices, diagnostics: [],
  }));
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: join(root, "agent"), modelRuntime: testModelRuntime,
    archiveStore: new SessionArchiveStore(join(root, "archive.json"), join(root, "archive")),
    createAgentRuntime: runtimeCreator(runtime),
    sessionManager: { create: () => manager, open: () => manager, list: () => SessionManager.list(root, sessionDir) },
    heartbeatIntervalMs: 60_000,
  });
  return { root, sessionDir, first, second, sourceId, runtime, service, ...registerFixture(root, service) };
}

function registerFixture(root: string, service: PiSessionService) {
  const clients: (() => void)[] = [];
  fixtures.push({ root, service, clients });
  const client = (prompt?: typeof api.prompt, overrides: Partial<typeof api> = {}, realSelection = false) => {
    const observer = clientForService(root, service, prompt, overrides, realSelection);
    clients.push(observer.dispose);
    return observer;
  };
  return { client };
}

// Transcript/extension payloads are irrelevant here, but lookup success/failure
// follows the real catalog. Do not stub selection, join, or its error handling.
function selectionApi(root: string, service: PiSessionService): Partial<typeof api> {
  const listed = async (ref: Parameters<typeof api.status>[0]) => {
    const session = (await service.list(root)).find((candidate) => candidate.id === sessionLookupId(ref));
    if (session === undefined) throw new Error("Session not found");
    return session;
  };
  return {
    messages: async (ref) => { await listed(ref); return emptyPage; },
    status: async (ref) => {
      const session = await listed(ref);
      return { ...status(session.id), ...(session.persisted === undefined ? {} : { persisted: session.persisted }) };
    },
    streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    extensionEntries: () => Promise.resolve({ entries: [], seq: 0, readRevision: 0 }),
    thinkingLevels: () => Promise.resolve({ levels: [] }),
  };
}

function clientForService(root: string, service: PiSessionService, prompt?: typeof api.prompt, overrides: Partial<typeof api> = {}, realSelection = false) {
  const project = { id: "project", name: "project", path: root, createdAt: "now" };
  const workspace = { id: "main", projectId: project.id, path: root, label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };
  const otherProject = { ...project, id: "other", path: join(root, "other") };
  const otherWorkspace = { ...workspace, id: "other-main", projectId: otherProject.id, path: otherProject.path };
  const state: AppState = { ...initialAppState(), projects: [project, otherProject], selectedProject: project, selectedWorkspace: workspace, workspaces: [workspace] };
  const setState = (patch: Partial<AppState>) => { Object.assign(state, patch); };
  let sessionListRefresh = Promise.resolve();
  const sessionListRefreshRequested = deferred<undefined>();
  const sessions: SessionController = new SessionController(() => state, setState, () => undefined, undefined, {
    socket: new FakeSocket(), api: { ...api, status: (ref) => service.status(ref), ...overrides, ...(prompt === undefined ? {} : { prompt }) },
    refreshSessionLists: (cwds, machineId) => {
      sessionListRefresh = workspaces.refreshSessionLists(cwds, machineId);
      sessionListRefreshRequested.resolve(undefined);
      return sessionListRefresh;
    },
  });
  if (!realSelection) {
    // Earlier membership/cache tests isolate transcript loading. ACK-order tests
    // opt into real selection and coherent lookup failures via selectionApi.
    vi.spyOn(sessions, "selectSession").mockImplementation((selected) => { state.selectedSession = selected; return Promise.resolve(); });
  }
  const workspaces: WorkspaceController = new WorkspaceController(() => state, setState, () => undefined, sessions, undefined, { api: {
    sessions: (cwd) => cwd === root ? service.list(root) : Promise.resolve([]),
    workspaces: (projectId) => Promise.resolve(projectId === project.id ? [workspace] : [otherWorkspace]),
  } });
  return { project, workspace, otherProject, otherWorkspace, state, sessions, workspaces, sessionListRefresh: () => sessionListRefresh, sessionListRefreshRequested: sessionListRefreshRequested.promise, dispose: () => { workspaces.dispose(); sessions.dispose(); } };
}

async function refresh(controller: WorkspaceController, cwds?: string[]): Promise<void> {
  const refreshing = controller.refreshSessionLists(cwds);
  await vi.advanceTimersByTimeAsync(50);
  await refreshing;
}
