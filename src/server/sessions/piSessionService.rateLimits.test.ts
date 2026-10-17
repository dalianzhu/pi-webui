import {
  createAssistantMessageEventStream,
  createProvider,
  InMemoryCredentialStore,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Model,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type SessionBeforeTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { readModelHttpErrorStatus } from "../../shared/modelHttpError";
import { MODEL_RATE_LIMITS_BLOCKED_MESSAGE, createModelRateLimitOwner, type ModelRateLimitOwner } from "../rateLimits/modelRateLimitOwner";
import { wrapModelStream } from "../rateLimits/modelRateLimitAdapters";
import {
  createFakeModelRateLimitClock,
  fixtureIdentity,
  fixtureLimits,
  fixtureSnapshot,
  fixtureTerminalMessage,
} from "../rateLimits/modelRateLimit.testSupport";
import { createDefaultRuntimeFactory } from "./piSessionService";
import { createTestModelRuntime, fakeAgentSessionServices, fakeRuntime, seedCredential, sessionGateway, testModel, TEST_MODEL_ID, TEST_MODEL_PROVIDER, testModelRuntime } from "./piSessionService.testSupport";

const TEST_AGENT_DIR = "/tmp/pi-webui-test-agent";
const identity = fixtureIdentity("anthropic", "demo-model");
const candidateIdentity = fixtureIdentity("anthropic", "utility-lightweight");

/** Catalog-typed model for StreamFn calls; `testModel()` is `Model<any>`. */
function catalogModel() {
  const model = testModelRuntime.getModel(TEST_MODEL_PROVIDER, TEST_MODEL_ID);
  if (model === undefined) throw new Error("test model not found");
  return model;
}

function completedStream(input: number): StreamFn {
  return (model) => {
    const stream = createAssistantMessageEventStream();
    const base = fixtureTerminalMessage({ api: model.api, provider: model.provider, model: model.id });
    const message: AssistantMessage = fixtureTerminalMessage({
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { ...base.usage, input, totalTokens: input },
    });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
}

const CAPTURE_PROVIDER = "factory-capture-anthropic";
const CAPTURE_MODEL_ID = "factory-capture-model";

function captureModel(): Model<Api> {
  return {
    ...catalogModel(),
    id: CAPTURE_MODEL_ID,
    provider: CAPTURE_PROVIDER,
    api: "anthropic-messages",
    baseUrl: "https://example.test/v1",
  };
}

async function captureRuntimeFixture(status: number) {
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  const modelValue = captureModel();
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response("body", { status })));
  let dispatches = 0;
  const expectedUsage = {
    input: 7,
    output: 3,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 13,
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
  };
  const streams: ProviderStreams = {
    stream: (requestModel, _context, options) => {
      dispatches += 1;
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const response = await options?.fetch?.("https://example.test/request");
        const message = fixtureTerminalMessage({
          api: requestModel.api,
          provider: requestModel.provider,
          model: requestModel.id,
          usage: {
            input: 7,
            output: 3,
            cacheRead: 2,
            cacheWrite: 1,
            totalTokens: 13,
            cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
          },
          stopReason: "error",
          errorMessage: "provider failed",
        });
        void response;
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      })();
      return stream;
    },
    streamSimple: (requestModel, _context, options) => {
      dispatches += 1;
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.fetch?.("https://example.test/request");
        const message = fixtureTerminalMessage({
          api: requestModel.api,
          provider: requestModel.provider,
          model: requestModel.id,
          usage: {
            input: 7,
            output: 3,
            cacheRead: 2,
            cacheWrite: 1,
            totalTokens: 13,
            cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
          },
          stopReason: "error",
          errorMessage: "provider failed",
        });
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      })();
      return stream;
    },
  };
  modelRuntime.registerNativeProvider(createProvider({
    id: CAPTURE_PROVIDER,
    name: CAPTURE_PROVIDER,
    auth: {
      apiKey: {
        name: "Factory capture test key",
        resolve: () => Promise.resolve({ auth: { apiKey: "test-key" } }),
      },
    },
    models: [modelValue],
    api: streams,
  }));
  await modelRuntime.refresh({ allowNetwork: false });
  const registeredModel = modelRuntime.getModel(CAPTURE_PROVIDER, CAPTURE_MODEL_ID);
  if (registeredModel === undefined) throw new Error("Expected factory capture model");
  return { modelRuntime, model: registeredModel, fetch, expectedUsage, getDispatches: () => dispatches };
}

type AccountingOwner = ModelRateLimitOwner & { completeCall: ReturnType<typeof vi.fn<ModelRateLimitOwner["completeCall"]>> };

function accountingOwner(): AccountingOwner {
  const owner = createModelRateLimitOwner({ clock: createFakeModelRateLimitClock() });
  const completeCall = vi.fn(owner.completeCall.bind(owner));
  return Object.assign(owner, { completeCall });
}

function makeFactory(owner: ModelRateLimitOwner | undefined, delegate: StreamFn) {
  const streamFunction = vi.fn<StreamFn>((model, context, options) => delegate(model, context, options));
  const fake = fakeRuntime("limited-session", { agent: { streamFunction } });
  const services = fakeAgentSessionServices();
  const createServices = vi.fn<typeof createAgentSessionServices>(() => Promise.resolve(services));
  // The SDK session class has private state; this host-surface fake is the tested adapter boundary.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const createdSession = fake.session as unknown as Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"];
  const createFromServices = vi.fn<typeof createAgentSessionFromServices>(() => Promise.resolve({
    session: createdSession,
    extensionsResult: services.resourceLoader.getExtensions(),
  }));
  return {
    streamFunction,
    createServices,
    factory: createDefaultRuntimeFactory(
      testModelRuntime,
      sessionGateway([]),
      {
        inspect: vi.fn().mockResolvedValue({ candidates: [], sessionModelOnly: false }),
        configuredCandidates: vi.fn().mockResolvedValue([]),
      },
      { info: vi.fn() },
      undefined,
      undefined,
      undefined,
      owner,
      undefined,
      { createServices, createFromServices },
    ),
  };
}

function makeComposedCaptureFactory(
  fixture: Awaited<ReturnType<typeof captureRuntimeFixture>>,
  owner: ModelRateLimitOwner | undefined,
) {
  const createServices = vi.fn<typeof createAgentSessionServices>((options) => Promise.resolve({
    ...fakeAgentSessionServices(),
    modelRuntime: options.modelRuntime ?? fixture.modelRuntime,
  }));
  const createFromServices = vi.fn<typeof createAgentSessionFromServices>(({ services }) => {
    const fake = fakeRuntime("composed-capture-session", {
      agent: {
        streamFunction: (model, context, options) => services.modelRuntime.streamSimple(model, context, options),
      },
    });
    // The SDK session class has private state; this host-surface fake is the tested adapter boundary.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const session = fake.session as unknown as Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"];
    return Promise.resolve({ session, extensionsResult: services.resourceLoader.getExtensions() });
  });
  return createDefaultRuntimeFactory(
    fixture.modelRuntime,
    sessionGateway([]),
    {
      inspect: vi.fn().mockResolvedValue({ candidates: [], sessionModelOnly: false }),
      configuredCandidates: vi.fn().mockResolvedValue([]),
    },
    { info: vi.fn() },
    undefined,
    undefined,
    undefined,
    owner,
    undefined,
    { createServices, createFromServices },
  );
}

async function createRuntimeSession(factory: ReturnType<typeof createDefaultRuntimeFactory>) {
  return await factory({
    cwd: process.cwd(),
    agentDir: TEST_AGENT_DIR,
    sessionManager: SessionManager.inMemory(process.cwd()),
    delegationToolsEnabled: false,
  });
}

describe("PiSessionService rate limit integration", () => {
  it("captures through the composed factory without a rate-limit owner", async () => {
    const fixture = await captureRuntimeFixture(429);
    const runtime = await createRuntimeSession(makeComposedCaptureFactory(fixture, undefined));

    const result = await (await runtime.session.agent.streamFunction(
      fixture.model,
      normalizeContext({ messages: [] }),
      { fetch: fixture.fetch },
    )).result();

    expect(readModelHttpErrorStatus(result)).toBe(429);
    expect(fixture.getDispatches()).toBe(1);
    expect(fixture.fetch).toHaveBeenCalledOnce();
  });

  it("composes capture with one admitted dispatch and one unchanged usage completion", async () => {
    const fixture = await captureRuntimeFixture(429);
    const owner = accountingOwner();
    const runtime = await createRuntimeSession(makeComposedCaptureFactory(fixture, owner));

    const result = await (await runtime.session.agent.streamFunction(
      fixture.model,
      normalizeContext({ messages: [] }),
      { fetch: fixture.fetch },
    )).result();

    expect(readModelHttpErrorStatus(result)).toBe(429);
    expect(fixture.getDispatches()).toBe(1);
    expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(owner.completeCall).toHaveBeenCalledOnce();
    expect(owner.completeCall.mock.calls[0]?.[1]).toEqual(fixture.expectedUsage);
  });

  it("does not capture, fetch, dispatch, or account blocked and admission-aborted calls", async () => {
    const blockedFixture = await captureRuntimeFixture(429);
    const blockedOwner = accountingOwner();
    blockedOwner.reportLoadFailure("invalid models configuration");
    const blockedRuntime = await createRuntimeSession(makeComposedCaptureFactory(blockedFixture, blockedOwner));
    const blocked = await (await blockedRuntime.session.agent.streamFunction(
      blockedFixture.model,
      normalizeContext({ messages: [] }),
      { fetch: blockedFixture.fetch },
    )).result();

    expect(blocked.stopReason).toBe("error");
    expect(readModelHttpErrorStatus(blocked)).toBeUndefined();
    expect(blockedFixture.getDispatches()).toBe(0);
    expect(blockedFixture.fetch).not.toHaveBeenCalled();
    expect(blockedOwner.completeCall).not.toHaveBeenCalled();

    const abortedFixture = await captureRuntimeFixture(429);
    const abortedOwner = accountingOwner();
    const abortedRuntime = await createRuntimeSession(makeComposedCaptureFactory(abortedFixture, abortedOwner));
    const controller = new AbortController();
    controller.abort();
    const aborted = await (await abortedRuntime.session.agent.streamFunction(
      abortedFixture.model,
      normalizeContext({ messages: [] }),
      { fetch: abortedFixture.fetch, signal: controller.signal },
    )).result();

    expect(aborted.stopReason).toBe("aborted");
    expect(readModelHttpErrorStatus(aborted)).toBeUndefined();
    expect(abortedFixture.getDispatches()).toBe(0);
    expect(abortedFixture.fetch).not.toHaveBeenCalled();
    expect(abortedOwner.completeCall).not.toHaveBeenCalled();
  });

  it("leaves the SDK stream unchanged when no rate limit owner is supplied", async () => {
    const session = makeFactory(undefined, completedStream(0));
    const runtime = await createRuntimeSession(session.factory);

    expect(runtime.session.agent.streamFunction).toBe(session.streamFunction);
    await expect((await runtime.session.agent.streamFunction(catalogModel(), normalizeContext({ messages: [] }), {})).result()).resolves.toMatchObject({ stopReason: "stop" });
    expect(session.streamFunction).toHaveBeenCalledOnce();
  });

  it("shares one model budget across independently created sessions and charges once per call", async () => {
    const clock = createFakeModelRateLimitClock();
    const owner = createModelRateLimitOwner({ clock });
    owner.applySnapshot(fixtureSnapshot({ anthropic: { "demo-model": fixtureLimits(undefined, 1) } }), "accepted-document");
    const sessionA = makeFactory(owner, completedStream(0));
    const sessionB = makeFactory(owner, completedStream(0));
    const model = { ...testModel(), id: "demo-model" };
    const context = normalizeContext({ messages: [] });

    const first = await createRuntimeSession(sessionA.factory);
    const second = await createRuntimeSession(sessionB.factory);

    expect(first.session.agent.streamFunction).not.toBe(sessionA.streamFunction);
    await expect((await first.session.agent.streamFunction(model, context, {})).result()).resolves.toMatchObject({ stopReason: "stop" });
    const queued = (await second.session.agent.streamFunction(model, context, {})).result();
    expect(owner.pendingWaiterCount(identity)).toBe(1);
    clock.advance(60_000);
    await expect(queued).resolves.toMatchObject({ stopReason: "stop" });
    expect(sessionA.streamFunction).toHaveBeenCalledTimes(1);
    expect(sessionB.streamFunction).toHaveBeenCalledTimes(1);
  });

  it("re-wraps each replacement runtime without double wrapping", async () => {
    const clock = createFakeModelRateLimitClock();
    const owner = createModelRateLimitOwner({ clock });
    const sessionA = makeFactory(owner, completedStream(0));
    const sessionB = makeFactory(owner, completedStream(0));

    const first = await createRuntimeSession(sessionA.factory);
    const second = await createRuntimeSession(sessionB.factory);

    expect(first.session.agent.streamFunction).not.toBe(second.session.agent.streamFunction);
    expect(wrapModelStream(owner, first.session.agent.streamFunction)).toBe(first.session.agent.streamFunction);
    await expect((await first.session.agent.streamFunction(catalogModel(), normalizeContext({ messages: [] }), {})).result()).resolves.toMatchObject({ stopReason: "stop" });
    expect(sessionA.streamFunction).toHaveBeenCalledTimes(1);
  });

  it("charges the branch-summary utility candidate model", async () => {
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
    const modelRuntime = await createTestModelRuntime(credentials);
    const clock = createFakeModelRateLimitClock();
    const owner = createModelRateLimitOwner({ clock });
    owner.applySnapshot(fixtureSnapshot({ anthropic: { "utility-lightweight": fixtureLimits(5) } }), "accepted-document");
    const candidate = { ...testModel(), id: "utility-lightweight" };
    const streamFunction = vi.fn<StreamFn>(completedStream(5));
    const fake = fakeRuntime("utility-session", { agent: { streamFunction }, model: testModel() });
    const services = fakeAgentSessionServices();
    const createServices = vi.fn<typeof createAgentSessionServices>(() => Promise.resolve(services));
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const createdSession = fake.session as unknown as Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"];
    const createFromServices = vi.fn<typeof createAgentSessionFromServices>(() => Promise.resolve({
      session: createdSession,
      extensionsResult: services.resourceLoader.getExtensions(),
    }));
    const factory = createDefaultRuntimeFactory(
      modelRuntime,
      sessionGateway([]),
      {
        inspect: vi.fn().mockResolvedValue({
          candidates: [{ model: candidate, thinkingLevel: "high", slot: "lightweight" }],
          sessionModelOnly: false,
        }),
        configuredCandidates: vi.fn().mockResolvedValue([
          { model: candidate, thinkingLevel: "high", slot: "lightweight" },
        ]),
      },
      { info: vi.fn() },
      undefined,
      undefined,
      undefined,
      owner,
      undefined,
      { createServices, createFromServices },
    );

    await createRuntimeSession(factory);

    const extensionFactories = createServices.mock.calls[0]?.[0].resourceLoaderOptions?.extensionFactories;
    if (extensionFactories === undefined) throw new Error("Expected utility extension factory");
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: TEST_AGENT_DIR,
      settingsManager: services.settingsManager,
      extensionFactories,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const beforeTree = loader.getExtensions().extensions[0]?.handlers.get("session_before_tree")?.[0];
    if (beforeTree === undefined) throw new Error("Expected utility tree handler");

    await beforeTree(treeEvent(), { model: testModel() });

    expect(streamFunction.mock.calls[0]?.[0]).toBe(candidate);
    const followUp = owner.acquire(candidateIdentity);
    expect(owner.pendingWaiterCount(candidateIdentity)).toBe(1);
    owner.dispose();
    await expect(followUp).resolves.toEqual({ status: "aborted" });
  });

  it("removes a queued stream waiter when the session call is aborted", async () => {
    const clock = createFakeModelRateLimitClock();
    const owner = createModelRateLimitOwner({ clock });
    owner.applySnapshot(fixtureSnapshot({ anthropic: { "demo-model": fixtureLimits(undefined, 1) } }), "accepted-document");
    const session = makeFactory(owner, completedStream(0));
    const runtime = await createRuntimeSession(session.factory);
    const model = { ...testModel(), id: "demo-model" };
    await owner.acquire(identity);
    const controller = new AbortController();

    const queued = (await runtime.session.agent.streamFunction(model, normalizeContext({ messages: [] }), { signal: controller.signal })).result();
    expect(owner.pendingWaiterCount(identity)).toBe(1);
    controller.abort();

    await expect(queued).resolves.toMatchObject({ stopReason: "aborted", errorMessage: "Request was aborted" });
    expect(owner.pendingWaiterCount(identity)).toBe(0);
    expect(session.streamFunction).not.toHaveBeenCalled();
  });

  it("fails sessions closed with the structured terminal when no snapshot was accepted", async () => {
    const owner = createModelRateLimitOwner({ clock: createFakeModelRateLimitClock() });
    owner.reportLoadFailure("models.json could not be parsed: bad");
    const session = makeFactory(owner, completedStream(0));
    const runtime = await createRuntimeSession(session.factory);

    const message = await (await runtime.session.agent.streamFunction(catalogModel(), normalizeContext({ messages: [] }), {})).result();

    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toBe(`${MODEL_RATE_LIMITS_BLOCKED_MESSAGE} models.json could not be parsed: bad`);
    expect(session.streamFunction).not.toHaveBeenCalled();
  });
});

function treeEvent(): SessionBeforeTreeEvent {
  return {
    type: "session_before_tree",
    preparation: {
      targetId: "target-entry",
      oldLeafId: "branch-entry",
      commonAncestorId: null,
      entriesToSummarize: [{
        type: "custom_message",
        id: "branch-entry",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType: "rate-limit-test",
        content: "Verify utility routing",
        display: false,
      }],
      userWantsSummary: true,
    },
    signal: new AbortController().signal,
  };
}
