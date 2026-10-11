# Context "Only use session model" Utility Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the deterministic
> subagent-driven-development controller to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit persisted `utilityModels.context: "session"` routing state so compaction uses the active session model and thinking level directly, attempting neither the configured Context model nor Lightweight, exposed through an additive utility-model settings contract version 3.

**Architecture:** A shared string sentinel (`UTILITY_MODEL_SESSION_ONLY = "session"`) narrows to the Context slot only; the config parser accepts it, the session-daemon resolver returns a session-only inspection before reading the catalog, and the compaction handler returns `undefined` before any candidate work so Pi runs its default compaction. The same union flows additively through a v3 settings service/route contract and a version-aware client parser, draft, picker, and panel gated to v3.

**Tech Stack:** TypeScript (ES2022), Node.js, Fastify, Lit, Vitest, Pi coding-agent SDK, repository-specific utility-model routing.

## Global Constraints

- Node.js 22.19.0 or newer; no new runtime dependencies. Run every command from the repository root.
- Exact shared symbols: `export const UTILITY_MODEL_SESSION_ONLY = "session" as const;`, `type UtilityModelSessionOnly = typeof UTILITY_MODEL_SESSION_ONLY`, `type UtilityModelContextSetting = UtilityModelBinding | UtilityModelSessionOnly`; `UtilityModelSettings.context?: UtilityModelContextSetting`; `UtilityModelSettingsUpdate` is the per-slot object `{ lightweight?: UtilityModelBinding | null; context?: UtilityModelContextSetting | null }`; `UtilityModelSettingsResponseV3 extends UtilityModelSettingsResponseFields { contractVersion: 3; models: UtilityModelOptionV2[] }`. Every production comparison uses the constant, never the literal `"session"`.
- `"session"` is representable only for `context`; `lightweight` accepts only a binding object, and the two states are mutually exclusive by construction.
- Contract version is 3: `GET`/`PUT /utility-models` return `contractVersion: 3`; the browser parser accepts contract versions 1, 2, and 3; v3 is the only version that carries the sentinel; v1/v2 parsers stay byte-compatible and reject it; unknown versions keep throwing `Invalid utility model settings contract version`.
- Thinking capability is v2-or-later, never exactly v2: `supportsUtilityModelThinking(response)` is the type predicate `response is UtilityModelSettingsResponseV2 | UtilityModelSettingsResponseV3` returning `response.contractVersion !== 1`; every client gate that used `=== 2` or `!== 2` moves to it, so v3 explicit levels validate and render exactly as v2 do.
- The session-only inspection is exactly `{ candidates: [], sessionModelOnly: true }` with **no** `unavailable` key; every other resolver return reports `sessionModelOnly: false`; `UtilityModelInspection.sessionModelOnly` is required, and every typed `UtilityModelResolver` test fake supplies it. Configuration errors keep precedence over the sentinel.
- Session-only compaction calls none of `modelRuntime.getAuth`, `settingsManager.getRetrySettings`, `settingsManager.getBranchSummarySettings`, the injected `compact`, `streamFunction`, or `logCandidateFailure`; `sessionBeforeCompact` returns `undefined` so Pi compacts with the active session model and thinking level resolved at compaction time. `sessionBeforeTree` (Lightweight) is unchanged in every state.
- Exact config messages (all end with `: ${path}` for a config path): `PI WEBUI config utilityModels must be an object`; `PI WEBUI config utilityModels contains unknown key "x"`; `PI WEBUI config utilityModels.context must be an object`; `PI WEBUI config utilityModels.lightweight must be an object`; `PI WEBUI config utilityModels.{slot} contains unknown key "x"`; `PI WEBUI config utilityModels.{slot}.thinkingLevel must be one of off, minimal, low, medium, high, xhigh, or max`. Every non-`"session"` Context string keeps the existing binding-parser message.
- Exact route messages: `Expected object body`; `settings is required`; `unknown field "x"; expected exactly settings`; `settings must be an object`; `unknown utility model slot "x"`; `lightweight utility model reference is required`; `context utility model reference is required`. PUT failures are 400 except `PiWebUiConfigMutationBusyError` → 503 `PI WEBUI config is busy. Try again.`; parse failures never invoke the service.
- Exact v1 projection guard message: `Cannot save the session-only Context model to a contract version 1 runtime`. The v1 projection throws synchronously before any request; v2 and v3 pass the update through unchanged.
- Picker ordering is special choices (caller order, no `group`), then the inherited entry, then provider-sorted models. The only special choice is `{ value: UTILITY_MODEL_SESSION_ONLY, label: "Only use session model" }`, offered only for the v3 Context row; the special value is never `""` and never equals `INHERITED_SETTINGS_MODEL_VALUE`.
- The default chain is unchanged: unset Context still resolves `["context", "lightweight"]`, fixed Context still resolves `[binding, lightweight]`, and Lightweight routing, titles, branch summaries, the `+` lightweight fallback, session names, and speech-input polishing are untouched. No per-session scope, no README change, no Pi active-session compaction change.
- `docs/config.md` and its hand-synced `docs/config.html` mirror must make textually equivalent user-visible claims. `README.md`, `CHANGELOG.md`, `src/server/sessiond.ts`, `src/client/src/api.ts`, and `src/server/configRoutes.ts` are not edited.
- Release record: exactly one minor changeset at `.changeset/context-session-model-only.md` for `@hyperdreamer/pi-webui`. Do not bump versions, do not edit `CHANGELOG.md`, and never run `npm publish` locally.
- Restart requirement: installing this feature requires one manual `systemctl --user restart pi-webui-sessiond.service`, because the resolver short-circuit and the compaction handler are compiled into the long-lived, non-autoreloading session daemon; ordinary UI/API autoreload does not load them. A saved `"session"` value keeps applying on each subsequent utility operation after that one-time restart. The implementation handoff and release notes must repeat this.
- Verification commands: focused `npm test -- --run <test-file>`; `npm run typecheck`; `npx eslint <changed-file>` or `npm run lint`; `npm run verify:fast` for routine completion; `npm run verify` for the final merge/release gate.
- Type-wide migration note: widening `UtilityModelSettings.context` leaves repo-wide `npm run typecheck` red until every consumer task lands. Early tasks gate on their focused Vitest file plus ESLint on their own files; the final integration task owns the `npm run typecheck` sweep and the broad gates.
- Follow `.agents/skills/testing-guide/SKILL.md` for test work, `.agents/skills/code-quality-architecture/SKILL.md` for production code, and `.agents/skills/documentation-guide/SKILL.md` for docs. Every new exported symbol must be consumed by production code in this change; no Knip ignores.

## Task 1: Shared Context sentinel types and config parsing

**Lane:** shared-config

**Implementer tier:** Standard

**Files:**

- Modify: `src/shared/apiTypes.ts:178-230` (sentinel, Context union, widened settings/update, response V3, response union)
- Modify: `src/config.ts:5` (value import `UTILITY_MODEL_SESSION_ONLY`)
- Modify: `src/config.ts:538-555` (`parseUtilityModelsConfig` accepts the sentinel for `context` only)
- Test: `src/config.test.ts:1-11` (add the sentinel value import) and `:1043` (append the new describe block)

**Interfaces:**

- Consumes: nothing; this is the first task.
- Produces: `UTILITY_MODEL_SESSION_ONLY = "session" as const`; `UtilityModelSessionOnly = typeof UTILITY_MODEL_SESSION_ONLY`; `UtilityModelContextSetting = UtilityModelBinding | UtilityModelSessionOnly`; `UtilityModelSettings.context?: UtilityModelContextSetting`; per-slot `UtilityModelSettingsUpdate`; `UtilityModelSettingsResponseV3`; `UtilityModelSettingsResponse = V1 | V2 | V3`; `parseUtilityModelsConfig(value: unknown, path: string): UtilityModelSettings` accepting `context: "session"` and rejecting it for `lightweight`.

- [ ] **Step 1: Write the failing tests**

Extend the import list at the top of `src/config.test.ts` with the value import (keep the existing type import unchanged):

```ts
import { UTILITY_MODEL_SESSION_ONLY } from "./shared/apiTypes.js";
```

Append this block at the end of `src/config.test.ts`:

```ts
describe("PI WEBUI utility model Context sentinel", () => {
  it("accepts the sentinel, persists it, and reloads it without an error", async () => {
    const saved = replacePiWebUiUtilityModels({ context: UTILITY_MODEL_SESSION_ONLY }, testOptions());

    expect(saved.config.utilityModels).toEqual({ context: "session" });
    expect(JSON.parse(await readFile(configPath, "utf8")).utilityModels).toEqual({ context: "session" });

    const reloaded = loadPiWebUiConfig(testOptions());
    expect(reloaded.config.utilityModels).toEqual({ context: "session" });
    expect(reloaded.utilityModelsError).toBeUndefined();
  });

  it("preserves the sentinel beside a lightweight binding", () => {
    const utilityModels = {
      lightweight: { provider: "acme", id: "small", thinkingLevel: "low" },
      context: UTILITY_MODEL_SESSION_ONLY,
    } satisfies UtilityModelSettings;

    replacePiWebUiUtilityModels(utilityModels, testOptions());

    expect(loadPiWebUiConfig(testOptions()).config.utilityModels).toEqual(utilityModels);
  });

  it("rejects the sentinel for lightweight", () => {
    expect(() => parseUtilityModelsConfig({ lightweight: UTILITY_MODEL_SESSION_ONLY }, configPath))
      .toThrow(/utilityModels\.lightweight must be an object/u);
  });

  it("rejects every other Context string", () => {
    for (const context of ["lightweight", "Session", ""]) {
      expect(() => parseUtilityModelsConfig({ context }, configPath))
        .toThrow(/utilityModels\.context must be an object/u);
    }
  });

  it("reports a malformed Context subtree without failing the load", async () => {
    await writeFile(configPath, `${JSON.stringify({ utilityModels: { context: "active" } }, null, 2)}\n`, "utf8");

    const loaded = loadPiWebUiConfig(testOptions());

    expect(loaded.config.utilityModels).toBeUndefined();
    expect(loaded.utilityModelsError).toContain("utilityModels.context");
  });
});
```

The existing binding round-trip, unknown-key `it.each` rows, and utility model persistence tests stay byte-for-byte; they prove the unchanged behavior.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/config.test.ts`
Expected: FAIL. The sentinel round-trip fails with `utilityModels.context must be an object`, and the sentinel-plus-lightweight case throws instead of reloading.

- [ ] **Step 3: Add the shared types**

In `src/shared/apiTypes.ts`, insert these three declarations immediately above `export interface UtilityModelBinding`:

```ts
export const UTILITY_MODEL_SESSION_ONLY = "session" as const;
export type UtilityModelSessionOnly = typeof UTILITY_MODEL_SESSION_ONLY;
export type UtilityModelContextSetting = UtilityModelBinding | UtilityModelSessionOnly;
```

Replace the existing `UtilityModelSettings` and `UtilityModelSettingsUpdate` declarations with:

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

Add this declaration immediately after `UtilityModelSettingsResponseV2`:

```ts
export interface UtilityModelSettingsResponseV3
  extends UtilityModelSettingsResponseFields {
  contractVersion: 3;
  models: UtilityModelOptionV2[];
}
```

Extend the existing response union to:

```ts
export type UtilityModelSettingsResponse =
  | UtilityModelSettingsResponseV1
  | UtilityModelSettingsResponseV2
  | UtilityModelSettingsResponseV3;
```

- [ ] **Step 4: Accept the sentinel in `parseUtilityModelsConfig`**

In `src/config.ts`, add `UTILITY_MODEL_SESSION_ONLY` to the value names of the `./shared/apiTypes.js` import (leave every type-only name as it is):

```ts
import { MODEL_TIERS, UTILITY_MODEL_SESSION_ONLY, type ModelTier, type ModelTierLadder, type PiWebUiAgentDirEnvSource, type PiWebUiConfigValues, type PiWebUiSessiondConfig, type PiWebUiSpeechInputCloudConfig, type PiWebUiSpeechInputConfig, type SpeechInputProviderPreference, type TierModelRef, type UtilityModelBinding, type UtilityModelSettings } from "./shared/apiTypes.js";
```

Replace the two slot spreads at the end of `parseUtilityModelsConfig` with:

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

`parseUtilityModelBinding` is unchanged: it still requires an object with `provider`, `id`, and an optional known `thinkingLevel`, and still rejects unknown keys and unknown levels. `parsePiWebUiConfig` keeps `allowInvalidUtilityModels: true` for loads, so a malformed subtree still yields `utilityModelsError` rather than a crash.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm test -- --run src/config.test.ts && npx eslint src/shared/apiTypes.ts src/config.ts src/config.test.ts`
Expected: PASS, including the pre-existing utility-model persistence and unknown-key cases, with no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/apiTypes.ts src/config.ts src/config.test.ts
git commit -m "feat(config): add the session-only Context sentinel types and parser"
```

## Task 2: Resolver session-only inspection

**Lane:** server-resolver

**Implementer tier:** Standard

**Files:**

- Modify: `src/server/sessions/utilityModelResolver.ts:1-6` (value import of the sentinel)
- Modify: `src/server/sessions/utilityModelResolver.ts:37-41` (required `sessionModelOnly` field)
- Modify: `src/server/sessions/utilityModelResolver.ts:86-165` (short-circuit, `sessionModelOnly` on every return, string guard)
- Test: `src/server/sessions/utilityModelResolver.test.ts:1-8` (sentinel import) `:204-307` (existing assertions gain `sessionModelOnly: false`) `:309-395` (two fallback-runner resolver literals)

**Interfaces:**

- Consumes: `UTILITY_MODEL_SESSION_ONLY = "session" as const` and `UtilityModelContextSetting` from Task 1.
- Produces: `UtilityModelInspection<TModel> { candidates: readonly ResolvedUtilityModel<TModel>[]; sessionModelOnly: boolean; unavailable?: UtilityModelUnavailable }`; `createUtilityModelResolver(deps).inspect("context")` resolving exactly `{ candidates: [], sessionModelOnly: true }` (no `unavailable` key) when `config.utilityModels.context === UTILITY_MODEL_SESSION_ONLY`, and `sessionModelOnly: false` on every other return; `configuredCandidates("context")` still resolving `[]` in that state.

- [ ] **Step 1: Write the failing tests**

In `src/server/sessions/utilityModelResolver.test.ts`, add the sentinel import next to the existing type import:

```ts
import { UTILITY_MODEL_SESSION_ONLY } from "../../shared/apiTypes.js";
```

Update the whole-inspection assertions so every expected object carries the required field. Replace the six existing bodies with:

```ts
    it("reports an unset slot", async () => {
      const empty = createHarness({});
      const emptyModels = createHarness({ utilityModels: {} });

      await expect(empty.resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: { reason: "slot-unset" },
      });
      await expect(emptyModels.resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: { reason: "slot-unset" },
      });
    });

    it("reports an invalid utility configuration with its detail", async () => {
      const { resolver } = createHarness({
        utilityModelsError: "utilityModels.lightweight.id is required",
      });

      await expect(resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: {
          reason: "config-invalid",
          detail: "utilityModels.lightweight.id is required",
        },
      });
    });

    it("reports a configured model missing from the catalog", async () => {
      const { resolver } = createHarness({
        utilityModels: { lightweight: { provider: "acme", id: "retired" } },
      });

      await expect(resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: { reason: "model-unavailable", detail: "acme/retired" },
      });
    });

    it("reports an explicitly configured level the model does not support", async () => {
      const { resolver } = createHarness(
        {
          utilityModels: {
            lightweight: { provider: "acme", id: "small", thinkingLevel: "max" },
          },
        },
        { thinkingLevelsForModel: () => ["off", "minimal"] },
      );

      await expect(resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: { reason: "thinking-level-unsupported", detail: "max" },
      });
    });

    it("reports a resolution failure and logs it without throwing", async () => {
      const error = new Error("catalog unavailable");
      const logger = { info: vi.fn() };
      const resolver = createUtilityModelResolver({
        loadConfig: () => ({
          utilityModels: { lightweight: { provider: "acme", id: "small" } },
        }),
        modelRuntime: {
          refresh: () => Promise.reject(error),
          getAvailableSnapshot: () => [lightweight],
        },
        thinkingLevelsForModel: () => supportedThinkingLevels,
        logger,
      });

      await expect(resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: { reason: "resolution-failed", detail: "catalog unavailable" },
      });
      expect(logger.info).toHaveBeenCalledWith(
        { err: error, task: "lightweight" },
        "utility model resolution failed",
      );
    });

    it("reports a config load failure as resolution-failed", async () => {
      const { resolver } = createHarness(
        {},
        { loadConfigError: new Error("config unavailable") },
      );

      await expect(resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: { reason: "resolution-failed", detail: "config unavailable" },
      });
    });
```

Insert these new cases immediately after `reports a config load failure as resolution-failed` and before `omits unavailable when a candidate resolves`:

```ts
    it("returns the session-only inspection for Context", async () => {
      const { resolver } = createHarness({
        utilityModels: { context: UTILITY_MODEL_SESSION_ONLY },
      });

      const inspection = await resolver.inspect("context");

      expect(inspection).toEqual({ candidates: [], sessionModelOnly: true });
      expect(Object.hasOwn(inspection, "unavailable")).toBe(false);
      await expect(resolver.configuredCandidates("context")).resolves.toEqual([]);
    });

    it("keeps Lightweight resolution under a session-only Context", async () => {
      const { resolver } = createHarness({
        utilityModels: {
          lightweight: { provider: "acme", id: "small" },
          context: UTILITY_MODEL_SESSION_ONLY,
        },
      });

      await expect(resolver.inspect("lightweight")).resolves.toEqual({
        candidates: [
          { model: lightweight, thinkingLevel: "minimal", slot: "lightweight" },
        ],
        sessionModelOnly: false,
      });
    });

    it("never reports session-only for the inherited or fixed states", async () => {
      const states = [
        createHarness({}),
        createHarness({ utilityModels: {} }),
        createHarness({
          utilityModels: { context: { provider: "acme", id: "large" } },
        }),
      ];

      for (const { resolver } of states) {
        expect((await resolver.inspect("lightweight")).sessionModelOnly).toBe(false);
        expect((await resolver.inspect("context")).sessionModelOnly).toBe(false);
      }
    });

    it("keeps configuration-error precedence over the sentinel", async () => {
      const { resolver } = createHarness({
        utilityModelsError: "utilityModels.lightweight.id is required",
        utilityModels: { context: UTILITY_MODEL_SESSION_ONLY },
      });

      await expect(resolver.inspect("context")).resolves.toEqual({
        candidates: [],
        sessionModelOnly: false,
        unavailable: {
          reason: "config-invalid",
          detail: "utilityModels.lightweight.id is required",
        },
      });
    });

    it("treats the sentinel as a resolved state, not a slot failure", async () => {
      const { resolver } = createHarness({
        utilityModels: {
          lightweight: { provider: "acme", id: "small" },
          context: UTILITY_MODEL_SESSION_ONLY,
        },
      });

      const inspection = await resolver.inspect("context");

      expect(inspection).toEqual({ candidates: [], sessionModelOnly: true });
      expect(Object.hasOwn(inspection, "unavailable")).toBe(false);
      expect(inspection.candidates).toEqual([]);
    });
```

In the `utility model fallback runner` describe, add `sessionModelOnly: false` to both typed resolver literals, so the first one reads:

```ts
    const resolver: UtilityModelResolver<FakeModel> = {
      inspect: vi.fn(() => Promise.resolve({ candidates: configured, sessionModelOnly: false })),
      configuredCandidates: vi.fn(() => Promise.resolve(configured)),
    };
```

and the second one reads:

```ts
    const resolver: UtilityModelResolver<FakeModel> = {
      inspect: vi.fn(() => Promise.resolve({ candidates: [configured], sessionModelOnly: false })),
      configuredCandidates: vi.fn(() => Promise.resolve([configured])),
    };
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/utilityModelResolver.test.ts`
Expected: FAIL, `returns the session-only inspection for Context` receives `{ candidates: [], unavailable: { reason: "slot-unset" } }` (or a thrown `utilityModels.context` type read), and every updated assertion is missing `sessionModelOnly`.

- [ ] **Step 3: Implement the inspection contract**

In `src/server/sessions/utilityModelResolver.ts`, add the sentinel value to the import:

```ts
import {
  UTILITY_MODEL_SESSION_ONLY,
  type UtilityModelBinding,
  type UtilityModelSettings,
  type UtilityModelSlot,
} from "../../shared/apiTypes.js";
```

Replace the `UtilityModelInspection` interface with:

```ts
export interface UtilityModelInspection<TModel extends UtilityModelIdentity> {
  candidates: readonly ResolvedUtilityModel<TModel>[];
  /** True when the task must bypass configured candidates and use the active session model. */
  sessionModelOnly: boolean;
  unavailable?: UtilityModelUnavailable;
}
```

Replace the body of `inspect` with the code below. The short-circuit sits after the config-error and unset-config checks and before the catalog snapshot; the Context loop gains a defensive string guard so the widened `UtilityModelSettings` type needs no cast:

```ts
  const inspect = async (
    task: UtilityModelTask,
  ): Promise<UtilityModelInspection<TModel>> => {
    try {
      await deps.modelRuntime.refresh({ allowNetwork: false });
      const config = deps.loadConfig();
      if (config.utilityModelsError !== undefined) {
        return {
          candidates: [],
          sessionModelOnly: false,
          unavailable: {
            reason: "config-invalid",
            detail: config.utilityModelsError,
          },
        };
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
        const candidate = available.find(
          (model) =>
            model.provider === reference.provider && model.id === reference.id,
        );
        if (candidate === undefined) {
          slotFailure ??= {
            reason: "model-unavailable",
            detail: `${reference.provider}/${reference.id}`,
          };
          continue;
        }
        const thinkingLevel = effectiveThinkingLevel(
          reference,
          deps.thinkingLevelsForModel(candidate),
        );
        if (thinkingLevel === undefined) {
          slotFailure ??= {
            reason: "thinking-level-unsupported",
            detail: reference.thinkingLevel ?? "",
          };
          continue;
        }
        const resolved = { model: candidate, thinkingLevel, slot };
        const key = attemptKey(resolved);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(resolved);
      }
      if (candidates.length > 0) return { candidates, sessionModelOnly: false };
      return {
        candidates: [],
        sessionModelOnly: false,
        unavailable: slotFailure ?? { reason: "resolution-failed" },
      };
    } catch (error) {
      logNoThrow(
        deps.logger,
        { err: error, task },
        "utility model resolution failed",
      );
      return {
        candidates: [],
        sessionModelOnly: false,
        unavailable: {
          reason: "resolution-failed",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };
```

`configuredCandidates`, `runWithUtilityModelFallback`, `effectiveThinkingLevel`, `attemptKey`, and `logNoThrow` are unchanged.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/server/sessions/utilityModelResolver.test.ts && npx eslint src/server/sessions/utilityModelResolver.ts src/server/sessions/utilityModelResolver.test.ts`
Expected: PASS, including the pre-existing candidate-resolution and fallback-runner cases, with no lint errors. Repo-wide `npm run typecheck` stays red on the not-yet-migrated consumer files; that is expected until the integration task.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/utilityModelResolver.ts src/server/sessions/utilityModelResolver.test.ts
git commit -m "feat(sessions): report session-only Context inspections"
```

## Task 3: Session-only compaction early return

**Lane:** server-resolver

**Implementer tier:** Advanced

**Files:**

- Modify: `src/server/sessions/utilityModelExtension.ts:189-205` (`sessionBeforeCompact` inspects once and returns early; the candidate loop reads `inspection.candidates`)
- Test: `src/server/sessions/utilityModelExtension.test.ts:220-268` (flip the context assertion to `inspect`) `:429-465` (append the session-only tests) `:463-477` (`resolverFor` gains `inspect` and `sessionModelOnly`) `:529-550` (`compactEvent` gains a `reason` override)

**Interfaces:**

- Consumes: `UtilityModelInspection<TModel> { candidates; sessionModelOnly: boolean; unavailable?: UtilityModelUnavailable }` and `createUtilityModelResolver(...).inspect("context")` from Task 2; the unchanged `createUtilityModelHandlers(deps: UtilityModelExtensionDependencies): UtilityModelHandlers`; `UtilityModelResolver<Model<Api>>[`inspect`]`.
- Produces: `sessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: UtilityModelHandlerContext): Promise<UtilityCompactionHandlerResult | undefined>` that (1) returns `undefined` for `ctx.model === undefined`, (2) calls `deps.resolver.inspect("context")` exactly once, (3) returns `undefined` before `availableRefs`, retry settings, auth, streams, and candidates when `inspection.sessionModelOnly` is `true`, and (4) otherwise behaves exactly as before over `inspection.candidates`. `sessionBeforeTree` is unchanged.

- [ ] **Step 1: Write the failing tests**

Replace `resolverFor` in `src/server/sessions/utilityModelExtension.test.ts` with:

```ts
function resolverFor(
  candidates: Partial<
    Record<"lightweight" | "context", readonly ResolvedUtilityModel<Model<Api>>[]>
  >,
  options: { sessionModelOnly?: boolean } = {},
) {
  const configuredCandidates = vi.fn((task: "lightweight" | "context") =>
    Promise.resolve(candidates[task] ?? []),
  );
  const inspect = vi.fn(async (task: "lightweight" | "context") => ({
    candidates: candidates[task] ?? [],
    sessionModelOnly: options.sessionModelOnly === true && task === "context",
  }));
  return { inspect, configuredCandidates };
}
```

`inspect` builds candidates directly instead of delegating to the `configuredCandidates` spy, so the compact-path assertion "`configuredCandidates` is not called" is satisfiable and meaningful; `configuredCandidates` remains the spy used by the lightweight branch-summary handler.

In the `utility model compaction handler` describe, inside the first test, replace the context assertion with:

```ts
    expect(resolver.inspect).toHaveBeenCalledWith("context");
    expect(resolver.configuredCandidates).not.toHaveBeenCalled();
```

Append these tests at the end of the `utility model compaction handler` describe, after `stops candidate iteration and cancels when aborted`:

```ts
  it("starts no candidate work when the inspection is session-only", async () => {
    const retry = { enabled: true, maxRetries: 2, baseDelayMs: 10, maxAgentDelayMs: 60_000 };
    const streamFunction = vi.fn<StreamFn>();
    const getRetrySettings = vi.fn(() => retry);
    const getBranchSummarySettings = vi.fn(() => ({ reserveTokens: 1_024, skipPrompt: false }));
    const getAuth = vi.fn(() => Promise.resolve({ auth: { apiKey: "test-key" } }));
    const compact = vi.fn<CompactFn>(() => Promise.resolve(compactionResult));
    const logger = { info: vi.fn() };
    const resolver = resolverFor(
      { context: [contextMax, lightweightLow] },
      { sessionModelOnly: true },
    );
    const handlers = createUtilityModelHandlers({
      resolver,
      modelRuntime: { getAuth },
      refs: {
        streamFunction,
        settingsManager: { getRetrySettings, getBranchSummarySettings },
      },
      generateBranchSummary: successfulBranchSummary(),
      compact,
      logger,
    });

    await expect(
      handlers.sessionBeforeCompact(compactEvent(), contextWithModel(activeModel)),
    ).resolves.toBeUndefined();

    expect(resolver.inspect).toHaveBeenCalledOnce();
    expect(resolver.inspect).toHaveBeenCalledWith("context");
    expect(resolver.configuredCandidates).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
    expect(getRetrySettings).not.toHaveBeenCalled();
    expect(getBranchSummarySettings).not.toHaveBeenCalled();
    expect(streamFunction).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("treats manual and automatic compaction identically in session-only mode", async () => {
    const retry = { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 60_000 };
    const getRetrySettings = vi.fn(() => retry);
    const getAuth = vi.fn(() => Promise.resolve({ auth: { apiKey: "test-key" } }));
    const compact = vi.fn<CompactFn>(() => Promise.resolve(compactionResult));
    const resolver = resolverFor(
      { context: [contextMax, lightweightLow] },
      { sessionModelOnly: true },
    );
    const handlers = createUtilityModelHandlers({
      resolver,
      modelRuntime: { getAuth },
      refs: {
        streamFunction: vi.fn<StreamFn>(),
        settingsManager: {
          getRetrySettings,
          getBranchSummarySettings: () => ({ reserveTokens: 1_024, skipPrompt: false }),
        },
      },
      generateBranchSummary: successfulBranchSummary(),
      compact,
    });

    await expect(
      handlers.sessionBeforeCompact(compactEvent({ reason: "manual" }), contextWithModel(activeModel)),
    ).resolves.toBeUndefined();
    await expect(
      handlers.sessionBeforeCompact(compactEvent({ reason: "threshold" }), contextWithModel(activeModel)),
    ).resolves.toBeUndefined();

    expect(compact).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
    expect(getRetrySettings).not.toHaveBeenCalled();
  });

  it("produces the same session-only result for different context models", async () => {
    const compact = vi.fn<CompactFn>(() => Promise.resolve(compactionResult));
    const resolver = resolverFor(
      { context: [contextMax, lightweightLow] },
      { sessionModelOnly: true },
    );
    const handlers = createHandlers({ resolver, compact });

    await expect(
      handlers.sessionBeforeCompact(compactEvent(), contextWithModel(activeModel)),
    ).resolves.toBeUndefined();
    await expect(
      handlers.sessionBeforeCompact(
        compactEvent(),
        contextWithModel(fakeModel("session", "other", true)),
      ),
    ).resolves.toBeUndefined();

    expect(compact).not.toHaveBeenCalled();
    expect(resolver.inspect).toHaveBeenCalledTimes(2);
  });

  it("starts no candidate work for an aborted session-only compaction", async () => {
    const controller = new AbortController();
    controller.abort();
    const retry = { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 60_000 };
    const getRetrySettings = vi.fn(() => retry);
    const getAuth = vi.fn(() => Promise.resolve({ auth: { apiKey: "test-key" } }));
    const compact = vi.fn<CompactFn>(() => Promise.resolve(compactionResult));
    const resolver = resolverFor(
      { context: [contextMax, lightweightLow] },
      { sessionModelOnly: true },
    );
    const handlers = createUtilityModelHandlers({
      resolver,
      modelRuntime: { getAuth },
      refs: {
        streamFunction: vi.fn<StreamFn>(),
        settingsManager: {
          getRetrySettings,
          getBranchSummarySettings: () => ({ reserveTokens: 1_024, skipPrompt: false }),
        },
      },
      generateBranchSummary: successfulBranchSummary(),
      compact,
    });

    await expect(
      handlers.sessionBeforeCompact(
        compactEvent({ signal: controller.signal }),
        contextWithModel(activeModel),
      ),
    ).resolves.toBeUndefined();

    expect(compact).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
    expect(getRetrySettings).not.toHaveBeenCalled();
  });

  it("keeps the Lightweight handler untouched by a session-only Context", async () => {
    const resolver = resolverFor(
      { lightweight: [lightweightLow] },
      { sessionModelOnly: true },
    );
    const handlers = createHandlers({ resolver });

    const result = await handlers.sessionBeforeTree(treeEvent(), contextWithModel(activeModel));

    expect(result?.summary?.summary).toBe("summary");
    expect(resolver.configuredCandidates).toHaveBeenCalledWith("lightweight");
    expect(resolver.inspect).not.toHaveBeenCalled();
  });

  it("still runs the inspection before the degraded refs path", async () => {
    const resolver = resolverFor({ context: [contextMax] });
    const handlers = createHandlers({ resolver, refs: {} });

    await expect(
      handlers.sessionBeforeCompact(compactEvent(), contextWithModel(activeModel)),
    ).resolves.toBeUndefined();

    expect(resolver.inspect).toHaveBeenCalledOnce();
    expect(resolver.inspect).toHaveBeenCalledWith("context");
  });
```

Change `compactEvent` to accept a reason override:

```ts
function compactEvent(
  overrides: {
    signal?: AbortSignal;
    customInstructions?: string;
    reason?: SessionBeforeCompactEvent["reason"];
  } = {},
): SessionBeforeCompactEvent {
  const signal = overrides.signal ?? new AbortController().signal;
  return {
    type: "session_before_compact",
    preparation: {
      firstKeptEntryId: "entry-kept",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 12_000,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 4_096, keepRecentTokens: 8_192 },
    },
    branchEntries: branchEntries(),
    ...(overrides.customInstructions === undefined
      ? {}
      : { customInstructions: overrides.customInstructions }),
    reason: overrides.reason ?? "threshold",
    willRetry: false,
    signal,
  };
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/utilityModelExtension.test.ts`
Expected: FAIL. `starts no candidate work when the inspection is session-only` sees `compact` called (the fake inspection carries real candidates), and `expect(resolver.inspect).toHaveBeenCalledWith("context")` fails for the default fake because the current handler calls `configuredCandidates`.

- [ ] **Step 3: Implement the early return**

In `src/server/sessions/utilityModelExtension.ts`, replace the opening of `sessionBeforeCompact` with the code below. `sessionBeforeTree` (the Lightweight handler) is not touched:

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
        if (isAborted(event.signal)) return { cancel: true };
        const auth = await resolveCandidateAuth(deps, "context", candidate);
        if (isAborted(event.signal)) return { cancel: true };
        if (auth === undefined) continue;

        try {
          const result = await compact(
            event.preparation,
            candidate.model,
            auth.apiKey,
            auth.headers,
            event.customInstructions,
            event.signal,
            candidate.thinkingLevel,
            utilityStreamFunction(
              refs.streamFunction,
              candidate.thinkingLevel,
            ),
            auth.env,
            retry,
          );
          if (isAborted(event.signal)) return { cancel: true };
          return { compaction: result };
        } catch (error) {
          if (isAborted(event.signal)) return { cancel: true };
          logCandidateFailure(deps.logger, "context", candidate, error);
        }
      }
      return undefined;
    },
```

Ordering facts this code establishes: `ctx.model === undefined` precedes everything; `inspect("context")` runs once and is the only routing input; the session-only return precedes `availableRefs`, retry settings, auth, `compact`, and the candidate loop, so a missing stream function or settings manager still performs one inspection before returning `undefined` (the accepted design ordering); the candidate loop reads `inspection.candidates` instead of `configuredCandidates`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/server/sessions/utilityModelExtension.test.ts && npx eslint src/server/sessions/utilityModelExtension.ts src/server/sessions/utilityModelExtension.test.ts`
Expected: PASS, including the pre-existing branch-summary, retry, abort, and inline-extension cases, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/utilityModelExtension.ts src/server/sessions/utilityModelExtension.test.ts
git commit -m "feat(sessions): skip utility candidates for session-only compaction"
```

## Task 4: Utility model settings service contract v3

**Lane:** server-settings

**Implementer tier:** Standard

**Files:**

- Modify: `src/server/sessions/utilityModelSettingsService.ts:1-12` (value import of the sentinel; `UtilityModelSettingsResponseV3`)
- Modify: `src/server/sessions/utilityModelSettingsService.ts:35-38` (both methods return `Promise<UtilityModelSettingsResponseV3>`)
- Modify: `src/server/sessions/utilityModelSettingsService.ts:69` (`updateSettings` return type)
- Modify: `src/server/sessions/utilityModelSettingsService.ts:98-120` (`responseFor` returns `contractVersion: 3` from both branches)
- Modify: `src/server/sessions/utilityModelSettingsService.ts:143-147` (`validationFor` accepts the sentinel before the catalog lookup)
- Test: `src/server/sessions/utilityModelSettingsService.test.ts:1-5` (V3 import) `:26-235` (V2 → V3, narrowing fix, new cases) `:237-265` (V3 helper return types)

**Interfaces:**

- Consumes: `UTILITY_MODEL_SESSION_ONLY` and `UtilityModelSettingsResponseV3` from Task 1; the existing `UtilityModelSettings`, `UtilityModelSettingsUpdate`, `UtilityModelOptionV2`, `UtilityModelSlot`, `UtilityModelSlotValidation`.
- Produces: `UtilityModelSettingsService { inspect(): Promise<UtilityModelSettingsResponseV3>; update(patch: UtilityModelSettingsUpdate): Promise<UtilityModelSettingsResponseV3> }`; every response branch reports `contractVersion: 3`; `validationFor("context", settings, models)` returns `{ valid: true }` for `settings.context === UTILITY_MODEL_SESSION_ONLY` without reading the catalog; `updateSettings` keeps its atomic validate-then-save queue and its per-slot own-property application.

- [ ] **Step 1: Write the failing tests**

In `src/server/sessions/utilityModelSettingsService.test.ts`, replace the type import block and add the sentinel value import:

```ts
import { describe, expect, it, vi } from "vitest";
import type {
  UtilityModelBinding,
  UtilityModelSettings,
  UtilityModelSettingsResponseV3,
} from "../../shared/apiTypes.js";
import { UTILITY_MODEL_SESSION_ONLY } from "../../shared/apiTypes.js";
import { createUtilityModelSettingsService, type UtilityModelSettingsConfig } from "./utilityModelSettingsService.js";
```

Change every `contractVersion: 2` occurrence to `contractVersion: 3`, including the `expect(response.contractVersion).toBe(2)` assertion in `retains stale configured references and invalidates only their slots` (the four expected-object literals in `refreshes offline...`, `treats empty utility settings as valid`, `treats an omitted level as auto...`, and `reports malformed external settings...`, plus that scalar assertion). Narrow the widened Context access in `treats an omitted level as auto when the selected model does not support minimal`:

```ts
    const context = response.settings.context;
    expect(context === UTILITY_MODEL_SESSION_ONLY ? undefined : context?.thinkingLevel).toBeUndefined();
```

Append these tests before the closing `});` of `describe("utility model settings service", ...)`:

```ts
  it("treats the Context sentinel as valid and inspected", async () => {
    const harness = createHarness({ utilityModels: { context: UTILITY_MODEL_SESSION_ONLY } });

    await expect(harness.service.inspect()).resolves.toEqual({
      contractVersion: 3,
      settings: { context: "session" },
      models: modelOptions(),
      slots: validSlots(),
      valid: true,
    });
  });

  it("updates to the sentinel, back to a binding, and back to unset", async () => {
    const harness = createHarness({ utilityModels: configuredSettings });
    const contextBinding = { provider: "acme", id: "large", thinkingLevel: "max" } satisfies UtilityModelBinding;

    const toSentinel = await harness.service.update({ context: UTILITY_MODEL_SESSION_ONLY });
    expect(toSentinel).toMatchObject({
      contractVersion: 3,
      settings: { context: UTILITY_MODEL_SESSION_ONLY },
      slots: validSlots(),
      valid: true,
    });
    expect(harness.config().utilityModels?.context).toBe(UTILITY_MODEL_SESSION_ONLY);

    const toBinding = await harness.service.update({ context: contextBinding });
    expect(toBinding).toMatchObject({
      contractVersion: 3,
      settings: { context: contextBinding },
      slots: validSlots(),
      valid: true,
    });
    expect(harness.config().utilityModels?.context).toEqual(contextBinding);

    const toUnset = await harness.service.update({ context: null });
    expect(toUnset).toMatchObject({ contractVersion: 3, valid: true });
    expect(harness.config().utilityModels?.context).toBeUndefined();
    expect(harness.saveConfig).toHaveBeenCalledTimes(3);
  });

  it("keeps the sentinel across a save and reload cycle", async () => {
    const harness = createHarness({ utilityModels: configuredSettings });

    await harness.service.update({ context: UTILITY_MODEL_SESSION_ONLY });

    await expect(harness.service.inspect()).resolves.toMatchObject({
      contractVersion: 3,
      settings: { context: UTILITY_MODEL_SESSION_ONLY },
      slots: { context: { valid: true } },
      valid: true,
    });
  });

  it("joins invalid slots with the sentinel present", async () => {
    const harness = createHarness({
      utilityModels: {
        lightweight: { provider: "acme", id: "ghost" },
        context: UTILITY_MODEL_SESSION_ONLY,
      },
    });

    await expect(harness.service.update({ context: UTILITY_MODEL_SESSION_ONLY }))
      .rejects.toThrow("lightweight utility model acme/ghost is unavailable");

    expect(harness.saveConfig).not.toHaveBeenCalled();
  });
```

Change the three helper return types at the bottom of the file from `UtilityModelSettingsResponseV2` to `UtilityModelSettingsResponseV3`:

```ts
function modelOptions(): UtilityModelSettingsResponseV3["models"] {

function validSlots(): UtilityModelSettingsResponseV3["slots"] {

function invalidSlots(reason: string): UtilityModelSettingsResponseV3["slots"] {
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/utilityModelSettingsService.test.ts`
Expected: FAIL, every snapshot still reads `contractVersion: 2`, and the sentinel inspection reports `contract-invalid` instead of `{ valid: true }`.

- [ ] **Step 3: Implement contract v3 and sentinel validation**

In `src/server/sessions/utilityModelSettingsService.ts`, replace the two imports with:

```ts
import { isKnownThinkingLevel, type ThinkingLevel } from "../../shared/thinkingLevels.js";
import {
  UTILITY_MODEL_SLOTS,
  UTILITY_MODEL_SESSION_ONLY,
  type UtilityModelOptionV2,
  type UtilityModelSettings,
  type UtilityModelSettingsResponseV3,
  type UtilityModelSettingsUpdate,
  type UtilityModelSlot,
  type UtilityModelSlotValidation,
} from "../../shared/apiTypes.js";
```

Change both method signatures in `UtilityModelSettingsService`:

```ts
export interface UtilityModelSettingsService {
  inspect(): Promise<UtilityModelSettingsResponseV3>;
  update(patch: UtilityModelSettingsUpdate): Promise<UtilityModelSettingsResponseV3>;
}
```

Change the return types of the module-private `inspect`, `updateSettings`, and `responseFor` functions from `UtilityModelSettingsResponseV2` to `UtilityModelSettingsResponseV3`. In `responseFor`, change the `configError` branch and the normal branch from `contractVersion: 2` to `contractVersion: 3`; `models: modelOptions` stays `UtilityModelOptionV2[]`.

In `validationFor`, insert the sentinel check between the unset check and the catalog lookup:

```ts
  function validationFor(slot: UtilityModelSlot, settings: UtilityModelSettings, models: readonly TModel[]): UtilityModelSlotValidation {
    const configured = settings[slot];
    if (configured === undefined) return { valid: true };
    if (configured === UTILITY_MODEL_SESSION_ONLY) return { valid: true };

    const available = models.find((model) => model.provider === configured.provider && model.id === configured.id);
```

The sentinel is valid without a catalog lookup because the session's model is not a catalog selection; `lightweight` can never carry it through the config parser or route parser. The per-slot patch application in `updateSettings` is unchanged: own-property `lightweight` first, then own-property `context`; `null` deletes, a value assigns.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/server/sessions/utilityModelSettingsService.test.ts && npx eslint src/server/sessions/utilityModelSettingsService.ts src/server/sessions/utilityModelSettingsService.test.ts`
Expected: PASS, including the pre-existing validation, ordering, and concurrent-update cases, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/utilityModelSettingsService.ts src/server/sessions/utilityModelSettingsService.test.ts
git commit -m "feat(sessions): serve utility model settings contract v3"
```

## Task 5: Explicit per-slot utility model route parsing

**Lane:** server-settings

**Implementer tier:** Standard

**Files:**

- Modify: `src/server/sessions/utilityModelSettingsRoutes.ts:1-6` (value import of the sentinel)
- Modify: `src/server/sessions/utilityModelSettingsRoutes.ts:42-61` (two explicit slot blocks replace the generic loop)
- Test: `src/server/sessions/utilityModelSettingsRoutes.test.ts:1-9` (imports) `:30-120` (new PUT cases) `:183-206` (`snapshot` becomes V3)

**Interfaces:**

- Consumes: `UTILITY_MODEL_SESSION_ONLY`, `UtilityModelSettingsUpdate`, `UtilityModelSettingsResponseV3` from Task 1; `parseUtilityModelsConfig(value: unknown, path: string): UtilityModelSettings` accepting the Context sentinel from Task 1; `UtilityModelSettingsService` from Task 4.
- Produces: module-private `parseSettingsUpdate(value: unknown): UtilityModelSettingsUpdate` that accepts `{ context: "session" }`, `{ context: null }`, binding objects, and `{ lightweight: null }`; rejects `lightweight: "session"` and every non-`"session"` Context string through `parseUtilityModelsConfig` with the path label `request body settings`; `registerUtilityModelSettingsRoutes(app, service, prefix)` keeps its signature, its status mapping, and both `FEDERATED_HTTP_ROUTES` entries.

- [ ] **Step 1: Write the failing tests**

In `src/server/sessions/utilityModelSettingsRoutes.test.ts`, replace the import region from `import { PiWebUiConfigMutationBusyError }` through `import { FEDERATED_HTTP_ROUTES }` with:

```ts
import { PiWebUiConfigMutationBusyError } from "../../configMutationCoordinator";
import { UTILITY_MODEL_SESSION_ONLY, type UtilityModelSettingsResponse, type UtilityModelSettingsResponseV3, type UtilityModelSettingsUpdate } from "../../shared/apiTypes";
import { FEDERATED_HTTP_ROUTES } from "../../shared/federatedRoutes";
```

Insert these tests immediately after `normalizes exact explicit levels and preserves own-property null clears for PUT`:

```ts
  it("accepts the Context sentinel", async () => {
    const confirmed = snapshot({ settings: { context: UTILITY_MODEL_SESSION_ONLY } });
    updateMock.mockResolvedValueOnce(confirmed);

    const response = await app.inject({
      method: "PUT",
      url: "/utility-models",
      payload: { settings: { context: UTILITY_MODEL_SESSION_ONLY } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(confirmed);
    expect(updateMock).toHaveBeenCalledExactlyOnceWith({ context: UTILITY_MODEL_SESSION_ONLY });
  });

  it("accepts a sentinel plus a lightweight clear", async () => {
    const update = {
      lightweight: null,
      context: UTILITY_MODEL_SESSION_ONLY,
    } satisfies UtilityModelSettingsUpdate;

    const response = await app.inject({
      method: "PUT",
      url: "/utility-models",
      payload: { settings: update },
    });

    expect(response.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledExactlyOnceWith(update);
  });

  it("rejects the sentinel for lightweight without invoking the service", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/utility-models",
      payload: { settings: { lightweight: UTILITY_MODEL_SESSION_ONLY } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toMatch(/utilityModels\.lightweight must be an object/u);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects every other Context string without invoking the service", async () => {
    for (const context of ["active", "Session"]) {
      const response = await app.inject({
        method: "PUT",
        url: "/utility-models",
        payload: { settings: { context } },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toMatch(/utilityModels\.context must be an object/u);
    }
    expect(updateMock).not.toHaveBeenCalled();
  });
```

Change the `snapshot` helper at the bottom of the file to V3:

```ts
function snapshot(overrides: Partial<UtilityModelSettingsResponseV3> = {}): UtilityModelSettingsResponseV3 {
  return {
    contractVersion: 3,
    settings: {},
    models: [
      {
        model: { provider: "acme", id: "small" },
        name: "Acme Small",
        thinkingLevels: ["off", "minimal", "low"],
      },
      {
        model: { provider: "acme", id: "large" },
        name: "Acme Large",
        thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
      },
    ],
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
    ...overrides,
  };
}
```

Every existing invalid case, status mapping, error mapping, and the federated-route assertion stays unchanged.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/server/sessions/utilityModelSettingsRoutes.test.ts`
Expected: FAIL, `accepts the Context sentinel` returns 400 because the generic parser treats `"session"` as a binding, and the lightweight sentinel is currently accepted as an update value.

- [ ] **Step 3: Implement the explicit two-slot parser**

In `src/server/sessions/utilityModelSettingsRoutes.ts`, add the sentinel to the shared import:

```ts
import { UTILITY_MODEL_SESSION_ONLY, UTILITY_MODEL_SLOTS, type UtilityModelSettingsUpdate, type UtilityModelSlot } from "../../shared/apiTypes.js";
```

Replace the generic loop body of `parseSettingsUpdate` with:

```ts
function parseSettingsUpdate(value: unknown): UtilityModelSettingsUpdate {
  if (!isRecord(value)) throw new Error("settings must be an object");
  const unknownSlot = Object.keys(value).find((key) => !isUtilityModelSlot(key));
  if (unknownSlot !== undefined) throw new Error(`unknown utility model slot ${JSON.stringify(unknownSlot)}`);

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
}
```

The body prelude (`Expected object body`, exactly one own `settings` property, `settings must be an object`, unknown-slot rejection), `isUtilityModelSlot`, the GET/PUT handlers, `settingsMutationErrorStatus`, and `errorMessage` are unchanged.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/server/sessions/utilityModelSettingsRoutes.test.ts && npx eslint src/server/sessions/utilityModelSettingsRoutes.ts src/server/sessions/utilityModelSettingsRoutes.test.ts`
Expected: PASS, including every pre-existing invalid body and status-mapping case, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/utilityModelSettingsRoutes.ts src/server/sessions/utilityModelSettingsRoutes.test.ts
git commit -m "feat(sessions): parse the Context sentinel explicitly in the settings route"
```

## Task 6: Strict v3 utility-model settings parser

**Lane:** client-api

**Implementer tier:** Standard

**Files:**

- Modify: `src/client/src/api/parsers.ts:11` (add the sentinel value import and the V3 type)
- Modify: `src/client/src/api/parsers.ts:1593-1600` (dispatch arm before the fallthrough)
- Modify: `src/client/src/api/parsers.ts:1614-1624` (add `parseUtilityModelSettingsResponseV3`)
- Modify: `src/client/src/api/parsers.ts:1640-1648` (add `parseUtilityModelSettingsV3`)
- Test: `src/client/src/api/parsers.test.ts:1-5` (sentinel import) `:1433-1489` (new tests and the replaced v3-rejection assertion) `:1633` (add the V3 fixture after the V2 wire)

**Interfaces:**

- Consumes: `UTILITY_MODEL_SESSION_ONLY` and `UtilityModelSettingsResponseV3` from Task 1; the existing `parseUtilityModelBinding`, `parseUtilityModelOptionV2`, `parseUtilityModelSlots`, `requireBoolean`, `optionalString`, `arrayOf`, `optionalField`, `isUtilityModelSlot`, `requireObjectRecord`.
- Produces: `parseUtilityModelSettingsResponse(value: unknown): UtilityModelSettingsResponse` dispatching `contractVersion` 1, 2, and 3 and throwing `Invalid utility model settings contract version` for anything else; V3 `context` accepting exactly the sentinel or a binding; V1/V2 parsers unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/client/src/api/parsers.test.ts`, add the sentinel value import beside the existing parser import:

```ts
import { UTILITY_MODEL_SESSION_ONLY } from "../../../shared/apiTypes";
```

Insert this fixture immediately after `utilityModelSettingsV2Wire`:

```ts
function utilityModelSettingsV3Wire(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 3,
    settings: {
      lightweight: { provider: "openai", id: "gpt-5.6-luna", thinkingLevel: "max" },
      context: "session",
    },
    models: [
      {
        model: { provider: "openai", id: "gpt-5.6-luna" },
        name: "Luna",
        thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      },
      {
        model: { provider: "openai", id: "org/gpt-5.6-luna/medium" },
        thinkingLevels: ["off", "max"],
      },
    ],
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
    ...overrides,
  };
}
```

Replace the existing `it("rejects unsupported utility model contract versions", ...)` body and add the new cases immediately after it:

```ts
  it("parses version 3 utility-model settings snapshots with the session-only Context sentinel", () => {
    const wire = utilityModelSettingsV3Wire();

    expect(parseUtilityModelSettingsResponse(wire)).toEqual(wire);
    expect(parseUtilityModelSettingsResponse(wire).settings).toEqual({
      lightweight: { provider: "openai", id: "gpt-5.6-luna", thinkingLevel: "max" },
      context: UTILITY_MODEL_SESSION_ONLY,
    });
  });

  it("rejects unsupported utility model contract versions", () => {
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsWire({ contractVersion: 4 }))).toThrow("contract version");
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsWire({ contractVersion: "3" }))).toThrow("contract version");
  });

  it("parses version 3 sentinel and binding Context values", () => {
    const sentinel = utilityModelSettingsV3Wire({
      settings: {
        lightweight: { provider: "openai", id: "gpt", thinkingLevel: "max" },
        context: UTILITY_MODEL_SESSION_ONLY,
      },
    });
    const binding = utilityModelSettingsV3Wire({
      settings: { context: { provider: "openai", id: "gpt", thinkingLevel: "high" } },
    });

    expect(parseUtilityModelSettingsResponse(sentinel).settings).toEqual({
      lightweight: { provider: "openai", id: "gpt", thinkingLevel: "max" },
      context: UTILITY_MODEL_SESSION_ONLY,
    });
    expect(parseUtilityModelSettingsResponse(binding).settings).toEqual({
      context: { provider: "openai", id: "gpt", thinkingLevel: "high" },
    });
  });

  it("rejects malformed version 3 sentinel values and unknown keys", () => {
    for (const context of ["Session", "", 3]) {
      expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsV3Wire({ settings: { context } }))).toThrow("settings.context");
    }
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsV3Wire({
      settings: { lightweight: "session" },
    }))).toThrow("settings.lightweight");
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsV3Wire({
      settings: { advanced: { provider: "openai", id: "gpt" } },
    }))).toThrow("settings.advanced");
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsV3Wire({
      settings: { context: { provider: "openai", id: "gpt", extra: true } },
    }))).toThrow("settings.context.extra");
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsV3Wire({ unexpected: true }))).toThrow("field");
  });

  it("keeps version 1 and version 2 parsers rejecting the sentinel", () => {
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsWire({ settings: { context: "session" } }))).toThrow("settings.context");
    expect(() => parseUtilityModelSettingsResponse(utilityModelSettingsV2Wire({ settings: { context: "session" } }))).toThrow("settings.context");
  });
```

The existing version 1 and version 2 acceptance, thinking-field, and empty/stale tests stay byte-for-byte.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/client/src/api/parsers.test.ts`
Expected: FAIL, `parseUtilityModelSettingsResponse(utilityModelSettingsV3Wire())` throws `Invalid utility model settings contract version`, and the v1/v2 sentinel-rejection cases currently throw the unsupported-version error instead of a settings-field error.

- [ ] **Step 3: Implement the v3 parsers**

In `src/client/src/api/parsers.ts`, add the sentinel value import beside the existing type-only import and add `UtilityModelSettingsResponseV3` to that type list:

```ts
import { UTILITY_MODEL_SESSION_ONLY } from "../../../shared/apiTypes";
```

Change the dispatch in `parseUtilityModelSettingsResponse` to:

```ts
export function parseUtilityModelSettingsResponse(value: unknown): UtilityModelSettingsResponse {
  const record = requireObjectRecord(value, "utility model settings response");
  const unknownKey = Object.keys(record).find((key) => !isUtilityModelSettingsResponseKey(key));
  if (unknownKey !== undefined) throw new Error(`Invalid utility model settings response field: ${unknownKey}`);
  if (record["contractVersion"] === 1) return parseUtilityModelSettingsResponseV1(record);
  if (record["contractVersion"] === 2) return parseUtilityModelSettingsResponseV2(record);
  if (record["contractVersion"] === 3) return parseUtilityModelSettingsResponseV3(record);
  throw new Error("Invalid utility model settings contract version");
}
```

Add the V3 response parser immediately after `parseUtilityModelSettingsResponseV2`:

```ts
function parseUtilityModelSettingsResponseV3(record: Record<string, unknown>): UtilityModelSettingsResponseV3 {
  const configError = optionalString(record, "configError");
  return {
    contractVersion: 3,
    settings: parseUtilityModelSettingsV3(record["settings"]),
    models: arrayOf(parseUtilityModelOptionV2)(record["models"]),
    slots: parseUtilityModelSlots(record["slots"]),
    valid: requireBoolean(record, "valid"),
    ...optionalField("configError", configError),
  };
}
```

Add the V3 settings parser immediately after `parseUtilityModelSettingsV2`:

```ts
function parseUtilityModelSettingsV3(value: unknown): UtilityModelSettings {
  const record = requireObjectRecord(value, "settings");
  const unknownSlot = Object.keys(record).find((key) => !isUtilityModelSlot(key));
  if (unknownSlot !== undefined) throw new Error(`Invalid utility model settings field: settings.${unknownSlot}`);
  return {
    ...optionalField("lightweight", record["lightweight"] === undefined ? undefined : parseUtilityModelBinding(record["lightweight"], "settings.lightweight")),
    ...optionalField("context", record["context"] === undefined
      ? undefined
      : record["context"] === UTILITY_MODEL_SESSION_ONLY
        ? UTILITY_MODEL_SESSION_ONLY
        : parseUtilityModelBinding(record["context"], "settings.context")),
  };
}
```

`parseUtilityModelSettingsResponseV1`, `parseUtilityModelSettingsResponseV2`, `parseUtilityModelSettingsV1`, `parseUtilityModelSettingsV2`, and `isUtilityModelSettingsResponseKey` are unchanged.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/client/src/api/parsers.test.ts && npx eslint src/client/src/api/parsers.ts src/client/src/api/parsers.test.ts`
Expected: PASS, including every pre-existing v1/v2 parser case, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/api/parsers.ts src/client/src/api/parsers.test.ts
git commit -m "feat(client): parse utility model settings contract v3"
```

## Task 7: Version-aware save projection and dialog coverage

**Lane:** client-api

**Implementer tier:** Standard

**Files:**

- Modify: `src/client/src/api/clients.ts:10-11` (drop `UTILITY_MODEL_SLOTS`, import the sentinel and `UtilityModelBinding`)
- Modify: `src/client/src/api/clients.ts:301-318` (`utilityModelSettingsForContract` per-slot v1 projection plus `projectBinding`)
- Test: `src/client/src/api/clients.test.ts:1-5` (sentinel import) `:480-533` (new cases) `:1418-1443` (add the V3 fixture after the V2 fixture)
- Test: `src/client/src/components/SettingsDialog.utilitymodels.test.ts:1-48` (imports and V3/V1 fixtures) `:50-216` (append the two new tests)

**Interfaces:**

- Consumes: `UTILITY_MODEL_SESSION_ONLY` from Task 1; the V3 parser from Task 6 through `utilityModelsApi.settings` and `utilityModelsApi.save`; the existing `utilityModelsPath(machineId)`, `request`, and `machinePrefix`; the unchanged `SettingsDialog.loadUtilityModelsForTarget` and `SettingsDialog.saveUtilityModels` plus the existing `callDialogPromise`, `getDialogProperty`, `setDialogProperty`, and `stubWindowTimers` helpers.
- Produces: `utilityModelsApi.settings(machineId = "local"): Promise<UtilityModelSettingsResponse>` unchanged; `utilityModelsApi.save(settings: UtilityModelSettingsUpdate, contractVersion, machineId = "local"): Promise<UtilityModelSettingsResponse>` whose v2/v3 body is exactly `{ settings: update }` and whose v1 body projects each own property to `{ provider, id }`, keeps `null`, drops `undefined`, and throws `Cannot save the session-only Context model to a contract version 1 runtime` before any request when it receives the sentinel. Also produces dialog-boundary coverage: `SettingsDialog` is unchanged, and the new tests prove it stores the v3 response, passes `contractVersion: 3` and the sentinel update through `utilityModelsApi.save`, and surfaces the v1 guard message through `utilityModelsError` with `saving === false`.

- [ ] **Step 1: Write the failing tests**

In `src/client/src/api/clients.test.ts`, add the sentinel value import beside the existing client import:

```ts
import { UTILITY_MODEL_SESSION_ONLY } from "../../../shared/apiTypes";
```

Insert these tests at the end of `describe("Utility model settings API", ...)`, after `accepts version 1 responses and projects explicit thinking bindings before saving`:

```ts
  it("sends the session-only Context sentinel unchanged to a version 3 runtime under a nested base", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    const response = utilityModelSettingsV3Response();
    const update = {
      lightweight: { provider: "openai", id: "gpt-small", thinkingLevel: "xhigh" },
      context: UTILITY_MODEL_SESSION_ONLY,
    } satisfies UtilityModelSettingsUpdate;
    const fetchMock = stubSequenceFetch([jsonResponse(response), jsonResponse(response)]);

    await expect(utilityModelsApi.settings("remote /?")).resolves.toEqual(response);
    await expect(utilityModelsApi.save(update, 3, "remote /?")).resolves.toEqual(response);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://pi.example.test/nested/pi-webui/api/machines/remote%20%2F%3F/utility-models",
      "https://pi.example.test/nested/pi-webui/api/machines/remote%20%2F%3F/utility-models",
    ]);
    expect(fetchCall(fetchMock, 1)[1]?.method).toBe("PUT");
    expect(requestBody(fetchCall(fetchMock, 1)[1])).toBe(JSON.stringify({
      settings: {
        lightweight: { provider: "openai", id: "gpt-small", thinkingLevel: "xhigh" },
        context: "session",
      },
    }));
  });

  it("accepts a version 3 sentinel response from the settings endpoint", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    const response = utilityModelSettingsV3Response();
    stubSequenceFetch([jsonResponse(response)]);

    const parsed = await utilityModelsApi.settings("remote /?");

    expect(parsed).toEqual(response);
    expect(parsed.settings.context).toBe(UTILITY_MODEL_SESSION_ONLY);
  });

  it("throws before any request when a version 1 runtime would receive the sentinel", () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => utilityModelsApi.save({ context: UTILITY_MODEL_SESSION_ONLY }, 1, "local"))
      .toThrow(/contract version 1/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

Add this fixture immediately after `utilityModelSettingsV2Response`:

```ts
function utilityModelSettingsV3Response() {
  return {
    contractVersion: 3 as const,
    settings: {
      lightweight: { provider: "openai", id: "gpt-5.6-luna", thinkingLevel: "max" },
      context: "session",
    },
    models: [
      {
        model: { provider: "openai", id: "gpt-5.6-luna" },
        name: "Luna",
        thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      },
    ],
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
  };
}
```

The existing version 1 projection and version 2 passthrough tests stay byte-for-byte.

Then, in `src/client/src/components/SettingsDialog.utilitymodels.test.ts`, extend the imports:

```ts
import { PI_WEBUI_CAPABILITIES } from "../../../shared/capabilities";
import type {
  UtilityModelSettings,
  UtilityModelSettingsResponse,
  UtilityModelSettingsResponseV1,
  UtilityModelSettingsResponseV2,
  UtilityModelSettingsResponseV3,
  UtilityModelSettingsUpdate,
} from "../../../shared/apiTypes";
import { UTILITY_MODEL_SESSION_ONLY } from "../../../shared/apiTypes";
```

Add these fixtures immediately after the existing `responseV2` helper in that file:

```ts
function utilityModelSettingsV3SentinelResponse(): UtilityModelSettingsResponseV3 {
  return {
    contractVersion: 3,
    settings: {
      lightweight: { ...lightweight, thinkingLevel: "max" },
      context: UTILITY_MODEL_SESSION_ONLY,
    },
    models: [
      { model: lightweight, name: "Small", thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
      { model: context, name: "Context", thinkingLevels: ["off", "low", "medium"] },
    ],
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
  };
}

function utilityModelSettingsV1Response(): UtilityModelSettingsResponseV1 {
  return {
    contractVersion: 1,
    settings: {},
    models: [{ model: lightweight, name: "Small" }],
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
  };
}
```

Append these tests at the end of `describe("settings-dialog utility model machine targeting", ...)` in that file:

```ts
  it("loads and saves the v3 sentinel update shape with contract version 3", async () => {
    stubWindowTimers();
    const loaded = utilityModelSettingsV3SentinelResponse();
    const confirmed = utilityModelSettingsV3SentinelResponse();
    const settingsSpy = vi.spyOn(utilityModelsApi, "settings").mockResolvedValue(loaded);
    const saveSpy = vi.spyOn(utilityModelsApi, "save").mockResolvedValue(confirmed);
    const dialog = new SettingsDialog();

    await callDialogPromise(dialog, "loadUtilityModelsForTarget");
    expect(settingsSpy.mock.calls).toEqual([["local"]]);

    await callDialogPromise(dialog, "saveUtilityModels", {
      lightweight: null,
      context: UTILITY_MODEL_SESSION_ONLY,
    });

    expect(saveSpy.mock.calls).toEqual([
      [{ lightweight: null, context: UTILITY_MODEL_SESSION_ONLY }, 3, "local"],
    ]);
    expect(getDialogProperty(dialog, "utilityModelsConfigResponse")).toBe(confirmed);
  });

  it("surfaces the v1 projection guard without sending a request", async () => {
    stubWindowTimers();
    const dialog = new SettingsDialog();
    setDialogProperty(dialog, "utilityModelsConfigResponse", utilityModelSettingsV1Response());

    await callDialogPromise(dialog, "saveUtilityModels", { context: UTILITY_MODEL_SESSION_ONLY });

    expect(String(getDialogProperty(dialog, "utilityModelsError"))).toContain(
      "Cannot save the session-only Context model to a contract version 1 runtime",
    );
    expect(getDialogProperty(dialog, "saving")).toBe(false);
  });
```

The existing dialog load, stale-load, save, merge, capability, error, and reset tests stay byte-for-byte.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- --run src/client/src/api/clients.test.ts src/client/src/components/SettingsDialog.utilitymodels.test.ts`
Expected: FAIL. The v3 save sends `{"context":"session"}` through the generic v1 projection path and drops it to `{}`; the v3 response and the dialog v3 fixture fail to parse; and the v1 guard test observes a fetch attempt instead of the guard throw.

- [ ] **Step 3: Implement version-aware projection**

In `src/client/src/api/clients.ts`, replace the two shared-type imports with:

```ts
import { UTILITY_MODEL_SESSION_ONLY } from "../../../shared/apiTypes";
import type { UtilityModelBinding, UtilityModelSettingsResponse, UtilityModelSettingsUpdate } from "../../../shared/apiTypes";
```

Replace `utilityModelSettingsForContract` and add `projectBinding`:

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

Contract: v2 and v3 pass the update through unchanged (including explicit `thinkingLevel` values and the sentinel), so the request body is exactly `{ settings: update }`; v1 reads `lightweight` and `context` explicitly, keeps own properties, drops `undefined`, keeps `null`, and projects bindings to `{ provider, id }`; a sentinel reaching the v1 projection throws before any request. `utilityModelsApi.settings` and `utilityModelsApi.save` keep their signatures and `${machinePrefix(machineId)}/utility-models` paths. The now-unused `UTILITY_MODEL_SLOTS` import is gone.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/client/src/api/clients.test.ts src/client/src/components/SettingsDialog.utilitymodels.test.ts && npx eslint src/client/src/api/clients.ts src/client/src/api/clients.test.ts src/client/src/components/SettingsDialog.utilitymodels.test.ts`
Expected: PASS, including the pre-existing v1 and v2 request-body cases and every pre-existing dialog utility-model case, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/api/clients.ts src/client/src/api/clients.test.ts src/client/src/components/SettingsDialog.utilitymodels.test.ts
git commit -m "feat(client): project utility model saves by contract version"
```

## Task 8: Draft sentinel transitions and v2-or-later thinking capability

**Lane:** client-draft

**Implementer tier:** Standard

**Files:**

- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:1-11` (sentinel value import; Context/SessionOnly/V2/V3 types)
- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:23-26` (`CompleteUtilityModelSettingsUpdate` per-slot shape)
- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:35-43` (add `supportsUtilityModelThinking` and `updateUtilityModelDraftContextSessionOnly`)
- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:53-67` (no-op Thinking on the sentinel)
- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:70-91` (thinking capability via the predicate)
- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:105-118` (sentinel-aware update emission)
- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:120-150` (sentinel-preserving clones)
- Modify: `src/client/src/components/settings/utilityModelSettingsDraft.ts:152-188` (sentinel validation and v3 explicit levels)
- Test: `src/client/src/components/settings/utilityModelSettingsDraft.test.ts:1-12` (imports) `:48` (add `responseV3` after `responseV1`) `:181` (append the new tests)

**Interfaces:**

- Consumes: `UTILITY_MODEL_SESSION_ONLY`, `UtilityModelContextSetting`, `UtilityModelSessionOnly`, `UtilityModelSettingsResponseV2`, `UtilityModelSettingsResponseV3` from Task 1.
- Produces: `supportsUtilityModelThinking(response: UtilityModelSettingsResponse): response is UtilityModelSettingsResponseV2 | UtilityModelSettingsResponseV3`; `updateUtilityModelDraftContextSessionOnly(draft: UtilityModelSettingsDraft): UtilityModelSettingsDraft` (idempotent, no contract check); `CompleteUtilityModelSettingsUpdate { lightweight: UtilityModelBinding | null; context: UtilityModelContextSetting | null }`; `updateUtilityModelDraftThinkingLevel` returning an equal clone for the sentinel; `utilityModelSettingsUpdateFromDraft` emitting the sentinel; `validateUtilityModelSlot` accepting `UtilityModelBinding | UtilityModelSessionOnly | undefined` and validating v3 explicit levels exactly as v2.

- [ ] **Step 1: Write the failing tests**

In `src/client/src/components/settings/utilityModelSettingsDraft.test.ts`, extend the imports:

```ts
import { describe, expect, it } from "vitest";
import {
  UTILITY_MODEL_SESSION_ONLY,
  type UtilityModelBinding,
  type UtilityModelOptionV2,
  type UtilityModelSettingsResponse,
  type UtilityModelSettingsResponseV1,
  type UtilityModelSettingsResponseV2,
  type UtilityModelSettingsResponseV3,
} from "../../../../shared/apiTypes";
import {
  AUTO_UTILITY_MODEL_THINKING,
  supportsUtilityModelThinking,
  updateUtilityModelDraftContextSessionOnly,
  updateUtilityModelDraftModel,
  updateUtilityModelDraftThinkingLevel,
  utilityModelSettingsDraftFromResponse,
  utilityModelSettingsUpdateFromDraft,
  utilityModelThinkingOptions,
  validateUtilityModelSettingsDraft,
  type UtilityModelSettingsDraft,
} from "./utilityModelSettingsDraft";
```

Add this helper immediately after `responseV1`:

```ts
function responseV3(overrides: Partial<UtilityModelSettingsResponseV3> = {}): UtilityModelSettingsResponseV3 {
  return {
    contractVersion: 3,
    settings: {},
    models: [lightweightOption, contextOption],
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
    ...overrides,
  };
}
```

Append these tests at the end of `describe("utility model settings drafts", ...)`:

```ts
  it("clones the session-only sentinel without sharing the settings object", () => {
    const source = responseV3({ settings: { context: UTILITY_MODEL_SESSION_ONLY } });

    const draft = utilityModelSettingsDraftFromResponse(source);

    expect(draft).toEqual({ context: UTILITY_MODEL_SESSION_ONLY });
    expect(draft).not.toBe(source.settings);
  });

  it("treats a Thinking change as a no-op on the sentinel", () => {
    const draft = { context: UTILITY_MODEL_SESSION_ONLY } as const;

    const next = updateUtilityModelDraftThinkingLevel(draft, "context", "high");

    expect(next).toEqual({ context: UTILITY_MODEL_SESSION_ONLY });
    expect(next.context).toBe(UTILITY_MODEL_SESSION_ONLY);
    expect(next).not.toBe(draft);
  });

  it("replaces the sentinel with a selected model and preserves lightweight", () => {
    const draft = {
      lightweight: { ...lightweightModel, thinkingLevel: "low" },
      context: UTILITY_MODEL_SESSION_ONLY,
    } satisfies UtilityModelSettingsDraft;

    const next = updateUtilityModelDraftModel(draft, "context", contextOption);

    expect(next).toEqual({
      lightweight: { ...lightweightModel, thinkingLevel: "low" },
      context: { ...contextModel },
    });
  });

  it("installs the sentinel in one step and keeps lightweight", () => {
    const next = updateUtilityModelDraftContextSessionOnly({
      lightweight: { ...lightweightModel, thinkingLevel: "low" },
    });

    expect(next).toEqual({
      lightweight: { ...lightweightModel, thinkingLevel: "low" },
      context: UTILITY_MODEL_SESSION_ONLY,
    });
    expect(updateUtilityModelDraftContextSessionOnly(next)).toEqual(next);
  });

  it("validates and saves the sentinel while v3 explicit levels match v2", () => {
    const sentinelDraft = utilityModelSettingsDraftFromResponse(
      responseV3({ settings: { context: UTILITY_MODEL_SESSION_ONLY } }),
    );
    expect(validateUtilityModelSettingsDraft(sentinelDraft, responseV3()).slots.context.valid).toBe(true);
    expect(utilityModelSettingsUpdateFromDraft(sentinelDraft, responseV3())).toEqual({
      lightweight: null,
      context: UTILITY_MODEL_SESSION_ONLY,
    });

    const explicit = { ...contextModel, thinkingLevel: "high" as const };
    expect(validateUtilityModelSettingsDraft({ context: explicit }, responseV3()).valid).toBe(true);
    expect(utilityModelThinkingOptions(responseV3(), explicit))
      .toEqual(utilityModelThinkingOptions(responseV2(), explicit));
  });

  it("clears the sentinel back to null when the inherited entry is picked", () => {
    const draft = utilityModelSettingsDraftFromResponse(
      responseV3({ settings: { context: UTILITY_MODEL_SESSION_ONLY } }),
    );

    const cleared = updateUtilityModelDraftModel(draft, "context", undefined);

    expect(cleared).toEqual({});
    expect(utilityModelSettingsUpdateFromDraft(cleared, responseV3())).toEqual({
      lightweight: null,
      context: null,
    });
  });

  it("narrows thinking-capable responses with supportsUtilityModelThinking", () => {
    const response: UtilityModelSettingsResponse = responseV1();
    if (supportsUtilityModelThinking(response)) {
      expect(response.models[0]?.thinkingLevels).toBeDefined();
    } else {
      expect(response.contractVersion).toBe(1);
    }
  });
```

The existing clone, thinking-order, stale-level, auto-only, complete-update, and refusal tests stay byte-for-byte.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/client/src/components/settings/utilityModelSettingsDraft.test.ts`
Expected: FAIL, `updateUtilityModelDraftThinkingLevel` throws or attaches a level to the sentinel, `utilityModelSettingsUpdateFromDraft` emits a spread sentinel object, and `updateUtilityModelDraftContextSessionOnly`/`supportsUtilityModelThinking` do not exist.

- [ ] **Step 3: Implement the sentinel draft helpers**

In `src/client/src/components/settings/utilityModelSettingsDraft.ts`, replace the shared import with a value import plus the widened type list:

```ts
import { UTILITY_MODEL_SESSION_ONLY } from "../../../../shared/apiTypes";
import type {
  UtilityModelBinding,
  UtilityModelContextSetting,
  UtilityModelOption,
  UtilityModelSessionOnly,
  UtilityModelSettings,
  UtilityModelSettingsResponse,
  UtilityModelSettingsResponseV2,
  UtilityModelSettingsResponseV3,
  UtilityModelSlot,
  UtilityModelSlotValidation,
} from "../../../../shared/apiTypes";
```

Replace `CompleteUtilityModelSettingsUpdate` with:

```ts
export interface CompleteUtilityModelSettingsUpdate {
  lightweight: UtilityModelBinding | null;
  context: UtilityModelContextSetting | null;
}
```

Add these two exported helpers immediately after `utilityModelSettingsDraftFromResponse`:

```ts
export function supportsUtilityModelThinking(
  response: UtilityModelSettingsResponse,
): response is UtilityModelSettingsResponseV2 | UtilityModelSettingsResponseV3 {
  return response.contractVersion !== 1;
}

export function updateUtilityModelDraftContextSessionOnly(
  draft: UtilityModelSettingsDraft,
): UtilityModelSettingsDraft {
  return {
    ...(draft.lightweight === undefined ? {} : { lightweight: cloneBinding(draft.lightweight) }),
    context: UTILITY_MODEL_SESSION_ONLY,
  };
}
```

Change the opening of `updateUtilityModelDraftThinkingLevel` to:

```ts
export function updateUtilityModelDraftThinkingLevel(
  draft: UtilityModelSettingsDraft,
  slot: UtilityModelSlot,
  level: UtilityModelDraftThinkingLevel,
): UtilityModelSettingsDraft {
  const binding = draft[slot];
  if (binding === undefined || binding === UTILITY_MODEL_SESSION_ONLY) return cloneUtilityModelSettings(draft);
  if (level !== AUTO_UTILITY_MODEL_THINKING && !isKnownThinkingLevel(level)) {
    return cloneUtilityModelSettings(draft);
  }

  const replacement: UtilityModelBinding = level === AUTO_UTILITY_MODEL_THINKING
    ? { provider: binding.provider, id: binding.id }
    : { provider: binding.provider, id: binding.id, thinkingLevel: level };
  return draftWithSlot(draft, slot, replacement);
}
```

Change the early return of `utilityModelThinkingOptions` to use the predicate:

```ts
  if (!supportsUtilityModelThinking(response) || binding === undefined) return [automatic];
```

Change the return of `utilityModelSettingsUpdateFromDraft` to:

```ts
  return {
    lightweight: draft.lightweight === undefined ? null : cloneBinding(draft.lightweight),
    context: draft.context === undefined ? null : cloneUtilityModelContextSetting(draft.context),
  };
```

Change `cloneUtilityModelSettings`, `settingsFromBindings`, and the new sentinel-preserving clone:

```ts
function cloneUtilityModelSettings(settings: UtilityModelSettings): UtilityModelSettings {
  return settingsFromBindings(settings.lightweight, settings.context);
}

function settingsFromBindings(
  lightweight: UtilityModelBinding | undefined,
  context: UtilityModelContextSetting | undefined,
): UtilityModelSettings {
  return {
    ...(lightweight === undefined ? {} : { lightweight: cloneBinding(lightweight) }),
    ...(context === undefined ? {} : { context: cloneUtilityModelContextSetting(context) }),
  };
}

function cloneUtilityModelContextSetting(
  value: UtilityModelContextSetting,
): UtilityModelContextSetting {
  return value === UTILITY_MODEL_SESSION_ONLY ? UTILITY_MODEL_SESSION_ONLY : cloneBinding(value);
}
```

`draftWithSlot` keeps its shape; the `context` local it passes to `settingsFromBindings` already carries the union. Change `validateUtilityModelSlot` to:

```ts
function validateUtilityModelSlot(
  slot: UtilityModelSlot,
  binding: UtilityModelBinding | UtilityModelSessionOnly | undefined,
  response: UtilityModelSettingsResponse,
): UtilityModelSlotValidation {
  if (binding === undefined) return { valid: true };
  if (binding === UTILITY_MODEL_SESSION_ONLY) return { valid: true };
  const option = response.models.find((candidate) => sameModel(candidate.model, binding));
  if (option === undefined) {
    return {
      valid: false,
      reason: `utility slot ${slot} names unavailable model ${describeModel(binding)}`,
    };
  }
  if (binding.thinkingLevel === undefined) return { valid: true };
  if (!supportsUtilityModelThinking(response)) {
    return {
      valid: false,
      reason: `utility slot ${slot} names thinking level ${binding.thinkingLevel}, unavailable in this runtime`,
    };
  }
  if (!isKnownThinkingLevel(binding.thinkingLevel) || !supportsThinkingLevel(option, binding.thinkingLevel)) {
    return {
      valid: false,
      reason: `utility slot ${slot} names thinking level ${binding.thinkingLevel}, unsupported by ${describeModel(binding)}`,
    };
  }
  return { valid: true };
}
```

`updateUtilityModelDraftModel`, `autoThinkingOption`, and `cloneBinding` are unchanged; `updateUtilityModelDraftModel` already routes through `draftWithSlot`, so selecting a model while the slot holds the sentinel replaces it and selecting inherited clears the slot.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/client/src/components/settings/utilityModelSettingsDraft.test.ts && npx eslint src/client/src/components/settings/utilityModelSettingsDraft.ts src/client/src/components/settings/utilityModelSettingsDraft.test.ts`
Expected: PASS, including the pre-existing clone, thinking-order, stale-level, and refusal cases, with no lint errors. The predicate assertion also proves the compile-time narrowing under `npm run typecheck` in the integration task.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/components/settings/utilityModelSettingsDraft.ts src/client/src/components/settings/utilityModelSettingsDraft.test.ts
git commit -m "feat(client): model the session-only draft and v2-or-later thinking"
```

## Task 9: Special picker choice ordering

**Lane:** client-picker

**Implementer tier:** Fast

**Files:**

- Modify: `src/client/src/components/settings/settingsModelOptions.ts:43-63` (special-choice parameter and ordering)
- Test: `src/client/src/components/settings/settingsModelOptions.test.ts:1-12` (import the special type) `:126-138` (append the new tests before the closing of `describe("settingsModelPickerOptions", ...)`)

**Interfaces:**

- Consumes: the existing `SettingsModelChoice`, `settingsModelKey(model)`, `INHERITED_SETTINGS_MODEL_VALUE`, and `CommandOption`.
- Produces: `interface SettingsSpecialModelChoice { readonly value: string; readonly label: string; readonly description?: string }`; `settingsModelPickerOptions(choices: readonly SettingsModelChoice[], inherited?: { readonly label: string }, specialChoices?: readonly SettingsSpecialModelChoice[]): CommandOption[]` returning special choices first (caller order, no `group`), then the inherited entry, then the provider-sorted models; `undefined` and `[]` special choices produce today's output exactly.

- [ ] **Step 1: Write the failing tests**

In `src/client/src/components/settings/settingsModelOptions.test.ts`, extend the import:

```ts
import {
  INHERITED_SETTINGS_MODEL_VALUE,
  describeSettingsModel,
  settingsModelChoiceByKey,
  settingsModelKey,
  settingsModelPickerOptions,
  type SettingsSpecialModelChoice,
} from "./settingsModelOptions";
```

Append these tests inside `describe("settingsModelPickerOptions", ...)`, before its closing `});`:

```ts
  it("renders special choices before the inherited entry and the models", () => {
    const choices: SettingsModelChoice[] = [
      { model: { provider: "anthropic", id: "claude-opus" } },
      { model: { provider: "openai", id: "gpt-5" } },
    ];
    const specialChoices: SettingsSpecialModelChoice[] = [
      { value: "session", label: "Only use session model" },
    ];

    const options = settingsModelPickerOptions(choices, { label: "Inherited" }, specialChoices);

    expect(options.map((option) => option.value)).toEqual([
      "session",
      INHERITED_SETTINGS_MODEL_VALUE,
      settingsModelKey({ provider: "anthropic", id: "claude-opus" }),
      settingsModelKey({ provider: "openai", id: "gpt-5" }),
    ]);
    expect(options.map((option) => option.group)).toEqual([
      undefined,
      undefined,
      "anthropic",
      "openai",
    ]);
  });

  it("keeps today's order when no special choices are supplied", () => {
    const choices: SettingsModelChoice[] = [
      { model: { provider: "anthropic", id: "claude-opus" } },
    ];

    const withoutArgument = settingsModelPickerOptions(choices, { label: "Inherited" });
    const withEmpty = settingsModelPickerOptions(choices, { label: "Inherited" }, []);

    expect(withoutArgument.map((option) => option.value)).toEqual([
      INHERITED_SETTINGS_MODEL_VALUE,
      settingsModelKey({ provider: "anthropic", id: "claude-opus" }),
    ]);
    expect(withEmpty).toEqual(withoutArgument);
  });

  it("carries a special choice description only when one is set", () => {
    const choices: SettingsModelChoice[] = [
      { model: { provider: "anthropic", id: "claude-opus" } },
    ];

    const options = settingsModelPickerOptions(choices, undefined, [
      { value: "session", label: "Only use session model", description: "Use the active session model" },
      { value: "other", label: "Other" },
    ]);

    expect(options[0]).toEqual({
      value: "session",
      label: "Only use session model",
      description: "Use the active session model",
    });
    expect(options[1]).toEqual({ value: "other", label: "Other" });
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/client/src/components/settings/settingsModelOptions.test.ts`
Expected: FAIL, `settingsModelPickerOptions` ignores the third argument, so the special tests fail with `TypeError: specialChoices is not iterable` or a value mismatch.

- [ ] **Step 3: Implement the special-first ordering**

In `src/client/src/components/settings/settingsModelOptions.ts`, add the interface immediately above `settingsModelPickerOptions`:

```ts
export interface SettingsSpecialModelChoice {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}
```

Replace `settingsModelPickerOptions` with:

```ts
export function settingsModelPickerOptions(
  choices: readonly SettingsModelChoice[],
  inherited?: { readonly label: string },
  specialChoices?: readonly SettingsSpecialModelChoice[],
): CommandOption[] {
  const sorted = [...choices].sort((left, right) => (
    left.model.provider === right.model.provider
      ? left.model.id.localeCompare(right.model.id)
      : left.model.provider.localeCompare(right.model.provider)
  ));
  const options = sorted.map((choice) => ({
    value: settingsModelKey(choice.model),
    label: choice.model.id,
    ...(choice.name === undefined || choice.name === "" || choice.name === choice.model.id
      ? {}
      : { description: choice.name }),
    ...(choice.model.provider === "" ? {} : { group: choice.model.provider }),
  }));
  const specialOptions = (specialChoices ?? []).map((choice) => ({
    value: choice.value,
    label: choice.label,
    ...(choice.description === undefined ? {} : { description: choice.description }),
  }));
  const inheritedOptions = inherited === undefined
    ? []
    : [{ value: INHERITED_SETTINGS_MODEL_VALUE, label: inherited.label }];
  return [...specialOptions, ...inheritedOptions, ...options];
}
```

`SettingsModelChoice`, `settingsModelKey`, `settingsModelChoiceByKey`, `describeSettingsModel`, and `INHERITED_SETTINGS_MODEL_VALUE` are unchanged.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/client/src/components/settings/settingsModelOptions.test.ts && npx eslint src/client/src/components/settings/settingsModelOptions.ts src/client/src/components/settings/settingsModelOptions.test.ts`
Expected: PASS, including the pre-existing sort, label, description, group, and inherited-entry cases, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/components/settings/settingsModelOptions.ts src/client/src/components/settings/settingsModelOptions.test.ts
git commit -m "feat(client): order special model choices before inherited and models"
```

## Task 10: Additive special-choice picker field

**Lane:** client-picker

**Implementer tier:** Standard

**Files:**

- Modify: `src/client/src/components/settings/SettingsModelPickerField.ts:1-15` (import `SettingsSpecialModelChoice`)
- Modify: `src/client/src/components/settings/SettingsModelPickerField.ts:31-43` (add `specialChoices`, `selectedSpecialValue`, `onSelectSpecial`)
- Modify: `src/client/src/components/settings/SettingsModelPickerField.ts:45-72` (summary, `empty` class, title)
- Modify: `src/client/src/components/settings/SettingsModelPickerField.ts:74-111` (picker options and selected value)
- Modify: `src/client/src/components/settings/SettingsModelPickerField.ts:128-145` (`pickModel` dispatches a special value)
- Test: `src/client/src/components/settings/SettingsModelPickerField.test.ts:293-300` (append the new describe before `SettingsModelPickerField event containment`)

**Interfaces:**

- Consumes: `SettingsSpecialModelChoice { readonly value: string; readonly label: string; readonly description?: string }` and the special-first `settingsModelPickerOptions(choices, inherited?, specialChoices?)` from Task 9; the existing `SettingsModelChoice`, `INHERITED_SETTINGS_MODEL_VALUE`, `settingsModelChoiceByKey`, `settingsModelKey`.
- Produces: additive properties `specialChoices: readonly SettingsSpecialModelChoice[]`, `selectedSpecialValue: string`, and `onSelectSpecial?: (value: string) => void`; a selected special choice shows its label as the trigger summary (not the `empty` style, title is the label); picking a special value closes the dialog and calls `onSelectSpecial(value)` without calling `onSelect`; model keys and the inherited entry keep today's `onSelect` handling. Defaults preserve every existing caller.

- [ ] **Step 1: Write the failing tests**

In `src/client/src/components/settings/SettingsModelPickerField.test.ts`, insert this describe block immediately before `describe("SettingsModelPickerField event containment", ...)`:

```ts
describe("SettingsModelPickerField special choices", () => {
  const specialChoices = [{ value: "session", label: "Only use session model" }];

  it("replaces the empty/inherited summary for a selected special choice", async () => {
    const field = await mountField((f) => {
      f.choices = catalog;
      f.inheritedLabel = INHERIT_LABEL;
      f.specialChoices = specialChoices;
      f.selectedSpecialValue = "session";
    });

    expect(triggerText(field)).toBe("Only use session model");
    expect(triggerButton(field).classList.contains("empty")).toBe(false);
  });

  it("picks a special choice through onSelectSpecial and closes the dialog", async () => {
    const onSelect = vi.fn<(model: TierModelRef | undefined) => void>();
    const onSelectSpecial = vi.fn<(value: string) => void>();
    const field = await mountField((f) => {
      f.choices = catalog;
      f.inheritedLabel = INHERIT_LABEL;
      f.specialChoices = specialChoices;
      f.selectedSpecialValue = "session";
      f.onSelect = onSelect;
      f.onSelectSpecial = onSelectSpecial;
    });

    await openPicker(field);
    expect(pickerOptionLabels(field)).toEqual([
      "Only use session model",
      INHERIT_LABEL,
      "claude-context",
      "gpt-small",
    ]);

    await clickPickerOption(field, "Only use session model");

    expect(onSelectSpecial).toHaveBeenCalledExactlyOnceWith("session");
    expect(onSelect).not.toHaveBeenCalled();
    expect(field.isPickerOpen).toBe(false);
  });

  it("dispatches model and inherited selections through onSelect", async () => {
    const onSelect = vi.fn<(model: TierModelRef | undefined) => void>();
    const onSelectSpecial = vi.fn<(value: string) => void>();
    const field = await mountField((f) => {
      f.choices = catalog;
      f.inheritedLabel = INHERIT_LABEL;
      f.specialChoices = specialChoices;
      f.selectedSpecialValue = "session";
      f.onSelect = onSelect;
      f.onSelectSpecial = onSelectSpecial;
    });

    await openPicker(field);
    await clickPickerOption(field, "claude-context");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ ...contextModel });

    await openPicker(field);
    await clickPickerOption(field, INHERIT_LABEL);
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
    expect(onSelectSpecial).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/client/src/components/settings/SettingsModelPickerField.test.ts`
Expected: FAIL. The special choice is not rendered (the option list is inherited-then-models), `onSelectSpecial` is never called, and the trigger summary stays the inherited label.

- [ ] **Step 3: Implement the special-choice properties and dispatch**

In `src/client/src/components/settings/SettingsModelPickerField.ts`, extend the `./settingsModelOptions` import:

```ts
import {
  describeSettingsModel,
  INHERITED_SETTINGS_MODEL_VALUE,
  settingsModelChoiceByKey,
  settingsModelKey,
  settingsModelPickerOptions,
  type SettingsModelChoice,
  type SettingsSpecialModelChoice,
} from "./settingsModelOptions";
```

Add three properties immediately after `onSelect`:

```ts
  @property({ attribute: false }) specialChoices: readonly SettingsSpecialModelChoice[] = [];
  @property() selectedSpecialValue = "";
  @property({ attribute: false }) onSelectSpecial?: (value: string) => void;
```

Replace `render()` with:

```ts
  override render(): TemplateResult {
    const selected = this.selected;
    const special = this.specialChoices.find(
      (choice) => choice.value === this.selectedSpecialValue,
    );
    const known = selected !== undefined && this.choices.some((choice) => sameModel(choice.model, selected));
    const summary = special !== undefined
      ? special.label
      : selected === undefined
        ? this.emptyLabel()
        : `${describeSettingsModel(selected)}${known ? "" : " (unavailable)"}`;

    return html`
      <button
        type="button"
        id=${this.triggerId}
        class="model-trigger ${selected === undefined && special === undefined ? "empty" : ""}"
        aria-label=${this.accessibleLabel === "" ? nothing : this.accessibleLabel}
        aria-haspopup="dialog"
        aria-expanded=${String(this.pickerOpen)}
        aria-invalid=${String(this.invalid)}
        ?disabled=${this.disabled}
        title=${special === undefined ? this.triggerTitle(summary, known) : summary}
        @click=${() => {
          this.showPicker();
        }}
      >
        <span class="model-summary">${summary}</span>
        <span class="model-chevron" aria-hidden="true">▾</span>
      </button>
      ${this.pickerOpen ? this.renderPicker() : null}
    `;
  }
```

Replace the two head lines of `renderPicker()` with:

```ts
  private renderPicker(): TemplateResult {
    const selected = this.selected;
    const special = this.specialChoices.find(
      (choice) => choice.value === this.selectedSpecialValue,
    );
    const options = settingsModelPickerOptions(
      this.choices,
      this.inheritedLabel === "" ? undefined : { label: this.inheritedLabel },
      this.specialChoices,
    );
    const selectedValue = special !== undefined
      ? special.value
      : selected === undefined
        ? (this.inheritedLabel === "" ? undefined : INHERITED_SETTINGS_MODEL_VALUE)
        : settingsModelKey(selected);
```

The rest of `renderPicker` (the `picker-host` markup, Escape/backdrop containment, and every `command-picker` binding) is unchanged.

Replace `pickModel` with:

```ts
  private pickModel(value: string): void {
    const special = this.specialChoices.find((choice) => choice.value === value);
    if (special !== undefined) {
      this.closePicker();
      this.onSelectSpecial?.(special.value);
      return;
    }
    if (value === INHERITED_SETTINGS_MODEL_VALUE) {
      if (this.inheritedLabel === "") return;
      this.closePicker();
      this.onSelect?.(undefined);
      return;
    }
    const choice = settingsModelChoiceByKey(this.choices, value);
    if (choice === undefined) return;
    this.closePicker();
    this.onSelect?.({ ...choice.model });
  }
```

A special value must not be `""` and is the panel's responsibility to keep distinct from `INHERITED_SETTINGS_MODEL_VALUE`; the special check therefore runs before the inherited check. `showPicker`, `closePicker`, `emptyLabel`, `triggerTitle`, disabled behavior, event containment, and stale-model `(unavailable)` rendering are unchanged.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/client/src/components/settings/SettingsModelPickerField.test.ts && npx eslint src/client/src/components/settings/SettingsModelPickerField.ts src/client/src/components/settings/SettingsModelPickerField.test.ts`
Expected: PASS, including every pre-existing trigger, dialog, containment, and cancel case, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/components/settings/SettingsModelPickerField.ts src/client/src/components/settings/SettingsModelPickerField.test.ts
git commit -m "feat(client): support special picker choices"
```

## Task 11: Panel v3 Context choice, draft normalization, and thinking gates

**Lane:** client-panel

**Implementer tier:** Advanced

**Files:**

- Modify: `src/client/src/components/settings/SettingsUtilityModelsPanel.ts:1-24` (sentinel value, `SettingsSpecialModelChoice`, draft helpers)
- Modify: `src/client/src/components/settings/SettingsUtilityModelsPanel.ts:27-38` (add `CONTEXT_SESSION_ONLY_CHOICE`)
- Modify: `src/client/src/components/settings/SettingsUtilityModelsPanel.ts:160-238` (`renderFieldRow` normalization, thinking gates, special-choice bindings)
- Modify: `src/client/src/components/settings/SettingsUtilityModelsPanel.ts:240-248` (add `onSpecialPicked`)
- Test: `src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts:1-18` (imports) `:69-88` (add `responseV3` after `responseV1`) `:260-262` (append the new tests inside the describe)

**Interfaces:**

- Consumes: `UTILITY_MODEL_SESSION_ONLY` from Task 1; `supportsUtilityModelThinking`, `updateUtilityModelDraftContextSessionOnly`, and the widened `UtilityModelSettingsDraft` from Task 8; `SettingsSpecialModelChoice` from Task 9; the picker field's `specialChoices`, `selectedSpecialValue`, and `onSelectSpecial` from Task 10.
- Produces: `renderFieldRow(slot)` normalizing `this.draft[slot] === UTILITY_MODEL_SESSION_ONLY` to `undefined` before binding-based lookups while validating the raw draft; `specialChoices` populated only for `slot === "context" && response.contractVersion === 3`; `selectedSpecialValue` populated only for the selected Context sentinel; `thinkingValue` and `thinkingDisabled` gated by `supportsUtilityModelThinking(response)` with the retained `selectedOption !== undefined` conjunct; module-private `onSpecialPicked(slot, value)` installing the sentinel for the v3 Context choice. Save still flows through `utilityModelSettingsUpdateFromDraft` unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts`, extend the imports:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UTILITY_MODEL_SESSION_ONLY,
  type TierModelRef,
  type UtilityModelOptionV1,
  type UtilityModelOptionV2,
  type UtilityModelSettingsResponseV1,
  type UtilityModelSettingsResponseV2,
  type UtilityModelSettingsResponseV3,
} from "../../../../shared/apiTypes";
```

Add this helper immediately after `responseV1`:

```ts
function responseV3(overrides: Partial<UtilityModelSettingsResponseV3> = {}): UtilityModelSettingsResponseV3 {
  return {
    contractVersion: 3,
    settings: {
      lightweight: { ...smallModel, thinkingLevel: "high" },
      context: { ...contextModel, thinkingLevel: "medium" },
    },
    models: v2Models(),
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
    ...overrides,
  };
}
```

Append these tests before the closing `});` of `describe("SettingsUtilityModelsPanel", ...)`:

```ts
  it("renders the session-only choice only for the v3 Context row", async () => {
    const v2Panel = await mountPanel((element) => {
      element.response = responseV2();
    });

    await openPicker(modelPicker(v2Panel, "context"));
    expect(pickerOptionLabels(modelPicker(v2Panel, "context"))).not.toContain("Only use session model");
    await openPicker(modelPicker(v2Panel, "lightweight"));
    expect(pickerOptionLabels(modelPicker(v2Panel, "lightweight"))).not.toContain("Only use session model");

    const v3Panel = await mountPanel((element) => {
      element.response = responseV3();
    });

    await openPicker(modelPicker(v3Panel, "context"));
    expect(pickerOptionLabels(modelPicker(v3Panel, "context"))).toEqual([
      "Only use session model",
      "Use lightweight, then active session model",
      "claude-context",
      "gpt-small",
    ]);
    await openPicker(modelPicker(v3Panel, "lightweight"));
    expect(pickerOptionLabels(modelPicker(v3Panel, "lightweight"))).not.toContain("Only use session model");
  });

  it("selects the sentinel, disables Thinking showing auto, and saves it", async () => {
    const onSave = vi.fn();
    const panel = await mountPanel((element) => {
      element.response = responseV3();
      element.onSave = onSave;
    });

    await selectModel(panel, "context", "Only use session model");

    const thinking = thinkingSelect(panel, "context");
    expect(thinking.value).toBe("auto");
    expect(thinking.disabled).toBe(true);
    expect(thinkingSelect(panel, "lightweight").disabled).toBe(false);
    expect(saveButton(panel).disabled).toBe(false);

    saveButton(panel).click();
    expect(onSave).toHaveBeenCalledWith({
      lightweight: { ...smallModel, thinkingLevel: "high" },
      context: UTILITY_MODEL_SESSION_ONLY,
    });
  });

  it("replaces the sentinel with a selected model", async () => {
    const onSave = vi.fn();
    const panel = await mountPanel((element) => {
      element.response = responseV3();
      element.onSave = onSave;
    });

    await selectModel(panel, "context", "Only use session model");
    await selectModel(panel, "context", contextModel.id);

    expect(triggerText(modelPicker(panel, "context"))).toBe("anthropic/claude-context");
    saveButton(panel).click();
    expect(onSave).toHaveBeenCalledWith({
      lightweight: { ...smallModel, thinkingLevel: "high" },
      context: { ...contextModel },
    });
  });

  it("clears the sentinel when the inherited entry is picked", async () => {
    const onSave = vi.fn();
    const panel = await mountPanel((element) => {
      element.response = responseV3();
      element.onSave = onSave;
    });

    await selectModel(panel, "context", "Only use session model");
    await selectModel(panel, "context", "Use lightweight, then active session model");

    saveButton(panel).click();
    expect(onSave).toHaveBeenCalledWith({
      lightweight: { ...smallModel, thinkingLevel: "high" },
      context: null,
    });
  });

  it("renders and enables a v3 explicit level exactly as v2", async () => {
    const panel = await mountPanel((element) => {
      element.response = responseV3({
        settings: { context: { ...contextModel, thinkingLevel: "low" } },
      });
    });

    const thinking = thinkingSelect(panel, "context");
    expect(thinking.value).toBe("low");
    expect(thinking.disabled).toBe(false);
    expect(optionValues(thinking)).toContain("low");
  });
```

The existing row, picker, save, thinking, stale-model, capability, and notice tests stay byte-for-byte.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts`
Expected: FAIL. The v3 Context picker has no special choice, selecting it is impossible, and the v3 explicit level renders as `auto` and disabled because the panel still gates on exactly `contractVersion === 2`.

- [ ] **Step 3: Implement the v3 Context choice and gates**

In `src/client/src/components/settings/SettingsUtilityModelsPanel.ts`, replace the import region from the shared `apiTypes` type import through the `./utilityModelSettingsDraft` import with (the preceding `lit` and `lit/decorators.js` imports are unchanged):

```ts
import type {
  TierModelRef,
  UtilityModelOption,
  UtilityModelSettingsResponse,
  UtilityModelSettingsUpdate,
  UtilityModelSlot,
} from "../../../../shared/apiTypes";
import { UTILITY_MODEL_SESSION_ONLY } from "../../../../shared/apiTypes";
import { isKnownThinkingLevel } from "../../../../shared/thinkingLevels";
import { SettingsModelPickerField } from "./SettingsModelPickerField";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import type { UtilityModelSettingsSupport } from "./settingsMachineTarget";
import type { SettingsSpecialModelChoice } from "./settingsModelOptions";
import {
  AUTO_UTILITY_MODEL_THINKING,
  supportsUtilityModelThinking,
  updateUtilityModelDraftContextSessionOnly,
  updateUtilityModelDraftModel,
  updateUtilityModelDraftThinkingLevel,
  utilityModelSettingsDraftFromResponse,
  utilityModelSettingsUpdateFromDraft,
  utilityModelThinkingOptions,
  validateUtilityModelSettingsDraft,
  type UtilityModelDraftThinkingLevel,
  type UtilityModelSettingsDraft,
} from "./utilityModelSettingsDraft";
```

Add the module-level choice immediately after `SLOT_DETAILS`:

```ts
const CONTEXT_SESSION_ONLY_CHOICE: SettingsSpecialModelChoice = {
  value: UTILITY_MODEL_SESSION_ONLY,
  label: "Only use session model",
};
```

Replace the head of `renderFieldRow(slot)` down through the `thinkingDisabled` computation with:

```ts
  private renderFieldRow(slot: UtilityModelSlot): TemplateResult {
    const response = this.response;
    if (response === undefined) return html``;

    const detail = SLOT_DETAILS[slot];
    const selection = this.draft[slot];
    const binding = selection === UTILITY_MODEL_SESSION_ONLY ? undefined : selection;
    const selectedOption = binding === undefined
      ? undefined
      : response.models.find((option) => sameModel(option.model, binding));
    const validation = validateUtilityModelSettingsDraft(this.draft, response).slots[slot];
    const modelId = `select-utility-model-${slot}`;
    const thinkingId = `select-utility-thinking-${slot}`;
    const thinkingOptions = utilityModelThinkingOptions(response, binding);
    const thinkingCapable = supportsUtilityModelThinking(response);
    const thinkingValue = thinkingCapable && selectedOption !== undefined
      ? binding?.thinkingLevel ?? AUTO_UTILITY_MODEL_THINKING
      : AUTO_UTILITY_MODEL_THINKING;
    const thinkingDisabled = this.editingDisabled ||
      !thinkingCapable ||
      binding === undefined ||
      selectedOption === undefined;
    const specialChoices = slot === "context" && response.contractVersion === 3
      ? [CONTEXT_SESSION_ONLY_CHOICE]
      : [];
    const selectedSpecialValue = slot === "context" && selection === UTILITY_MODEL_SESSION_ONLY
      ? UTILITY_MODEL_SESSION_ONLY
      : "";
```

The `selectedOption !== undefined` conjunct is retained from today's code, so a v2/v3 binding whose model left the catalog still renders `auto` instead of a value its option list cannot select. Use the raw `this.draft` for `validation` (the sentinel validates as valid) and the normalized `binding` for `selectedOption`, `utilityModelThinkingOptions`, `.selected`, and the thinking value.

In the rendered `<settings-model-picker-field>`, replace `.onSelect` with these four bindings (keep every other attribute unchanged):

```ts
            .selected=${binding === undefined ? undefined : { provider: binding.provider, id: binding.id }}
            .inheritedLabel=${detail.emptyLabel}
            .disabled=${this.editingDisabled}
            .invalid=${!validation.valid}
            .specialChoices=${specialChoices}
            .selectedSpecialValue=${selectedSpecialValue}
            .onSelectSpecial=${(value: string) => {
              this.onSpecialPicked(slot, value);
            }}
            .onSelect=${(model: TierModelRef | undefined) => {
              this.onModelPicked(slot, model);
            }}
```

Add `onSpecialPicked` immediately before `onModelPicked`:

```ts
  private onSpecialPicked(slot: UtilityModelSlot, value: string): void {
    if (slot === "context" && value === UTILITY_MODEL_SESSION_ONLY) {
      this.draft = updateUtilityModelDraftContextSessionOnly(this.draft);
    }
  }
```

`handleSave`, `handleModelChange`, `handleThinkingChange`, `panelNotices`, `canSave`, the rendered Thinking `<select>`, and `SLOT_DETAILS` (including `context.emptyLabel`'s exact `Use lightweight, then active session model`) are unchanged. Selection is a draft edit; nothing persists until **Save utility models**, and `utilityModelSettingsUpdateFromDraft` emits `context: "session"`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts && npx eslint src/client/src/components/settings/SettingsUtilityModelsPanel.ts src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts`
Expected: PASS, including every pre-existing row, picker, save, stale-model, capability, and notice case, with no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/components/settings/SettingsUtilityModelsPanel.ts src/client/src/components/settings/SettingsUtilityModelsPanel.test.ts
git commit -m "feat(client): offer Only use session model for v3 Context"
```

## Task 12: Document the session-only Context mode and add the minor changeset

**Lane:** docs-release

**Implementer tier:** Fast

**Files:**

- Modify: `docs/config.md:297-315` (three new Utility models bullets plus the section-local JSON example)
- Modify: `docs/config.html:783-807` (the hand-synced mirror of the same claims and example)
- Create: `.changeset/context-session-model-only.md`

**Interfaces:**

- Consumes: the approved behavior from Tasks 1-11: `utilityModels.context: "session"` uses the active session model and thinking level, attempts neither the Context model nor Lightweight, is offered only for contract version 3, and requires one `pi-webui-sessiond.service` restart. Uses `.agents/skills/documentation-guide/SKILL.md` for placement and claim parity.
- Produces: user-facing documentation and exactly one minor changeset; no code, no `README.md`, no `CHANGELOG.md`, no version bump.

- [ ] **Step 1: Add the Markdown bullets and example**

In `docs/config.md`, in the **Utility models** section, insert these three bullets immediately after the bullet ending `...the Context-to-Lightweight fallback uses each row's own configured level.` and before `- When both settings are unset, ...`:

```md
- `context` also accepts the literal string `"session"`, shown in **Settings → Utility models** as **Only use session model**. In this state compaction uses the active session model and thinking level directly: it attempts neither the configured `context` model nor `lightweight`, and it never resolves a utility candidate.
- The **Only use session model** choice is offered only when the selected machine's runtime reports utility-model settings contract version 3. On an older remote the Context row keeps its existing editor and routing; an old client against a contract-3 runtime shows a utility-models error until it is upgraded.
- Installing this feature requires one manual `pi-webui-sessiond.service` restart (`systemctl --user restart pi-webui-sessiond.service`): the resolver short-circuit and the compaction handler are compiled into the long-lived, non-autoreloading session daemon, and ordinary UI/API autoreload does not load them. A saved `"session"` value keeps applying immediately on each subsequent utility operation after that one-time restart.
```

At the end of the same **Utility models** section (after the existing lightweight-fallback restart bullet), add this section-local JSON example:

```json
{
  "utilityModels": {
    "lightweight": { "provider": "acme", "id": "small", "thinkingLevel": "low" },
    "context": "session"
  }
}
```

Keep every existing bullet and keep the existing fallback-chain description for unset and fixed states. Do not edit the global config example at the top of the file; its fixed Context binding stays as it is.

- [ ] **Step 2: Mirror the same claims and example in HTML**

In `docs/config.html`, in the `<section id="utility-models">` `<ul>`, insert these three `<li>` items immediately after the item that ends `...the Context-to-Lightweight fallback uses each row's own configured level.`:

```html
                <li><code>context</code> also accepts the literal string <code>"session"</code>, shown in <strong>Settings → Utility models</strong> as <strong>Only use session model</strong>. In this state compaction uses the active session model and thinking level directly: it attempts neither the configured <code>context</code> model nor <code>lightweight</code>, and it never resolves a utility candidate.</li>
                <li>The <strong>Only use session model</strong> choice is offered only when the selected machine's runtime reports utility-model settings contract version 3. On an older remote the Context row keeps its existing editor and routing; an old client against a contract-3 runtime shows a utility-models error until it is upgraded.</li>
                <li>Installing this feature requires one manual <code>pi-webui-sessiond.service</code> restart (<code>systemctl --user restart pi-webui-sessiond.service</code>): the resolver short-circuit and the compaction handler are compiled into the long-lived, non-autoreloading session daemon, and ordinary UI/API autoreload does not load them. A saved <code>"session"</code> value keeps applying immediately on each subsequent utility operation after that one-time restart.</li>
```

Immediately after the closing `</ul>` of the same `<section id="utility-models">`, add the mirrored example:

```html
              <pre><code>{
  "utilityModels": {
    "lightweight": { "provider": "acme", "id": "small", "thinkingLevel": "low" },
    "context": "session"
  }
}</code></pre>
```

No new TOC entry is needed: the section already exists. The HTML claims must be textually equivalent to the Markdown claims.

- [ ] **Step 3: Write the minor changeset**

Create `.changeset/context-session-model-only.md` with exactly:

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

Do not edit `CHANGELOG.md`, do not bump any version, and do not run `npm publish`.

- [ ] **Step 4: Verify claim parity and formatting**

Run:

```bash
rg -c "Only use session model" docs/config.md docs/config.html
rg -c "utility-model settings contract version 3" docs/config.md docs/config.html
rg -c "systemctl --user restart pi-webui-sessiond.service" docs/config.md docs/config.html
git diff --check
```

Expected: each `rg -c` reports the same non-zero count for both files, and `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add docs/config.md docs/config.html .changeset/context-session-model-only.md
git commit -m "docs: document the session-only Context utility routing mode"
```

## Task 13: Typecheck sweep, resolver-fake completion, and broad gates

**Lane:** integration

**Implementer tier:** Standard

**Files:**

- Modify: `src/server/sessions/piSessionService.modelPolicy.test.ts:94-107` (`fallbackResolver`), `:495-498` (`defaultUtilityModelResolver`), `:1211-1217` (`resolver.inspect.mockImplementation`)
- Modify: `src/server/sessions/piSessionService.promptQueue.test.ts:28-35` (`utilityResolverFor`)
- Modify: `src/server/sessions/piSessionService.rateLimits.test.ts:63-67` and `:145-155` (both `createDefaultRuntimeFactory` resolver literals)
- Modify: `src/server/speechInput/speechInputPolishingService.test.ts:237-240` and `:277-281` (both `UtilityModelResolver<Model<Api>>` literals)
- Modify: `src/server/speechInput/speechInputPolishingService.rateLimits.test.ts:38-47` (`candidateResolver`)

**Interfaces:**

- Consumes: every production change from Tasks 1-11 and the `UtilityModelInspection.sessionModelOnly: boolean` contract from Task 2. The compiler sweep is authoritative: `npm run typecheck` names every remaining literal typed as `UtilityModelResolver` that omits the field (untyped `vi.fn()` mocks compile without it but return `undefined`, which is falsy, so the named sites are completed explicitly rather than relying on the compiler alone).
- Produces: test-only edits adding `sessionModelOnly: false` to every listed resolver fake; a green `npm run typecheck`; a green `npm run verify:fast`. No production file is modified; `src/server/sessions/piSessionService.delegationTools.test.ts` is not affected because its `inspect` belongs to the model-policy capability, not `UtilityModelResolver`.

- [ ] **Step 1: Run the typecheck sweep and record the RED state**

Run: `npm run typecheck`
Expected: FAIL with errors naming each resolver literal missing the required `sessionModelOnly` property. This is the RED state for this task; the failing files must be exactly the five files listed above plus any site the compiler names.

- [ ] **Step 2: Complete every resolver fake**

In `src/server/sessions/piSessionService.modelPolicy.test.ts`, update the `fallbackResolver` return, the default resolver, and the mock implementation:

```ts
  return {
    inspect: vi.fn<UtilityResolver["inspect"]>().mockResolvedValue({
      candidates,
      sessionModelOnly: false,
      ...(input.unavailable === undefined ? {} : { unavailable: input.unavailable }),
    }),
    configuredCandidates: vi.fn<UtilityResolver["configuredCandidates"]>().mockResolvedValue(candidates),
  };
```

```ts
  const defaultUtilityModelResolver: UtilityResolver = {
    inspect: () => Promise.resolve({ candidates: [], sessionModelOnly: false, unavailable: { reason: "slot-unset" } }),
    configuredCandidates: () => Promise.resolve([]),
  };
```

```ts
    resolver.inspect.mockImplementation(() => {
      inspected = true;
      return Promise.resolve({
        candidates: [{ ...LIGHTWEIGHT_CANDIDATE, slot: "lightweight" as const }],
        sessionModelOnly: false,
      });
    });
```

In `src/server/sessions/piSessionService.promptQueue.test.ts`, update `utilityResolverFor`:

```ts
function utilityResolverFor(
  candidates: readonly ResolvedUtilityModel<ReturnType<typeof testModel>>[],
) {
  return {
    inspect: vi.fn().mockResolvedValue({ candidates, sessionModelOnly: false }),
    configuredCandidates: vi.fn().mockResolvedValue(candidates),
  };
}
```

In `src/server/sessions/piSessionService.rateLimits.test.ts`, update both resolver literals:

```ts
      {
        inspect: vi.fn().mockResolvedValue({ candidates: [], sessionModelOnly: false }),
        configuredCandidates: vi.fn().mockResolvedValue([]),
      },
```

```ts
      {
        inspect: vi.fn().mockResolvedValue({
          candidates: [{ model: candidate, thinkingLevel: "high", slot: "lightweight" }],
          sessionModelOnly: false,
        }),
        configuredCandidates: vi.fn().mockResolvedValue([
          { model: candidate, thinkingLevel: "high", slot: "lightweight" },
        ]),
      },
```

In `src/server/speechInput/speechInputPolishingService.test.ts`, update both resolver literals:

```ts
    const resolver: UtilityModelResolver<Model<Api>> = {
      inspect: vi.fn(() => Promise.resolve({ candidates: [candidate(firstModel)], sessionModelOnly: false })),
      configuredCandidates: vi.fn(() => Promise.resolve([candidate(firstModel)])),
    };
```

```ts
  const resolver: UtilityModelResolver<Model<Api>> = {
    inspect: vi.fn(() => Promise.resolve({ candidates, sessionModelOnly: false })),
    configuredCandidates,
  };
```

In `src/server/speechInput/speechInputPolishingService.rateLimits.test.ts`, update `candidateResolver`:

```ts
function candidateResolver() {
  return {
    inspect: vi.fn().mockResolvedValue({
      candidates: [{ model, thinkingLevel: "off", slot: "lightweight" }],
      sessionModelOnly: false,
    }),
    configuredCandidates: vi.fn().mockResolvedValue([
      { model, thinkingLevel: "off", slot: "lightweight" },
    ]),
  };
}
```

- [ ] **Step 3: Confirm the typecheck sweep is green**

Run: `npm run typecheck`
Expected: PASS with no diagnostics. If any remaining diagnostic names a production file, fix that file within the contract of the task that owns it; if it names another test fake, add `sessionModelOnly: false` there too and record the file in the commit message.

- [ ] **Step 4: Run the affected test files and the broad gate**

Run:

```bash
npm test -- --run src/server/sessions/piSessionService.modelPolicy.test.ts src/server/sessions/piSessionService.promptQueue.test.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/speechInput/speechInputPolishingService.test.ts src/server/speechInput/speechInputPolishingService.rateLimits.test.ts
npm run verify:fast
```

Expected: the five resolver-dependent files PASS, and `verify:fast` (typecheck, lint, knip, four-worker test suite) exits 0. `npm run verify` remains the PM's final merge/release gate and is not required here.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/piSessionService.modelPolicy.test.ts src/server/sessions/piSessionService.promptQueue.test.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/speechInput/speechInputPolishingService.test.ts src/server/speechInput/speechInputPolishingService.rateLimits.test.ts
git commit -m "test(sessions): supply sessionModelOnly in resolver fakes"
```
