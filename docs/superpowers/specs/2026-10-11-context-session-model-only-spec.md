# Technical Specification: Context "Only use session model" Utility Routing

- **Status:** APPROVED at spec review attempt 2 (0 blockers); approved by the user on 2026-10-11
- **Date:** 2026-10-11
- **PM run:** `pm-20261010-214130-1c54f1ae`
- **Topic slug:** `context-session-model-only`
- **Delivery target:** `refs/heads/main` @ `d94ae3cebc06a291c24e7372e3438b74c5898979`
- **Source design:** `docs/superpowers/specs/2026-10-11-context-session-model-only-design.md` (APPROVED at
  design review attempt 2, 0 blockers; all attempt-2 advisories are carried as requirements in §13)
- **Verification base:** repository source at `15bc136` ("docs: finalize context-session-model-only
  design"), one commit past the design's delivery target. The cited source symbols and messages are
  identical at both revisions.
- **Change class:** user-visible minor (new persisted Context state; additive `contractVersion: 3`
  utility-model settings API)
- **Operation class:** session-daemon-affecting. `src/server/sessions/utilityModelResolver.ts`,
  `utilityModelExtension.ts`, `utilityModelSettingsService.ts`, and
  `utilityModelSettingsRoutes.ts` are constructed and loaded only by the long-lived session daemon
  (`src/server/sessiond.ts`); the web/API process proxies `/utility-models` to it
  (`src/server/sessiond/sessionProxyRoutes.ts`). `src/shared/apiTypes.ts`, `src/config.ts`, and the
  client are shared or web/API-loaded. Per `AGENTS.md`, installing this feature requires one manual
  `systemctl --user restart pi-webui-sessiond.service`; ordinary UI/API autoreload does not load the
  daemon-side contract or short-circuit. See §12.

Every `file:line`-style claim below names the file and symbol that owns it; line numbers are avoided
because they drift. Where this specification picks a concrete string that the design only constrains
(for example a guard message), that is recorded as a specification-level choice in §14.

---

## 1. Scope

### 1.1 What changes

1. **Shared types (additive).** `src/shared/apiTypes.ts` gains the `UTILITY_MODEL_SESSION_ONLY`
   sentinel, `UtilityModelSessionOnly`, `UtilityModelContextSetting`, the Context union in
   `UtilityModelSettings`, a per-slot `UtilityModelSettingsUpdate`, and
   `UtilityModelSettingsResponseV3` (§2).
2. **Config parsing (additive, fail-closed for other values).** `src/config.ts`
   `parseUtilityModelsConfig` accepts the exact string `"session"` for `context` only. Lightweight
   keeps accepting bindings only; every other Context string keeps failing through
   `parseUtilityModelBinding` (§3).
3. **Resolver (additive field, one new short-circuit).** `UtilityModelInspection` gains required
   `sessionModelOnly: boolean`; `inspect("context")` returns `{ candidates: [], sessionModelOnly: true }`
   when `context === "session"`; every other return site reports `false` (§4).
4. **Extension (one early return).** `sessionBeforeCompact` returns `undefined` immediately when the
   inspection is session-only, before runtime refs, retry settings, auth, streams, or candidates (§5).
5. **Settings service (contract bump).** `utilityModelSettingsService` returns
   `contractVersion: 3` and treats the Context sentinel as valid (§6.1).
6. **Settings routes (explicit per-slot parsing).** `utilityModelSettingsRoutes` parses `lightweight`
   and `context` as two explicit slots so the sentinel is accepted only for `context` (§6.2).
7. **Client (v3 parser, version-aware save, draft/picker/panel).** Strict v3 parsing, the v1
   projection guard, `supportsUtilityModelThinking` (v2-or-later, type predicate), the session-only
   draft transition, special picker choices rendered before the inherited entry, and v3-gated panel
   behavior (§7).
8. **Docs and release.** `docs/config.md` and its hand-synced `docs/config.html` mirror, plus one
   minor changeset, including the one-time session-daemon restart note (§12).

### 1.2 Out of scope (binding non-goals)

All design non-goals are binding and unchanged:

- No change to the default chain: unset Context still resolves `["context", "lightweight"]`, fixed
  Context still resolves `[binding, lightweight]`, and each still falls back to Pi's active session
  model. Only an explicit `"session"` changes compaction routing.
- No session-only option for Lightweight; titles and branch summaries keep their routing.
- No per-session scope; `utilityModels` stays machine-global.
- No change to Pi's active-session compaction internals (thinking-level callbacks, retry callbacks,
  error surfacing).
- No working session-only state against a runtime that does not report contract version 3; older
  daemons report `configError` and Pi compacts with the session model.
- No README change.

### 1.3 Binding design decisions restated

- The state is a string sentinel (`context: "session"`), not a sibling key and not a tagged object.
- The daemon resolves the session model and thinking level at compaction time; nothing is captured at
  save time.
- The browser parser accepts contract versions 1, 2, and 3; v3 is the only version that may carry the
  `"session"` sentinel.
- Thinking capability is v2-or-later, not exactly v2 (`supportsUtilityModelThinking` is
  `contractVersion !== 1`).
- Picker order is special choices, then the inherited entry, then models.

---

## 2. Shared types and constants — `src/shared/apiTypes.ts`

### 2.1 Exact additions and replacements

Add the sentinel and its derived types immediately above the existing `UtilityModelBinding`:

```ts
export const UTILITY_MODEL_SESSION_ONLY = "session" as const;
export type UtilityModelSessionOnly = typeof UTILITY_MODEL_SESSION_ONLY;
export type UtilityModelContextSetting = UtilityModelBinding | UtilityModelSessionOnly;
```

Replace the existing `UtilityModelSettings` / `UtilityModelSettingsUpdate` declarations with:

```ts
export interface UtilityModelSettings {
  lightweight?: UtilityModelBinding;
  context?: UtilityModelContextSetting;
}

export interface UtilityModelSettingsUpdate {
  lightweight?: UtilityModelBinding | null;
  context?: UtilityModelContextSetting | null;
}
```

The update type stops being `Partial<Record<UtilityModelSlot, UtilityModelBinding | null>>` so the
union is representable for `context` only. `null` keeps its existing meaning (clear the slot); an
omitted key keeps its existing meaning (leave the slot unchanged).

Add the v3 response beside the existing v1/v2 responses:

```ts
export interface UtilityModelSettingsResponseV3
  extends UtilityModelSettingsResponseFields {
  contractVersion: 3;
  models: UtilityModelOptionV2[];
}
```

and extend the union:

```ts
export type UtilityModelSettingsResponse =
  | UtilityModelSettingsResponseV1
  | UtilityModelSettingsResponseV2
  | UtilityModelSettingsResponseV3;
```

`UtilityModelSettingsResponseFields` keeps its current private declaration (same module) and keeps
`settings`, `slots`, `valid`, and optional `configError`. `UtilityModelOptionV2[]` is the v3 model
option shape; v3 reuses v2 thinking-level options.

`PiWebUiConfigValues.utilityModels?: UtilityModelSettings` (same file) inherits the widened Context
type automatically; no other shared type changes.

### 2.2 Ownership and import mechanics

| Symbol | Owner module | Note |
| --- | --- | --- |
| `UTILITY_MODEL_SESSION_ONLY` | `src/shared/apiTypes.ts` | first value export for utility models; every runtime compare uses this constant, never a literal |
| `UtilityModelSessionOnly` | same | `typeof UTILITY_MODEL_SESSION_ONLY` |
| `UtilityModelContextSetting` | same | `UtilityModelBinding \| UtilityModelSessionOnly` |
| `UtilityModelSettings` | same | `context` widened |
| `UtilityModelSettingsUpdate` | same | per-slot object, not a mapped record |
| `UtilityModelSettingsResponseV3` | same | `contractVersion: 3`, `models: UtilityModelOptionV2[]` |

Files that need a **value** import of `UTILITY_MODEL_SESSION_ONLY` (not type-only):
`src/config.ts`, `src/server/sessions/utilityModelResolver.ts`,
`src/server/sessions/utilityModelSettingsRoutes.ts`,
`src/server/sessions/utilityModelSettingsService.ts`, `src/client/src/api/parsers.ts`,
`src/client/src/api/clients.ts`,
`src/client/src/components/settings/utilityModelSettingsDraft.ts`,
`src/client/src/components/settings/SettingsUtilityModelsPanel.ts`.

`src/client/src/api.ts` already re-exports `UtilityModelSettings`, `UtilityModelSettingsResponse`,
and `UtilityModelSettingsUpdate` by name; no barrel edit is required for the union to widen
throughout the client.

### 2.3 Invariants

1. `"session"` is never combined with a binding; the states are mutually exclusive by construction
   because `context` holds either a binding or the sentinel, never both.
2. The sentinel is type-representable for `context` only. `lightweight` cannot hold it in any parsed,
   persisted, transported, or draft value.
3. A per-slot `undefined` means "leave unchanged" in updates and "not configured" in settings.

---

## 3. Config parsing contract — `src/config.ts`

### 3.1 `parseUtilityModelsConfig`

The exported function keeps its signature `(value: unknown, path: string): UtilityModelSettings` and
its existing checks. Only the two slot spreads change:

```ts
return {
  ...(value["lightweight"] !== undefined
    ? { lightweight: parseUtilityModelBinding(value["lightweight"], "utilityModels.lightweight", path) }
    : {}),
  ...(value["context"] !== undefined
    ? {
        context: value["context"] === UTILITY_MODEL_SESSION_ONLY
          ? UTILITY_MODEL_SESSION_ONLY
          : parseUtilityModelBinding(value["context"], "utilityModels.context", path),
      }
    : {}),
};
```

Evaluation order and accepted/rejected values:

| # | Input | Result | Message |
| --- | --- | --- | --- |
| 1 | `utilityModels` is not a non-array object | throw | `PI WEBUI config utilityModels must be an object: ${path}` (unchanged) |
| 2 | an own key other than `lightweight`/`context` | throw | `PI WEBUI config utilityModels contains unknown key "x": ${path}` (unchanged) |
| 3 | `context` is exactly `"session"` | accept | `{ context: "session" }` |
| 4 | `context` is any other string (`"Session"`, `"active"`, `""`, …) | throw | `PI WEBUI config utilityModels.context must be an object: ${path}` (from the binding parser; case-sensitive comparison) |
| 5 | `context` is a binding object | accept | `{ context: { provider, id, thinkingLevel? } }` (unchanged) |
| 6 | `lightweight` is `"session"` or any non-object | throw | `PI WEBUI config utilityModels.lightweight must be an object: ${path}` (from the binding parser; names the key) |
| 7 | `lightweight` is a binding object | accept | unchanged |
| 8 | binding object has an unknown key | throw | `PI WEBUI config utilityModels.{slot} contains unknown key "x": ${path}` (unchanged) |
| 9 | binding `thinkingLevel` is unknown | throw | `PI WEBUI config utilityModels.{slot}.thinkingLevel must be one of off, minimal, low, medium, high, xhigh, or max: ${path}` (unchanged) |

`parseUtilityModelBinding` itself is unchanged: it still requires an object with `provider`, `id`, and
optional `thinkingLevel`, and still rejects unknown keys and unknown levels.

### 3.2 Load, save, and reload behavior

- `loadPiWebUiConfig` calls `parsePiWebUiConfig(..., { allowInvalidUtilityModels: true })`. A malformed
  subtree (rows 1–2 and 4–9) therefore does not fail the loading process: `config.utilityModels`
  becomes `undefined` and `utilityModelsError` carries the message. A well-formed sentinel subtree
  loads as `{ context: "session" }` with no error. This is what makes an old daemon that predates the
  sentinel report a `configError` instead of crashing.
- `savePiWebUiConfig` normalizes through `parsePiWebUiConfig(piWebUiConfigRecord(config), path)` with
  validation enabled, so a save containing the sentinel succeeds while a save containing an invalid
  Context value fails. `piWebUiConfigRecord` copies `config.utilityModels` verbatim, and the merged
  write replaces the slot subtree (`delete existing["utilityModels"]` when the normalized record has
  a `utilityModels` value, then merges it back). No change is made to that path.
- `replacePiWebUiUtilityModels(utilityModels, options)` carries `UtilityModelSettings` unchanged and
  therefore accepts `{ context: "session" }` after the type widening.
- Reload behavior is unchanged: every resolver/service operation calls `loadConfig()`/`loadPiWebUiConfig`
  per operation, so a saved sentinel applies to the next utility operation. The only restart-gated
  part is the daemon-side short-circuit code (§12).
- `savePiWebUiConfig` still never deletes `utilityModels` on an unrelated save that omits it
  (the persisted subtree is preserved byte-for-byte through the merge).

---

## 4. Resolver contract — `src/server/sessions/utilityModelResolver.ts`

### 4.1 `UtilityModelInspection`

```ts
export interface UtilityModelInspection<TModel extends UtilityModelIdentity> {
  candidates: readonly ResolvedUtilityModel<TModel>[];
  /** True when the task must bypass configured candidates and use the active session model. */
  sessionModelOnly: boolean;
  unavailable?: UtilityModelUnavailable;
}
```

`sessionModelOnly` is **required** (not optional). Typed inspection fakes fail `npm run typecheck`
until they supply the field; untyped `vi.fn()` mocks compile without it but return
`sessionModelOnly: undefined` (falsy), so §10.3 names every site explicitly rather than relying on
the compiler sweep alone; see §10.3 and §11.2.

`UtilityModelResolver`, `UtilityModelAttempt`, `ResolvedUtilityModel`, `UtilityModelUnavailable`, and
`runWithUtilityModelFallback` keep their existing shapes and behavior.

### 4.2 `inspect` short-circuit placement and return sites

The short-circuit is placed after the config-error and unset-config checks and before the available
model snapshot is read:

```ts
await deps.modelRuntime.refresh({ allowNetwork: false });
const config = deps.loadConfig();
if (config.utilityModelsError !== undefined) {
  return { candidates: [], sessionModelOnly: false, unavailable: { reason: "config-invalid", detail: config.utilityModelsError } };
}
if (config.utilityModels === undefined) {
  return { candidates: [], sessionModelOnly: false, unavailable: { reason: "slot-unset" } };
}
if (task === "context" && config.utilityModels.context === UTILITY_MODEL_SESSION_ONLY) {
  return { candidates: [], sessionModelOnly: true };
}
const available = deps.modelRuntime.getAvailableSnapshot();
const candidates: ResolvedUtilityModel<TModel>[] = [];
const seen = new Set<string>();
let slotFailure: UtilityModelUnavailable | undefined;
for (const slot of taskSlots[task]) {
  const reference = config.utilityModels[slot];
  if (reference === undefined) {
    slotFailure ??= { reason: "slot-unset" };
    continue;
  }
  if (typeof reference === "string") {
    // Defensive only: the Context sentinel returned above, and Lightweight is
    // typed as a binding, so no parsed configuration reaches this branch.
    // Never dereference a sentinel as a binding.
    slotFailure ??= { reason: "slot-unset" };
    continue;
  }
  // …existing binding resolution unchanged: catalog lookup, effective level,
  // dedupe, candidate push; every remaining return below…
}
```

Every return site with its required value:

| # | Condition | Return value |
| --- | --- | --- |
| 1 | `refresh`, `loadConfig`, or `getAvailableSnapshot` throws | `{ candidates: [], sessionModelOnly: false, unavailable: { reason: "resolution-failed", detail } }` |
| 2 | `config.utilityModelsError !== undefined` | `{ candidates: [], sessionModelOnly: false, unavailable: { reason: "config-invalid", detail } }` |
| 3 | `config.utilityModels === undefined` | `{ candidates: [], sessionModelOnly: false, unavailable: { reason: "slot-unset" } }` |
| 4 | `task === "context"` and `config.utilityModels.context === "session"` | `{ candidates: [], sessionModelOnly: true }` — **no `unavailable` key** (the state is valid and deliberate) |
| 5 | at least one candidate resolved | `{ candidates, sessionModelOnly: false }` |
| 6 | no candidate and no slot failure | `{ candidates: [], sessionModelOnly: false, unavailable: slotFailure ?? { reason: "resolution-failed" } }` |

Consequences:

- `configuredCandidates("context")` returns `[]` in session-only mode because it is the thin wrapper
  `async (task) => (await inspect(task)).candidates`.
- The Context candidate loop gains a `typeof reference === "string"` guard that treats the value as a
  skipped slot. The guard is defensive: row 4 returns before the loop for every Context sentinel, and
  `lightweight` is typed as a binding, so no parsed configuration reaches it. It exists so the widened
  `UtilityModelSettings` type needs no cast or unchecked index, and it never runs in the resolved
  session-only path.
- `inspect("lightweight")` is unaffected by the sentinel: `taskSlots.lightweight` remains
  `["lightweight"]`, and row 4 never matches a lightweight task.
- Configuration errors keep precedence: a config object that carries both `utilityModelsError` and a
  session-only Context reports `config-invalid` with `sessionModelOnly: false` (row 2 before row 4).
  This precedence is directly testable because the resolver harness accepts both fields.
- `runWithUtilityModelFallback` is unchanged. It has no Context caller today and this design adds
  none; compaction routing stays inside the extension because the helper requires a caller-supplied
  attempt with a thinking level and could defeat the active-session thinking-level guarantee.

---

## 5. Extension contract — `src/server/sessions/utilityModelExtension.ts`

### 5.1 `sessionBeforeCompact` control flow

The handler becomes exactly:

```ts
sessionBeforeCompact: async (event, ctx) => {
  if (ctx.model === undefined) return undefined;

  const inspection = await deps.resolver.inspect("context");
  if (inspection.sessionModelOnly) return undefined; // Pi compacts with the active session model

  const refs = availableRefs(deps.refs);
  if (refs === undefined) return undefined;

  let retry: ReturnType<AvailableRuntimeRefs["settingsManager"]["getRetrySettings"]>;
  try {
    retry = refs.settingsManager.getRetrySettings();
  } catch (error) {
    logNoThrow(deps.logger, { err: error, task: "context" }, "utility model runtime refs failed");
    return undefined;
  }

  for (const candidate of inspection.candidates) {
    // …unchanged candidate loop: abort → { cancel: true }, getAuth, compact, logCandidateFailure…
  }
  return undefined;
},
```

Ordering facts that must hold:

1. `ctx.model === undefined` precedes everything; it keeps returning `undefined` in every state, so Pi
   reports its existing "no model selected" error.
2. `deps.resolver.inspect("context")` is called once and its result is the only routing input. The
   handler no longer calls `configuredCandidates("context")`.
3. The session-only return precedes the `availableRefs(deps.refs)` check. This moves `inspect` (and
   its resolver-level refresh/config logging) before the degraded-refs path: a missing stream function
   or settings manager now still performs one inspection before returning `undefined`. That reorder is
   the design's pseudocode order; §13 advisory 3 requires it to be documented and tested, which §5.2
   and §10.4 do.
4. The session-only return precedes `getRetrySettings`, `getAuth`, `compact`, and the candidate loop.
5. Abort handling stays where it is: the handler starts no candidate work after `event.signal` is
   aborted; Pi's own compaction observes the aborted signal. `inspect` may still run first (§5.4).

### 5.2 No-work guarantees for session-only compaction

For an inspection with `sessionModelOnly: true`, the handler must not, under any input:

- call `modelRuntime.getAuth`;
- call `settingsManager.getRetrySettings` or `getBranchSummarySettings`;
- call the injected `compact`;
- call `streamFunction` or construct the utility stream wrapper;
- emit `logCandidateFailure` / any `logger.info` record (resolver-level config/catalog failure logging
  inside `inspect` is not candidate work and keeps its existing behavior).

The handler returns `undefined`, which makes Pi run `_runDefaultCompaction(preparation, this.model, …)`
with the session's current model and thinking level resolved at compaction time.

### 5.3 `sessionBeforeTree` unchanged

The lightweight handler keeps its current sequence and keeps calling
`deps.resolver.configuredCandidates("lightweight")`. A session-only Context setting changes nothing
about titles or branch summaries.

### 5.4 Abort and model-switch behavior

- With `sessionModelOnly: true` and an already-aborted `event.signal`, the handler returns `undefined`
  with no candidate work. `inspect` may refresh the local model snapshot before the return; tests
  assert that `compact`, `getAuth`, and `getRetrySettings` were never called rather than asserting that
  nothing ran (design's abort wording, advisory 1-adjacent).
- `ctx.model` is only a presence gate for compaction; the handler is model-agnostic. Different
  `ctx.model` values, and `reason: "manual"` vs `reason: "threshold"`, must produce identical
  session-only results. Pi owns the trigger kind and the active-session model/thinking resolution.

---

## 6. Settings service and route contracts

### 6.1 `src/server/sessions/utilityModelSettingsService.ts`

- Both public methods change return type to `Promise<UtilityModelSettingsResponseV3>`:

```ts
export interface UtilityModelSettingsService {
  inspect(): Promise<UtilityModelSettingsResponseV3>;
  update(patch: UtilityModelSettingsUpdate): Promise<UtilityModelSettingsResponseV3>;
}
```

- `responseFor` returns `contractVersion: 3` from every branch (the `configError` branch and the
  normal branch). `UtilityModelOptionV2[]` stays the model option projection.
- `updateSettings` keeps its atomic validate-then-save behavior; its per-slot patch application is
  unchanged in shape (own-property `lightweight`, then own-property `context`; `null` deletes; a value
  assigns). `next` is a `UtilityModelSettings`, so `context: "session"` assigns directly.
- `validationFor("context", settings, models)`:

```ts
const configured = settings[slot];
if (configured === undefined) return { valid: true };
if (configured === UTILITY_MODEL_SESSION_ONLY) return { valid: true };
// …existing binding lookup and explicit-level checks, unchanged…
```

  The sentinel is valid without looking at the catalog because the session's model is not a catalog
  selection. `lightweight` can never carry the sentinel through the config parser or route parser, so
  the branch is reachable only for `context`.
- A patched invalid binding keeps failing validation and throws before `saveConfig`; the thrown message
  is the existing `invalidSlots.join("; ")` shape.
- `inspect` still refreshes the catalog with `{ allowNetwork: false }` first and returns the confirmed
  post-save inspection after `update`.

### 6.2 `GET /utility-models`

Returns the v3 service snapshot unchanged:

- `contractVersion: 3`;
- `settings.context` is a binding, the sentinel, or omitted;
- `slots.context` is `{ valid: true }` when the setting is the sentinel;
- `models` is `UtilityModelOptionV2[]`;
- `configError` is present when the persisted config is malformed, and all slots are invalid;
- `valid` is true only when both slots validate.

### 6.3 `PUT /utility-models`

Request envelope unchanged: exactly one own property `settings`, which must be an object. Body-level
errors keep their existing messages: `Expected object body`, `settings is required`, `unknown field
"x"; expected exactly settings`, `settings must be an object`, `unknown utility model slot "x"`.

Per-slot parsing is explicit (two keys, no generic slot loop), so the sentinel is accepted only for
`context`:

```ts
// …existing prelude unchanged: object-body check, exactly-one-`settings` check,
// `settings must be an object` check, and the unknown-slot check…
const update: UtilityModelSettingsUpdate = {};
if (Object.prototype.hasOwnProperty.call(value, "lightweight")) {
  const lightweight = value["lightweight"];
  if (lightweight === null) update.lightweight = null;
  else {
    const parsed = parseUtilityModelsConfig({ lightweight }, "request body settings").lightweight;
    if (parsed === undefined) throw new Error("lightweight utility model reference is required");
    update.lightweight = parsed;
  }
}
if (Object.prototype.hasOwnProperty.call(value, "context")) {
  const context = value["context"];
  if (context === null) update.context = null;
  else if (context === UTILITY_MODEL_SESSION_ONLY) update.context = UTILITY_MODEL_SESSION_ONLY;
  else {
    const parsed = parseUtilityModelsConfig({ context }, "request body settings").context;
    if (parsed === undefined) throw new Error("context utility model reference is required");
    update.context = parsed;
  }
}
return update;
```

Accepted bodies:

- `{ "settings": { "context": "session" } }` → `{ context: "session" }`;
- `{ "settings": { "context": null } }` → `{ context: null }`;
- `{ "settings": { "context": { "provider": "acme", "id": "large", "thinkingLevel": "xhigh" } } }` →
  the binding;
- `{ "settings": { "lightweight": null } }` → `{ lightweight: null }`.

Rejected bodies (all 400, service never invoked):

- `{ "settings": { "lightweight": "session" } }` → `PI WEBUI config utilityModels.lightweight must be
  an object: request body settings`;
- `{ "settings": { "context": "active" } }` (or `"Session"`, `""`, any other non-`"session"` string) →
  `PI WEBUI config utilityModels.context must be an object: request body settings`;
- all pre-existing invalid cases (unknown slot, missing id, unknown/`auto` thinking level, extra
  binding key, unknown body field, missing/non-object `settings`).

### 6.4 HTTP status mapping

| Route | Condition | Status | Body |
| --- | --- | --- | --- |
| GET | service inspection succeeds | 200 | v3 `UtilityModelSettingsResponseV3` |
| GET | service inspection throws | 400 | `{ error: <message> }` |
| PUT | body/slot parse fails | 400 | `{ error: <path-qualified message> }` |
| PUT | service validation rejects the merged settings | 400 | `{ error: <joined slot reasons> }` |
| PUT | `PiWebUiConfigMutationBusyError` from the save coordinator | 503 | `{ error: "PI WEBUI config is busy. Try again." }` |
| PUT | success | 200 | confirmed v3 inspection |

`FEDERATED_HTTP_ROUTES` keeps exactly the two existing `/utility-models` entries.

---

## 7. Client contract

### 7.1 `src/client/src/api/parsers.ts`

- Import the sentinel as a value: `import { UTILITY_MODEL_SESSION_ONLY } from "../../../shared/apiTypes";`
  (the existing type-only import list stays).
- `parseUtilityModelSettingsResponse` dispatch gains one arm before the fallthrow:

```ts
if (record["contractVersion"] === 1) return parseUtilityModelSettingsResponseV1(record);
if (record["contractVersion"] === 2) return parseUtilityModelSettingsResponseV2(record);
if (record["contractVersion"] === 3) return parseUtilityModelSettingsResponseV3(record);
throw new Error("Invalid utility model settings contract version");
```

- `parseUtilityModelSettingsResponseV3(record)` mirrors V2: `settings: parseUtilityModelSettingsV3`,
  `models: arrayOf(parseUtilityModelOptionV2)`, `slots: parseUtilityModelSlots`,
  `valid: requireBoolean(record, "valid")`, optional `configError`.
- `parseUtilityModelSettingsV3` mirrors V2 except for the Context branch:

```ts
...(optionalField("context", record["context"] === undefined
  ? undefined
  : record["context"] === UTILITY_MODEL_SESSION_ONLY
    ? UTILITY_MODEL_SESSION_ONLY
    : parseUtilityModelBinding(record["context"], "settings.context"))),
```

  The `lightweight` branch and every other V2 branch are copied unchanged.
- Strictness rules, all throwing:
  - top-level keys must be one of `contractVersion`, `settings`, `models`, `slots`, `valid`,
    `configError` (`isUtilityModelSettingsResponseKey`, unchanged) — unknown keys rejected;
  - unknown settings slots rejected (`settings.advanced`);
  - v3 `lightweight` must be a binding object; `"session"` is rejected by `parseUtilityModelBinding`
    with `settings.lightweight`;
  - v3 `context` accepts exactly the sentinel or a binding; `"Session"`, `""`, numbers, arrays, and
    objects with unknown binding keys are rejected;
  - v3 explicit `thinkingLevel` values are validated by `parseUtilityModelBinding` against
    `KNOWN_THINKING_LEVELS`;
  - unknown contract versions (for example `4`, `"3"`) keep throwing
    `Invalid utility model settings contract version`.
- `parseUtilityModelSettingsResponseV1` and `parseUtilityModelSettingsResponseV2` are byte-compatible
  with today: they never accept the sentinel (v1 through `parseTierModelRef`, v2 through
  `parseUtilityModelBinding`), and they keep rejecting unknown keys and contract versions.

### 7.2 `src/client/src/api/clients.ts`

Import the sentinel as a value, then replace `utilityModelSettingsForContract` with version-aware
projection:

```ts
function utilityModelSettingsForContract(
  settings: UtilityModelSettingsUpdate,
  contractVersion: UtilityModelSettingsResponse["contractVersion"],
): UtilityModelSettingsUpdate {
  if (contractVersion !== 1) return settings;

  const projected: UtilityModelSettingsUpdate = {};
  if (Object.prototype.hasOwnProperty.call(settings, "lightweight")) {
    const lightweight = settings.lightweight;
    if (lightweight !== undefined) {
      projected.lightweight = lightweight === null ? null : projectBinding(lightweight);
    }
  }
  if (Object.prototype.hasOwnProperty.call(settings, "context")) {
    const context = settings.context;
    if (context === UTILITY_MODEL_SESSION_ONLY) {
      throw new Error("Cannot save the session-only Context model to a contract version 1 runtime");
    }
    if (context !== undefined) {
      projected.context = context === null ? null : projectBinding(context);
    }
  }
  return projected;
}

function projectBinding(binding: UtilityModelBinding): UtilityModelBinding {
  return { provider: binding.provider, id: binding.id };
}
```

Contract:

- v2 and v3 pass the update through unchanged (including explicit `thinkingLevel` values and the
  sentinel), so the request body is exactly `{ settings: update }`.
- v1 owns per-slot handling (advisory 6): `lightweight` and `context` are read explicitly, own
  properties survive, `undefined` is dropped, `null` stays `null`, and bindings are projected to
  `{ provider, id }` so a v1 daemon never receives a `thinkingLevel`.
- A sentinel reaching the v1 projection throws before any request is issued. The exact message is a
  specification-level choice recorded in §14; the design mandates only that it throws instead of
  silently dropping the user's choice.
- `utilityModelsApi.settings` and `utilityModelsApi.save` keep their signatures and paths
  (`${machinePrefix(machineId)}/utility-models`, application-relative, encoded machine id).
- The generic `UTILITY_MODEL_SLOTS` loop is gone, so its now-unused import is dropped from
  `clients.ts` and `strictTypeChecked` lint stays clean.

### 7.3 `src/client/src/components/settings/utilityModelSettingsDraft.ts`

Imports: the sentinel value plus `UtilityModelContextSetting`, `UtilityModelSessionOnly`,
`UtilityModelSettingsResponseV2`, and `UtilityModelSettingsResponseV3` types.

Add:

```ts
export function supportsUtilityModelThinking(
  response: UtilityModelSettingsResponse,
): response is UtilityModelSettingsResponseV2 | UtilityModelSettingsResponseV3 {
  return response.contractVersion !== 1;
}

export function updateUtilityModelDraftContextSessionOnly(
  draft: UtilityModelSettingsDraft,
): UtilityModelSettingsDraft;
```

Exact behavior changes:

1. `CompleteUtilityModelSettingsUpdate` becomes the per-slot shape:

```ts
export interface CompleteUtilityModelSettingsUpdate {
  lightweight: UtilityModelBinding | null;
  context: UtilityModelContextSetting | null;
}
```

2. `updateUtilityModelDraftContextSessionOnly(draft)` returns a clone with
   `context: UTILITY_MODEL_SESSION_ONLY` and the existing lightweight binding cloned in place. It is
   idempotent and performs no contract-version check (the panel gates availability).
3. `updateUtilityModelDraftModel(draft, slot, selected)` keeps its signature. Because it already
   routes through `draftWithSlot(draft, slot, replacement)`, selecting a model while the slot holds
   the sentinel **replaces** the sentinel with the new binding (thinking level reset/omitted as today);
   selecting inherited (`selected === undefined`) clears the slot.
4. `updateUtilityModelDraftThinkingLevel(draft, slot, level)` is a **no-op for the sentinel**: widen
   the local read to the Context union and return `cloneUtilityModelSettings(draft)` when
   `binding === undefined` **or** `binding === UTILITY_MODEL_SESSION_ONLY`, before the known-level
   check. Existing invalid-level and auto behavior is unchanged.
5. `utilityModelThinkingOptions(response, binding)` replaces `response.contractVersion !== 2` with
   `!supportsUtilityModelThinking(response)`. For a sentinel draft the panel normalizes the binding
   to `undefined`, so the function still returns `[auto]`.
6. `validateUtilityModelSlot` widens its `binding` parameter to
   `UtilityModelBinding | UtilityModelSessionOnly | undefined` and returns `{ valid: true }` for the
   sentinel before the catalog lookup. `binding === undefined` stays valid. The explicit-level gate
   changes from `response.contractVersion !== 2` to `!supportsUtilityModelThinking(response)`, so v3
   explicit levels validate exactly as v2 do.
7. `utilityModelSettingsUpdateFromDraft` emits the sentinel:

```ts
return {
  lightweight: draft.lightweight === undefined ? null : cloneBinding(draft.lightweight),
  context: draft.context === undefined ? null : cloneUtilityModelContextSetting(draft.context),
};
```

   with `cloneUtilityModelContextSetting(value)` returning the constant for the sentinel and
   `cloneBinding(value)` otherwise.
8. `cloneUtilityModelSettings` / `settingsFromBindings` / `draftWithSlot` widen the `context`
   parameter to `UtilityModelContextSetting | undefined` and preserve the sentinel verbatim.

### 7.4 `src/client/src/components/settings/settingsModelOptions.ts`

Add the special-choice interface and extend the picker option builder:

```ts
export interface SettingsSpecialModelChoice {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export function settingsModelPickerOptions(
  choices: readonly SettingsModelChoice[],
  inherited?: { readonly label: string },
  specialChoices?: readonly SettingsSpecialModelChoice[],
): CommandOption[];
```

Ordering contract:

1. special choices, in caller order, mapped to `CommandOption` (`value`, `label`, optional
   `description`), no `group`;
2. the inherited entry (`value: INHERITED_SETTINGS_MODEL_VALUE`, the supplied label) when `inherited`
   is defined;
3. the provider-sorted model options exactly as today.

Callers that pass no special choices keep their current output and order (`undefined` and `[]` are
equivalent). `CommandPicker.renderGroupedOptions` preserves array order for an ungrouped leading
option, so the mockup order renders as specified. `SettingsModelChoice`, `settingsModelKey`,
`settingsModelChoiceByKey`, `describeSettingsModel`, and `INHERITED_SETTINGS_MODEL_VALUE` are
unchanged.

### 7.5 `src/client/src/components/settings/SettingsModelPickerField.ts`

Additive properties with defaults that preserve every existing caller:

```ts
@property({ attribute: false }) specialChoices: readonly SettingsSpecialModelChoice[] = [];
@property() selectedSpecialValue = "";
@property({ attribute: false }) onSelectSpecial?: (value: string) => void;
```

Behavior:

1. Summary: `const special = this.specialChoices.find((choice) => choice.value === this.selectedSpecialValue);`
   When `special !== undefined`, the trigger summary is `special.label` and the summary is not
   rendered as empty/inherited (advisory 8): the `empty` class is applied only when
   `selected === undefined && special === undefined`, and the title is the special label.
2. Picker options: `settingsModelPickerOptions(this.choices, inheritedLabel === "" ? undefined : { label: this.inheritedLabel }, this.specialChoices)`.
3. Picker `selectedValue`: the matched special's value when `special !== undefined`; otherwise the
   existing inherited/model value.
4. `pickModel(value)`: a matching special choice closes the dialog and calls
   `onSelectSpecial(special.value)` without calling `onSelect`; the inherited value and model keys
   keep their existing handling. A special value must not be `""` and is the panel's
   responsibility to keep distinct from `INHERITED_SETTINGS_MODEL_VALUE`.
5. `showPicker`, disabled behavior, event containment, and stale-model `(unavailable)` rendering are
   unchanged.

### 7.6 `src/client/src/components/settings/SettingsUtilityModelsPanel.ts`

Import the sentinel as a value and add the module-level choice:

```ts
const CONTEXT_SESSION_ONLY_CHOICE: SettingsSpecialModelChoice = {
  value: UTILITY_MODEL_SESSION_ONLY,
  label: "Only use session model",
};
```

`renderFieldRow(slot)` changes:

1. Read the raw selection and normalize before every binding-based lookup:

```ts
const selection = this.draft[slot];
const binding = selection === UTILITY_MODEL_SESSION_ONLY ? undefined : selection;
```

   Use `binding` for `selectedOption`, `utilityModelThinkingOptions`, `.selected`, and the thinking
   value. Use the raw `this.draft` for validation (the sentinel validates as valid).
2. Thinking capability uses the shared predicate:

```ts
const thinkingCapable = supportsUtilityModelThinking(response);
const thinkingValue = thinkingCapable && selectedOption !== undefined
  ? binding?.thinkingLevel ?? AUTO_UTILITY_MODEL_THINKING
  : AUTO_UTILITY_MODEL_THINKING;
const thinkingDisabled = this.editingDisabled || !thinkingCapable || binding === undefined || selectedOption === undefined;
```

   With the sentinel selected the Context select therefore shows `auto` and is disabled; the session's
   thinking level is owned by Pi's compaction path. The `selectedOption !== undefined` conjunct is
   retained from today's code so a v2/v3 binding whose model left the catalog keeps rendering `auto`
   instead of a value its option list cannot select.
3. Special choices are v3-gated and Context-only:

```ts
const specialChoices = slot === "context" && response.contractVersion === 3
  ? [CONTEXT_SESSION_ONLY_CHOICE]
  : [];
const selectedSpecialValue = slot === "context" && selection === UTILITY_MODEL_SESSION_ONLY
  ? UTILITY_MODEL_SESSION_ONLY
  : "";
```

   The Lightweight row never receives the choice; v1/v2 responses keep today's editor exactly.
4. Bind the picker `.specialChoices`, `.selectedSpecialValue`, and
   `.onSelectSpecial=${(value) => this.onSpecialPicked(slot, value)}`, where
   `onSpecialPicked` sets `this.draft = updateUtilityModelDraftContextSessionOnly(this.draft)` for
   `slot === "context" && value === UTILITY_MODEL_SESSION_ONLY`.
5. Save/validation path unchanged: selection is a draft edit; nothing persists until **Save utility
   models**, and `utilityModelSettingsUpdateFromDraft` emits `context: "session"`.

The existing `SLOT_DETAILS.context.emptyLabel` (`Use lightweight, then active session model`) and
`SLOT_DETAILS.lightweight` stay exactly as they are.

### 7.7 `src/client/src/components/SettingsDialog.ts`

No logic change. `loadUtilityModelsForTarget` stores the v3 response; `saveUtilityModels` passes
`loadedResponse.contractVersion` (now `3`) to `utilityModelsApi.save` and merges the confirmed
`response.settings` into `config`/`effectiveConfig` as today. A thrown v1 projection guard is caught by
the existing save `catch` and surfaced through `utilityModelsError` rather than degrading silently.

---

## 8. Behavior contracts and state transitions

### 8.1 Configuration states and routing

| `utilityModels.context` | State | Compaction attempts, in order |
| --- | --- | --- |
| absent | inherited (unchanged) | `["context", "lightweight"]` candidates, then Pi's active session model |
| `{ provider, id, thinkingLevel? }` | fixed model (unchanged) | that binding, then Lightweight, then Pi's active session model |
| `"session"` | session-only (new) | Pi's active session model only |

`utilityModels.lightweight` accepts only a binding object; the state pair is mutually exclusive.

### 8.2 Draft state transitions

| Current draft | Operation | Resulting draft |
| --- | --- | --- |
| `context` absent (inherited) | pick **Only use session model** | `{ context: "session" }` |
| `context: "session"` | pick a model | `{ context: <binding without retained thinking level> }` (sentinel replaced) |
| `context: "session"` | pick the inherited entry | slot cleared; JSON update emits `context: null` |
| `context: <binding>` | pick **Only use session model** | `{ context: "session" }`; the previous binding is not remembered |
| `context: "session"` | change Thinking | unchanged (no-op clone); the select renders `auto` and disabled |
| any | Save utility models | complete update `{ lightweight: <binding\|null>, context: <binding\|"session"\|null> }` |
| any | response reload (`willUpdate`) | draft reset from `utilityModelSettingsDraftFromResponse` |

### 8.3 Sentinel semantics (advisory 5)

- `updateUtilityModelDraftModel(draft, "context", selected)`: **replace**. A model selection overwrites
  the sentinel; inherited clears the slot.
- `updateUtilityModelDraftThinkingLevel(draft, "context", level)`: **no-op**. It returns an equal clone
  and never attaches a `thinkingLevel` to the sentinel.
- `updateUtilityModelDraftContextSessionOnly(draft)`: sets the sentinel in one step.
- `utilityModelSettingsUpdateFromDraft`: converts the sentinel to the literal `"session"` and converts
  an absent slot to `null`.

### 8.4 Rolling compatibility

| Client | Daemon | Behavior |
| --- | --- | --- |
| new | v3 | full functionality; the Context picker offers **Only use session model** |
| new | v2 | option hidden; existing editor and routing unchanged; thinking levels validate exactly as v2 |
| new | v1 | thinking-level upgrade notice as today; option hidden; auto-only thinking |
| old | v3 | the old parser rejects the unknown contract version and shows a utility-models error, matching the v1→v2 precedent |
| any | config contains `"session"`, daemon older than v3 | the old daemon's config parser reports `utilityModelsError`; the resolver reports `config-invalid` and Pi compacts with the session model |

---

## 9. Error behavior (every user-visible path)

| # | Path | Condition | Behavior |
| --- | --- | --- | --- |
| 1 | Config load (any process) | invalid `utilityModels.context` value (non-`"session"` string) | `utilityModelsError` = `PI WEBUI config utilityModels.context must be an object: ${path}`; `config.utilityModels` undefined |
| 2 | Config save | same, through `replacePiWebUiUtilityModels` or `PUT` | throws the same message; request fails with 400 |
| 3 | Config load | `lightweight: "session"` | `PI WEBUI config utilityModels.lightweight must be an object: ${path}` |
| 4 | Session daemon (old) | config contains `"session"` | config parser rejects the string; resolver reports `config-invalid`; compaction runs Pi's default path on the session model |
| 5 | Resolver | `utilityModelsError` present | `config-invalid` inspection, `sessionModelOnly: false`, no candidates; the extension falls through to Pi's default compaction; logging unchanged |
| 6 | Route `PUT /utility-models` | `lightweight: "session"` | 400 `PI WEBUI config utilityModels.lightweight must be an object: request body settings`; service not invoked |
| 7 | Route `PUT /utility-models` | unknown Context string | 400 `PI WEBUI config utilityModels.context must be an object: request body settings`; service not invoked |
| 8 | Route `PUT /utility-models` | other parse errors | existing 400 messages (body/slot/level/unknown-key) |
| 9 | Route `PUT /utility-models` | merged settings invalid | 400 joined slot reasons; nothing saved |
| 10 | Route `PUT /utility-models` | coordinator busy | 503 `PI WEBUI config is busy. Try again.` |
| 11 | Service `GET/PUT` | catalog refresh failure | existing thrown-message → 400 path |
| 12 | Client save | v1 projection receives the sentinel | throws `Cannot save the session-only Context model to a contract version 1 runtime` before any request; the dialog surfaces it through `utilityModelsError` |
| 13 | Client load | old client + v3 daemon | `Invalid utility model settings contract version`; settings panel shows the load error |
| 14 | Client load | new client + v1/v2 daemon | parses; the session-only choice is not rendered |
| 15 | Client panel | v1 runtime with an explicit level | existing upgrade notice; auto-only thinking; save still works |
| 16 | Compaction | session-only, aborted signal | no candidate work; Pi's own compaction observes the aborted signal and cancels |
| 17 | Compaction | session-only, Pi compaction fails | Pi's own compaction error surfaces unchanged; PI WEBUI adds no fallback attempt and no failure path |
| 18 | Compaction | `ctx.model === undefined` | returns `undefined` in every state; Pi reports its existing "no model selected" error |

---

## 10. Test specification

Tests are written RED-first at the smallest layer that proves each contract, per
`.agents/skills/testing-guide/SKILL.md`. Run commands from the repository root. The RED order is:

1. `src/config.test.ts`, `src/client/src/api/parsers.test.ts` (config/parser contracts);
2. `src/server/sessions/utilityModelResolver.test.ts` (inspection contract);
3. `src/server/sessions/utilityModelExtension.test.ts` (routing contract);
4. `src/server/sessions/utilityModelSettingsService.test.ts`,
   `src/server/sessions/utilityModelSettingsRoutes.test.ts`;
5. `src/client/src/api/clients.test.ts`, `utilityModelSettingsDraft.test.ts`,
   `settingsModelOptions.test.ts`, `SettingsModelPickerField.test.ts`,
   `SettingsUtilityModelsPanel.test.ts`, `SettingsDialog.utilitymodels.test.ts`;
6. `npm run typecheck` to expose every stale inspection fake (§11.2).

Assertions below are the required minimum; incidental extras are allowed if they stay observable.

### 10.1 Config parsing and persistence — `src/config.test.ts`

Harness: existing temp `configPath` + `testOptions()`.

| Test | Fixture | Assertion |
| --- | --- | --- |
| accepts the sentinel and round-trips parse → save → reload | `replacePiWebUiUtilityModels({ context: UTILITY_MODEL_SESSION_ONLY }, testOptions())`, then `loadPiWebUiConfig(testOptions())` | saved `config.utilityModels` deep-equals `{ context: "session" }`; raw file JSON has `utilityModels.context === "session"`; reloaded `config.utilityModels` deep-equals it and `utilityModelsError` is `undefined` |
| preserves the sentinel beside a lightweight binding | `replacePiWebUiUtilityModels({ lightweight: { provider: "acme", id: "small", thinkingLevel: "low" }, context: UTILITY_MODEL_SESSION_ONLY })` | reload deep-equals the input object |
| rejects the sentinel for lightweight | `parseUtilityModelsConfig({ lightweight: UTILITY_MODEL_SESSION_ONLY }, configPath)` | throws `/utilityModels\.lightweight must be an object/` |
| rejects other Context strings | `{ context: "lightweight" }`, `{ context: "Session" }`, `{ context: "" }` | throws `/utilityModels\.context must be an object/` |
| keeps binding round-trip and unknown-key behavior | existing `it.each` rows plus the round-trip test | unchanged existing assertions still pass |
| malformed subtree stays non-fatal on load and is reportable | file `{ "utilityModels": { "context": "active" } }` | `loadPiWebUiConfig` does not throw; `config.utilityModels` undefined; `utilityModelsError` contains `utilityModels.context` |

### 10.2 Resolver — `src/server/sessions/utilityModelResolver.test.ts`

Update every existing whole-inspection assertion to include `sessionModelOnly: false` (`reports an
unset slot`, `reports an invalid utility configuration with its detail`, `reports a configured model
missing from the catalog`, `reports an explicitly configured level the model does not support`,
`reports a resolution failure and logs it without throwing`, and `reports a config load failure as
resolution-failed`). The parity test keeps its `configuredCandidates` equality and the
`omits unavailable when a candidate resolves` test keeps asserting the resolved candidate. New cases:

| Test | Fixture | Assertion |
| --- | --- | --- |
| returns the session-only inspection for Context | `createHarness({ utilityModels: { context: UTILITY_MODEL_SESSION_ONLY } })` | `inspect("context")` resolves `{ candidates: [], sessionModelOnly: true }`; `Object.hasOwn(inspection, "unavailable")` is `false`; `configuredCandidates("context")` resolves `[]` |
| keeps Lightweight resolution under a session-only Context | `createHarness({ utilityModels: { lightweight: { provider: "acme", id: "small" }, context: UTILITY_MODEL_SESSION_ONLY } })` | `inspect("lightweight")` returns one candidate with `sessionModelOnly: false` |
| never reports session-only for the inherited or fixed states | `createHarness({})`, `createHarness({ utilityModels: {} })`, `createHarness({ utilityModels: { context: { provider: "acme", id: "context" } } })` | every inspection has `sessionModelOnly: false`; existing unavailable outcomes unchanged |
| keeps configuration-error precedence over the sentinel | `createHarness({ utilityModelsError: "utilityModels.lightweight.id is required", utilityModels: { context: UTILITY_MODEL_SESSION_ONLY } })` | `inspect("context")` reports `config-invalid` with `sessionModelOnly: false`, no candidates |
| the sentinel is not a slot failure for the fixed chain | session-only Context plus a fixed Lightweight | `inspect("context")` has no `unavailable` and no Lightweight candidate |

### 10.3 Typecheck-driven inspection-fake updates

Every literal typed as `UtilityModelResolver` must add `sessionModelOnly` to its `inspect` result
(`false` unless the test is specifically exercising session-only). Exact sites:

| File | Site |
| --- | --- |
| `src/server/sessions/utilityModelExtension.test.ts` | `resolverFor` helper (see §10.4) |
| `src/server/sessions/utilityModelResolver.test.ts` | the two `UtilityModelResolver<FakeModel>` literals used with `runWithUtilityModelFallback` |
| `src/server/sessions/piSessionService.modelPolicy.test.ts` | `fallbackResolver` helper, `defaultUtilityModelResolver`, and the `resolver.inspect.mockImplementation` in "propagates a fallback re-validation refresh failure untouched" |
| `src/server/sessions/piSessionService.promptQueue.test.ts` | `utilityResolverFor` helper |
| `src/server/sessions/piSessionService.rateLimits.test.ts` | the two `createDefaultRuntimeFactory` resolver literals |
| `src/server/speechInput/speechInputPolishingService.test.ts` | the two `UtilityModelResolver<Model<Api>>` literals |
| `src/server/speechInput/speechInputPolishingService.rateLimits.test.ts` | `candidateResolver` helper |

`piSessionService.delegationTools.test.ts` is **not** affected: its `inspect` belongs to the
model-policy capability, not `UtilityModelResolver`. Untyped `vi.fn()` mocks (for example the
resolver helpers in `piSessionService.promptQueue.test.ts`, `piSessionService.rateLimits.test.ts`,
and `speechInputPolishingService.rateLimits.test.ts`) compile without the field; they are named in
the table because they silently return `undefined` instead of failing the typecheck sweep.

### 10.4 Extension — `src/server/sessions/utilityModelExtension.test.ts`

Fixture changes:

- `resolverFor(candidates, options)` gains a second optional argument and a spy-able `inspect`:

```ts
function resolverFor(
  candidates: Partial<Record<"lightweight" | "context", readonly ResolvedUtilityModel<Model<Api>>[]>>,
  options: { sessionModelOnly?: boolean } = {},
) {
  const configuredCandidates = vi.fn((task: "lightweight" | "context") =>
    Promise.resolve(candidates[task] ?? []));
  const inspect = vi.fn(async (task: "lightweight" | "context") => ({
    candidates: candidates[task] ?? [],
    sessionModelOnly: options.sessionModelOnly === true && task === "context",
  }));
  return { inspect, configuredCandidates };
}
```

`inspect` builds candidates directly instead of delegating to the `configuredCandidates` spy, so the
compact-path assertion "`configuredCandidates` is not called" is satisfiable and meaningful;
`configuredCandidates` remains the spy used by the lightweight branch-summary handler.
```

- `compactEvent` accepts a `reason?: SessionBeforeCompactEvent["reason"]` override.
- For the no-work assertions, build refs with spies rather than the shared `runtimeRefs` helper:
  `streamFunction = vi.fn()`, `getRetrySettings = vi.fn(() => retry)`,
  `getBranchSummarySettings = vi.fn(() => ({ reserveTokens: 1_024, skipPrompt: false }))`.

Required tests:

| Test | Setup | Assertion (falsifiable) |
| --- | --- | --- |
| session-only with a **non-empty** candidate list starts no candidate work | `resolverFor({ context: [contextMax, lightweightLow] }, { sessionModelOnly: true })`; spy refs; `compact`, `getAuth`, `logger` spies | resolves `undefined`; `resolver.inspect` called once with `"context"`; `compact`, `getAuth`, `getRetrySettings`, `getBranchSummarySettings`, `streamFunction`, and `logger.info` are each never called. Removing the `sessionModelOnly` short-circuit makes `compact` fire, so the test cannot pass vacuously |
| manual and automatic reasons behave identically | same fake, `compactEvent({ reason: "manual" })` then `compactEvent({ reason: "threshold" })` | both resolve `undefined` with the same no-work assertions |
| different `ctx.model` values behave identically | same fake, `contextWithModel(activeModel)` then `contextWithModel(fakeModel("session", "other", true))` | both resolve `undefined`; `compact` never called (advisory 7: the same no-candidate-work assertions, or the test is deleted) |
| aborted signal starts no candidate work | session-only fake, `compactEvent({ signal: abortedController.signal })` | resolves `undefined`; `compact`, `getAuth`, and `getRetrySettings` never called (do **not** assert `inspect` was not called) |
| Lightweight handler is untouched by session-only | `resolverFor({ lightweight: [lightweightLow] }, { sessionModelOnly: true })` | `sessionBeforeTree` still returns the summary and `configuredCandidates` is called with `"lightweight"` |
| existing context candidate tests | the existing "retries same-model context…" test | the assertion `expect(resolver.configuredCandidates).toHaveBeenCalledWith("context")` flips to `expect(resolver.inspect).toHaveBeenCalledWith("context")`; `configuredCandidates` is not called for the compact path |
| degraded refs still returns undefined | session-only is **not** set; `refs` with `streamFunction`/`settingsManager` missing | resolves `undefined`; the inspection ran (advisory 3 documents this reorder) |

### 10.5 Settings service — `src/server/sessions/utilityModelSettingsService.test.ts`

- Update the harness `TestModel`/`availableModels` fixtures as needed and change every existing
  `contractVersion: 2` assertion to `contractVersion: 3`; the return type import becomes
  `UtilityModelSettingsResponseV3`. The existing `response.settings.context?.thinkingLevel` access
  in the current fixtures also fails typecheck after the widening and is narrowed explicitly.
- New cases:

| Test | Setup | Assertion |
| --- | --- | --- |
| treats the sentinel as valid and inspected | `createHarness({ utilityModels: { context: UTILITY_MODEL_SESSION_ONLY } })` | `inspect()` matches `{ contractVersion: 3, settings: { context: "session" }, slots: { lightweight: { valid: true }, context: { valid: true } }, valid: true }` (assert the snapshot only; the response builder maps every catalog model, so `thinkingLevelsForModel` call counts are not part of this row) |
| updates to the sentinel, back to a binding, back to unset | `createHarness({ utilityModels: configuredSettings })` then three `update` calls | each call returns the confirmed v3 snapshot; `harness.config().utilityModels.context` is `"session"`, then the binding, then `undefined`; `saveConfig` called once per update |
| sentinel survives a save/reload cycle | after `update({ context: UTILITY_MODEL_SESSION_ONLY })`, `inspect()` | `settings.context === "session"` and `slots.context.valid === true` |
| validation joins invalid slots with the sentinel present | sentinel context + unavailable lightweight binding | `update` rejects with the existing joined-reason message; `saveConfig` not called |

### 10.6 Settings routes — `src/server/sessions/utilityModelSettingsRoutes.test.ts`

- `snapshot()` becomes `UtilityModelSettingsResponseV3` with `contractVersion: 3`.
- New PUT cases:

| Test | Payload | Assertion |
| --- | --- | --- |
| accepts the Context sentinel | `{ settings: { context: UTILITY_MODEL_SESSION_ONLY } }` | 200; `updateMock` called exactly once with `{ context: "session" }`; response is the confirmed snapshot |
| accepts a sentinel plus a lightweight clear | `{ settings: { lightweight: null, context: UTILITY_MODEL_SESSION_ONLY } }` | `updateMock` receives `{ lightweight: null, context: "session" }` |
| rejects the sentinel for lightweight | `{ settings: { lightweight: UTILITY_MODEL_SESSION_ONLY } }` | 400 with `/utilityModels\.lightweight must be an object/`; `updateMock` not called |
| rejects unknown Context strings | `{ settings: { context: "active" } }` and `{ settings: { context: "Session" } }` | 400 with `/utilityModels\.context must be an object/`; `updateMock` not called |

All existing invalid cases, status mappings, and the federated-route assertion stay unchanged.

### 10.7 Client parser — `src/client/src/api/parsers.test.ts`

Add a `utilityModelSettingsV3Wire(overrides)` fixture mirroring the V2 wire with
`contractVersion: 3` and `settings.context: "session"` (keep explicit `thinkingLevel` on
lightweight).

| Test | Assertion |
| --- | --- |
| **replace the existing v3-rejection assertion** | the existing `parsers.test.ts` case `expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsWire({ contractVersion: 3 }))).toThrow("contract version")` is deleted (it used a v1-shaped v3 wire) and replaced by `parseUtilityModelSettingsResponse(utilityModelSettingsV3Wire())` returning the wire unchanged (deep-equal) |
| unknown versions still reject | `contractVersion: 4` and `"3"` throw `Invalid utility model settings contract version` |
| v3 sentinel parse | `settings: { context: "session", lightweight: { provider: "openai", id: "gpt", thinkingLevel: "max" } }` parses with both values intact |
| v3 binding Context parse | `settings: { context: { provider: "openai", id: "gpt", thinkingLevel: "high" } }` parses |
| v3 malformed sentinel/keys reject | `context: "Session"`, `context: ""`, `context: 3`, `settings.lightweight = "session"`, unknown settings slot, unknown binding key, unknown top-level key all throw |
| v1/v2 legacy rejection of the sentinel | `utilityModelSettingsWire({ settings: { context: "session" } })` and `utilityModelSettingsV2Wire({ settings: { context: "session" } })` both throw |
| v1/v2 legacy acceptance unchanged | existing version 1/2 tests still pass byte-for-byte |

### 10.8 Client API — `src/client/src/api/clients.test.ts`

Add a `utilityModelSettingsV3Response()` fixture (v2 shape with `contractVersion: 3` and a sentinel
Context).

| Test | Fixture | Assertion |
| --- | --- | --- |
| v3 save sends the sentinel unchanged under a nested base | `update = { lightweight: { provider: "openai", id: "gpt-small", thinkingLevel: "xhigh" }, context: UTILITY_MODEL_SESSION_ONLY }`, `save(update, 3, "remote /?")` | two encoded fetch calls to `…/api/machines/remote%20%2F%3F/utility-models`; PUT body exactly `{"settings":{"lightweight":{"provider":"openai","id":"gpt-small","thinkingLevel":"xhigh"},"context":"session"}}` |
| v3 accepts the sentinel response | `utilityModelsApi.settings("remote /?")` | resolves the v3 fixture with `settings.context === "session"` |
| v1 projection guard throws before any request | `expect(() => utilityModelsApi.save({ context: UTILITY_MODEL_SESSION_ONLY }, 1, "local")).toThrow(/contract version 1/)` | fetch mock never called |
| v1/v2 projections unchanged | existing two tests | existing exact bodies (`thinkingLevel` stripped for v1; v2 passthrough) still pass |

### 10.9 Draft helper — `src/client/src/components/settings/utilityModelSettingsDraft.test.ts`

Add `responseV3(overrides)` (same models as `responseV2`, `contractVersion: 3`).

| Test | Assertion |
| --- | --- |
| clones the sentinel | `utilityModelSettingsDraftFromResponse(responseV3({ settings: { context: "session" } }))` deep-equals `{ context: "session" }` and is not the same object |
| Thinking is a no-op on the sentinel | `updateUtilityModelDraftThinkingLevel(draft, "context", "high")` deep-equals the sentinel draft and does not add `thinkingLevel` |
| a model replaces the sentinel | `updateUtilityModelDraftModel(draft, "context", contextOption)` deep-equals `{ context: { ...contextModel } }`; a lightweight binding in the draft is preserved |
| the setter installs the sentinel | `updateUtilityModelDraftContextSessionOnly({ lightweight: { ...lightweightModel, thinkingLevel: "low" } })` deep-equals `{ lightweight: { ...lightweightModel, thinkingLevel: "low" }, context: "session" }` |
| the sentinel validates and saves | `validateUtilityModelSettingsDraft(draft, responseV3()).slots.context.valid === true`; `utilityModelSettingsUpdateFromDraft(draft, responseV3())` deep-equals `{ lightweight: null, context: "session" }` |
| v3 explicit levels match v2 | `validateUtilityModelSettingsDraft({ context: { ...contextModel, thinkingLevel: "high" } }, responseV3())` is valid; `utilityModelThinkingOptions(responseV3(), thatBinding)` deep-equals `utilityModelThinkingOptions(responseV2(), thatBinding)` |
| inherited still saves as null | sentinel draft → `updateUtilityModelDraftModel(draft, "context", undefined)` → update emits `context: null` |
| `supportsUtilityModelThinking` narrows | `const response: UtilityModelSettingsResponse = responseV1(); if (supportsUtilityModelThinking(response)) { expect(response.models[0]?.thinkingLevels).toBeDefined(); } else { expect(response.contractVersion).toBe(1); }` — this is also a compile-time predicate check (accessing `thinkingLevels` must typecheck only because the predicate narrows) |

### 10.10 Picker options — `src/client/src/components/settings/settingsModelOptions.test.ts`

| Test | Assertion |
| --- | --- |
| special choices render first, then inherited, then models | `settingsModelPickerOptions(choices, { label: "Inherited" }, [{ value: "session", label: "Only use session model" }])` yields values `["session", INHERITED_SETTINGS_MODEL_VALUE, ...modelKeys]` and groups `[undefined, undefined, ...providers]` |
| no special choices keeps the current order | `settingsModelPickerOptions(choices, { label: "Inherited" })` and `(..., [])` both start with the inherited entry |
| special choice description is optional | a choice with `description` carries it; a choice without one omits the field |

### 10.11 Picker field — `src/client/src/components/settings/SettingsModelPickerField.test.ts`

Use the existing `mountField` helper.

| Test | Assertion |
| --- | --- |
| a selected special choice replaces the empty/inherited summary | mount with `selected: undefined`, `inheritedLabel: "Inherited"`, `specialChoices: [{ value: "session", label: "Only use session model" }]`, `selectedSpecialValue: "session"` → `triggerText` is `"Only use session model"`; the trigger does not have the `empty` class |
| picking the special choice dispatches its value | open the dialog, assert the special label is first in `pickerOptionLabels`, click it → `onSelectSpecial` called with `"session"`, `onSelect` not called, dialog closed |
| model/inherited selection dispatches through `onSelect` | with the special selected, click a model → `onSelect` called with the model copy; click the inherited entry → `onSelect(undefined)` (the panel owns clearing the special state; see §10.12) |
| no special choices is today's behavior | the existing trigger/dialog tests still pass with the default empty `specialChoices` |

### 10.12 Panel — `src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts`

Add `responseV3(overrides)` (same `v2Models()`, `contractVersion: 3`).

| Test | Assertion |
| --- | --- |
| the choice is rendered only for v3 Context | `responseV2()` Context picker labels do not include `"Only use session model"`; the Lightweight picker never includes it; `responseV3()` Context picker labels start with `"Only use session model"` followed by the inherited entry |
| selecting the sentinel disables Thinking showing auto and saves it | click the special choice → `thinkingSelect(panel, "context").value === "auto"` and `disabled === true`; `thinkingSelect(panel, "lightweight")` unchanged; Save enabled; `saveButton` click → `onSave` called with `{ lightweight: { ...smallModel, thinkingLevel: "high" }, context: "session" }` |
| a model replaces the sentinel | after selecting the sentinel, select `contextModel` → Save payload `context` deep-equals `{ ...contextModel }`; the trigger no longer reads `"Only use session model"` |
| inherited clears the sentinel | after selecting the sentinel, select `"Use lightweight, then active session model"` → Save payload `context: null` |
| **v3 explicit level renders selected and enabled** (advisory 1) | `responseV3({ settings: { context: { ...contextModel, thinkingLevel: "low" } } })` → `thinkingSelect(panel, "context").value === "low"`, `disabled === false`, and `optionValues(...)` contains `"low"` |

### 10.13 Dialog — `src/client/src/components/SettingsDialog.utilitymodels.test.ts`

| Test | Assertion |
| --- | --- |
| loads and saves the new update shape with contract version 3 | `utilityModelsApi.settings` mocked to a named `utilityModelSettingsV3SentinelResponse()` fixture (v3 plus a sentinel Context, defined in this file); `save` mocked; `callDialogPromise(dialog, "saveUtilityModels", { lightweight: null, context: "session" })` → `saveSpy.mock.calls` equals `[[{ lightweight: null, context: "session" }, 3, "local"]]`; confirmed response stored |
| surfaces the v1 projection guard | load a v1 response into `utilityModelsConfigResponse`; call `saveUtilityModels({ context: "session" })` **without** mocking `save` → `utilityModelsError` contains `Cannot save the session-only Context model to a contract version 1 runtime`; `saving` is `false` |
| existing load/save/error/capability tests | unchanged |

### 10.14 Broad gates

- `npm test -- --run <each changed test file>` per file.
- `npm run typecheck` (required for §10.3 and §10.9's predicate assertion).
- `npx eslint` on each changed source/test file (or `npm run lint` when broader coverage is needed).
- `npm run verify:fast` for routine completion; `npm run verify` for the final merge/release gate.

---

## 11. Implementation file list

### 11.1 Production and documentation

| File | Change |
| --- | --- |
| `src/shared/apiTypes.ts` | sentinel constant/type, `UtilityModelContextSetting`, widened settings/update, response V3, union |
| `src/config.ts` | accept the Context sentinel; reject it for Lightweight (type widening only elsewhere) |
| `src/server/sessions/utilityModelResolver.ts` | `sessionModelOnly` on every inspection return; Context short-circuit |
| `src/server/sessions/utilityModelExtension.ts` | `inspect("context")` + session-only early return; candidate loop reads `inspection.candidates` |
| `src/server/sessions/utilityModelSettingsService.ts` | contract v3; sentinel validation |
| `src/server/sessions/utilityModelSettingsRoutes.ts` | explicit two-slot update parsing; sentinel only for Context |
| `src/client/src/api/parsers.ts` | v3 response parser and v3 settings parser with the sentinel Context branch |
| `src/client/src/api/clients.ts` | v2/v3 pass-through; v1 per-slot projection with the sentinel guard |
| `src/client/src/components/settings/utilityModelSettingsDraft.ts` | sentinel draft/update/validation; `updateUtilityModelDraftContextSessionOnly`; `supportsUtilityModelThinking` |
| `src/client/src/components/settings/settingsModelOptions.ts` | `SettingsSpecialModelChoice`; special-first option ordering |
| `src/client/src/components/settings/SettingsModelPickerField.ts` | `specialChoices`, `selectedSpecialValue`, `onSelectSpecial`, summary/pick handling |
| `src/client/src/components/settings/SettingsUtilityModelsPanel.ts` | v3 Context choice, draft normalization, thinking value/disabled gates |
| `docs/config.md` | third Context state, v3 gate, one-time restart note (§12) |
| `docs/config.html` | hand-synced mirror of the same claims |
| `.changeset/context-session-model-only.md` | minor changeset (§12) |

No change: `src/server/sessiond.ts` (the real resolver is constructed from the same
`createUtilityModelResolver` code), `src/client/src/api.ts` (the widened types are already
re-exported by name), `src/server/configRoutes.ts`, `README.md`.

### 11.2 Typecheck-driven test/fake updates

| File | Change |
| --- | --- |
| `src/server/sessions/utilityModelExtension.test.ts` | `resolverFor` returns `sessionModelOnly`; context assertion flips to `inspect` |
| `src/server/sessions/utilityModelResolver.test.ts` | `sessionModelOnly: false` in the two fallback-runner resolver literals and every inspection expectation |
| `src/server/sessions/piSessionService.modelPolicy.test.ts` | `fallbackResolver` and `defaultUtilityModelResolver` |
| `src/server/sessions/piSessionService.promptQueue.test.ts` | `utilityResolverFor` |
| `src/server/sessions/piSessionService.rateLimits.test.ts` | both resolver literals |
| `src/server/speechInput/speechInputPolishingService.test.ts` | both resolver literals |
| `src/server/speechInput/speechInputPolishingService.rateLimits.test.ts` | `candidateResolver` |

---

## 12. Documentation and release

### 12.1 `docs/config.md` (Utility models section)

Add these bullets while keeping every existing bullet and the existing fallback-chain description for
unset and fixed states:

- `context` also accepts the literal string `"session"`, shown in **Settings → Utility models** as
  **Only use session model**. In this state compaction uses the active session model and thinking
  level directly: it attempts neither the configured `context` model nor `lightweight`, and it never
  resolves a utility candidate.
- The **Only use session model** choice is offered only when the selected machine's runtime reports
  utility-model settings contract version 3. On an older remote the Context row keeps its existing
  editor and routing; an old client against a contract-3 runtime shows a utility-models error until it
  is upgraded.
- Installing this feature requires one manual `pi-webui-sessiond.service` restart
  (`systemctl --user restart pi-webui-sessiond.service`): the resolver short-circuit and the
  compaction handler are compiled into the long-lived, non-autoreloading session daemon, and ordinary
  UI/API autoreload does not load them. A saved `"session"` value keeps applying immediately on each
  subsequent utility operation after that one-time restart.

Add one example snippet (the global config example keeps its fixed Context binding; this is a
section-local illustration):

```json
{
  "utilityModels": {
    "lightweight": { "provider": "acme", "id": "small", "thinkingLevel": "low" },
    "context": "session"
  }
}
```

### 12.2 `docs/config.html`

Mirror the same three bullets and the same JSON snippet in the hand-maintained `#utility-models`
section, using `<code>` markup for key names, values, and commands. No new TOC entry is needed (the
section already exists). The claims must be textually equivalent to `docs/config.md`.

### 12.3 Changeset — `.changeset/context-session-model-only.md`

```md
---
"@hyperdreamer/pi-webui": minor
---

Add an explicit "Only use session model" Context utility routing mode. When `utilityModels.context`
is `"session"`, compaction uses the active session model and thinking level directly and attempts
neither the configured Context model nor Lightweight; unset and fixed Context routing are unchanged.
The choice appears in **Settings → Utility models** when the selected machine reports utility-model
settings contract version 3, and older clients or runtimes keep their current editor. Installing this
feature requires one manual `pi-webui-sessiond.service` restart
(`systemctl --user restart pi-webui-sessiond.service`) because the resolver short-circuit and the
compaction handler live in the long-lived, non-autoreloading session daemon.
```

### 12.4 Restart communication

Per `AGENTS.md`, the implementation handoff and release notes must repeat: this feature is not
complete until `pi-webui-sessiond.service` is restarted once on each machine, because the extension
and resolver live in the non-autoreloading daemon. The settings UI gates on the daemon's reported
contract version, so the option cannot appear before that restart.

---

## 13. Attempt-2 advisory requirements

The eight non-blocking advisories from the design's "Design review history" are carried as explicit
requirements:

| # | Advisory | Requirement in this spec | Proof |
| --- | --- | --- | --- |
| 1 | Pin the panel's `thinkingValue` gate with a v3 explicit-level render assertion | §7.6 gate uses `supportsUtilityModelThinking`; explicit level renders selected | §10.12 "v3 explicit level renders selected and enabled" |
| 2 | `supportsUtilityModelThinking` must be a type predicate (`response is V2 \| V3`) | §7.3 signature; `thinkingLevels` access stays typed | §10.9 narrowing test + `npm run typecheck` |
| 3 | `inspect`-before-refs reorders the degraded path; check refs first or document and test the order | §5.1 order chosen (design pseudocode), §5.1 item 3 documents the reorder | §10.4 "degraded refs still returns undefined" |
| 4 | Write the PUT example with the wrapper: `{ "settings": { "context": null } }` | §6.3 accepted bodies use the `settings` wrapper | §10.6 route tests |
| 5 | Sentinel semantics for `updateUtilityModelDraftThinkingLevel` (no-op) and `updateUtilityModelDraftModel` (replace) | §7.3 items 3–4; §8.3 | §10.9 sentinel tests |
| 6 | v1 projection needs explicit per-slot handling or a `projectBinding` helper | §7.2 explicit per-slot block + `projectBinding` | §10.8 v1 projection tests + guard test |
| 7 | Keep the model-switch extension test only with the same no-candidate-work assertions | §10.4 row 3 repeats the assertions | §10.4 |
| 8 | Trigger styling must consider `selectedSpecialValue` | §7.5 item 1 (summary, `empty` class, title) | §10.11 first test |

---

## 14. Open items

The design leaves the following details unstated. Where the implementation needs a concrete value,
this specification fixes one and marks it as a specification-level choice; none of them changes the
approved behavior.

1. **v1 projection guard message (specification-level choice).** The design mandates a thrown
   programming-error guard when a sentinel reaches the v1 projection, not its wording. This spec uses
   `Cannot save the session-only Context model to a contract version 1 runtime` and the corresponding
   regex in §10.8. Changing the wording is a copy change limited to `clients.ts` and that assertion.
2. **Error copy for non-`"session"` Context strings (specification-level choice).** The design does
   not define a dedicated message. This spec keeps the existing binding-parser message
   (`PI WEBUI config utilityModels.context must be an object: …`) for `"Session"`, `""`, and other
   strings; a message naming the accepted `"session"` literal would be a new UX decision, not a
   design-mandated behavior, and would require updating §3.1, §6.3, and §10.1/§10.6.
3. **`inspect` before the refs check (accepted design ordering).** Advisory 3 allowed either order.
   This spec follows the design pseudocode (inspect first) and documents the resulting degraded-path
   behavior: a resolver refresh/config read now runs before the refs check. If the PM prefers
   preserving the previous degraded-path call count exactly, the alternative is to move
   `availableRefs(deps.refs)` ahead of `inspect`, which is a design-level change because it would make
   session-only compaction depend on runtime refs being present.

---

## 15. Review history

- **Attempt 1** (reviewer `01a1292e-5ac5-762c-a364-4fa3a4a4dd75`): BLOCKED, 2 blockers.
  - **B1** — the Context candidate loop cannot stay unchanged after widening
    `UtilityModelSettings.context`: `config.utilityModels[slot].provider`/`.id` and
    `effectiveThinkingLevel(reference, …)` no longer typecheck, and
    `src/server/sessions/utilityModelResolver.ts` was missing from the value-import list. Resolved:
    §2.2 adds the resolver import; §4.2 shows the `typeof reference === "string"` defensive guard
    and a consequence bullet explaining why it is unreachable in the session-only path.
  - **B2** — the §10.4 `resolverFor` fixture delegated `inspect` to the `configuredCandidates` spy,
    making the required "`configuredCandidates` is not called for the compact path" assertion fail
    by construction. Resolved: `inspect` now builds candidates directly, and the fixture note states
    why the assertion is meaningful.
  - Advisories folded in: panel `thinkingValue` keeps `selectedOption !== undefined` (stale-model v2
    parity); dropped the non-type-representable `replacePiWebUiUtilityModels` lightweight-sentinel
    call; reworded the service test's thinking-lookup claim; corrected the operation-class and
    restart-gate scope; showed the unchanged PUT prelude in §6.3; named the dialog v3 fixture.
- **Attempt 2** (reviewer `01a1293c-6144-762c-a364-4fa87e65c37c`): **PASS, 0 blockers.** B1 and B2
  verified by an in-memory `tsc` run against the real tree (0 production diagnostics with the spec
  snippets applied); all six attempt-1 advisories verified folded in; a full generic-slot-loop sweep
  found no remaining typecheck site. Seven precision advisories folded in: the additional
  `piSessionService.modelPolicy.test.ts` mock site, the corrected typecheck-sweep rationale for
  untyped mocks, the explicit service-test narrowing site, dropping the unused
  `UTILITY_MODEL_SLOTS` import, the `UtilityModelSettingsResponseV2` predicate import, the
  picker-field test rename, and the explicit replacement of the existing v3-rejection assertion.
