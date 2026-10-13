import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  SessionManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExactModelSelection } from "../../shared/apiTypes.js";
import {
  PiSessionService,
  type PiSessionLogger,
  type PiSessionServiceDependencies,
} from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import {
  SESSION_MODEL_POLICY_CUSTOM_TYPE,
  serializeSessionModelPolicy,
} from "./sessionModelPolicy.js";
import {
  CapturingSessionEventHub,
  createTestModelRuntime,
  seedCredential,
} from "./piSessionService.testSupport.js";

const OLD_SELECTION: ExactModelSelection = {
  model: { provider: "anthropic", id: "claude-sonnet-4-5-20250929" },
  thinkingLevel: "medium",
};
const NEW_SELECTION: ExactModelSelection = {
  model: { provider: "anthropic", id: "claude-opus-4-5-20251101" },
  thinkingLevel: "high",
};

interface IntegrationHarness {
  service: PiSessionService;
  gateway: ReturnType<typeof createPiSessionManagerGateway>;
  credentials: InMemoryCredentialStore;
  modelRuntime: ModelRuntime;
  loggerInfo: ReturnType<typeof vi.fn>;
  cwd: string;
  agentDir: string;
  sessionDir: string;
  tempDir: string;
}

const harnesses: IntegrationHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.service.dispose();
    await rm(harness.tempDir, { recursive: true, force: true });
  }
});

async function createIntegrationHarness(): Promise<IntegrationHarness> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-webui-runtime-restore-"));
  const cwd = join(tempDir, "workspace");
  const agentDir = join(tempDir, "agent");
  const sessionDir = join(tempDir, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const credentials = new InMemoryCredentialStore();
  await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
  const modelRuntime = await createTestModelRuntime(credentials);
  const gateway = createPiSessionManagerGateway({
    agentDir,
    env: { PI_WEBUI_AGENT_SESSION_DIR: sessionDir },
    sessionDirEnvKeys: ["PI_WEBUI_AGENT_SESSION_DIR"],
  });
  const loggerInfo = vi.fn();
  const logger: PiSessionLogger = { info: loggerInfo };
  const utilityModelResolver: NonNullable<PiSessionServiceDependencies["utilityModelResolver"]> = {
    inspect: () => Promise.resolve({ candidates: [], sessionModelOnly: false }),
    configuredCandidates: () => Promise.resolve([]),
  };
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir,
    sessionManager: gateway,
    modelRuntime,
    logger,
    utilityModelResolver,
    modelTierRegistry: {
      resolve: () => {
        throw new Error("tier resolution is not exercised");
      },
      validate: () => ({ valid: true }),
    },
    heartbeatIntervalMs: 60_000,
  });
  const harness: IntegrationHarness = {
    service,
    gateway,
    credentials,
    modelRuntime,
    loggerInfo,
    cwd,
    agentDir,
    sessionDir,
    tempDir,
  };
  harnesses.push(harness);
  return harness;
}

async function startPlusSession(
  harness: IntegrationHarness,
  policy: ExactModelSelection = OLD_SELECTION,
): Promise<{ ref: { id: string; cwd: string }; path: string }> {
  const created = await harness.service.start(harness.cwd, {
    creationSource: "session-list-plus",
    initialModelPolicy: { mode: "exact", exact: policy },
  });
  return { ref: { id: created.id, cwd: harness.cwd }, path: created.path };
}

function openSdkManager(harness: IntegrationHarness, path: string): SessionManager {
  const manager = harness.gateway.open(path);
  if (!(manager instanceof SessionManager)) {
    throw new Error("Expected an SDK SessionManager");
  }
  return manager;
}

function appendSelection(
  manager: SessionManager,
  selection: ExactModelSelection,
): void {
  manager.appendModelChange(selection.model.provider, selection.model.id);
  manager.appendThinkingLevelChange(selection.thinkingLevel);
  manager.appendCustomEntry(
    SESSION_MODEL_POLICY_CUSTOM_TYPE,
    serializeSessionModelPolicy({ mode: "exact", exact: selection }),
  );
}

/**
 * Arm the service's typed runtime block exactly as a failed policy transition
 * would. The block map is private service state, so this test writes it directly
 * rather than faking a whole failing transition around the read point under test.
 */
function armRuntimeTupleUnproven(
  service: PiSessionService,
  sessionId: string,
  reason: string,
): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the private block map is the state this test pins.
  const blocks = (service as unknown as {
    modelPolicyRuntimeBlocks: Map<
      string,
      { cause: "selection-unavailable" | "runtime-tuple-unproven"; reason: string }
    >;
  }).modelPolicyRuntimeBlocks;
  blocks.set(sessionId, { cause: "runtime-tuple-unproven", reason });
}

describe("session runtime restore integration", () => {
  it("restores the newest recorded tuple on reopen after a rewind", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    const userEntryId = manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    manager.appendModelChange(OLD_SELECTION.model.provider, OLD_SELECTION.model.id);
    const oldTipId = manager.appendThinkingLevelChange(OLD_SELECTION.thinkingLevel);
    manager.branch(userEntryId);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);
    manager.appendCustomEntry(
      SESSION_MODEL_POLICY_CUSTOM_TYPE,
      serializeSessionModelPolicy({ mode: "exact", exact: NEW_SELECTION }),
    );
    manager.branch(oldTipId);
    manager.appendCustomEntry("pi-webui.note", { on: "old-branch-tip" });

    await harness.service.reload(ref);

    const status = await harness.service.status(ref);
    expect(status.modelPolicy?.resolved).toEqual(NEW_SELECTION);
    expect(status.model).toMatchObject(NEW_SELECTION.model);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();

    const reopened = openSdkManager(harness, path);
    const newestModelChange = reopened
      .getEntries()
      .filter((entry) => entry.type === "model_change")
      .at(-1);
    expect(newestModelChange).toMatchObject({
      provider: NEW_SELECTION.model.provider,
      modelId: NEW_SELECTION.model.id,
    });
  });

  it("opens blocked when the newest recorded model cannot be bound and repairs when credentials return", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const unavailableSelection: ExactModelSelection = {
      model: { provider: "openai", id: "gpt-5.2" },
      thinkingLevel: "high",
    };
    const manager = openSdkManager(harness, path);
    // A real session has a message, so Pi does not append its new-session fallback
    // tuple while the restore block is active.
    manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    appendSelection(manager, unavailableSelection);

    await harness.service.reload(ref);

    let status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(status.modelPolicy?.blockedReason).toContain("gpt-5.2");
    await expect(harness.service.prompt(ref, "must not reach pi"))
      .rejects.toThrow(/MODEL_POLICY_BLOCKED/u);

    await seedCredential(harness.credentials, "openai", { type: "api_key", key: "sk-test-2" });
    await harness.service.reload(ref);

    status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();
    expect(status.modelPolicy?.resolved).toEqual(unavailableSelection);
  });

  it("preserves an unproven block armed during the restore catalog resolution", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const unavailableSelection: ExactModelSelection = {
      model: { provider: "openai", id: "gpt-5.2" },
      thinkingLevel: "high",
    };
    const manager = openSdkManager(harness, path);
    // A real session has a message, so Pi does not append its new-session fallback
    // tuple while the restore block is active.
    manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    appendSelection(manager, unavailableSelection);

    // The first open arms the genuine selection-unavailable block: the recorded
    // selection has no configured auth yet.
    await harness.service.reload(ref);
    expect((await harness.service.status(ref)).modelPolicy?.blockedReason).toContain("gpt-5.2");

    const originalRefresh = harness.modelRuntime.refresh.bind(harness.modelRuntime);
    let refreshCalls = 0;
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refresh = vi.spyOn(harness.modelRuntime, "refresh");
    refresh.mockImplementation(async (...args) => {
      refreshCalls += 1;
      // Let the createServices refresh complete; hold the restore's resolution so
      // the interleaving below is deterministic.
      if (refreshCalls === 2) await refreshGate;
      return originalRefresh(...args);
    });

    const unprovenReason = "the previous model and thinking pair could not be restored";
    const reopened = harness.service.reload(ref);
    await vi.waitFor(() => { expect(refreshCalls).toBe(2); });
    // A failed transition landing during the awaited resolution: the credentials
    // return and the ambiguous tuple is recorded as unproven. The fresh cause and
    // its reason must survive the open's verdict.
    await seedCredential(harness.credentials, "openai", { type: "api_key", key: "sk-test-2" });
    armRuntimeTupleUnproven(harness.service, ref.id, unprovenReason);
    releaseRefresh?.();
    await reopened;

    const status = await harness.service.status(ref);
    // The now-resolvable selection is applied, but the fresh unproven cause must
    // not be discarded as if it were the stale selection-unavailable one.
    expect(status.model).toMatchObject(unavailableSelection.model);
    expect(status.modelPolicy?.blockedReason).toBe(`MODEL_POLICY_BLOCKED: ${unprovenReason}`);
    await expect(harness.service.prompt(ref, "must not reach pi"))
      .rejects.toThrow(/MODEL_POLICY_BLOCKED/u);
    refresh.mockRestore();
  });

  it("keeps a runtime-tuple-unproven block through an apply verdict", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    // An agreeing recorded selection plus persisted Exact policy make the open's
    // restore verdict apply.
    appendSelection(manager, OLD_SELECTION);

    const unprovenReason = "the previous model and thinking pair could not be restored";
    armRuntimeTupleUnproven(harness.service, ref.id, unprovenReason);

    await harness.service.reload(ref);

    const status = await harness.service.status(ref);
    expect(status.model).toMatchObject(OLD_SELECTION.model);
    // An apply verdict clears only selection-unavailable; the unproven cause and
    // its reason are preserved verbatim.
    expect(status.modelPolicy?.blockedReason).toBe(`MODEL_POLICY_BLOCKED: ${unprovenReason}`);
    await expect(harness.service.prompt(ref, "must not reach pi"))
      .rejects.toThrow(/MODEL_POLICY_BLOCKED/u);
  });

  it("keeps the open when the restore catalog refresh rejects and blocks with the availability reason", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const ghostSelection: ExactModelSelection = {
      model: { provider: "ghost", id: "ghost-1" },
      thinkingLevel: "off",
    };
    appendSelection(openSdkManager(harness, path), ghostSelection);

    const refresh = vi.spyOn(harness.modelRuntime, "refresh");
    refresh.mockResolvedValueOnce({ aborted: false, errors: new Map() });
    refresh.mockRejectedValueOnce(new Error("catalog offline"));

    await expect(harness.service.reload(ref)).resolves.toBeUndefined();

    const status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(status.modelPolicy?.blockedReason).toContain("ghost-1");
    expect(harness.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ error: "catalog offline" }),
      "session runtime restore model refresh failed",
    );
    refresh.mockRestore();
  });

  it("blocks a persisted-policy disagreement and repairs it through an explicit policy update", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);

    await harness.service.reload(ref);

    let status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(status.modelPolicy?.blockedReason).toContain(OLD_SELECTION.model.id);
    expect(status.modelPolicy?.blockedReason).toContain(NEW_SELECTION.model.id);
    await expect(harness.service.prompt(ref, "must not reach pi"))
      .rejects.toThrow(/MODEL_POLICY_BLOCKED/u);

    await harness.service.setModelPolicy(ref, { mode: "exact", exact: NEW_SELECTION });

    status = await harness.service.status(ref);
    expect(status.modelPolicy?.blockedReason).toBeUndefined();
    expect(status.modelPolicy?.resolved).toEqual(NEW_SELECTION);
  });

  it("keeps a disagreement block across another open", async () => {
    const harness = await createIntegrationHarness();
    const { ref, path } = await startPlusSession(harness);
    const manager = openSdkManager(harness, path);
    manager.appendModelChange(NEW_SELECTION.model.provider, NEW_SELECTION.model.id);
    manager.appendThinkingLevelChange(NEW_SELECTION.thinkingLevel);

    await harness.service.reload(ref);
    const first = (await harness.service.status(ref)).modelPolicy?.blockedReason;

    await harness.service.reload(ref);
    const second = (await harness.service.status(ref)).modelPolicy?.blockedReason;

    expect(first).toMatch(/^MODEL_POLICY_BLOCKED: /u);
    expect(second).toBe(first);
  });
});
