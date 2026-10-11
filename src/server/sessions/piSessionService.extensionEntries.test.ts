import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import {
  CapturingSessionEventHub,
  fakeRuntime,
  fakeSessionManager,
  runtimeCreator,
  sessionGateway,
  sessionRecord,
  sessionRef,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-webui-test-agent";
const customEntry = (customType: string, data: unknown, id: string) => ({
  type: "custom",
  customType,
  data,
  id,
  parentId: "leaf-1",
  timestamp: "2026-01-01T00:00:00.000Z",
});

function serviceWith(
  hub: CapturingSessionEventHub,
  sessionId: string,
  branch: unknown[],
  listeners: ((event: unknown) => void)[] = [],
) {
  const fake = fakeRuntime(sessionId, {
    sessionManager: fakeSessionManager("/workspace", { getBranch: () => branch }),
    subscribe: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
  });
  return new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId)]),
    heartbeatIntervalMs: 60_000,
  });
}

describe("PiSessionService extension entries", () => {
  it("reports extension entries with the event cursor they were read at", async () => {
    const hub = new CapturingSessionEventHub();
    const branch = [
      { type: "message", id: "m1", message: { role: "user", content: "hi" } },
      customEntry("task-plan", { revision: 1 }, "e1"),
    ];
    hub.setSeq("ext-session", 12);
    const service = serviceWith(hub, "ext-session", branch);

    const response = await service.extensionEntries(sessionRef("ext-session"));
    await service.dispose();

    // The cursor comes from the same read as the entries; `stream-snapshot` is the precedent.
    expect(response).toEqual({
      entries: [
        {
          customType: "task-plan",
          data: { revision: 1 },
          entryId: "e1",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
      seq: 12,
      readRevision: 1,
    });
  });

  // The event cursor orders events, not reads. A branch can change inside Pi's tree hooks without
  // publishing anything, so a client needs this separate ordering to drop a superseded read.
  it("orders reads independently of a standing event cursor", async () => {
    const hub = new CapturingSessionEventHub();
    hub.setSeq("ext-session", 7);
    const service = serviceWith(hub, "ext-session", [customEntry("task-plan", { revision: 1 }, "e1")]);

    const first = await service.extensionEntries(sessionRef("ext-session"));
    const second = await service.extensionEntries(sessionRef("ext-session"));
    await service.dispose();

    expect(first.seq).toBe(second.seq);
    expect(first.readRevision).toBe(1);
    expect(second.readRevision).toBe(2);
  });

  // A stopped session is cold opened again while the browser keeps the same event socket, so the
  // reads after a reopen must not look older than the reads before it. A per-runtime counter would
  // restart and a client would reject them as superseded.
  it("keeps read ordering monotonic across a stopped and reopened session", async () => {
    const hub = new CapturingSessionEventHub();
    const branches: unknown[][] = [
      [],
      [customEntry("task-plan", { revision: 1 }, "e1")],
    ];
    let createdRuntimes = 0;
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: () => {
        const branch = branches[Math.min(createdRuntimes, branches.length - 1)] ?? [];
        createdRuntimes += 1;
        return Promise.resolve(
          fakeRuntime("ext-session", {
            sessionManager: fakeSessionManager("/workspace", { getBranch: () => branch }),
          }).runtime,
        );
      },
      sessionManager: sessionGateway([sessionRecord("ext-session")]),
      heartbeatIntervalMs: 60_000,
    });

    const before = await service.extensionEntries(sessionRef("ext-session"));
    expect(before.entries).toEqual([]);

    await service.stop(sessionRef("ext-session"));
    const after = await service.extensionEntries(sessionRef("ext-session"));
    await service.dispose();

    // The reopen really produced a new runtime, so the assertion below is not satisfied by reuse.
    expect(createdRuntimes).toBe(2);
    expect(after.entries.map((entry) => entry.entryId)).toEqual(["e1"]);
    expect(after.readRevision).toBeGreaterThan(before.readRevision);
  });

  it("publishes an extension entry event when Pi reports one", async () => {
    const hub = new CapturingSessionEventHub();
    const listeners: ((event: unknown) => void)[] = [];
    const service = serviceWith(hub, "ext-session", [], listeners);
    await service.status(sessionRef("ext-session"));

    const listener = listeners[0];
    expect(listener).toBeDefined();
    listener?.({
      type: "entry_appended",
      entry: customEntry("task-plan", { revision: 2 }, "e2"),
    });

    // Opening the session publishes its own events, so assert the entry event is among them.
    await service.dispose();
    expect(hub.sessionEvents).toContainEqual({
      sessionId: "ext-session",
      event: {
        type: "session.extensionEntry",
        entry: {
          customType: "task-plan",
          data: { revision: 2 },
          entryId: "e2",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      },
    });
  });

  it("keeps the payload-free passthrough for an entry that is not extension state", async () => {
    const hub = new CapturingSessionEventHub();
    const listeners: ((event: unknown) => void)[] = [];
    const service = serviceWith(hub, "ext-session", [], listeners);
    await service.status(sessionRef("ext-session"));

    listeners[0]?.({ type: "entry_appended", entry: { type: "label", id: "l1" } });
    await service.dispose();

    expect(hub.sessionEvents).toContainEqual({
      sessionId: "ext-session",
      event: { type: "pi.event", eventType: "entry_appended" },
    });
    expect(hub.sessionEvents.filter((record) => record.event.type === "session.extensionEntry")).toEqual([]);
  });
});
