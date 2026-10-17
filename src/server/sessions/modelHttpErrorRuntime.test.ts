import {
  createAssistantMessageEventStream,
  createProvider,
  InMemoryCredentialStore,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type Provider,
  type ProviderStreams,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { readModelHttpErrorStatus } from "../../shared/modelHttpError";
import { withModelHttpErrorStatusRuntime } from "./modelHttpErrorStream";

const CONTEXT = normalizeContext({ messages: [] });
const OPENAI_PROVIDER = "status-runtime-openai";
const GOOGLE_PROVIDER = "status-runtime-google";
const ROUTER_PROVIDER = "status-runtime-router";
type ObservedOptionsMock = ReturnType<typeof vi.fn<(options: SimpleStreamOptions | undefined) => void>>;

function model(provider: string, id: string, api: Api): Model<Api> {
  return {
    id,
    name: id,
    api,
    provider,
    baseUrl: "https://example.test/v1",
    input: ["text"],
    reasoning: false,
    contextWindow: 16_000,
    maxTokens: 1_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function terminal(modelValue: Model<Api>, errorMessage = "provider failed"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "partial" }],
    api: modelValue.api,
    provider: modelValue.provider,
    model: modelValue.id,
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}

function providerStream(
  modelValue: Model<Api>,
  options: SimpleStreamOptions | undefined,
  observedOptions: (options: SimpleStreamOptions | undefined) => void,
): AssistantMessageEventStream {
  observedOptions(options);
  const stream = createAssistantMessageEventStream();
  void (async () => {
    if (options?.fetch !== undefined) await options.fetch("https://example.test/request");
    const message = terminal(modelValue);
    stream.push({ type: "error", reason: "error", error: message });
    stream.end(message);
  })();
  return stream;
}

function providerFor(
  providerId: string,
  modelValue: Model<Api>,
  observedOptions: (options: SimpleStreamOptions | undefined) => void,
): Provider {
  const streams: ProviderStreams = {
    stream: (_modelValue, _context, options) => providerStream(modelValue, options, observedOptions),
    streamSimple: (_modelValue, _context, options) => providerStream(modelValue, options, observedOptions),
  };
  return createProvider({
    id: providerId,
    name: providerId,
    auth: {
      apiKey: {
        name: "Test key",
        resolve: () => Promise.resolve({ auth: { apiKey: "test-key" } }),
      },
    },
    models: [modelValue],
    api: streams,
  });
}

async function runtimeFixture(): Promise<{
  runtime: ModelRuntime;
  openai: Model<Api>;
  google: Model<Api>;
  virtualOpenai: Model<Api>;
  virtualGoogle: Model<Api>;
  observedOpenai: ObservedOptionsMock;
  observedGoogle: ObservedOptionsMock;
}> {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  const openai = model(OPENAI_PROVIDER, "status-model", "openai-responses");
  const google = model(GOOGLE_PROVIDER, "google-model", "google-vertex");
  const observedOpenai = vi.fn<(options: SimpleStreamOptions | undefined) => void>();
  const observedGoogle = vi.fn<(options: SimpleStreamOptions | undefined) => void>();
  runtime.registerNativeProvider(providerFor(OPENAI_PROVIDER, openai, observedOpenai));
  runtime.registerNativeProvider(providerFor(GOOGLE_PROVIDER, google, observedGoogle));
  runtime.registerVirtualModel({
    provider: ROUTER_PROVIDER,
    id: "virtual-openai",
    name: "Virtual OpenAI",
    route: () => ({ model: openai, thinkingLevel: "off" }),
  });
  runtime.registerVirtualModel({
    provider: ROUTER_PROVIDER,
    id: "virtual-google",
    name: "Virtual Google",
    route: () => ({ model: google, thinkingLevel: "off" }),
  });
  await runtime.refresh({ allowNetwork: false });
  const virtualOpenai = runtime.getModel(ROUTER_PROVIDER, "virtual-openai");
  const virtualGoogle = runtime.getModel(ROUTER_PROVIDER, "virtual-google");
  if (virtualOpenai === undefined || virtualGoogle === undefined) {
    throw new Error("Expected virtual test models.");
  }
  return { runtime, openai, google, virtualOpenai, virtualGoogle, observedOpenai, observedGoogle };
}

function errorResponseFetch(status: number): typeof globalThis.fetch {
  return vi.fn(() => Promise.resolve(new Response("body", { status })));
}

describe("withModelHttpErrorStatusRuntime", () => {
  it("is idempotent and preserves the original runtime for other methods", async () => {
    const { runtime } = await runtimeFixture();
    const decorated = withModelHttpErrorStatusRuntime(runtime);

    expect(withModelHttpErrorStatusRuntime(decorated)).toBe(decorated);
    expect(decorated.getProvider(OPENAI_PROVIDER)).toBe(runtime.getProvider(OPENAI_PROVIDER));
    expect(Reflect.get(decorated, "completeSimple")).toBeTypeOf("function");
    expect(Reflect.get(decorated, "stream")).toBeTypeOf("function");
  });

  it("captures a supported physical streamSimple dispatch", async () => {
    const { runtime, openai, observedOpenai } = await runtimeFixture();
    const decorated = withModelHttpErrorStatusRuntime(runtime);
    const fetch = errorResponseFetch(429);

    const result = await decorated.streamSimple(openai, CONTEXT, { fetch }).result();

    expect(readModelHttpErrorStatus(result)).toBe(429);
    expect(observedOpenai).toHaveBeenCalledOnce();
    expect(observedOpenai.mock.calls[0]?.[0]?.fetch).not.toBe(fetch);
  });

  it("re-enters at the physical streamSimple boundary for a virtual supported route", async () => {
    const { runtime, virtualOpenai, observedOpenai } = await runtimeFixture();
    const decorated = withModelHttpErrorStatusRuntime(runtime);
    const fetch = errorResponseFetch(429);

    const result = await decorated.streamSimple(virtualOpenai, CONTEXT, { fetch }).result();

    expect(readModelHttpErrorStatus(result)).toBe(429);
    expect(observedOpenai).toHaveBeenCalledOnce();
    expect(observedOpenai.mock.calls[0]?.[0]?.fetch).not.toBe(fetch);
  });

  it("passes a virtual Google route through without allocating a custom fetch", async () => {
    const { runtime, virtualGoogle, observedGoogle } = await runtimeFixture();
    const decorated = withModelHttpErrorStatusRuntime(runtime);

    const result = await decorated.streamSimple(virtualGoogle, CONTEXT).result();

    expect(readModelHttpErrorStatus(result)).toBeUndefined();
    expect(observedGoogle).toHaveBeenCalledOnce();
    expect(observedGoogle.mock.calls[0]?.[0]?.fetch).toBeUndefined();
  });

  it("does not capture direct completeSimple calls", async () => {
    const { runtime, openai, observedOpenai } = await runtimeFixture();
    const decorated = withModelHttpErrorStatusRuntime(runtime);
    const fetch = errorResponseFetch(429);

    const result = await decorated.completeSimple(openai, CONTEXT, { fetch });

    expect(readModelHttpErrorStatus(result)).toBeUndefined();
    expect(observedOpenai).toHaveBeenCalledOnce();
    expect(observedOpenai.mock.calls[0]?.[0]?.fetch).toBe(fetch);
  });

  it("leaves unsupported physical APIs unchanged", async () => {
    const { runtime, google, observedGoogle } = await runtimeFixture();
    const decorated = withModelHttpErrorStatusRuntime(runtime);
    const fetch = errorResponseFetch(429);

    const result = await decorated.streamSimple(google, CONTEXT, { fetch }).result();

    expect(readModelHttpErrorStatus(result)).toBeUndefined();
    expect(observedGoogle).toHaveBeenCalledOnce();
    expect(observedGoogle.mock.calls[0]?.[0]?.fetch).toBe(fetch);
  });
});
