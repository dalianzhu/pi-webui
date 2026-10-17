export interface ModelHttpErrorMetadata {
  piWebUiHttpStatus?: number;
}

export function isHttpErrorStatus(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && Number.isFinite(value)
    && value >= 400
    && value <= 599;
}

export function readModelHttpErrorStatus(message: unknown): number | undefined {
  if (!isRecord(message)) return undefined;

  const localStatus = message["piWebUiHttpStatus"];
  if (isHttpErrorStatus(localStatus)) return localStatus;

  if (message["api"] !== "bedrock-converse-stream") return undefined;
  const diagnostics = message["diagnostics"];
  if (!Array.isArray(diagnostics)) return undefined;

  let lastFailure: Record<string, unknown> | undefined;
  for (const diagnostic of diagnostics) {
    if (isRecord(diagnostic) && diagnostic["type"] === "bedrock_response_failure") {
      lastFailure = diagnostic;
    }
  }
  if (lastFailure === undefined) return undefined;

  const details = lastFailure["details"];
  return isRecord(details) && isHttpErrorStatus(details["status"]) ? details["status"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
