import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRef, Workspace } from "../../../shared/apiTypes";
import { FEDERATED_HTTP_ROUTES, FEDERATED_WEBSOCKET_ROUTES, SESSION_TREE_NAVIGATION_PROXY_TIMEOUT_MS, type FederatedHttpRouteSpec } from "../../../shared/federatedRoutes";
import { resolveAppUrl } from "../appUrl";
import { activityApi, configApi, filesApi, gitApi, learnedSkillsApi, memoryApi, modelsConfigApi, piPackagePluginsApi, piPackagesApi, piWebUiApi, pluginsApi, projectsApi, sessionsApi, skillsConfigApi, terminalsApi, workspacesApi } from "./clients";
import { FEDERATED_ROUTE_SCENARIOS, GATEWAY_ADDRESSED_METHODS, MACHINE_SCOPED_CLIENT_APIS, type Fixture, type ScenarioTable } from "./federatedRouteScenarios.testSupport";
import { globalSessionEvents, realtimeEvents, sessionEvents, terminalSocket } from "./sockets";
import { workspaceImagePreviewUrl } from "./urls";
import { workspaceTasksApi } from "./workspaceTasksApi";

const machineId = "remote-a";
const workspace: Workspace = {
  id: "w 1",
  projectId: "p 1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: true,
};
const session = { id: "s 1", cwd: workspace.path };
const workspaceTask = { id: "build", title: "Build", command: "npm run build", confirm: false };
const workspaceTasksConfig = {
  version: 1 as const,
  tasks: [workspaceTask],
};
const pinResponseBody = {
  id: "s 1",
  path: "/repo/session.jsonl",
  cwd: "/repo",
  created: "2026-10-22T00:00:00.000Z",
  modified: "2026-10-22T00:00:00.000Z",
  messageCount: 0,
  firstMessage: "",
  pinned: true,
};
const unpinResponseBody = { ...pinResponseBody, pinned: false };
const pinnedSessionResponseBodies: Readonly<Record<string, unknown>> = {
  "sessionsApi.pin": pinResponseBody,
  "sessionsApi.unpin": unpinResponseBody,
};
const workspaceTaskMove = {
  operationId: "00000000-0000-4000-8000-000000000001",
  intent: "start" as const,
  source: {
    ref: { scope: "workspace" as const, id: "build" },
    expectedCatalog: { kind: "loaded" as const, revision: "workspace-revision", config: workspaceTasksConfig },
  },
  destination: {
    scope: "global" as const,
    expectedCatalog: { kind: "loaded" as const, revision: "global-revision", config: { version: 1 as const, tasks: [] } },
    task: workspaceTask,
  },
};

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("federated route contract", () => {
  it("allowlists active-session model policy inspection, mutation, and remember routes", () => {
    expect(FEDERATED_HTTP_ROUTES.filter((route) => route.path.includes("/model-policy"))).toEqual([
      { method: "GET", path: "/sessions/:sessionId/model-policy" },
      { method: "PUT", path: "/sessions/:sessionId/model-policy" },
      { method: "POST", path: "/sessions/:sessionId/model-policy/remember" },
    ]);
  });

  it("allowlists notification HTTP routes without adding a notification WebSocket", () => {
    expect(FEDERATED_HTTP_ROUTES.filter((route) => route.path.includes("notifications"))).toEqual([
      { method: "GET", path: "/sessions/notifications" },
      { method: "GET", path: "/sessions/:sessionId/notifications" },
      { method: "POST", path: "/sessions/:sessionId/notifications/dismiss" },
      { method: "POST", path: "/sessions/:sessionId/notifications/dismiss-all" },
    ]);
    expect(FEDERATED_WEBSOCKET_ROUTES.some((path) => path.includes("notifications"))).toBe(false);
  });

  it("allowlists the recent-project history routes without adding a socket", () => {
    expect(FEDERATED_HTTP_ROUTES.filter((route) => route.path.includes("recent"))).toEqual([
      { method: "GET", path: "/recent-projects" },
      { method: "POST", path: "/projects/:projectId/recent" },
      { method: "DELETE", path: "/recent-projects/:entryId" },
    ]);
    expect(FEDERATED_WEBSOCKET_ROUTES.some((path) => path.includes("recent"))).toBe(false);
  });

  it("allowlists daemon-authoritative unread HTTP routes on the existing global socket", () => {
    expect(FEDERATED_HTTP_ROUTES.filter((route) => route.path.includes("unread"))).toEqual([
      { method: "GET", path: "/sessions/unread" },
      { method: "POST", path: "/sessions/:sessionId/unread/acknowledge" },
    ]);
    expect(FEDERATED_WEBSOCKET_ROUTES.some((path) => path.includes("unread"))).toBe(false);
  });

  it("allowlists full and dynamic system information routes", () => {
    expect(FEDERATED_HTTP_ROUTES.filter((route) => route.path.startsWith("/pi-webui/system-"))).toEqual([
      { method: "GET", path: "/pi-webui/system-info" },
      { method: "GET", path: "/pi-webui/system-metrics" },
    ]);
  });

  it("allowlists session tree navigation with a long model-operation timeout and no new WebSocket", () => {
    expect(FEDERATED_HTTP_ROUTES.find((route) => route.path === "/sessions/:sessionId/tree/navigate")).toEqual({
      method: "POST",
      path: "/sessions/:sessionId/tree/navigate",
      timeoutMs: SESSION_TREE_NAVIGATION_PROXY_TIMEOUT_MS,
    });
    expect(SESSION_TREE_NAVIGATION_PROXY_TIMEOUT_MS).toBe(5 * 60_000);
    expect(FEDERATED_WEBSOCKET_ROUTES.some((path) => path.includes("tree"))).toBe(false);
  });

  it("allowlists per-message edit and fork actions with tree-operation timeouts", () => {
    expect(FEDERATED_HTTP_ROUTES.filter((route) => route.path.includes("/messages/"))).toEqual([
      { method: "POST", path: "/sessions/:sessionId/messages/edit-from-here", timeoutMs: SESSION_TREE_NAVIGATION_PROXY_TIMEOUT_MS },
      { method: "POST", path: "/sessions/:sessionId/messages/fork", timeoutMs: SESSION_TREE_NAVIGATION_PROXY_TIMEOUT_MS },
    ]);
  });

  it("allowlists read-only full-history exports for remote machines", () => {
    expect(FEDERATED_HTTP_ROUTES.find((route) => route.path === "/sessions/:sessionId/export")).toEqual({
      method: "GET",
      path: "/sessions/:sessionId/export",
    });
  });

  it("allowlists read-only memory snapshots for remote machines", () => {
    expect(FEDERATED_HTTP_ROUTES).toContainEqual({ method: "GET", path: "/agent-memory/snapshot" });
  });

  it("allowlists read-only learned-skill snapshots for remote machines", () => {
    expect(FEDERATED_HTTP_ROUTES).toContainEqual({ method: "GET", path: "/agent-skills/snapshot" });
  });

  it("runs a declared scenario through a frozen namespace and checks the observed request", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    let invocations = 0;
    const testApi = {
      pin: (session: SessionRef, machineId = "local") => {
        invocations += 1;
        return sessionsApi.pin(session, machineId);
      },
    };
    const testScenarios = {
      pin: [{
        kind: "machine",
        route: { method: "POST", path: "/sessions/:sessionId/pin" },
        args: (m: string) => [session, m],
      }],
    } as const satisfies ScenarioTable<typeof testApi>;

    await runFederatedRouteScenarios({
      apis: { sessionsApi: testApi },
      scenarios: { sessionsApi: testScenarios },
      gatewayAddresses: {},
      machineId,
    });

    expect(invocations).toBe(1);
    expect(Object.isFrozen(testApi)).toBe(true);

    const mismatchedScenarios = {
      pin: [{
        kind: "machine",
        route: { method: "POST", path: "/sessions/:sessionId/archive" },
        args: (m: string) => [session, m],
      }],
    } as const satisfies ScenarioTable<typeof testApi>;

    await expect(runFederatedRouteScenarios({
      apis: { sessionsApi: testApi },
      scenarios: { sessionsApi: mismatchedScenarios },
      gatewayAddresses: {},
      machineId,
    })).rejects.toThrow('[federation sessionsApi.pin#1] strict path mismatch: observed=POST /sessions/s%201/pin; declared=POST /sessions/:sessionId/archive; matchingPatterns=["POST /sessions/:sessionId/pin"]');
  });

  it("rejects a declaration that loses specificity to a literal allowlisted route", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    const testApi = {
      archiveMany: (sessions: readonly SessionRef[], machineId = "local") => sessionsApi.archiveMany(sessions, machineId),
    };
    const testScenarios = {
      archiveMany: [{
        kind: "machine",
        route: { method: "POST", path: "/sessions/:sessionId/archive" },
        args: (m: string) => [[session], m],
      }],
    } as const satisfies ScenarioTable<typeof testApi>;

    await expect(runFederatedRouteScenarios({
      apis: { sessionsApi: testApi },
      scenarios: { sessionsApi: testScenarios },
      gatewayAddresses: {},
      machineId,
    })).rejects.toThrow('[federation sessionsApi.archiveMany#1] declared route is not most-specific: observed=POST /sessions/bulk/archive; declared=POST /sessions/:sessionId/archive; mostSpecific=POST /sessions/bulk/archive; matchingPatterns=["POST /sessions/bulk/archive","POST /sessions/:sessionId/archive"]');
  });

  it("rejects an empty fixture list before invoking its method", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    let invocations = 0;
    const testApi = {
      pin: (session: SessionRef, machineId = "local") => {
        invocations += 1;
        return sessionsApi.pin(session, machineId);
      },
    };
    const testScenarios = {
      pin: [{
        kind: "machine",
        route: { method: "POST", path: "/sessions/:sessionId/pin" },
        args: (m: string) => [session, m],
      }],
    } as const satisfies ScenarioTable<typeof testApi>;
    Reflect.set(testScenarios, "pin", []);

    await expect(runFederatedRouteScenarios({
      apis: { sessionsApi: testApi },
      scenarios: { sessionsApi: testScenarios },
      gatewayAddresses: {},
      machineId,
    })).rejects.toThrow("[federation sessionsApi.pin] empty fixture list: expected>=1 observed=0");
    expect(invocations).toBe(0);
  });

  it("runs the staged PI WEBUI client API scenarios through the sequential runner", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });

    expect(MACHINE_SCOPED_CLIENT_APIS.piWebUiApi).toBe(piWebUiApi);

    await runFederatedRouteScenarios({
      apis: MACHINE_SCOPED_CLIENT_APIS,
      scenarios: FEDERATED_ROUTE_SCENARIOS,
      gatewayAddresses: GATEWAY_ADDRESSED_METHODS,
      machineId,
    });
  });

  it("resolves staged PI WEBUI client calls within the application root of a nested deployment", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      ignoreParseFailure(piWebUiApi.piWebUiRuntime()),
      ignoreParseFailure(piWebUiApi.piWebUiStatus(machineId)),
      ignoreParseFailure(piWebUiApi.checkForUpdates(machineId)),
      ignoreParseFailure(piWebUiApi.systemInfo(machineId)),
      ignoreParseFailure(piWebUiApi.systemMetrics(machineId)),
    ]);

    expect(fetchMock.mock.calls.map(([url]) => toUrl(url).toString())).toEqual([
      "https://pi.example.test/nested/pi-webui/api/pi-webui/runtime",
      "https://pi.example.test/nested/pi-webui/api/machines/remote-a/pi-webui/status",
      "https://pi.example.test/nested/pi-webui/api/machines/remote-a/pi-webui/status?refresh=1",
      "https://pi.example.test/nested/pi-webui/api/machines/remote-a/pi-webui/system-info",
      "https://pi.example.test/nested/pi-webui/api/machines/remote-a/pi-webui/system-metrics",
    ]);
  });

  it("matches route patterns by strict segments without collapsing or decoding", () => {
    const pattern = "/sessions/:sessionId/pin";
    expect(strictPathMatches("/sessions/s%201/pin", pattern)).toBe(true);
    expect(strictPathMatches("/sessions/s%2F1/pin", pattern)).toBe(true);
    expect(strictPathMatches("//sessions/s%201/pin", pattern)).toBe(false);
    expect(strictPathMatches("/sessions//s%201/pin", pattern)).toBe(false);
    expect(strictPathMatches("/sessions/s%201/pin/", pattern)).toBe(false);
    expect(strictPathMatches("/sessions//pin", pattern)).toBe(false);
  });

  it("covers machine-scoped client HTTP calls with remote proxy routes", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-webui/" });
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      ignoreParseFailure(memoryApi.snapshot(workspace.path, machineId)),
      ignoreParseFailure(learnedSkillsApi.snapshot(workspace.path, machineId)),
      ignoreParseFailure(configApi.config(machineId)),
      ignoreParseFailure(configApi.saveConfig({ spawnSessions: true }, machineId)),
      ignoreParseFailure(modelsConfigApi.discover({ providerName: "custom", provider: { api: "openai-completions", baseUrl: "https://models.example.test/v1", apiKey: "$MODEL_API_KEY" } }, machineId)),
      ignoreParseFailure(pluginsApi.plugins(machineId)),
      ignoreParseFailure(skillsConfigApi.list("/repo", machineId)),
      ignoreParseFailure(skillsConfigApi.toggle({ cwd: "/repo", filePath: "/repo/.pi/skills/testing/SKILL.md", disableModelInvocation: true }, machineId)),
      ignoreParseFailure(skillsConfigApi.search({ query: "testing", limit: 12 }, machineId)),
      ignoreParseFailure(skillsConfigApi.install({ cwd: "/repo", package: "owner/repo@testing", scope: "project" }, machineId)),
      ignoreParseFailure(skillsConfigApi.check({ cwd: "/repo", package: "owner/repo@testing", scope: "project" }, machineId)),
      ignoreParseFailure(skillsConfigApi.update({ cwd: "/repo", package: "owner/repo@testing", scope: "project" }, machineId)),
      ignoreParseFailure(piPackagesApi.packages(machineId)),
      ignoreParseFailure(piPackagePluginsApi.list("/repo", machineId)),
      ignoreParseFailure(piPackagePluginsApi.mutate({ action: "install", source: "npm:@acme/tools", scope: "project", cwd: "/repo" }, machineId)),
      ignoreParseFailure(piPackagesApi.install("npm:@acme/tools", machineId)),
      ignoreParseFailure(piPackagesApi.remove("npm:@acme/tools", "user", machineId)),
      ignoreParseFailure(piPackagesApi.update("npm:@acme/tools", machineId)),
      ignoreParseFailure(activityApi.workspaceActivity(machineId)),
      ignoreParseFailure(projectsApi.projects(machineId)),
      ignoreParseFailure(projectsApi.addProject("/repo", "Repo", false, machineId)),
      ignoreParseFailure(projectsApi.closeProject("p 1", machineId)),
      ignoreParseFailure(projectsApi.pinProject("p 1", machineId)),
      ignoreParseFailure(projectsApi.unpinProject("p 1", machineId)),
      ignoreParseFailure(projectsApi.projectDirectories("/r", machineId)),
      ignoreParseFailure(workspacesApi.workspaces("p 1", machineId)),
      ignoreParseFailure(workspacesApi.deleteWorkspace("p 1", "w 1", machineId)),
      ignoreParseFailure(workspacesApi.workspaceTree("p 1", "w 1", "src", machineId)),
      ignoreParseFailure(workspacesApi.workspaceFile("p 1", "w 1", "README.md", machineId)),
      ignoreParseFailure(workspacesApi.writeWorkspaceFile("p 1", "w 1", "README.md", "hello", { overwrite: false }, machineId)),
      ignoreParseFailure(workspacesApi.deleteWorkspaceFile("p 1", "w 1", "README.md", machineId)),
      ignoreParseFailure(workspacesApi.moveWorkspaceFile("p 1", "w 1", "README.md", "docs/README.md", { overwrite: false }, machineId)),
      ignoreParseFailure(workspaceTasksApi.readWorkspace({ projectId: "p 1", workspaceId: "w 1", machineId })),
      ignoreParseFailure(workspaceTasksApi.replaceWorkspace({ projectId: "p 1", workspaceId: "w 1", machineId, expectedRevision: "workspace-revision", config: workspaceTasksConfig })),
      ignoreParseFailure(workspaceTasksApi.move({ projectId: "p 1", workspaceId: "w 1", machineId, ...workspaceTaskMove })),
      ignoreParseFailure(workspaceTasksApi.readGlobal(machineId)),
      ignoreParseFailure(workspaceTasksApi.replaceGlobal({ machineId, expectedRevision: "global-revision", config: workspaceTasksConfig })),
      ignoreParseFailure(filesApi.files("/repo", "README", { kind: "tracked", mode: "file", machineId })),
      ignoreParseFailure(filesApi.files("/repo", "README", { kind: "tracked", mode: "file", projectId: "p 1", workspaceId: "w 1", machineId, workspaceScoped: true })),
      ignoreParseFailure(gitApi.gitStatus("p 1", "w 1", machineId)),
      ignoreParseFailure(gitApi.gitDiff("p 1", "w 1", { path: "README.md", staged: true }, machineId)),
      ignoreParseFailure(sessionsApi.sessions("/repo", machineId)),
      ignoreParseFailure(sessionsApi.sessionDefaults("/repo", machineId)),
      ignoreParseFailure(sessionsApi.updateSessionDefaults("/repo", { model: { provider: "openai", modelId: "gpt" } }, machineId)),
      ignoreParseFailure(sessionsApi.unreadCatalog(machineId)),
      ignoreParseFailure(sessionsApi.acknowledgeUnread(session, "catalog-a", 7, machineId)),
      ignoreParseFailure(sessionsApi.startSession("/repo", machineId)),
      ignoreParseFailure(sessionsApi.reorder(session, {
        cwd: workspace.path,
        scope: { kind: "root" as const, cwd: workspace.path },
        pinned: false,
        catalogCwds: [workspace.path],
        orderedSessions: [session],
      }, machineId)),
      ignoreParseFailure(sessionsApi.cleanupPreview({ archiveIdleDays: 14 }, machineId)),
      ignoreParseFailure(sessionsApi.cleanup({ archiveIdleDays: 14, deleteArchivedDays: 30, projectCwds: ["/repo"] }, machineId)),
      ignoreParseFailure(sessionsApi.archiveMany([session], machineId)),
      ignoreParseFailure(sessionsApi.deleteArchivedMany([session], machineId)),
      ignoreParseFailure(sessionsApi.messages(session, { limit: 20, before: 10 }, machineId)),
      ignoreParseFailure(sessionsApi.status(session, machineId)),
      ignoreParseFailure(sessionsApi.rememberCurrentModelPolicy(session, machineId)),
      ignoreParseFailure(sessionsApi.systemPrompt(session, machineId)),
      ignoreParseFailure(sessionsApi.extensionEntries(session, machineId)),
      ignoreParseFailure(sessionsApi.streamSnapshot(session, machineId)),
      ignoreParseFailure(sessionsApi.clearQueue(session, machineId)),
      ignoreParseFailure(sessionsApi.models(session, machineId)),
      ignoreParseFailure(sessionsApi.setModel(session, "openai", "gpt", machineId)),
      ignoreParseFailure(sessionsApi.cycleModel(session, "forward", machineId)),
      ignoreParseFailure(sessionsApi.thinkingLevels(session, machineId)),
      ignoreParseFailure(sessionsApi.setThinkingLevel(session, "medium", machineId)),
      ignoreParseFailure(sessionsApi.cycleThinkingLevel(session, machineId)),
      ignoreParseFailure(sessionsApi.commands(session, machineId)),
      ignoreParseFailure(sessionsApi.prompt(session, "hello", "followUp", machineId)),
      ignoreParseFailure(sessionsApi.saveAttachments(session, [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }], machineId, "uploads")),
      ignoreParseFailure(sessionsApi.shell(session, "ls", machineId)),
      ignoreParseFailure(sessionsApi.runCommand(session, "/help", machineId)),
      ignoreParseFailure(sessionsApi.respondToCommand(session, "req 1", "yes", machineId)),
      ignoreParseFailure(sessionsApi.navigateTree(session, { targetId: "entry-1", expectedLeafId: "leaf-1", summary: { mode: "none" } }, machineId)),
      ignoreParseFailure(sessionsApi.editFromHere(session, "assistant-1", machineId)),
      ignoreParseFailure(sessionsApi.forkFromHere(session, "user-2", machineId)),
      ignoreParseFailure(sessionsApi.abort(session, machineId)),
      ignoreParseFailure(sessionsApi.stop(session, machineId)),
      ignoreParseFailure(sessionsApi.archive(session, machineId)),
      ignoreParseFailure(sessionsApi.archiveWithDescendants(session, machineId)),
      ignoreParseFailure(sessionsApi.restore(session, machineId)),
      ignoreParseFailure(sessionsApi.deleteArchived(session, machineId)),
      ignoreParseFailure(sessionsApi.reloadSession(session, machineId)),
      ignoreParseFailure(sessionsApi.detachParent(session, machineId)),
      ignoreParseFailure(sessionsApi.authProviders({ mode: "login", authType: "oauth", machineId })),
      ignoreParseFailure(sessionsApi.saveApiKey("openai", "key", machineId)),
      ignoreParseFailure(sessionsApi.startInteractiveApiKeyLogin("amazon-bedrock", machineId)),
      ignoreParseFailure(sessionsApi.logoutProvider("openai", machineId)),
      ignoreParseFailure(sessionsApi.startOAuthLogin("openai", machineId)),
      ignoreParseFailure(sessionsApi.oauthFlow("flow 1", machineId)),
      ignoreParseFailure(sessionsApi.respondOAuthFlow("flow 1", "req 1", "code", machineId)),
      ignoreParseFailure(sessionsApi.cancelOAuthFlow("flow 1", machineId)),
      ignoreParseFailure(terminalsApi.terminals("p 1", "w 1", machineId)),
      ignoreParseFailure(terminalsApi.startTerminal("p 1", "w 1", { cols: 120, rows: 40 }, machineId)),
      ignoreParseFailure(terminalsApi.closeWorkspaceTerminals("p 1", "w 1", machineId)),
      ignoreParseFailure(terminalsApi.closeTerminal("p 1", "w 1", "t 1", machineId)),
      ignoreParseFailure(terminalsApi.continueTerminal("p 1", "w 1", "t 1", machineId)),
      ignoreParseFailure(terminalsApi.runTerminalCommand("core", { workspace, title: "Build", command: "npm test" }, machineId)),
      ignoreParseFailure(terminalsApi.listCommandRuns({ projectId: "p 1", workspaceId: "w 1", statuses: ["running"], metadata: { "pi.operation": "test" } }, machineId)),
      ignoreParseFailure(terminalsApi.getCommandRun("run 1", machineId)),
      ignoreParseFailure(terminalsApi.cancelCommandRun("run 1", machineId)),
    ]);

    expect(fetchMock.mock.calls.map(([url]) => toUrl(url).pathname)).toContain(
      `/nested/pi-webui/api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(session.id)}/reorder`,
    );

    const observedRoutes = uniqueHttpRoutes([
      ...fetchMock.mock.calls.map((call) => fetchCallToRoute(call, machineId)),
      routeFromMachineUrl("GET", workspaceImagePreviewUrl("p 1", "w 1", "diagram.svg", { machineId, modifiedAt: "2026-05-25T00:00:00.000Z" }), machineId),
    ]);
    const unmatched = observedRoutes.filter((route) => !matchesHttpRoute(route, FEDERATED_HTTP_ROUTES));

    expect(observedRoutes).toContainEqual({
      method: "POST",
      path: `/sessions/${encodeURIComponent(session.id)}/reorder`,
    });
    const workspaceTaskRoutes = observedRoutes.filter((route) => route.path.includes("workspace-tasks"));
    expect(workspaceTaskRoutes).toEqual([
      { method: "GET", path: "/projects/p%201/workspaces/w%201/workspace-tasks" },
      { method: "PUT", path: "/projects/p%201/workspaces/w%201/workspace-tasks" },
      { method: "POST", path: "/projects/p%201/workspaces/w%201/workspace-tasks/move" },
      { method: "GET", path: "/workspace-tasks/global" },
      { method: "PUT", path: "/workspace-tasks/global" },
    ]);
    for (const route of workspaceTaskRoutes) {
      expect(FEDERATED_HTTP_ROUTES.filter((spec) => spec.method === route.method && pathMatchesPattern(route.path, spec.path))).toHaveLength(1);
    }
    expect(unmatched).toEqual([]);
  });

  it("covers machine-scoped client WebSocket calls with remote proxy routes", () => {
    const webSocketUrls: string[] = [];
    function FakeWebSocket(url: string): void {
      webSocketUrls.push(url);
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    sessionEvents(session, machineId);
    globalSessionEvents(machineId);
    realtimeEvents(machineId);
    terminalSocket("p 1", "w 1", "t 1", { cols: 120, rows: 40 }, machineId);

    const observedPaths = uniqueStrings(webSocketUrls.map((url) => routeFromMachineUrl("GET", url, machineId).path));
    const unmatched = observedPaths.filter((path) => !FEDERATED_WEBSOCKET_ROUTES.some((route) => pathMatchesPattern(path, route)));

    expect(unmatched).toEqual([]);
  });
});

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

type AnyFixture = Fixture<(...args: unknown[]) => unknown>;
type AnyMachineFixture = Extract<AnyFixture, { readonly kind: "machine" }>;
type AnyGatewayFixture = Extract<AnyFixture, { readonly kind: "gateway" }>;
type AnyScenarioTable = Readonly<Record<string, readonly AnyFixture[]>>;

interface FederatedRouteScenarioRun {
  readonly apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly scenarios: Readonly<Record<string, AnyScenarioTable>>;
  readonly gatewayAddresses: Readonly<Record<string, readonly string[]>>;
  readonly machineId: string;
}

interface CapturedFailure {
  readonly name: string;
  readonly message: string;
}

interface ObservedHttpRoute {
  method: string;
  path: string;
}

async function runFederatedRouteScenarios(run: FederatedRouteScenarioRun): Promise<void> {
  let activeFixtureIdentity = "";
  const fetchMock = vi.fn<FetchLike>(() =>
    Promise.resolve(jsonResponse(pinnedSessionResponseBodies[activeFixtureIdentity] ?? {})),
  );
  vi.stubGlobal("fetch", fetchMock);

  const apiEntries = Object.entries(run.apis);
  for (const [, api] of apiEntries) {
    Object.freeze(api);
  }
  assertNamespacesFrozenBeforeBuilders(apiEntries, run.scenarios);

  for (const [moduleKey, table] of Object.entries(run.scenarios)) {
    const api = run.apis[moduleKey];
    if (api === undefined) throw new Error(`[federation ${moduleKey}] missing staged API namespace`);
    const gatewayMethods = run.gatewayAddresses[moduleKey];
    for (const [methodKey, fixtures] of tableRows(table)) {
      if (fixtures.length === 0) {
        expect.fail(`[federation ${moduleKey}.${methodKey}] empty fixture list: expected>=1 observed=0`);
      }
      const member = methodAt(api, methodKey);
      for (const [index, fixture] of fixtures.entries()) {
        const label = `[federation ${moduleKey}.${methodKey}#${String(index + 1)}]`;
        const expectedKind = gatewayMethods?.includes(methodKey) === true ? "gateway" : "machine";
        const declared = declaredRouteLabel(fixture);
        expect(
          fixture.kind,
          `${label} gateway identity mismatch: expected=${expectedKind} observed=${fixture.kind}; declared=${declared}`,
        ).toBe(expectedKind);
        if (typeof member !== "function") {
          expect.fail(`${label} assigned method is not callable: expected=function observed=${typeof member}; declared=${declared}`);
        }

        // Phase 0: build the argument tuple without allowing any transport.
        const phase0Baseline = fetchMock.mock.calls.length;
        let builderFailure: CapturedFailure | undefined;
        let invocationArguments: unknown[] = [];
        try {
          invocationArguments = fixture.args(run.machineId);
        } catch (error) {
          builderFailure = captureFailure(error);
        }
        const phase0Count = fetchMock.mock.calls.length - phase0Baseline;
        if (phase0Count !== 0) {
          expect.fail(`${label} requests while building arguments: expected=0 observed=${String(phase0Count)}; declared=${declared}`);
        }
        if (builderFailure !== undefined) {
          expect.fail(`${label} argument builder threw (namespace frozen=${String(Object.isFrozen(api))}): ${builderFailure.name}: ${builderFailure.message}; declared=${declared}`);
        }

        // Phase 1: invoke the assigned member once with the built tuple and observe transport.
        activeFixtureIdentity = `${moduleKey}.${methodKey}`;
        const phase1Baseline = fetchMock.mock.calls.length;
        let outcome = "resolved";
        let invocationValue: unknown;
        try {
          const result: unknown = Reflect.apply(member, api, invocationArguments);
          invocationValue = await result;
        } catch (error) {
          const failure = captureFailure(error);
          outcome = `rejected(${failure.name}: ${failure.message})`;
        }
        const phase1Calls = fetchMock.mock.calls.slice(phase1Baseline);
        const observedCalls = phase1Calls.map(formatObservedCall);
        const soleCall = phase1Calls[0];
        if (phase1Calls.length !== 1 || soleCall === undefined) {
          expect.fail(`${label} fetch count mismatch: expected=1 observed=${String(phase1Calls.length)}; declared=${declared}; observedCalls=${JSON.stringify(observedCalls)}; outcome=${outcome}`);
        }

        if (fixture.kind === "gateway") {
          assertGatewayRequest(label, fixture, soleCall);
        } else {
          assertMachineRequest(label, fixture, soleCall, run.machineId);
        }
        const pinnedResponse = pinnedSessionResponseBodies[`${moduleKey}.${methodKey}`];
        if (pinnedResponse !== undefined) {
          expect(invocationValue, `${label} pinned session response mismatch: declared=${declared}`).toEqual(pinnedResponse);
        }
      }
    }
  }
}

function assertNamespacesFrozenBeforeBuilders(
  apiEntries: readonly (readonly [string, Readonly<Record<string, unknown>>])[],
  scenarios: Readonly<Record<string, AnyScenarioTable>>,
): void {
  for (const [moduleKey, api] of apiEntries) {
    const [firstRow] = tableRows(scenarios[moduleKey] ?? {});
    if (firstRow === undefined) continue;
    const [methodKey, fixtures] = firstRow;
    const [firstFixture] = fixtures;
    if (firstFixture === undefined) continue;
    const declared = declaredRouteLabel(firstFixture);
    expect(
      Object.isFrozen(api),
      `[federation ${moduleKey}.${methodKey}#1] namespace freeze failed: expected=true observed=${String(Object.isFrozen(api))}; declared=${declared}`,
    ).toBe(true);
  }
}

// Mapped-type iteration loses the correlation between each method key and that key's own fixture list;
// this is the runtime recovery point for the key/fixture pairing, in table declaration order.
function tableRows(table: AnyScenarioTable): readonly (readonly [string, readonly AnyFixture[]])[] {
  return Object.entries(table);
}

// The same iteration cannot carry the assigned method's own signature; the captured member stays untyped
// and the invocation site rebuilds the argument list from the key's fixture tuple.
function methodAt(api: Readonly<Record<string, unknown>>, key: string): unknown {
  return api[key];
}

function declaredRouteLabel(fixture: AnyFixture): string {
  return fixture.kind === "gateway"
    ? `GET ${resolveAppUrl(fixture.endpoint)}`
    : `${fixture.route.method} ${fixture.route.path}`;
}

function captureFailure(value: unknown): CapturedFailure {
  return value instanceof Error
    ? { name: value.name, message: value.message }
    : { name: "NonError", message: String(value) };
}

function observedHttpMethod(input: string | URL | Request, init?: RequestInit): string {
  if (init?.method !== undefined) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function formatObservedCall(call: Parameters<FetchLike>): string {
  return `${observedHttpMethod(call[0], call[1])} ${toUrl(call[0]).toString()}`;
}

function assertMachineRequest(label: string, fixture: AnyMachineFixture, call: Parameters<FetchLike>, machineId: string): void {
  const [input, init] = call;
  const observedMethod = observedHttpMethod(input, init);
  const observedUrl = toUrl(input);
  const declared = `${fixture.route.method} ${fixture.route.path}`;
  const expectedPrefix = resolveAppUrl(`api/machines/${encodeURIComponent(machineId)}`);
  const expectedBase = new URL(expectedPrefix);
  if (observedUrl.origin !== expectedBase.origin || !observedUrl.pathname.startsWith(`${expectedBase.pathname}/`)) {
    expect.fail(`${label} machine URL mismatch: expectedPrefix=${expectedPrefix}/ observed=${observedUrl.toString()}; declared=${declared}`);
  }
  const observedPath = observedUrl.pathname.slice(expectedBase.pathname.length);
  const observedRequest = `${observedMethod} ${observedPath}`;
  expect(
    observedMethod,
    `${label} HTTP method mismatch: expected=${fixture.route.method} observed=${observedMethod}; declared=${declared}; observedRequest=${observedRequest}`,
  ).toBe(fixture.route.method);
  assertMostSpecificRoute(label, fixture.route, observedMethod, observedPath, observedRequest);
}

function assertMostSpecificRoute(
  label: string,
  declaredRoute: AnyMachineFixture["route"],
  observedMethod: string,
  observedPath: string,
  observedRequest: string,
): void {
  const declared = `${declaredRoute.method} ${declaredRoute.path}`;
  const candidates = FEDERATED_HTTP_ROUTES.filter((spec) => spec.method === observedMethod && strictPathMatches(observedPath, spec.path));
  const matchingPatterns = JSON.stringify(candidates.map(formatRouteSpec));
  // Path name the declaration promised must match before specificity is meaningful; an unrelated but
  // allowlisted endpoint is a strict path mismatch, not a declaration that lost to a more specific one.
  if (candidates.length === 0 || !strictPathMatches(observedPath, declaredRoute.path)) {
    expect.fail(`${label} strict path mismatch: observed=${observedRequest}; declared=${declared}; matchingPatterns=${matchingPatterns}`);
  }
  const fewestParameters = Math.min(...candidates.map(countRouteParameters));
  const mostSpecific = candidates.filter((spec) => countRouteParameters(spec) === fewestParameters);
  if (mostSpecific.length > 1) {
    expect.fail(`${label} ambiguous most-specific route: observed=${observedRequest}; declared=${declared}; tiedPatterns=${JSON.stringify(mostSpecific.map(formatRouteSpec))}; matchingPatterns=${matchingPatterns}`);
  }
  const [winner] = mostSpecific;
  if (winner === undefined) {
    expect.fail(`${label} strict path mismatch: observed=${observedRequest}; declared=${declared}; matchingPatterns=${matchingPatterns}`);
  }
  if (winner.method !== declaredRoute.method || winner.path !== declaredRoute.path) {
    expect.fail(`${label} declared route is not most-specific: observed=${observedRequest}; declared=${declared}; mostSpecific=${formatRouteSpec(winner)}; matchingPatterns=${matchingPatterns}`);
  }
}

function assertGatewayRequest(label: string, fixture: AnyGatewayFixture, call: Parameters<FetchLike>): void {
  const [input, init] = call;
  const observedMethod = observedHttpMethod(input, init);
  const observedUrl = toUrl(input);
  const resolvedEndpoint = resolveAppUrl(fixture.endpoint);
  const declared = `GET ${resolvedEndpoint}`;
  const observedRequest = `${observedMethod} ${observedUrl.toString()}`;
  expect(
    observedMethod,
    `${label} HTTP method mismatch: expected=GET observed=${observedMethod}; declared=${declared}; observedRequest=${observedRequest}`,
  ).toBe("GET");
  expect(
    hasMachineAddressSegment(observedUrl.pathname),
    `${label} gateway request is machine-addressed: observed=${observedRequest}; declared=${declared}`,
  ).toBe(false);
  expect(
    observedUrl.toString(),
    `${label} gateway URL mismatch: expected=${resolvedEndpoint} observed=${observedUrl.toString()}; declared=${declared}`,
  ).toBe(resolvedEndpoint);
}

function hasMachineAddressSegment(pathname: string): boolean {
  const segments = pathname.split("/");
  return segments.some((segment, index) => segment === "api" && segments[index + 1] === "machines");
}

function formatRouteSpec(spec: FederatedHttpRouteSpec): string {
  return `${spec.method} ${spec.path}`;
}

function countRouteParameters(spec: FederatedHttpRouteSpec): number {
  return spec.path.split("/").filter((segment) => segment.startsWith(":")).length;
}

function strictPathMatches(observedPath: string, pattern: string): boolean {
  const observedSegments = observedPath.split("/");
  const patternSegments = pattern.split("/");
  if (observedSegments.length !== patternSegments.length) return false;
  return patternSegments.every((segment, index) => {
    const observedSegment = observedSegments[index];
    if (observedSegment === undefined) return false;
    if (segment.startsWith(":")) return observedSegment !== "";
    return segment === observedSegment;
  });
}

async function ignoreParseFailure(promise: Promise<unknown>): Promise<void> {
  await promise.catch(() => undefined);
}

function fetchCallToRoute(call: Parameters<FetchLike>, scopedMachineId: string): ObservedHttpRoute {
  const [url, init] = call;
  return routeFromMachineUrl((init?.method ?? "GET").toUpperCase(), url, scopedMachineId);
}

function routeFromMachineUrl(method: string, input: string | URL | Request, scopedMachineId: string): ObservedHttpRoute {
  const url = toUrl(input);
  const prefix = `/api/machines/${encodeURIComponent(scopedMachineId)}`;
  const prefixIndex = url.pathname.lastIndexOf(prefix);
  if (prefixIndex === -1) throw new Error(`Expected machine-scoped URL, got ${url.pathname}`);
  return { method, path: url.pathname.slice(prefixIndex + prefix.length) || "/" };
}

function toUrl(input: string | URL | Request): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input, "https://pi.example.test");
}

function matchesHttpRoute(route: ObservedHttpRoute, specs: readonly FederatedHttpRouteSpec[]): boolean {
  return specs.some((spec) => spec.method === route.method && pathMatchesPattern(route.path, spec.path));
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const pathSegments = path.split("/").filter((segment) => segment !== "");
  const patternSegments = pattern.split("/").filter((segment) => segment !== "");
  return pathSegments.length === patternSegments.length
    && patternSegments.every((segment, index) => segment.startsWith(":") || segment === pathSegments[index]);
}

function uniqueHttpRoutes(routes: ObservedHttpRoute[]): ObservedHttpRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
