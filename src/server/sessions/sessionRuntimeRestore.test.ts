import { describe, expect, it } from "vitest";
import type { PersistedSessionModelPolicyInspection } from "./sessionModelPolicy.js";
import {
  inspectSessionRuntimeSelection,
  planSessionRuntimeRestore,
  type SessionRuntimeBlockCause,
  type SessionRuntimeRestorePlan,
  type SessionRuntimeSelectionInspection,
} from "./sessionRuntimeRestore.js";

const modelChange = (provider: string, modelId: string): unknown => ({
  type: "model_change",
  provider,
  modelId,
});
const thinkingChange = (thinkingLevel: unknown): unknown => ({
  type: "thinking_level_change",
  thinkingLevel,
});
const userMessage = (id: string, parentId: string | null): unknown => ({
  type: "message",
  id,
  parentId,
  message: { role: "user", content: "hi" },
});

const recorded = (
  provider: string,
  id: string,
  thinkingLevel?: string,
): SessionRuntimeSelectionInspection =>
  thinkingLevel === undefined
    ? { kind: "selection", model: { provider, id } }
    : { kind: "selection", model: { provider, id }, thinkingLevel };

const policyExact = (
  provider: string,
  id: string,
  thinkingLevel: string,
): PersistedSessionModelPolicyInspection => ({
  kind: "persisted",
  policy: { mode: "exact", exact: { model: { provider, id }, thinkingLevel } },
});

const policyTiered = (): PersistedSessionModelPolicyInspection => ({
  kind: "persisted",
  policy: {
    mode: "tiered",
    exact: { model: { provider: "legacy", id: "remembered" }, thinkingLevel: "low" },
    tier: "standard",
  },
});

const bound = (
  provider: string,
  id: string,
  thinkingLevels: readonly string[],
) => ({ provider, id, thinkingLevels });

const UNAVAILABLE_BLOCK = {
  cause: "selection-unavailable" as const,
  reason: "old availability reason",
};
const UNPROVEN_BLOCK = {
  cause: "runtime-tuple-unproven" as const,
  reason: "old unproven reason",
};

const APPLY_SELECTION = recorded("a", "m1", "high");
const APPLY_MODEL = bound("a", "m1", ["off", "high"]);

const applyPlan = (clearSelectionUnavailable: boolean): SessionRuntimeRestorePlan => ({
  kind: "apply",
  model: { provider: "a", id: "m1" },
  thinkingLevel: "high",
  clearSelectionUnavailable,
});

function plan(input: {
  selection: SessionRuntimeSelectionInspection;
  persistedPolicy?: PersistedSessionModelPolicyInspection;
  resolvedModel?: { provider: string; id: string; thinkingLevels: readonly string[] };
  existingBlock?: { cause: SessionRuntimeBlockCause; reason: string };
}): SessionRuntimeRestorePlan {
  return planSessionRuntimeRestore({
    selection: input.selection,
    persistedPolicy: input.persistedPolicy ?? { kind: "none" },
    ...(input.resolvedModel === undefined ? {} : { resolvedModel: input.resolvedModel }),
    ...(input.existingBlock === undefined ? {} : { existingBlock: input.existingBlock }),
  });
}

describe("inspectSessionRuntimeSelection", () => {
  it("returns none for an empty transcript", () => {
    expect(inspectSessionRuntimeSelection([])).toEqual({ kind: "none" });
  });

  it("returns the newest model change without a thinking level when none is recorded", () => {
    expect(inspectSessionRuntimeSelection([modelChange("a", "m1")])).toEqual({
      kind: "selection",
      model: { provider: "a", id: "m1" },
    });
  });

  it("returns the last model change in append order", () => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      modelChange("b", "m2"),
    ])).toEqual({ kind: "selection", model: { provider: "b", id: "m2" } });
  });

  it("ignores branch links and uses append order", () => {
    const linear = [
      modelChange("a", "m1"),
      userMessage("u1", null),
      modelChange("b", "m2"),
      userMessage("u2", "u1"),
    ];
    const relinked = [
      modelChange("a", "m1"),
      userMessage("u1", null),
      modelChange("b", "m2"),
      userMessage("u2", null),
    ];
    const expected = { kind: "selection", model: { provider: "b", id: "m2" } };

    expect(inspectSessionRuntimeSelection(linear)).toEqual(expected);
    expect(inspectSessionRuntimeSelection(relinked)).toEqual(expected);
  });

  it("pairs a thinking change after the model change", () => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      thinkingChange("high"),
    ])).toEqual(recorded("a", "m1", "high"));
  });

  it("pairs a thinking change before the model change", () => {
    expect(inspectSessionRuntimeSelection([
      thinkingChange("high"),
      modelChange("a", "m1"),
    ])).toEqual(recorded("a", "m1", "high"));
  });

  it("uses the newest thinking change even when it precedes the model change", () => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      thinkingChange("low"),
      thinkingChange("high"),
    ])).toEqual(recorded("a", "m1", "high"));
  });

  it.each([
    ["an object", {}],
    ["an empty string", ""],
    ["a number", 3],
  ])("rejects a malformed newest thinking level (%s)", (_description, level) => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      thinkingChange(level),
    ])).toEqual({ kind: "invalid", reason: "thinking level must be a non-blank string" });
  });

  it("returns none for a thinking-only transcript regardless of validity", () => {
    expect(inspectSessionRuntimeSelection([thinkingChange({})])).toEqual({ kind: "none" });
    expect(inspectSessionRuntimeSelection([thinkingChange("high")])).toEqual({ kind: "none" });
  });

  it("rejects a blank provider on the newest model change", () => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      { type: "model_change", provider: "", modelId: "m2" },
    ])).toEqual({ kind: "invalid", reason: "model change provider must be a non-blank string" });
  });

  it("rejects a missing model id on the newest model change", () => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      { type: "model_change", provider: "b" },
    ])).toEqual({ kind: "invalid", reason: "model change model id must be a non-blank string" });
  });

  it("lets the newest invalid model change win over an older valid one", () => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      modelChange("c", "m3"),
      { type: "model_change", provider: "b", modelId: " " },
    ])).toEqual({ kind: "invalid", reason: "model change model id must be a non-blank string" });
  });

  it("ignores non-record entries", () => {
    expect(inspectSessionRuntimeSelection([
      null,
      "x",
      3,
      [],
      modelChange("a", "m1"),
    ])).toEqual({ kind: "selection", model: { provider: "a", id: "m1" } });
  });

  it("ignores virtual-model state custom entries", () => {
    expect(inspectSessionRuntimeSelection([
      modelChange("a", "m1"),
      { type: "custom", customType: "pi.virtual-model-state", data: {} },
    ])).toEqual({ kind: "selection", model: { provider: "a", id: "m1" } });
  });
});

describe("planSessionRuntimeRestore", () => {
  it("preserves an absent block for a none selection", () => {
    expect(plan({ selection: { kind: "none" } })).toEqual({ kind: "none" });
  });

  it("preserves a selection-unavailable block for a none selection", () => {
    expect(plan({ selection: { kind: "none" }, existingBlock: UNAVAILABLE_BLOCK }))
      .toEqual({ kind: "none" });
  });

  it("preserves an unproven block for a none selection", () => {
    expect(plan({ selection: { kind: "none" }, existingBlock: UNPROVEN_BLOCK }))
      .toEqual({ kind: "none" });
  });

  it("arms selection-unavailable for an invalid selection", () => {
    expect(plan({ selection: { kind: "invalid", reason: "bad entry" } }))
      .toEqual({ kind: "block", cause: "selection-unavailable", reason: "bad entry" });
  });

  it("replaces a stale selection-unavailable reason for an invalid selection", () => {
    expect(plan({
      selection: { kind: "invalid", reason: "bad entry" },
      existingBlock: UNAVAILABLE_BLOCK,
    })).toEqual({ kind: "block", cause: "selection-unavailable", reason: "bad entry" });
  });

  it("preserves an unproven block for an invalid selection", () => {
    expect(plan({
      selection: { kind: "invalid", reason: "bad entry" },
      existingBlock: UNPROVEN_BLOCK,
    })).toEqual({ kind: "block", cause: "runtime-tuple-unproven", reason: "old unproven reason" });
  });

  it("arms selection-unavailable when the recorded model is absent", () => {
    expect(plan({ selection: recorded("a", "m1") })).toEqual({
      kind: "block",
      cause: "selection-unavailable",
      reason: "the newest recorded model a/m1 is unavailable in this session's catalog",
    });
  });

  it("treats a mismatched resolved model as unbindable", () => {
    expect(plan({
      selection: recorded("a", "m1"),
      resolvedModel: bound("b", "m2", ["off"]),
    })).toEqual({
      kind: "block",
      cause: "selection-unavailable",
      reason: "the newest recorded model a/m1 is unavailable in this session's catalog",
    });
  });

  it("arms selection-unavailable for an unsupported recorded thinking level", () => {
    expect(plan({
      selection: recorded("a", "m1", "xhigh"),
      resolvedModel: bound("a", "m1", ["off", "high"]),
    })).toEqual({
      kind: "block",
      cause: "selection-unavailable",
      reason: "the newest recorded thinking level xhigh is unsupported by a/m1",
    });
  });

  it("preserves an unproven block when the recorded model is absent", () => {
    expect(plan({
      selection: recorded("a", "m1"),
      existingBlock: UNPROVEN_BLOCK,
    })).toEqual({ kind: "block", cause: "runtime-tuple-unproven", reason: "old unproven reason" });
  });

  it("preserves an unproven block when the resolved model is mismatched", () => {
    expect(plan({
      selection: recorded("a", "m1"),
      resolvedModel: bound("b", "m2", ["off"]),
      existingBlock: UNPROVEN_BLOCK,
    })).toEqual({ kind: "block", cause: "runtime-tuple-unproven", reason: "old unproven reason" });
  });

  it("preserves an unproven block for an unsupported recorded level", () => {
    expect(plan({
      selection: recorded("a", "m1", "xhigh"),
      resolvedModel: bound("a", "m1", ["off", "high"]),
      existingBlock: UNPROVEN_BLOCK,
    })).toEqual({ kind: "block", cause: "runtime-tuple-unproven", reason: "old unproven reason" });
  });

  it("applies a bound selection under a legacy policy", () => {
    expect(plan({ selection: APPLY_SELECTION, resolvedModel: APPLY_MODEL }))
      .toEqual(applyPlan(false));
  });

  it("clears a selection-unavailable block on apply", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      resolvedModel: APPLY_MODEL,
      existingBlock: UNAVAILABLE_BLOCK,
    })).toEqual(applyPlan(true));
  });

  it("keeps an unproven block on apply", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      resolvedModel: APPLY_MODEL,
      existingBlock: UNPROVEN_BLOCK,
    })).toEqual(applyPlan(false));
  });

  it("applies under a tiered policy without comparing the remembered tuple", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: policyTiered(),
      resolvedModel: APPLY_MODEL,
    })).toEqual(applyPlan(false));
  });

  it("applies while the persisted entry is invalid", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: { kind: "invalid", reason: "bad entry" },
      resolvedModel: APPLY_MODEL,
    })).toEqual(applyPlan(false));
  });

  it("applies when the persisted Exact tuple is equal", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: policyExact("a", "m1", "high"),
      resolvedModel: APPLY_MODEL,
    })).toEqual(applyPlan(false));
  });

  it("applies when an unrecorded thinking level agrees with any persisted level", () => {
    expect(plan({
      selection: recorded("a", "m1"),
      persistedPolicy: policyExact("a", "m1", "medium"),
      resolvedModel: APPLY_MODEL,
    })).toEqual({
      kind: "apply",
      model: { provider: "a", id: "m1" },
      clearSelectionUnavailable: false,
    });
  });

  it("blocks when the persisted Exact tuple names a different provider", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: policyExact("b", "m1", "high"),
      resolvedModel: APPLY_MODEL,
    })).toEqual({
      kind: "block",
      cause: "runtime-tuple-unproven",
      reason: "the newest recorded model selection a/m1 at thinking level high disagrees with the persisted Exact policy b/m1 at thinking level high; apply an explicit session model policy update to repair the session",
    });
  });

  it("blocks when the persisted Exact tuple names a different model id", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: policyExact("a", "m2", "high"),
      resolvedModel: APPLY_MODEL,
    })).toMatchObject({ kind: "block", cause: "runtime-tuple-unproven" });
  });

  it("blocks when the persisted Exact tuple names a different thinking level", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: policyExact("a", "m1", "medium"),
      resolvedModel: APPLY_MODEL,
    })).toMatchObject({ kind: "block", cause: "runtime-tuple-unproven" });
  });

  it("preserves an unproven reason through a disagreement", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: policyExact("b", "m1", "high"),
      resolvedModel: APPLY_MODEL,
      existingBlock: UNPROVEN_BLOCK,
    })).toEqual({ kind: "block", cause: "runtime-tuple-unproven", reason: "old unproven reason" });
  });

  it("upgrades a selection-unavailable block to a disagreement", () => {
    expect(plan({
      selection: APPLY_SELECTION,
      persistedPolicy: policyExact("b", "m1", "high"),
      resolvedModel: APPLY_MODEL,
      existingBlock: UNAVAILABLE_BLOCK,
    })).toMatchObject({
      kind: "block",
      cause: "runtime-tuple-unproven",
      reason: "the newest recorded model selection a/m1 at thinking level high disagrees with the persisted Exact policy b/m1 at thinking level high; apply an explicit session model policy update to repair the session",
    });
  });
});
