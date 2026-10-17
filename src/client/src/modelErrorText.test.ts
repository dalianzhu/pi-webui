import { describe, expect, it } from "vitest";
import { formatAssistantModelError } from "./modelErrorText";

function assistant(errorMessage: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { role: "assistant", stopReason: "error", errorMessage, ...extra };
}

describe("formatAssistantModelError", () => {
  it("formats uncoded ordinary descriptions with the selected HTTP status", () => {
    expect(formatAssistantModelError(assistant("Invalid request.", { piWebUiHttpStatus: 400 })))
      .toBe("Model response failed (HTTP 400): Invalid request.");
    expect(formatAssistantModelError(assistant("Rate limit exceeded.", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed (HTTP 429): Rate limit exceeded.");
    expect(formatAssistantModelError(assistant("Service unavailable.", { piWebUiHttpStatus: 503 })))
      .toBe("Model response failed (HTTP 503): Service unavailable.");
  });

  it("uses the fallback description when the saved description is missing, non-string, or blank", () => {
    const expected = "Model response failed (HTTP 400): The model returned an error.";
    expect(formatAssistantModelError(assistant(undefined, { piWebUiHttpStatus: 400 }))).toBe(expected);
    expect(formatAssistantModelError(assistant(429, { piWebUiHttpStatus: 400 }))).toBe(expected);
    expect(formatAssistantModelError(assistant("  \t", { piWebUiHttpStatus: 400 }))).toBe(expected);
  });

  it("keeps an uncoded terminated error unchanged", () => {
    expect(formatAssistantModelError(assistant("terminated"))).toBe("Model response failed: terminated");
  });

  it("does not duplicate explicitly displayed HTTP status forms", () => {
    const cases: [number, string][] = [
      [429, "HTTP 429: Rate limit exceeded."],
      [429, "429: {\"message\":\"Rate limit exceeded\"}"],
      [400, "400 status code (no body)"],
      [429, "429 {\"error\":{\"message\":\"Rate limit exceeded\"}}"],
      [429, "OpenAI API error (429): quota exhausted"],
      [400, "Azure OpenAI API error (400): invalid"],
      [429, "Mistral API error (429): quota exhausted"],
      [429, "429 Too Many Requests: quota exhausted"],
      [429, "Unknown: 429: quota exhausted"],
      [429, "429 rate limit"],
      [429, "429 rate-limit"],
      [429, "provider returned 429"],
    ];
    for (const [status, detail] of cases) {
      expect(formatAssistantModelError(assistant(detail, { piWebUiHttpStatus: status }))).toBe(`Model response failed: ${detail}`);
    }
  });

  it("recognizes labels case-insensitively and after nested separators", () => {
    expect(formatAssistantModelError(assistant("hTtP status: 429: failed", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed: hTtP status: 429: failed");
    expect(formatAssistantModelError(assistant("Server requested . 429: {body}", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed: Server requested . 429: {body}");
    expect(formatAssistantModelError(assistant("provider returned HTTP 429", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed: provider returned HTTP 429");
  });

  it("does not treat unrelated numbers or wording as an explicit HTTP status", () => {
    expect(formatAssistantModelError(assistant("request 1429 failed", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed (HTTP 429): request 1429 failed");
    expect(formatAssistantModelError(assistant("500 tokens were requested", { piWebUiHttpStatus: 500 })))
      .toBe("Model response failed (HTTP 500): 500 tokens were requested");
    expect(formatAssistantModelError(assistant("provider returned 500"))).toBe("Model response failed: provider returned 500");
    expect(formatAssistantModelError(assistant("rate limit exceeded", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed (HTTP 429): rate limit exceeded");
    expect(formatAssistantModelError(assistant("code: 429", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed (HTTP 429): code: 429");
    expect(formatAssistantModelError(assistant("429:12", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed (HTTP 429): 429:12");
  });

  it("preserves conflicting provider text while selecting saved metadata", () => {
    expect(formatAssistantModelError(assistant("HTTP 400: Invalid request.", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed (HTTP 429): HTTP 400: Invalid request.");
    expect(formatAssistantModelError(assistant("HTTP 400 and HTTP 429", { piWebUiHttpStatus: 429 })))
      .toBe("Model response failed: HTTP 400 and HTTP 429");
  });

  it("reads a valid status from a final Bedrock diagnostic", () => {
    expect(formatAssistantModelError(assistant("Validation error: Invalid probe request", {
      api: "bedrock-converse-stream",
      diagnostics: [{ type: "bedrock_response_failure", details: { status: 400 } }],
    }))).toBe("Model response failed (HTTP 400): Validation error: Invalid probe request");
  });

  it("ignores malformed status metadata", () => {
    expect(formatAssistantModelError(assistant("terminated", { piWebUiHttpStatus: "429" }))).toBe("Model response failed: terminated");
    expect(formatAssistantModelError(assistant("terminated", { piWebUiHttpStatus: 200 }))).toBe("Model response failed: terminated");
    expect(formatAssistantModelError(assistant("terminated", { piWebUiHttpStatus: 600 }))).toBe("Model response failed: terminated");
  });

  it("returns no line for non-assistant, successful, aborted, and tool-result messages", () => {
    expect(formatAssistantModelError({ role: "user", stopReason: "error", errorMessage: "bad", piWebUiHttpStatus: 429 })).toBeUndefined();
    expect(formatAssistantModelError(assistant("bad", { stopReason: "stop", piWebUiHttpStatus: 429 }))).toBeUndefined();
    expect(formatAssistantModelError(assistant("aborted", { stopReason: "aborted", piWebUiHttpStatus: 429 }))).toBeUndefined();
    expect(formatAssistantModelError({ role: "toolResult", stopReason: "error", errorMessage: "bad", piWebUiHttpStatus: 429 })).toBeUndefined();
  });

  it("trims only the outer description whitespace", () => {
    expect(formatAssistantModelError(assistant("  Invalid  request.  ", { piWebUiHttpStatus: 400 })))
      .toBe("Model response failed (HTTP 400): Invalid  request.");
  });
});
