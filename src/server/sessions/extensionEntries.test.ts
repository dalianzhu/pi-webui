import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_EXTENSION_ENTRIES,
  MAX_SESSION_EXTENSION_ENTRY_DATA_BYTES,
  sessionExtensionEntriesFromBranch,
  sessionExtensionEntry,
} from "./extensionEntries";

const customEntry = (customType: string, data?: unknown, id = "e1") => ({
  type: "custom",
  customType,
  data,
  id,
  timestamp: "2026-01-01T00:00:00.000Z",
});

describe("session extension entries", () => {
  it("normalizes an extension custom entry", () => {
    expect(sessionExtensionEntry(customEntry("task-plan", { revision: 3 }))).toEqual({
      customType: "task-plan",
      data: { revision: 3 },
      entryId: "e1",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("ignores entries that are not extension state", () => {
    expect(sessionExtensionEntry({ type: "message", id: "m1", message: { role: "user" } })).toBeUndefined();
    expect(sessionExtensionEntry({ type: "custom_message", customType: "subsession.completion", id: "c1" })).toBeUndefined();
    expect(sessionExtensionEntry(undefined)).toBeUndefined();
    expect(sessionExtensionEntry("custom")).toBeUndefined();
  });

  it("ignores a custom entry without an extension identifier", () => {
    expect(sessionExtensionEntry({ type: "custom", id: "e1" })).toBeUndefined();
    expect(sessionExtensionEntry({ type: "custom", customType: 7, id: "e1" })).toBeUndefined();
  });

  it("reports an entry without data when the extension wrote none", () => {
    const entry = sessionExtensionEntry(customEntry("task-plan"));
    expect(entry).toEqual({ customType: "task-plan", entryId: "e1", timestamp: "2026-01-01T00:00:00.000Z" });
    expect(entry && "data" in entry).toBe(false);
  });

  it("omits an oversized payload but still reports the entry", () => {
    const entry = sessionExtensionEntry(
      customEntry("task-plan", "x".repeat(MAX_SESSION_EXTENSION_ENTRY_DATA_BYTES + 1)),
    );
    expect(entry?.dataOmitted).toBe(true);
    expect(entry && "data" in entry).toBe(false);
  });

  it("omits a payload that cannot be serialized instead of failing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(sessionExtensionEntry(customEntry("task-plan", cyclic))?.dataOmitted).toBe(true);
  });

  // JSON.stringify returns undefined for these, and the response is serialized the same way, so
  // without the omission flag the payload would vanish and look like "the extension wrote none".
  it("omits a payload JSON cannot represent at all", () => {
    for (const payload of [() => undefined, Symbol("payload"), { toJSON: () => undefined }]) {
      const entry = sessionExtensionEntry(customEntry("task-plan", payload));
      expect(entry?.dataOmitted).toBe(true);
      expect(entry && "data" in entry).toBe(false);
    }
  });

  it("still reports a genuinely absent payload as absent rather than omitted", () => {
    const entry = sessionExtensionEntry(customEntry("task-plan", undefined));
    expect(entry?.dataOmitted).toBeUndefined();
  });

  // Pi stores customType verbatim, and it is the identity a plugin filters on, so PI WEBUI must
  // not rename the writer.
  it("forwards the writer's custom type verbatim", () => {
    expect(sessionExtensionEntry(customEntry(" my-extension "))?.customType).toBe(" my-extension ");
    expect(sessionExtensionEntry(customEntry("Task-Plan"))?.customType).toBe("Task-Plan");
  });

  it("treats only a custom type with no content as absent", () => {
    expect(sessionExtensionEntry({ type: "custom", customType: "   ", id: "e1" })).toBeUndefined();
    expect(sessionExtensionEntry({ type: "custom", customType: "\t", id: "e1" })).toBeUndefined();
  });

  it("collects only extension entries from a branch, oldest first", () => {
    const branch = [
      { type: "message", id: "m1", message: { role: "user" } },
      customEntry("task-plan", { revision: 1 }, "e1"),
      { type: "message", id: "m2", message: { role: "assistant" } },
      customEntry("observer", { ok: true }, "e2"),
    ];
    expect(sessionExtensionEntriesFromBranch(branch).map((entry) => entry.customType)).toEqual([
      "task-plan",
      "observer",
    ]);
  });

  it("keeps the most recent entries when a branch exceeds the cap", () => {
    const branch = Array.from({ length: MAX_SESSION_EXTENSION_ENTRIES + 5 }, (_value, index) =>
      customEntry("task-plan", { revision: index }, `e${String(index)}`),
    );
    const entries = sessionExtensionEntriesFromBranch(branch);
    expect(entries).toHaveLength(MAX_SESSION_EXTENSION_ENTRIES);
    expect(entries[0]?.entryId).toBe("e5");
    expect(entries.at(-1)?.entryId).toBe(`e${String(MAX_SESSION_EXTENSION_ENTRIES + 4)}`);
  });
});
