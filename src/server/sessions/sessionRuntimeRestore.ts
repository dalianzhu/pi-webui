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
  entries: readonly unknown[],
): SessionRuntimeSelectionInspection {
  let modelEntry: Record<string, unknown> | undefined;
  let thinkingEntry: Record<string, unknown> | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry)) continue;
    if (modelEntry === undefined && entry["type"] === "model_change") modelEntry = entry;
    if (thinkingEntry === undefined && entry["type"] === "thinking_level_change") {
      thinkingEntry = entry;
    }
    if (modelEntry !== undefined && thinkingEntry !== undefined) break;
  }
  if (modelEntry === undefined) return { kind: "none" };

  const provider = modelEntry["provider"];
  if (typeof provider !== "string" || provider.trim() === "") {
    return { kind: "invalid", reason: "model change provider must be a non-blank string" };
  }
  const modelId = modelEntry["modelId"];
  if (typeof modelId !== "string" || modelId.trim() === "") {
    return { kind: "invalid", reason: "model change model id must be a non-blank string" };
  }

  if (thinkingEntry === undefined) {
    return { kind: "selection", model: { provider, id: modelId } };
  }
  const thinkingLevel = thinkingEntry["thinkingLevel"];
  if (typeof thinkingLevel !== "string" || thinkingLevel.trim() === "") {
    return { kind: "invalid", reason: "thinking level must be a non-blank string" };
  }
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
    | undefined,
): string | undefined {
  const described = `${selection.model.provider}/${selection.model.id}`;
  const unavailable = `the newest recorded model ${described} is unavailable in this session's catalog`;
  if (resolvedModel === undefined) return unavailable;
  if (
    resolvedModel.provider !== selection.model.provider ||
    resolvedModel.id !== selection.model.id
  ) {
    return unavailable;
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
  selection: { model: { provider: string; id: string }; thinkingLevel?: string },
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
  exact: ExactModelSelection,
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
