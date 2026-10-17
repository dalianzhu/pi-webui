import { describe, expect, it } from "vitest";
import type { ModelHttpErrorMetadata } from "./modelHttpError";
import { isHttpErrorStatus, readModelHttpErrorStatus } from "./modelHttpError";

describe("isHttpErrorStatus", () => {
  it("accepts only finite integer HTTP error statuses", () => {
    expect([400, 429, 500, 599].map(isHttpErrorStatus)).toEqual([true, true, true, true]);
    expect([undefined, null, "429", 0, 200, 399, 600, 429.5, Number.NaN, Infinity].map(isHttpErrorStatus))
      .toEqual([false, false, false, false, false, false, false, false, false, false]);
  });
});

describe("readModelHttpErrorStatus", () => {
  it("prefers valid local metadata", () => {
    const metadata: ModelHttpErrorMetadata = { piWebUiHttpStatus: 429 };
    expect(readModelHttpErrorStatus(metadata)).toBe(429);
  });

  it("does not read arbitrary status-shaped message fields", () => {
    expect(readModelHttpErrorStatus({ status: 429, statusCode: 429, code: 429 })).toBeUndefined();
  });

  it("uses only the last matching Bedrock failure diagnostic", () => {
    expect(readModelHttpErrorStatus({
      api: "bedrock-converse-stream",
      diagnostics: [
        { type: "bedrock_response_failure", details: { status: 429 } },
        { type: "bedrock_response_failure", details: {} },
      ],
    })).toBeUndefined();
  });

  it("ignores diagnostics with other failure types", () => {
    expect(readModelHttpErrorStatus({
      api: "bedrock-converse-stream",
      diagnostics: [{ type: "provider_transport_failure", details: { status: 429 } }],
    })).toBeUndefined();
  });

  it("gives valid local metadata priority over the Bedrock diagnostic", () => {
    expect(readModelHttpErrorStatus({
      api: "bedrock-converse-stream",
      piWebUiHttpStatus: 503,
      diagnostics: [{ type: "bedrock_response_failure", details: { status: 400 } }],
    })).toBe(503);
  });

  it("falls back from invalid local metadata to the Bedrock diagnostic", () => {
    expect(readModelHttpErrorStatus({
      api: "bedrock-converse-stream",
      piWebUiHttpStatus: "503",
      diagnostics: [{ type: "bedrock_response_failure", details: { status: 400 } }],
    })).toBe(400);
  });

  it("defensively ignores malformed diagnostic containers", () => {
    expect(readModelHttpErrorStatus({ api: "bedrock-converse-stream", diagnostics: "invalid" })).toBeUndefined();
    expect(readModelHttpErrorStatus({ api: "bedrock-converse-stream", diagnostics: [null, {}] })).toBeUndefined();
    expect(readModelHttpErrorStatus({ api: "other", diagnostics: [{ type: "bedrock_response_failure", details: { status: 429 } }] })).toBeUndefined();
    expect(readModelHttpErrorStatus(null)).toBeUndefined();
  });
});
