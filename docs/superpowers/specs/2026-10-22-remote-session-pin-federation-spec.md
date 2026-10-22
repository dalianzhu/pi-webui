# Remote session pin/unpin federation — technical specification

**Date:** 2026-10-22

**Authority:** approved revision 9 of `docs/superpowers/specs/2026-10-22-remote-session-pin-federation-design.md`, committed at `c6f9fe8eb5f2628acada2d12c346bcc19db8563d`.

**Audience:** implementers and reviewers. Requirements below describe the implementation to create; validation commands are acceptance instructions, not results claimed by this drafting task.

## 1. Scope and non-scope

**Scope.** Add the five entries in §2 to `src/shared/federatedRoutes.ts`; create `src/client/src/api/federatedRouteScenarios.testSupport.ts`; convert the HTTP invocation block of `src/client/src/api/federatedRouteContract.test.ts` to the typed scenarios and sequential runner in §§3–6; add the forwarding cases in `src/server/app.remoteProxy.test.ts` and response checks in `src/client/src/api/clients.test.ts`; and create the patch Changeset in §11. These are the implementation's six changed or created files. The contract covers the 20 explicitly classified API modules, their 128 function-valued methods, and 129 route-shape rows in §4.

**Non-scope.** Preserve server handlers, services, stores, session runtime ownership, client request construction, parsers, UI, settings, capabilities, and data formats. Do not add runtime version checks, retries, caching, locks, migrations, a reverse allowlist-to-server-route check, API-facade discovery, a route ownership map, a query/body DSL, or a sandbox for fixtures. `machinesApi`, `ttsApi`, and `speechInputApi` remain gateway-local and have no scenario tables. Keep the existing filter-based allowlist tests, WebSocket block, and direct image-preview URL check; the HTTP runner replaces the concurrent invocation mechanism without broadening these other checks.

## 2. Federated allowlist change

Insert exactly these object literals into `FEDERATED_HTTP_ROUTES`, with no `timeoutMs` field. The table follows the design's five-path order; the neighbour columns determine their actual positions in the array. Preserve every existing entry and the workspace-task spread.

| Order | Entry | Insert after | Insert before |
| --- | --- | --- | --- |
| 1 | `{ method: "POST", path: "/sessions/:sessionId/pin" }` | Existing `POST /sessions/:sessionId/reorder` | New `POST /sessions/:sessionId/unpin` |
| 2 | `{ method: "POST", path: "/sessions/:sessionId/unpin" }` | New `POST /sessions/:sessionId/pin` | Existing `POST /sessions/:sessionId/detach-parent` |
| 3 | `{ method: "POST", path: "/sessions/cleanup/force" }` | Existing `POST /sessions/cleanup` | Existing `POST /sessions/bulk/archive` |
| 4 | `{ method: "POST", path: "/sessions/project-usage" }` | Existing `POST /sessions` | New `POST /sessions/project-usage/count` |
| 5 | `{ method: "POST", path: "/sessions/project-usage/count" }` | New `POST /sessions/project-usage` | Existing `GET /sessions/unread` |

The exported HTTP tuple grows from 123 to 128 entries. `REMOTE_HTTP_ROUTES` in `src/server/machines/machineProxyRoutes.ts` continues to derive from that tuple, excluding only the five workspace-task entries. It consequently grows from 118 to 123 entries without a separate proxy list edit. The five additions use `MachineClient`'s existing 30,000 ms default timeout.

The local session proxy in `src/server/sessiond/sessionProxyRoutes.ts` already registers both the sessions collection and `${prefix}/sessions/*`, including the `/api/machines/local` registration in `src/server/app.ts`. Owner handlers already exist in `src/server/sessions/sessionRoutes.ts` and `src/server/usage/projectUsageRoutes.ts`. Do not edit those registrations to implement this fix.

## 3. Client fixture contract

Place this complete type block in the new test-support module, importing the real `FEDERATED_HTTP_ROUTES` from `../../../shared/federatedRoutes`. Do not widen its inferred tuple type or substitute a hand-maintained route union.

```ts
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

type Fixture<M> =
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

type ScenarioTable<Api extends object> = {
  readonly [K in keyof Api as Api[K] extends infer T
    ? T extends (...args: never[]) => unknown ? K : never
    : never]-?: NonEmpty<Fixture<MethodOf<Api, K>>>;
};
```

Each module has a local constant named by replacing its `Api` suffix with `Scenarios`: for example, `sessionsScenarios` and `workspaceTasksScenarios`. Declare each with `as const satisfies ScenarioTable<typeof sessionsApi>` using that table's actual API object. `satisfies` must check the literal rather than a cast that suppresses errors. Export the three value registries below from test support and import them in the contract test; keep types and individual tables private unless a type is actually consumed by the runner. Do not export unused helpers.

```ts
export const MACHINE_SCOPED_CLIENT_APIS = {
  sessionsApi, projectsApi, workspacesApi, terminalsApi, filesApi, gitApi,
  activityApi, piWebUiApi, configApi, modelsConfigApi, modelTiersApi,
  utilityModelsApi, skillsConfigApi, piPackagesApi, piPackagePluginsApi,
  memoryApi, learnedSkillsApi, pluginsApi, recentProjectsApi, workspaceTasksApi,
} as const;

export const GATEWAY_ADDRESSED_METHODS = {
  piWebUiApi: ["piWebUiRuntime"],
} as const;

export const FEDERATED_ROUTE_SCENARIOS = {
  sessionsApi: sessionsScenarios,
  projectsApi: projectsScenarios,
  workspacesApi: workspacesScenarios,
  terminalsApi: terminalsScenarios,
  filesApi: filesScenarios,
  gitApi: gitScenarios,
  activityApi: activityScenarios,
  piWebUiApi: piWebUiScenarios,
  configApi: configScenarios,
  modelsConfigApi: modelsConfigScenarios,
  modelTiersApi: modelTiersScenarios,
  utilityModelsApi: utilityModelsScenarios,
  skillsConfigApi: skillsConfigScenarios,
  piPackagesApi: piPackagesScenarios,
  piPackagePluginsApi: piPackagePluginsScenarios,
  memoryApi: memoryScenarios,
  learnedSkillsApi: learnedSkillsScenarios,
  pluginsApi: pluginsScenarios,
  recentProjectsApi: recentProjectsScenarios,
  workspaceTasksApi: workspaceTasksScenarios,
} as const satisfies {
  readonly [N in keyof typeof MACHINE_SCOPED_CLIENT_APIS]:
    ScenarioTable<(typeof MACHINE_SCOPED_CLIENT_APIS)[N]>;
};
```

| Property | Required meaning and rejection |
| --- | --- |
| Distributive `AllowlistedRouteKey` | An object must contain a method/path pair from the real tuple. Reject a real path with the wrong verb and a misspelled or absent path. Do not independently union methods and paths, which would permit invalid combinations. |
| Policy-free projection | A fixture for tree navigation contains only `method` and `path`; it need not repeat `timeoutMs`. A fresh route literal containing `timeoutMs` is rejected as an excess property (`TS2353`). Proxy timeout policy remains in the shared tuple. |
| Closed `GatewayEndpoint` | Only `api/pi-webui/runtime` is permitted. Reject arbitrary URLs and machine-addressed endpoints. This endpoint cannot be used as a machine route because it is absent from the tuple. |
| `kind` with opposite optional `never` fields | Machine and gateway variants are exclusive, including through a shared `as const` object. Reject a machine fixture carrying `httpMethod` or `endpoint`, and a gateway fixture carrying `route`; do not rely only on excess-property checking of fresh literals. |
| `MethodOf` and `ParamsOf` | Extract the function for the assigned key and its parameter tuple. Reject a sibling API method supplied as `args`, wrong argument order, or a value outside a parameter's type. Optional trailing arguments may be omitted; positional `undefined` placeholders remain necessary when supplying a later machine argument. |
| Distributive key filter and `-?` | Require every function-valued key, including an optional function property whose type includes `undefined`; ignore non-function properties. A new required method makes its table fail with a missing-key diagnostic, normally `TS1360`. An absent optional function at runtime is an error, not an excuse to skip its row. |
| `NonEmpty` | Reject `pin: []` at compile time (`TS2322`), and also check non-emptiness at runtime. Multiple fixtures under the same method represent distinct request-producing shapes. |
| Registry mapped type | Require one table for each explicitly listed module. It cannot discover an API module omitted from both registries; inventory maintenance remains a review obligation. |
| Argument-only fixture | The runner invokes the selected API member. There is no callback for the fixture to invoke an unrelated method or swallow a pre-fetch failure. Purity still has the limits in §6. |

Use these literal fixture entries, which also anchor the mutation edits in §9. `session` is the inert value `{ id: "s 1", cwd: "/repo" }` in test support.

```ts
pin: [{
  kind: "machine",
  route: { method: "POST", path: "/sessions/:sessionId/pin" },
  args: (m) => [session, m],
}],
unpin: [{
  kind: "machine",
  route: { method: "POST", path: "/sessions/:sessionId/unpin" },
  args: (m) => [session, m],
}],
archiveMany: [{
  kind: "machine",
  route: { method: "POST", path: "/sessions/bulk/archive" },
  args: (m) => [[session], m],
}],
```

`piWebUiScenarios.piWebUiRuntime` is exactly one gateway fixture: `{ kind: "gateway", httpMethod: "GET", endpoint: "api/pi-webui/runtime", args: () => [] }`. All other inventory rows use `kind: "machine"`.

## 4. Fixture inventory

The tables below are the implementation contract, derived from `src/client/src/api/clients.ts` and `src/client/src/api/workspaceTasksApi.ts` at the authority commit. Every row requires an executed fixture; names are exact object keys. Routes are verb/path pairs exactly as declared in the shared tuple after §2, without `/api` or a machine prefix. Gateway endpoints retain their application-relative spelling.

There are **20 modules, 128 distinct methods, 129 rows: 128 machine fixtures and one gateway fixture**. `filesApi.files` has two route shapes and therefore two rows under its one method key. Here a request shape is a distinct HTTP verb and pathname pattern for a non-local machine; optional queries, bodies, encodings, and response branches that retain that pair do not create additional inventory rows. Preserve existing exercised variants, including workspace-file writes and the workspace-task move input. Branch completeness beyond these route shapes remains review-checked, not mechanically inferred by `NonEmpty`.

All remote pathname patterns are statically determinable by following the existing path helpers; **there are no undeterminable rows**. `messagePath`, `machineGitDiffPath`, `getOptionalTerminalCommandRun`, and workspace-task path helpers resolve to the concrete patterns listed below. Query strings are excluded from the allowlist matcher. Every machine fixture must explicitly pass the supplied remote machine id, including APIs that otherwise default to `local` or gateway paths.

Convert each existing API call in the old `Promise.all` list into an argument builder with the same parameter values, replacing the current `machineId` value with builder parameter `m`. Retain its explicit optional argument positions. The additional methods use the concrete values specified below and in §3; all fixture values are inert in-memory data. A fixture pathname such as `/repo/session.jsonl` represents wire data, not a requirement to create a real file.

### 4.1 `sessionsApi` — 60 methods

| Method | Declared route |
| --- | --- |
| `sessions` | `GET /sessions` |
| `reorder` | `POST /sessions/:sessionId/reorder` |
| `unreadCatalog` | `GET /sessions/unread` |
| `acknowledgeUnread` | `POST /sessions/:sessionId/unread/acknowledge` |
| `notificationInbox` | `GET /sessions/:sessionId/notifications` |
| `dismissNotification` | `POST /sessions/:sessionId/notifications/dismiss` |
| `dismissAllNotifications` | `POST /sessions/:sessionId/notifications/dismiss-all` |
| `startSession` | `POST /sessions` |
| `startPlusSession` | `POST /sessions` |
| `sessionDefaults` | `GET /session-defaults` |
| `sessionDefaultsV2` | `GET /session-defaults` |
| `updateSessionDefaults` | `PUT /session-defaults` |
| `cleanupPreview` | `POST /sessions/cleanup/preview` |
| `cleanup` | `POST /sessions/cleanup` |
| `forceCleanup` | `POST /sessions/cleanup/force` |
| `archiveMany` | `POST /sessions/bulk/archive` |
| `deleteArchivedMany` | `POST /sessions/bulk/delete-archived` |
| `messages` | `GET /sessions/:sessionId/messages` |
| `status` | `GET /sessions/:sessionId/status` |
| `systemPrompt` | `GET /sessions/:sessionId/system-prompt` |
| `extensionEntries` | `GET /sessions/:sessionId/extension-entries` |
| `streamSnapshot` | `GET /sessions/:sessionId/stream-snapshot` |
| `clearQueue` | `POST /sessions/:sessionId/queue/clear` |
| `dismissWarning` | `POST /sessions/:sessionId/warnings/dismiss` |
| `modelPolicy` | `GET /sessions/:sessionId/model-policy` |
| `rememberCurrentModelPolicy` | `POST /sessions/:sessionId/model-policy/remember` |
| `setModelPolicy` | `PUT /sessions/:sessionId/model-policy` |
| `models` | `GET /sessions/:sessionId/models` |
| `setModel` | `POST /sessions/:sessionId/model` |
| `cycleModel` | `POST /sessions/:sessionId/model/cycle` |
| `thinkingLevels` | `GET /sessions/:sessionId/thinking-levels` |
| `setThinkingLevel` | `POST /sessions/:sessionId/thinking-level` |
| `cycleThinkingLevel` | `POST /sessions/:sessionId/thinking-level/cycle` |
| `commands` | `GET /sessions/:sessionId/commands` |
| `prompt` | `POST /sessions/:sessionId/prompt` |
| `saveAttachments` | `POST /sessions/:sessionId/attachments` |
| `shell` | `POST /sessions/:sessionId/shell` |
| `runCommand` | `POST /sessions/:sessionId/commands/run` |
| `respondToCommand` | `POST /sessions/:sessionId/commands/respond` |
| `navigateTree` | `POST /sessions/:sessionId/tree/navigate` |
| `editFromHere` | `POST /sessions/:sessionId/messages/edit-from-here` |
| `forkFromHere` | `POST /sessions/:sessionId/messages/fork` |
| `abort` | `POST /sessions/:sessionId/abort` |
| `stop` | `POST /sessions/:sessionId/stop` |
| `archive` | `POST /sessions/:sessionId/archive` |
| `archiveWithDescendants` | `POST /sessions/:sessionId/archive-tree` |
| `restore` | `POST /sessions/:sessionId/restore` |
| `deleteArchived` | `DELETE /sessions/:sessionId` |
| `detachParent` | `POST /sessions/:sessionId/detach-parent` |
| `reloadSession` | `POST /sessions/:sessionId/reload` |
| `pin` | `POST /sessions/:sessionId/pin` |
| `unpin` | `POST /sessions/:sessionId/unpin` |
| `authProviders` | `GET /auth/providers` |
| `saveApiKey` | `POST /auth/api-key` |
| `startInteractiveApiKeyLogin` | `POST /auth/api-key/interactive` |
| `logoutProvider` | `POST /auth/logout` |
| `startOAuthLogin` | `POST /auth/oauth` |
| `oauthFlow` | `GET /auth/oauth/:flowId` |
| `respondOAuthFlow` | `POST /auth/oauth/:flowId/respond` |
| `cancelOAuthFlow` | `POST /auth/oauth/:flowId/cancel` |

Keep the existing reorder/navigation/attachment values and the options slot before the machine id in `messages`. Pin/unpin use the entries in §3. For methods added to the execution inventory use these exact argument-builder return tuples; `session` is the value from §3.

| Additional method | Tuple returned by `args(m)` |
| --- | --- |
| `notificationInbox` | `[session, m]` |
| `dismissNotification` | `[session, "daemon-a", "daemon-a:1", m]` |
| `dismissAllNotifications` | `[session, "daemon-a", { order: 1, overflowWatermark: 0 }, m]` |
| `startPlusSession` | `["/repo", { mode: "tiered", exact: { model: { provider: "openai", id: "gpt" }, thinkingLevel: "medium" }, tier: "advanced" }, m]` |
| `sessionDefaultsV2` | `["/repo", m]` |
| `forceCleanup` | `[m]` |
| `dismissWarning` | `[session, "warning-1", m]` |
| `modelPolicy` | `[session, m]` |
| `setModelPolicy` | `[session, { mode: "tiered", tier: "advanced" }, m]` |

The existing `authProviders` builder returns `[{ mode: "login", authType: "oauth", machineId: m }]`. The starter policy above is a complete `StarterModelPolicyPreference`, including its remembered Exact selection; do not weaken its type to make an incomplete argument compile.

### 4.2 `projectsApi` — 9 methods

| Method | Declared route |
| --- | --- |
| `projects` | `GET /projects` |
| `addProject` | `POST /projects` |
| `closeProject` | `DELETE /projects/:projectId` |
| `closeProjectTree` | `POST /projects/:projectId/close-tree` |
| `pinProject` | `POST /projects/:projectId/pin` |
| `unpinProject` | `POST /projects/:projectId/unpin` |
| `projectDirectories` | `GET /project-directories` |
| `projectUsageCount` | `POST /sessions/project-usage/count` |
| `projectUsage` | `POST /sessions/project-usage` |

`closeProjectTree` returns `["p 1", m]`. Both usage builders return `[{ projectPath: "/repo", liveCwds: ["/repo", "/repo-feature"] }, m]`; they use `projectPath`, not `cwd`. Preserve the optional `name` and `create` positions in `addProject` before the machine id.

### 4.3 `workspacesApi` — 7 methods

| Method | Declared route |
| --- | --- |
| `workspaces` | `GET /projects/:projectId/workspaces` |
| `deleteWorkspace` | `DELETE /projects/:projectId/workspaces/:workspaceId` |
| `workspaceTree` | `GET /projects/:projectId/workspaces/:workspaceId/tree` |
| `workspaceFile` | `GET /projects/:projectId/workspaces/:workspaceId/file` |
| `writeWorkspaceFile` | `PUT /projects/:projectId/workspaces/:workspaceId/file` |
| `deleteWorkspaceFile` | `DELETE /projects/:projectId/workspaces/:workspaceId/file` |
| `moveWorkspaceFile` | `POST /projects/:projectId/workspaces/:workspaceId/file/move` |

Use project `p 1` and workspace `w 1`. Keep the existing text-write variant with options before the machine id. Binary writes have the same route pair; their byte and header behaviour remains covered by existing client tests. Do not change `deleteWorkspace`'s current response parser while converting its fixture.

### 4.4 `terminalsApi` — 9 methods

| Method | Declared route |
| --- | --- |
| `terminals` | `GET /projects/:projectId/workspaces/:workspaceId/terminals` |
| `startTerminal` | `POST /projects/:projectId/workspaces/:workspaceId/terminals` |
| `closeWorkspaceTerminals` | `DELETE /projects/:projectId/workspaces/:workspaceId/terminals` |
| `closeTerminal` | `DELETE /projects/:projectId/workspaces/:workspaceId/terminals/:terminalId` |
| `continueTerminal` | `POST /projects/:projectId/workspaces/:workspaceId/terminals/:terminalId/continue` |
| `runTerminalCommand` | `POST /projects/:projectId/workspaces/:workspaceId/terminal-command-runs` |
| `listCommandRuns` | `GET /terminal-command-runs` |
| `getCommandRun` | `GET /terminal-command-runs/:runId` |
| `cancelCommandRun` | `POST /terminal-command-runs/:runId/cancel` |

`getCommandRun` reaches `fetch` through `getOptionalTerminalCommandRun`; include it exactly like the `request()`-based methods. A 404 response branch still makes one fetch and does not create a second pathname shape.

### 4.5 `filesApi` — 1 method, 2 rows

| Method / shape | Declared route | Required builder arguments |
| --- | --- | --- |
| `files` — machine-wide | `GET /files` | `["/repo", "README", { kind: "tracked", mode: "file", machineId: m }]` |
| `files` — workspace-scoped | `GET /projects/:projectId/workspaces/:workspaceId/files` | `["/repo", "README", { kind: "tracked", mode: "file", machineId: m, projectId: "p 1", workspaceId: "w 1", workspaceScoped: true }]` |

The fallback when `workspaceScoped` is false or either workspace identifier is absent uses the first pair. A nonempty list alone cannot prove that both branches have fixtures; review these two rows explicitly.

### 4.6 `gitApi` — 2 methods

| Method | Declared route |
| --- | --- |
| `gitStatus` | `GET /projects/:projectId/workspaces/:workspaceId/git/status` |
| `gitDiff` | `GET /projects/:projectId/workspaces/:workspaceId/git/diff` |

### 4.7 `activityApi` — 1 method

| Method | Declared route |
| --- | --- |
| `workspaceActivity` | `GET /activity` |

### 4.8 `piWebUiApi` — 5 methods

| Method | Declared route or gateway endpoint |
| --- | --- |
| `piWebUiStatus` | `GET /pi-webui/status` |
| `checkForUpdates` | `GET /pi-webui/status` |
| `piWebUiRuntime` | gateway: `GET api/pi-webui/runtime` |
| `systemInfo` | `GET /pi-webui/system-info` |
| `systemMetrics` | `GET /pi-webui/system-metrics` |

`checkForUpdates` keeps `?refresh=1`; both status methods must receive the remote id so that their gateway-local `local` branch does not run. Runtime takes no arguments and stays in this table.

### 4.9 `configApi` — 2 methods

| Method | Declared route |
| --- | --- |
| `config` | `GET /config` |
| `saveConfig` | `PUT /config` |

Supply the remote id even though this API's omitted-id branch uses the gateway. `saveConfig` retains `{ config: ... }` as its wire envelope.

### 4.10 `modelsConfigApi` — 5 methods

| Method | Declared route |
| --- | --- |
| `config` | `GET /models-config` |
| `limitsStatus` | `GET /models-config/limits` |
| `save` | `PUT /models-config` |
| `test` | `POST /models-config/test` |
| `discover` | `POST /models-config/discover` |

Use `[m]` for `config` and `limitsStatus`, and `[{ providers: {} }, m]` for `save`. For `test` return `[{ providerName: "custom", provider: { api: "openai-completions", baseUrl: "https://models.example.test/v1", apiKey: "$MODEL_API_KEY" }, model: { id: "gpt" } }, m]`; keep the existing `discover` arguments. These drafts are inert and the fetch stub prevents a provider connection.

### 4.11 `modelTiersApi` — 2 methods

| Method | Declared route |
| --- | --- |
| `settings` | `GET /model-tiers` |
| `save` | `PUT /model-tiers` |

`settings` returns `[m]`; `save` returns `[tierLadder, m]`. Define the private `tierLadder: ModelTierLadder` with all six keys. Each entry uses `model: { provider: "openai", id: "gpt-5.6-luna" }`; set `thinkingLevel` to `off` for `economy`, `low` for `fast`, `medium` for `standard`, `high` for `advanced`, `xhigh` for `capable`, and `max` for `frontier`, matching the existing client fixture.

### 4.12 `utilityModelsApi` — 2 methods

| Method | Declared route |
| --- | --- |
| `settings` | `GET /utility-models` |
| `save` | `PUT /utility-models` |

Use `[m]` for `settings` and `[{ context: null }, 3, m]` for `save`. This is a request-producing input; a version-one session-only Context input throws before fetch and would correctly fail the guard rather than cover this row.

### 4.13 `skillsConfigApi` — 6 methods

| Method | Declared route |
| --- | --- |
| `list` | `GET /skills` |
| `toggle` | `PATCH /skills` |
| `search` | `POST /skills/search` |
| `install` | `POST /skills/install` |
| `check` | `POST /skills/check` |
| `update` | `POST /skills/update` |

### 4.14 `piPackagesApi` — 4 methods

| Method | Declared route |
| --- | --- |
| `packages` | `GET /pi-packages` |
| `install` | `POST /pi-packages/install` |
| `remove` | `POST /pi-packages/remove` |
| `update` | `POST /pi-packages/update` |

Preserve the exercised source-bearing update. Source-less updates and optional removal scopes keep the same route pairs; use the correct optional positions before the explicit remote id.

### 4.15 `piPackagePluginsApi` — 2 methods

| Method | Declared route |
| --- | --- |
| `list` | `GET /package-plugins` |
| `mutate` | `POST /package-plugins` |

### 4.16 `memoryApi` — 1 method

| Method | Declared route |
| --- | --- |
| `snapshot` | `GET /agent-memory/snapshot` |

### 4.17 `learnedSkillsApi` — 1 method

| Method | Declared route |
| --- | --- |
| `snapshot` | `GET /agent-skills/snapshot` |

### 4.18 `pluginsApi` — 1 method

| Method | Declared route |
| --- | --- |
| `plugins` | `GET /plugins` |

Supply the remote id; the omitted-id branch is gateway-addressed.

### 4.19 `recentProjectsApi` — 3 methods

| Method | Declared route |
| --- | --- |
| `recentProjects` | `GET /recent-projects` |
| `recordRecentProject` | `POST /projects/:projectId/recent` |
| `removeRecentProject` | `DELETE /recent-projects/:entryId` |

The builders return `[m]`, `["p 1", m]`, and `["recent 1", m]` respectively.

### 4.20 `workspaceTasksApi` — 5 methods

| Method | Declared route |
| --- | --- |
| `readWorkspace` | `GET /projects/:projectId/workspaces/:workspaceId/workspace-tasks` |
| `replaceWorkspace` | `PUT /projects/:projectId/workspaces/:workspaceId/workspace-tasks` |
| `readGlobal` | `GET /workspace-tasks/global` |
| `replaceGlobal` | `PUT /workspace-tasks/global` |
| `move` | `POST /projects/:projectId/workspaces/:workspaceId/workspace-tasks/move` |

Use `machineId: m` inside workspace/write/move input objects, and `[m]` for `readGlobal`. Preserve the existing version-one task config, revision strings, move `operationId`, source, destination, and `intent: "start"` from the current contract test. These routes remain handled by the specialised workspace-task proxy and remain in `FEDERATED_HTTP_ROUTES` for the client contract.

## 5. Runner contract

### 5.1 Placement, isolation, and invocation

Keep the runner and its assertion helpers in `federatedRouteContract.test.ts`; keep data, types, and the registries in test support. The existing test named `covers machine-scoped client HTTP calls with remote proxy routes` remains the focused entry point. Replace its `Promise.all` call list with sequential iteration through the scenario registry, in registry order and then table/fixture order. Do not deduplicate observations before asserting a fixture.

Set `BASE_URL` to `./`, `document.baseURI` to `https://pi.example.test/nested/pi-webui/`, and the supplied machine id to `remote-a`. Install a typed `fetch` mock accepting `string | URL | Request` plus optional `RequestInit`. Each call returns a fresh JSON `Response`; the default body may be `{}` because this runner primarily checks transport. For pin/unpin select the complete successful bodies in §8 by assigned API/method identity so those invocations resolve. Do not change the published `Fixture` union to carry response factories or invocation callbacks. Global stubs and environment variables must be restored by the existing `afterEach` hooks.

Before evaluating any builder, call `Object.freeze` on every actual API object in `MACHINE_SCOPED_CLIENT_APIS`, and verify `Object.isFrozen(api)`. Freeze the imported objects themselves, not copies or the aggregate `api` facade. Freezing is irreversible: do not attempt to unfreeze; it may remain for the lifetime of this isolated test module. The runner invokes captured methods with the original API object as `this`, preserving method semantics. Check that each fixture list is nonempty and that the selected value is callable, including optional-function keys.

For each fixture perform these **two phases**, with all assertions outside the catch used to observe an invocation failure:

1. **Phase 0 — build arguments.** Check gateway identity/variant agreement, record the fetch count, and evaluate `fixture.args(machineId)` synchronously exactly once. Record any thrown builder error. First require the fetch count to be unchanged, even if the builder threw; then fail on a thrown builder error. Do not invoke the method after either failure. A frozen-property assignment must therefore produce a builder failure, not be swallowed as an allowed parser rejection.
2. **Phase 1 — invoke and observe.** Record a fresh fetch baseline immediately before calling the selected method with the returned tuple. Invoke it once and await its outcome, catching both a synchronous throw and an asynchronous rejection as the invocation outcome. Require exactly one newly appended fetch call. Zero is failure even when the method rejected; two or more is failure even when one call is correct. A rejection after one fetch is acceptable for the general route check; it must not hide route assertion failures. Pin/unpin additionally must resolve with the successful parsed values in §8. Assert the sole observed request against its declaration before moving to the next fixture.

The fetch mock is the only transport counter. Do not add an invocation counter as a substitute for the runner making the call. Per-fixture checks replace the old HTTP-wide deduplication and generic aggregate-matching assertions; do not pass the new gateway observation to `routeFromMachineUrl`. Keep the filter-based tests and WebSocket block unchanged. Retain the image-preview direct-URL expression verbatim with its existing parameters and helpers, under the same nested base, and assert its route separately against `FEDERATED_HTTP_ROUTES` after fixture processing. It remains an allowlist check on a direct browser URL and is not counted as a fixture fetch.

Unsafe assertions belong in the design's two small helpers and the single invocation site: `tableRows(table)` recovers key/fixture pairs; `methodAt(api, key)` recovers that same key's method; and the invocation site spreads its corresponding tuple. Each cast requires a comment stating the key–method–argument invariant lost during mapped-type iteration. Do not broaden the whole registry to `any` or add unexplained casts. Any extra assertion requires its own invariant comment and review.

### 5.2 Machine matching

Normalise the observed method to uppercase using `init.method` first, then `Request.method` when the input is a `Request`, otherwise `GET`. Read the full URL from the string, `URL`, or `Request.url`; these client boundaries produce absolute URLs. Compute the expected machine prefix using `resolveAppUrl("api/machines/" + encodeURIComponent(machineId))`. Require the same origin and the exact pathname prefix followed by `/`; do not search for an arbitrary later `/api/machines/` substring. Strip the prefix once. Compare the remaining leading-slash pathname, without the query or fragment, to the declared route. This catches loss of the nested deployment base as well as a wrong machine id.

The strict matcher must implement these rules:

- Split both pathnames on `/` **without filtering empty strings**; the segment counts must be equal.
- Literal segments compare exactly, including the initial empty segment that denotes the leading slash.
- A pattern segment starting with `:` matches exactly one **nonempty** observed segment.
- Do not decode, collapse slashes, strip a trailing slash, or normalise an encoded segment before matching. `s%201` and `s%2F1` are each one nonempty segment; `%2F` must not become a separator. A literal `%252F` is also one segment and is not decoded twice.
- Thus `/sessions/s%201/pin` and `/sessions/s%2F1/pin` match `/sessions/:sessionId/pin`, while `//sessions/s%201/pin`, `/sessions//s%201/pin`, `/sessions/s%201/pin/`, and `/sessions//pin` fail. This is a pattern assertion, not a replacement for owner-side identifier validation.

Find **all** allowlist entries with the observed method whose patterns strictly match the observed pathname. For each, count `:param` segments; the fewest parameters wins. Require exactly one winner and require the declaration to equal that winner's method/path pair. Preserve tuple order when printing candidates. Equal-specificity ties, including a duplicate matching entry, fail and name every tied pattern; do not choose by registration order or declaration preference.

For observed `POST /sessions/bulk/archive`, the candidates are `POST /sessions/bulk/archive` (zero parameters) and `POST /sessions/:sessionId/archive` (one). Only the literal declaration passes. The current tuple has no equal-specificity matching tie. Test the stricter matcher for the empty-segment and encoded-segment cases above in this same test file; the older permissive helper may remain for unchanged checks but cannot be the fixture oracle.

### 5.3 Gateway comparison

Derive identity from the registry's module key and the table's method key, never from a fixture-supplied label. A gateway fixture is legal if and only if that identity is in `GATEWAY_ADDRESSED_METHODS`; a listed identity must use the gateway variant. The map currently permits only `piWebUiApi.piWebUiRuntime`.

Require the observed method to be `GET`; reject a pathname containing the `/api/machines/` segment sequence; then compare the complete observed URL to `resolveAppUrl(fixture.endpoint)`. In this environment the sole expected URL is exactly `https://pi.example.test/nested/pi-webui/api/pi-webui/runtime`, with no query or fragment. Do not compare an application-relative endpoint directly to `URL.pathname`, and do not add the runtime endpoint to the federated tuple to make it pass.

### 5.4 Required diagnostics

Generate assertion errors with the following exact message templates; ordinary Vitest assertion formatting may surround them. Let `L` be `[federation ${moduleKey}.${methodKey}#${oneBasedFixtureIndex}]`. For a machine fixture, `D` is its `METHOD /pattern`; for gateway, `D` is `GET ` followed by its resolved absolute endpoint. `O` is the normalised observed `METHOD /stripped-path` for route assertions, or `METHOD absolute-URL` for URL-boundary assertions. `A` is `JSON.stringify` of every attributed `METHOD absolute-URL` string in call order. Candidate lists are `JSON.stringify` arrays of full `METHOD /pattern` strings in tuple order. Interpolated booleans and counts use `String`.

| Failure | Exact template |
| --- | --- |
| Empty method list | `[federation ${moduleKey}.${methodKey}] empty fixture list: expected>=1 observed=0` |
| Namespace not frozen | `${L} namespace freeze failed: expected=true observed=${Object.isFrozen(api)}; declared=${D}` |
| Selected method not callable | `${L} assigned method is not callable: expected=function observed=${typeof member}; declared=${D}` |
| Wrong variant for identity | `${L} gateway identity mismatch: expected=${expectedKind} observed=${fixture.kind}; declared=${D}` where `expectedKind` is `gateway` or `machine` from the closed map |
| Builder emits fetch | `${L} requests while building arguments: expected=0 observed=${phase0Count}; declared=${D}` |
| Builder throws | `${L} argument builder threw (namespace frozen=${Object.isFrozen(api)}): ${errorName}: ${errorMessage}; declared=${D}` |
| Invocation emits zero/multiple fetches | `${L} fetch count mismatch: expected=1 observed=${phase1Count}; declared=${D}; observedCalls=${A}; outcome=${outcome}` |
| Wrong machine URL prefix or origin | `${L} machine URL mismatch: expectedPrefix=${expectedPrefix}/ observed=${observedUrl}; declared=${D}` |
| Wrong HTTP method | `${L} HTTP method mismatch: expected=${declaredMethod} observed=${observedMethod}; declared=${D}; observedRequest=${O}` |
| Strict path mismatch | `${L} strict path mismatch: observed=${O}; declared=${D}; matchingPatterns=${candidateList}` |
| Equal-specificity tie | `${L} ambiguous most-specific route: observed=${O}; declared=${D}; tiedPatterns=${tieList}; matchingPatterns=${candidateList}` |
| Declaration loses specificity | `${L} declared route is not most-specific: observed=${O}; declared=${D}; mostSpecific=${winningRoute}; matchingPatterns=${candidateList}` |
| Machine URL for gateway fixture | `${L} gateway request is machine-addressed: observed=${O}; declared=${D}` |
| Wrong gateway URL | `${L} gateway URL mismatch: expected=${resolvedEndpoint} observed=${observedUrl}; declared=${D}` |

For captured failures use `errorName = error.name` and `errorMessage = error.message` when the value is an `Error`; otherwise use `NonError` and `String(value)`. `outcome` is `resolved` or `rejected(${errorName}: ${errorMessage})`. Do not use truthiness to distinguish a thrown value from no error. Pin/unpin resolution assertions use Vitest's value comparison, independently of the messages above. Report method mismatch before pathname mismatch, strict pathname mismatch before specificity, and a specificity tie before comparing the declaration to a winner.

## 6. Purity obligations

| Design variant | Status | Required enforcement or limit |
| --- | --- | --- |
| Reassign an exported API object member, such as `sessionsApi.pin = …` | **Closed mechanically** | Freeze the actual namespaces before builders run. Preserve a builder's `TypeError` through the frozen-namespace builder diagnostic. |
| Builder issues its own request synchronously | **Closed mechanically** | Phase 0 requires an unchanged fetch count, including when the builder subsequently throws. |
| Builder schedules work during invocation, or argument access/serialization issues a request while the assigned method fails before its own fetch | **Open; review-checked** | Queued callbacks and impure getters/`toJSON` can create one correctly shaped fetch inside the observation interval. The in-process runner cannot prove its origin. |

**Single fixture-purity reviewer rule:** confirm that each fixture only builds inert arguments and does not issue or schedule work, including through getters, coercion, or serialization hooks on returned values. A passing harness is not evidence that this rule was satisfied.

Separately, reviewers must maintain the explicit module inventory and per-route-shape coverage, and confirm that classified methods still use fetch for HTTP. XHR-only side effects are outside the counter; modules omitted from both registries are outside completeness; and a matching pathname cannot establish which server handler identity owns an overlapping pattern. These are bounds on the contract's claim, not additional runtime mechanisms.

## 7. Server proxy tests

Add five forwarding cases and the remote-404 case below to `src/server/app.remoteProxy.test.ts`, following its existing reorder test and typed `MachineClient["request"]` fake. Use the existing `registerAppTestHooks`, `appTestContext`, `fakeRemoteClient`, and `addRemoteMachine(request)` helper. Each case gets its own fresh fake and app context. `machineId` below is the id returned by that helper; it is already a safe generated identifier. The encoded session segment is literally `s%201`.

Use these complete inert wire values; none requires a real session, daemon, or provider connection:

```ts
const pinBody = {
  id: "s 1",
  path: "/repo/session.jsonl",
  cwd: "/repo",
  created: "2026-10-22T00:00:00.000Z",
  modified: "2026-10-22T00:00:00.000Z",
  messageCount: 0,
  firstMessage: "",
  pinned: true,
};
const unpinBody = { ...pinBody, pinned: false };
const forceCleanupBody = {
  generatedAt: "2026-10-22T00:00:00.000Z",
  thresholds: {},
  projects: [],
  totals: { archiveCount: 0, deleteCount: 0 },
  archivedSessionIds: [],
  deletedSessionIds: [],
};
const usageInput = { projectPath: "/repo", liveCwds: ["/repo", "/repo-feature"] };
const zeroUsage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessionCount: 0,
};
const liveUsage = {
  input: 4, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.25, sessionCount: 2,
};
const usageBody = {
  projectPath: "/repo",
  buckets: { live: liveUsage, retired: zeroUsage, archived: zeroUsage },
  total: liveUsage,
  generatedAt: "2026-10-22T00:00:00.000Z",
};
const usageCountBody = { sessionCount: 2 };
const missingRemoteRouteBody = { error: "API route not found" };
```

For each case the fake resolves `{ statusCode, headers: { "content-type": "application/json" }, body: Readable.from([JSON.stringify(targetBody)]) }` using that row's status and target body. The fake is not a replacement for the gateway routing under test: inject through the real app. The expected remote request has exactly three arguments; these routes add no request options.

| Case | Exact `appTestContext.app.inject(...)` input | Expected remote call `(method, path, body)` | Fake status / target body | Gateway assertions |
| --- | --- | --- | --- | --- |
| Pin | `` { method: "POST", url: `/api/machines/${machineId}/sessions/s%201/pin`, payload: { cwd: "/repo" } } `` | `("POST", "/api/sessions/s%201/pin", { cwd: "/repo" })` | `200`, `pinBody` | `statusCode === 200`; JSON equals `pinBody` |
| Unpin | `` { method: "POST", url: `/api/machines/${machineId}/sessions/s%201/unpin`, payload: { cwd: "/repo" } } `` | `("POST", "/api/sessions/s%201/unpin", { cwd: "/repo" })` | `200`, `unpinBody` | `statusCode === 200`; JSON equals `unpinBody` |
| Force Cleanup | `` { method: "POST", url: `/api/machines/${machineId}/sessions/cleanup/force` } `` | `("POST", "/api/sessions/cleanup/force", undefined)` | `200`, `forceCleanupBody` | `statusCode === 200`; JSON equals `forceCleanupBody` |
| Project usage | `` { method: "POST", url: `/api/machines/${machineId}/sessions/project-usage`, payload: usageInput } `` | `("POST", "/api/sessions/project-usage", usageInput)` | `200`, `usageBody` | `statusCode === 200`; JSON equals `usageBody` |
| Project usage count | `` { method: "POST", url: `/api/machines/${machineId}/sessions/project-usage/count`, payload: usageInput } `` | `("POST", "/api/sessions/project-usage/count", usageInput)` | `200`, `usageCountBody` | `statusCode === 200`; JSON equals `usageCountBody` |
| Older remote lacks pin | `` { method: "POST", url: `/api/machines/${machineId}/sessions/s%201/pin`, payload: { cwd: "/repo" } } `` | `("POST", "/api/sessions/s%201/pin", { cwd: "/repo" })` | `404`, `missingRemoteRouteBody` | `statusCode === 404`; JSON equals exactly `{ error: "API route not found" }` |

In **each** case use `expect(request).toHaveBeenCalledTimes(1)` and `expect(request).toHaveBeenCalledWith(...)` with the exact tuple above; use `expect(response.statusCode).toBe(...)`, `expect(response.json()).toEqual(targetBody)`, and `expect(response.body).toBe(JSON.stringify(targetBody))`. Also require `appTestContext.sessionDaemonRequests` to have length zero so a remote request cannot accidentally pass by reaching the local wildcard. In Force Cleanup omit `payload` entirely; sending `{}` would fail to describe the real client call. The two usage requests preserve the entire `liveCwds` array.

The 404 test must observe one remote call; a bare gateway route miss does not qualify. The test harness uses `clientDist: false`, whose own unknown-route body is Fastify's default JSON. Do not install a custom not-found handler merely to fabricate the requested remote error.

## 8. Client response parsing checks

In `src/client/src/api/clients.test.ts` add pin and unpin success cases under the nested base from §5, using that file's existing `stubSequenceFetch`, `jsonResponse`, `fetchCall`, and `requestBody` helpers. Use `pinBody` and `unpinBody` with the complete fields from §7 as local test values. Share their shape deliberately within the file; do not introduce cross-suite global state or extend the fixture union.

| Call | Stub response | Required value assertion | Required request assertion |
| --- | --- | --- | --- |
| `sessionsApi.pin({ id: "s 1", cwd: "/repo" }, "remote /?")` | `jsonResponse(pinBody)` | `await expect(call).resolves.toEqual(pinBody)`; the resulting `pinned` is strictly `true` | One `POST` to `https://pi.example.test/nested/pi-webui/api/machines/remote%20%2F%3F/sessions/s%201/pin`; parsed request body equals `{ cwd: "/repo" }` |
| `sessionsApi.unpin({ id: "s 1", cwd: "/repo" }, "remote /?")` | `jsonResponse(unpinBody)` | `await expect(call).resolves.toEqual(unpinBody)`; the resulting `pinned` is strictly `false` | One `POST` to `https://pi.example.test/nested/pi-webui/api/machines/remote%20%2F%3F/sessions/s%201/unpin`; parsed request body equals `{ cwd: "/repo" }` |

Use exact equality, not a truthiness check or an assertion on the raw response. These calls exercise the existing `parseSessionInfo`, which already preserves an optional boolean `pinned`; false must remain present. In the contract runner the two assigned method identities likewise receive fresh valid responses of these shapes and must resolve to equal values after the route assertion; any rejection fails these additional checks rather than being treated as an allowed generic parse failure.

Also add the client half of the older-remote case in `clients.test.ts`: stub `new Response(JSON.stringify({ error: "API route not found" }), { status: 404, headers: { "content-type": "application/json" } })`, call `sessionsApi.pin` once, and require the caught error to be an instance of the existing `HttpRequestError` from `./http`, with `name === "HttpRequestError"`, `status === 404`, and `message === "API route not found"`. Do not issue the call twice to make separate rejection assertions. No parser or HTTP implementation changes are required.

## 9. Mutation probe catalogue

Apply one mutation at a time to the completed implementation, run its indicated command, capture the exit status and required diagnostic substring, and restore the exact pre-probe bytes before the next probe. These are transient experiments, not shipped changes. Do not restore whole files from an earlier commit over unrelated work. The following command aliases are documentation shorthand for the exact commands shown; they are not new package scripts:

- **TYPE:** `npm run typecheck`
- **HTTP:** `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`

The ordinary baseline is all fixtures from §4, including the literal entries in §3. For table-field edits below, change only the named fixture. For client-line edits, change only the named API property in `clients.ts`.

| Probe | Exact edit | Failing command | Expected diagnostic substring / observation |
| --- | --- | --- | --- |
| Missing pin allowlist entry | Delete `{ method: "POST", path: "/sessions/:sessionId/pin" }` from the tuple, keeping its fixture. | TYPE | Assignability diagnostic containing `/sessions/:sessionId/pin`; normally `TS2820`. |
| Wrong client pathname | In `sessionsApi.pin`, replace `sessionPath(session, "pin", machineId)` with `sessionPath(session, "not-pin", machineId)`. | HTTP | `strict path mismatch: observed=POST /sessions/s%201/not-pin; declared=POST /sessions/:sessionId/pin` |
| Wrong client verb | In `sessionsApi.pin` only, replace `method: "POST"` with `method: "PUT"`. | HTTP | `HTTP method mismatch: expected=POST observed=PUT` and `declared=POST /sessions/:sessionId/pin` |
| Zero invocation fetches | In `sessionsApi.pin` only, replace its `request(sessionPath(session, "pin", machineId), parseSessionInfo, { method: "POST", body: sessionBody(session) })` expression with `Promise.reject(new Error("pre-transport probe"))`, retaining the parameter list. | HTTP | `fetch count mismatch: expected=1 observed=0; declared=POST /sessions/:sessionId/pin; observedCalls=[]; outcome=rejected(Error: pre-transport probe)` |
| Two invocation fetches | Replace pin's property with `pin: async (session: SessionRef, machineId = "local") => { await request(sessionPath(session, "pin", machineId), parseSessionInfo, { method: "POST", body: sessionBody(session) }); return request(sessionPath(session, "pin", machineId), parseSessionInfo, { method: "POST", body: sessionBody(session) }); },`. | HTTP | `fetch count mismatch: expected=1 observed=2; declared=POST /sessions/:sessionId/pin`; `observedCalls` contains both identical `POST` pin URLs and `outcome=resolved`. |
| Overlap bypass | In the `archiveMany` fixture, change its declared path from `/sessions/bulk/archive` to `/sessions/:sessionId/archive`. | HTTP | `declared route is not most-specific`; includes `observed=POST /sessions/bulk/archive`, `mostSpecific=POST /sessions/bulk/archive`, and both patterns in `matchingPatterns`. |
| Empty list at type boundary | Replace the `pin` fixture list with `[]`. | TYPE | `TS2322`; zero elements cannot satisfy `NonEmpty`. |
| Empty list at runtime | Before running the scenarios, insert `Reflect.set(FEDERATED_ROUTE_SCENARIOS.sessionsApi, "pin", []);`, leaving the typed table declaration intact. | HTTP | `[federation sessionsApi.pin] empty fixture list: expected>=1 observed=0` |
| Synchronous builder fetch | Replace pin's builder with `(m) => { void fetch("https://pi.example.test/nested/pi-webui/api/pi-webui/runtime"); return [session, m]; }`. | HTTP | `requests while building arguments: expected=0 observed=1; declared=POST /sessions/:sessionId/pin` |
| Duplicate slash | In `sessionsApi.pin`, replace its first `request` argument with the literal template expression `` `${machinePrefix(machineId)}/sessions//${encodeURIComponent(sessionId(session))}/pin` ``. | HTTP | `strict path mismatch: observed=POST /sessions//s%201/pin; declared=POST /sessions/:sessionId/pin` |
| Namespace reassignment | Replace pin's builder with `(m) => { sessionsApi.pin = sessionsApi.unpin; return [session, m]; }`. | HTTP | `argument builder threw (namespace frozen=true): TypeError:` |
| Sibling as builder | Replace pin's `args: (m) => [session, m]` with `args: sessionsApi.unpin`. | TYPE | `TS2322`; a returned promise is not the method's argument tuple. |
| Hybrid shared fixture | Define `const hybridPinFixture = { kind: "machine", route: { method: "POST", path: "/sessions/:sessionId/pin" }, httpMethod: "GET", endpoint: "api/pi-webui/runtime", args: (m: string): ParamsOf<typeof sessionsApi.pin> => [session, m] } as const;` before the table; replace pin's list with `[hybridPinFixture]`. | TYPE | `TS2322`, with `httpMethod` and `never` in the diagnostic. The explicit return type keeps its argument tuple valid, isolating the variant-exclusivity failure. |
| Gateway path as machine route | Replace pin's declared route with `{ method: "GET", path: "api/pi-webui/runtime" }`, retaining `kind: "machine"`. | TYPE | `TS2322` and `api/pi-webui/runtime` as a nonmember path. |
| Arbitrary gateway endpoint | In `piWebUiRuntime`'s gateway fixture replace the endpoint with `api/machines/remote-a/sessions/s%201/pin`. | TYPE | `TS2322` and `api/pi-webui/runtime` as the permitted endpoint type. |
| Listed gateway identity uses machine variant | Replace `piWebUiRuntime`'s list with `[{ kind: "machine", route: { method: "GET", path: "/pi-webui/status" }, args: () => [] }]`. | HTTP | `gateway identity mismatch: expected=gateway observed=machine` |
| Machine identity uses gateway variant | Replace pin's list with `[{ kind: "gateway", httpMethod: "GET", endpoint: "api/pi-webui/runtime", args: (m) => [session, m] }]`. | HTTP | `gateway identity mismatch: expected=machine observed=gateway` |
| Wrong gateway client URL | In `piWebUiApi.piWebUiRuntime` only, replace `request("api/pi-webui/runtime", parsePiWebUiRuntimeResponse)` with `request("api/pi-webui/status", parsePiWebUiRuntimeResponse)`. | HTTP | `gateway URL mismatch: expected=https://pi.example.test/nested/pi-webui/api/pi-webui/runtime observed=https://pi.example.test/nested/pi-webui/api/pi-webui/status` |
| New required method | Add `` federationProbe: (machineId = "local") => request(`${machinePrefix(machineId)}/sessions`, arrayOf(parseSessionInfo)), `` to `sessionsApi` without a table entry. | TYPE | `TS1360` and missing property `federationProbe`. |
| Equal-specificity tie | Add `{ method: "POST", path: "/sessions/:otherSessionId/pin" }` beside the pin route, leaving fixtures intact. | HTTP | `ambiguous most-specific route`; `tiedPatterns` contains both `/sessions/:sessionId/pin` and `/sessions/:otherSessionId/pin`. |

The remaining design probes intentionally have **no failing command**. Run HTTP and record that the guard does not detect them; do not describe a pass as proof of purity. For the first probe, the controlled XHR fake counts sends without real network I/O. For the last, only guard discovery is under examination; other tools may separately flag an unused export.

| Blind-spot probe | Exact edit / setup | Command and expected observation |
| --- | --- | --- |
| XHR-only builder effect | Before running the scenarios, stub `XMLHttpRequest` with `class { open(): void {} send(): void { xhrSends += 1; } }` and initialise `let xhrSends = 0`. Replace pin's builder with `(m) => { const xhr = new XMLHttpRequest(); xhr.open("GET", "https://pi.example.test/nested/pi-webui/api/pi-webui/runtime"); xhr.send(); return [session, m]; }`. | HTTP: guard passes, no federation diagnostic, and `xhrSends === 1`. Restore this global with the existing cleanup. |
| Scheduled impersonating request | Replace `modelsConfigScenarios.save`'s builder with the scheduled builder below; import `resolveAppUrl` from `../appUrl` into test support for this probe only. | HTTP: guard passes, no federation diagnostic. The assigned async method rejects during serialization before its own fetch; the queued fetch supplies the one observation. |
| Serialization impersonating request | Replace the same builder with the synchronous serialization builder below, with the same temporary import. | HTTP: guard passes, no federation diagnostic. Argument serialization supplies one fetch and then throws before the method's transport. |
| Unlisted module | Add `` export const federationProbeApi = { probe: (machineId = "local") => request(`${machinePrefix(machineId)}/sessions`, arrayOf(parseSessionInfo)) }; `` to `clients.ts`, without adding it to either registry. | HTTP: guard passes, no federation diagnostic; explicit inventory review must catch it. |

Scheduled builder, replacing only `modelsConfigScenarios.save`'s `args`:

```ts
(m) => {
  const input = {
    providers: {},
    get toJSON(): never { throw new Error("serialization probe"); },
  };
  queueMicrotask(() => {
    void fetch(resolveAppUrl(`api/machines/${encodeURIComponent(m)}/models-config`), { method: "PUT" });
  });
  return [input, m];
}
```

Synchronous serialization builder for the same field:

```ts
(m) => {
  const input = {
    providers: {},
    get toJSON(): never {
      void fetch(resolveAppUrl(`api/machines/${encodeURIComponent(m)}/models-config`), { method: "PUT" });
      throw new Error("serialization probe");
    },
  };
  return [input, m];
}
```

These use the real async `modelsConfigApi.save`: its `JSON.stringify(config)` can reject before `requestJson` calls fetch. The scheduled variant has an awaited rejected promise, allowing the queued microtask to run inside the invocation interval. Both arguments are structurally valid `ModelsConfigDocument` values; no coercion is needed to manufacture the blind spot. Remove both probes and their temporary imports after recording evidence.

## 10. Error and edge behaviour

| Condition | Required observable behaviour |
| --- | --- |
| Unknown machine id on one of the five registered paths | `404` with exactly `{ error: "Machine not found" }`; do not contact an upstream client. |
| Unreachable remote / transport failure | Existing proxy mapping returns `502` with `{ error: "Remote machine unavailable", machineId, statusCode: 502, detail }`. `detail` is the caught error message. |
| Remote request timeout | Existing proxy mapping returns `504` with `{ error: "Remote machine timeout", machineId, statusCode: 504, detail }`. No new timeout override is introduced. |
| Remote returns a non-2xx status | Preserve the upstream status and response body, including the tested `404 { error: "API route not found" }`; continue forwarding only the existing safe response headers. Do not translate an upstream error into a successful response or an unknown-machine response. |
| Browser receives a non-2xx response from the new routes | Their clients use `request()`, which throws `HttpRequestError`; its `status` is the HTTP status and its message is the JSON `error` string, falling back to `response.statusText`. The 404 case is pinned by §8. |
| Local machine pin/unpin/Force Cleanup/usage | Existing local wildcard and owner handlers continue to handle them; do not reroute them through a remote client. |
| Pin/unpin body carries a session cwd | Preserve `{ cwd: "/repo" }`. The existing string-only session lookup would send `{}`; no wire semantics change is needed. |
| Force Cleanup has no body | Preserve `undefined`, not an invented empty JSON object. |
| Older remote lacks a route | Forward its error normally. There is **no capability gating and no enforced runtime version floor** in registration, the gateway, or these client calls. |

The production `API route not found` not-found handler in `app.ts` is conditional on serving a client distribution. API-only mode retains Fastify's default own-route-miss body; the remote passthrough contract is independent of that setting. The fix changes web/API allowlist registration only, with no daemon-only code change or new session-daemon restart requirement.

## 11. Changeset

Create exactly `.changeset/remote-session-pin-federation.md` during implementation, with these contents:

```md
---
"@hyperdreamer/pi-webui": patch
---

Fix remote session pinning and unpinning, Force Cleanup, and project usage statistics failing with "API route not found".
```

This is a backward-compatible correction of already exposed actions. Do not edit `CHANGELOG.md`, package versions, lockfiles, release tags, or publication settings. The specification drafting task creates only this specification; the Changeset above belongs to the later implementation.

## 12. Documentation

Make no user-facing documentation changes. `docs/machines.html` already describes federated projects and sessions rather than enumerating individual endpoints; pin/unpin, cleanup, and usage are existing session/project behaviour. No new workflow, configuration, or capability needs explanation. Keep the README concise under the documentation guide; the patch Changeset supplies the user-visible release note.

## 13. Acceptance checklist

Execute this ordered sequence during implementation. This drafting task does not run type checking, tests, builds, or mutation probes. Record exact commands, exit statuses, and relevant diagnostic excerpts in the implementation handoff without adding another repository artifact for logs.

| Order | Action / command | Observable acceptance result |
| --- | --- | --- |
| 1 | Create the typed scenario support and convert the HTTP runner **while the five allowlist additions remain absent**. Run `npm run typecheck`. | Nonzero exit with assignability diagnostics for all five paths: `/sessions/:sessionId/pin`, `/sessions/:sessionId/unpin`, `/sessions/cleanup/force`, `/sessions/project-usage`, `/sessions/project-usage/count`. The approved design's TypeScript 6.0.3 oracle is `TS2820` for the first three and `TS2322` for the two usage paths. Capture all five rather than stopping at the first error. Vitest transpilation is not red-phase evidence. |
| 2 | Add exactly the five entries at §2's positions. Run `npm run typecheck`. | Exit 0; all tables satisfy their real API types with no missing keys, invalid route pairs, empty lists, or fixture casts suppressing failures. |
| 3 | Run `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`. | Exit 0; all 129 inventory rows execute sequentially with one attributed fetch apiece. Pin/unpin parse successful responses. Gateway runtime resolves under the nested base. Strict matcher cases pass. Existing filter-based, WebSocket, and image-preview checks remain passing. Do not use a hard-coded total as a substitute for typed table completeness. |
| 4 | Add the §7 tests and run `npm test -- --run src/server/app.remoteProxy.test.ts`. | Exit 0; five forwarding cases and upstream-404 passthrough each prove one exact remote request, preserved request body or its absence, target status/body, and no local-daemon request. Existing proxy tests remain passing. |
| 5 | Add the §8 client tests and run `npm test -- --run src/client/src/api/clients.test.ts`. | Exit 0; parsed `pinned: true` and `pinned: false` are retained, encoded nested URLs and cwd bodies are exact, and remote 404 is surfaced as `HttpRequestError` with status/message intact. |
| 6 | Apply every mechanical mutation in §9 separately, run its TYPE or HTTP command, then restore its bytes. | Every listed mechanical probe exits nonzero with its expected diagnostic. A new method fails table completeness, a hybrid object fails exclusivity, duplicate slashes fail strict matching, and overlaps/ties fail the appropriate specificity assertion. |
| 7 | Apply each documented blind-spot probe separately and run HTTP, then restore its bytes and temporary globals/imports. | Record the intentionally undetected outcomes and reviewer obligations. Do not tighten the stated guarantee merely because these probes pass. Review every real builder against §6's single purity rule and check the two `files` rows and explicit module inventory. |
| 8 | After all probe restoration, run `npm run typecheck`, then the three focused commands in orders 3–5 again. | Exit 0 for each; no probe code or altered production request construction remains. |
| 9 | Create the exact §11 Changeset; run `git diff --check`. | No whitespace errors; patch front matter and user-facing note are exact; no generated changelog or version edits. |
| 10 | Run `npm run verify:fast` with no concurrent full suite or heavy job. | Exit 0 for typecheck, lint, Knip, and the fast test suite. The new test-support module is imported and exposes no unused exports. |
| 11 | Inspect `git status --short` and the final diff. | Implementation changes are limited to the six files in §1; no server handler/client logic/parser/UI/documentation changes, reverse route checks, capability flags, or probe remnants. Preserve unrelated pre-existing work. |

### 13.1 Red-phase reconciliation with green commits

Order 1 assumes one working session in which the fixture declarations are written
before the allowlist entries exist, so `npm run typecheck` reports the five missing
routes in a single red observation.

When this specification is executed by a deterministic controller whose tasks must each
leave the repository green, that intermediate state cannot be committed. The equivalent
evidence is then produced by the missing-route mutation probe in plan Task 11: remove one
added entry, run `npm run typecheck`, and require an assignability error naming that
path (for example `/sessions/:sessionId/pin`), then restore the entry byte-for-byte.
The probe is repeatable and permanent, and it demonstrates the same property order 1
demonstrates — a fixture cannot claim a route the allowlist does not contain.

Either path satisfies the design. What is not acceptable is claiming red-phase evidence
from Vitest transpilation, or shipping without ever having observed the typecheck
rejection.

Do not run package builds, publish, create a release, or restart services as part of these acceptance steps. Follow the repository's separate serial `npm run verify` gate when a later merge/release task requires it; that is not a replacement for the red evidence above.

## 14. Traceability

All design-section names below refer to the authority document named at the top of this specification.

| Approved design section | Implementing specification section(s) |
| --- | --- |
| Problem | §§1–2, 7–8, 10: preserve owner behaviour and repair gateway registration; distinguish own misses from upstream 404s. |
| Why the defect class survived | §§3–4, 13: typed completeness covers all 128 methods, including the five missing routes and previously unexercised allowlisted methods. |
| Decision / Scope of the fix | §§1–2: exact five insertions and six-file implementation boundary. |
| The guard | §3: complete published types, exclusive variants, method-specific arguments, nonempty tables, closed gateway endpoint. |
| The runner | §5: namespace freeze, two-phase sequential attribution, one fetch, strict matching, specificity, gateway identity, unsafe-assertion boundaries, exact diagnostics. |
| The module inventory | §4 and §3 registries: exact 20 modules, 128 methods, 129 shape rows; explicit gateway-local exclusions. |
| Scope of the guard's claim | §§4–6, 9: compile/runtime guarantees, branch and transport bounds, three purity variants, single purity review rule, intentional blind spots. |
| Why the guard stays in this change | §§1, 3–6: prevention guard stays with the fix within its approved boundary. |
| Data and control flow | §§1–2, 7–8, 10: unchanged owner mutation, preserved requests/status/body, unchanged `parseSessionInfo`. |
| Error behavior and compatibility | §§7–8, 10: remote 404 passthrough and client error, 502/504 handling, no capability gate or runtime floor. |
| Non-goals | §§1, 10, 12: no UI, settings, migrations, reverse route check, or federation of speech/machine-registration APIs. |
| Testing | §§7–9, 13: exact proxy/client cases, red typecheck before entries, green checks, mechanical mutations and documented open probes. |
| Risks | §§3–6, 13: mechanical conversion, preserved other checks, cast invariants, imported support, lint/Knip coverage. |
| Documentation and release | §§11–13: exact patch Changeset, no user-facing documentation changes, acceptance sequence. |
