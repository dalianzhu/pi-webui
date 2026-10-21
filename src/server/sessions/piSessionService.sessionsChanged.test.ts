import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService, type PiSessionServiceDependencies } from "./piSessionService.js";
import { SessionArchiveStore, type ArchivedSessionRecord } from "./sessionArchiveStore.js";
import { SessionUnreadStore } from "./sessionUnreadStore.js";
import { CapturingSessionEventHub, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, unlink: vi.fn(actual.unlink), rename: vi.fn(actual.rename) };
});

const services: PiSessionService[] = [];
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.unlink).mockReset().mockImplementation(actual.unlink);
  vi.mocked(fs.rename).mockReset().mockImplementation(actual.rename);
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function archived(sessionId: string, cwd: string): ArchivedSessionRecord {
  return { sessionId, cwd, archivedAt: "2026-01-02T00:00:00.000Z", archivePath: `/archive/${sessionId}.jsonl` };
}

function setup(overrides: Partial<PiSessionServiceDependencies> = {}) {
  const hub = new CapturingSessionEventHub();
  const records = [sessionRecord("root"), { ...sessionRecord("child"), parentSessionPath: "/sessions/root.jsonl" }];
  const archivedRecords = new Map([["old", archived("old", "/other")]]);
  const archiveStore: NonNullable<PiSessionServiceDependencies["archiveStore"]> = {
    list: () => Promise.resolve([...archivedRecords.values()]),
    get: (id) => Promise.resolve(archivedRecords.get(id)),
    isArchived: (id) => Promise.resolve(archivedRecords.has(id)),
    archive: (input) => {
      const record = archived(input.sessionId, input.cwd);
      archivedRecords.set(input.sessionId, record);
      return Promise.resolve(record);
    },
    restore: (id) => { archivedRecords.delete(id); return Promise.resolve(); },
    deleteArchived: (id) => { archivedRecords.delete(id); return Promise.resolve(); },
  };
  const fake = fakeRuntime("root", { sessionManager: fakeSessionManager("/workspace", { getSessionId: () => "root" }) });
  const service = new PiSessionService(hub, {
    agentDir: "/tmp/pi-webui-test-agent",
    modelRuntime: testModelRuntime,
    sessionManager: { ...sessionGateway(records), listAll: () => Promise.resolve(records) },
    archiveStore,
    createAgentRuntime: runtimeCreator(fake.runtime),
    heartbeatIntervalMs: 60_000,
    now: () => new Date("2026-06-25T00:00:00.000Z"),
    ...overrides,
  });
  services.push(service);
  const changed = () => hub.globalEvents.filter((event) => event.type === "sessions.changed");
  return { service, hub, changed, archiveStore, fake };
}

describe("session list invalidation", () => {
  it.each([
    ["archive", async (service: PiSessionService) => service.archive(sessionRef("root")), ["/workspace"]],
    ["archiveMany", async (service: PiSessionService) => service.archiveMany([sessionRef("root"), sessionRef("missing")]), ["/workspace"]],
    ["archiveTree", async (service: PiSessionService) => service.archiveTree(sessionRef("root")), ["/workspace"]],
    ["restore", async (service: PiSessionService) => service.restore(sessionRef("old", "/other")), ["/other"]],
    ["deleteArchived", async (service: PiSessionService) => service.deleteArchived(sessionRef("old", "/other")), ["/other"]],
    ["deleteArchivedMany", async (service: PiSessionService) => service.deleteArchivedMany([sessionRef("old", "/other"), sessionRef("missing")]), ["/other"]],
    ["cleanup", async (service: PiSessionService) => service.cleanup({ thresholds: { archiveIdleDays: 30, deleteArchivedDays: 30 } }), ["/workspace", "/other"]],
    ["purge / forceCleanup", async (service: PiSessionService) => service.forceCleanup(), ["/other"]],
  ] as const)("broadcasts changed workspaces through %s", async (_name, mutate, cwds) => {
    const { service, changed } = setup();
    await mutate(service);
    expect([...new Set(changed().map((event) => event.cwd))].sort()).toEqual([...cwds].sort());
  });

  it("preserves session.created and invalidates on start", async () => {
    const { service, hub, changed } = setup();
    await service.start("/workspace");
    expect(hub.globalEvents).toContainEqual(expect.objectContaining({ type: "session.created" }));
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/workspace" }]);
  });

  it.each(["forkFromHere", "/clone", "/fork"] as const)("invalidates a session created through %s", async (entry) => {
    const { service, hub, changed, fake } = setup();
    const forked = fakeRuntime("forked", { sessionManager: fakeSessionManager("/workspace", { getSessionId: () => "forked" }) });
    let rebind: ((session: typeof forked.session) => Promise<void>) | undefined;
    fake.runtime.setRebindSession = (callback) => { rebind = callback; };
    fake.runtime.fork = async () => {
      if (!Reflect.set(fake.runtime, "session", forked.session)) throw new Error("Cannot replace test runtime");
      await rebind?.(forked.session);
      return { cancelled: false };
    };
    fake.session.getUserMessagesForForking = () => [{ entryId: "user-entry", text: "hello" }];
    if (entry === "forkFromHere") {
      await service.forkFromHere(sessionRef("root"), "user-entry");
      expect(hub.globalEvents).toContainEqual(expect.objectContaining({ type: "session.created" }));
    } else {
      const result = await service.runCommand(sessionRef("root"), entry);
      if (entry === "/fork") {
        if (result.type !== "select") throw new Error("Expected fork entry selection");
        await service.respondToCommand(sessionRef("root"), result.requestId, "user-entry");
      }
    }
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/workspace" }]);
  });

  it("does not broadcast for preview, empty/no-op batches, missing targets, stop, or dispose", async () => {
    const { service, changed } = setup();
    await service.cleanupPreview({ thresholds: { archiveIdleDays: 30 } });
    await service.cleanup({ thresholds: {} });
    await service.archiveMany([]);
    await service.archiveMany([sessionRef("old", "/other")]);
    await service.deleteArchivedMany([sessionRef("missing")]);
    await expect(service.restore(sessionRef("missing"))).rejects.toThrow("Session not found");
    await expect(service.deleteArchived(sessionRef("missing"))).rejects.toThrow("Archived session not found");
    await service.status(sessionRef("root"));
    await service.stop(sessionRef("root"));
    await service.dispose();
    expect(changed()).toEqual([]);
  });

  it("does not broadcast for a busy archive or cancelled fork", async () => {
    const { service, changed, fake } = setup();
    fake.session.isStreaming = true;
    await expect(service.archive(sessionRef("root"))).rejects.toThrow("Stop current session activity");
    fake.session.isStreaming = false;
    fake.runtime.fork = () => Promise.resolve({ cancelled: true });
    await service.forkFromHere(sessionRef("root"), "user-entry");
    expect(changed()).toEqual([]);
  });

  it("broadcasts only successful native batch results, deduplicated and canonicalized by cwd", async () => {
    const { service, changed, archiveStore } = setup();
    archiveStore.archiveMany = () => Promise.resolve([
      archived("root", "/workspace/../workspace"), archived("child", "/workspace"),
    ]);
    await service.archiveMany([sessionRef("root"), sessionRef("child"), sessionRef("missing")]);
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/workspace" }]);
    archiveStore.deleteArchivedMany = () => Promise.resolve([]);
    await service.deleteArchivedMany([sessionRef("old", "/other")]);
    expect(changed()).toHaveLength(1);
  });

  it.each(["archive", "delete"] as const)("retains invalidation when a fallback %s batch partially succeeds", async (kind) => {
    const { service, changed, archiveStore } = setup();
    if (kind === "archive") {
      const archive = archiveStore.archive;
      archiveStore.archive = (input) => input.sessionId === "child" ? Promise.reject(new Error("second failed")) : archive(input);
      await service.archiveMany([sessionRef("root"), sessionRef("child")]);
    } else {
      archiveStore.list = () => Promise.resolve([archived("first", "/workspace"), archived("second", "/other")]);
      archiveStore.deleteArchived = (id) => id === "second" ? Promise.reject(new Error("second failed")) : Promise.resolve();
      await service.deleteArchivedMany([sessionRef("first"), sessionRef("second", "/other")]);
    }
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/workspace" }]);
  });

  it("invalidates before later unread cleanup fails", async () => {
    const unreadStore = new SessionUnreadStore();
    const { service, changed } = setup({ unreadStore });
    vi.spyOn(unreadStore, "forgetSession").mockImplementation(() => { throw new Error("unread cleanup failed"); });
    await expect(service.archive(sessionRef("root"))).rejects.toThrow("unread cleanup failed");
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/workspace" }]);
  });
});

async function diskFixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "pi-webui-list-invalidation-"));
  roots.push(root);
  const indexPath = join(root, "index.json");
  const archiveStore = new SessionArchiveStore(indexPath, join(root, "archive"));
  const records = [sessionRecord("a", "/one"), sessionRecord("b", "/two")].map((record) => ({ ...record, path: join(root, `${record.id}.jsonl`) }));
  for (const record of records) await fs.writeFile(record.path, `${record.id}\n`);
  const { service, changed } = setup({ archiveStore, sessionManager: { ...sessionGateway(records), listAll: () => Promise.resolve(records) } });
  const inputs = records.map((record) => ({ ...record, sessionId: record.id, created: record.created.toISOString(), modified: record.modified.toISOString() }));
  return { service, changed, archiveStore, records, inputs, indexPath };
}

describe("durable mutation followed by failure", () => {
  it("broadcasts all committed archive workspaces even when active-file cleanup fails", async () => {
    const { service, changed, archiveStore, records } = await diskFixture();
    vi.mocked(fs.unlink).mockRejectedValueOnce(new Error("active unlink failed"));
    const result = await service.archiveMany(records.map((record) => sessionRef(record.id, record.cwd)));
    expect(result.failures).toHaveLength(2);
    expect(await archiveStore.list()).toHaveLength(2);
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/one" }, { type: "sessions.changed", cwd: "/two" }]);
  });

  it("broadcasts only workspaces whose files were deleted before a batch error", async () => {
    const { service, changed, archiveStore, inputs } = await diskFixture();
    const records = await archiveStore.archiveMany(inputs);
    const unlink = fs.unlink;
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(unlink).mockImplementation(async (path) => {
      if (path === records[1]?.archivePath) throw new Error("second unlink failed");
      await actual.unlink(path);
    });
    await service.deleteArchivedMany([sessionRef("a", "/one"), sessionRef("b", "/two")]);
    expect(await archiveStore.list()).toHaveLength(2);
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/one" }]);
  });

  it("invalidates after restore moves a file but the index write fails", async () => {
    const { service, changed, archiveStore, inputs, indexPath, records } = await diskFixture();
    await archiveStore.archiveMany(inputs);
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (to === indexPath) throw new Error("index rename failed");
      await actual.rename(from, to);
    });
    await expect(service.restore(sessionRef("a", "/one"))).rejects.toThrow("index rename failed");
    const restored = records[0];
    if (restored === undefined) throw new Error("Missing archived fixture record");
    await expect(fs.readFile(restored.path, "utf8")).resolves.toBe("a\n");
    expect(changed()).toEqual([{ type: "sessions.changed", cwd: "/one" }]);
  });

  it("does not broadcast if archive persistence never commits", async () => {
    const { service, changed, archiveStore, records } = await diskFixture();
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("index rename failed"));
    await service.archiveMany(records.map((record) => sessionRef(record.id, record.cwd)));
    expect(await archiveStore.list()).toEqual([]);
    expect(changed()).toEqual([]);
  });
});
