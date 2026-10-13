# Session-level model authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the deterministic
> subagent-driven-development controller to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a session's model selection session-level: the newest recorded `model_change`/`thinking_level_change` and the newest `pi-webui.model-policy` entry in the whole transcript are authoritative, so branch navigation no longer changes the policy, a runtime open restores the newest recorded tuple, an unresolvable recorded selection fails visibly, and automatic turns do not run on a blocked session.

**Architecture:** Two pure modules own the decisions: `readPersistedSessionModelPolicy` returns `none | invalid | persisted` with no invented fallback, and `sessionRuntimeRestore.ts` provides a defensive append-order reader plus a total planner over a verdict table. `PiSessionService` reads `sessionManager.getEntries?.() ?? getBranch()` everywhere and implements `SessionRuntimeRestore.prepare`, which the default runtime factory awaits between `createServices` and `createFromServices`. Runtime blocks become typed `{ cause, reason }` entries so an open can clear exactly one `selection-unavailable` cause while never clearing `runtime-tuple-unproven`. A blocked or mid-transition session delivers subsession notifications with `triggerTurn: false`.

**Tech Stack:** TypeScript (ES2022), Node, Vitest, Pi coding-agent SDK (`@earendil-works/pi-coding-agent`), pi-ai credential stores, repository-specific session model-policy plumbing.

## Global Constraints

- Operation class is session-daemon-affecting. `src/server/sessions/piSessionService.ts`, `src/server/sessions/sessionRuntimeRestore.ts`, and `src/server/sessions/sessionModelPolicy.ts` are loaded only by the long-lived, non-autoreloading `src/server/sessiond.ts`. The handoff and release notes must state that one manual `systemctl --user restart pi-webui-sessiond.service` is required for the fix to take effect, and that ordinary UI/API autoreload does not load it.
- This is a user-visible patch with no new persisted state, no shared API contract change, no new capability gate, and no client change. Do not modify `src/server/sessions/utilityModelExtension.ts`, `src/server/sessions/utilityModelResolver.ts`, the client, or `sessionRoutes.ts`.
- Append order defines "newest": the list returned by `sessionManager.getEntries?.() ?? sessionManager.getBranch()` is authoritative, and branch membership never changes the session model policy or the session runtime selection.
- Model authority is the newest `model_change` entry for the model and the newest `thinking_level_change` entry for the level; never infer the model from assistant responses, and ignore `pi.virtual-model-state` custom entries.
- `runtime-tuple-unproven` is never cleared by a runtime open; only a successful `applySessionModelPolicy` or disposal removes it. The restore hook's only clear path is the `apply` verdict's `selection-unavailable` clear.
- The published block reason keeps the `MODEL_POLICY_BLOCKED: ` prefix. Reader/planner reasons are unprefixed, and the service formats the published string and the two guard messages (`Cannot <action>: MODEL_POLICY_BLOCKED: <reason>` and `Cannot send a prompt: MODEL_POLICY_BLOCKED: <reason>`).
- Reader reasons are exactly `model change provider must be a non-blank string`, `model change model id must be a non-blank string`, and `thinking level must be a non-blank string`.
- Planner reasons are exactly `the newest recorded model ${provider}/${id} is unavailable in this session's catalog`, `the newest recorded thinking level ${level} is unsupported by ${provider}/${id}`, and `the newest recorded model selection ${recorded} disagrees with the persisted Exact policy ${persisted}; apply an explicit session model policy update to repair the session`. The disagreement format is `${provider}/${id}` plus ` at thinking level ${level}` when the recorded selection has a level, and always includes the persisted level.
- Navigation is a pure transcript read for model state and the fix adds no writes: `planSessionRuntimeRestore` is total and pure, and `sessionRuntimeRestore.ts` imports only `PersistedSessionModelPolicyInspection` from `./sessionModelPolicy.js` and `ExactModelSelection` from `../../shared/apiTypes.js`.
- Published `resolved` stays the live runtime tuple; while a block is active it can be Pi's branch-restore fallback rather than the recorded selection.
- Run commands from the repository root. Per-change checks are `npm test -- --run <test-file>`, `npm run typecheck`, and `npm run lint`; `npx knip` and `npm run verify:fast` are cross-cutting completion checks.
- Restore-success test fixtures use a dedicated `createTestModelRuntime(credentials)` seeded with `seedCredential(...)`; never the shared unauthenticated `testModelRuntime`.
- `README.md` is not edited. `docs/config.md` and `docs/config.html` must keep textually equivalent claims. The release record is one patch Changeset at `.changeset/session-level-model-authority.md`; do not edit `CHANGELOG.md`, do not bump versions, and do not run `npm publish` locally.

## Task 1: Fallback-free persisted policy read

**Lane:** pure-domain

**Implementer tier:** Fast

**Files:**

- Modify: `src/server/sessions/sessionModelPolicy.ts:20-51` (add the union and reader; replace the `inspectSessionModelPolicy` body)
- Test: `src/server/sessions/sessionModelPolicy.test.ts:1-12` (import) and a new `describe` block after the existing `inspectSessionModelPolicy` block

**Interfaces:**

- Consumes: existing `SessionModelPolicy`, `ExactModelSelection`, `SessionModelPolicyInspection`, and the module-private helpers `isPolicyEntry`, `parsePolicyData`, `exactPolicy`.
- Produces: `PersistedSessionModelPolicyInspection`, a `none | invalid | persisted` union with no fallback, and `readPersistedSessionModelPolicy(entries: readonly unknown[]): PersistedSessionModelPolicyInspection`. `inspectSessionModelPolicy(entries, fallback): SessionModelPolicyInspection` keeps its exact signature and its legacy/invalid behavior.

- [ ] **Step 1: Write the failing test**

Extend the import at the top of `src/server/sessions/sessionModelPolicy.test.ts` to include `readPersistedSessionModelPolicy`:

```ts
import {
  SESSION_MODEL_POLICY_CUSTOM_TYPE,
  inspectSessionModelPolicy,
  planSessionModelPolicyInitialization,
  planSessionModelPolicyUpdate,
  readPersistedSessionModelPolicy,
  serializeSessionModelPolicy,
} from "./sessionModelPolicy.js";
```

Append this block after the existing `describe("inspectSessionModelPolicy", ...)` block (before `describe("serializeSessionModelPolicy", ...)`):

```ts
  describe("readPersistedSessionModelPolicy", () => {
    it("returns none when no policy entry exists", () => {
      expect(readPersistedSessionModelPolicy([])).toEqual({ kind: "none" });
      expect(readPersistedSessionModelPolicy([
        { type: "message", message: "not a policy" },
        { type: "custom", customType: "other.custom", data: { version: 1 } },
      ])).toEqual({ kind: "none" });
    });

    it("returns the newest valid entry without inventing a fallback", () => {
      const policy = exactPolicy({ model: { id: "gpt-newer" }, thinkingLevel: "high" });

      expect(readPersistedSessionModelPolicy([
        policyEntry(serializeSessionModelPolicy(exactPolicy())),
        policyEntry(serializeSessionModelPolicy(policy)),
      ])).toEqual({ kind: "persisted", policy });
    });

    it("returns the malformed newest entry's reason", () => {
      expect(readPersistedSessionModelPolicy([policyEntry({ version: 99 })])).toEqual({
        kind: "invalid",
        reason: "unsupported policy version",
      });
      expect(readPersistedSessionModelPolicy([
        policyEntry(serializeSessionModelPolicy(exactPolicy())),
        policyEntry({ version: 99 }),
      ])).toEqual({ kind: "invalid", reason: "unsupported policy version" });
    });

    it("keeps the wrapper's legacy and invalid fallback behavior", () => {
      expect(inspectSessionModelPolicy([], fallback)).toEqual({
        kind: "legacy",
        policy: { mode: "exact", exact: fallback },
      });
      expect(inspectSessionModelPolicy([policyEntry({ version: 99 })], fallback)).toEqual({
        kind: "invalid",
        reason: "unsupported policy version",
        fallback: { mode: "exact", exact: fallback },
      });
    });
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/sessionModelPolicy.test.ts`
Expected: FAIL, `readPersistedSessionModelPolicy is not a function` (or a missing-export error).

- [ ] **Step 3: Write the minimal implementation**

In `src/server/sessions/sessionModelPolicy.ts`, add the union after `SessionModelPolicyInspection`:

```ts
export type PersistedSessionModelPolicyInspection =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "persisted"; policy: SessionModelPolicy };
```

Replace the body of the existing `inspectSessionModelPolicy` with the wrapper and add the reader directly after it:

```ts
export function readPersistedSessionModelPolicy(
  entries: readonly unknown[]
): PersistedSessionModelPolicyInspection {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isPolicyEntry(entry)) continue;

    try {
      return { kind: "persisted", policy: parsePolicyData(entry["data"]) };
    } catch (error) {
      return {
        kind: "invalid",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { kind: "none" };
}

export function inspectSessionModelPolicy(
  entries: readonly unknown[],
  fallback: ExactModelSelection,
): SessionModelPolicyInspection {
  const inspection = readPersistedSessionModelPolicy(entries);
  if (inspection.kind === "persisted") return inspection;
  if (inspection.kind === "invalid") {
    return {
      kind: "invalid",
      reason: inspection.reason,
      fallback: exactPolicy(fallback),
    };
  }
  return { kind: "legacy", policy: exactPolicy(fallback) };
}
```

`SessionModelPolicyInspection`, `exactPolicy`, `isPolicyEntry`, and `parsePolicyData` stay as they are; no message or parse rule changes.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/server/sessions/sessionModelPolicy.test.ts`
Expected: PASS, with the four new `readPersistedSessionModelPolicy` cases and every existing case.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/sessionModelPolicy.ts src/server/sessions/sessionModelPolicy.test.ts
git commit -m "refactor(sessions): add a fallback-free persisted policy read"
```

## Task 2: Pure session runtime restore reader and planner

**Lane:** pure-domain

**Implementer tier:** Standard

**Files:**

- Create: `src/server/sessions/sessionRuntimeRestore.ts`
- Test: `src/server/sessions/sessionRuntimeRestore.test.ts`

**Interfaces:**

- Consumes: `PersistedSessionModelPolicyInspection` from `./sessionModelPolicy.js` (Task 1) and `ExactModelSelection` from `../../shared/apiTypes.js`.
- Produces: `SessionRuntimeSelectionInspection`, `inspectSessionRuntimeSelection(entries: readonly unknown[]): SessionRuntimeSelectionInspection`, `SessionRuntimeBlockCause`, `SessionRuntimeRestorePlan`, and `planSessionRuntimeRestore(input): SessionRuntimeRestorePlan` with the exact input shape below. The module is pure and imports nothing from Pi or the service.

- [ ] **Step 1: Write the failing test**

Create `src/server/sessions/sessionRuntimeRestore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.test.ts`
Expected: FAIL, `Cannot find module './sessionRuntimeRestore.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/sessions/sessionRuntimeRestore.ts`:

```ts
import type { ExactModelSelection } from "../../shared/apiTypes.js";
import type { PersistedSessionModelPolicyInspection } from "./sessionModelPolicy.js";

export type SessionRuntimeSelectionInspection =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "selection";
      model: { provider: string; id: string };
      thinkingLevel?: string;
    };

export function inspectSessionRuntimeSelection(
  entries: readonly unknown[]
): SessionRuntimeSelectionInspection {
  let modelEntry: Record<string, unknown> | undefined;
  let thinkingEntry: Record<string, unknown> | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry)) continue;
    if (modelEntry === undefined && entry["type"] === "model_change") modelEntry = entry;
    if (thinkingEntry === undefined && entry["type"] === "thinking_level_change")
      thinkingEntry = entry;
    if (modelEntry !== undefined && thinkingEntry !== undefined) break;
  }
  if (modelEntry === undefined) return { kind: "none" };

  const provider = modelEntry["provider"];
  if (typeof provider !== "string" || provider.trim() === "")
    return { kind: "invalid", reason: "model change provider must be a non-blank string" };
  const modelId = modelEntry["modelId"];
  if (typeof modelId !== "string" || modelId.trim() === "")
    return { kind: "invalid", reason: "model change model id must be a non-blank string" };

  if (thinkingEntry === undefined) {
    return { kind: "selection", model: { provider, id: modelId } };
  }
  const thinkingLevel = thinkingEntry["thinkingLevel"];
  if (typeof thinkingLevel !== "string" || thinkingLevel.trim() === "")
    return { kind: "invalid", reason: "thinking level must be a non-blank string" };
  return { kind: "selection", model: { provider, id: modelId }, thinkingLevel };
}

export type SessionRuntimeBlockCause =
  | "selection-unavailable"
  | "runtime-tuple-unproven";

export type SessionRuntimeRestorePlan =
  | { kind: "none" }
  | {
      kind: "apply";
      model: { provider: string; id: string };
      thinkingLevel?: string;
      clearSelectionUnavailable: boolean;
    }
  | { kind: "block"; cause: SessionRuntimeBlockCause; reason: string };

export function planSessionRuntimeRestore(input: {
  selection: SessionRuntimeSelectionInspection;
  persistedPolicy: PersistedSessionModelPolicyInspection;
  resolvedModel?: { provider: string; id: string; thinkingLevels: readonly string[] };
  existingBlock?: { cause: SessionRuntimeBlockCause; reason: string };
}): SessionRuntimeRestorePlan {
  const { selection, persistedPolicy, resolvedModel, existingBlock } = input;
  const unproven =
    existingBlock?.cause === "runtime-tuple-unproven" ? existingBlock : undefined;

  if (selection.kind === "none") return { kind: "none" };

  if (selection.kind === "invalid") {
    return unproven === undefined
      ? { kind: "block", cause: "selection-unavailable", reason: selection.reason }
      : { kind: "block", cause: "runtime-tuple-unproven", reason: unproven.reason };
  }

  const unavailableReason = unavailableSelectionReason(selection, resolvedModel);
  if (unavailableReason !== undefined) {
    return unproven === undefined
      ? { kind: "block", cause: "selection-unavailable", reason: unavailableReason }
      : { kind: "block", cause: "runtime-tuple-unproven", reason: unproven.reason };
  }

  if (
    persistedPolicy.kind === "persisted" &&
    persistedPolicy.policy.mode === "exact" &&
    !sameExactSelection(persistedPolicy.policy.exact, selection)
  ) {
    return unproven === undefined
      ? {
          kind: "block",
          cause: "runtime-tuple-unproven",
          reason: disagreementReason(selection, persistedPolicy.policy.exact),
        }
      : { kind: "block", cause: "runtime-tuple-unproven", reason: unproven.reason };
  }

  return {
    kind: "apply",
    model: { provider: selection.model.provider, id: selection.model.id },
    ...(selection.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: selection.thinkingLevel }),
    clearSelectionUnavailable: existingBlock?.cause === "selection-unavailable",
  };
}

function unavailableSelectionReason(
  selection: {
    model: { provider: string; id: string };
    thinkingLevel?: string;
  },
  resolvedModel:
    | { provider: string; id: string; thinkingLevels: readonly string[] }
    | undefined
): string | undefined {
  const described = `${selection.model.provider}/${selection.model.id}`;
  if (
    resolvedModel === undefined ||
    resolvedModel.provider !== selection.model.provider ||
    resolvedModel.id !== selection.model.id
  ) {
    return `the newest recorded model ${described} is unavailable in this session's catalog`;
  }
  if (
    selection.thinkingLevel !== undefined &&
    !resolvedModel.thinkingLevels.includes(selection.thinkingLevel)
  ) {
    return `the newest recorded thinking level ${selection.thinkingLevel} is unsupported by ${described}`;
  }
  return undefined;
}

function sameExactSelection(
  exact: ExactModelSelection,
  selection: { model: { provider: string; id: string }; thinkingLevel?: string }
): boolean {
  return (
    exact.model.provider === selection.model.provider &&
    exact.model.id === selection.model.id &&
    (selection.thinkingLevel === undefined ||
      exact.thinkingLevel === selection.thinkingLevel)
  );
}

function disagreementReason(
  selection: { model: { provider: string; id: string }; thinkingLevel?: string },
  exact: ExactModelSelection
): string {
  return `the newest recorded model selection ${describeRecorded(selection)} disagrees with the persisted Exact policy ${describeExact(exact)}; apply an explicit session model policy update to repair the session`;
}

function describeRecorded(selection: {
  model: { provider: string; id: string };
  thinkingLevel?: string;
}): string {
  const described = `${selection.model.provider}/${selection.model.id}`;
  return selection.thinkingLevel === undefined
    ? described
    : `${described} at thinking level ${selection.thinkingLevel}`;
}

function describeExact(exact: ExactModelSelection): string {
  return `${exact.model.provider}/${exact.model.id} at thinking level ${exact.thinkingLevel}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.test.ts`
Expected: PASS, all reader rows and all planner verdict rows.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/sessionRuntimeRestore.ts src/server/sessions/sessionRuntimeRestore.test.ts
git commit -m "feat(sessions): add the pure session runtime restore planner"
```

## Task 3: Session-level transcript reads in PiSessionService

**Lane:** service-authority

**Implementer tier:** Advanced

**Files:**

- Modify: `src/server/sessions/piSessionService.ts:5592-5623` (`policyEntries` rename and `confirmedPolicySnapshot`)
- Modify: `src/server/sessions/piSessionService.ts:5659-5665` (`inspectAndCacheSessionModelPolicy` call site)
- Modify: `src/server/sessions/piSessionService.ts:6311-6350` (`appendSessionCreationSource` call site)
- Modify: `src/server/sessions/piSessionService.testSupport.ts:64-85` (`fakeSessionManager` alias)
- Test: `src/server/sessions/piSessionService.modelPolicy.test.ts:198-260` (harness option), `:382-390` (harness return), `:860-882` (call counts), `:1694-1925` (inverted real-`SessionManager` test), `:1930-1950` (call count), and a new test after `:2135`

**Interfaces:**

- Consumes: `inspectSessionModelPolicy(entries, fallback): SessionModelPolicyInspection` and `inspectSessionCreationSource(entries)` (both existing); `PiSessionManager.getEntries?(): readonly unknown[]` and `getBranch(): unknown[]` (existing).
- Produces: private `sessionTranscriptEntries(session: PiAgentSession): readonly unknown[]` returning `session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch()`; `confirmedPolicySnapshot(ref): Promise<ConfirmedPolicySnapshot>` reading one append-order list for both creation provenance and model policy; `fakeSessionManager(cwd, patch)` whose `getEntries` delegates to the effective `getBranch` unless the patch supplies its own; `createModelPolicyHarness` option `durableEntries?: readonly unknown[]` and returned `getEntries` mock.

- [ ] **Step 1: Write the failing test**

In `src/server/sessions/piSessionService.modelPolicy.test.ts`, add the `durableEntries` option to `ModelPolicyHarnessOptions`:

```ts
  /** Distinct durable/append-order entry list; defaults to the active branch. */
  durableEntries?: readonly unknown[];
```

Replace the harness entry-list setup at the top of `createModelPolicyHarness`:

```ts
  const getBranch = vi.fn(() => branch);
  const getEntries = vi.fn(() => options.durableEntries ?? branch);
```

Add `getEntries,` to the harness's returned object beside `getBranch,`.

Add this test inside `describe("PiSessionService model policy mutation", ...)`, immediately after the `"leaves the confirmed runtime and policy unchanged when remembering the policy fails"` test:

```ts
  it("reads the newest append-order policy while the active branch holds an older one", async () => {
    const abandonedPolicy = {
      mode: "tiered",
      exact: DEFAULT_SELECTION,
      tier: "frontier",
    } as const;
    const activePolicy = {
      mode: "exact",
      exact: DEFAULT_SELECTION,
      tier: "standard",
    } as const;
    const harness = createModelPolicyHarness({
      branch: [policyEntry({ version: 1, ...activePolicy })],
      durableEntries: [
        creationSourceEntry(),
        policyEntry({ version: 1, ...abandonedPolicy }),
      ],
      preferenceStore: { replace: vi.fn(() => Promise.resolve()) },
    });
    await harness.service.status(ref());

    await expect(harness.service.modelPolicy(ref()))
      .resolves.toMatchObject({ policy: abandonedPolicy });
    await expect(harness.service.rememberCurrentModelPolicy(ref()))
      .resolves.toEqual(abandonedPolicy);
  });
```

Update the two call-count tests to count `getEntries`, because the policy read now goes through the durable list:

In `"serves streaming status from the lifecycle cache without rescanning policy or ladder state"`, replace `branchReadsAfterCreate` with an entry-list counter:

```ts
    const entryReadsAfterCreate = harness.getEntries.mock.calls.length;
```

and replace both `expect(harness.getBranch).toHaveBeenCalledTimes(...)` assertions with `expect(harness.getEntries).toHaveBeenCalledTimes(entryReadsAfterCreate)` and `expect(harness.getEntries).toHaveBeenCalledTimes(entryReadsAfterCreate + 1)` respectively.

In `"leaves the confirmed runtime and policy unchanged when remembering the policy fails"`, replace:

```ts
    const branchReadsBeforeRemember = harness.getBranch.mock.calls.length;
```

with:

```ts
    const entryReadsBeforeRemember = harness.getEntries.mock.calls.length;
```

and replace `expect(harness.getBranch).toHaveBeenCalledTimes(branchReadsBeforeRemember + 1);` with `expect(harness.getEntries).toHaveBeenCalledTimes(entryReadsBeforeRemember + 1);`.

Invert the real-`SessionManager` integration test. Rename it:

```ts
  it("reopens durable root metadata and remembers the newest append-order policy after branch navigation", async () => {
```

Keep the two direct `inspectSessionModelPolicy(manager.getEntries(), ...)` / `inspectSessionModelPolicy(manager.getBranch(), ...)` characterizations (`abandonedPolicy` and `activePolicy`) and change the three service assertions to the append-order policy:

```ts
    await expect(
      service.modelPolicy({ id: created.id, cwd: integrationCwd })
    ).resolves.toMatchObject({ policy: abandonedPolicy });
    await expect(
      service.rememberCurrentModelPolicy({
        id: created.id,
        cwd: integrationCwd,
      })
    ).resolves.toEqual(abandonedPolicy);
    expect(preferenceStore.replace).toHaveBeenCalledTimes(2);
    expect(preferenceStore.replace).toHaveBeenLastCalledWith(integrationCwd, {
      kind: "full",
      preference: abandonedPolicy,
    });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/piSessionService.modelPolicy.test.ts`
Expected: FAIL, the new abandoned-branch test and the inverted real-`SessionManager` test resolve `activePolicy` instead of the append-order `abandonedPolicy`.

- [ ] **Step 3: Write the minimal implementation**

In `src/server/sessions/piSessionService.ts`, replace `policyEntries`:

```ts
  private sessionTranscriptEntries(session: PiAgentSession): readonly unknown[] {
    return session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch();
  }
```

In `inspectAndCacheSessionModelPolicy`, replace `this.policyEntries(session)` with `this.sessionTranscriptEntries(session)`.

Replace `confirmedPolicySnapshot` with:

```ts
  private async confirmedPolicySnapshot(
    ref: PiSessionLookup
  ): Promise<ConfirmedPolicySnapshot> {
    const session = await this.getOrOpen(ref);
    const sessionFile = session.sessionManager.getSessionFile();
    const persisted = sessionFileExists(sessionFile);
    const manager = persisted
      ? this.sessionManager.open(sessionFile)
      : session.sessionManager;
    // Creation provenance belongs to the durable root file, even when its original entry is not on the
    // currently selected conversation branch. The model policy now reads the same session-level list.
    const entries = manager.getEntries?.() ?? manager.getBranch();
    const creationSource = inspectSessionCreationSource(entries);
    return {
      cwd: canonicalizeStoredCwd(manager.getCwd()),
      creationSource,
      persisted,
      rootEligibility: this.sessionCreationRootEligibility(manager, creationSource),
      modelPolicy: inspectSessionModelPolicy(entries, this.exactSelectionFromSession(session)),
      transitionInFlight: this.isModelPolicyMutationActive(session),
    };
  }
```

In `appendSessionCreationSource`, replace `inspectSessionCreationSource(this.policyEntries(session))` with `inspectSessionCreationSource(this.sessionTranscriptEntries(session))`.

In `src/server/sessions/piSessionService.testSupport.ts`, replace the `fakeSessionManager` body:

```ts
export function fakeSessionManager(cwd = "/workspace", patch: FakeSessionManagerPatch = {}): PiSessionManager {
  const branch: unknown[] = [];
  let nextEntryId = 1;
  const { appendCustomEntry: appendCustomEntryPatch, ...rest } = patch;
  const defaultAppendCustomEntry = (customType: string, data?: unknown): string => {
    branch.push({ type: "custom", customType, data });
    return `entry-${String(nextEntryId++)}`;
  };
  const appendCustomEntry = "appendCustomEntry" in patch ? appendCustomEntryPatch : defaultAppendCustomEntry;
  const getBranch = patch.getBranch ?? (() => branch);
  return {
    getCwd: () => cwd,
    getSessionId: () => "session-1",
    getSessionFile: () => undefined,
    getBranch,
    getEntries: () => getBranch(),
    getLeafId: () => "leaf-1",
    ...(appendCustomEntry === undefined ? {} : { appendCustomEntry }),
    ...rest,
  };
}
```

`rest` still lets a test pass `getEntries` to override the alias, and tests that patch `getBranch` keep seeing that patched list from both readers.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/server/sessions/piSessionService.modelPolicy.test.ts`
Expected: PASS, including the abandoned-branch test, the inverted real-`SessionManager` test, and every unchanged block-lifetime test.

Run: `npm test -- --run src/server/sessions/piSessionService.extensionEntries.test.ts src/server/sessions/piSessionService.spawnSubsession.test.ts src/server/sessions/piSessionService.lifecycle.test.ts`
Expected: PASS; the `fakeSessionManager` alias preserves every existing patched-`getBranch` fixture.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/piSessionService.ts src/server/sessions/piSessionService.testSupport.ts src/server/sessions/piSessionService.modelPolicy.test.ts
git commit -m "fix(sessions): read session model policy from append order"
```

## Task 4: Runtime factory restore hook

**Lane:** service-authority

**Implementer tier:** Advanced

**Files:**

- Modify: `src/server/sessions/piSessionService.ts:916-930` (add the exported `SessionRuntimeRestore` interface before `PiWebUiCreateAgentSessionRuntimeFactory`)
- Modify: `src/server/sessions/piSessionService.ts:1024-1101` (factory parameter and hook body)
- Modify: `src/server/sessions/piSessionService.rateLimits.test.ts:65-80`, `:140-160` (two factory call sites gain `undefined` before the SDK seam)
- Modify: `src/server/sessions/piSessionService.promptQueue.test.ts:371-385` (one factory call site gains `undefined` before the SDK seam)
- Test: `src/server/sessions/sessionRuntimeRestore.factory.test.ts` (new)

**Interfaces:**

- Consumes: in-scope type aliases `AgentModel`, `ClientThinkingLevel`, `PiSessionManager`, `ModelRuntime`, `PiSessionLogger`, `UtilityModelResolver`, `SpawnSessionFn`, `SubsessionToolDeps`, `ModelPolicyToolDeps`, `ModelRateLimitOwner`, and the module-local `PiWebUiAgentSessionSdk`.
- Produces: exported `SessionRuntimeRestore` with `prepare(input: { sessionId: string; sessionManager: PiSessionManager; modelRuntime: ModelRuntime; explicitModel?: AgentModel; explicitThinkingLevel?: ClientThinkingLevel }): Promise<{ model?: AgentModel; thinkingLevel?: ClientThinkingLevel }>`; `createDefaultRuntimeFactory(modelRuntime, sessionManagers, utilityModelResolver, logger, spawn?, subsessions?, modelPolicy?, modelRateLimitOwner?, restore?: SessionRuntimeRestore, sdk = { createServices, createFromServices })`. The hook is awaited after `sdk.createServices` and before `sdk.createFromServices`, and the merge is `initialModel ?? derived?.model` / `initialThinkingLevel ?? derived?.thinkingLevel`.

- [ ] **Step 1: Write the failing test**

Create `src/server/sessions/sessionRuntimeRestore.factory.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  createDefaultRuntimeFactory,
  type SessionRuntimeRestore,
} from "./piSessionService.js";
import {
  createTestModelRuntime,
  fakeAgentSessionServices,
  fakeRuntime,
  sessionGateway,
  testModel,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-webui-runtime-restore-factory-test-agent";

function factoryHarness(
  restore?: SessionRuntimeRestore,
  modelRuntime: ModelRuntime = testModelRuntime,
  order: string[] = [],
  registerDuringCreateServices?: (runtime: ModelRuntime) => void,
) {
  const services = fakeAgentSessionServices();
  const createServices = vi.fn<typeof createAgentSessionServices>(async () => {
    order.push("createServices");
    registerDuringCreateServices?.(modelRuntime);
    return services;
  });
  const fake = fakeRuntime("factory-session");
  // The SDK session class has private state; this host-surface fake is the tested adapter boundary.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const createdSession = fake.session as unknown as Awaited<
    ReturnType<typeof createAgentSessionFromServices>
  >["session"];
  const createFromServices = vi.fn<typeof createAgentSessionFromServices>(async () => {
    order.push("createFromServices");
    return {
      session: createdSession,
      extensionsResult: services.resourceLoader.getExtensions(),
    };
  });
  const factory = createDefaultRuntimeFactory(
    modelRuntime,
    sessionGateway([]),
    {
      inspect: vi.fn().mockResolvedValue({ candidates: [], sessionModelOnly: false }),
      configuredCandidates: vi.fn().mockResolvedValue([]),
    },
    { info: vi.fn() },
    undefined,
    undefined,
    undefined,
    undefined,
    restore,
    { createServices, createFromServices },
  );
  return { factory, createServices, createFromServices, order };
}

function invokeFactory(
  factory: ReturnType<typeof createDefaultRuntimeFactory>,
  options: Partial<Parameters<ReturnType<typeof createDefaultRuntimeFactory>>[0]> = {},
  sessionManager = SessionManager.inMemory(process.cwd()),
) {
  return factory({
    cwd: process.cwd(),
    agentDir: TEST_AGENT_DIR,
    sessionManager,
    delegationToolsEnabled: false,
    ...options,
  });
}

describe("createDefaultRuntimeFactory restore hook", () => {
  it("passes the plan's model and thinking level to createFromServices", async () => {
    const restoredModel = testModel();
    const prepare = vi.fn<SessionRuntimeRestore["prepare"]>(async () => ({
      model: restoredModel,
      thinkingLevel: "high",
    }));
    const { factory, createFromServices } = factoryHarness({ prepare });
    const sessionManager = SessionManager.inMemory(process.cwd());

    await invokeFactory(factory, {}, sessionManager);

    const options = createFromServices.mock.calls[0]?.[0];
    expect(options?.model).toBe(restoredModel);
    expect(options?.thinkingLevel).toBe("high");
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith({
      sessionId: sessionManager.getSessionId(),
      sessionManager,
      modelRuntime: testModelRuntime,
    });
  });

  it("awaits prepare after createServices and before createFromServices", async () => {
    const order: string[] = [];
    const { factory } = factoryHarness(
      {
        prepare: vi.fn(async () => {
          order.push("prepare");
          return {};
        }),
      },
      testModelRuntime,
      order,
    );

    await invokeFactory(factory);

    expect(order).toEqual(["createServices", "prepare", "createFromServices"]);
  });

  it("makes an extension model registered during createServices resolvable by the hook", async () => {
    const modelRuntime = await createTestModelRuntime();
    const prepare = vi.fn<SessionRuntimeRestore["prepare"]>(async (input) => {
      const model = input.modelRuntime.getModel("ext-virtual", "virtual-1");
      return model === undefined ? {} : { model };
    });
    const { factory, createFromServices } = factoryHarness(
      { prepare },
      modelRuntime,
      [],
      (runtime) => {
        runtime.registerVirtualModel({
          provider: "ext-virtual",
          id: "virtual-1",
          name: "Virtual One",
          thinkingLevels: ["off"],
          route: () => {
            throw new Error("route is not exercised");
          },
        });
      },
    );

    await invokeFactory(factory);

    const options = createFromServices.mock.calls[0]?.[0];
    expect(options?.model?.provider).toBe("ext-virtual");
    expect(options?.model?.id).toBe("virtual-1");
  });

  it("keeps caller-provided values and still receives them in the hook", async () => {
    const explicitModel = testModel();
    const derivedModel = { ...testModel(), id: "derived-model" };
    const prepare = vi.fn<SessionRuntimeRestore["prepare"]>(async () => ({
      model: derivedModel,
      thinkingLevel: "high",
    }));
    const { factory, createFromServices } = factoryHarness({ prepare });

    await invokeFactory(factory, {
      initialModel: explicitModel,
      initialThinkingLevel: "low",
    });

    const options = createFromServices.mock.calls[0]?.[0];
    expect(options?.model).toBe(explicitModel);
    expect(options?.thinkingLevel).toBe("low");
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      explicitModel,
      explicitThinkingLevel: "low",
    }));
  });

  it("propagates a rejecting hook and fails the open", async () => {
    const failure = new Error("restore failed");
    const { factory } = factoryHarness({
      prepare: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(invokeFactory(factory)).rejects.toThrow(failure);
  });

  it("omits model and thinking when no restore dependency is supplied", async () => {
    const { factory, createFromServices } = factoryHarness();

    await invokeFactory(factory);

    const options = createFromServices.mock.calls[0]?.[0] ?? {};
    expect("model" in options).toBe(false);
    expect("thinkingLevel" in options).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.factory.test.ts`
Expected: FAIL, `createDefaultRuntimeFactory` ignores the restore argument (`options?.model` is `undefined`) and the `SessionRuntimeRestore` import is not exported.

- [ ] **Step 3: Write the minimal implementation**

In `src/server/sessions/piSessionService.ts`, insert the interface immediately before `type PiWebUiCreateAgentSessionRuntimeFactory`:

```ts
export interface SessionRuntimeRestore {
  prepare(input: {
    sessionId: string;
    sessionManager: PiSessionManager;
    modelRuntime: ModelRuntime;
    explicitModel?: AgentModel;
    explicitThinkingLevel?: ClientThinkingLevel;
  }): Promise<{ model?: AgentModel; thinkingLevel?: ClientThinkingLevel }>;
}
```

Insert the `restore` parameter between `modelRateLimitOwner` and `sdk` in `createDefaultRuntimeFactory`:

```ts
  modelRateLimitOwner?: ModelRateLimitOwner,
  restore?: SessionRuntimeRestore,
  sdk: PiWebUiAgentSessionSdk = {
```

Inside the returned factory, replace the `sdk.createFromServices` call with the derived-values sequence:

```ts
    const derived =
      restore === undefined
        ? undefined
        : await restore.prepare({
            sessionId: sessionManager.getSessionId(),
            sessionManager,
            modelRuntime,
            ...(initialModel === undefined ? {} : { explicitModel: initialModel }),
            ...(initialThinkingLevel === undefined
              ? {}
              : { explicitThinkingLevel: initialThinkingLevel }),
          });
    const model = initialModel ?? derived?.model;
    const thinkingLevel = initialThinkingLevel ?? derived?.thinkingLevel;
    const result = await sdk.createFromServices({
      services,
      sessionManager,
      customTools,
      ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
      ...(model === undefined ? {} : { model }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    });
```

Update the three existing factory call sites so the SDK seam moves one position:

In `src/server/sessions/piSessionService.rateLimits.test.ts`, both calls end with `owner, { createServices, createFromServices },`; change each to `owner, undefined, { createServices, createFromServices },` (the `makeFactory` helper and the `"charges the branch-summary utility candidate model"` test).

In `src/server/sessions/piSessionService.promptQueue.test.ts`, the one call ends with `undefined, undefined, undefined, undefined, { createServices, createFromServices },`; change it to `undefined, undefined, undefined, undefined, undefined, { createServices, createFromServices },`.

Do not wire a production `restore` adapter yet; Task 5 does that once `prepareSessionRuntimeRestore` exists.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.factory.test.ts`
Expected: PASS, all six hook tests.

Run: `npm test -- --run src/server/sessions/piSessionService.rateLimits.test.ts src/server/sessions/piSessionService.promptQueue.test.ts`
Expected: PASS, unchanged behavior with the shifted SDK parameter.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/piSessionService.ts src/server/sessions/sessionRuntimeRestore.factory.test.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/sessions/piSessionService.promptQueue.test.ts
git commit -m "feat(sessions): add the runtime factory restore hook"
```

## Task 5: Service restore preparation, typed block state, and core integration tests

**Lane:** service-authority

**Implementer tier:** Capable

**Files:**

- Modify: `src/server/sessions/piSessionService.ts:180-200` (`./sessionModelPolicy.js` import list), `:207-209` (new runtime-restore import)
- Modify: `src/server/sessions/piSessionService.ts:1230-1240` (typed block interface and map)
- Modify: `src/server/sessions/piSessionService.ts:5676-5684` (`modelPolicyBlockedReason` prefix formatting; insert the restore methods after it)
- Modify: `src/server/sessions/piSessionService.ts:5979-5985`, `:6140-6147` (typed set sites)
- Modify: `src/server/sessions/piSessionService.ts:6092-6096`, `:6173-6177` (guard message formatting)
- Modify: `src/server/sessions/piSessionService.ts:1425-1429` (production constructor passes the restore adapter)
- Test: `src/server/sessions/sessionRuntimeRestore.integration.test.ts` (new)

**Interfaces:**

- Consumes: `inspectSessionRuntimeSelection(entries)` and `planSessionRuntimeRestore(input)` and `SessionRuntimeBlockCause` from `./sessionRuntimeRestore.js` (Task 2); `readPersistedSessionModelPolicy(entries)` from `./sessionModelPolicy.js` (Task 1); `SessionRuntimeRestore` from Task 4; existing `runtimeThinkingLevels(model)` and `isKnownThinkingLevel(value)`.
- Produces: private `prepareSessionRuntimeRestore(input): Promise<{ model?: AgentModel; thinkingLevel?: ClientThinkingLevel }>` implementing `SessionRuntimeRestore.prepare`; private `resolveSessionRuntimeRestoreModel(modelRuntime, sessionId, selection)` and `boundSessionRuntimeRestoreModel(modelRuntime, selection)`; `modelPolicyRuntimeBlocks: Map<string, ModelPolicyRuntimeBlock>` where `ModelPolicyRuntimeBlock = { cause: SessionRuntimeBlockCause; reason: string }`.

- [ ] **Step 1: Write the failing tests**

Create `src/server/sessions/sessionRuntimeRestore.integration.test.ts`:

```ts
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  SessionManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExactModelSelection } from "../../shared/apiTypes.js";
import {
  PiSessionService,
  type PiSessionLogger,
  type PiSessionServiceDependencies,
} from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import {
  SESSION_MODEL_POLICY_CUSTOM_TYPE,
  serializeSessionModelPolicy,
} from "./sessionModelPolicy.js";
import {
  CapturingSessionEventHub,
  createTestModelRuntime,
  seedCredential,
} from "./piSessionService.testSupport.js";

const OLD_SELECTION: ExactModelSelection = {
  model: { provider: "anthropic", id: "claude-sonnet-4-5-20250929" },
  thinkingLevel: "medium",
};
const NEW_SELECTION: ExactModelSelection = {
  model: { provider: "anthropic", id: "claude-opus-4-5-20251101" },
  thinkingLevel: "high",
};

interface IntegrationHarness {
  service: PiSessionService;
  gateway: ReturnType<typeof createPiSessionManagerGateway>;
  credentials: InMemoryCredentialStore;
  modelRuntime: ModelRuntime;
  loggerInfo: ReturnType<typeof vi.fn>;
  cwd: string;
  agentDir: string;
  sessionDir: string;
  tempDir: string;
}

const harnesses: IntegrationHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.service.dispose();
    await rm(harness.tempDir, { recursive: true, force: true });
  }
});

async function createIntegrationHarness(): Promise<IntegrationHarness> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-webui-runtime-restore-"));
  const cwd = join(tempDir, "workspace");
  const agentDir = join(tempDir, "agent");
  const sessionDir = join(tempDir, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const credentials = new InMemoryCredentialStore();
  await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
  const modelRuntime = await createTestModelRuntime(credentials);
  const gateway = createPiSessionManagerGateway({
    agentDir,
    env: { PI_WEBUI_AGENT_SESSION_DIR: sessionDir },
    sessionDirEnvKeys: ["PI_WEBUI_AGENT_SESSION_DIR"],
  });
  const loggerInfo = vi.fn();
  const logger: PiSessionLogger = { info: loggerInfo };
  const utilityModelResolver: NonNullable<PiSessionServiceDependencies["utilityModelResolver"]> = {
    inspect: () => Promise.resolve({ candidates: [], sessionModelOnly: false }),
    configuredCandidates: () => Promise.resolve([]),
  };
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir,
    sessionManager: gateway,
    modelRuntime,
    logger,
    utilityModelResolver,
    modelTierRegistry: {
      resolve: () => {
        throw new Error("tier resolution is not exercised");
      },
      validate: () => ({ valid: true }),
    },
    heartbeatIntervalMs: 60_000,
  });
  const harness: IntegrationHarness = {
    service,
    gateway,
    credentials,
    modelRuntime,
    loggerInfo,
    cwd,
    agentDir,
    sessionDir,
    tempDir,
  };
  harnesses.push(harness);
  return harness;
}

async function startPlusSession(
  harness: IntegrationHarness,
  policy: ExactModelSelection = OLD_SELECTION,
): Promise<{ ref: { id: string; cwd: string }; path: string }> {
  const created = await harness.service.start(harness.cwd, {
    creationSource: "session-list-plus",
    initialModelPolicy: { mode: "exact", exact: policy },
  });
  return { ref: { id: created.id, cwd: harness.cwd }, path: created.path };
}

function openSdkManager(harness: IntegrationHarness, path: string): SessionManager {
  const manager = harness.gateway.open(path);
  if (!(manager instanceof SessionManager)) {
    throw new Error("Expected an SDK SessionManager");
  }
  return manager;
}

function appendSelection(
  manager: SessionManager,
  selection: ExactModelSelection,
): void {
  manager.appendModelChange(selection.model.provider, selection.model.id);
  manager.appendThinkingLevelChange(selection.thinkingLevel);
  manager.appendCustomEntry(
    SESSION_MODEL_POLICY_CUSTOM_TYPE,
    serializeSessionModelPolicy({ mode: "exact", exact: selection }),
  );
}

describe("session runtime restore integration", () => {
  it("restores the newest recorded tuple on reopen after a rewind", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    const userEntryId = manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    manager.appendModelChange(OLD_SELECTION.model.provider, OLD_SELECTION.model.id);
    const oldTipId = manager.appendThinkingLevelChange(OLD_SELECTION.thinkingLevel);
    manager.branch(userEntryId);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);
    manager.appendCustomEntry(
      SESSION_MODEL_POLICY_CUSTOM_TYPE,
      serializeSessionModelPolicy({ mode: "exact", exact: NEW_SELECTION }),
    );
    manager.branch(oldTipId);
    manager.appendCustomEntry("pi-webui.note", { on: "old-branch-tip" });

    await harness.service.reload(ref);

    const status = await harness.service.status(ref);
    expect(status.modelPolicy?.resolved).toEqual(NEW_SELECTION);
    expect(status.model).toMatchObject(NEW_SELECTION.model);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();

    const reopened = openSdkManager(harness, path);
    const newestModelChange = reopened
      .getEntries()
      .filter((entry) => entry.type === "model_change")
      .at(-1);
    expect(newestModelChange).toMatchObject({
      provider: NEW_SELECTION.model.provider,
      modelId: NEW_SELECTION.model.id,
    });
  });

  it("opens blocked when the newest recorded model cannot be bound and repairs when credentials return", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const unavailableSelection: ExactModelSelection = {
      model: { provider: "openai", id: "gpt-5.2" },
      thinkingLevel: "high",
    };
    appendSelection(openSdkManager(harness, path), unavailableSelection);

    await harness.service.reload(ref);

    let status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(status.modelPolicy?.blockedReason).toContain("gpt-5.2");
    await expect(harness.service.prompt(ref, "must not reach pi"))
      .rejects.toThrow(/MODEL_POLICY_BLOCKED/u);

    await seedCredential(harness.credentials, "openai", { type: "api_key", key: "sk-test-2" });
    await harness.service.reload(ref);

    status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();
    expect(status.modelPolicy?.resolved).toEqual(unavailableSelection);
  });

  it("keeps the open when the restore catalog refresh rejects and blocks with the availability reason", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const ghostSelection: ExactModelSelection = {
      model: { provider: "ghost", id: "ghost-1" },
      thinkingLevel: "off",
    };
    appendSelection(openSdkManager(harness, path), ghostSelection);

    const refresh = vi.spyOn(harness.modelRuntime, "refresh");
    refresh.mockResolvedValueOnce(undefined as never);
    refresh.mockRejectedValueOnce(new Error("catalog offline"));

    await expect(harness.service.reload(ref)).resolves.toBeUndefined();

    const status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(status.modelPolicy?.blockedReason).toContain("ghost-1");
    expect(harness.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ error: "catalog offline" }),
      "session runtime restore model refresh failed",
    );
    refresh.mockRestore();
  });

  it("blocks a persisted-policy disagreement and repairs it through an explicit policy update", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);

    await harness.service.reload(ref);

    let status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(status.modelPolicy?.blockedReason).toContain(OLD_SELECTION.model.id);
    expect(status.modelPolicy?.blockedReason).toContain(NEW_SELECTION.model.id);
    await expect(harness.service.prompt(ref, "must not reach pi"))
      .rejects.toThrow(/MODEL_POLICY_BLOCKED/u);

    await harness.service.setModelPolicy(ref, { mode: "exact", exact: NEW_SELECTION });

    status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();
    expect(status.modelPolicy?.resolved).toEqual(NEW_SELECTION);
  });

  it("keeps a disagreement block across another open", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);

    await harness.service.reload(ref);
    const first = (await harness.service.status(ref)).modelPolicy?.blockedReason;

    await harness.service.reload(ref);
    const second = (await harness.service.status(ref)).modelPolicy?.blockedReason;

    expect(first).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.integration.test.ts`
Expected: FAIL, the rewind test resolves `OLD_SELECTION` (Pi's branch restore) instead of `NEW_SELECTION`, and the unavailable/disagreement fixtures never arm a block. The file compiles because every symbol it uses already exists.

- [ ] **Step 3: Write the minimal implementation**

In `src/server/sessions/piSessionService.ts`, add `readPersistedSessionModelPolicy` to the existing `./sessionModelPolicy.js` import list, and add the runtime-restore import after the `./sessionModelPolicyFallback.js` import:

```ts
import {
  inspectSessionRuntimeSelection,
  planSessionRuntimeRestore,
  type SessionRuntimeBlockCause,
} from "./sessionRuntimeRestore.js";
```

Add the typed block interface immediately before `export class PiSessionService` and change the map declaration:

```ts
interface ModelPolicyRuntimeBlock {
  cause: SessionRuntimeBlockCause;
  reason: string;
}
```

```ts
  private readonly modelPolicyRuntimeBlocks = new Map<string, ModelPolicyRuntimeBlock>();
```

Replace `modelPolicyBlockedReason` and insert the two resolution helpers and `prepareSessionRuntimeRestore` directly after it:

```ts
  /** Effective block: an unproven runtime restoration outranks an entry defect. */
  private modelPolicyBlockedReason(
    session: PiAgentSession
  ): string | undefined {
    const block = this.modelPolicyRuntimeBlocks.get(session.sessionId);
    if (block !== undefined) return `MODEL_POLICY_BLOCKED: ${block.reason}`;
    return this.modelPolicyEntryReasons.get(session);
  }

  private async prepareSessionRuntimeRestore(input: {
    sessionId: string;
    sessionManager: PiSessionManager;
    modelRuntime: ModelRuntime;
    explicitModel?: AgentModel;
    explicitThinkingLevel?: ClientThinkingLevel;
  }): Promise<{ model?: AgentModel; thinkingLevel?: ClientThinkingLevel }> {
    if (
      input.explicitModel !== undefined ||
      input.explicitThinkingLevel !== undefined
    ) {
      return {};
    }

    const entries =
      input.sessionManager.getEntries?.() ?? input.sessionManager.getBranch();
    const selection = inspectSessionRuntimeSelection(entries);
    if (selection.kind === "none") return {};

    const persistedPolicy = readPersistedSessionModelPolicy(entries);

    let boundModel: AgentModel | undefined;
    let resolvedModel:
      | { provider: string; id: string; thinkingLevels: readonly string[] }
      | undefined;
    if (selection.kind === "selection") {
      const bound = await this.resolveSessionRuntimeRestoreModel(
        input.modelRuntime,
        input.sessionId,
        selection.model
      );
      boundModel = bound?.model;
      resolvedModel =
        bound === undefined
          ? undefined
          : {
              provider: bound.model.provider,
              id: bound.model.id,
              thinkingLevels: bound.thinkingLevels,
            };
    }

    const existingBlock = this.modelPolicyRuntimeBlocks.get(input.sessionId);
    const plan = planSessionRuntimeRestore({
      selection,
      persistedPolicy,
      ...(resolvedModel === undefined ? {} : { resolvedModel }),
      ...(existingBlock === undefined ? {} : { existingBlock }),
    });

    if (plan.kind === "none") return {};
    if (plan.kind === "block") {
      this.modelPolicyRuntimeBlocks.set(input.sessionId, {
        cause: plan.cause,
        reason: plan.reason,
      });
      return {};
    }
    if (boundModel === undefined)
      throw new Error(
        "session runtime restore produced an apply plan without a bound model"
      );
    if (plan.clearSelectionUnavailable) {
      this.modelPolicyRuntimeBlocks.delete(input.sessionId);
    }
    const thinkingLevel =
      plan.thinkingLevel !== undefined && isKnownThinkingLevel(plan.thinkingLevel)
        ? plan.thinkingLevel
        : undefined;
    return {
      model: boundModel,
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    };
  }

  private async resolveSessionRuntimeRestoreModel(
    modelRuntime: ModelRuntime,
    sessionId: string,
    selection: { provider: string; id: string }
  ): Promise<{ model: AgentModel; thinkingLevels: readonly string[] } | undefined> {
    const bound = this.boundSessionRuntimeRestoreModel(modelRuntime, selection);
    if (bound !== undefined) return bound;
    try {
      await modelRuntime.refresh({ allowNetwork: false });
    } catch (error: unknown) {
      this.logger.info(
        {
          sessionId,
          model: `${selection.provider}/${selection.id}`,
          error: error instanceof Error ? error.message : String(error),
        },
        "session runtime restore model refresh failed"
      );
      return undefined;
    }
    return this.boundSessionRuntimeRestoreModel(modelRuntime, selection);
  }

  private boundSessionRuntimeRestoreModel(
    modelRuntime: ModelRuntime,
    selection: { provider: string; id: string }
  ): { model: AgentModel; thinkingLevels: readonly string[] } | undefined {
    const model = modelRuntime.getModel(selection.provider, selection.id);
    if (model === undefined || !modelRuntime.hasConfiguredAuth(model.provider)) return undefined;
    return { model, thinkingLevels: runtimeThinkingLevels(model) };
  }
```

Change the two existing runtime-block set sites to the typed reason. In `runExactModelPolicyMutation` and in `applySessionModelPolicy`, replace:

```ts
            this.modelPolicyRuntimeBlocks.set(
              session.sessionId,
              `MODEL_POLICY_BLOCKED: ${reason}; the previous model and thinking pair could not be restored`
            );
```

with:

```ts
            this.modelPolicyRuntimeBlocks.set(session.sessionId, {
              cause: "runtime-tuple-unproven",
              reason: `${reason}; the previous model and thinking pair could not be restored`,
            });
```

Change the two guard messages so the prefix is formatted at the throw site. In `assertExactModelPolicyMutationAllowed`:

```ts
    if (runtimeBlock !== undefined)
      throw new Error(`Cannot ${action}: MODEL_POLICY_BLOCKED: ${runtimeBlock.reason}`);
```

In `assertPromptModelPolicyAllowed`:

```ts
    if (runtimeBlock !== undefined)
      throw new Error(`Cannot send a prompt: MODEL_POLICY_BLOCKED: ${runtimeBlock.reason}`);
```

In the `PiSessionService` constructor, pass the service's restore adapter as the ninth argument, before the defaulted SDK seam:

```ts
        deps.modelRateLimitOwner,
        { prepare: (input) => this.prepareSessionRuntimeRestore(input) }
      );
```

The pre-existing clear sites stay unchanged: `modelPolicyRuntimeBlocks.delete(session.sessionId)` on a successful `applySessionModelPolicy` and `modelPolicyRuntimeBlocks.clear()` in disposal. The restore hook adds exactly one narrow clear path, the `apply` verdict's `selection-unavailable` clear.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.integration.test.ts`
Expected: PASS, all five integration tests.

Run: `npm test -- --run src/server/sessions/piSessionService.modelPolicy.test.ts src/server/sessions/sessionRuntimeRestore.test.ts src/server/sessions/sessionRuntimeRestore.factory.test.ts`
Expected: PASS; the typed block refactor preserves every existing block-lifetime assertion (they assert the `MODEL_POLICY_BLOCKED: ` prefix and prompt refusals) and the pure planner matrix.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/piSessionService.ts src/server/sessions/sessionRuntimeRestore.integration.test.ts
git commit -m "fix(sessions): restore the newest recorded model on runtime open"
```

## Task 6: Automatic-turn gating for subsession notifications

**Lane:** service-authority

**Implementer tier:** Advanced

**Files:**

- Modify: `src/server/sessions/piSessionService.ts:2582-2601` (`deliverSubsessionNotification`)
- Test: `src/server/sessions/piSessionService.spawnSubsession.test.ts:1-6` (import) and two new tests after the `"notifies the parent once when the tracked child stops working"` test at `:1035-1071`

**Interfaces:**

- Consumes: existing private `modelPolicyBlockedReason(session): string | undefined`, `isModelPolicyMutationActive(session): boolean`, `runSessionEntryMutation(session, action, operation)`, and `PiAgentSession.sendCustomMessage(message, options)`.
- Produces: `deliverSubsessionNotification` computing `const blocked = this.modelPolicyBlockedReason(session) !== undefined || this.isModelPolicyMutationActive(session);` inside the same guarded step, immediately before the send, and passing `{ triggerTurn: !blocked, deliverAs: "followUp" }`. The notification is still delivered and displayed when blocked; only `triggerTurn` flips.

- [ ] **Step 1: Write the failing tests**

In `src/server/sessions/piSessionService.spawnSubsession.test.ts`, add the policy custom-type import below the `piSessionService.js` import:

```ts
import { SESSION_MODEL_POLICY_CUSTOM_TYPE } from "./sessionModelPolicy.js";
```

Add these two tests inside `describe("spawnSubsession", ...)`, immediately after the `"notifies the parent once when the tracked child stops working"` test:

```ts
    it("delivers a notification without a turn to a blocked parent", async () => {
      const { parent, child, service } = subsessionService({ allowed: true, cwd: "/workspace-feature" });
      await service.start("/workspace");
      parent.session.sessionManager = fakeSessionManager("/workspace", {
        getBranch: () => [{
          type: "custom",
          customType: SESSION_MODEL_POLICY_CUSTOM_TYPE,
          data: { version: 99 },
        }],
      });
      // Cache a fresh inspection so the gate reads the invalid-entry reason without re-reading.
      await service.modelPolicy(sessionRef("parent-1", "/workspace"));

      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "go", cwd: "/workspace-feature" });
      child.session.isStreaming = true;
      child.emit({ type: "agent_start" });
      child.session.isStreaming = false;
      child.emit({ type: "agent_end" });

      await vi.waitFor(() => {
        expect(parent.calls.sendCustomMessage).toHaveLength(1);
      });
      expect(parent.calls.sendCustomMessage[0]?.message.content).toContain("Subsession child-1 stopped working");
      expect(parent.calls.sendCustomMessage[0]?.options).toEqual({ triggerTurn: false, deliverAs: "followUp" });
      await service.dispose();
    });

    it("delivers a notification without a turn while a policy mutation is active", async () => {
      const { parent, child, service } = subsessionService({ allowed: true, cwd: "/workspace-feature" });
      const model = testModel();
      parent.session.scopedModels = [{ model }];
      let releaseSetModel: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { releaseSetModel = resolve; });
      let setModelStarted = false;
      parent.session.setModel = async (nextModel) => {
        setModelStarted = true;
        parent.session.model = nextModel;
        await gate;
      };
      await service.start("/workspace");
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent-1", parentSessionFile: "/tmp/parent-1.jsonl", prompt: "go", cwd: "/workspace-feature" });

      const transition = service.setModel(sessionRef("parent-1", "/workspace"), model.provider, model.id);
      await vi.waitFor(() => { expect(setModelStarted).toBe(true); });

      child.session.isStreaming = true;
      child.emit({ type: "agent_start" });
      child.session.isStreaming = false;
      child.emit({ type: "agent_end" });

      await vi.waitFor(() => {
        expect(parent.calls.sendCustomMessage).toHaveLength(1);
      });
      expect(parent.calls.sendCustomMessage[0]?.options).toEqual({ triggerTurn: false, deliverAs: "followUp" });

      releaseSetModel?.();
      await transition;
      await service.dispose();
    });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- --run src/server/sessions/piSessionService.spawnSubsession.test.ts -t "without a turn"`
Expected: FAIL, both tests receive `{ triggerTurn: true, deliverAs: "followUp" }`.

- [ ] **Step 3: Write the minimal implementation**

Replace `deliverSubsessionNotification` in `src/server/sessions/piSessionService.ts`:

```ts
  private async deliverSubsessionNotification(
    session: PiAgentSession,
    notification: DeferredSubsessionNotification
  ): Promise<void> {
    await this.runSessionEntryMutation(
      session,
      "deliver a subsession notification",
      () => {
        const blocked =
          this.modelPolicyBlockedReason(session) !== undefined ||
          this.isModelPolicyMutationActive(session);
        return session.sendCustomMessage(
          {
            customType: SUBSESSION_NOTIFICATION_CUSTOM_TYPE,
            content: notification.text,
            display: true,
            details: { sessionId: notification.childId },
          },
          { triggerTurn: !blocked, deliverAs: "followUp" }
        );
      }
    );
    this.publishStatus(session);
  }
```

Both reads are non-throwing and are computed immediately before the send inside the same guarded step, mirroring `submitPrompt`. `notifyParentOfSubsession`'s existing tree-navigation deferral and the two user-initiated paths (`/compact`, tree navigation with summarization) are unchanged.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- --run src/server/sessions/piSessionService.spawnSubsession.test.ts`
Expected: PASS, both new tests plus the existing notification test (which still asserts `{ triggerTurn: true, deliverAs: "followUp" }` for an idle, unblocked parent).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/piSessionService.ts src/server/sessions/piSessionService.spawnSubsession.test.ts
git commit -m "fix(sessions): gate automatic turns on a blocked model policy"
```

## Task 7: Integration coverage for Pi construction and replacement runtimes

**Lane:** integration-coverage

**Implementer tier:** Advanced

**Files:**

- Modify: `src/server/sessions/sessionRuntimeRestore.integration.test.ts:1-40` (imports and harness option), `:45-105` (capture seam), and six tests appended inside the existing `describe`

**Interfaces:**

- Consumes: the `createIntegrationHarness`, `startPlusSession`, `openSdkManager`, `appendSelection`, `OLD_SELECTION`, and `NEW_SELECTION` fixtures from Task 5; real `createAgentSessionRuntime` and `SessionManager` from Pi; `harness.runtimes: Map<string, PiSessionRuntime>`.
- Produces: no production interface. Adds `IntegrationHarnessOptions = { captureRuntimes?: boolean }`, a pass-through `createAgentRuntime` that mirrors `defaultCreateAgentRuntime` and records each constructed runtime by session id, and six tests: Pi's message-less appends, Pi's missing-thinking-entry append, virtual `_recordSelection` non-arming, navigation purity, fork block arming, and clone block arming.

- [ ] **Step 1: Write the failing tests and extend the harness**

In `src/server/sessions/sessionRuntimeRestore.integration.test.ts`, extend the imports:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createAgentSessionRuntime,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  PiSessionService,
  type PiSessionLogger,
  type PiSessionRuntime,
  type PiSessionServiceDependencies,
} from "./piSessionService.js";
```

Add the option/field plumbing:

```ts
interface IntegrationHarnessOptions {
  /** Record every constructed runtime by session id (for Pi's replacement methods). */
  captureRuntimes?: boolean;
}

interface IntegrationHarness {
  service: PiSessionService;
  gateway: ReturnType<typeof createPiSessionManagerGateway>;
  credentials: InMemoryCredentialStore;
  modelRuntime: ModelRuntime;
  loggerInfo: ReturnType<typeof vi.fn>;
  runtimes: Map<string, PiSessionRuntime>;
  cwd: string;
  agentDir: string;
  sessionDir: string;
  tempDir: string;
}
```

Add the pass-through creator above `createIntegrationHarness`:

```ts
/**
 * Mirror `defaultCreateAgentRuntime` while recording the constructed runtime.
 * The factory (and therefore the restore hook) is still the service's default;
 * only the returned runtime object is captured for `_recordSelection` tests.
 */
function passThroughRuntimeCreator(
  runtimes: Map<string, PiSessionRuntime>,
): NonNullable<PiSessionServiceDependencies["createAgentRuntime"]> {
  return async (createRuntime, options) => {
    if (!(options.sessionManager instanceof SessionManager))
      throw new Error("Default runtime creation requires an SDK SessionManager");
    let pendingModel = options.initialModel;
    let pendingThinkingLevel = options.initialThinkingLevel;
    let pendingDelegationToolsEnabled = options.delegationToolsEnabled;
    const runtimeFactory: CreateAgentSessionRuntimeFactory = async (factoryOptions) => {
      const model = pendingModel;
      const thinkingLevel = pendingThinkingLevel;
      const delegationToolsEnabled = pendingDelegationToolsEnabled;
      pendingModel = undefined;
      pendingThinkingLevel = undefined;
      pendingDelegationToolsEnabled = undefined;
      return createRuntime({
        ...factoryOptions,
        ...(model === undefined ? {} : { initialModel: model }),
        ...(thinkingLevel === undefined ? {} : { initialThinkingLevel: thinkingLevel }),
        ...(delegationToolsEnabled === undefined ? {} : { delegationToolsEnabled }),
      });
    };
    const runtime = await createAgentSessionRuntime(runtimeFactory, {
      cwd: options.cwd,
      agentDir: options.agentDir,
      sessionManager: options.sessionManager,
    });
    runtimes.set(options.sessionManager.getSessionId(), runtime);
    return runtime;
  };
}
```

Change `createIntegrationHarness` to accept the option and inject the creator only when requested:

```ts
async function createIntegrationHarness(
  options: IntegrationHarnessOptions = {},
): Promise<IntegrationHarness> {
```

```ts
  const runtimes = new Map<string, PiSessionRuntime>();
  const createAgentRuntime =
    options.captureRuntimes === true
      ? passThroughRuntimeCreator(runtimes)
      : undefined;
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir,
    sessionManager: gateway,
    modelRuntime,
    logger,
    utilityModelResolver,
    modelTierRegistry: {
      resolve: () => {
        throw new Error("tier resolution is not exercised");
      },
      validate: () => ({ valid: true }),
    },
    heartbeatIntervalMs: 60_000,
    ...(createAgentRuntime === undefined ? {} : { createAgentRuntime }),
  });
```

Include `runtimes,` in the returned harness object and in its interface.

Add the assistant-message helper below `appendSelection`:

```ts
function assistantMessageNaming(model: { provider: string; id: string }): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    api: "anthropic-messages",
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 2,
  };
}
```

Append these six tests inside `describe("session runtime restore integration", ...)`:

```ts
  it("passes the derived tuple to Pi's message-less initial appends", async () => {
    const harness = await createIntegrationHarness();
    await writeFile(
      join(harness.agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: OLD_SELECTION.model.provider,
        defaultModel: OLD_SELECTION.model.id,
        defaultThinkingLevel: "medium",
      }),
      "utf8",
    );
    const { ref, path } = await startPlusSession(harness);
    appendSelection(openSdkManager(harness, path), NEW_SELECTION);

    await harness.service.reload(ref);

    const entries = openSdkManager(harness, path).getEntries();
    const newestModelChange = entries.filter((entry) => entry.type === "model_change").at(-1);
    const newestThinking = entries.filter((entry) => entry.type === "thinking_level_change").at(-1);
    expect(newestModelChange).toMatchObject({
      provider: NEW_SELECTION.model.provider,
      modelId: NEW_SELECTION.model.id,
    });
    expect(newestThinking).toMatchObject({ thinkingLevel: NEW_SELECTION.thinkingLevel });
  });

  it("passes the derived level to Pi's missing-thinking-entry append", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.resetLeaf();
    const userEntryId = manager.appendMessage({ role: "user", content: "root question", timestamp: 1 });
    manager.appendThinkingLevelChange("high");
    manager.branch(userEntryId);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendCustomEntry(
      SESSION_MODEL_POLICY_CUSTOM_TYPE,
      serializeSessionModelPolicy({ mode: "exact", exact: NEW_SELECTION }),
    );

    await harness.service.reload(ref);

    const newestThinking = openSdkManager(harness, path)
      .getBranch()
      .filter((entry) => entry.type === "thinking_level_change")
      .at(-1);
    expect(newestThinking).toMatchObject({ thinkingLevel: "high" });
    expect((await harness.service.status(ref)).modelPolicy?.resolved).toEqual(NEW_SELECTION);
  });

  it("does not false-arm when Pi records a virtual selection", async () => {
    const harness = await createIntegrationHarness({ captureRuntimes: true });
    const virtualModel = { provider: "ext-virtual", id: "virtual-1" };
    harness.modelRuntime.registerVirtualModel({
      provider: virtualModel.provider,
      id: virtualModel.id,
      name: "Virtual One",
      thinkingLevels: ["off"],
      route: () => {
        throw new Error("route is not exercised");
      },
    });
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    const userEntryId = manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    const physicalModelId = manager.appendModelChange(OLD_SELECTION.model.provider, OLD_SELECTION.model.id);
    manager.branch(userEntryId);
    manager.appendModelChange(virtualModel.provider, virtualModel.id);
    manager.appendThinkingLevelChange("off");
    manager.appendCustomEntry(
      SESSION_MODEL_POLICY_CUSTOM_TYPE,
      serializeSessionModelPolicy({
        mode: "exact",
        exact: { model: virtualModel, thinkingLevel: "off" },
      }),
    );
    manager.branch(physicalModelId);
    manager.appendMessage(assistantMessageNaming(OLD_SELECTION.model));

    await harness.service.reload(ref);

    const expectedSelection = { model: virtualModel, thinkingLevel: "off" };
    let status = await harness.service.status(ref);
    expect(status.modelPolicy?.resolved).toEqual(expectedSelection);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();

    const runtime = harness.runtimes.get(ref.id);
    if (runtime === undefined) throw new Error("Expected a captured runtime");
    (runtime.session as unknown as { _recordSelection(): void })._recordSelection();

    const newestModelChange = openSdkManager(harness, path)
      .getEntries()
      .filter((entry) => entry.type === "model_change")
      .at(-1);
    expect(newestModelChange).toMatchObject({
      provider: virtualModel.provider,
      modelId: virtualModel.id,
    });

    await harness.service.reload(ref);
    status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();
    expect(status.modelPolicy?.resolved).toEqual(expectedSelection);
  });

  it("keeps the policy, live tuple, and transcript unchanged across Edit from here", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    const userEntryId = manager.appendMessage({ role: "user", content: "edit me", timestamp: 1 });

    const before = await harness.service.modelPolicy(ref);
    const entriesBefore = openSdkManager(harness, path).getEntries().length;

    await harness.service.editFromHere(ref, userEntryId);

    const after = await harness.service.modelPolicy(ref);
    expect(after.policy).toEqual(before.policy);
    expect(after.session.model).toEqual(before.session.model);
    expect(after.session.modelPolicy?.resolved).toEqual(before.session.modelPolicy?.resolved);
    expect(after.session.modelPolicy?.blockedReason).toBe(before.session.modelPolicy?.blockedReason);
    expect(openSdkManager(harness, path).getEntries()).toHaveLength(entriesBefore);
  });

  it("arms the forked session's own block for a copied disagreement", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);
    const userEntryId = manager.appendMessage({ role: "user", content: "fork here", timestamp: 3 });

    await harness.service.reload(ref);
    expect((await harness.service.status(ref)).modelPolicy?.blockedReason)
      .toMatch(/^MODEL_POLICY_BLOCKED: /u);

    const result = await harness.service.forkFromHere(ref, userEntryId);
    expect(result.cancelled).toBe(false);
    if (result.cancelled || result.session === undefined) {
      throw new Error("Expected a forked session");
    }
    const forkedStatus = await harness.service.status({ id: result.session.id, cwd: harness.cwd });
    expect(forkedStatus.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect((await harness.service.status(ref)).modelPolicy?.blockedReason)
      .toMatch(/^MODEL_POLICY_BLOCKED: /u);
  });

  it("arms the cloned session's own block for a copied disagreement", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);
    manager.appendMessage({ role: "user", content: "clone here", timestamp: 3 });

    await harness.service.reload(ref);
    expect((await harness.service.status(ref)).modelPolicy?.blockedReason)
      .toMatch(/^MODEL_POLICY_BLOCKED: /u);

    const result = await harness.service.runCommand(ref, "/clone");
    expect(result.type).toBe("done");
    if (result.type !== "done" || result.session === undefined) {
      throw new Error("Expected a cloned session");
    }
    const clonedStatus = await harness.service.status({ id: result.session.id, cwd: harness.cwd });
    expect(clonedStatus.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect((await harness.service.status(ref)).modelPolicy?.blockedReason)
      .toMatch(/^MODEL_POLICY_BLOCKED: /u);
  });
```

- [ ] **Step 2: Run the tests and confirm the falsifiable ones fail or pass for the right reason**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.integration.test.ts`
Expected: the message-less and missing-thinking-entry tests FAIL against a tree without Task 5's restore hook (Pi appends the pinned defaults instead of the derived tuple). With Task 5 already committed they PASS, and any unexpected failure means the harness or the derived-value plumbing is wrong and must be repaired in this task before committing. The virtual, navigation, fork, and clone tests pin behavior delivered by Tasks 3 and 5; a failure in one of them is a defect, not a test adjustment.

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `npm test -- --run src/server/sessions/sessionRuntimeRestore.integration.test.ts`
Expected: PASS, all eleven integration tests.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/sessions/sessionRuntimeRestore.integration.test.ts
git commit -m "test(sessions): cover runtime restore interactions with Pi construction"
```

## Task 8: Document session-level model authority

**Lane:** docs-release

**Implementer tier:** Standard

**Files:**

- Modify: `docs/config.md:345-350` (new bullet after `**Default and restoration:**`, two replacements in `**Validation and recovery:**`)
- Modify: `docs/config.html:840-845` (same bullet and replacements in `#model-tiers`)
- Modify: `CONTEXT.md:35-47` (`Session model policy`, new `Session runtime selection`, `Remembered policy selection`)
- Modify: `src/shared/apiTypes.ts:311-318` (`ClientSessionModelPolicyStatus.resolved` comment)
- Modify: `docs/superpowers/specs/2026-07-31-tiered-session-model-policy-and-deterministic-sdd-design.md:5` (supersession note) plus the four named statements at `:141`, `:482`, `:681`, `:1226`

**Interfaces:**

- Consumes: the approved behavior implemented by Tasks 1-7; the documentation conventions in `.agents/skills/documentation-guide/SKILL.md`.
- Produces: user-facing documentation, a maintainer glossary, a public doc comment, and the supersession note. No runtime behavior changes. `README.md` is not edited.

- [ ] **Step 1: Add the session-level selection bullet and the two clarifications to `docs/config.md`**

Insert this bullet in the `### Model tiers` section immediately after the `**Default and restoration:**` bullet:

```md
- **Session-level model selection:** The session's model selection is session-level: the newest model and thinking level recorded anywhere in the session transcript are authoritative, not only the entries on the active conversation branch. **Edit from here** and the session-tree navigator change which conversation is active, not which model the session uses, and they do not change the model policy the composer displays. When a session is reopened, PI WEBUI restores the newest recorded model and thinking level. A recorded model that is unavailable (for example a virtual model whose extension is not loaded) or a recorded thinking level the model does not support blocks prompts with a visible `MODEL_POLICY_BLOCKED` reason. The block clears on the next runtime open once the recorded selection resolves again and agrees with the persisted policy (for example after adding credentials or re-enabling the extension, then reopening the session), or immediately through an explicit policy update; if the newest recorded selection disagrees with the persisted Exact policy, the session stays blocked until that explicit update.
```

In the same section's `**Validation and recovery:**` bullet, disambiguate the starter-policy wording, since these are the only `branch` uses on the page that mean a mode:

- Replace `until the user repairs that active branch` with `until the user repairs that active mode`.
- Replace `Intent remembered in the inactive branch is retained and non-blocking until that branch becomes active.` with `Intent remembered in the inactive Exact/Tiered mode is retained and non-blocking until that mode becomes active.`

- [ ] **Step 2: Mirror the bullet and replacements in `docs/config.html`**

In the `<section id="model-tiers">` list, insert this `<li>` immediately after the `**Default and restoration:**` list item:

```html
                <li><strong>Session-level model selection:</strong> The session's model selection is session-level: the newest model and thinking level recorded anywhere in the session transcript are authoritative, not only the entries on the active conversation branch. <strong>Edit from here</strong> and the session-tree navigator change which conversation is active, not which model the session uses, and they do not change the model policy the composer displays. When a session is reopened, PI WEBUI restores the newest recorded model and thinking level. A recorded model that is unavailable (for example a virtual model whose extension is not loaded) or a recorded thinking level the model does not support blocks prompts with a visible <code>MODEL_POLICY_BLOCKED</code> reason. The block clears on the next runtime open once the recorded selection resolves again and agrees with the persisted policy (for example after adding credentials or re-enabling the extension, then reopening the session), or immediately through an explicit policy update; if the newest recorded selection disagrees with the persisted Exact policy, the session stays blocked until that explicit update.</li>
```

Apply the same two `**Validation and recovery:**` replacements inside that section. No TOC entry changes.

- [ ] **Step 3: Update `CONTEXT.md`**

Redefine `**Session model policy**` by appending one sentence:

```md
**Session model policy**:
A session's active Exact or Tiered mode together with its remembered exact model selection and remembered tier. It is session-level state: the newest policy entry in the session transcript is authoritative regardless of the active conversation branch, so tree navigation and Edit from here do not change it.
_Avoid_: Model group, model category
```

Add a new glossary entry immediately after it:

```md
**Session runtime selection**:
The newest model and thinking level recorded in the session transcript, used to restore a session's runtime when it is reopened. It is read in append order and is independent of the active conversation branch; it is never inferred from assistant responses.
_Avoid_: Branch model, last response model
```

Change `**Remembered policy selection**` to:

```md
**Remembered policy selection**:
A stored Exact selection or model tier that represents user intent and is validated when its Exact or Tiered mode branch is active. Temporary unavailability does not erase or replace it.
_Avoid_: Available default, fallback model
```

- [ ] **Step 4: Update the `resolved` doc comment in `src/shared/apiTypes.ts`**

Replace the `ClientSessionModelPolicyStatus.resolved` comment:

```ts
  /**
   * The tuple last confirmed by the policy runtime adapter in this staged slice; outside a
   * transition it is the live runtime tuple, which a reopen can restore from the transcript's newest
   * recorded selection. While a block is active it can be Pi's branch-restore fallback rather than
   * the recorded selection.
   */
  resolved: ExactModelSelection;
```

No type or wire-shape change.

- [ ] **Step 5: Add the supersession note and the four inline markers**

In `docs/superpowers/specs/2026-07-31-tiered-session-model-policy-and-deterministic-sdd-design.md`, add this block immediately after the `**Supersedes:**` line:

```md
> **Superseded in part (2026-10-13):** Model-selection authority is session-level, not
> branch-scoped. The newest `model_change`/`thinking_level_change` and the newest
> `pi-webui.model-policy` entry in the whole session transcript are authoritative, regardless of the
> active conversation branch. This supersedes the statements that "Fork, clone, resume, and tree
> navigation derive policy from the active session branch", that "Reads inspect the active branch.
> The latest matching entry is authoritative", the `inspectSession(branch, runtimeSelection)`
> signature, and the acceptance item "Resume/fork/clone/tree navigation use active-branch policy".
> Fork and clone still inherit the copied branch's selection, because their transcript contains only
> that branch. See `2026-10-13-session-level-model-authority-design.md`.
```

Append ` (Superseded in part 2026-10-13 — see the supersession note above.)` as a plain sentence after each of these four named statements so a reader landing on one does not miss the note:

- the bullet `- Fork, clone, resume, and tree navigation derive policy from the active session branch.`
- the paragraph `Reads inspect the active branch. The latest matching entry is authoritative. A malformed or unsupported latest entry fails closed; no older value or runtime fallback replaces it silently.`
- the acceptance item `13. Resume/fork/clone/tree navigation use active-branch policy.`
- the fenced signature line `inspectSession(branch, runtimeSelection): PolicyInspection;` — add the marker after the enclosing code block (the block containing `parseDirective`, `planRequest`, `planUiTransition`, and `inheritForChild`), not inside the fence.

- [ ] **Step 6: Verify the documentation edits**

Run: `git diff --check`
Expected: no whitespace errors.

Run: `grep -c "Session-level model selection" docs/config.md docs/config.html`
Expected: `1` in each file.

Run: `grep -c "that active mode" docs/config.md docs/config.html` and `grep -c "inactive Exact/Tiered mode" docs/config.md docs/config.html`
Expected: `1` in each file for both patterns.

Run: `grep -c "Superseded in part" docs/superpowers/specs/2026-07-31-tiered-session-model-policy-and-deterministic-sdd-design.md`
Expected: `5` (one note plus four inline markers).

Review the two documentation files side by side and confirm the new bullet and the two clarifications carry the same claims in both representations.

- [ ] **Step 7: Commit**

```bash
git add docs/config.md docs/config.html CONTEXT.md src/shared/apiTypes.ts docs/superpowers/specs/2026-07-31-tiered-session-model-policy-and-deterministic-sdd-design.md
git commit -m "docs(sessions): document session-level model authority"
```

## Task 9: Add the patch Changeset

**Lane:** docs-release

**Implementer tier:** Fast

**Files:**

- Create: `.changeset/session-level-model-authority.md`

**Interfaces:**

- Consumes: the user-visible behavior and the manual session-daemon restart requirement from Global Constraints.
- Produces: one patch Changeset for `@hyperdreamer/pi-webui`. No version bump, no `CHANGELOG.md` edit, and no local publish.

- [ ] **Step 1: Create the Changeset**

Create `.changeset/session-level-model-authority.md`:

```md
---
"@hyperdreamer/pi-webui": patch
---

Keep a session's model selection session-level. **Edit from here** and the session-tree navigator
no longer change which model a session uses, and reopening a session restores the newest model and
thinking level recorded anywhere in its transcript instead of the active branch's value. A recorded
model that is unavailable or a recorded thinking level the model does not support now blocks prompts
with a visible `MODEL_POLICY_BLOCKED` reason, which clears on the next reopen once the selection
resolves again, or immediately through an explicit policy update. This fix lives in the session
daemon: restart `pi-webui-sessiond.service` for it to take effect.
```

- [ ] **Step 2: Verify the Changeset**

Run: `git diff --check`
Expected: no whitespace errors.

Run: `cat .changeset/session-level-model-authority.md`
Expected: the frontmatter names `"@hyperdreamer/pi-webui"` with `patch` and the body states the user impact and the manual `pi-webui-sessiond.service` restart.

- [ ] **Step 3: Commit**

```bash
git add .changeset/session-level-model-authority.md
git commit -m "chore(release): add the session-level model authority changeset"
```
