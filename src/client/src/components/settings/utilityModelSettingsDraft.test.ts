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

const lightweightModel = { provider: "openai", id: "gpt-small" };
const contextModel = { provider: "anthropic", id: "claude-context" };
const unavailableModel = { provider: "retired", id: "model" };

const lightweightOption: UtilityModelOptionV2 = {
  model: lightweightModel,
  name: "Small",
  thinkingLevels: ["max", "off", "xhigh", "low"],
};

const contextOption: UtilityModelOptionV2 = {
  model: contextModel,
  name: "Context",
  thinkingLevels: ["high", "medium", "off"],
};

function responseV2(overrides: Partial<UtilityModelSettingsResponseV2> = {}): UtilityModelSettingsResponseV2 {
  return {
    contractVersion: 2,
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

function responseV1(overrides: Partial<UtilityModelSettingsResponseV1> = {}): UtilityModelSettingsResponseV1 {
  return {
    contractVersion: 1,
    settings: {},
    models: [
      { model: lightweightModel, name: "Small" },
      { model: contextModel, name: "Context" },
    ],
    slots: {
      lightweight: { valid: true },
      context: { valid: true },
    },
    valid: true,
    ...overrides,
  };
}

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

describe("utility model settings drafts", () => {
  it("clones response bindings without retaining mutable nested state", () => {
    const source = responseV2({
      settings: {
        lightweight: { ...lightweightModel, thinkingLevel: "low" },
        context: { ...contextModel },
      },
    });

    const draft = utilityModelSettingsDraftFromResponse(source);

    expect(draft).toEqual(source.settings);
    expect(draft).not.toBe(source.settings);
    expect(draft.lightweight).not.toBe(source.settings.lightweight);
    expect(draft.context).not.toBe(source.settings.context);
  });

  it("resets thinking when any model is selected and omits it again for auto", () => {
    const source = utilityModelSettingsDraftFromResponse(responseV2({
      settings: { lightweight: { ...lightweightModel, thinkingLevel: "low" } },
    }));

    const selected = updateUtilityModelDraftModel(source, "lightweight", contextOption);
    expect(selected).toEqual({ lightweight: { ...contextModel } });
    expect(source).toEqual({ lightweight: { ...lightweightModel, thinkingLevel: "low" } });

    const explicit = updateUtilityModelDraftThinkingLevel(selected, "lightweight", "high");
    expect(explicit).toEqual({ lightweight: { ...contextModel, thinkingLevel: "high" } });

    const automatic = updateUtilityModelDraftThinkingLevel(
      explicit,
      "lightweight",
      AUTO_UTILITY_MODEL_THINKING,
    );
    expect(automatic).toEqual({ lightweight: { ...contextModel } });
    expect(automatic.lightweight).not.toHaveProperty("thinkingLevel");
  });

  it("orders version 2 thinking options canonically from the selected model capability", () => {
    const options = utilityModelThinkingOptions(
      responseV2(),
      { ...lightweightModel, thinkingLevel: "low" },
    );

    expect(options).toEqual([
      { value: "auto", label: "auto", disabled: false },
      { value: "off", label: "off", disabled: false },
      { value: "low", label: "low", disabled: false },
      { value: "xhigh", label: "xhigh", disabled: false },
      { value: "max", label: "max", disabled: false },
    ]);
  });

  it("keeps a stale known thinking level visible, invalid, and repairable through auto", () => {
    const source = responseV2({
      settings: {
        lightweight: { ...lightweightModel, thinkingLevel: "high" },
        context: { ...contextModel, thinkingLevel: "medium" },
      },
    });
    const draft = utilityModelSettingsDraftFromResponse(source);
    const options = utilityModelThinkingOptions(source, draft.lightweight);

    expect(options.filter((option) => option.value === "high")).toEqual([
      { value: "high", label: "high (unavailable)", disabled: true },
    ]);
    expect(options.map((option) => option.value)).toEqual(["auto", "high", "off", "low", "xhigh", "max"]);
    const validation = validateUtilityModelSettingsDraft(draft, source);
    expect(validation.valid).toBe(false);
    expect(validation.slots.lightweight.valid).toBe(false);
    expect(validation.slots.context).toEqual({ valid: true });

    const repaired = updateUtilityModelDraftThinkingLevel(
      draft,
      "lightweight",
      AUTO_UTILITY_MODEL_THINKING,
    );
    expect(repaired.lightweight).toEqual(lightweightModel);
    expect(validateUtilityModelSettingsDraft(repaired, source).valid).toBe(true);
  });

  it("returns auto-only thinking options for version 1, empty, and stale bindings", () => {
    const automatic = [{ value: "auto", label: "auto", disabled: false }];

    expect(utilityModelThinkingOptions(responseV1(), { ...lightweightModel })).toEqual(automatic);
    expect(utilityModelThinkingOptions(responseV2(), undefined)).toEqual(automatic);
    expect(utilityModelThinkingOptions(responseV2(), { ...unavailableModel })).toEqual(automatic);
  });

  it("builds complete updates with null empty slots and clones explicit version 2 bindings", () => {
    const source = responseV2();
    const empty = utilityModelSettingsUpdateFromDraft({}, source);
    expect(empty).toEqual({ lightweight: null, context: null });
    expect(Object.keys(empty ?? {})).toEqual(["lightweight", "context"]);

    const draft = {
      lightweight: { ...lightweightModel, thinkingLevel: "max" },
      context: { ...contextModel, thinkingLevel: "medium" },
    } satisfies Record<string, UtilityModelBinding>;
    const update = utilityModelSettingsUpdateFromDraft(draft, source);
    expect(update).toEqual(draft);
    expect(update?.lightweight).not.toBe(draft.lightweight);
    expect(update?.context).not.toBe(draft.context);
  });

  it("refuses updates for stale model and stale thinking state", () => {
    const source = responseV2();

    expect(utilityModelSettingsUpdateFromDraft({ lightweight: { ...unavailableModel } }, source)).toBeUndefined();
    expect(
      utilityModelSettingsUpdateFromDraft(
        { lightweight: { ...lightweightModel, thinkingLevel: "high" } },
        source,
      ),
    ).toBeUndefined();
  });

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
    const checkResponse = (response: UtilityModelSettingsResponse): void => {
      if (supportsUtilityModelThinking(response)) {
        expect(response.models[0]?.thinkingLevels).toBeDefined();
      } else {
        expect(response.contractVersion).toBe(1);
      }
    };

    checkResponse(responseV1());
    checkResponse(responseV2());
  });
});
