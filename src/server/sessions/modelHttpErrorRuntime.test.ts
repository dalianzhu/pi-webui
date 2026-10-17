import {
  createAssistantMessageEventStream,
  createProvider,
  InMemoryCredentialStore,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type Provider,
  type ProviderStreams,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { readModelHttpErrorStatus } from "../../shared/modelHttpError";
import { withModelHttpErrorStatus, withModelHttpErrorStatusRuntime } from "./modelHttpErrorStream";

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

interface InstalledAdapterFixture {
  api: Api;
  create: () => ProviderStreams;
  baseUrl: string;
  apiKey?: string;
}

const CODEX_FIXTURE_TOKEN = `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
})).toString("base64url")}.signature`;

const INSTALLED_ADAPTERS: readonly InstalledAdapterFixture[] = [
  { api: "openai-completions", create: openAICompletionsApi, baseUrl: "https://example.test/v1" },
  { api: "openai-responses", create: openAIResponsesApi, baseUrl: "https://example.test/v1" },
  { api: "azure-openai-responses", create: azureOpenAIResponsesApi, baseUrl: "https://example.test/openai" },
  { api: "anthropic-messages", create: anthropicMessagesApi, baseUrl: "https://example.test/v1" },
  { api: "mistral-conversations", create: mistralConversationsApi, baseUrl: "https://example.test/v1" },
  { api: "pi-messages", create: piMessagesApi, baseUrl: "https://example.test/v1" },
  {
    api: "openai-codex-responses",
    create: openAICodexResponsesApi,
    baseUrl: "https://example.test/backend-api",
    apiKey: CODEX_FIXTURE_TOKEN,
  },
];

function installedAdapterProvider(
  fixture: InstalledAdapterFixture,
  modelValue: Model<Api>,
): Provider {
  return createProvider({
    id: modelValue.provider,
    name: modelValue.provider,
    auth: {
      apiKey: {
        name: "Installed adapter fixture key",
        resolve: () => Promise.resolve({ auth: { apiKey: fixture.apiKey ?? "test-key" } }),
      },
    },
    models: [modelValue],
    api: fixture.create(),
  });
}

function installedAdapterFetch(status: number): typeof globalThis.fetch {
  return vi.fn(() => Promise.resolve(new Response(
    JSON.stringify({ error: { message: "quota exhausted" } }),
    { status, headers: { "content-type": "application/json" } },
  )));
}

function installedAdapterOptions(fixture: InstalledAdapterFixture): SimpleStreamOptions {
  return {
    apiKey: fixture.apiKey ?? "test-key",
    maxRetries: 0,
    timeoutMs: 1_000,
    ...(fixture.api === "openai-codex-responses" ? { transport: "sse" } : {}),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function cacheWarmerModel(): Model<Api> {
  return {
    ...model("cache-warmer-fixture", "cache-warmer-model", "openai-completions"),
    promptCache: { short: 20 },
    contextWindow: 200_000,
    cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 },
  };
}

async function createCacheWarmerFixture(responses: readonly number[]): Promise<{
  session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"];
  sessionManager: SessionManager;
  model: Model<Api>;
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  foregroundGate: ReturnType<typeof deferred<true>>;
  warmDone: ReturnType<typeof deferred<true>>;
  runs: { call: number; status: number; message: AssistantMessage }[];
}> {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  const modelValue = cacheWarmerModel();
  const foregroundGate = deferred<true>();
  const warmDone = deferred<true>();
  const runs: { call: number; status: number; message: AssistantMessage }[] = [];
  let providerCall = 0;
  const streams: ProviderStreams = {
    stream: (_modelValue, _context, options) => cacheWarmerStream(modelValue, options),
    streamSimple: (_modelValue, _context, options) => cacheWarmerStream(modelValue, options),
  };
  const cacheWarmerStream = (
    requestModel: Model<Api>,
    options: SimpleStreamOptions | undefined,
  ): AssistantMessageEventStream => {
    const call = ++providerCall;
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const response = await options?.fetch?.("https://example.test/cache-warmer");
      if (response === undefined) throw new Error("cache-warmer fixture did not receive fetch");
      if (call === 1) await foregroundGate.promise;
      const message: AssistantMessage = {
        ...terminal(requestModel, call === 1 ? "terminated" : "warm failed"),
        stopReason: response.status === 200 && call !== 1 ? "stop" : "error",
        ...(response.status === 200 && call !== 1 ? {} : { errorMessage: call === 1 ? "terminated" : "warm failed" }),
      };
      runs.push({ call, status: response.status, message });
      if (message.stopReason === "error") {
        stream.push({ type: "error", reason: "error", error: message });
      } else {
        stream.push({ type: "done", reason: "stop", message });
      }
      stream.end(message);
      if (call === 2) warmDone.resolve(true);
    })().catch((error: unknown) => {
      const message = terminal(requestModel, error instanceof Error ? error.message : String(error));
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
      if (call === 2) warmDone.resolve(true);
    });
    return stream;
  };
  const provider = createProvider({
    id: modelValue.provider,
    name: modelValue.provider,
    auth: {
      apiKey: {
        name: "Cache warmer fixture key",
        resolve: () => Promise.resolve({ auth: { apiKey: "test-key" } }),
      },
    },
    models: [modelValue],
    api: streams,
  });
  runtime.registerNativeProvider(provider);
  await runtime.refresh({ allowNetwork: false });
  const registeredModel = runtime.getModel(modelValue.provider, modelValue.id);
  if (registeredModel === undefined) throw new Error("Expected cache-warmer fixture model");

  const decorated = withModelHttpErrorStatusRuntime(runtime);
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "streaming" });
  const services = await createAgentSessionServices({
    cwd: process.cwd(),
    agentDir: "/tmp/pi-webui-cache-warmer-test-agent",
    modelRuntime: decorated,
    settingsManager,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    },
  });
  const sessionManager = SessionManager.inMemory(process.cwd());
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model: registeredModel,
    thinkingLevel: "off",
    noTools: "all",
  });
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "prior response" }],
    api: registeredModel.api,
    provider: registeredModel.provider,
    model: registeredModel.id,
    usage: {
      input: 100_000,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100_001,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  });
  session.refreshContext();

  let fetchCount = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    const status = responses[fetchCount] ?? 500;
    fetchCount += 1;
    return Promise.resolve(new Response("fixture body", { status }));
  });
  return { session, sessionManager, model: registeredModel, fetch, foregroundGate, warmDone, runs };
}

async function runCacheWarmerScenario(
  foregroundStatus: number,
  warmStatus: number,
  sharedAgentCapture = false,
): Promise<Awaited<ReturnType<typeof createCacheWarmerFixture>> & {
  foregroundResult: AssistantMessage;
  foregroundEvents: AssistantMessageEvent[];
}> {
  const fixture = await createCacheWarmerFixture([foregroundStatus, warmStatus]);
  if (sharedAgentCapture) {
    fixture.session.agent.streamFunction = withModelHttpErrorStatus(fixture.session.agent.streamFunction);
  }
  vi.useFakeTimers();
  try {
    const requestOptions: SimpleStreamOptions = {
      sessionId: fixture.sessionManager.getSessionId(),
      fetch: fixture.fetch,
      maxRetries: 0,
    };
    const foreground = await fixture.session.agent.streamFunction(fixture.model, CONTEXT, requestOptions);
    const foregroundResultPromise = foreground.result();
    const foregroundEventsPromise = collectEvents(foreground);
    await vi.advanceTimersByTimeAsync(10_000);
    await fixture.warmDone.promise;
    fixture.foregroundGate.resolve(true);
    const [foregroundResult, foregroundEvents] = await Promise.all([
      foregroundResultPromise,
      foregroundEventsPromise,
    ]);
    return { ...fixture, foregroundResult, foregroundEvents };
  } finally {
    fixture.session.dispose();
    vi.useRealTimers();
  }
}

async function collectEvents(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function orderedRunStatuses(runs: readonly { call: number; status: number }[]): number[] {
  return [...runs].sort((left, right) => left.call - right.call).map(({ status }) => status);
}

describe("installed model HTTP adapters", () => {
  it.each(INSTALLED_ADAPTERS.flatMap((fixture) => [400, 429].map((status) => ({ fixture, status }))))(
    "captures HTTP $status from installed $fixture.api streamSimple",
    async ({ fixture, status }) => {
      const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
      });
      const providerId = `installed-status-${fixture.api}`;
      const modelValue = { ...model(providerId, `fixture-${fixture.api}`, fixture.api), baseUrl: fixture.baseUrl };
      runtime.registerNativeProvider(installedAdapterProvider(fixture, modelValue));
      await runtime.refresh({ allowNetwork: false });
      const registeredModel = runtime.getModel(providerId, modelValue.id);
      if (registeredModel === undefined) throw new Error(`Expected installed ${fixture.api} model`);
      const decorated = withModelHttpErrorStatusRuntime(runtime);
      const fetch = installedAdapterFetch(status);
      const options = { ...installedAdapterOptions(fixture), fetch };
      const stream = decorated.streamSimple(registeredModel, CONTEXT, options);
      const eventsPromise = collectEvents(stream);
      const result = await stream.result();
      const events = await eventsPromise;

      expect(readModelHttpErrorStatus(result)).toBe(status);
      expect(fetch).toHaveBeenCalledOnce();
      expect(events.filter((event) => event.type === "error")).toHaveLength(1);
      expect(events.find((event) => event.type === "error")?.type === "error"
        ? events.find((event) => event.type === "error")?.error
        : undefined).toBe(result);
    },
  );
});

describe("installed SDK cache-warmer capture ownership", () => {
  it("does not attach a cache-warmer 429 to a foreground 200 terminated response", async () => {
    const fixture = await runCacheWarmerScenario(200, 429);

    expect(orderedRunStatuses(fixture.runs)).toEqual([200, 429]);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(fixture.foregroundResult.stopReason).toBe("error");
    expect(fixture.foregroundResult.errorMessage).toBe("terminated");
    expect(readModelHttpErrorStatus(fixture.foregroundResult)).toBeUndefined();
    const terminalEvent = fixture.foregroundEvents.find((event) => event.type === "error");
    expect(terminalEvent?.type === "error" ? terminalEvent.error : undefined).toBe(fixture.foregroundResult);
    expect(terminalEvent?.type === "error" ? readModelHttpErrorStatus(terminalEvent.error) : undefined).toBeUndefined();
  });

  it("retains a foreground 429 when a later cache-warmer response is 200", async () => {
    const fixture = await runCacheWarmerScenario(429, 200);

    expect(orderedRunStatuses(fixture.runs)).toEqual([429, 200]);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(readModelHttpErrorStatus(fixture.foregroundResult)).toBe(429);
    const terminalEvent = fixture.foregroundEvents.find((event) => event.type === "error");
    expect(terminalEvent?.type === "error" ? terminalEvent.error : undefined).toBe(fixture.foregroundResult);
    expect(terminalEvent?.type === "error" ? readModelHttpErrorStatus(terminalEvent.error) : undefined).toBe(429);
  });

  it("exposes the contamination from one shared agent-stream capture closure", async () => {
    const warmerFailure = await runCacheWarmerScenario(200, 429, true);
    expect(readModelHttpErrorStatus(warmerFailure.foregroundResult)).toBe(429);

    const warmerSuccess = await runCacheWarmerScenario(429, 200, true);
    expect(readModelHttpErrorStatus(warmerSuccess.foregroundResult)).toBeUndefined();
  });
});

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
