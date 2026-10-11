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

    const response = await serviceWith(hub, "ext-session", branch).extensionEntries(sessionRef("ext-session"));

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
    });
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

    expect(hub.sessionEvents).toContainEqual({
      sessionId: "ext-session",
      event: { type: "pi.event", eventType: "entry_appended" },
    });
    expect(hub.sessionEvents.filter((record) => record.event.type === "session.extensionEntry")).toEqual([]);
  });
});
