import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import {
  buildSessionContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { normalizeMessages } from "../../client/src/chatMessages";
import { readModelHttpErrorStatus, type ModelHttpErrorMetadata } from "../../shared/modelHttpError";
import { projectBrowserMessageResponse, projectBrowserSessionEvent } from "../browserMessageProjection";
import { withModelHttpErrorStatus } from "./modelHttpErrorStream";

const CONTEXT = normalizeContext({ messages: [] });

const SUPPORTED_MODEL: Model<Api> = {
  id: "demo-model",
  name: "Demo model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.test/v1",
  input: ["text"],
  reasoning: false,
  contextWindow: 128_000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const PASSTHROUGH_APIS: Api[] = [
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
  "custom-api",
];

function terminalMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "partial answer" }],
    api: SUPPORTED_MODEL.api,
    provider: SUPPORTED_MODEL.provider,
    model: SUPPORTED_MODEL.id,
    usage: {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
    },
    stopReason: "error",
    errorMessage: "provider failed",
    timestamp: 0,
    ...overrides,
  };
}

function durableAssistantError(): AssistantMessage & ModelHttpErrorMetadata {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private chain", thinkingSignature: "opaque-provider-payload" },
      { type: "text", text: "partial answer" },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "example-model",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    },
    stopReason: "error",
    errorMessage: "Rate limit exceeded.",
    timestamp: 1792200000000,
    piWebUiHttpStatus: 429,
  };
}

function response(status: number): Response {
  if (status >= 200 && status <= 599) {
    return new Response(status === 204 ? null : "body", { status });
  }
  const result = new Response(null, { status: 599 });
  Object.defineProperty(result, "status", { value: status });
  return result;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolvePromiseValue, rejectPromiseValue) => {
    resolvePromise = resolvePromiseValue;
    rejectPromise = rejectPromiseValue;
  });
  return {
    promise,
    resolve(value: T | PromiseLike<T>): void {
      if (resolvePromise === undefined) throw new Error("Deferred promise is not initialized.");
      resolvePromise(value);
    },
    reject(reason?: unknown): void {
      if (rejectPromise === undefined) throw new Error("Deferred promise is not initialized.");
      rejectPromise(reason);
    },
  };
}

function errorStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "error", reason: message.stopReason === "aborted" ? "aborted" : "error", error: message });
  stream.end(message);
  return stream;
}

async function invokeWrapped(
  wrapped: StreamFn,
  model: Model<Api> = SUPPORTED_MODEL,
  options?: SimpleStreamOptions,
): Promise<AssistantMessageEventStream> {
  return await wrapped(model, CONTEXT, options);
}

async function wrappedResult(
  delegate: StreamFn,
  options?: SimpleStreamOptions,
  model: Model<Api> = SUPPORTED_MODEL,
): Promise<AssistantMessage> {
  const stream = await invokeWrapped(withModelHttpErrorStatus(delegate), model, options);
  return await stream.result();
}

async function terminalEvents(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    if (event.type === "done" || event.type === "error") events.push(event);
  }
  return events;
}

function streamAfterFetch(
  options: SimpleStreamOptions | undefined,
  message: AssistantMessage,
  kind: "done" | "error" = "error",
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    await options?.fetch?.("https://example.test/request");
    if (kind === "done") stream.push({ type: "done", reason: "stop", message });
    else stream.push({ type: "error", reason: message.stopReason === "aborted" ? "aborted" : "error", error: message });
    stream.end(message);
  })();
  return stream;
}

async function runFetchTerminal(
  status: number,
  messageOverrides: Partial<AssistantMessage> = {},
): Promise<AssistantMessage> {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response(status)));
  const delegate: StreamFn = (_model, _context, options) => streamAfterFetch(options, terminalMessage(messageOverrides));
  const stream = await invokeWrapped(withModelHttpErrorStatus(delegate), SUPPORTED_MODEL, { fetch });
  const result = await stream.result();
  expect(await terminalEvents(stream)).toHaveLength(1);
  return result;
}

class ScriptedResultStream extends AssistantMessageEventStream {
  public constructor(
    private readonly events: AssistantMessageEvent[],
    private readonly finalMessage: AssistantMessage,
  ) {
    super();
  }

  public override async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
    await Promise.resolve();
    yield* this.events;
  }

  public override result(): Promise<AssistantMessage> {
    return Promise.resolve(this.finalMessage);
  }
}

class ThrowingStream extends AssistantMessageEventStream {
  public constructor(
    private readonly partial: AssistantMessage,
    private readonly failure: Error,
  ) {
    super();
  }

  public override async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
    await Promise.resolve();
    yield { type: "start", partial: this.partial };
    throw this.failure;
  }

  public override result(): Promise<AssistantMessage> {
    return new Promise(() => undefined);
  }
}

function expectNoStatus(message: AssistantMessage): void {
  expect(readModelHttpErrorStatus(message)).toBeUndefined();
  expect(Reflect.has(message, "piWebUiHttpStatus")).toBe(false);
}

describe("withModelHttpErrorStatus", () => {
  it.each([400, 429, 503])("attaches the response status %s to an error terminal", async (status) => {
    const result = await runFetchTerminal(status);
    expect(readModelHttpErrorStatus(result)).toBe(status);
  });

  it("uses the latest serial response and clears an earlier error response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(400));
    const delegate: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.fetch?.("first");
        await options?.fetch?.("second");
        const message = terminalMessage();
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      })();
      return stream;
    };

    const result = await wrappedResult(delegate, { fetch });
    expect(readModelHttpErrorStatus(result)).toBe(400);
  });

  it.each([200, 204, 399, 600])("does not attach a non-error response status %s", async (status) => {
    expectNoStatus(await runFetchTerminal(status));
  });

  it("does not attach a status when a later response is followed by a stream error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    const delegate: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.fetch?.("first");
        await options?.fetch?.("second");
        const message = terminalMessage({ errorMessage: "terminated" });
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      })();
      return stream;
    };

    expectNoStatus(await wrappedResult(delegate, { fetch }));
  });

  it("clears the status when the latest fetch rejects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(429))
      .mockRejectedValueOnce(new Error("Connection error."));
    const delegate: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          await options?.fetch?.("first");
          await options?.fetch?.("second");
        } catch (error) {
          const message = terminalMessage({ errorMessage: error instanceof Error ? error.message : String(error) });
          stream.push({ type: "error", reason: "error", error: message });
          stream.end(message);
        }
      })();
      return stream;
    };

    expectNoStatus(await wrappedResult(delegate, { fetch }));
  });

  it("does not attach a status when the first fetch rejects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error("Connection error.")));
    const delegate: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          await options?.fetch?.("request");
        } catch (error) {
          const message = terminalMessage({ errorMessage: error instanceof Error ? error.message : String(error) });
          stream.push({ type: "error", reason: "error", error: message });
          stream.end(message);
        }
      })();
      return stream;
    };

    expectNoStatus(await wrappedResult(delegate, { fetch }));
  });

  it("does not attach a status when two fetches overlap in one invocation", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>((input) => input === "first" ? first.promise : second.promise);
    const delegate: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const firstFetch = options?.fetch?.("first");
        const secondFetch = options?.fetch?.("second");
        await Promise.all([firstFetch, secondFetch]);
        const message = terminalMessage();
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      })();
      return stream;
    };

    const stream = await invokeWrapped(withModelHttpErrorStatus(delegate), SUPPORTED_MODEL, { fetch });
    second.resolve(response(400));
    first.resolve(response(429));
    expectNoStatus(await stream.result());
  });

  it("clears a prior response when a later fetch is still pending at finalization", async () => {
    const second = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(429))
      .mockReturnValueOnce(second.promise);
    const delegate: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.fetch?.("first");
        void options?.fetch?.("second");
        const message = terminalMessage();
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      })();
      return stream;
    };

    const stream = await invokeWrapped(withModelHttpErrorStatus(delegate), SUPPORTED_MODEL, { fetch });
    const result = await stream.result();
    second.resolve(response(400));
    expectNoStatus(result);
  });

  it("ignores a response that arrives after finalization", async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => pending.promise);
    const delegate: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      void options?.fetch?.("request");
      const message = terminalMessage();
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
      return stream;
    };

    const stream = await invokeWrapped(withModelHttpErrorStatus(delegate), SUPPORTED_MODEL, { fetch });
    const result = await stream.result();
    pending.resolve(response(429));
    await pending.promise;
    expectNoStatus(result);
  });

  it("owns capture state separately for concurrent invocations", async () => {
    const responseA = deferred<Response>();
    const responseB = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>((input) => input === "A" ? responseA.promise : responseB.promise);
    const delegate: StreamFn = (_model, _context, options) => {
      const requestId = options?.metadata?.["requestId"];
      if (typeof requestId !== "string") throw new Error("Missing test request id.");
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.fetch?.(requestId);
        const message = terminalMessage({ errorMessage: requestId });
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      })();
      return stream;
    };
    const wrapped = withModelHttpErrorStatus(delegate);
    const streamA = await invokeWrapped(wrapped, SUPPORTED_MODEL, { fetch, metadata: { requestId: "A" } });
    const streamB = await invokeWrapped(wrapped, SUPPORTED_MODEL, { fetch, metadata: { requestId: "B" } });

    responseB.resolve(response(400));
    const resultB = await streamB.result();
    responseA.resolve(response(429));
    const resultA = await streamA.result();

    expect(readModelHttpErrorStatus(resultA)).toBe(429);
    expect(readModelHttpErrorStatus(resultB)).toBe(400);
  });

  it("forwards the same response and preserves fetch receiver, arguments, and options", async () => {
    const receiver = { label: "receiver" };
    const responseValue = response(429);
    const init = { method: "POST", body: "payload" };
    const suppliedFetch = vi.fn(function (this: typeof receiver, input: RequestInfo | URL, requestInit?: RequestInit) {
      expect(this).toBe(receiver);
      expect(input).toBe("https://example.test/request");
      expect(requestInit).toBe(init);
      return Promise.resolve(responseValue);
    });
    const onResponse = vi.fn();
    let delegateOptions: SimpleStreamOptions | undefined;
    const currentStream = createAssistantMessageEventStream();
    const options: SimpleStreamOptions = {
      fetch: suppliedFetch,
      onResponse,
      headers: { "x-test": "value" },
      signal: new AbortController().signal,
    };
    const delegate: StreamFn = (_model, _context, receivedOptions) => {
      delegateOptions = receivedOptions;
      void (async () => {
        const observed = await receivedOptions?.fetch?.call(receiver, "https://example.test/request", init);
        expect(observed).toBe(responseValue);
        expect(receivedOptions?.onResponse).toBe(onResponse);
        const message = terminalMessage();
        currentStream.push({ type: "error", reason: "error", error: message });
        currentStream.end(message);
      })();
      return currentStream;
    };

    const result = await wrappedResult(delegate, options);
    expect(delegateOptions).not.toBe(options);
    expect(delegateOptions?.fetch).not.toBe(suppliedFetch);
    expect(delegateOptions?.onResponse).toBe(onResponse);
    expect(delegateOptions?.headers).toBe(options.headers);
    expect(options.fetch).toBe(suppliedFetch);
    expect(suppliedFetch).toHaveBeenCalledTimes(1);
    expect(readModelHttpErrorStatus(result)).toBe(429);
  });

  it("does not replace or invoke an existing onResponse callback", async () => {
    const suppliedFetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response(429)));
    const onResponse = vi.fn(() => Promise.resolve());
    const delegate: StreamFn = (_model, _context, options) => streamAfterFetch(options, terminalMessage());

    await wrappedResult(delegate, { fetch: suppliedFetch, onResponse });
    expect(onResponse).not.toHaveBeenCalled();
  });

  it.each(PASSTHROUGH_APIS)("passes original options through for %s", async (api) => {
    const model: Model<Api> = { ...SUPPORTED_MODEL, api };
    const options = { fetch: vi.fn<typeof globalThis.fetch>() } satisfies SimpleStreamOptions;
    let receivedOptions: SimpleStreamOptions | undefined;
    const delegate: StreamFn = (_model, _context, received) => {
      receivedOptions = received;
      return errorStream(terminalMessage({ api }));
    };

    await invokeWrapped(withModelHttpErrorStatus(delegate), model, options);
    expect(receivedOptions).toBe(options);
  });

  it("passes virtual routing options through without allocating a fetch observer", async () => {
    const model: Model<Api> = { ...SUPPORTED_MODEL, api: "pi-virtual" };
    const options = { fetch: vi.fn<typeof globalThis.fetch>() } satisfies SimpleStreamOptions;
    let receivedOptions: SimpleStreamOptions | undefined;
    const delegate: StreamFn = (_model, _context, received) => {
      receivedOptions = received;
      return errorStream(terminalMessage({ api: "pi-virtual" }));
    };

    await invokeWrapped(withModelHttpErrorStatus(delegate), model, options);
    expect(receivedOptions).toBe(options);
  });

  it("uses an existing final Bedrock diagnostic when no fetch ran", async () => {
    const message = terminalMessage({
      api: "bedrock-converse-stream",
      errorMessage: "Validation error",
      diagnostics: [{ type: "bedrock_response_failure", timestamp: 0, details: { status: 400 } }],
    });
    const model: Model<Api> = { ...SUPPORTED_MODEL, api: "bedrock-converse-stream" };

    const result = await wrappedResult(() => errorStream(message), undefined, model);
    expect(readModelHttpErrorStatus(result)).toBe(400);
  });

  it("adds an explicit SDK status to a synthetic escaping error", async () => {
    const delegate: StreamFn = () => {
      throw Object.assign(new Error("request failed"), { statusCode: 400, status: 429 });
    };

    const result = await wrappedResult(delegate);
    expect(result.stopReason).toBe("error");
    expect(readModelHttpErrorStatus(result)).toBe(400);
    expect(result.errorMessage).toBe("request failed");
  });

  it("does not fall through an explicit non-error SDK status", async () => {
    const delegate: StreamFn = () => {
      throw Object.assign(new Error("request failed"), { statusCode: 200, status: 429 });
    };

    expectNoStatus(await wrappedResult(delegate));
  });

  it("retains the latest partial when iteration throws", async () => {
    const partial = terminalMessage({
      content: [{ type: "text", text: "partial before failure" }],
      responseId: "response-1",
      stopReason: "pending",
    });
    const delegate: StreamFn = () => new ThrowingStream(
      partial,
      Object.assign(new Error("stream broke"), { "$metadata": { httpStatusCode: 503 } }),
    );

    const result = await wrappedResult(delegate);
    expect(result.content).toBe(partial.content);
    expect(result.responseId).toBe("response-1");
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("stream broke");
    expect(readModelHttpErrorStatus(result)).toBe(503);
  });

  it("synthesizes an aborted terminal for a synchronous delegate failure after abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const delegate: StreamFn = () => {
      throw new Error("cancelled");
    };

    const result = await wrappedResult(delegate, { signal: controller.signal });
    expect(result.stopReason).toBe("aborted");
    expect(result.errorMessage).toBe("Request was aborted");
    expectNoStatus(result);
  });

  it("uses the delegate result as canonical terminal identity", async () => {
    const eventMessage = terminalMessage({ errorMessage: "event message" });
    const resultMessage = terminalMessage({ errorMessage: "authoritative result" });
    const delegate: StreamFn = () => new ScriptedResultStream(
      [{ type: "error", reason: "error", error: eventMessage }],
      resultMessage,
    );

    const wrapper = await invokeWrapped(withModelHttpErrorStatus(delegate));
    const result = await wrapper.result();
    const events = await terminalEvents(wrapper);

    expect(events).toHaveLength(1);
    expect(events[0]?.type === "error" ? events[0].error : undefined).toBe(resultMessage);
    expect(result).toBe(resultMessage);
    expect(result.errorMessage).toBe("authoritative result");
  });

  it("finalizes a stream that ends with a result but emits no terminal event", async () => {
    const message = terminalMessage({ errorMessage: "ended directly" });
    const delegate: StreamFn = () => new ScriptedResultStream(
      [{ type: "start", partial: message }],
      message,
    );

    const wrapper = await invokeWrapped(withModelHttpErrorStatus(delegate));
    const result = await wrapper.result();
    const events = await terminalEvents(wrapper);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    expect(events[0]?.type === "error" ? events[0].error : undefined).toBe(result);
  });

  it("persists coded assistant errors through JSONL, reload, browser projection, and history normalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-webui-model-http-error-session-"));
    const sessionDir = join(root, "sessions");
    const cwd = join(root, "workspace");
    const rawMessage = durableAssistantError();

    try {
      const manager = SessionManager.create(cwd, sessionDir, { id: "coded-error-session" });
      manager.appendMessage(rawMessage);
      const sessionFile = manager.getSessionFile();
      if (sessionFile === undefined) throw new Error("Expected a persisted session file.");

      const jsonl = await readFile(sessionFile, "utf8");
      const persistedEntries: unknown[] = jsonl.trim().split("\n").map((line): unknown => JSON.parse(line));
      expect(persistedEntries).toContainEqual(expect.objectContaining({ type: "message", message: rawMessage }));
      expect(jsonl).toContain('"piWebUiHttpStatus":429');

      const reopened = SessionManager.open(sessionFile, sessionDir);
      const branchMessage = reopened.getBranch().find((entry) => entry.type === "message");
      const reopenedMessage = branchMessage?.type === "message" ? branchMessage.message : undefined;
      expect(reopenedMessage).toEqual(rawMessage);

      const context = buildSessionContext(reopened.getBranch(), reopened.getLeafId());
      expect(context.messages).toEqual([rawMessage]);

      const projectedHistory = projectBrowserMessageResponse({ messages: [rawMessage], start: 0, total: 1 });
      const projectedEvent = projectBrowserSessionEvent({ type: "message.end", message: rawMessage });
      const expectedBrowserMessage = {
        ...rawMessage,
        content: [
          { type: "thinking", thinking: "private chain" },
          { type: "text", text: "partial answer" },
        ],
      };
      expect(projectedHistory).toEqual({ messages: [expectedBrowserMessage], start: 0, total: 1 });
      expect(projectedEvent).toEqual({ type: "message.end", message: expectedBrowserMessage });
      if (projectedEvent.type !== "message.end" || projectedEvent.message === undefined) throw new Error("Expected a projected final-message event.");
      expect(projectedHistory).toEqual({ messages: [projectedEvent.message], start: 0, total: 1 });

      const liveLines = normalizeMessages([projectedEvent.message]);
      const reopenedHistoryLines = normalizeMessages(context.messages);
      const cachedRawHistoryLines = normalizeMessages([rawMessage]);
      const expectedLines = [
        {
          role: "assistant" as const,
          parts: [{ type: "thinking" as const, text: "private chain" }, { type: "text" as const, text: "partial answer" }],
          meta: { timestamp: "2026-10-17T01:20:00.000Z", model: { provider: "openai", id: "example-model" } },
        },
        {
          role: "system" as const,
          parts: [{ type: "text" as const, text: "Model response failed (HTTP 429): Rate limit exceeded." }],
          meta: { timestamp: "2026-10-17T01:20:00.000Z", model: { provider: "openai", id: "example-model" } },
        },
      ];
      expect(liveLines).toEqual(expectedLines);
      expect(reopenedHistoryLines).toEqual(expectedLines);
      expect(cachedRawHistoryLines).toEqual(expectedLines);
      expect(rawMessage).toEqual(durableAssistantError());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is idempotent when the same delegate is wrapped repeatedly", () => {
    const delegate: StreamFn = () => errorStream(terminalMessage());
    const wrapped = withModelHttpErrorStatus(delegate);

    expect(withModelHttpErrorStatus(wrapped)).toBe(wrapped);
  });
});
