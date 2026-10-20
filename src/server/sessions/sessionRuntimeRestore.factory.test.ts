import { describe, expect, it, vi } from "vitest";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  createDefaultRuntimeFactory,
  type SessionRuntimeRestore,
} from "./piSessionService.js";
import { withModelHttpErrorStatusRuntime } from "./modelHttpErrorStream.js";
import {
  createTestModelRuntime,
  fakeAgentSessionServices,
  fakeRuntime,
  sessionGateway,
  testModel,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-webui-runtime-restore-factory-test-agent";

function factoryHarness(
  restore?: SessionRuntimeRestore,
  modelRuntime: ModelRuntime = testModelRuntime,
  order: string[] = [],
  registerDuringCreateServices?: (runtime: ModelRuntime) => void,
) {
  const services = fakeAgentSessionServices();
  const createServices = vi.fn<typeof createAgentSessionServices>(() => {
    order.push("createServices");
    registerDuringCreateServices?.(modelRuntime);
    return Promise.resolve(services);
  });
  const fake = fakeRuntime("factory-session");
  // The SDK session class has private state; this host-surface fake is the tested adapter boundary.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const createdSession = fake.session as unknown as Awaited<
    ReturnType<typeof createAgentSessionFromServices>
  >["session"];
  const createFromServices = vi.fn<typeof createAgentSessionFromServices>(() => {
    order.push("createFromServices");
    return Promise.resolve({
      session: createdSession,
      extensionsResult: services.resourceLoader.getExtensions(),
    });
  });
  const factory = createDefaultRuntimeFactory(
    modelRuntime,
    sessionGateway([]),
    {
      inspect: vi.fn().mockResolvedValue({ candidates: [], sessionModelOnly: false }),
      configuredCandidates: vi.fn().mockResolvedValue([]),
    },
    { info: vi.fn() },
    undefined,
    undefined,
    undefined,
    undefined,
    restore,
    { createServices, createFromServices },
  );
  return { factory, createServices, createFromServices, order };
}

function invokeFactory(
  factory: ReturnType<typeof createDefaultRuntimeFactory>,
  options: Partial<Parameters<ReturnType<typeof createDefaultRuntimeFactory>>[0]> = {},
  sessionManager = SessionManager.inMemory(process.cwd()),
) {
  return factory({
    cwd: process.cwd(),
    agentDir: TEST_AGENT_DIR,
    sessionManager,
    delegationToolsEnabled: false,
    ...options,
  });
}

describe("createDefaultRuntimeFactory restore hook", () => {
  it("passes the plan's model and thinking level to createFromServices", async () => {
    const restoredModel = testModel();
    const prepare = vi.fn<SessionRuntimeRestore["prepare"]>(() =>
      Promise.resolve({
        model: restoredModel,
        thinkingLevel: "high",
      })
    );
    const { factory, createFromServices } = factoryHarness({ prepare });
    const sessionManager = SessionManager.inMemory(process.cwd());

    await invokeFactory(factory, {}, sessionManager);

    const options = createFromServices.mock.calls[0]?.[0];
    expect(options?.model).toBe(restoredModel);
    expect(options?.thinkingLevel).toBe("high");
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith({
      sessionId: sessionManager.getSessionId(),
      sessionManager,
      modelRuntime: testModelRuntime,
    });
  });

  it("passes a decorated runtime to SDK services but the original to restore", async () => {
    const prepare = vi.fn<SessionRuntimeRestore["prepare"]>(() => Promise.resolve({}));
    const { factory, createServices } = factoryHarness({ prepare });

    await invokeFactory(factory);

    const servicesRuntime = createServices.mock.calls[0]?.[0].modelRuntime;
    expect(servicesRuntime).toBe(withModelHttpErrorStatusRuntime(testModelRuntime));
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      modelRuntime: testModelRuntime,
    }));
  });

  it("awaits prepare after createServices and before createFromServices", async () => {
    const order: string[] = [];
    const { factory } = factoryHarness(
      {
        prepare: vi.fn<SessionRuntimeRestore["prepare"]>(() => {
          order.push("prepare");
          return Promise.resolve({});
        }),
      },
      testModelRuntime,
      order,
    );

    await invokeFactory(factory);

    expect(order).toEqual(["createServices", "prepare", "createFromServices"]);
  });

  it("makes an extension model registered during createServices resolvable by the hook", async () => {
    const modelRuntime = await createTestModelRuntime();
    const prepare = vi.fn<SessionRuntimeRestore["prepare"]>((input) => {
      const model = input.modelRuntime.getModel("ext-virtual", "virtual-1");
      return Promise.resolve(model === undefined ? {} : { model });
    });
    const { factory, createFromServices } = factoryHarness(
      { prepare },
      modelRuntime,
      [],
      (runtime) => {
        runtime.registerVirtualModel({
          provider: "ext-virtual",
          id: "virtual-1",
          name: "Virtual One",
          thinkingLevels: ["off"],
          route: () => {
            throw new Error("route is not exercised");
          },
        });
      },
    );

    await invokeFactory(factory);

    const options = createFromServices.mock.calls[0]?.[0];
    expect(options?.model?.provider).toBe("ext-virtual");
    expect(options?.model?.id).toBe("virtual-1");
  });

  it("keeps caller-provided values and still receives them in the hook", async () => {
    const explicitModel = testModel();
    const derivedModel = { ...testModel(), id: "derived-model" };
    const prepare = vi.fn<SessionRuntimeRestore["prepare"]>(() =>
      Promise.resolve({
        model: derivedModel,
        thinkingLevel: "high",
      })
    );
    const { factory, createFromServices } = factoryHarness({ prepare });

    await invokeFactory(factory, {
      initialModel: explicitModel,
      initialThinkingLevel: "low",
    });

    const options = createFromServices.mock.calls[0]?.[0];
    expect(options?.model).toBe(explicitModel);
    expect(options?.thinkingLevel).toBe("low");
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      explicitModel,
      explicitThinkingLevel: "low",
    }));
  });

  it("propagates a rejecting hook and fails the open", async () => {
    const failure = new Error("restore failed");
    const { factory } = factoryHarness({
      prepare: vi.fn<SessionRuntimeRestore["prepare"]>(() => {
        throw failure;
      }),
    });

    await expect(invokeFactory(factory)).rejects.toThrow(failure);
  });

  it("omits model and thinking when no restore dependency is supplied", async () => {
    const { factory, createFromServices } = factoryHarness();

    await invokeFactory(factory);

    const options = createFromServices.mock.calls[0]?.[0] ?? {};
    expect("model" in options).toBe(false);
    expect("thinkingLevel" in options).toBe(false);
  });
});
