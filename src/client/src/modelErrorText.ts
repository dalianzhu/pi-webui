import { readModelHttpErrorStatus } from "../../shared/modelHttpError";

export function formatAssistantModelError(message: unknown): string | undefined {
  if (getString(message, "role") !== "assistant" || getString(message, "stopReason") !== "error") return undefined;
  const errorMessage = getString(message, "errorMessage");
  const trimmedErrorMessage = errorMessage?.trim();
  const detail = trimmedErrorMessage === undefined || trimmedErrorMessage === ""
    ? "The model returned an error."
    : trimmedErrorMessage;
  const status = readModelHttpErrorStatus(message);
  if (status === undefined || explicitlyDisplaysHttpStatus(detail, status)) {
    return `Model response failed: ${detail}`;
  }
  return `Model response failed (HTTP ${String(status)}): ${detail}`;
}

function explicitlyDisplaysHttpStatus(detail: string, status: number): boolean {
  const number = String(status);
  const httpNumber = `(?<!\\d)${number}(?!\\d)`;
  const statusLabel = `status(?:[ \\t_-]*code)?`;

  const labelled = new RegExp(
    `\\bHTTP(?:[ \\t]+${statusLabel}|[ \\t]+(?:code|error))?[ \\t]*[:=]?[ \\t]*${httpNumber}`,
    "iu",
  );
  if (labelled.test(detail)) return true;

  const explicitStatus = new RegExp(`\\b${statusLabel}[ \\t]*[:=]?[ \\t]*${httpNumber}`, "iu");
  if (explicitStatus.test(detail)) return true;

  const providerReturned = new RegExp(`\\bprovider[ \\t]+returned[ \\t]+(?:HTTP[ \\t]+)?${httpNumber}`, "iu");
  if (providerReturned.test(detail)) return true;

  const providerWrapper = new RegExp(
    `\\b(?:OpenAI|Azure[ \\t]+OpenAI|Mistral)[ \\t]+API[ \\t]+error[ \\t]*\\([ \\t]*${httpNumber}[ \\t]*\\)`,
    "iu",
  );
  if (providerWrapper.test(detail)) return true;

  const startToken = new RegExp(`^${httpNumber}[ \\t]+(?:${statusLabel}\\b|\\{|rate[- \\t]+limit\\b|[A-Za-z]+(?:[ \\t-]+[A-Za-z]+)*[ \\t]*:)`, "u");
  if (startToken.test(detail)) return true;

  const startColon = new RegExp(`^${httpNumber}[ \\t]*:(?=[ \\t\\{]|$)`, "u");
  if (startColon.test(detail)) return true;

  const nestedToken = new RegExp(`(?:^|[ \\t:])${httpNumber}:(?=[ \\t\\{]|$)`, "u");
  return nestedToken.test(detail);
}

function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
