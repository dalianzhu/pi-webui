# Session-level model authority

**Date:** 2026-10-13
**Status:** Approved design (revised after four frontier design-review rounds)

## Problem

Clicking **Edit from here** on a message from an earlier dialogue silently changes which
model the session uses. The session reverts to the model that was selected at that point
in the conversation instead of keeping the model the user has active now.

### Confirmed mechanism

PI WEBUI persists a session's model selection as transcript entries: Pi's own
`model_change` / `thinking_level_change` entries, and PI WEBUI's
`pi-webui.model-policy` custom entry. Both are read from the **active session branch**:

- `piSessionService.policyEntries()` returns `session.sessionManager.getBranch()`.
- `inspectSessionModelPolicy(entries, fallback)` scans that list backwards and treats the
  newest matching entry as authoritative.
- Pi restores a resumed session's model from the branch too: `createAgentSession` calls
  `getBranchSelection(sessionManager.getBranch(), ...)`, and PI WEBUI creates runtimes for
  existing sessions without passing an explicit model.

**Edit from here** navigates with Pi's `navigateTree`, which for a user message sets the
leaf to that message's parent. Every entry appended after that message — including the
`model_change` and `pi-webui.model-policy` entries for the model the user is actually
running — stays on the abandoned branch. The active branch's newest model signal is then
the model of the original dialogue.

Reproduction with the real Pi `SessionManager` and the real `inspectSessionModelPolicy`:

```text
live session model (user's current selection): provB/modelB (high)
--- after "Edit from here" on a mid-dialogue user message ---
Pi branch restore value on next runtime open:  provA/modelA        <- original dialogue
PI WEBUI active-branch policy:                 exact provA/modelA (medium)
PI WEBUI append-order (durable) policy:        exact provB/modelB (high)
```

Three user-visible defects follow:

1. **Resume silently reverts the model.** Any runtime (re)open — session daemon restart, a
   session reopened from the session list, an archived session restored, or the
   **Reload session** action (`POST /sessions/:id/reload`), which closes and reopens the
   runtime — restores the model from the active branch, which is now the original
   dialogue's model. The `/reload` prompt command is not this path: it reloads resources in
   place through Pi's `AgentSession.reload()` and cannot change the model.
2. **The policy view disagrees with the runtime.** Immediately after navigation, Pi leaves
   `agent.state.model` alone, so the live tuple still runs the current model while the
   policy inspection already reports the abandoned branch's policy. The composer, the
   tier/mode controls, `assertPromptModelPolicyAllowed`, and "remember policy" all read the
   reverted policy.
3. **The next policy interaction writes the revert back.** `SessionController.selectSession`
   clears the held policy response on every selection (including the refresh after Edit
   from here), so the next model/thinking/mode interaction seeds its draft from the
   reverted policy and applies that draft. Changing only the thinking level therefore
   changes the model back to the original dialogue's model.

This contradicts the user's expectation, confirmed during design: **the session's model is
session-level state, not branch-level state.** A within-session branch change must not
change which model the session uses, and resume must honor the session-level model.

## Goals

- The session's model selection is a **session-level** property: the newest selection
  recorded anywhere in the transcript, independent of the active branch.
- Branch navigation (`Edit from here` and the session-tree navigator) must not change the
  session's model policy, the live runtime tuple, or the policy the composer displays, and
  must not itself append model, thinking, or policy entries.
- A runtime created for an existing transcript that records a model selection restores that
  selection instead of letting Pi's branch restore decide. Transcripts that record no model
  selection keep Pi's behavior (see Non-goals).
- An unresolvable *recorded* selection must fail visibly, not silently substitute another
  model or level.
- Sessions damaged by navigation alone recover their latest selection.
- Forks and clones keep inheriting the policy at their branch point.
- Reading model state stays a pure transcript read: the fix adds no writes of its own.

## Non-goals

- Changing fork/clone inheritance (a forked file contains only the copied branch, so the
  new session inherits the policy at its fork point, as today).
- Changing Pi's branch-based conversation context, extension entries, subsession links,
  compaction, or tree projection. Creation-source verification moves to append-order
  entries along with the rest of the transcript reads, but it validates the entry that was
  just appended, so its result is unchanged.
- Changing the tier ladder, Exact/Tiered transition rules, or the lightweight fallback.
- Adding client-side model state; the browser stays a consumer of the published policy.
- Changing how new root sessions or spawned/child sessions choose their model.
- Inferring the model from assistant responses. Model authority is the newest recorded
  `model_change` for **every** transcript. Pi's own branch restore also considers non-virtual
  assistant responses; that difference is intentional, because a response can name a
  different physical model than the recorded selection (virtual routing, reroute) while the
  selection remains the user's recorded choice.
- Gating the two user-initiated provider paths that a blocked session can still reach: a
  tree navigation with summarization (the branch summary runs on the configured lightweight
  utility model, falling back to the session model) and `/compact` (the configured Context
  utility, unless it is set to session-only). Both are explicit user actions, not automatic
  turns, and neither changes model authority.

## Domain model

Two session-level values are defined. Both are read from the transcript in **append
order**; branch membership never affects either.

**Session model policy** — the existing `pi-webui.model-policy` value:

```ts
interface SessionModelPolicy {
  mode: "exact" | "tiered";
  exact: ExactModelSelection; // model + thinking level
  tier?: ModelTier;
}
```

The newest matching custom entry **in the session transcript** is authoritative. This
replaces the active-branch lookup, which was correct for a fork's inherited starting point
but wrong for a within-session branch change. In Tiered mode `exact` is the *remembered*
Exact selection, not the applied model; the applied model is recorded only by
`model_change`.

**Session runtime selection** — the newest recorded model and thinking level, the durable
record used to restore a runtime:

```ts
type SessionRuntimeSelectionInspection =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "selection"; model: { provider: string; id: string }; thinkingLevel?: string };
```

It is derived from the newest `model_change` entry for the model and the newest
`thinking_level_change` entry for the thinking level, again in append order; it is not an
assistant-response inference. It is correct for both policy modes: an Exact selection writes
its model, and a Tiered application writes the tier's resolved model.

Precedence is explicit: no `model_change` entry at all means `none`, regardless of thinking
entries, because nothing is restorable without a model. `invalid` is returned only when a
`model_change` exists and the newest `model_change` or `thinking_level_change` is present but
unusable (missing, non-string, or blank `provider`/`modelId`/`thinkingLevel`). A recorded selection
wins over any inference, and a recorded selection on an abandoned branch still wins.

### Invariants

1. Append order defines "newest". Branch membership never changes either value.
2. The mutation paths write Pi's model/thinking entries and the policy entry together, so
   the two values agree at rest. In Tiered mode the applied model is owned by
   `model_change` alone; the policy's `exact` is the remembered Exact selection.
3. A runtime created for a transcript that records a selection restores that selection
   unless the caller supplied an explicit model or thinking level, the selection is
   unbindable, or the newest persisted policy disagrees with it (fail-visible block).
4. A runtime whose recorded selection cannot be bound refuses prompts with a visible reason.
   The runtime itself may still come up on Pi's branch-restore substitute; no provider is
   reached until the visible reason is repaired.
5. Navigation is a pure transcript read for model state: it must not change the policy, the
   runtime selection, or the live tuple.
6. A fork or clone inherits the selection recorded on the copied branch.

## Architecture

### Pure decision modules

Both model-state decisions are pure and table-testable, so the 7.5k-line service keeps only
wiring.

`src/server/sessions/sessionRuntimeRestore.ts`:

```ts
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

The reader validates defensively because transcript entries are parsed without full
validation. The planner receives the already-resolved model capability answer and the
session's current block cause from the service, so it owns the complete verdict — including
which cause survives — depends on no Pi or runtime types, and can be tested row by row
against the verdict table.

`src/server/sessions/sessionModelPolicy.ts` splits out a fallback-free read so no selection
needs to be invented:

```ts
export type PersistedSessionModelPolicyInspection =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "persisted"; policy: SessionModelPolicy };

export function readPersistedSessionModelPolicy(
  entries: readonly unknown[]
): PersistedSessionModelPolicyInspection;
```

The existing `inspectSessionModelPolicy(entries, fallback)` becomes a thin wrapper that maps
`none` to the legacy `exactPolicy(fallback)` result; all current callers keep their
behavior.

### Policy authority

`PiSessionService` reads authoritative transcript entries from the session transcript rather
than the active branch. The helper is renamed because it no longer returns "policy entries"
only:

```ts
private sessionTranscriptEntries(session: PiAgentSession): readonly unknown[] {
  return session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch();
}
```

- Every consumer of the policy inspection (status publication, prompt gating, direct model
  mutation guard, complete-policy verification, remember-policy snapshot) now sees the
  session-level policy.
- `confirmedPolicySnapshot` adjusts its remember-policy read to the same append-order
  entries it already uses for creation provenance.
- `appendSessionCreationSource` verification moves to the same helper.
- Because navigation no longer changes the inspection, the cached inspection stays valid
  across navigation and is refreshed by the existing mutation paths.

### Runtime restore

The restore runs inside `createDefaultRuntimeFactory`, the factory stored in Pi's
`AgentSessionRuntime` and reused for every runtime the factory constructs: PI WEBUI's opens
(normal, archived, deduped pending, the close/reopen in `reload()`) and Pi's replacement
methods (`fork`, `clone`, `switchSession`, `importFromJsonl`). This is the seam that makes
extension-provided and virtual models resolvable: `sdk.createServices(...)` registers
`pendingProviderRegistrations`, `pendingNativeProviderRegistrations`, and
`pendingVirtualModelRegistrations`, then refreshes the model runtime, so resolving a model
*before* `createServices` would wrongly judge an extension model unbindable on the first
open after a daemon restart.

`createDefaultRuntimeFactory` accepts an optional restore dependency and awaits it between
`createServices` and `createFromServices`:

```ts
interface SessionRuntimeRestore {
  prepare(input: {
    sessionId: string;
    sessionManager: PiSessionManager;
    modelRuntime: ModelRuntime;
    explicitModel?: AgentModel;
    explicitThinkingLevel?: ClientThinkingLevel;
  }): Promise<{ model?: AgentModel; thinkingLevel?: ClientThinkingLevel }>;
}
```

- `PiSessionService` implements `prepare` and passes it to the factory it constructs; the
  optional parameter is placed before the injectable `sdk` test seam, with the existing
  test call sites updated and non-policy uses left compiling.
- The factory passes the returned model/thinking (or the caller's explicit values) into
  `createFromServices`. An explicit `initialModel` or `initialThinkingLevel` suppresses the
  derivation entirely — a caller-provided pair is never mixed with a derived one — and does
  not arm or clear a block.
- Because the hook receives the per-invocation `sessionManager`, fork/clone replacements
  derive the copied branch's selection, which is exactly the branch-point value Pi would
  have restored, so their behavior is unchanged.
- `prepare` performs the catalog resolution (resolve, then one `allowNetwork: false`
  refresh on a miss or missing auth answer), calls the planner, applies the verdict, and
  never fails the open for restore reasons; an unexpected programming error still
  propagates.
- Tests that inject their own `createAgentRuntime` bypass the default factory. Verdicts are
  covered by pure planner tests, factory plumbing by the fake-SDK factory tests, and real
  Pi behavior by a real-SDK integration test.

Verdicts, evaluated only when the caller supplied neither explicit value:

| Selection | Newest persisted policy | Passed to the runtime | Block effect |
| --- | --- | --- | --- |
| `none` | any | nothing | preserve the existing block untouched |
| `invalid` | any | nothing | block: keep an existing `runtime-tuple-unproven`, otherwise `selection-unavailable` with the entry reason |
| selection, unbindable | any | nothing | block: keep an existing `runtime-tuple-unproven`, otherwise `selection-unavailable` with the availability reason |
| selection, binds | none/legacy, tiered, or exact equal | model + thinking | apply; clear a `selection-unavailable` block; keep `runtime-tuple-unproven` |
| selection, binds | persisted invalid entry | model + thinking | apply with the same block effect; the entry-invalid reason still blocks |
| selection, binds | persisted exact, different | nothing | block: keep an existing `runtime-tuple-unproven`, otherwise `runtime-tuple-unproven` with the disagreement reason |

Exact equality compares provider and id always, and thinking level only when the selection
records one.

Block causes distinguish what a later open may re-evaluate:

- `selection-unavailable` is armed by an open when the recorded selection cannot be bound.
  Each later open re-evaluates its own cause: an `apply` verdict clears it, so adding
  credentials or re-enabling an extension and then reopening the session (the Reload
  session action) is a real recovery path. `/login` alone only refreshes the catalog; it
  does not touch the block.
- `runtime-tuple-unproven` is armed by a failed policy transition that could not restore
  the previous tuple, or by the disagreement verdict. A fresh runtime never proves the tuple
  was repaired, so no open clears or overwrites this cause; only a successful
  `applySessionModelPolicy` or disposal removes it.
- Any other existing cause is replaced by the current verdict's cause and reason **when the
  verdict blocks**, so a stale "the model is unavailable" message cannot outlive the model
  becoming available; an `apply` verdict clears a `selection-unavailable` cause instead, and
  `none` leaves the block untouched.
- `existingBlock` is read after the awaited catalog resolution, immediately before the
  synchronous planner call and apply, so a policy transition failing during the resolution
  cannot be missed.
- The published reason keeps the `MODEL_POLICY_BLOCKED: ` prefix: the reader and planner
  supply the detail text, the service formats the published string, and a verdict test
  asserts the prefix.
- `modelPolicyRuntimeBlocks` stores `{ cause, reason }`; `modelPolicyBlockedReason` keeps
  returning the reason. The pre-existing clear sites remain the successful
  `applySessionModelPolicy` and disposal; the hook adds exactly one narrow clear path, the
  `apply` verdict's `selection-unavailable` clear.

The disagreement row passes nothing, so that runtime intentionally comes up on Pi's branch
restore rather than asserting an unproven tuple; the block governs prompts, and the
published `resolved` stays the live tuple with the blocked reason explaining it.

A Tiered transition whose restore failed and whose in-memory block was then lost to a daemon
restart is not re-detected at open, because the applied tier model is not persisted; the
runtime still comes up on the last applied tuple and the next explicit tier application
re-establishes a proven tuple. The same pre-existing gap applies to a legacy transcript with
no policy entry, where the failed target is the newest `model_change`. The fix does not
widen either gap.

An out-of-band Pi `setModel` (an extension calling the session API) or Pi's own
`_recordSelection` virtual append can leave the newest `model_change` disagreeing with the
persisted Exact policy; the disagreement verdict then blocks until an explicit policy
update. That is the intended fail-visible consequence, not a silent adoption of the
out-of-band selection.

Pi may still append its own initial entries during runtime construction: a thinking entry
when a conversation's active branch has no thinking entry, and a model + thinking pair for a
message-less transcript. Those appends carry the same values whenever a selection was
derived and passed, so the durable selection is unchanged; the design adds no writes.

### Automatic turns

A blocked session must not reach a provider through an automatic turn either.
`deliverSubsessionNotification` calls `session.sendCustomMessage(..., { triggerTurn: true })`
without the prompt gate. Immediately before the send, inside the same guarded step, it
computes the non-throwing pair `modelPolicyBlockedReason` (runtime block plus invalid-entry
reason) and `isModelPolicyMutationActive`, mirroring `submitPrompt`; when either is present
the notification is delivered with `triggerTurn: false` and its existing
`deliverAs: "followUp"`, so it stays visible without starting a run on a blocked or
half-applied tuple.

### Cost

- The reader's scan always runs (it is how the transcript is inspected); model resolution,
  catalog refresh, and the planner run only when a selection was derived.
- The catalog refresh is resolve-first and happens only when the model is missing or
  unauthenticated, not on every open.
- `assertPromptModelPolicyAllowed` keeps its current per-prompt re-inspection shape. The
  durable scan is O(transcript entries) with one array copy from `getEntries()`, versus the
  active branch's parent walk; the constant is higher when abandoned branches exist, and
  the correct caching answer is left to the implementation plan.

## Error handling

- **Unbindable recorded selection at open:** prompts are refused by the existing
  `assertPromptModelPolicyAllowed` path with the recorded reason. Adding credentials or
  re-enabling the providing extension and then reopening the session clears the
  `selection-unavailable` cause; a complete policy update via `setModelPolicy` resolves its
  own target, succeeds, and clears either cause. A persisted-policy disagreement keeps the
  session blocked with a disagreement reason until that explicit policy update. The block
  reason names the recorded selection, so a live tuple that differs from it (Pi's
  branch-restore fallback) is not mistaken for the recorded one.
- **Runtime block lifetime:** `runtime-tuple-unproven` is preserved across close/reopen and
  is never cleared merely because a new runtime exists. This keeps the existing guarantee
  for a failed policy transition: the newest `model_change` is the failed target while the
  persisted policy is the previous one, so the disagreement verdict keeps the session
  blocked until an explicit repair. `selection-unavailable` is re-evaluated by the open that
  can bind it again.
- **Malformed newest policy entry:** the existing fail-closed refusal applies, now to the
  whole session instead of only the branch that contains the entry. Repair is the same
  explicit policy update.
- **Tiered policy whose ladder is broken:** no ladder resolution happens at open; the
  runtime comes up on the last applied model, and tier re-application stays the explicit
  repair path. The published `ladderValid` flag is unchanged. A Tiered session restores the
  last applied tuple rather than re-resolving a changed tier mapping.
- **Archived sessions:** the same derivation runs; archived sessions stay read-only and the
  block only affects the published reason.
- **Transcripts with no recorded model:** no override; Pi's branch restore stays in charge.

## Behavior comparison

| Scenario | Today | After |
| --- | --- | --- |
| Edit from here, then send | Policy/UI revert to the old model; live tuple still runs the new one until a rebuild | Policy, UI, and live tuple all keep the session's current model |
| Reopen after Edit from here | Pi restores the original dialogue's model | The session's current recorded model is restored |
| Reopen after changing only thinking | Restores the branch's model/thinking | Restores the newest recorded model/thinking |
| Change thinking after an edit | Draft carries the old branch's model; applying changes the model back | Draft carries the session's current model |
| New session / fork / clone | Inherits the branch-point policy | Unchanged |
| Transcript with no recorded model | Pi's branch restore | Unchanged |
| Recorded model unavailable (Exact, or a Tiered last applied model) | Pi silently substitutes (branch-restore rules) | Visible `MODEL_POLICY_BLOCKED` reason; prompts refused until repaired or credentials return |
| Recorded thinking level unsupported | Pi silently clamps | Visible `MODEL_POLICY_BLOCKED` reason; prompts refused until repaired |
| Tier mapping changed while closed | Pi restores the last applied model | Unchanged (re-resolved only by an explicit tier application) |
| Ambiguous tuple after a failed transition | Block survives reopen | Unchanged (never cleared at open) |
| Subsession completion on a blocked session | Triggers a run on the ambiguous tuple | Delivered without a run until repaired |

## Test strategy

Pure module tests (`src/server/sessions/sessionRuntimeRestore.test.ts`):

- reader: newest `model_change`/`thinking_level_change` wins in append order; the same entry
  list produces the same result regardless of branch structure (characterization only —
  falsifiability against the bug rests on the service test); a present-but-unusable newest
  entry returns `invalid`; a thinking-only transcript with an unusable newest thinking entry
  returns `none`; an empty transcript returns `none`.
- planner: one row per verdict-table entry with the current cause as an input, including
  preservation of `runtime-tuple-unproven` across every verdict, replacement of a stale
  `selection-unavailable` cause, the `apply` verdict's `selection-unavailable` clear,
  explicit persisted-Exact disagreement, thinking-level equality only when recorded, tiered
  and legacy non-comparability, and the invalid persisted entry.

Service and factory tests:

- the abandoned-branch policy test is deliberately inverted: `modelPolicy()`/`remember`
  report the newest append-order policy while an older policy sits on the active branch; the
  existing `getBranch` call-count assertions are updated for the helper change;
- the harness aliases `getEntries` to `getBranch`, so durable-read tests override them with
  distinct lists to prove which one is authoritative;
- factory plumbing with the injectable fake SDK proves the model and thinking passed to
  `createFromServices` come from the plan, that an extension provider registered during
  `createServices` is resolvable, that explicit caller values suppress derivation and leave
  the block untouched, and that a refresh failure during `prepare` does not fail the open;
- a real-SDK integration test proves rewind → reopen restores the recorded model and
  thinking through actual Pi construction, pins Pi's initial appends (message-less
  transcript; active branch without a thinking entry) as carrying the derived values, and
  proves a virtual-model `_recordSelection` append does not false-arm; restore-success
  fixtures need a dedicated `createTestModelRuntime` with a seeded credential store, never
  the shared unauthenticated singleton;
- verdict tests: `none` preserves a block, `invalid` and unbindable arm
  `selection-unavailable`, disagreement arms `runtime-tuple-unproven`, a failed-transition
  block survives an open verdict and an explicit policy update clears it, a stale
  `selection-unavailable` reason is replaced when the verdict changes, credentials returning
  clears `selection-unavailable` on open, each blocked state is refused by `prompt()`, a
  notification arriving during a policy mutation is delivered without `triggerTurn`, and a
  fork/clone of a blocked session arms the new session's own block;
- `editFromHere` and tree navigation leave the policy, the block, and the live tuple
  unchanged; because navigation publishes the cached inspection, the test forces a fresh
  inspection (`modelPolicy()`) or closes and reopens;
- navigation appends no model, thinking, or policy entry;
- a blocked session delivers a subsession notification without `triggerTurn`.

Falsifiability: reverting `sessionTranscriptEntries` to `getBranch()` must fail the
abandoned-branch test; removing the factory restore hook must fail the factory and real-SDK
tests; clearing `runtime-tuple-unproven` at open must fail the failed-transition reopen
test.

## Documentation and release

- Add a transcript-level statement to the per-session model policy section of
  `docs/config.md` **and its `docs/config.html` mirror**: the session model selection is
  session-level and survives branch navigation; an unavailable recorded model (including a
  virtual model whose extension is not loaded) or unsupported recorded thinking level blocks
  the session with a visible reason; it clears on the next runtime open once the selection
  resolves again and agrees with the persisted policy (adding credentials or re-enabling the
  extension, then reopening), or immediately through an explicit policy update; a persisted
  policy disagreement stays blocked until that update. Disambiguate the existing starter
  sentence inline as the inactive **Exact/Tiered mode**, since "branch" is otherwise
  ambiguous on that page.
- Update the `CONTEXT.md` glossary: make session-level, branch-independent authority
  explicit for the session model, add a session runtime selection term, and clarify that
  "branch" in the **Remembered policy selection** entry means the Exact/Tiered mode branch.
- Update the `ClientSessionModelPolicyStatus.resolved` doc comment: the live tuple can come
  from a transcript restore, and while a block is active it can be Pi's branch-restore
  fallback rather than the recorded selection.
- Add a supersession note to the branch-scoped policy statements in
  `2026-07-31-tiered-session-model-policy-and-deterministic-sdd-design.md`. The 2026-07-30
  subsession-defaults design is already superseded and governs a different reader
  (`pi-webui.subsession.defaults`), so it needs no note.
- Add a `patch` Changeset for `@hyperdreamer/pi-webui` with user-facing wording.
- The fix lives in `piSessionService.ts`, which is loaded only by the long-lived,
  non-autoreloading `pi-webui-sessiond.service`. The handoff must state that a **manual
  session-daemon restart is required** for the fix to take effect; the web/API autoreload
  path does not load it.
