# Context "Only use session model" routing — Design

- **Status:** APPROVED at design review attempt 2 (0 blockers); approved for specification
- **Date:** 2026-10-11
- **PM run:** `pm-20261010-214130-1c54f1ae`
- **Topic slug:** `context-session-model-only`
- **Delivery target:** `refs/heads/main` @ `d94ae3cebc06a291c24e7372e3438b74c5898979`
- **Related issue:** `hyperdreamer/pi-webui#13` — Feature request: add "Only use session model" for Context utility routing

## Background

Utility routing for compaction lives in `utilityModels.context`
(`Settings → Utility models → Context`; machine-global config at
`$PI_WEBUI_CONFIG`, default `~/.config/pi-webui/config.json`). Today the Context
slot has exactly two states:

- **unset (default):** `utilityModelResolver` resolves `context` to the
  candidate chain `["context", "lightweight"]`; with Context unset and
  Lightweight configured, compaction attempts Lightweight first.
- **fixed model:** compaction attempts the configured Context model, then
  Lightweight, then Pi's active session model.

When a candidate is unavailable, unauthenticated, unauthenticated-failing, or
call-failing, the resolver advances to the next candidate. If no candidate
produces a compaction, `sessionBeforeCompact` returns `undefined` and Pi runs
its own default compaction (`AgentSession._runDefaultCompaction`) with
`this.model` — the session model and thinking level **resolved at compaction
time**.

The reported problem (issue #13): users configure Lightweight as their small,
inexpensive model for titles and branch summaries, and that choice is then
implicitly reused for compaction. A Lightweight model with a small context
window can fail precisely on the long sessions that need compaction, adding
latency and retries before Pi recovers on the session model. There is no
explicit way to say "use whichever model this session is currently using and
never attempt Lightweight for compaction". Selecting a fixed Context model is
not equivalent because sessions use different models and users switch models
within a session.

Issue #13's acceptance criteria require an explicit, persisted third state;
they explicitly forbid silently changing what an unset Context configuration
means.

## Goals

1. Add an explicit Context state, labeled **Only use session model**, distinct
   from the inherited fallback and from a fixed Context model.
2. In that state, compaction goes directly to the active session model and
   attempts **neither** the configured Context model **nor** Lightweight.
3. Resolve the session model and its thinking level at compaction time, so the
   choice follows model changes and works across sessions using different
   models.
4. Leave every existing behavior unchanged: unset and fixed Context routing,
   Lightweight titles and branch summaries, the `+` starter lightweight
   fallback, session-name generation, and speech-input polishing.
5. Persist the state explicitly and expose it through an additive
   `contractVersion: 3` utility-model settings contract, gated so older
   runtimes never advertise a choice they cannot honor.
6. Cover manual compaction, automatic compaction, and mid-session model
   switching with regression tests at the extension boundary.

## Non-goals

- **Changing the default chain.** `Context → Lightweight → session` and
  `Lightweight → session` remain exactly as documented. The rejected
  alternative is recorded below.
- **A session-only option for Lightweight.** Titles and branch summaries keep
  their current single-slot routing.
- **Per-session scope.** The setting stays machine-global like every other
  utility-model slot.
- **Changing Pi's active-session compaction.** Thinking-level behavior,
  summarization retry callbacks, and error surfacing for the session path stay
  owned by upstream Pi; this design only chooses that path earlier.
- **Making the option work against older runtimes.** A daemon that does not
  report contract version 3 does not offer the choice; the settings panel
  degrades to today's editor.
- **README changes.** This is detailed configuration behavior and belongs in
  `docs/config.md` per the repository documentation guide.

## Behavior contract

### Configuration states

`utilityModels.context` accepts exactly:

| Value | State | Compaction attempts, in order |
| --- | --- | --- |
| absent | inherited (unchanged) | `["context", "lightweight"]` candidates, then Pi's active session model |
| `{ provider, id, thinkingLevel? }` | fixed model (unchanged) | that binding, then Lightweight, then Pi's active session model |
| `"session"` (new) | session-only | Pi's active session model only |

`utilityModels.lightweight` is unchanged and accepts only a binding object.

```json
{
  "utilityModels": {
    "lightweight": { "provider": "acme", "id": "small", "thinkingLevel": "low" },
    "context": "session"
  }
}
```

State transitions in the editor:

- inherited → session-only: the Context slot becomes `"session"`.
- session-only → a fixed model: `"session"` is replaced by the binding; the
  previous fixed model is not remembered.
- session-only → inherited: the slot is cleared (`null` update), restoring
  `["context", "lightweight"]`.
- `"session"` is never combined with a binding; the states are mutually
  exclusive by construction.

### Routing semantics

1. `sessionBeforeCompact` resolves routing once per compaction event.
2. When `context === "session"`, the handler returns `undefined` immediately —
   before resolving candidates, auth, retry settings, streams, or Pi runtime
   refs — which makes Pi run `_runDefaultCompaction(preparation, this.model, …)`
   with the session's current model and thinking level.
3. In every other state, the handler behaves exactly as today.
4. No candidate is attempted, no `getAuth` runs, no utility stream or retry
   settings are read, and no candidate-failure diagnostic is emitted for
   session-only compaction. Resolver-level config or catalog failures keep
   their existing logging, exactly as in every other state.
5. `ctx.model === undefined` (no session model selected) keeps returning
   `undefined` in every state; Pi reports its existing "no model selected"
   error.
6. Abort handling is unchanged: the handler starts no candidate work after
   `event.signal` is aborted, and Pi's own compaction observes the aborted
   signal. `inspect` may still refresh the local model snapshot before the
   handler returns, so the extension-level abort test asserts that `compact`,
   `getAuth`, and `getRetrySettings` are never called rather than asserting
   that nothing ran.

### Resolver contract

`UtilityModelInspection` gains a required boolean:

```ts
export interface UtilityModelInspection<TModel extends UtilityModelIdentity> {
  candidates: readonly ResolvedUtilityModel<TModel>[];
  /** True when the task must bypass configured candidates and use the active session model. */
  sessionModelOnly: boolean;
  unavailable?: UtilityModelUnavailable;
}
```

- `inspect("context")` returns
  `{ candidates: [], sessionModelOnly: true }` when `context === "session"`,
  with **no** `unavailable` value: the state is valid and deliberate.
- Every other inspection path returns `sessionModelOnly: false`.
- `configuredCandidates("context")` therefore returns `[]` in session-only
  mode. `runWithUtilityModelFallback` has no context caller today and this
  design adds none: compaction routing stays inside the extension, because the
  helper requires a caller-supplied attempt with a thinking level and could
  defeat the active-session thinking-level guarantee.
- `inspect("lightweight")` is unaffected even when `context === "session"`.
- Configuration errors keep precedence: a malformed `utilityModels` subtree
  reports `config-invalid` before any sentinel handling.

### API contract (contractVersion 3)

```ts
export const UTILITY_MODEL_SESSION_ONLY = "session" as const;
export type UtilityModelSessionOnly = typeof UTILITY_MODEL_SESSION_ONLY;
export type UtilityModelContextSetting = UtilityModelBinding | UtilityModelSessionOnly;

export interface UtilityModelSettings {
  lightweight?: UtilityModelBinding;
  context?: UtilityModelContextSetting;
}

export interface UtilityModelSettingsUpdate {
  lightweight?: UtilityModelBinding | null;
  context?: UtilityModelContextSetting | null;
}

export interface UtilityModelSettingsResponseV3 extends UtilityModelSettingsResponseFields {
  contractVersion: 3;
  models: UtilityModelOptionV2[];
}
```

- `GET /utility-models` returns `contractVersion: 3` from an upgraded daemon.
  `settings.context` is `"session"` or binding or omitted; `slots.context`
  reports `{ valid: true }` for the sentinel.
- `PUT /utility-models` accepts `{ "settings": { "context": "session" } }`,
  `{ "context": null }`, and binding objects; it rejects
  `lightweight: "session"` and unknown strings with a 400 and a path-qualified
  message.
- The strict browser parser accepts contract versions 1, 2, and 3; v3 is the
  only version that may carry the `"session"` sentinel.
- `utilityModelSettingsForContract` passes updates through unchanged for v2 and
  v3 and projects bindings to `{ provider, id }` for v1. A sentinel reaching
  the v1 projection is a programming error and throws instead of silently
  dropping the user's choice.
- **Thinking capability is v2-or-later, not exactly v2.** Every client gate
  that currently keys on exactly `contractVersion === 2` or `!== 2` moves to a
  shared `supportsUtilityModelThinking(response)` check
  (`contractVersion !== 1`) — `utilityModelThinkingOptions`,
  `validateUtilityModelSlot`, and the panel's thinking value/disabled gates.
  Without this, upgrading a daemon to v3 would show existing explicit
  `thinkingLevel` bindings as invalid and force `auto`.

### UI contract

In `Settings → Utility models → Context`, the model picker dialog gains one
special choice at the top, above the existing inherited entry:

```
┌──────────────────────────────────────────────────┐
│ Search models…                                    │
│ ● Only use session model                          │
│   Use lightweight, then active session model      │
│ ── anthropic ──────────────────────────────────── │
│   claude-sonnet-4-5                               │
│ ── openai ─────────────────────────────────────── │
│   gpt-5.2                                         │
└──────────────────────────────────────────────────┘
```

- The trigger for session-only reads `Only use session model`; it is not
  styled as an empty/inherited selection.
- The choice is only offered when the loaded response reports
  `contractVersion === 3`. On v1/v2 responses the picker is unchanged.
- With session-only selected, the Context Thinking select is disabled and
  shows `auto`; the session's thinking level is owned by Pi's compaction path.
- The existing inherited entry keeps its label
  `Use lightweight, then active session model` and its meaning.
- The Lightweight row is untouched.
- Selection is a draft edit; nothing persists until **Save utility models**,
  matching the rest of the panel.

### Rolling compatibility

| Gateway/client | Daemon | Behavior |
| --- | --- | --- |
| new | v3 | full functionality, session-only offered |
| new | v2 | option hidden; existing editor and routing unchanged |
| new | v1 | thinking-level notice as today; option hidden |
| old | v3 | old client rejects the unknown contract version and shows a utility-models error, matching the v1→v2 precedent |
| any | config contains `"session"`, daemon older than v3 | daemon reports a `configError`; the resolver treats utility models as invalid and compaction falls back to Pi's session model |

## Architecture

### Shared types

`src/shared/apiTypes.ts` owns `UTILITY_MODEL_SESSION_ONLY`,
`UtilityModelContextSetting`, the extended `UtilityModelSettings` /
`UtilityModelSettingsUpdate`, and `UtilityModelSettingsResponseV3`. The update
type becomes a per-slot object instead of `Partial<Record<UtilityModelSlot, …>>`
so `"session"` is representable for `context` only.

### Config parsing

`src/config.ts`:

- `parseUtilityModelsConfig` accepts the exact string `"session"` for `context`
  and rejects it (or any other string) for `lightweight` with a message naming
  the key.
- `parseUtilityModelBinding` keeps requiring an object with
  `provider`/`id`/optional `thinkingLevel` and rejecting unknown keys.
- `replacePiWebUiUtilityModels` and the config-normalization path carry the
  union through unchanged.

### Resolver

`src/server/sessions/utilityModelResolver.ts`:

- After the `utilityModelsError` and `utilityModels === undefined` checks,
  short-circuit `task === "context" && context === "session"` to
  `{ candidates: [], sessionModelOnly: true }`.
- Add `sessionModelOnly: false` to every other return site.
- `configuredCandidates` stays a thin wrapper over `inspect`.

### Extension

`src/server/sessions/utilityModelExtension.ts`:

```ts
sessionBeforeCompact: async (event, ctx) => {
  if (ctx.model === undefined) return undefined;
  const inspection = await deps.resolver.inspect("context");
  if (inspection.sessionModelOnly) return undefined; // Pi compacts with the active session model
  const refs = availableRefs(deps.refs);
  if (refs === undefined) return undefined;
  // …unchanged retry resolution and candidate loop over inspection.candidates…
}
```

The `sessionBeforeTree` (lightweight) handler is untouched.

### Settings service and routes

- `utilityModelSettingsService.ts` returns contract version 3 from `inspect`
  and `update`, treats the Context sentinel as valid in `validationFor`, and
  keeps the existing atomic validate-then-save behavior.
- `utilityModelSettingsRoutes.ts` parses `lightweight` and `context`
  explicitly (two keys, no generic slot loop) so the sentinel is accepted only
  for `context`.

### Client

- `api/parsers.ts`: add `parseUtilityModelSettingsResponseV3` plus a v3 settings
  parser whose `context` branch accepts `"session"` or a binding; keep v1/v2
  parsers byte-compatible for older daemons.
- `api/clients.ts`: pass-through for contract v2/v3 and the v1 projection guard.
- `components/settings/utilityModelSettingsDraft.ts`: the draft value may be
  the sentinel; add `updateUtilityModelDraftContextSessionOnly` and
  `supportsUtilityModelThinking`; validation treats the sentinel as valid and
  keeps explicit thinking levels valid for v3; update conversion emits
  `"session"`.
- `components/settings/settingsModelOptions.ts`: extend
  `settingsModelPickerOptions` with special choices rendered **before** any
  inherited entry (the approved mockup order: special choices, inherited,
  models); callers that pass no special choices keep the current order.
- `components/settings/SettingsModelPickerField.ts`: additive
  `specialChoices`, `selectedSpecialValue`, and `onSelectSpecial` properties; a
  selected special choice replaces the empty/inherited summary. The tiers panel
  passes none and is unaffected.
- `components/settings/SettingsUtilityModelsPanel.ts`: render the new choice for
  `contractVersion === 3` only, normalize the sentinel before binding-based
  lookups, and disable the Thinking select while it is selected.

### Files and seams

| File | Change |
| --- | --- |
| `src/shared/apiTypes.ts` | sentinel constant/type, settings and update unions, response V3 |
| `src/config.ts` | parse the Context sentinel; reject it for Lightweight |
| `src/server/sessions/utilityModelResolver.ts` | `sessionModelOnly` inspection and short-circuit |
| `src/server/sessions/utilityModelExtension.ts` | compact handler session-only early return |
| `src/server/sessions/utilityModelSettingsService.ts` | contract v3, sentinel validation |
| `src/server/sessions/utilityModelSettingsRoutes.ts` | explicit per-slot update parsing |
| `src/client/src/api/parsers.ts` | v3 response parser |
| `src/client/src/api/clients.ts` | version-aware save projection |
| `src/client/src/components/settings/utilityModelSettingsDraft.ts` | sentinel draft/update/validation; v2-or-later thinking capability |
| `src/client/src/components/settings/settingsModelOptions.ts` | special picker choices, special-first ordering |
| `src/client/src/components/settings/SettingsModelPickerField.ts` | special choices API |
| `src/client/src/components/settings/SettingsUtilityModelsPanel.ts` | entry, v3 gating, thinking value/disabled gates |
| `docs/config.md` | behavior, compatibility, restart note |
| `docs/config.html` | hand-synced mirror of the same Utility models claims |
| `.changeset/context-session-model-only.md` | minor changeset |

## Invariants

1. Session-only compaction never invokes a utility model, candidate auth
   resolution, utility stream wrapping, or utility retry settings.
2. `context === "session"` changes no other task's routing or behavior.
3. Existing configurations produce identical routing decisions; only an
   explicit sentinel changes compaction routing.
4. The session model and thinking level are resolved by Pi at compaction time,
   never captured at save time.
5. Contract versions are monotonic; a parser that does not know version 3
   rejects it rather than guessing.
6. The new choice is offered only when the serving runtime reports version 3.
7. A failed or missing utility candidate can never silently change session-only
   routing; the session path is reached without candidate resolution.

## Error handling

- Invalid `utilityModels.context` value → `utilityModelsError`, all slots
  reported invalid, save rejected with a path-qualified 400.
- Session-only compaction failures are Pi's own compaction errors; PI WEBUI
  adds no failure path and no fallback attempt.
- No session model selected → unchanged Pi error.
- Aborted compaction → unchanged Pi cancellation.
- Old daemon with a sentinel config → `configError` + session-model compaction,
  as described in Rolling compatibility.
- v1 save projection receiving a sentinel → thrown programming-error guard,
  surfaced by the settings dialog rather than silently degrading.

## Testing strategy

Tests are written RED-first at the smallest layer that proves each contract, per
`.agents/skills/testing-guide/SKILL.md`.

| Layer | File | Scenarios |
| --- | --- | --- |
| config parser | `src/config.test.ts` | accept `context: "session"`; reject `lightweight: "session"`; reject other Context strings; keep binding/unknown-key behavior; sentinel survives parse → save → reload round-trip |
| resolver | `src/server/sessions/utilityModelResolver.test.ts` | session-only inspection has empty candidates and `sessionModelOnly: true`; no `unavailable`; lightweight unaffected; fixed/unset unchanged; config-error precedence |
| resolver fakes | `piSessionService.*.test.ts` | required `sessionModelOnly` added to existing inspection fakes (typecheck-driven) |
| extension | `src/server/sessions/utilityModelExtension.test.ts` | session-only inspection **with a non-empty candidate list** still returns `undefined` without calling `compact`, `getAuth`, or `getRetrySettings`; manual and automatic `reason` behave identically; different `ctx.model` values produce the same result (model switching); the aborted-signal case starts no candidate work; lightweight handler unchanged |
| settings service | `src/server/sessions/utilityModelSettingsService.test.ts` | v3 response; sentinel valid; update to sentinel, back to binding, back to unset |
| settings routes | `src/server/sessions/utilityModelSettingsRoutes.test.ts` | PUT sentinel accepted; PUT `lightweight: "session"` rejected; unknown keys rejected |
| client parser | `src/client/src/api/parsers.test.ts` | flip the existing v3-rejection assertion to v3 acceptance; v3 sentinel parse; v1/v2 legacy parse; malformed sentinel and unknown keys rejected |
| client API | `src/client/src/api/clients.test.ts` | v3 save sends the sentinel; v1/v2 projections unchanged; v1 sentinel guard throws; nested BASE_URL |
| draft helper | `src/client/src/components/settings/utilityModelSettingsDraft.test.ts` | draft from v3 response; v3 explicit thinking level valid and offered exactly as v2; select session-only; select model/inherited from session-only; update conversion; validation |
| picker options | `src/client/src/components/settings/settingsModelOptions.test.ts` | special choices render before the inherited entry, then models; no special choices keeps the current order |
| picker field | `src/client/src/components/settings/SettingsModelPickerField.test.ts` | special selection sets the trigger summary and dispatches the value; model/inherited selection clears it |
| panel | `src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts` | entry rendered only for v3; label and trigger state; Thinking disabled for sentinel; save payload |
| dialog | `src/client/src/components/SettingsDialog.utilitymodels.test.ts` | load/save plumbing for the new update shape |
| broad gates | `npm run typecheck`, targeted ESLint, `npm run verify` | committed scope, no regressions |

The extension tests document that "manual vs automatic compaction" and "model
switching" are the same code path on the PI WEBUI side: Pi owns the trigger and
the active-session resolution, and the handler contract is model-agnostic. The
session-only extension test must supply a configured candidate in the fake
inspection so the assertion fails if the `sessionModelOnly` short-circuit is
removed; an empty candidate list alone would pass vacuously.

## Documentation and release

- `docs/config.md` Utility models section **and its hand-synced
  `docs/config.html` mirror** (the documentation guide treats them as canonical
  together):
  - document the third Context state and that it attempts neither the Context
    model nor Lightweight;
  - keep the existing fallback-chain description for unset and fixed states;
  - document that the choice requires a runtime reporting settings contract 3
    and is hidden on older remotes;
  - add the standard one-time installation note, phrased like the existing
    lightweight-fallback note: the resolver and extension live in the
    non-autoreloading session daemon, so the option appears only after a manual
    `systemctl --user restart pi-webui-sessiond.service`. Saved settings keep
    applying immediately after that one-time restart.
- Changeset: minor, user-visible feature
  (`.changeset/context-session-model-only.md`).
- Per `AGENTS.md`, delivery communication must state that this feature requires
  one manual session-daemon restart.

## Rejected alternatives

1. **Change the default chain to `Context → session`.** Removes the implicit
   Lightweight attempt for everyone but silently changes unset behavior,
   deletes the existing Context-failure recovery path, and does not fix the
   reporter's scenario (Lightweight set, Context unset) without also changing
   what unset means. Recorded as a possible future deliberate behavior change,
   not part of this fix.
2. **Sibling key instead of a sentinel** (`contextMode: "session"`). Requires a
   precedence rule when a binding and the mode are both present, and persists
   two sources of truth for one decision.
3. **Tagged object values** (`{ mode: "session" }`). More extensible, but
   reshapes every existing binding value and every strict parser for no
   current requirement.
4. **A separate Behavior select or radio group instead of a picker entry.**
   Adds a control beyond the approved Option A; the picker already hosts the
   inherited policy entry, so special choices keep one control per row.
5. **Keeping `contractVersion: 2` and adding the sentinel.** Old clients parse
   v2 settings with `parseUtilityModelBinding` and would throw on a bare
   string; a version bump is the honest contract.

## Risks and residual behavior

- **Old clients with a new daemon** see a utility-models error instead of the
  editor. This matches the v1→v2 precedent; upgrading the client resolves it.
- **Users may expect the choice to cover Lightweight.** Docs and the row
  description keep the separation explicit.
- **No effect until the daemon restarts.** The panel gates on the daemon's
  reported contract version, so the UI cannot save a state the running daemon
  cannot honor.

## Acceptance criteria

1. Context exposes an explicit **Only use session model** choice distinct from
   the inherited fallback and from a fixed model. (Goals 1, 5)
2. In that state, compaction attempts neither Lightweight nor a configured
   Context model; it uses the active session model. (Goal 2)
3. The session model is resolved at compaction time and follows model changes
   and different models across sessions. (Goal 3)
4. The active-session thinking-level behavior is preserved. (Goal 3)
5. Lightweight title and branch-summary routing is unchanged. (Goal 4)
6. Existing unset Context configurations keep their meaning and routing.
   (Goal 4)
7. Manual compaction, automatic compaction, and model switching are covered by
   regression tests at the extension boundary. (Goal 6)
8. The option is offered only by runtimes that report contract version 3, and
   the config/API changes are additive for existing states: upgrading to v3
   preserves existing explicit thinking levels exactly as v2 did. (Goal 5)

## Design review history

- **Attempt 1** (reviewer `01a12908-9ba0-762c-a364-4f8f0069336f`): BLOCKED, 3 blockers.
  - **B1** — contract v3 was treated as v1 by the existing thinking-level
    client gates (`utilityModelSettingsDraft.ts:75,166`,
    `SettingsUtilityModelsPanel.ts:173`, `clients.ts:305`), which would have
    shown existing explicit `thinkingLevel` bindings as invalid after the
    upgrade. Resolved: `supportsUtilityModelThinking` requirement added to the
    API contract and client sections, with v3-explicit-level tests.
  - **B2** — picker ordering contradicted the approved mockup. Resolved:
    special choices first, then inherited, then models; stated once in the
    settingsModelOptions contract.
  - **B3** — `docs/config.html` was missing from the file scope. Resolved: both
    hand-synced canonical doc files are in scope.
  - Advisories folded in: precise abort/no-work wording and test asserts;
    falsifiable session-only extension test with a configured candidate;
    qualified `runWithUtilityModelFallback` claim; picker helper/field unit-test
    rows; v3 parser assertion flip; sentinel persistence round-trip; required
    field fake churn; one-time restart wording.
- **Attempt 2** (reviewer `01a12915-fb50-762c-a364-4f94c59d9095`): **PASS, 0 blockers.**
  All three attempt-1 resolutions verified against source; a full `contractVersion`
  sweep found no remaining v2-vs-v3 utility-model gate. Non-blocking advisories
  carried into the specification:
  1. Pin the panel's `thinkingValue` gate with a v3 explicit-level render
     assertion, not only the draft helper.
  2. `supportsUtilityModelThinking` must be a type predicate
     (`response is V2 | V3`) so later `thinkingLevels` access narrows.
  3. `inspect`-before-refs reorders the degraded path (the resolver refresh can
     now run where it previously did not); either check refs first or document
     and test the order.
  4. Write the PUT example with the wrapper: `{ "settings": { "context": null } }`.
  5. Specify sentinel semantics for `updateUtilityModelDraftThinkingLevel`
     (no-op) and `updateUtilityModelDraftModel` (replace).
  6. `clients.ts` v1 projection needs explicit per-slot handling or a
     `projectBinding` helper after the update-type change.
  7. Keep the model-switch extension test only with the same no-candidate-work
     assertions; otherwise it passes vacuously.
  8. Trigger styling must consider `selectedSpecialValue` so session-only does
     not render as inherited/empty.
