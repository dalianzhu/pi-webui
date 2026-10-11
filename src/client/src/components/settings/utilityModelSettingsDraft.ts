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
import {
  isKnownThinkingLevel,
  KNOWN_THINKING_LEVELS,
  type ThinkingLevel,
} from "../../../../shared/thinkingLevels";

export const AUTO_UTILITY_MODEL_THINKING = "auto" as const;

export type UtilityModelDraftThinkingLevel =
  | ThinkingLevel
  | typeof AUTO_UTILITY_MODEL_THINKING;

export type UtilityModelSettingsDraft = UtilityModelSettings;

export interface CompleteUtilityModelSettingsUpdate {
  lightweight: UtilityModelBinding | null;
  context: UtilityModelContextSetting | null;
}

export interface UtilityModelThinkingOption {
  value: UtilityModelDraftThinkingLevel;
  label: string;
  disabled: boolean;
}

export interface UtilityModelSettingsDraftValidation {
  valid: boolean;
  slots: Record<UtilityModelSlot, UtilityModelSlotValidation>;
}

export function utilityModelSettingsDraftFromResponse(
  response: UtilityModelSettingsResponse,
): UtilityModelSettingsDraft {
  return cloneUtilityModelSettings(response.settings);
}

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

export function updateUtilityModelDraftModel(
  draft: UtilityModelSettingsDraft,
  slot: UtilityModelSlot,
  selected: UtilityModelOption | undefined,
): UtilityModelSettingsDraft {
  return draftWithSlot(draft, slot, selected === undefined ? undefined : selected.model);
}

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

export function utilityModelThinkingOptions(
  response: UtilityModelSettingsResponse,
  binding: UtilityModelBinding | undefined,
): readonly UtilityModelThinkingOption[] {
  const automatic = autoThinkingOption();
  if (!supportsUtilityModelThinking(response) || binding === undefined) return [automatic];

  const selectedOption = response.models.find((option) => sameModel(option.model, binding));
  if (selectedOption === undefined) return [automatic];

  const supported = new Set(selectedOption.thinkingLevels);
  const ordered = KNOWN_THINKING_LEVELS.filter((level) => supported.has(level));
  const options: UtilityModelThinkingOption[] = [automatic];
  if (binding.thinkingLevel !== undefined && !supported.has(binding.thinkingLevel)) {
    options.push({
      value: binding.thinkingLevel,
      label: `${binding.thinkingLevel} (unavailable)`,
      disabled: true,
    });
  }
  options.push(...ordered.map((level) => ({ value: level, label: level, disabled: false })));
  return options;
}

export function validateUtilityModelSettingsDraft(
  draft: UtilityModelSettingsDraft,
  response: UtilityModelSettingsResponse,
): UtilityModelSettingsDraftValidation {
  const slots = {
    lightweight: validateUtilityModelSlot("lightweight", draft.lightweight, response),
    context: validateUtilityModelSlot("context", draft.context, response),
  } satisfies Record<UtilityModelSlot, UtilityModelSlotValidation>;
  return { valid: slots.lightweight.valid && slots.context.valid, slots };
}

export function utilityModelSettingsUpdateFromDraft(
  draft: UtilityModelSettingsDraft,
  response: UtilityModelSettingsResponse,
): CompleteUtilityModelSettingsUpdate | undefined {
  if (!validateUtilityModelSettingsDraft(draft, response).valid) return undefined;
  return {
    lightweight: draft.lightweight === undefined ? null : cloneBinding(draft.lightweight),
    context: draft.context === undefined ? null : cloneUtilityModelContextSetting(draft.context),
  };
}

function autoThinkingOption(): UtilityModelThinkingOption {
  return { value: AUTO_UTILITY_MODEL_THINKING, label: AUTO_UTILITY_MODEL_THINKING, disabled: false };
}

function cloneUtilityModelSettings(settings: UtilityModelSettings): UtilityModelSettings {
  return settingsFromBindings(settings.lightweight, settings.context);
}

function draftWithSlot(
  draft: UtilityModelSettingsDraft,
  slot: UtilityModelSlot,
  replacement: UtilityModelBinding | undefined,
): UtilityModelSettingsDraft {
  const lightweight = slot === "lightweight" ? replacement : draft.lightweight;
  const context = slot === "context" ? replacement : draft.context;
  return settingsFromBindings(lightweight, context);
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

function cloneBinding(binding: UtilityModelBinding): UtilityModelBinding {
  return {
    provider: binding.provider,
    id: binding.id,
    ...(binding.thinkingLevel === undefined ? {} : { thinkingLevel: binding.thinkingLevel }),
  };
}

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

function supportsThinkingLevel(option: UtilityModelOption, level: ThinkingLevel): boolean {
  return "thinkingLevels" in option && option.thinkingLevels.includes(level);
}

function sameModel(
  left: Pick<UtilityModelBinding, "provider" | "id">,
  right: Pick<UtilityModelBinding, "provider" | "id">,
): boolean {
  return left.provider === right.provider && left.id === right.id;
}

function describeModel(model: Pick<UtilityModelBinding, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}
