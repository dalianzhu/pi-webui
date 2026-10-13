# Technical Specification: Session-level model authority

- **Status:** Implementation-ready specification for planning
- **Date:** 2026-10-13
- **PM run:** `pm-run-20261013-061048-983022fb`
- **Topic slug:** `session-level-model-authority`
- **Delivery target:** `refs/heads/main` @ `248afaa825d1269a659ddca8abbe57ff689b97d1`
- **Source design:** `docs/superpowers/specs/2026-10-13-session-level-model-authority-design.md` (approved
  after four frontier design-review rounds)
- **Verification base:** every interface, type, message, call sequence, and symbol below was checked
  against the repository source at `248afaa`. The design commit `d41cf4e` adds only the design
  document, so the source trees are identical.
- **Change class:** user-visible patch. No new persisted state, no shared API contract change, no new
  capability gate, no client change.
- **Operation class:** session-daemon-affecting. `src/server/sessions/piSessionService.ts`, the new
  `src/server/sessions/sessionRuntimeRestore.ts`, and `src/server/sessions/sessionModelPolicy.ts` are
  loaded only by the long-lived `src/server/sessiond.ts`. Per `AGENTS.md`, installing this fix requires
  one manual `systemctl --user restart pi-webui-sessiond.service`; ordinary UI/API autoreload does not
  load it. The documentation and Changeset changes are not runtime code.

Where the approved design constrains behavior but does not fix a string or a private name, this
specification picks one and records it in §12 as a specification-level choice. There are no TBDs.

---

## 1. Scope

### 1.1 What changes

1. **New pure module `src/server/sessions/sessionRuntimeRestore.ts`.** It exports the transcript
   reader `inspectSessionRuntimeSelection`, the block-cause union `SessionRuntimeBlockCause`, the
   verdict union `SessionRuntimeRestorePlan`, and the pure planner `planSessionRuntimeRestore`
   (§3).
2. **Fallback-free policy read split in `src/server/sessions/sessionModelPolicy.ts`.**
   `readPersistedSessionModelPolicy` returns `none | invalid | persisted`; the existing
   `inspectSessionModelPolicy(entries, fallback)` becomes a thin wrapper that maps `none` to the
   existing legacy result, so every current caller keeps its behavior (§3.5).
3. **Session-level policy authority in `PiSessionService`.** `policyEntries` is renamed to
   `sessionTranscriptEntries` and reads `sessionManager.getEntries?.() ?? sessionManager.getBranch()`;
   the remember-policy snapshot and creation-source verification read the same append-order list
   (§4).
4. **Runtime restore hook.** `createDefaultRuntimeFactory` accepts an optional `SessionRuntimeRestore`
   dependency before its injectable SDK seam; `PiSessionService` implements `prepare` and passes it to
   the factory it constructs. The hook reads the transcript in append order, resolves the recorded
   model after `createServices` has registered extension providers/models, calls the planner, applies
   the verdict, and returns the model/thinking for `createFromServices` (§5).
5. **Block state becomes typed.** `modelPolicyRuntimeBlocks` stores `{ cause, reason }`; `arm`,
   `clear`, and `preserve` semantics are fixed per verdict; the published reason keeps the
   `MODEL_POLICY_BLOCKED: ` prefix (§5.6).
6. **Automatic-turn gating.** `deliverSubsessionNotification` delivers with `triggerTurn: false` when
   the session is blocked or a policy mutation is active (§6).
7. **Tests and docs.** Pure reader/planner tests, fake-SDK factory tests, real-SDK integration tests,
   existing-test updates, `docs/config.md` + `docs/config.html`, `CONTEXT.md`, the
   `ClientSessionModelPolicyStatus.resolved` comment, the supersession note, and a patch Changeset
   (§9, §10).

### 1.2 Out of scope (binding non-goals)

All design non-goals are binding; the implementation must not do any of the following:

- Change fork/clone inheritance: a forked file contains only the copied branch, so the new session
  inherits the policy at its fork point, exactly as today.
- Change Pi's branch-based conversation context, extension entries, subsession links, compaction, or
  tree projection. Creation-source verification moves to append-order entries along with the rest of
  the transcript reads, but it validates the entry that was just appended, so its result is unchanged.
- Change the tier ladder, Exact/Tiered transitions, or the lightweight fallback.
- Add client-side model state; the browser stays a consumer of the published policy.
- Change how new root sessions or spawned/child sessions choose their model. Spawned sessions pass an
  explicit `initialModel` (and sometimes `initialThinkingLevel`), so the restore hook is suppressed
  for them by §5.3.
- Infer the model from assistant responses. Model authority is the newest recorded `model_change` for
  every transcript; Pi's branch restore also considers non-virtual assistant responses, and that
  difference is intentional.
- Gate the two user-initiated provider paths a blocked session can still reach: tree navigation with
  summarization (branch summary runs on the configured lightweight utility model, falling back to the
  session model) and `/compact` (the configured Context utility unless session-only).
- Modify `src/server/sessions/utilityModelExtension.ts`, `utilityModelResolver.ts`, the client, or
  `sessionRoutes.ts`.

---

## 2. Invariants

These are binding for implementation and review:

1. **Append order defines "newest".** Branch membership never changes the session model policy or the
   session runtime selection. The reader and the policy read both scan the list returned by
   `getEntries?.() ?? getBranch()` from the end.
2. **Mutation paths keep the two values agreeing at rest.** `applyExactSelection` writes Pi's
   `model_change`/`thinking_level_change` and `appendSessionModelPolicy` writes
   `pi-webui.model-policy` in one serialized mutation. In Tiered mode the applied model is owned by
   `model_change` alone; the policy's `exact` is the remembered Exact selection.
3. **A restore decision is total and pure.** `planSessionRuntimeRestore` depends only on its inputs;
   it never reads the transcript, Pi types, or service state.
4. **Recorded selection beats inference.** For restore, only the newest `model_change` entry is
   consulted for the model; only the newest `thinking_level_change` entry is consulted for the level;
   assistant responses and `pi.virtual-model-state` entries are ignored.
5. **A derived restore never mixes with a caller-provided tuple.** If the runtime caller supplied
   `initialModel` or `initialThinkingLevel`, the hook returns `{}` without reading entries, resolving
   the catalog, or touching a block.
6. **An unbindable *recorded* selection fails visibly.** The runtime may still open on Pi's
   branch-restore substitute, but prompts are refused until the block is repaired; the published
   reason names the recorded selection.
7. **`runtime-tuple-unproven` is never cleared by an open.** Only a successful
   `applySessionModelPolicy` or disposal removes it.
8. **Navigation is a pure transcript read for model state.** It must not change the policy, the
   runtime selection, the block, or the live tuple, and must not itself append model, thinking, or
   policy entries.
9. **The fix adds no writes.** Restore reads the transcript and applies model/thinking to the new
   runtime through the existing factory options; it appends nothing.
10. **The published `resolved` value stays the live tuple.** While blocked it can be Pi's
    branch-restore fallback; `blockedReason` explains the block.
11. **The persisted session stores no leaf.** PI WEBUI navigation (`editFromHere`, tree navigation)
    moves only the in-memory leaf; `SessionManager.branch()` is not persisted. A close/reopen
    rebuilds the leaf by walking the file in append order, so the reopened active branch is the last
    appended entry's branch. Session-level append-order authority — not the leaf — is what makes a
    reopen restore the recorded selection regardless of where navigation left the in-memory pointer.

---

## 3. Pure decision modules

### 3.1 `src/server/sessions/sessionRuntimeRestore.ts` — exports

The module is pure: it imports nothing from `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`,
or the service. Its only cross-module import is the type
`PersistedSessionModelPolicyInspection` from `./sessionModelPolicy.js` and `ExactModelSelection` from
`../../shared/apiTypes.js`.

```ts
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
): SessionRuntimeSelectionInspection;

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
}): SessionRuntimeRestorePlan;
```

### 3.2 Reader contract — executable rules

Transcript entries are parsed without full validation, so the reader validates defensively. `isRecord`
is the same module-local helper used in `sessionModelPolicy.ts`
(`value !== null && typeof value === "object" && !Array.isArray(value)`). Exact algorithm:

```ts
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
```

Rules, in evaluation order:

| # | Condition | Result |
| --- | --- | --- |
| 1 | no record entry with `type === "model_change"` anywhere in the list | `{ kind: "none" }`, **regardless of thinking entries** (valid or malformed) |
| 2 | newest `model_change` has a non-string or blank `provider` | `{ kind: "invalid", reason: "model change provider must be a non-blank string" }` |
| 3 | newest `model_change` has a non-string or blank `modelId` | `{ kind: "invalid", reason: "model change model id must be a non-blank string" }` |
| 4 | valid model and a record entry with `type === "thinking_level_change"` exists whose `thinkingLevel` is a non-blank string | `{ kind: "selection", model, thinkingLevel }` |
| 5 | valid model and a `thinking_level_change` entry exists whose `thinkingLevel` is missing, non-string, or blank | `{ kind: "invalid", reason: "thinking level must be a non-blank string" }` |
| 6 | valid model and no `thinking_level_change` entry | `{ kind: "selection", model }` (no `thinkingLevel` key) |

Additional exact properties:

- The newest entry of each kind is chosen independently: a `thinking_level_change` older than the
  newest `model_change` still supplies the level, and vice versa.
- Non-record entries (`null`, strings, arrays, numbers) and records with other `type` values are
  ignored. A `{ type: "custom", customType: "pi.virtual-model-state" }` entry is ignored.
- Extra keys on a matching entry are ignored; values are not trimmed.
- Precedence: rule 1 before rules 2–6 (so a thinking-only transcript with a malformed newest thinking
  entry returns `none`, not `invalid`), and rules 2–3 before the thinking rules.

### 3.3 Planner input contract

- `selection` is exactly the reader's result.
- `persistedPolicy` is `readPersistedSessionModelPolicy` on the same entry list.
- `resolvedModel` is present only when the selection was a `selection` and the service bound it after
  `createServices`: `{ provider, id, thinkingLevels }` where `id` equals Pi's model id and
  `thinkingLevels` is `runtimeThinkingLevels(model)` for the bound model.
- `existingBlock` is the service's current runtime block for this session id, or absent.
- The planner is total: every input produces a plan; it never throws.

### 3.4 Planner verdict table — executable rules

Reference implementation:

```ts
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
  resolvedModel: { provider: string; id: string; thinkingLevels: readonly string[] } | undefined
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
```

Verdicts, evaluated only when the caller supplied neither explicit value (the service short-circuits
`selection.kind === "none"` before calling the planner; the planner still implements the row):

| Selection | Newest persisted policy | Plan | Block effect |
| --- | --- | --- | --- |
| `none` | any | `{ kind: "none" }` | preserve the existing block untouched |
| `invalid` | any | `block`; cause = existing `runtime-tuple-unproven` when present, otherwise `selection-unavailable`; reason = existing reason when preserving, otherwise the reader's reason | arm/replace as described in §5.6 |
| `selection`, unbindable (`resolvedModel` absent or mismatched, or a recorded level not in `thinkingLevels`) | any | `block`; cause = existing `runtime-tuple-unproven` when present, otherwise `selection-unavailable`; reason = existing reason when preserving, otherwise `the newest recorded model … is unavailable in this session's catalog` or `the newest recorded thinking level … is unsupported by …` | arm/replace as described in §5.6 |
| `selection`, binds | `none` (legacy) | `apply` with model (+ thinking when recorded) | `clearSelectionUnavailable = true` only when the existing cause is `selection-unavailable`; an existing `runtime-tuple-unproven` is kept |
| `selection`, binds | `invalid` entry | `apply` with model (+ thinking when recorded) | same as the previous row; the entry-invalid reason still blocks via the service's entry-reason map |
| `selection`, binds | `persisted`, `mode: "tiered"` | `apply` (tiered policy is not comparable) | same as the legacy row |
| `selection`, binds | `persisted`, `mode: "exact"`, equal | `apply` | same as the legacy row |
| `selection`, binds | `persisted`, `mode: "exact"`, different | `block`; cause `runtime-tuple-unproven`; reason = the disagreement reason, unless an existing `runtime-tuple-unproven` is preserved | keep/arm `runtime-tuple-unproven` |

Exact-equality rules:

- Provider and id are always compared.
- The thinking level is compared only when the selection records one (`selection.thinkingLevel !==
  undefined`); a selection with no recorded level agrees with any persisted Exact thinking level.
- A persisted `tiered` policy and a persisted `invalid` entry never compare their `exact`/fallback.
- A persisted `none` (legacy) is non-comparable and applies.

Reason strings (specification-level choices; see §12):

- unavailable model: `` `the newest recorded model ${provider}/${id} is unavailable in this session's catalog` ``
- unsupported thinking level: `` `the newest recorded thinking level ${level} is unsupported by ${provider}/${id}` ``
- disagreement: `` `the newest recorded model selection ${describeRecorded(selection)} disagrees with the persisted Exact policy ${describeExact(exact)}; apply an explicit session model policy update to repair the session` ``
  where `describeRecorded` is `${provider}/${id}` plus ` at thinking level ${level}` when a level is
  recorded, and `describeExact` is the same format with `exact.thinkingLevel` always present.
- The reader's `invalid` reason is used verbatim as the `selection-unavailable` reason (or the
  existing `runtime-tuple-unproven` reason is preserved).

### 3.5 `src/server/sessions/sessionModelPolicy.ts` — fallback-free split

Add the new union and reader beside the existing exports:

```ts
export type PersistedSessionModelPolicyInspection =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "persisted"; policy: SessionModelPolicy };

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
```

Replace the existing `inspectSessionModelPolicy` body with a wrapper:

```ts
export function inspectSessionModelPolicy(
  entries: readonly unknown[],
  fallback: ExactModelSelection
): SessionModelPolicyInspection {
  const inspection = readPersistedSessionModelPolicy(entries);
  if (inspection.kind === "persisted") return inspection;
  if (inspection.kind === "invalid") {
    return { kind: "invalid", reason: inspection.reason, fallback: exactPolicy(fallback) };
  }
  return { kind: "legacy", policy: exactPolicy(fallback) };
}
```

`SessionModelPolicyInspection` keeps its existing export (`piSessionService.ts` and
`rememberCurrentModelPolicy.ts` import it); `exactPolicy`, `isPolicyEntry`, and `parsePolicyData` stay
module-private. No message or parse rule changes. All three production callers of
`inspectSessionModelPolicy` keep their existing behavior by construction.

---

## 4. Policy authority in `PiSessionService`

### 4.1 Helper rename and call sites

Imports added to `src/server/sessions/piSessionService.ts`:

```ts
import {
  inspectSessionRuntimeSelection,
  planSessionRuntimeRestore,
  type SessionRuntimeBlockCause,
} from "./sessionRuntimeRestore.js";
```

and `readPersistedSessionModelPolicy` is added to the existing value-import list from
`./sessionModelPolicy.js`.

Rename the private helper (`src/server/sessions/piSessionService.ts`):

```ts
private sessionTranscriptEntries(session: PiAgentSession): readonly unknown[] {
  return session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch();
}
```

Call sites, all updated to the new name and semantics:

| Current site | Change |
| --- | --- |
| `inspectAndCacheSessionModelPolicy` (`inspectSessionModelPolicy(this.policyEntries(session), …)`) | `this.sessionTranscriptEntries(session)` |
| `appendSessionCreationSource` (`inspectSessionCreationSource(this.policyEntries(session))`) | `this.sessionTranscriptEntries(session)`; the just-appended entry is the newest entry in append order, so acceptance/rejection is unchanged |
| `confirmedPolicySnapshot` | see §4.2 |

Consequences:

- Every consumer of the cached inspection — status publication (`modelPolicyStatusFromSession`), prompt
  gating (`assertPromptModelPolicyAllowed`), the direct Exact guard
  (`assertExactModelPolicyMutationAllowed`), the `get_model_policy` capability
  (`modelPolicyCapability`), complete-policy verification (`verifyPersistedSessionModelPolicy`), and
  `setModelPolicy`'s current-policy read — now sees the session-level policy.
- Because navigation no longer changes the inspection, a cached inspection stays valid across
  navigation and is refreshed by the existing mutation paths, runtime binding, and reopen. A route
  that forces a fresh read (`modelPolicy()`, `assertPromptModelPolicyAllowed`) re-reads append order.

### 4.2 `confirmedPolicySnapshot`

Replace the two reads with one append-order list for both the model policy and creation provenance:

```ts
const manager = persisted ? this.sessionManager.open(sessionFile) : session.sessionManager;
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
```

`commitAndVerifyInitialSessionEntries` already uses
`reopened.getEntries?.() ?? reopened.getBranch()` and keeps calling `inspectSessionModelPolicy` with its
expected policy; no change.

---

## 5. Runtime restore hook

### 5.1 `SessionRuntimeRestore` interface

Declared and exported from `src/server/sessions/piSessionService.ts` (it uses file-local `AgentModel`,
`ClientThinkingLevel`, and `PiSessionManager`):

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

### 5.2 `createDefaultRuntimeFactory` signature and parameter placement

Current signature (verified at `248afaa`):

```ts
export function createDefaultRuntimeFactory(
  modelRuntime: ModelRuntime,
  sessionManagers: Pick<PiSessionManagerGateway, "open">,
  utilityModelResolver: UtilityModelResolver<AgentModel>,
  logger: PiSessionLogger,
  spawn?: SpawnSessionFn,
  subsessions?: SubsessionToolDeps,
  modelPolicy?: ModelPolicyToolDeps,
  modelRateLimitOwner?: ModelRateLimitOwner,
  sdk: PiWebUiAgentSessionSdk = { createServices: createAgentSessionServices, createFromServices: createAgentSessionFromServices }
): PiWebUiCreateAgentSessionRuntimeFactory
```

The optional restore dependency is inserted between `modelRateLimitOwner` and `sdk`:

```ts
  modelRateLimitOwner?: ModelRateLimitOwner,
  restore?: SessionRuntimeRestore,
  sdk: PiWebUiAgentSessionSdk = { … }
```

Required call-site updates (only these three test call sites exist besides the production constructor):

| File | Current tail | New tail |
| --- | --- | --- |
| `src/server/sessions/piSessionService.rateLimits.test.ts` (two calls: the `makeFactory` helper and the rate-limit test) | `owner, { createServices, createFromServices }` | `owner, undefined, { createServices, createFromServices }` |
| `src/server/sessions/piSessionService.promptQueue.test.ts` (one call) | `undefined, undefined, undefined, undefined, { createServices, createFromServices }` | `undefined, undefined, undefined, undefined, undefined, { createServices, createFromServices }` |

The production constructor in `PiSessionService` passes the service's restore adapter as the ninth
argument (before the defaulted `sdk`):

```ts
this.createRuntime =
  deps.createRuntime ??
  createDefaultRuntimeFactory(
    this.modelRuntime,
    this.sessionManager,
    this.utilityModelResolver,
    this.logger,
    /* spawn */ …,
    /* subsessions */ …,
    /* modelPolicy */ …,
    deps.modelRateLimitOwner,
    { prepare: (input) => this.prepareSessionRuntimeRestore(input) }
  );
```

### 5.3 Factory body

Between `const customTools = …` and the `sdk.createFromServices` call, insert exactly:

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

Properties:

- The hook is awaited after `sdk.createServices` resolves (so extension
  `pendingProviderRegistrations`, `pendingNativeProviderRegistrations`, and
  `pendingVirtualModelRegistrations` are registered and the runtime refreshed) and before
  `createFromServices` (so the result reaches Pi construction).
- `initialModel ?? derived?.model` and `initialThinkingLevel ?? derived?.thinkingLevel` mean a
  caller-provided value is never mixed with a derived one. The service's `prepare` returns `{}` under
  an explicit value (§5.4), so suppression happens in one place.
- `restore === undefined` disables the hook entirely (non-policy factory uses, including the updated
  test call sites).
- The hook receives the per-invocation `sessionManager`, so fork/clone/`switchSession` replacements
  derive the copied branch's selection; a forked file contains only the copied branch, so this is the
  same branch-point tuple Pi would have restored and their behavior is unchanged.

### 5.4 `PiSessionService.prepareSessionRuntimeRestore`

```ts
private async prepareSessionRuntimeRestore(input: {
  sessionId: string;
  sessionManager: PiSessionManager;
  modelRuntime: ModelRuntime;
  explicitModel?: AgentModel;
  explicitThinkingLevel?: ClientThinkingLevel;
}): Promise<{ model?: AgentModel; thinkingLevel?: ClientThinkingLevel }>;
```

Exact sequence (this method implements `SessionRuntimeRestore.prepare`):

1. **Explicit suppression.** If `input.explicitModel !== undefined ||
   input.explicitThinkingLevel !== undefined`, return `{}`. No transcript read, no catalog read, no
   block change. (This is the "a caller-provided pair is never mixed with a derived one" guarantee;
   the factory's `??` merge is the second layer.)
2. **Transcript read.**
   ```ts
   const entries =
     input.sessionManager.getEntries?.() ?? input.sessionManager.getBranch();
   const selection = inspectSessionRuntimeSelection(entries);
   ```
3. **No selection.** If `selection.kind === "none"`, return `{}` without calling the planner (the
   `none` verdict is constant; the planner still implements it for pure tests). No catalog read.
4. **Persisted policy.** `const persistedPolicy = readPersistedSessionModelPolicy(entries);`
5. **Catalog resolution, only for a derived selection.**
   ```ts
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
   ```
6. **Block read point.** Immediately before the synchronous planner call:
   ```ts
   const existingBlock = this.modelPolicyRuntimeBlocks.get(input.sessionId);
   const plan = planSessionRuntimeRestore({
     selection,
     persistedPolicy,
     ...(resolvedModel === undefined ? {} : { resolvedModel }),
     ...(existingBlock === undefined ? {} : { existingBlock }),
   });
   ```
   This read is after the awaited catalog resolution, so a policy transition that fails during the
   resolution cannot be missed.
7. **Apply the verdict.**
   ```ts
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
   ```
   An `apply` plan implies a bound selection, so `boundModel` is defined; the check turns that
   planner-contract invariant into a visible programming error (which fails the open, as stated
   below) instead of silently opening on Pi's unproven branch tuple, and it narrows `boundModel` for
   the return type. The `isKnownThinkingLevel` narrowing cannot fail because `plan.thinkingLevel`
   always comes from `resolvedModel.thinkingLevels`, which is `runtimeThinkingLevels(model)`.

Never fails the open for a restore reason: the only awaited operation that can reject is the catalog
refresh, handled by §5.5's resolver; an unexpected programming error anywhere in steps 2–7 still
propagates.

### 5.5 Catalog resolution

Private helper used by step 5:

```ts
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

Contract:

- Resolve first; one `allowNetwork: false` refresh only on a miss or a missing auth answer
  (`hasConfiguredAuth(model.provider) === false`), then re-resolve.
- A virtual provider with no physical models is marked configured by Pi's `registerVirtualModel`, so a
  loaded virtual model resolves; an unloaded virtual model does not and blocks with the availability
  reason.
- A refresh rejection is logged and treated as unbindable (blocked, open still succeeds). This is the
  only caught error; sync catalog calls cannot throw.
- No session-scoped model list is consulted. The factory has no `scopedModels` before
  `createFromServices`, and the factory passes none to Pi, so `modelRuntime` is the same authority Pi's
  own branch restore uses (`getModel` + `hasConfiguredAuth`).

### 5.6 Block state, arm/clear/preserve semantics, and lifetimes

Map type (module-scope interface in `piSessionService.ts`):

```ts
interface ModelPolicyRuntimeBlock {
  cause: SessionRuntimeBlockCause;
  reason: string;
}

private readonly modelPolicyRuntimeBlocks = new Map<string, ModelPolicyRuntimeBlock>();
```

`modelPolicyBlockedReason` formats the runtime-block reason with the `MODEL_POLICY_BLOCKED: ` prefix in
one place; the invalid-entry fallback is returned unprefixed, exactly as today:

```ts
/** Effective block: an unproven runtime restoration outranks an entry defect. */
private modelPolicyBlockedReason(session: PiAgentSession): string | undefined {
  const block = this.modelPolicyRuntimeBlocks.get(session.sessionId);
  if (block !== undefined) return `MODEL_POLICY_BLOCKED: ${block.reason}`;
  return this.modelPolicyEntryReasons.get(session);
}
```

The two pre-existing set sites store `{ cause: "runtime-tuple-unproven", reason: … }` with the same
detail text they use today (no `MODEL_POLICY_BLOCKED: ` prefix):

```ts
this.modelPolicyRuntimeBlocks.set(session.sessionId, {
  cause: "runtime-tuple-unproven",
  reason: `${reason}; the previous model and thinking pair could not be restored`,
});
```

The two guard messages keep their current text by formatting the prefix at the throw site:

- `assertExactModelPolicyMutationAllowed`:
  `throw new Error(\`Cannot ${action}: MODEL_POLICY_BLOCKED: ${runtimeBlock.reason}\`)`
- `assertPromptModelPolicyAllowed`:
  `throw new Error(\`Cannot send a prompt: MODEL_POLICY_BLOCKED: ${runtimeBlock.reason}\`)`

The invalid-entry branches of both guards keep their existing messages unchanged. The clear sites are
unchanged: `this.modelPolicyRuntimeBlocks.delete(session.sessionId)` on a successful
`applySessionModelPolicy`, and `this.modelPolicyRuntimeBlocks.clear()` in disposal. The restore hook
adds exactly one narrow clear path: the `apply` verdict's `selection-unavailable` clear.

Arm/clear/preserve matrix (what `prepare` does to the map):

| Existing cause | Plan | Resulting map entry |
| --- | --- | --- |
| absent | `none` | unchanged (absent) |
| `selection-unavailable` | `none` | unchanged |
| `runtime-tuple-unproven` | `none` | unchanged |
| absent | `block` `selection-unavailable` | `{ cause: "selection-unavailable", reason: <plan reason> }` |
| `selection-unavailable` | `block` `selection-unavailable` | replaced with the current reason (a stale "unavailable" message cannot outlive the selection) |
| `runtime-tuple-unproven` | any `block` | preserved verbatim: same cause and same existing reason |
| absent | `block` `runtime-tuple-unproven` (disagreement) | `{ cause: "runtime-tuple-unproven", reason: <disagreement reason> }` |
| `selection-unavailable` | `block` `runtime-tuple-unproven` | replaced with `runtime-tuple-unproven` and the disagreement reason |
| any other (forward-compatible) cause | `block` | replaced with the plan's `{ cause, reason }` (the current verdict wins) |
| `selection-unavailable` | `apply` | cleared |
| `runtime-tuple-unproven` | `apply` | preserved verbatim |
| absent | `apply` | unchanged (absent) |
| any other (forward-compatible) cause | `apply` | preserved (only `selection-unavailable` is cleared) |
| any other (forward-compatible) cause | `none` | unchanged |

Lifetimes and rationale:

- **`selection-unavailable`** is armed by an open when the recorded selection cannot be bound
  (reader `invalid`, model unavailable, unsupported level). Each later open re-evaluates its own
  cause; an `apply` verdict clears it. Adding credentials or re-enabling the providing extension and
  then reopening the session (Reload session) is therefore a real recovery path. `/login` alone only
  refreshes the catalog and does not touch the block.
- **`runtime-tuple-unproven`** is armed by a failed policy transition that could not restore the
  previous tuple (existing behavior) or by the disagreement verdict. No open clears or overwrites it:
  a fresh runtime never proves the tuple was repaired. Only a successful `applySessionModelPolicy` or
  disposal removes it. This preserves the existing guarantee: after a failed transition the newest
  `model_change` is the failed target while the persisted policy is the previous one, so the
  disagreement verdict blocks until the explicit repair. A Tiered transition whose restore failed and
  whose in-memory block was lost to a daemon restart is still not re-detected at open (the applied
  tier model is not persisted); the fix does not widen that pre-existing gap, nor the equivalent gap
  for a legacy transcript with no policy entry.
- The map is keyed by session id, so the block survives runtime rebind, reload, and close/reopen. A
  fork/clone gets a new session id through its per-invocation `sessionManager`, and its copied
  transcript can arm the new session's own block; the old session's block is not transferred.

### 5.7 Published status and `resolved` behavior

- `modelPolicyStatusFromSession` is unchanged: outside a transition, `resolved` is
  `exactSelectionFromSession(session)` (the live tuple), and inside a transition it is the last
  confirmed tuple. After a restore, the live tuple is the derived one.
- `blockedReason` is `modelPolicyBlockedReason(session)`: the `MODEL_POLICY_BLOCKED: `-prefixed runtime
  block, else the invalid-entry reason, else absent.
- The disagreement row passes nothing to `createFromServices`, so that runtime intentionally comes up
  on Pi's branch-restore tuple rather than asserting an unproven one. `resolved` still reports the
  live tuple, and `blockedReason` names the recorded selection and the disagreement.
- Pi may still append its own initial entries during construction: a thinking entry when the
  conversation's active branch has no thinking entry, and a model + thinking pair for a message-less
  transcript. When a selection was derived and passed, those appends carry the derived values, so the
  durable selection is unchanged; the fix adds no writes.

---

## 6. Automatic-turn gating

`deliverSubsessionNotification` currently calls
`session.sendCustomMessage(..., { triggerTurn: true, deliverAs: "followUp" })` without the prompt gate.
It becomes:

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

Exact properties:

- Both reads are non-throwing and are computed immediately before the send inside the same guarded
  step (mirroring `submitPrompt`, which combines the mutation check and
  `assertPromptModelPolicyAllowed`).
- When blocked or mid-transition, the notification is still delivered and displayed with its existing
  `deliverAs: "followUp"`; only `triggerTurn` flips to `false`, so it stays visible without starting a
  run on a blocked or half-applied tuple.
- `notifyParentOfSubsession`'s existing tree-navigation deferral is unchanged.
- The other automatic model-consuming paths the design lists as user-initiated (`/compact`, tree
  navigation with summarization) are not gated.

---

## 7. Error handling and repairability

| # | Condition | Behavior |
| --- | --- | --- |
| 1 | Unbindable recorded model at open | The open succeeds; the runtime may come up on Pi's branch restore; the block is `selection-unavailable` with a reason naming the recorded model; `prompt()`/`submitPrompt` refuse through the existing `assertPromptModelPolicyAllowed` path; `blockedReason` is published with the `MODEL_POLICY_BLOCKED: ` prefix. |
| 2 | Recorded thinking level unsupported by the bound model at open | Same as row 1 with the unsupported-level reason. |
| 3 | Reader `invalid` (malformed newest entry) at open | Block `selection-unavailable` with the reader's reason (unless an existing `runtime-tuple-unproven` is preserved). The existing fail-closed refusal now applies to the whole session instead of only the branch containing the entry. Repair is the same explicit policy update. |
| 4 | Credentials added / extension re-enabled, then Reload session | The next open re-resolves, the verdict becomes `apply`, `selection-unavailable` is cleared, and prompts proceed. |
| 5 | Persisted-policy disagreement | Block `runtime-tuple-unproven` with the disagreement reason; stays blocked across opens until an explicit `setModelPolicy` succeeds (which clears the block and appends the new policy). |
| 6 | Failed policy transition whose previous tuple could not be restored | Existing `runtime-tuple-unproven` behavior; the block survives close/reopen and rebind and is repaired by an explicit policy application. |
| 7 | Catalog refresh rejection during restore resolution | Logged (`session runtime restore model refresh failed`); treated as unbindable; the open still succeeds with a `selection-unavailable` block. |
| 8 | Any unexpected programming error in `prepare` | Propagates and fails the open (no catch-all). |
| 9 | Malformed newest policy entry | Existing `inspectAndCacheSessionModelPolicy` behavior: the published policy is omitted from `SessionModelPolicyResponse`, the entry reason blocks prompts, and only an explicit policy update repairs it. |
| 10 | Broken Tiered ladder | No ladder resolution at open; the runtime comes up on the last applied tuple, `ladderValid` is unchanged, and tier re-application stays the explicit repair path. |
| 11 | Archived session | The same derivation runs; the session stays read-only and the block only affects the published reason. |
| 12 | Transcript with no recorded model | No override; Pi's branch restore stays in charge; any existing block is preserved. |
| 13 | Out-of-band Pi `setModel` (extension) or Pi's `_recordSelection` virtual append | The newest `model_change` can disagree with the persisted Exact policy; the disagreement verdict then blocks until an explicit policy update. This is the intended fail-visible consequence, not silent adoption. A virtual `_recordSelection` append that matches the persisted policy does not arm anything. |

---

## 8. Behavior comparison

| Scenario | Today | After |
| --- | --- | --- |
| Edit from here, then send | Policy/UI revert to the old model; the live tuple still runs the new one until a rebuild | Policy, UI, and live tuple all keep the session's current model |
| Reopen after Edit from here | Pi restores the original dialogue's model | The session's newest recorded model is restored |
| Reopen after changing only thinking | Restores the branch's model/thinking | Restores the newest recorded model/thinking |
| Change thinking after an edit | Draft carries the old branch's model; applying changes the model back | Draft carries the session's current model |
| New session / fork / clone | Inherits the branch-point policy | Unchanged |
| Transcript with no recorded model | Pi's branch restore | Unchanged |
| Recorded model unavailable | Pi silently substitutes | Visible `MODEL_POLICY_BLOCKED` reason; prompts refused until repaired or credentials return |
| Recorded thinking level unsupported | Pi silently clamps | Visible reason; prompts refused until repaired |
| Tier mapping changed while closed | Pi restores the last applied model | Unchanged |
| Ambiguous tuple after a failed transition | Block survives reopen | Unchanged |
| Subsession completion on a blocked session | Triggers a run on the ambiguous tuple | Delivered without a run until repaired |

---

## 9. Test specification

Tests are written RED-first at the smallest layer that proves each contract, per
`.agents/skills/testing-guide/SKILL.md`. Run commands from the repository root. No test in this
section asserts internals of `PiSessionService` that are not already observable through the service.

### 9.1 New test files

| File | Layer | What it proves |
| --- | --- | --- |
| `src/server/sessions/sessionRuntimeRestore.test.ts` | pure | Reader precedence/validation and the full planner verdict matrix (no service, no SDK) |
| `src/server/sessions/sessionRuntimeRestore.factory.test.ts` | fake SDK | `createDefaultRuntimeFactory` hook ordering, pass-through, explicit preference, extension visibility, hook error propagation |
| `src/server/sessions/sessionRuntimeRestore.integration.test.ts` | real SDK | Actual Pi construction: rewind → reopen restore, Pi's initial appends, virtual `_recordSelection`, refresh-rejection handling, block arm/clear/repair, navigation purity, fork and clone blocks |

### 9.2 Pure module tests — `sessionRuntimeRestore.test.ts`

Imports: `inspectSessionRuntimeSelection`, `planSessionRuntimeRestore`, and the exported types from
`./sessionRuntimeRestore.js`. Build planner inputs as object literals; do not import the service.

Reader fixtures:

```ts
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
```

Required reader rows (each is one `it` or one `it.each` row):

| Fixture | Expected |
| --- | --- |
| `[]` | `{ kind: "none" }` |
| `[modelChange("a", "m1")]` | `{ kind: "selection", model: { provider: "a", id: "m1" } }` (no `thinkingLevel` key) |
| `[modelChange("a", "m1"), modelChange("b", "m2")]` | `b/m2` (last wins) |
| `[modelChange("a", "m1"), userMessage("u1", null), modelChange("b", "m2"), userMessage("u2", "u1")]` | `b/m2` |
| the same entry list with `parentId` values forming a linear branch and a second list reordering `parentId` links while keeping append order | identical inspections (append-order characterization) |
| `[modelChange("a", "m1"), thinkingChange("high")]` | selection `a/m1` with `thinkingLevel: "high"` |
| `[thinkingChange("high"), modelChange("a", "m1")]` | selection `a/m1` with `thinkingLevel: "high"` |
| `[modelChange("a", "m1"), thinkingChange("low"), thinkingChange("high")]` | `thinkingLevel: "high"` |
| `[modelChange("a", "m1"), thinkingChange({})]`, `[…, thinkingChange("")]`, `[…, thinkingChange(3)]` | `{ kind: "invalid", reason: "thinking level must be a non-blank string" }` |
| `[thinkingChange({})]`, `[thinkingChange("")]` | `{ kind: "none" }` (no model change) |
| `[modelChange("a", "m1"), { type: "model_change", provider: "", modelId: "m2" }]` | `{ kind: "invalid", reason: "model change provider must be a non-blank string" }` |
| `[modelChange("a", "m1"), { type: "model_change", provider: "b" }]` | `{ kind: "invalid", reason: "model change model id must be a non-blank string" }` |
| `[modelChange("a", "m1"), { type: "model_change", provider: "b", modelId: " " }, modelChange("c", "m3")]` | invalid (the newest model change wins, even when an older valid one exists) |
| `[null, "x", 3, [], modelChange("a", "m1")]` | selection `a/m1` (non-records ignored) |
| `[modelChange("a", "m1"), { type: "custom", customType: "pi.virtual-model-state", data: {} }]` | selection `a/m1` (custom entries ignored) |

Planner fixtures (helpers):

```ts
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
```

Required planner rows (run each verdict row against `existingBlock` values `undefined`,
`{ cause: "selection-unavailable", reason: "old availability reason" }`, and
`{ cause: "runtime-tuple-unproven", reason: "old unproven reason" }`; assert the full plan object):

| Row | Input | Expected plan / block effect |
| --- | --- | --- |
| `none` preserves any block | `selection: { kind: "none" }`, any policy, any existing | `{ kind: "none" }` and no map change |
| `invalid` arms `selection-unavailable` | `{ kind: "invalid", reason: "bad entry" }`, no existing / existing selection-unavailable | `block`, cause `selection-unavailable`, reason `"bad entry"` (new reason replaces a stale one) |
| `invalid` preserves unproven | same, existing `runtime-tuple-unproven` | `block`, cause `runtime-tuple-unproven`, reason `"old unproven reason"` |
| unavailable model arms selection-unavailable | `recorded("a", "m1")`, `resolvedModel: undefined` | `block`, cause `selection-unavailable`, reason `the newest recorded model a/m1 is unavailable in this session's catalog` |
| mismatched resolved model is unbindable (defensive) | `recorded("a", "m1")`, `resolvedModel: bound("b", "m2", ["off"])` | same unavailable-model reason |
| unsupported recorded level arms selection-unavailable | `recorded("a", "m1", "xhigh")`, `resolvedModel: bound("a", "m1", ["off", "high"])` | `block`, reason `the newest recorded thinking level xhigh is unsupported by a/m1` |
| unbindable preserves unproven | any unbindable row with existing `runtime-tuple-unproven` | `block`, cause `runtime-tuple-unproven`, reason `"old unproven reason"` |
| legacy applies | `recorded("a", "m1", "high")`, `{ kind: "none" }`, bound with high | `{ kind: "apply", model: { provider: "a", id: "m1" }, thinkingLevel: "high", clearSelectionUnavailable: false }` |
| apply clears selection-unavailable | same, existing `selection-unavailable` | `clearSelectionUnavailable: true` |
| apply keeps unproven | same, existing `runtime-tuple-unproven` | `clearSelectionUnavailable: false` and the map is not touched |
| tiered applies | same selection, `policyTiered()` | `apply` (the remembered Exact tuple is not compared) |
| invalid entry applies | same selection, `{ kind: "invalid", reason: "bad entry" }` | `apply`; the service's entry reason still blocks prompts |
| exact equal applies | `recorded("a", "m1", "high")`, `policyExact("a", "m1", "high")` | `apply` |
| exact equal ignores an unrecorded level | `recorded("a", "m1")`, `policyExact("a", "m1", "medium")` | `apply` (thinking not compared) |
| exact different provider blocks | `recorded("a", "m1", "high")`, `policyExact("b", "m1", "high")` | `block`, cause `runtime-tuple-unproven`, reason contains `a/m1 at thinking level high` and `b/m1 at thinking level high` |
| exact different id blocks | `recorded("a", "m2", "high")`, `policyExact("a", "m1", "high")` | `block`, `runtime-tuple-unproven` |
| exact different level blocks | `recorded("a", "m1", "high")`, `policyExact("a", "m1", "medium")` | `block`, `runtime-tuple-unproven` |
| disagreement preserves unproven reason | any disagreement row with existing `runtime-tuple-unproven` | reason `"old unproven reason"` |
| disagreement after selection-unavailable upgrades | disagreement row with existing `selection-unavailable` | cause `runtime-tuple-unproven`, disagreement reason |

### 9.3 Fake-SDK factory tests — `sessionRuntimeRestore.factory.test.ts`

Harness: `createDefaultRuntimeFactory` directly with a fake SDK, `SessionManager.inMemory(process.cwd())`,
`sessionGateway([])`, a resolver stub, and `{ info: vi.fn() }`. `fakeAgentSessionServices()` supplies
the services; `fakeRuntime(...).session` supplies the `createFromServices` result (cast through
`Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]`, as the existing rate-limit
tests do). Pass `delegationToolsEnabled: false` to the factory invocation to avoid extra reads.

```ts
function factoryHarness(restore?: SessionRuntimeRestore) {
  const order: string[] = [];
  const services = fakeAgentSessionServices();
  const createServices = vi.fn<typeof createAgentSessionServices>(async () => {
    order.push("createServices");
    return services;
  });
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
    testModelRuntime,
    sessionGateway([]),
    { inspect: vi.fn(), configuredCandidates: vi.fn() },
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
```

Required tests:

| Test | Setup | Assertion |
| --- | --- | --- |
| plan values reach `createFromServices` | `restore.prepare` returns `{ model: restoredModel, thinkingLevel: "high" }` | `createFromServices` receives exactly `model: restoredModel` and `thinkingLevel: "high"`; `prepare` is called once with `{ sessionId: sessionManager.getSessionId(), sessionManager, modelRuntime: testModelRuntime }` |
| hook ordering | the spy `prepare` pushes `"prepare"` into `order` | `order` is `["createServices", "prepare", "createFromServices"]` |
| extension registration is visible to the hook | a dedicated `ModelRuntime` from `createTestModelRuntime()` (not the shared singleton, so the registration cannot leak into sibling tests); `createServices` calls `modelRuntime.registerVirtualModel({ provider: "ext-virtual", id: "virtual-1", name: "Virtual One", thinkingLevels: ["off"], route: () => { throw new Error("route is not exercised"); } })`; `prepare` resolves `modelRuntime.getModel("ext-virtual", "virtual-1")` and returns it | `createFromServices` receives the virtual model (proves the factory hands `prepare` the post-`createServices` runtime) |
| explicit values are passed through and never overridden | `restore.prepare` returns `{ model: derivedModel, thinkingLevel: "high" }`; factory called with `initialModel: explicitModel`, `initialThinkingLevel: "low"` | `createFromServices` receives exactly `explicitModel` and `"low"` (the derived values never win or mix); `prepare` received `explicitModel` and `explicitThinkingLevel: "low"`, proving the suppression inputs reach the hook |
| a rejecting `prepare` fails the open | `restore.prepare` rejects with an error | `factory(...)` rejects with that error (the factory has no catch; the service's restore-reason catch lives inside `prepare` and is pinned by the real-prepare integration test in §9.4) |
| no restore dependency | factory called without `restore` | `createFromServices` receives no model/thinking and the hook is not consulted |

Two claims in the design's factory-test bullet are split for reachability. The factory test pins the
parameter contract (explicit inputs reach `prepare`; derived values never override explicit ones). The
service-level block behavior is pinned by the pure planner matrix (`none` preserves any block; apply
keeps `runtime-tuple-unproven`) plus the integration block-lifecycle tests in §9.4. The design's
refresh-failure claim is also split: a fake-SDK `prepare` stub only proves the factory propagates a
rejection, so the real restore-reason catch is pinned by the §9.4 refresh-rejection test. No public service
route reopens an existing session with an explicit `initialModel` — only new-session paths pass one —
so the service's explicit-suppression early return is exercised indirectly through the factory
contract and is called out in §12.

### 9.4 Real-SDK integration tests — `sessionRuntimeRestore.integration.test.ts`

Harness requirements:

- Temp `cwd`, `agentDir`, and session dir; `createPiSessionManagerGateway({ agentDir, env: { PI_WEBUI_AGENT_SESSION_DIR: sessionDir }, sessionDirEnvKeys: ["PI_WEBUI_AGENT_SESSION_DIR"] })`.
- A dedicated `ModelRuntime` from `createTestModelRuntime(credentials)` with
  `seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" })` for restore-success
  fixtures. Never use the shared unauthenticated `testModelRuntime` for a success fixture.
- **Durable first.** A runtime-default `service.start(cwd)` does not flush the transcript: Pi defers
  the file until a user or assistant message exists, so `created.path` may not exist yet.
  `gateway.open(created.path)` on a missing path creates a *new* session id (`_setSessionFile`'s
  else-branch calls `newSession()`), and `service.reload({ id: created.id, cwd })` then fails with
  "Session not found". Every fixture therefore starts durably with
  `service.start(cwd, { creationSource: "session-list-plus", initialModelPolicy: { mode: "exact", exact: oldSelection } })`;
  the complete-policy path calls the gateway's `commitInitialEntries`, so `created.path` holds the
  header with `created.id` before the fixture mutates it. Restore-success fixtures use the seeded
  runtime; the unavailable-model fixture also starts with the seeded runtime (the durable start needs
  a resolvable initial policy) and makes a catalog-present model from a *different* provider with no
  seeded credential the newest recorded selection.
- **Mutate through the SDK manager.** Transcript mutation happens through
  `gateway.open(created.path)`, narrowed to the SDK `SessionManager` with `instanceof` (as the
  existing real-`SessionManager` test does), because the narrow `PiSessionManager` interface does not
  declare `appendMessage`, `appendModelChange`, `appendThinkingLevelChange`, `branch`, or
  `resetLeaf` (`appendCustomEntry` is declared as optional, but the SDK-manager narrowing is still
  required for the other methods).
- **`branch()` is in-memory only.** It moves the fixture manager's leaf; it is never persisted. A
  reopen rebuilds the leaf as the last appended entry, so a fixture that only calls
  `manager.branch(...)` at the end changes nothing across `service.reload`. When a test needs Pi's
  branch restore to disagree with append order, the last appended entry must sit on the branch that
  records the old selection while a sibling branch holds the newer `model_change`/policy.
- **Read the reopened state, not the seed manager.** After `service.reload`, durable assertions
  re-open the file (`gateway.open(created.path)`) or read `service.status(ref)`; the fixture's seed
  manager does not observe the reopened runtime's appends (for example Pi's initial entries). Each
  test defines `const ref = { id: created.id, cwd }`.
- `PiSessionService` is constructed without a `createRuntime` injection, so the service's default
  factory (and therefore the restore hook) performs the real construction. Inject a stub
  `modelTierRegistry`, a stub `utilityModelResolver` (`inspect` returns
  `{ candidates: [], sessionModelOnly: false }` and `configuredCandidates` returns `[]`),
  `{ info: vi.fn() }` logger, and
  `heartbeatIntervalMs: 60_000`. Where a test needs the live reopened session object (the virtual
  `_recordSelection` test), inject a pass-through `createAgentRuntime` that mirrors
  `defaultCreateAgentRuntime` — `createAgentSessionRuntime` with a factory wrapper that applies the
  received `initialModel`/`initialThinkingLevel`/`delegationToolsEnabled` only to the first
  construction, then clears them — and records the returned runtime per session id before returning
  it. It must not substitute a fake session; the factory (and therefore the restore hook) is still the
  service's default, and replacement runtimes (fork/clone) resolve their own options.
- `oldSelection = { model: { provider: "anthropic", id: "claude-sonnet-4-5-20250929" }, thinkingLevel: "medium" }`
  and `newSelection = { model: { provider: "anthropic", id: "claude-opus-4-5-20251101" }, thinkingLevel: "high" }`
  (both support `high`; neither supports `xhigh`).

Required tests:

| Test | Fixture | Assertion |
| --- | --- | --- |
| rewind → reopen restores the newest recorded tuple | durable start with `oldSelection`; through the SDK manager: `const userEntryId = manager.appendMessage({ role: "user", content: "hello", timestamp: 1 })`; append `modelChange(oldSelection)`, `thinkingLevelChange("medium")`, keeping the thinking entry's id as `oldTipId`; `manager.branch(userEntryId)`; append `modelChange(newSelection)`, `thinkingLevelChange("high")`, and the matching policy `exact(newSelection)` as children of `userEntryId` (the sibling branch holds append order's newest selection); `manager.branch(oldTipId)`; append a final `pi-webui.note` entry on the old branch so the last durable entry records the old tuple; `service.reload(ref)` | `status.modelPolicy.resolved` equals `newSelection`; `status.model.provider`/`id` equal `newSelection.model`; `blockedReason` is `undefined`; re-opening the file after `reload` shows append order's newest `model_change` is still `newSelection.model` (the fix appended nothing). Without the hook, Pi's branch restore (reopen leaf = the final old-branch entry) produces `oldSelection`, so this single test falsifies branch-order derivation |
| Pi's message-less initial appends carry the derived values | durable message-less start with `oldSelection` (the complete-policy start writes no message entry), with the temp `agentDir` pinning a settings default model/thinking distinct from `newSelection`/`"high"`; then `gateway.open(created.path)` appends `modelChange(newSelection)`, `thinkingLevelChange("high")`, and the matching policy `exact(newSelection)`; `service.reload(ref)` | re-open the file after `reload`: its newest `model_change` and newest `thinking_level_change` equal `newSelection.model`/`"high"` and differ from the pinned default, because Pi's `else` branch appends `model_change(model)` and `thinking_level_change(thinkingLevel)` when `buildSessionContext().messages.length === 0`; without the hook Pi would append the pinned default tuple instead |
| Pi's thinking append on a branch without a thinking entry | durable start with `oldSelection`; through the SDK manager: `manager.resetLeaf()`; `const userEntryId = manager.appendMessage(user)` (a new root whose path excludes the initial root thinking entry); `manager.appendThinkingLevelChange("high")` as a child of `userEntryId`; `manager.branch(userEntryId)`; append `modelChange(newSelection)` and the matching policy `exact(newSelection)`; `service.reload(ref)` | after the open, re-open the file and walk `getBranch()` from its last entry: the newest `thinking_level_change` is `"high"` and `status.modelPolicy.resolved` is `newSelection`, so Pi's `if (hasExistingSession && !hasThinkingEntry) appendThinkingLevelChange(thinkingLevel)` path carried the derived level. `resetLeaf()` is required: a branch that still descends from the durable start's root thinking entry makes that Pi path unreachable |
| virtual `_recordSelection` append does not false-arm | dedicated seeded runtime; register `V = { provider: "ext-virtual", id: "virtual-1", name: "Virtual One" }` with `route` and `thinkingLevels: ["off"]` present (never exercised: `route: () => { throw new Error("route is not exercised"); }`) before construction; durable start with physical `P = oldSelection`; through the SDK manager: `const userEntryId = manager.appendMessage(user)`; `const pModelId = manager.appendModelChange(P.provider, P.id)`; `manager.branch(userEntryId)`; append `modelChange(V)`, `thinkingLevelChange("off")`, and the policy `exact(V, "off")` as siblings; `manager.branch(pModelId)`; append the assistant message whose `message.provider`/`message.model` name `P` so it is the last durable entry and append order's newest assistant response names `P`; `service.reload(ref)`; invoke `(runtime.session as unknown as { _recordSelection(): void })._recordSelection()` on the captured reopened runtime; `service.reload(ref)` again | after the first open `status.modelPolicy.resolved` is `V` and `blockedReason` is `undefined` (the reader used append order's newest `model_change`, not the branch/assistant response); re-opening the file shows `_recordSelection` appended `model_change(V)`; the second open still has `blockedReason` `undefined` and `resolved` `V`, so no `runtime-tuple-unproven` was armed |
| unavailable recorded model opens blocked and repairs on credentials | seeded runtime; durable start with `oldSelection`; through the SDK manager append `unavailableSelection = { model: { provider: "openai", id: "gpt-5.2" }, thinkingLevel: "high" }` (present in the catalog, but the credential store has no `openai` credential) with a matching policy; `service.reload(ref)` | open succeeds; `status.modelPolicy.blockedReason` matches `/^MODEL_POLICY_BLOCKED: /u` and contains `gpt-5.2`; `service.prompt(ref, "must not reach pi")` rejects with `/MODEL_POLICY_BLOCKED/u`; after `seedCredential(credentials, "openai", { type: "api_key", key: "sk-test-2" })` + `service.reload(ref)`, `blockedReason` is `undefined` and `resolved` equals `unavailableSelection` |
| catalog refresh rejection during restore resolution | durable transcript records a selection absent from the catalog (for example `{ provider: "ghost", id: "ghost-1" }`) with a matching policy; install a `refresh` spy after `service.start` so the reload's `createServices` refresh resolves and the restore resolver's refresh rejects (for example `mockResolvedValueOnce(undefined)` then `mockRejectedValueOnce(new Error("catalog offline"))`); `service.reload(ref)` | `service.reload` resolves; `status.modelPolicy.blockedReason` matches `/^MODEL_POLICY_BLOCKED: /u` and contains `ghost-1`; the logger's `info` was called with `session runtime restore model refresh failed` and the rejection message. This exercises the real `prepareSessionRuntimeRestore` catch; the fake-SDK factory test cannot |
| disagreement arms `runtime-tuple-unproven` and explicit repair clears it | seeded runtime; durable transcript's newest `model_change` is `newSelection` with a matching `thinking_level_change`, but the persisted policy is `oldSelection`; `service.reload(ref)` | `blockedReason` matches `/^MODEL_POLICY_BLOCKED: /u` and names both selections; `service.prompt(ref, "must not reach pi")` rejects with `/MODEL_POLICY_BLOCKED/u` (refused before Pi); after `service.setModelPolicy(ref, { mode: "exact", exact: newSelection })`, `blockedReason` is `undefined` and `status.modelPolicy.resolved` equals `newSelection` (no provider call is made) |
| disagreement survives another open | same fixture, `service.reload(ref)` twice | `blockedReason` remains `runtime-tuple-unproven` with the same reason; the second open does not clear or replace it |
| navigation is pure | durable start; capture `service.modelPolicy(ref)` plus the durable entry count; `service.editFromHere(ref, userEntryId)`; fresh `service.modelPolicy(ref)` | policy unchanged; `status.model`/`resolved` unchanged; `blockedReason` unchanged; the durable entry list gained no `model_change`, `thinking_level_change`, or `SESSION_MODEL_POLICY_CUSTOM_TYPE` entry |
| fork of a blocked session arms the new session's own block | disagreement-blocked session whose newest `model_change`/thinking and policy entry are appended **before** the user entry targeted by `forkFromHere` (fork copies only the path up to that entry, so the copied branch must contain the disagreement); `service.forkFromHere(ref, userEntryId)` | the returned new session's `status.modelPolicy.blockedReason` matches `/^MODEL_POLICY_BLOCKED: /u`; the original session's block is unchanged |
| clone of a blocked session arms the new session's own block | same disagreement-blocked fixture; `const result = await service.runCommand(ref, "/clone")` (Pi's clone forks at the current leaf) | the `done` result's `session` is a new session whose `status.modelPolicy.blockedReason` matches `/^MODEL_POLICY_BLOCKED: /u`; the original session id remains blocked |

Cleanup: dispose every harness (temp dirs removed in `afterEach`) and dispose each service.

### 9.5 Existing test and test-support updates

**`src/server/sessions/piSessionService.testSupport.ts`** — `fakeSessionManager` must alias
`getEntries` to the effective `getBranch` so durable-read tests can override them with distinct lists:

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

`rest` still lets a test pass `getEntries` to override the alias. Existing tests that patch
`getBranch` (for example `piSessionService.modelPolicy.test.ts`'s replacement-runtime test) keep
seeing that patched list from both readers.

**`src/server/sessions/piSessionService.modelPolicy.test.ts`**:

- Add a `durableEntries?: readonly unknown[]` option to `createModelPolicyHarness`: when provided,
  `getEntries = vi.fn(() => durableEntries)` while `getBranch = vi.fn(() => branch)`; return
  `getEntries` alongside `getBranch`.
- Add the service-level abandoned-branch test:
  `createModelPolicyHarness({ branch: [activePolicyEntry], durableEntries: [creationSourceEntry(), oldLegacyOrActiveEntry, abandonedPolicyEntry] })`.
  The fixture must include the valid `creationSourceEntry()` (with the existing `getSessionFile` and
  root-eligibility setup), because `rememberCurrentModelPolicy` throws "Only sessions created from
  SESSIONS + can be remembered" without it. `await harness.service.modelPolicy(ref())` and
  `rememberCurrentModelPolicy` report the **abandoned** (append-order newest) policy while `getBranch`
  returns the older active one. Reverting `sessionTranscriptEntries` to `getBranch()` must fail this
  test.
- Update the two `getBranch` call-count tests (the lifecycle-cache test's
  `branchReadsAfterCreate`/`+1` assertions and the remember-failure test's
  `branchReadsBeforeRemember`/`+1` assertions) to count `harness.getEntries`, because the policy read
  now goes through `getEntries`. Keep the `validate` call-count assertions unchanged.
- Invert the existing real-`SessionManager` test
  `"reopens durable root metadata and remembers the active policy after branch navigation"`
  (describe `"PiSessionService real SessionManager plus-root integration"`):
  - rename it to
    `"reopens durable root metadata and remembers the newest append-order policy after branch navigation"`;
  - keep the two direct `inspectSessionModelPolicy(manager.getEntries())` /
    `(manager.getBranch())` characterizations (`abandonedPolicy` and `activePolicy` respectively);
  - change `service.modelPolicy(...)` to resolve `{ policy: abandonedPolicy }`;
  - change `rememberCurrentModelPolicy(...)` to resolve `abandonedPolicy` and
    `preferenceStore.replace`'s last call to `(integrationCwd, { kind: "full", preference: abandonedPolicy })`.

**`src/server/sessions/sessionModelPolicy.test.ts`** — add direct `readPersistedSessionModelPolicy`
cases proving the fallback-free split: `[]` → `{ kind: "none" }`; a malformed newest
`pi-webui.model-policy` entry → `{ kind: "invalid", reason: <same reason as before> }`; a valid entry →
`{ kind: "persisted", policy }`; and `inspectSessionModelPolicy(entries, fallback)` on `none` /
`invalid` still includes `exactPolicy(fallback)` exactly as before.

**`src/server/sessions/piSessionService.spawnSubsession.test.ts`** — extend the existing
subsession-notification coverage (the test that currently asserts
`{ triggerTurn: true, deliverAs: "followUp" }`):

| Test | Setup | Assertion |
| --- | --- | --- |
| a blocked parent receives a notification without a turn | parent session blocked via an in-memory failed-transition fixture, or via an invalid newest policy entry followed by a forced fresh inspection (`await service.modelPolicy(ref)`) before the notification; the gate reads the cached `modelPolicyBlockedReason` and never re-inspects | `sendCustomMessage` options are `{ triggerTurn: false, deliverAs: "followUp" }`; the message is still delivered |
| a mid-transition parent receives a notification without a turn | re-seam in this file: `holdSetModelOnCall`/`releaseSetModel` belong to `createModelPolicyHarness` in `piSessionService.modelPolicy.test.ts`, which has no subsession plumbing. Instead replace the parent session's `setModel` with a deferred promise and start `service.setModel(ref, ...)` (populate the parent `scopedModels` so the target resolves) to hold a real policy mutation open, then let the child stop | same `triggerTurn: false` and delivery assertions; release the transition afterwards |

Existing block-lifetime tests keep their coverage with the typed map and need no assertion changes:
`"keeps an unproven runtime block after the session is closed and reopened"`,
`"repairs a reopened blocked session through an explicit policy application"`, and
`"keeps an unproven runtime block across a runtime rebind"` in
`piSessionService.modelPolicy.test.ts` observe only `status.modelPolicy.blockedReason` and prompt
refusals. The hook-level preserve/clear behavior they cannot reach (because they inject
`createAgentRuntime`) is covered by the planner matrix and the integration tests in §9.4.

### 9.6 Falsifiability

- Reverting `sessionTranscriptEntries` to `session.sessionManager.getBranch()` must fail the service
  abandoned-branch test, the inverted real-`SessionManager` test, and the rewind-reopen integration
  test (whose last durable entry records the old tuple while append order records the new one).
- Removing the factory restore hook (passing `undefined`) must fail the rewind-reopen integration test
  and the factory plan-value test.
- Removing the catalog-refresh catch in `resolveSessionRuntimeRestoreModel` (letting the rejection
  escape) must fail the refresh-rejection integration test.
- Clearing `runtime-tuple-unproven` at open must fail the disagreement-survives-another-open test.
- Removing the `selection-unavailable` clear must fail the credentials-return integration test.
- Reverting the notification gate to `triggerTurn: true` must fail the two automatic-turn tests.
- Ignoring thinking levels in the planner equality must fail the exact-different-level row.

---

## 10. Documentation and release

### 10.1 `docs/config.md` (per-session model policy section)

Insert one bullet after the existing `**Default and restoration:**` bullet:

```md
- **Session-level model selection:** The session's model selection is session-level: the newest model
  and thinking level recorded anywhere in the session transcript are authoritative, not only the
  entries on the active conversation branch. **Edit from here** and the session-tree navigator change
  which conversation is active, not which model the session uses, and they do not change the model
  policy the composer displays. When a session is reopened, PI WEBUI restores the newest recorded
  model and thinking level. A recorded model that is unavailable (for example a virtual model whose
  extension is not loaded) or a recorded thinking level the model does not support blocks prompts with
  a visible `MODEL_POLICY_BLOCKED` reason. The block clears on the next runtime open once the recorded
  selection resolves again and agrees with the persisted policy (for example after adding credentials
  or re-enabling the extension, then reopening the session), or immediately through an explicit policy
  update; if the newest recorded selection disagrees with the persisted Exact policy, the session
  stays blocked until that explicit update.
```

In the same section's `**Validation and recovery:**` bullet, disambiguate the starter-policy wording
(these are the only `branch` uses on the page that mean a mode):

- `until the user repairs that active branch` → `until the user repairs that active mode`
- `Intent remembered in the inactive branch is retained and non-blocking until that branch becomes
  active.` → `Intent remembered in the inactive Exact/Tiered mode is retained and non-blocking until
  that mode becomes active.`

### 10.2 `docs/config.html`

Apply the same bullet and the same two sentence replacements in the `#model-tiers` section, with
`<code>MODEL_POLICY_BLOCKED</code>` and `<strong>` markup mirroring the surrounding list. The claims
must be textually equivalent to `docs/config.md`. No TOC entry changes.

### 10.3 `CONTEXT.md`

- Extend `**Session model policy**` with:
  `It is session-level state: the newest policy entry in the session transcript is authoritative regardless of the active conversation branch, so tree navigation and Edit from here do not change it.`
- Add a new glossary entry after `**Session model policy**`:
  `**Session runtime selection**: The newest model and thinking level recorded in the session transcript, used to restore a session's runtime when it is reopened. It is read in append order and is independent of the active conversation branch; it is never inferred from assistant responses.`
- Change `**Remembered policy selection**` to:
  `A stored Exact selection or model tier that represents user intent and is validated when its Exact or Tiered mode branch is active. Temporary unavailability does not erase or replace it.`

### 10.4 Shared API comment

`src/shared/apiTypes.ts`, `ClientSessionModelPolicyStatus.resolved`:

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

### 10.5 Supersession note

`docs/superpowers/specs/2026-07-31-tiered-session-model-policy-and-deterministic-sdd-design.md`: add
immediately after the `**Supersedes:**` line:

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

Additionally append ` (Superseded in part 2026-10-13 — see the supersession note above.)` as a plain
sentence after each of the four named statements so a reader landing on one does not miss the note.
Where a named statement sits inside a fenced code block, add the marker after the enclosing block
rather than inside it.

### 10.6 Changeset

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

### 10.7 Restart communication

Per `AGENTS.md`, the implementation handoff and release notes must repeat: the fix is not complete
until `pi-webui-sessiond.service` is restarted once on each machine, because `piSessionService.ts`
and the new module are loaded only by the long-lived, non-autoreloading daemon. The web/API
autoreload path does not load them.

---

## 11. Implementation file list

### 11.1 New files

| File | Change |
| --- | --- |
| `src/server/sessions/sessionRuntimeRestore.ts` | reader, block-cause union, restore-plan union, planner (§3) |
| `src/server/sessions/sessionRuntimeRestore.test.ts` | pure reader/planner tests (§9.2) |
| `src/server/sessions/sessionRuntimeRestore.factory.test.ts` | fake-SDK factory tests (§9.3) |
| `src/server/sessions/sessionRuntimeRestore.integration.test.ts` | real-SDK integration tests (§9.4) |
| `.changeset/session-level-model-authority.md` | patch Changeset (§10.6) |

### 11.2 Modified production files

| File | Change |
| --- | --- |
| `src/server/sessions/sessionModelPolicy.ts` | `PersistedSessionModelPolicyInspection`, `readPersistedSessionModelPolicy`, wrapper `inspectSessionModelPolicy` |
| `src/server/sessions/piSessionService.ts` | helper rename; `confirmedPolicySnapshot`; `SessionRuntimeRestore`; factory parameter + hook; `prepareSessionRuntimeRestore`; resolution helpers; typed block map; reasons; automatic-turn gate |
| `src/shared/apiTypes.ts` | `resolved` doc comment |
| `CONTEXT.md` | session-level authority, session runtime selection, mode-branch clarification |
| `docs/config.md` | new session-level bullet + two sentence clarifications |
| `docs/config.html` | same, hand-synced |
| `docs/superpowers/specs/2026-07-31-tiered-session-model-policy-and-deterministic-sdd-design.md` | supersession note + four inline markers |

### 11.3 Modified test files

| File | Change |
| --- | --- |
| `src/server/sessions/piSessionService.testSupport.ts` | `fakeSessionManager` aliases `getEntries` to the effective `getBranch` |
| `src/server/sessions/sessionModelPolicy.test.ts` | direct `readPersistedSessionModelPolicy` cases + wrapper-equivalence assertions |
| `src/server/sessions/piSessionService.modelPolicy.test.ts` | `durableEntries` option + distinct-list test; `getEntries` call-count updates; inverted abandoned-branch integration test |
| `src/server/sessions/piSessionService.rateLimits.test.ts` | two `createDefaultRuntimeFactory` call sites gain `undefined` before the SDK seam |
| `src/server/sessions/piSessionService.promptQueue.test.ts` | one `createDefaultRuntimeFactory` call site gains `undefined` before the SDK seam |
| `src/server/sessions/piSessionService.spawnSubsession.test.ts` | blocked/mid-transition notification `triggerTurn: false` tests |

No other file changes. In particular: no client change, no route change, no capability change, no
`sessiond.ts` change (the service is constructed the same way), and no `package.json`/config change.

---

## 12. Specification-level choices

The approved design leaves these details unstated; this specification fixes each one. None changes
the approved behavior.

1. **Reader `invalid` reason strings.** The design names the causes but not the text. This spec uses
   `model change provider must be a non-blank string`, `model change model id must be a non-blank
   string`, and `thinking level must be a non-blank string`, matching the repository's
   `nonBlankString` convention. Changing them is a copy change limited to
   `sessionRuntimeRestore.ts` and its tests.
2. **Planner availability/disagreement reason strings.** The design requires the reason to name the
   recorded selection and the disagreement. This spec fixes:
   `the newest recorded model ${provider}/${id} is unavailable in this session's catalog`,
   `the newest recorded thinking level ${level} is unsupported by ${provider}/${id}`, and
   `the newest recorded model selection ${recorded} disagrees with the persisted Exact policy
   ${persisted}; apply an explicit session model policy update to repair the session`. The published
   string is `MODEL_POLICY_BLOCKED: ` plus the plan reason.
3. **`clearSelectionUnavailable` semantics.** The design names the flag but not its computation. This
   spec defines it as `existingBlock?.cause === "selection-unavailable"`, making the service action
   exactly "delete the map entry when the apply plan says to". A forward-compatible unknown cause is
   never cleared by an open.
4. **Explicit-value suppression ownership.** The design's interface carries
   `explicitModel`/`explicitThinkingLevel` while also saying explicit values suppress derivation. This
   spec puts suppression in `PiSessionService.prepareSessionRuntimeRestore` (returns `{}`) and keeps
   the factory's merge as `initialModel ?? derived?.model` /
   `initialThinkingLevel ?? derived?.thinkingLevel`, so neither layer can mix a pair.
5. **The service's `prepare` method name.** The design says "PiSessionService implements prepare".
   This spec names the private method `prepareSessionRuntimeRestore` and passes the adapter
   `{ prepare: (input) => this.prepareSessionRuntimeRestore(input) }`. Renaming is a local change.
6. **Refresh-failure logging.** The design does not name a log. This spec logs
   `session runtime restore model refresh failed` with `{ sessionId, model, error }` before treating
   the model as unbindable.
7. **Harness mechanics.** `fakeSessionManager`'s `getEntries` alias, the `durableEntries` harness
   option, the factory-test stubs, the durable-start
   `service.start({ creationSource, initialModelPolicy })` fixture, the `gateway.open` SDK-manager
   narrowing, and the pass-through `createAgentRuntime` capture seam are test-only choices; any
   equivalent fixture that proves the same observable contracts (and, for an integration fixture,
   actually persists the seed transcript with `created.id` before mutating it) is acceptable.
8. **Documentation placement.** The exact bullet position (after `Default and restoration`) and the
   exact supersession-note wording are this spec's choices; the canonical requirements are the claims
   listed in §10.
9. **Explicit-suppression test reachability.** No public `PiSessionService` route reopens an existing
   session with an explicit `initialModel`/`initialThinkingLevel` (only the new-session spawn paths pass
   them), so `prepareSessionRuntimeRestore`'s early return is not directly reachable from a service-level
   test. The factory test pins the parameter contract, the planner matrix pins the block behavior, and
   the early return itself is a three-line branch verified by code review. An implementation may also
   assert it in a focused unit test of the service if a test seam is added without changing
   production behavior. The PM accepted this disclosed coverage limit for this release: the planner
   matrix and the integration block-lifecycle tests pin the observable block behavior it cannot reach.
