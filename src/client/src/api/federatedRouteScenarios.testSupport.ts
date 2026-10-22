import type { Workspace } from "../../../shared/apiTypes";
import { FEDERATED_HTTP_ROUTES } from "../../../shared/federatedRoutes";
import { activityApi, filesApi, gitApi, piWebUiApi, projectsApi, sessionsApi, terminalsApi, workspacesApi } from "./clients";
import { workspaceTasksApi, type WorkspaceTasksClient } from "./workspaceTasksApi";

// Distribute over the tuple union; preserve method/path correlation, omit policy.
type AllowlistedRouteKey = (typeof FEDERATED_HTTP_ROUTES)[number] extends infer R
  ? R extends { readonly method: infer M; readonly path: infer P }
    ? { readonly method: M; readonly path: P }
    : never
  : never;

type GatewayEndpoint = "api/pi-webui/runtime";

type MethodOf<Api, K extends keyof Api> = Extract<Api[K], (...args: never[]) => unknown>;
type ParamsOf<M> = M extends (...args: infer A) => unknown ? A : never;
type NonEmpty<T> = readonly [T, ...T[]];

export type Fixture<M> =
  | {
      readonly kind: "machine";
      readonly route: AllowlistedRouteKey;
      readonly httpMethod?: never;
      readonly endpoint?: never;
      readonly args: (machineId: string) => ParamsOf<M>;
    }
  | {
      readonly kind: "gateway";
      readonly httpMethod: "GET";
      readonly endpoint: GatewayEndpoint;
      readonly route?: never;
      readonly args: (machineId: string) => ParamsOf<M>;
    };

export type ScenarioTable<Api extends object> = {
  readonly [K in keyof Api as Api[K] extends infer T
    ? T extends (...args: never[]) => unknown ? K : never
    : never]-?: NonEmpty<Fixture<MethodOf<Api, K>>>;
};

/** PI WEBUI runtime and system status calls; every row must stay allowlisted on the federated proxy. */
export const piWebUiScenarios = {
  piWebUiStatus: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/status" },
    args: (machineId: string) => [machineId],
  }],
  checkForUpdates: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/status" },
    args: (machineId: string) => [machineId],
  }],
  piWebUiRuntime: [{
    kind: "gateway",
    httpMethod: "GET",
    endpoint: "api/pi-webui/runtime",
    args: () => [],
  }],
  systemInfo: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/system-info" },
    args: (machineId: string) => [machineId],
  }],
  systemMetrics: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/system-metrics" },
    args: (machineId: string) => [machineId],
  }],
} as const satisfies ScenarioTable<typeof piWebUiApi>;

const session = { id: "s 1", cwd: "/repo" };

/** Session, notification, model-selection, and auth calls; every row must stay allowlisted on the federated proxy. */
export const sessionsScenarios = {
  sessions: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions" },
    args: (m: string) => ["/repo", m],
  }],
  reorder: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/reorder" },
    args: (m: string) => [session, {
      cwd: session.cwd,
      scope: { kind: "root" as const, cwd: session.cwd },
      pinned: false,
      catalogCwds: [session.cwd],
      orderedSessions: [session],
    }, m],
  }],
  unreadCatalog: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/unread" },
    args: (m: string) => [m],
  }],
  acknowledgeUnread: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/unread/acknowledge" },
    args: (m: string) => [session, "catalog-a", 7, m],
  }],
  notificationInbox: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/notifications" },
    args: (m: string) => [session, m],
  }],
  dismissNotification: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/notifications/dismiss" },
    args: (m: string) => [session, "daemon-a", "daemon-a:1", m],
  }],
  dismissAllNotifications: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/notifications/dismiss-all" },
    args: (m: string) => [session, "daemon-a", { order: 1, overflowWatermark: 0 }, m],
  }],
  startSession: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions" },
    args: (m: string) => ["/repo", m],
  }],
  startPlusSession: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions" },
    args: (m: string) => ["/repo", {
      mode: "tiered",
      exact: { model: { provider: "openai", id: "gpt" }, thinkingLevel: "medium" },
      tier: "advanced",
    }, m],
  }],
  sessionDefaults: [{
    kind: "machine",
    route: { method: "GET", path: "/session-defaults" },
    args: (m: string) => ["/repo", m],
  }],
  sessionDefaultsV2: [{
    kind: "machine",
    route: { method: "GET", path: "/session-defaults" },
    args: (m: string) => ["/repo", m],
  }],
  updateSessionDefaults: [{
    kind: "machine",
    route: { method: "PUT", path: "/session-defaults" },
    args: (m: string) => ["/repo", { model: { provider: "openai", modelId: "gpt" } }, m],
  }],
  cleanupPreview: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/cleanup/preview" },
    args: (m: string) => [{ archiveIdleDays: 14 }, m],
  }],
  cleanup: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/cleanup" },
    args: (m: string) => [{ archiveIdleDays: 14, deleteArchivedDays: 30, projectCwds: ["/repo"] }, m],
  }],
  forceCleanup: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/cleanup/force" },
    args: (m: string) => [m],
  }],
  archiveMany: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/bulk/archive" },
    args: (m: string) => [[session], m],
  }],
  deleteArchivedMany: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/bulk/delete-archived" },
    args: (m: string) => [[session], m],
  }],
  messages: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/messages" },
    args: (m: string) => [session, { limit: 20, before: 10 }, m],
  }],
  status: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/status" },
    args: (m: string) => [session, m],
  }],
  systemPrompt: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/system-prompt" },
    args: (m: string) => [session, m],
  }],
  extensionEntries: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/extension-entries" },
    args: (m: string) => [session, m],
  }],
  streamSnapshot: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/stream-snapshot" },
    args: (m: string) => [session, m],
  }],
  clearQueue: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/queue/clear" },
    args: (m: string) => [session, m],
  }],
  dismissWarning: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/warnings/dismiss" },
    args: (m: string) => [session, "warning-1", m],
  }],
  modelPolicy: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/model-policy" },
    args: (m: string) => [session, m],
  }],
  rememberCurrentModelPolicy: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/model-policy/remember" },
    args: (m: string) => [session, m],
  }],
  setModelPolicy: [{
    kind: "machine",
    route: { method: "PUT", path: "/sessions/:sessionId/model-policy" },
    args: (m: string) => [session, { mode: "tiered", tier: "advanced" }, m],
  }],
  models: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/models" },
    args: (m: string) => [session, m],
  }],
  setModel: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/model" },
    args: (m: string) => [session, "openai", "gpt", m],
  }],
  cycleModel: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/model/cycle" },
    args: (m: string) => [session, "forward", m],
  }],
  thinkingLevels: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/thinking-levels" },
    args: (m: string) => [session, m],
  }],
  setThinkingLevel: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/thinking-level" },
    args: (m: string) => [session, "medium", m],
  }],
  cycleThinkingLevel: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/thinking-level/cycle" },
    args: (m: string) => [session, m],
  }],
  commands: [{
    kind: "machine",
    route: { method: "GET", path: "/sessions/:sessionId/commands" },
    args: (m: string) => [session, m],
  }],
  prompt: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/prompt" },
    args: (m: string) => [session, "hello", "followUp", m],
  }],
  saveAttachments: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/attachments" },
    args: (m: string) => [session, [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }], m, "uploads"],
  }],
  shell: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/shell" },
    args: (m: string) => [session, "ls", m],
  }],
  runCommand: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/commands/run" },
    args: (m: string) => [session, "/help", m],
  }],
  respondToCommand: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/commands/respond" },
    args: (m: string) => [session, "req 1", "yes", m],
  }],
  navigateTree: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/tree/navigate" },
    args: (m: string) => [session, { targetId: "entry-1", expectedLeafId: "leaf-1", summary: { mode: "none" } }, m],
  }],
  editFromHere: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/messages/edit-from-here" },
    args: (m: string) => [session, "assistant-1", m],
  }],
  forkFromHere: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/messages/fork" },
    args: (m: string) => [session, "user-2", m],
  }],
  abort: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/abort" },
    args: (m: string) => [session, m],
  }],
  stop: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/stop" },
    args: (m: string) => [session, m],
  }],
  archive: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/archive" },
    args: (m: string) => [session, m],
  }],
  archiveWithDescendants: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/archive-tree" },
    args: (m: string) => [session, m],
  }],
  restore: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/restore" },
    args: (m: string) => [session, m],
  }],
  deleteArchived: [{
    kind: "machine",
    route: { method: "DELETE", path: "/sessions/:sessionId" },
    args: (m: string) => [session, m],
  }],
  detachParent: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/detach-parent" },
    args: (m: string) => [session, m],
  }],
  reloadSession: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/reload" },
    args: (m: string) => [session, m],
  }],
  pin: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/pin" },
    args: (m: string) => [session, m],
  }],
  unpin: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/:sessionId/unpin" },
    args: (m: string) => [session, m],
  }],
  authProviders: [{
    kind: "machine",
    route: { method: "GET", path: "/auth/providers" },
    args: (m: string) => [{ mode: "login", authType: "oauth", machineId: m }],
  }],
  saveApiKey: [{
    kind: "machine",
    route: { method: "POST", path: "/auth/api-key" },
    args: (m: string) => ["openai", "key", m],
  }],
  startInteractiveApiKeyLogin: [{
    kind: "machine",
    route: { method: "POST", path: "/auth/api-key/interactive" },
    args: (m: string) => ["amazon-bedrock", m],
  }],
  logoutProvider: [{
    kind: "machine",
    route: { method: "POST", path: "/auth/logout" },
    args: (m: string) => ["openai", m],
  }],
  startOAuthLogin: [{
    kind: "machine",
    route: { method: "POST", path: "/auth/oauth" },
    args: (m: string) => ["openai", m],
  }],
  oauthFlow: [{
    kind: "machine",
    route: { method: "GET", path: "/auth/oauth/:flowId" },
    args: (m: string) => ["flow 1", m],
  }],
  respondOAuthFlow: [{
    kind: "machine",
    route: { method: "POST", path: "/auth/oauth/:flowId/respond" },
    args: (m: string) => ["flow 1", "req 1", "code", m],
  }],
  cancelOAuthFlow: [{
    kind: "machine",
    route: { method: "POST", path: "/auth/oauth/:flowId/cancel" },
    args: (m: string) => ["flow 1", m],
  }],
} as const satisfies ScenarioTable<typeof sessionsApi>;

/** Shared workspace fixture: the scenario tables and the contract test must exercise the same workspace identity. */
export const workspace: Workspace = {
  id: "w 1",
  projectId: "p 1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: true,
};

const projectUsageRequest = { projectPath: "/repo", liveCwds: ["/repo", "/repo-feature"] };

/** Project catalog, directory, and usage calls; every row must stay allowlisted on the federated proxy. */
export const projectsScenarios = {
  projects: [{
    kind: "machine",
    route: { method: "GET", path: "/projects" },
    args: (m: string) => [m],
  }],
  addProject: [{
    kind: "machine",
    route: { method: "POST", path: "/projects" },
    args: (m: string) => ["/repo", "Repo", false, m],
  }],
  closeProject: [{
    kind: "machine",
    route: { method: "DELETE", path: "/projects/:projectId" },
    args: (m: string) => ["p 1", m],
  }],
  closeProjectTree: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/close-tree" },
    args: (m: string) => ["p 1", m],
  }],
  pinProject: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/pin" },
    args: (m: string) => ["p 1", m],
  }],
  unpinProject: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/unpin" },
    args: (m: string) => ["p 1", m],
  }],
  projectDirectories: [{
    kind: "machine",
    route: { method: "GET", path: "/project-directories" },
    args: (m: string) => ["/r", m],
  }],
  projectUsageCount: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/project-usage/count" },
    args: (m: string) => [projectUsageRequest, m],
  }],
  projectUsage: [{
    kind: "machine",
    route: { method: "POST", path: "/sessions/project-usage" },
    args: (m: string) => [projectUsageRequest, m],
  }],
} as const satisfies ScenarioTable<typeof projectsApi>;

/** Project workspace catalog, file, and move calls; every row must stay allowlisted on the federated proxy. */
export const workspacesScenarios = {
  workspaces: [{
    kind: "machine",
    route: { method: "GET", path: "/projects/:projectId/workspaces" },
    args: (m: string) => ["p 1", m],
  }],
  deleteWorkspace: [{
    kind: "machine",
    route: { method: "DELETE", path: "/projects/:projectId/workspaces/:workspaceId" },
    args: (m: string) => ["p 1", "w 1", m],
  }],
  workspaceTree: [{
    kind: "machine",
    route: { method: "GET", path: "/projects/:projectId/workspaces/:workspaceId/tree" },
    args: (m: string) => ["p 1", "w 1", "src", m],
  }],
  workspaceFile: [{
    kind: "machine",
    route: { method: "GET", path: "/projects/:projectId/workspaces/:workspaceId/file" },
    args: (m: string) => ["p 1", "w 1", "README.md", m],
  }],
  writeWorkspaceFile: [{
    kind: "machine",
    route: { method: "PUT", path: "/projects/:projectId/workspaces/:workspaceId/file" },
    args: (m: string) => ["p 1", "w 1", "README.md", "hello", { overwrite: false }, m],
  }],
  deleteWorkspaceFile: [{
    kind: "machine",
    route: { method: "DELETE", path: "/projects/:projectId/workspaces/:workspaceId/file" },
    args: (m: string) => ["p 1", "w 1", "README.md", m],
  }],
  moveWorkspaceFile: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/workspaces/:workspaceId/file/move" },
    args: (m: string) => ["p 1", "w 1", "README.md", "docs/README.md", { overwrite: false }, m],
  }],
} as const satisfies ScenarioTable<typeof workspacesApi>;

/** Workspace terminal and command-run calls; every row must stay allowlisted on the federated proxy. */
export const terminalsScenarios = {
  terminals: [{
    kind: "machine",
    route: { method: "GET", path: "/projects/:projectId/workspaces/:workspaceId/terminals" },
    args: (m: string) => ["p 1", "w 1", m],
  }],
  startTerminal: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/workspaces/:workspaceId/terminals" },
    args: (m: string) => ["p 1", "w 1", { cols: 120, rows: 40 }, m],
  }],
  closeWorkspaceTerminals: [{
    kind: "machine",
    route: { method: "DELETE", path: "/projects/:projectId/workspaces/:workspaceId/terminals" },
    args: (m: string) => ["p 1", "w 1", m],
  }],
  closeTerminal: [{
    kind: "machine",
    route: { method: "DELETE", path: "/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId" },
    args: (m: string) => ["p 1", "w 1", "t 1", m],
  }],
  continueTerminal: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId/continue" },
    args: (m: string) => ["p 1", "w 1", "t 1", m],
  }],
  runTerminalCommand: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/workspaces/:workspaceId/terminal-command-runs" },
    args: (m: string) => ["core", { workspace, title: "Build", command: "npm test" }, m],
  }],
  listCommandRuns: [{
    kind: "machine",
    route: { method: "GET", path: "/terminal-command-runs" },
    args: (m: string) => [{ projectId: "p 1", workspaceId: "w 1", statuses: ["running"], metadata: { "pi.operation": "test" } }, m],
  }],
  getCommandRun: [{
    kind: "machine",
    route: { method: "GET", path: "/terminal-command-runs/:runId" },
    args: (m: string) => ["run 1", m],
  }],
  cancelCommandRun: [{
    kind: "machine",
    route: { method: "POST", path: "/terminal-command-runs/:runId/cancel" },
    args: (m: string) => ["run 1", m],
  }],
} as const satisfies ScenarioTable<typeof terminalsApi>;

/** File suggestion calls; machine-wide and workspace-scoped lookups share one method but two route shapes. */
export const filesScenarios = {
  files: [
    {
      kind: "machine",
      route: { method: "GET", path: "/files" },
      args: (m: string) => ["/repo", "README", { kind: "tracked", mode: "file", machineId: m }],
    },
    {
      kind: "machine",
      route: { method: "GET", path: "/projects/:projectId/workspaces/:workspaceId/files" },
      args: (m: string) => ["/repo", "README", { kind: "tracked", mode: "file", machineId: m, projectId: "p 1", workspaceId: "w 1", workspaceScoped: true }],
    },
  ],
} as const satisfies ScenarioTable<typeof filesApi>;

/** Workspace git inspection calls; every row must stay allowlisted on the federated proxy. */
export const gitScenarios = {
  gitStatus: [{
    kind: "machine",
    route: { method: "GET", path: "/projects/:projectId/workspaces/:workspaceId/git/status" },
    args: (m: string) => ["p 1", "w 1", m],
  }],
  gitDiff: [{
    kind: "machine",
    route: { method: "GET", path: "/projects/:projectId/workspaces/:workspaceId/git/diff" },
    args: (m: string) => ["p 1", "w 1", { path: "README.md", staged: true }, m],
  }],
} as const satisfies ScenarioTable<typeof gitApi>;

/** Workspace activity calls; every row must stay allowlisted on the federated proxy. */
export const activityScenarios = {
  workspaceActivity: [{
    kind: "machine",
    route: { method: "GET", path: "/activity" },
    args: (m: string) => [m],
  }],
} as const satisfies ScenarioTable<typeof activityApi>;

const workspaceTask = { id: "build", title: "Build", command: "npm run build", confirm: false };
const workspaceTasksConfig = {
  version: 1 as const,
  tasks: [workspaceTask],
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

/** Workspace task catalog reads, writes, and moves; every row must stay allowlisted on the federated proxy. */
export const workspaceTasksScenarios = {
  readWorkspace: [{
    kind: "machine",
    route: { method: "GET", path: "/projects/:projectId/workspaces/:workspaceId/workspace-tasks" },
    args: (m: string) => [{ projectId: "p 1", workspaceId: "w 1", machineId: m }],
  }],
  replaceWorkspace: [{
    kind: "machine",
    route: { method: "PUT", path: "/projects/:projectId/workspaces/:workspaceId/workspace-tasks" },
    args: (m: string) => [{ projectId: "p 1", workspaceId: "w 1", machineId: m, expectedRevision: "workspace-revision", config: workspaceTasksConfig }],
  }],
  readGlobal: [{
    kind: "machine",
    route: { method: "GET", path: "/workspace-tasks/global" },
    args: (m: string) => [m],
  }],
  replaceGlobal: [{
    kind: "machine",
    route: { method: "PUT", path: "/workspace-tasks/global" },
    args: (m: string) => [{ machineId: m, expectedRevision: "global-revision", config: workspaceTasksConfig }],
  }],
  move: [{
    kind: "machine",
    route: { method: "POST", path: "/projects/:projectId/workspaces/:workspaceId/workspace-tasks/move" },
    args: (m: string) => [{ projectId: "p 1", workspaceId: "w 1", machineId: m, ...workspaceTaskMove }],
  }],
} as const satisfies ScenarioTable<typeof workspaceTasksApi>;

// `WorkspaceTasksClient` is declared as an interface, and interfaces carry no implicit string index
// signature. This mapped view keeps every member type and the same object identity while letting the
// namespace pass through the runner's index-signature-typed API map.
const workspaceTasksNamespace: { readonly [K in keyof WorkspaceTasksClient]: WorkspaceTasksClient[K] } = workspaceTasksApi;

/** Client namespaces converted to typed scenarios so far; later conversions extend this registry. */
export const MACHINE_SCOPED_CLIENT_APIS = {
  piWebUiApi,
  sessionsApi,
  projectsApi,
  workspacesApi,
  terminalsApi,
  filesApi,
  gitApi,
  activityApi,
  workspaceTasksApi: workspaceTasksNamespace,
} as const;

type StagedClientApiKey = keyof typeof MACHINE_SCOPED_CLIENT_APIS;
type StagedClientMethodKey<K extends StagedClientApiKey> = keyof (typeof MACHINE_SCOPED_CLIENT_APIS)[K];

/** Methods of each staged namespace that must reach the gateway instead of a selected machine. */
export const GATEWAY_ADDRESSED_METHODS = {
  piWebUiApi: ["piWebUiRuntime"],
  sessionsApi: [],
  projectsApi: [],
  workspacesApi: [],
  terminalsApi: [],
  filesApi: [],
  gitApi: [],
  activityApi: [],
  workspaceTasksApi: [],
} as const satisfies { readonly [K in StagedClientApiKey]: readonly StagedClientMethodKey<K>[] };

/** Complete scenario table per staged namespace, checked against that namespace's own API type. */
export const FEDERATED_ROUTE_SCENARIOS = {
  piWebUiApi: piWebUiScenarios,
  sessionsApi: sessionsScenarios,
  projectsApi: projectsScenarios,
  workspacesApi: workspacesScenarios,
  terminalsApi: terminalsScenarios,
  filesApi: filesScenarios,
  gitApi: gitScenarios,
  activityApi: activityScenarios,
  workspaceTasksApi: workspaceTasksScenarios,
} as const satisfies { readonly [K in StagedClientApiKey]: ScenarioTable<(typeof MACHINE_SCOPED_CLIENT_APIS)[K]> };
