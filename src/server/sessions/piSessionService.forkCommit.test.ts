import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSessionRuntime,
  createAgentSessionFromServices,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import {
  CapturingSessionEventHub,
  emptyArchiveStore,
  fakeAgentSessionServices,
  runtimeCreator,
  sessionGateway,
  testModel,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const services: PiSessionService[] = [];
const roots: string[] = [];
const entries = ["forkFromHere", "/clone", "/fork"] as const;
type ForkEntry = typeof entries[number];

// Use the real SDK session/runtime/manager; only runtime recreation fails.
// In particular, the manager that commits the fork is NOT runtime.session's manager.
async function setup(recreation: "fail" | "succeed" = "fail") {
  const cwd = await mkdtemp(join(tmpdir(), "pi-webui-fork-commit-"));
  roots.push(cwd);
  const sessionDir = join(cwd, "sessions");
  const manager = SessionManager.create(cwd, sessionDir);
  const first = manager.appendMessage({ role: "user", content: "first", timestamp: Date.now() });
  const second = manager.appendMessage({ role: "user", content: "second", timestamp: Date.now() });
  const sourceId = manager.getSessionId();
  const sdkServices = { ...fakeAgentSessionServices(), cwd };
  const { session } = await createAgentSessionFromServices({
    services: sdkServices,
    sessionManager: manager,
    model: testModel(),
  });
  const createRuntime = vi.fn<CreateAgentSessionRuntimeFactory>(async (options) => {
    if (recreation === "fail") throw new Error("new runtime failed after durable branch write");
    const result = await createAgentSessionFromServices({
      services: sdkServices,
      sessionManager: options.sessionManager,
      model: testModel(),
    });
    return { ...result, services: sdkServices, diagnostics: [] };
  });
  const runtime = new AgentSessionRuntime(session, sdkServices, createRuntime);
  const hub = new CapturingSessionEventHub();
  const service = new PiSessionService(hub, {
    agentDir: join(cwd, "agent"),
    modelRuntime: testModelRuntime,
    archiveStore: emptyArchiveStore(),
    sessionManager: sessionGateway(await SessionManager.list(cwd, sessionDir)),
    createAgentRuntime: runtimeCreator(runtime),
    heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  const ref = { id: sourceId, cwd };
  await service.status(ref);
  const changed = () => hub.globalEvents.filter((event) => event.type === "sessions.changed");
  const persisted = () => SessionManager.list(cwd, sessionDir);
  const fork = async (entry: ForkEntry, entryId = second) => {
    if (entry === "forkFromHere") return service.forkFromHere(ref, entryId);
    if (entry === "/clone") return service.runCommand(ref, entry);
    const selection = await service.runCommand(ref, entry);
    if (selection.type !== "select") throw new Error("Expected fork entry selection");
    return service.respondToCommand(ref, selection.requestId, entryId);
  };
  return { cwd, manager, first, second, sourceId, runtime, session, createRuntime, hub, changed, persisted, fork };
}

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await Promise.all(services.splice(0).map((service) => service.dispose()));
  } finally {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  }
});

describe("durable SDK fork invalidation", () => {
  it.each(entries)("notifies exactly once after a successful SDK fork through %s", async (entry) => {
    const h = await setup("succeed");
    await h.fork(entry);
    expect(await h.persisted()).toHaveLength(2);
    expect(h.runtime.session.sessionId).not.toBe(h.sourceId);
    expect(h.changed()).toEqual([{ type: "sessions.changed", cwd: h.cwd }]);
    if (entry === "forkFromHere") {
      expect(h.hub.globalEvents.filter((event) => event.type === "session.created" || event.type === "sessions.changed").map((event) => event.type))
        .toEqual(["session.created", "sessions.changed"]);
    }
  });

  it.each(entries)("notifies a durable fork when runtime recreation fails through %s", async (entry) => {
    const h = await setup();
    expect(await h.persisted()).toHaveLength(1);
    await expect(h.fork(entry)).rejects.toThrow("new runtime failed");
    const persisted = await h.persisted();
    expect(persisted).toHaveLength(2);
    expect(persisted.find((record) => record.id !== h.sourceId)?.parentSessionPath).toBe(h.session.sessionFile);
    expect(h.runtime.session.sessionId).toBe(h.sourceId);
    expect(h.manager.getSessionId()).toBe(h.sourceId);
    expect(h.changed()).toEqual([{ type: "sessions.changed", cwd: h.cwd }]);
  });

  it.each(entries)("notifies a durable fork even when teardown fails before createRuntime through %s", async (entry) => {
    const h = await setup();
    vi.spyOn(h.session, "abort").mockRejectedValueOnce(new Error("teardown failed"));
    await expect(h.fork(entry)).rejects.toThrow("teardown failed");
    expect(h.createRuntime).not.toHaveBeenCalled();
    expect(await h.persisted()).toHaveLength(2);
    expect(h.runtime.session.sessionId).toBe(h.sourceId);
    expect(h.changed()).toEqual([{ type: "sessions.changed", cwd: h.cwd }]);
  });

  it.each(entries)("does not notify a cancelled SDK fork through %s", async (entry) => {
    const h = await setup();
    vi.spyOn(h.session.extensionRunner, "hasHandlers").mockImplementation((event) => event === "session_before_fork");
    vi.spyOn(h.session.extensionRunner, "emit").mockResolvedValue({ cancel: true });
    await h.fork(entry);
    expect(h.createRuntime).not.toHaveBeenCalled();
    expect(await h.persisted()).toHaveLength(1);
    expect(h.changed()).toEqual([]);
  });

  it.each(entries)("does not mistake an existing durable child for a commit on failed %s", async (entry) => {
    const h = await setup();
    const sourceFile = h.manager.getSessionFile();
    if (sourceFile === undefined) throw new Error("Expected persisted source");
    SessionManager.open(sourceFile, h.manager.getSessionDir()).createBranchedSession(h.first);
    expect(await h.persisted()).toHaveLength(2);
    vi.spyOn(h.manager, "getLeafId").mockReturnValue("invalid-entry");
    await expect(h.fork(entry, "invalid-entry")).rejects.toThrow("Invalid entry ID");
    expect(h.createRuntime).not.toHaveBeenCalled();
    expect(await h.persisted()).toHaveLength(2);
    expect(h.changed()).toEqual([]);
  });

  it.each(entries)("does not attribute an unrelated newly persisted session to a failed %s", async (entry) => {
    const h = await setup();
    vi.spyOn(h.manager, "getEntry").mockImplementationOnce(() => {
      const unrelated = SessionManager.create(h.cwd, h.manager.getSessionDir());
      unrelated.appendMessage({ role: "user", content: "unrelated", timestamp: Date.now() });
      throw new Error("failed before fork commit");
    });
    await expect(h.fork(entry)).rejects.toThrow("failed before fork commit");
    expect(await h.persisted()).toHaveLength(2);
    expect(h.changed()).toEqual([]);
  });

  it.each(["forkFromHere", "/fork"] as const)("does not notify an unpersisted first-message fork whose recreation fails through %s", async (entry) => {
    const h = await setup();
    await expect(h.fork(entry, h.first)).rejects.toThrow("new runtime failed");
    expect(h.createRuntime).toHaveBeenCalledOnce();
    expect(await h.persisted()).toHaveLength(1);
    expect(h.changed()).toEqual([]);
  });
});
