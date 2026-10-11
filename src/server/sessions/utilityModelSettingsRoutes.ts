import type { FastifyInstance } from "fastify";
import { parseUtilityModelsConfig } from "../../config.js";
import { PiWebUiConfigMutationBusyError } from "../../configMutationCoordinator.js";
import { UTILITY_MODEL_SESSION_ONLY, UTILITY_MODEL_SLOTS, type UtilityModelSettingsUpdate, type UtilityModelSlot } from "../../shared/apiTypes.js";
import type { UtilityModelSettingsService } from "./utilityModelSettingsService.js";

export interface UtilityModelSettingsRouteService {
  inspect(): ReturnType<UtilityModelSettingsService["inspect"]>;
  update(patch: UtilityModelSettingsUpdate): ReturnType<UtilityModelSettingsService["update"]>;
}

export function registerUtilityModelSettingsRoutes(app: FastifyInstance, service: UtilityModelSettingsRouteService, prefix = ""): void {
  app.get(`${prefix}/utility-models`, async (_request, reply) => {
    try {
      return await service.inspect();
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: unknown }>(`${prefix}/utility-models`, async (request, reply) => {
    try {
      return await service.update(parseUpdate(request.body));
    } catch (error) {
      return reply.code(settingsMutationErrorStatus(error)).send({ error: errorMessage(error) });
    }
  });
}

function settingsMutationErrorStatus(error: unknown): number {
  return error instanceof PiWebUiConfigMutationBusyError ? 503 : 400;
}

function parseUpdate(value: unknown): UtilityModelSettingsUpdate {
  if (!isRecord(value)) throw new Error("Expected object body");
  const unknownField = Object.keys(value).find((key) => key !== "settings");
  if (unknownField !== undefined) throw new Error(`unknown field ${JSON.stringify(unknownField)}; expected exactly settings`);
  if (!Object.prototype.hasOwnProperty.call(value, "settings")) throw new Error("settings is required");
  return parseSettingsUpdate(value["settings"]);
}

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

function isUtilityModelSlot(value: string): value is UtilityModelSlot {
  return UTILITY_MODEL_SLOTS.some((slot) => slot === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
