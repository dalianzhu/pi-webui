# Remote Session Pin Federation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the deterministic
> subagent-driven-development controller to implement this plan task-by-task.
> Keep every task commit green and leave checkboxes unticked; controller state is
> the progress record.

**Goal:** Federate remote session pin/unpin, Force Cleanup, and project-usage requests, and prevent recurrence with a typed, executable client-route contract.

**Architecture:** Add the five missing HTTP route declarations without changing server handlers or client request construction. Keep fixture data and compile-time scenario contracts in a test-support module excluded from the production build; keep the sequential runner and its assertions in the existing contract test. Add focused gateway forwarding and client response tests plus one patch Changeset.

**Tech Stack:** TypeScript 6, Vitest, Fastify injection tests, Changesets, `npm run typecheck`, ESLint, and `npm run verify:fast`.

## Global Constraints

- No runtime dependency additions.
- There is no enforced runtime version floor.
- Do not change session runtime ownership, server handlers, client request construction, parsers, UI, data formats, or published documentation.
- Keep `src/client/src/api/federatedRouteScenarios.testSupport.ts` test-only; `tsconfig.build.json` excludes `src/**/*.testSupport.ts`.

## Task 1: Add the five federated HTTP routes

**Implementer tier:** Standard

**Lane:** `federation-contract`

**Files:**
- Modify: `src/shared/federatedRoutes.ts:60-140`

**Interfaces:**
- Consumes: the existing `FEDERATED_HTTP_ROUTES` tuple and its `FederatedHttpRouteSpec` constraint.
- Produces: five policy-free POST route literals in the existing tuple. The exported tuple has 128 entries after this task; `REMOTE_HTTP_ROUTES` continues to derive from it.

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`
- `npm test -- --run src/server/app.remoteProxy.test.ts`

**Checklist:**
- [ ] Add `{ method: "POST", path: "/sessions/:sessionId/pin" }` immediately after `/sessions/:sessionId/reorder` and before the new unpin entry.
- [ ] Add `{ method: "POST", path: "/sessions/:sessionId/unpin" }` immediately after pin and before `/sessions/:sessionId/detach-parent`.
- [ ] Add `{ method: "POST", path: "/sessions/cleanup/force" }` immediately after `/sessions/cleanup` and before `/sessions/bulk/archive`.
- [ ] Add `{ method: "POST", path: "/sessions/project-usage" }` immediately after `POST /sessions` and before the new count entry.
- [ ] Add `{ method: "POST", path: "/sessions/project-usage/count" }` immediately after project-usage and before `GET /sessions/unread`.
- [ ] Add no `timeoutMs`; preserve every existing tuple member and the workspace-task spread. Confirm the tuple grows 123 to 128 and the derived remote route list 118 to 123 by inspection, without adding a separate proxy list.
- [ ] Run every command above and require exit 0 before committing.

**Commit message:** `fix(federation): allow remote session pin and usage routes`

## Task 2: Implement the typed sequential scenario runner

**Implementer tier:** Advanced

**Lane:** `federation-contract`

**Files:**
- Create: `src/client/src/api/federatedRouteScenarios.testSupport.ts`
- Modify: `src/client/src/api/federatedRouteContract.test.ts:1-420`

**Interfaces:**
- Consumes: `FEDERATED_HTTP_ROUTES` from `../../../shared/federatedRoutes` and the existing nested-base URL helpers used by client requests.
- Produces: private `AllowlistedRouteKey`, `GatewayEndpoint`, `MethodOf`, `ParamsOf`, `NonEmpty`, `Fixture`, and `ScenarioTable` types in test support; export only `Fixture` and `ScenarioTable` if the runner's type signatures need them. The contract test owns `tableRows(table)`, `methodAt(api, key)`, and the sequential invocation/matching runner. Its execution entry accepts the staged API registry, matching scenario registry, gateway-address map, and `machineId`; before evaluating any builder it freezes and verifies every actual API namespace in the registry. The focused Task 2 test uses one-entry registries.

**Test commands:**
- Red: `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`
- Green: `npm run typecheck`
- Green: `npm run lint`
- Green: `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`

**Checklist:**
- [ ] Add a focused runner test first using a frozen, one-method test API whose method issues one mocked fetch. Declare the fixture with `as const satisfies ScenarioTable<typeof testApi>` and prove the runner invokes that assigned method, checks its one request, and does not accept an empty list. Run the focused command and observe the new assertion fail before implementing it.
- [ ] In test support, copy the complete type definitions from specification §3, including the distributive method/path-preserving `AllowlistedRouteKey`, closed `GatewayEndpoint = "api/pi-webui/runtime"`, `MethodOf`, `ParamsOf`, `NonEmpty`, the mutually exclusive discriminated `Fixture` union with opposite optional `never` fields, and the distributive optional-function-aware `ScenarioTable`. Import the real tuple; do not widen it, cast fixtures, or copy a hand-maintained route union.
- [ ] Keep the module under the `*.testSupport.ts` name, import it from the contract test, and verify the stated `tsconfig.build.json` exclusion. All added types and any exports must be used by that importing test; do not add production exports or unused helpers.
- [ ] Implement the runner in the contract test, not in test support. Iterate scenarios sequentially in registry, table, and fixture order. Before any builder runs, freeze every actual API object in `MACHINE_SCOPED_CLIENT_APIS` and verify `Object.isFrozen` for all of them; do not freeze only the current module or a copy. Check nonempty fixtures and callable optional methods; retain each original API object as `this` when invoking its captured member.
- [ ] Configure the fetch mock to return a fresh JSON `Response` per call; use the complete successful bodies from §7 when the assigned identity is `sessionsApi.pin` or `sessionsApi.unpin`, and require those invocations to resolve to equal values. Keep the default body `{}` for other methods. Do not add response factories or callbacks to the fixture union.
- [ ] Implement phase 0: derive and validate gateway identity/variant, record fetch count, evaluate `args(machineId)` synchronously once, and assert no fetch even if the builder throws. Preserve builder failures for the exact diagnostic and do not invoke after a phase-0 failure.
- [ ] Implement phase 1: take a new fetch baseline, have the runner invoke the assigned method exactly once with its builder tuple, catch sync throws and async rejections only as the outcome, assert exactly one fetch, and then perform route assertions outside the catch. Do not add an invocation counter or deduplicate calls. A one-fetch rejection is acceptable to the general transport assertion; zero/multiple fetches fail.
- [ ] Normalize the observed method from `init.method`, then `Request.method`, then `GET`; read string, URL, and Request inputs. For machine fixtures, resolve `api/machines/${encodeURIComponent(machineId)}` with `resolveAppUrl`, require the same origin and exact pathname prefix followed by `/`, strip it once, and match the remaining path before query/fragment.
- [ ] Implement strict segment matching: split without dropping empty segments; require equal segment counts; compare literals exactly; let `:param` match one nonempty segment; never decode, collapse slashes, trim a trailing slash, or decode `%2F`. Assert `/sessions/s%201/pin` and `/sessions/s%2F1/pin` match; assert `//sessions/s%201/pin`, `/sessions//s%201/pin`, `/sessions/s%201/pin/`, and `/sessions//pin` do not.
- [ ] Find every matching tuple entry for the observed method/path, count `:param` segments, require one least-parameter winner, and require the declared pair to equal it. Preserve tuple order in candidate output. For `POST /sessions/bulk/archive`, only the literal pattern is most specific over `/sessions/:sessionId/archive`; equal-specificity ties fail rather than choosing by order.
- [ ] For gateway fixtures derive identity from registry module key and method key. The only allowed identity is `piWebUiApi.piWebUiRuntime`; require GET, reject machine-addressed requests, and compare the complete URL to `resolveAppUrl(fixture.endpoint)`. Do not send this observation through the machine-route extractor and do not add the runtime route to the allowlist.
- [ ] Use the exact diagnostic context: `L` is `[federation ${moduleKey}.${methodKey}#${oneBasedFixtureIndex}]`; machine `D` is `METHOD /pattern`, gateway `D` is `GET ` plus its resolved absolute endpoint. Format `O` as normalized `METHOD /stripped-path` for route assertions or `METHOD absolute-URL` for URL-boundary assertions; `A` is `JSON.stringify` of attributed `METHOD absolute-URL` calls in call order. Format candidate/tie arrays as JSON arrays of full `METHOD /pattern` strings in tuple order.
- [ ] Preserve these exact assertion templates (ordinary Vitest formatting may surround them); use the full required diagnostic ordering from specification §5.4:

| Failure | Required message |
| --- | --- |
| Empty method list | `[federation ${moduleKey}.${methodKey}] empty fixture list: expected>=1 observed=0` |
| Namespace not frozen | `${L} namespace freeze failed: expected=true observed=${Object.isFrozen(api)}; declared=${D}` |
| Selected method not callable | `${L} assigned method is not callable: expected=function observed=${typeof member}; declared=${D}` |
| Wrong variant | `${L} gateway identity mismatch: expected=${expectedKind} observed=${fixture.kind}; declared=${D}` |
| Builder fetch | `${L} requests while building arguments: expected=0 observed=${phase0Count}; declared=${D}` |
| Builder throws | `${L} argument builder threw (namespace frozen=${Object.isFrozen(api)}): ${errorName}: ${errorMessage}; declared=${D}` |
| Fetch count | `${L} fetch count mismatch: expected=1 observed=${phase1Count}; declared=${D}; observedCalls=${A}; outcome=${outcome}` |
| Machine origin/prefix | `${L} machine URL mismatch: expectedPrefix=${expectedPrefix}/ observed=${observedUrl}; declared=${D}` |
| HTTP method | `${L} HTTP method mismatch: expected=${declaredMethod} observed=${observedMethod}; declared=${D}; observedRequest=${O}` |
| Strict path | `${L} strict path mismatch: observed=${O}; declared=${D}; matchingPatterns=${candidateList}` |
| Specificity tie | `${L} ambiguous most-specific route: observed=${O}; declared=${D}; tiedPatterns=${tieList}; matchingPatterns=${candidateList}` |
| Declaration loses specificity | `${L} declared route is not most-specific: observed=${O}; declared=${D}; mostSpecific=${winningRoute}; matchingPatterns=${candidateList}` |
| Machine-addressed gateway | `${L} gateway request is machine-addressed: observed=${O}; declared=${D}` |
| Gateway URL | `${L} gateway URL mismatch: expected=${resolvedEndpoint} observed=${observedUrl}; declared=${D}` |

- [ ] Format booleans and counts with `String`; for captured failures use `error.name` and `error.message` when the value is an `Error`, otherwise `NonError` and `String(value)`. Format outcome as `resolved` or `rejected(${errorName}: ${errorMessage})`. Do not use truthiness to decide whether an error was thrown. Check method mismatch before path mismatch, path mismatch before specificity, and ties before comparing declaration to winner.
- [ ] Keep unsafe assertions to `tableRows`, `methodAt`, and the single tuple-spread invocation site. Each cast comment must state the key/method/argument correlation invariant lost during mapped-type iteration. Do not cast the entire registry to `any`.
- [ ] Keep existing filter-based tests, WebSocket block, and image-preview expression/check intact. The existing concurrent HTTP block remains until the complete module inventory has been converted; subsequent tasks add rows to the sequential runner, and Task 7 removes the legacy calls.
- [ ] Run every green command above and commit only with all checks passing.

**Commit message:** `test(federation): add typed sequential route scenario runner`

## Task 3: Convert the PI WEBUI client API scenarios

**Implementer tier:** Standard

**Lane:** `federation-contract`

**Files:**
- Modify: `src/client/src/api/federatedRouteScenarios.testSupport.ts`
- Modify: `src/client/src/api/federatedRouteContract.test.ts:1-420`

**Interfaces:**
- Consumes: `Fixture`, `ScenarioTable`, and the runner from Task 2; the actual `piWebUiApi` from `./clients`.
- Produces: a typed `piWebUiScenarios` table, the initial `MACHINE_SCOPED_CLIENT_APIS`, `GATEWAY_ADDRESSED_METHODS`, and `FEDERATED_ROUTE_SCENARIOS` registries. During staged conversion these registries contain only modules already converted; every included table satisfies its complete API type. The finished registries must have the exact 20 keys in specification §3.

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`

**Checklist:**
- [ ] Add these five `piWebUiApi` rows exactly: `piWebUiStatus` GET `/pi-webui/status`; `checkForUpdates` GET `/pi-webui/status`; `piWebUiRuntime` gateway GET `api/pi-webui/runtime`; `systemInfo` GET `/pi-webui/system-info`; `systemMetrics` GET `/pi-webui/system-metrics`.
- [ ] Keep `checkForUpdates`'s `?refresh=1` behavior by calling the existing method; pass `remote-a` to both status methods so they use machine routing. `piWebUiRuntime` has `args: () => []` and the sole gateway identity is `piWebUiApi: ["piWebUiRuntime"]`.
- [ ] Declare `piWebUiScenarios` with `as const satisfies ScenarioTable<typeof piWebUiApi>`. Add the actual API object, not a copy, to the machine registry, and add this complete table to the scenario registry. Run the sequential runner against it under `BASE_URL=./` and `document.baseURI=https://pi.example.test/nested/pi-webui/`.
- [ ] Assert the gateway request is exactly `https://pi.example.test/nested/pi-webui/api/pi-webui/runtime`; machine paths use the exact resolved machine prefix. Preserve the still-unconverted legacy HTTP calls until Task 7.
- [ ] Run every command above and commit only after all checks pass.

**Commit message:** `test(federation): cover runtime API route scenarios`

## Task 4: Convert all session API scenarios

**Implementer tier:** Advanced

**Lane:** `federation-contract`

**Files:**
- Modify: `src/client/src/api/federatedRouteScenarios.testSupport.ts`
- Modify: `src/client/src/api/federatedRouteContract.test.ts:1-420`

**Interfaces:**
- Consumes: Task 2's argument-only `Fixture<Method>` and sequential runner; Task 1's five route literals; `sessionsApi` from `./clients`.
- Produces: `sessionsScenarios` with 60 distinct method keys and 60 nonempty machine-fixture rows, declared `as const satisfies ScenarioTable<typeof sessionsApi>`. Add it to both registries. Its keys and routes are exactly the following.

**Test commands:**
- Red oracle after removing this group from the registry: `npm run typecheck` must fail with missing `sessionsScenarios` keys; restore the group before proceeding.
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`

**Checklist:**
- [ ] Convert every existing session invocation from the concurrent call list to its argument-only builder, preserving the existing values and optional parameter positions, changing the remote id argument to builder parameter `m`. The 60 keys and routes are: `sessions` GET `/sessions`; `reorder` POST `/sessions/:sessionId/reorder`; `unreadCatalog` GET `/sessions/unread`; `acknowledgeUnread` POST `/sessions/:sessionId/unread/acknowledge`; `notificationInbox` GET `/sessions/:sessionId/notifications`; `dismissNotification` POST `/sessions/:sessionId/notifications/dismiss`; `dismissAllNotifications` POST `/sessions/:sessionId/notifications/dismiss-all`; `startSession` POST `/sessions`; `startPlusSession` POST `/sessions`; `sessionDefaults` GET `/session-defaults`; `sessionDefaultsV2` GET `/session-defaults`; `updateSessionDefaults` PUT `/session-defaults`; `cleanupPreview` POST `/sessions/cleanup/preview`; `cleanup` POST `/sessions/cleanup`; `forceCleanup` POST `/sessions/cleanup/force`; `archiveMany` POST `/sessions/bulk/archive`; `deleteArchivedMany` POST `/sessions/bulk/delete-archived`; `messages` GET `/sessions/:sessionId/messages`; `status` GET `/sessions/:sessionId/status`; `systemPrompt` GET `/sessions/:sessionId/system-prompt`; `extensionEntries` GET `/sessions/:sessionId/extension-entries`; `streamSnapshot` GET `/sessions/:sessionId/stream-snapshot`; `clearQueue` POST `/sessions/:sessionId/queue/clear`; `dismissWarning` POST `/sessions/:sessionId/warnings/dismiss`; `modelPolicy` GET `/sessions/:sessionId/model-policy`; `rememberCurrentModelPolicy` POST `/sessions/:sessionId/model-policy/remember`; `setModelPolicy` PUT `/sessions/:sessionId/model-policy`; `models` GET `/sessions/:sessionId/models`; `setModel` POST `/sessions/:sessionId/model`; `cycleModel` POST `/sessions/:sessionId/model/cycle`; `thinkingLevels` GET `/sessions/:sessionId/thinking-levels`; `setThinkingLevel` POST `/sessions/:sessionId/thinking-level`; `cycleThinkingLevel` POST `/sessions/:sessionId/thinking-level/cycle`; `commands` GET `/sessions/:sessionId/commands`; `prompt` POST `/sessions/:sessionId/prompt`; `saveAttachments` POST `/sessions/:sessionId/attachments`; `shell` POST `/sessions/:sessionId/shell`; `runCommand` POST `/sessions/:sessionId/commands/run`; `respondToCommand` POST `/sessions/:sessionId/commands/respond`; `navigateTree` POST `/sessions/:sessionId/tree/navigate`; `editFromHere` POST `/sessions/:sessionId/messages/edit-from-here`; `forkFromHere` POST `/sessions/:sessionId/messages/fork`; `abort` POST `/sessions/:sessionId/abort`; `stop` POST `/sessions/:sessionId/stop`; `archive` POST `/sessions/:sessionId/archive`; `archiveWithDescendants` POST `/sessions/:sessionId/archive-tree`; `restore` POST `/sessions/:sessionId/restore`; `deleteArchived` DELETE `/sessions/:sessionId`; `detachParent` POST `/sessions/:sessionId/detach-parent`; `reloadSession` POST `/sessions/:sessionId/reload`; `pin` POST `/sessions/:sessionId/pin`; `unpin` POST `/sessions/:sessionId/unpin`; `authProviders` GET `/auth/providers`; `saveApiKey` POST `/auth/api-key`; `startInteractiveApiKeyLogin` POST `/auth/api-key/interactive`; `logoutProvider` POST `/auth/logout`; `startOAuthLogin` POST `/auth/oauth`; `oauthFlow` GET `/auth/oauth/:flowId`; `respondOAuthFlow` POST `/auth/oauth/:flowId/respond`; `cancelOAuthFlow` POST `/auth/oauth/:flowId/cancel`.
- [ ] Use `session = { id: "s 1", cwd: "/repo" }`. Add the exact additional tuples: `notificationInbox` `[session, m]`; `dismissNotification` `[session, "daemon-a", "daemon-a:1", m]`; `dismissAllNotifications` `[session, "daemon-a", { order: 1, overflowWatermark: 0 }, m]`; `startPlusSession` `["/repo", { mode: "tiered", exact: { model: { provider: "openai", id: "gpt" }, thinkingLevel: "medium" }, tier: "advanced" }, m]`; `sessionDefaultsV2` `["/repo", m]`; `forceCleanup` `[m]`; `dismissWarning` `[session, "warning-1", m]`; `modelPolicy` `[session, m]`; `setModelPolicy` `[session, { mode: "tiered", tier: "advanced" }, m]`.
- [ ] Use the exact pin/unpin fixtures from §3: `pin: [{ kind: "machine", route: { method: "POST", path: "/sessions/:sessionId/pin" }, args: (m) => [session, m] }]` and `unpin: [{ kind: "machine", route: { method: "POST", path: "/sessions/:sessionId/unpin" }, args: (m) => [session, m] }]`. Keep `archiveMany` declared as literal `POST /sessions/bulk/archive`, retaining its existing argument values.
- [ ] Preserve `messages`' options slot before `m`, and existing values for reorder, navigation, attachments, `authProviders` (`{ mode: "login", authType: "oauth", machineId: m }`), and every already-exercised session operation. Execute the 60 rows through the sequential runner.
- [ ] Run every green command above and commit only after all checks pass.

**Commit message:** `test(federation): cover session API route scenarios`

## Task 5: Convert project, workspace, terminal, file, git, activity, and workspace-task scenarios

**Implementer tier:** Advanced

**Lane:** `federation-contract`

**Files:**
- Modify: `src/client/src/api/federatedRouteScenarios.testSupport.ts`
- Modify: `src/client/src/api/federatedRouteContract.test.ts:1-420`

**Interfaces:**
- Consumes: Task 2 runner and scenario types; the route tuple; `projectsApi`, `workspacesApi`, `terminalsApi`, `filesApi`, `gitApi`, `activityApi`, and `workspaceTasksApi`.
- Produces: seven complete typed tables with 35 route-shape rows total (34 distinct function-valued methods because `filesApi.files` has two rows). Each table is `as const satisfies ScenarioTable<typeof itsApi>` and is registered under the matching API key.

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`

**Checklist:**
- [ ] `projectsApi` (9 rows): `projects` GET `/projects`; `addProject` POST `/projects`; `closeProject` DELETE `/projects/:projectId`; `closeProjectTree` POST `/projects/:projectId/close-tree`; `pinProject` POST `/projects/:projectId/pin`; `unpinProject` POST `/projects/:projectId/unpin`; `projectDirectories` GET `/project-directories`; `projectUsageCount` POST `/sessions/project-usage/count`; `projectUsage` POST `/sessions/project-usage`. `closeProjectTree` returns `["p 1", m]`. Each usage method returns `[{ projectPath: "/repo", liveCwds: ["/repo", "/repo-feature"] }, m]`. Preserve optional `name` and `create` slots in `addProject` before `m`.
- [ ] `workspacesApi` (7): `workspaces` GET `/projects/:projectId/workspaces`; `deleteWorkspace` DELETE `/projects/:projectId/workspaces/:workspaceId`; `workspaceTree` GET `/projects/:projectId/workspaces/:workspaceId/tree`; `workspaceFile` GET `/projects/:projectId/workspaces/:workspaceId/file`; `writeWorkspaceFile` PUT `/projects/:projectId/workspaces/:workspaceId/file`; `deleteWorkspaceFile` DELETE `/projects/:projectId/workspaces/:workspaceId/file`; `moveWorkspaceFile` POST `/projects/:projectId/workspaces/:workspaceId/file/move`. Use `p 1`, `w 1`; preserve text-write options-before-machine-id. Do not change `deleteWorkspace`'s existing parser. Binary and text writes are the same route shape; existing client tests retain byte/header coverage.
- [ ] `terminalsApi` (9): `terminals` GET `/projects/:projectId/workspaces/:workspaceId/terminals`; `startTerminal` POST the same path; `closeWorkspaceTerminals` DELETE the same path; `closeTerminal` DELETE `/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId`; `continueTerminal` POST `/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId/continue`; `runTerminalCommand` POST `/projects/:projectId/workspaces/:workspaceId/terminal-command-runs`; `listCommandRuns` GET `/terminal-command-runs`; `getCommandRun` GET `/terminal-command-runs/:runId`; `cancelCommandRun` POST `/terminal-command-runs/:runId/cancel`. Exercise `getCommandRun` through its fetch-based helper; its 404 branch still has one route shape and one fetch.
- [ ] `filesApi` (one method, two required rows): machine-wide `GET /files` with `["/repo", "README", { kind: "tracked", mode: "file", machineId: m }]`; workspace-scoped `GET /projects/:projectId/workspaces/:workspaceId/files` with `["/repo", "README", { kind: "tracked", mode: "file", machineId: m, projectId: "p 1", workspaceId: "w 1", workspaceScoped: true }]`. Assert both rows execute; do not rely on nonempty typing to imply branch completeness.
- [ ] `gitApi` (2): `gitStatus` GET `/projects/:projectId/workspaces/:workspaceId/git/status`; `gitDiff` GET `/projects/:projectId/workspaces/:workspaceId/git/diff`. Preserve existing values and the optional diff-options position before `m`.
- [ ] `activityApi` (1): `workspaceActivity` GET `/activity`.
- [ ] `workspaceTasksApi` (5): `readWorkspace` GET and `replaceWorkspace` PUT `/projects/:projectId/workspaces/:workspaceId/workspace-tasks`; `readGlobal` GET and `replaceGlobal` PUT `/workspace-tasks/global`; `move` POST `/projects/:projectId/workspaces/:workspaceId/workspace-tasks/move`. Retain the existing task config, revisions, move operation id/source/destination/`intent: "start"`; put `machineId: m` inside workspace/write/move input objects and use `[m]` for `readGlobal`.
- [ ] Preserve all existing exercised arguments and optional slots from the legacy invocation block while converting. Run all 35 rows sequentially and leave the remaining legacy calls intact until Task 7.
- [ ] Run every command above and commit only after all checks pass.

**Commit message:** `test(federation): cover workspace and project API routes`

## Task 6: Convert configuration API scenarios

**Implementer tier:** Standard

**Lane:** `federation-contract`

**Files:**
- Modify: `src/client/src/api/federatedRouteScenarios.testSupport.ts`
- Modify: `src/client/src/api/federatedRouteContract.test.ts:1-420`

**Interfaces:**
- Consumes: Task 2 runner/types and `configApi`, `modelsConfigApi`, `modelTiersApi`, `utilityModelsApi`.
- Produces: four complete typed tables and 11 machine rows: config (2), models config (5), model tiers (2), utility models (2).

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`

**Checklist:**
- [ ] `configApi` (2): `config` GET `/config`; `saveConfig` PUT `/config`. Pass `m` explicitly even though omission selects the gateway; preserve `saveConfig`'s `{ config: ... }` wire envelope.
- [ ] `modelsConfigApi` (5): `config` GET `/models-config`; `limitsStatus` GET `/models-config/limits`; `save` PUT `/models-config`; `test` POST `/models-config/test`; `discover` POST `/models-config/discover`. Use `[m]` for config/limits, `[{ providers: {} }, m]` for save, and `[{ providerName: "custom", provider: { api: "openai-completions", baseUrl: "https://models.example.test/v1", apiKey: "$MODEL_API_KEY" }, model: { id: "gpt" } }, m]` for test. Keep existing discover arguments. Fetch remains stubbed; do not connect to a provider.
- [ ] `modelTiersApi` (2): `settings` GET `/model-tiers`; `save` PUT `/model-tiers`. Define private `tierLadder: ModelTierLadder` with all six entries using model `{ provider: "openai", id: "gpt-5.6-luna" }` and thinking levels: economy `off`, fast `low`, standard `medium`, advanced `high`, capable `xhigh`, frontier `max`. Use `[m]` and `[tierLadder, m]`.
- [ ] `utilityModelsApi` (2): `settings` GET `/utility-models`; `save` PUT `/utility-models`. Use `[m]` and `[{ context: null }, 3, m]`. The session-only Context value throws before fetch and cannot be used as the save fixture.
- [ ] Execute each of the 11 rows with the remote id; retain all existing argument semantics and keep the remaining legacy call list until Task 7.
- [ ] Run every command above and commit only after all checks pass.

**Commit message:** `test(federation): cover configuration API route scenarios`

## Task 7: Complete the module inventory and remove concurrent calls

**Implementer tier:** Advanced

**Lane:** `federation-contract`

**Files:**
- Modify: `src/client/src/api/federatedRouteScenarios.testSupport.ts`
- Modify: `src/client/src/api/federatedRouteContract.test.ts:1-520`

**Interfaces:**
- Consumes: Tasks 2-6 runner, types, and staged registries; the remaining seven actual client API modules.
- Produces: exact `MACHINE_SCOPED_CLIENT_APIS`, `GATEWAY_ADDRESSED_METHODS`, and `FEDERATED_ROUTE_SCENARIOS` registries from specification §3. The tables cover 20 modules, 128 function-valued methods, and 129 rows (128 machine plus the single gateway row). Replace the old concurrent invocation list with sequential registry iteration.

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`

**Checklist:**
- [ ] Add `skillsConfigApi` (6): `list` GET `/skills`; `toggle` PATCH `/skills`; `search` POST `/skills/search`; `install` POST `/skills/install`; `check` POST `/skills/check`; `update` POST `/skills/update`.
- [ ] Add `piPackagesApi` (4): `packages` GET `/pi-packages`; `install` POST `/pi-packages/install`; `remove` POST `/pi-packages/remove`; `update` POST `/pi-packages/update`. Preserve the exercised source-bearing update and optional remove/update argument positions before the explicit remote id.
- [ ] Add `piPackagePluginsApi` (2): `list` GET `/package-plugins`; `mutate` POST `/package-plugins`.
- [ ] Add `memoryApi.snapshot` (1) GET `/agent-memory/snapshot`; `learnedSkillsApi.snapshot` (1) GET `/agent-skills/snapshot`; `pluginsApi.plugins` (1) GET `/plugins` with explicit remote id; `recentProjectsApi` (3): `recentProjects` GET `/recent-projects`, `recordRecentProject` POST `/projects/:projectId/recent`, `removeRecentProject` DELETE `/recent-projects/:entryId`, using `[m]`, `["p 1", m]`, `["recent 1", m]`.
- [ ] Use exactly 20 module keys in both registries, in the specification's order: `sessionsApi`, `projectsApi`, `workspacesApi`, `terminalsApi`, `filesApi`, `gitApi`, `activityApi`, `piWebUiApi`, `configApi`, `modelsConfigApi`, `modelTiersApi`, `utilityModelsApi`, `skillsConfigApi`, `piPackagesApi`, `piPackagePluginsApi`, `memoryApi`, `learnedSkillsApi`, `pluginsApi`, `recentProjectsApi`, `workspaceTasksApi`. Do not list `machinesApi`, `ttsApi`, or `speechInputApi`.
- [ ] Declare every API table with `as const satisfies ScenarioTable<typeof actualApi>` and the registry with the required mapped `satisfies` type. Keep fixture data and types private except the registries and types the contract runner imports; all fixture lists are nonempty and every function-valued key is present.
- [ ] Convert `workspaceTasksApi` inputs and all remaining legacy calls using their existing values. After all 129 rows run through the sequential runner, remove the old `Promise.all` invocation list, `ignoreParseFailure`, and only imports/constants made unused by that list. Do not remove allowlist-filter checks, the WebSocket block, or the verbatim image-preview URL check. Assert image-preview separately against the allowlist after fixture processing.
- [ ] Keep the image-preview direct-URL expression and parameters unchanged. Keep query strings outside route matching, and ensure no method gets two fixtures except `filesApi.files`, which gets exactly its two required branch rows.
- [ ] Run every command above and commit only after all checks pass.

**Commit message:** `test(federation): cover all machine client API methods`

## Task 8: Add remote proxy forwarding and older-remote tests

**Implementer tier:** Standard

**Lane:** `proxy-tests`

**Files:**
- Modify: `src/server/app.remoteProxy.test.ts:1-650`

**Interfaces:**
- Consumes: Task 1's allowlist declarations and existing `registerAppTestHooks`, `appTestContext`, `fakeRemoteClient`, `addRemoteMachine`, `MachineClient["request"]`, and reorder proxy-test pattern.
- Produces: the six isolated §7 app-injection cases plus §10 unknown-machine and transport-failure cases, each with a fresh typed remote fake and context. No production route or handler changes.

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/server/app.remoteProxy.test.ts`

**Checklist:**
- [ ] Add the exact wire bodies from specification §7: `pinBody` (`id: "s 1"`, `/repo/session.jsonl`, cwd `/repo`, fixed created/modified timestamps, zero messages, empty firstMessage, `pinned: true`); `unpinBody` with `pinned: false`; complete `forceCleanupBody`; `usageInput` with `projectPath: "/repo"` and both live CWDs; exact zero/live usage buckets, `usageBody`, `usageCountBody`, and `missingRemoteRouteBody = { error: "API route not found" }`.
- [ ] Add six cases for POST pin, POST unpin, POST `/sessions/cleanup/force`, POST `/sessions/project-usage`, POST `/sessions/project-usage/count`, and a remote pin request returning 404. Use the exact inject URLs/payloads, upstream `(method, path, body)` triples, statuses, and response bodies in specification §7; session id in paths is literally `s%201`; Force Cleanup has no `payload` property and upstream body is `undefined`.
- [ ] In every case, inject through the real `appTestContext.app`; have the remote fake resolve a JSON Readable with the declared status/body; assert one remote request, exact three-argument `toHaveBeenCalledWith`, exact status, JSON and raw `response.body`, and zero `appTestContext.sessionDaemonRequests`.
- [ ] The 404 case must observe one upstream request and preserve exactly status 404 and `{ error: "API route not found" }`. Keep `clientDist: false`; do not install a custom not-found handler. Do not alter the existing route code.
- [ ] Add two §10 cases against the registered pin path: inject `POST /api/machines/missing/sessions/s%201/pin` with `{ cwd: "/repo" }` and require exactly status 404 plus `{ error: "Machine not found" }`, with no remote request; for transport failure, add a remote machine whose request rejects with `RemoteMachineRequestError("connection refused", 502)`, inject `POST /api/machines/${machineId}/sessions/s%201/pin` with `{ cwd: "/repo" }`, and require exactly status 502 plus `{ error: "Remote machine unavailable", machineId, statusCode: 502, detail: "connection refused" }` and the exact upstream `("POST", "/api/sessions/s%201/pin", { cwd: "/repo" })` call. Both cases require zero local-daemon requests. Keep existing timeout and local-owner behavior unchanged.
- [ ] Run every command above and commit only after all checks pass.

**Commit message:** `test(federation): cover remote pin and usage proxy forwarding`

## Task 9: Verify remote pin response parsing and 404 errors

**Implementer tier:** Standard

**Lane:** `client-response-tests`

**Files:**
- Modify: `src/client/src/api/clients.test.ts:1-1500`

**Interfaces:**
- Consumes: `sessionsApi`, the existing `stubSequenceFetch`, `jsonResponse`, `fetchCall`, `requestBody`, and `HttpRequestError` from `./http`.
- Produces: focused pin, unpin, and older-remote error tests. No parser, HTTP client, or production client changes.

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/clients.test.ts`

**Checklist:**
- [ ] Under `BASE_URL=./` and `document.baseURI=https://pi.example.test/nested/pi-webui/`, create the complete `pinBody` and `unpinBody` values from specification §7 as local test data. Do not share cross-suite state.
- [ ] Call `sessionsApi.pin({ id: "s 1", cwd: "/repo" }, "remote /?")` once with `jsonResponse(pinBody)`. Require exact promise equality to the full body and `pinned === true`; require one POST to `https://pi.example.test/nested/pi-webui/api/machines/remote%20%2F%3F/sessions/s%201/pin` and parsed body `{ cwd: "/repo" }`.
- [ ] Call `sessionsApi.unpin({ id: "s 1", cwd: "/repo" }, "remote /?")` once with `jsonResponse(unpinBody)`. Require exact promise equality to the full body and `pinned === false`; require one POST to `https://pi.example.test/nested/pi-webui/api/machines/remote%20%2F%3F/sessions/s%201/unpin` and parsed body `{ cwd: "/repo" }`.
- [ ] Stub the exact 404 JSON `Response`, call `sessionsApi.pin` once, and inspect the one caught error. Assert it is an instance of `HttpRequestError`, has `name === "HttpRequestError"`, `status === 404`, and `message === "API route not found"`; do not issue a second request for separate assertions.
- [ ] Run every command above and commit only after all checks pass.

**Commit message:** `test(client): verify remote pin responses and errors`

## Task 10: Add the user-facing patch Changeset

**Implementer tier:** Fast

**Lane:** `release-note`

**Files:**
- Create: `.changeset/remote-session-pin-federation.md`

**Interfaces:**
- Consumes: the user-visible behavior introduced by Task 1 and the exact release note in specification §11.
- Produces: one Changeset for `@hyperdreamer/pi-webui`, patch release, with the exact user-facing statement from specification §11.

**Test commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`
- `npm test -- --run src/server/app.remoteProxy.test.ts`
- `npm test -- --run src/client/src/api/clients.test.ts`
- `git diff --check`

**Checklist:**
- [ ] Create exactly `.changeset/remote-session-pin-federation.md` with:

```md
---
"@hyperdreamer/pi-webui": patch
---

Fix remote session pinning and unpinning, Force Cleanup, and project usage statistics failing with "API route not found".
```

- [ ] Do not edit `CHANGELOG.md`, versions, lockfiles, tags, publication settings, or user-facing documentation.
- [ ] Run every command above and commit only after all checks pass.

**Commit message:** `docs(changeset): note remote session pin federation fix`

## Task 11: Mutation-probe the guard and run final verification

**Implementer tier:** Advanced

**Lane:** `federation-contract`

**Files:**
- Read/write for persistent fixes only: `src/shared/federatedRoutes.ts`, `src/client/src/api/federatedRouteScenarios.testSupport.ts`, `src/client/src/api/federatedRouteContract.test.ts`
- Transient mutation target only: `src/client/src/api/clients.ts` (restore its exact pre-probe bytes after each probe; no final diff)
- Read-only verification: `src/server/app.remoteProxy.test.ts`, `src/client/src/api/clients.test.ts`, `.changeset/remote-session-pin-federation.md`

**Interfaces:**
- Consumes: all completed tasks, the exact mutation catalog in specification §9, and the scenario runner/registries.
- Produces: the six-file implementation unchanged by probes, with every mechanical mutation's required failure observed, every intentional blind spot recorded without claiming it is caught, and final verification passing. No probe code remains.

**Test commands:**
- Type-only probe command: `npm run typecheck`
- Runner probe command: `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`
- Final type check: `npm run typecheck`
- Final focused tests: `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`; `npm test -- --run src/server/app.remoteProxy.test.ts`; `npm test -- --run src/client/src/api/clients.test.ts`
- Final whitespace and broad checks: `git diff --check`; `npm run verify:fast`

**Checklist:**
- [ ] For each probe, save the exact current bytes of only its target, make one mutation, run only its indicated TYPE or HTTP command, record exit status and required diagnostic, then restore and byte-compare before beginning the next probe. Never restore a whole file from an older commit or overwrite unrelated work.
- [ ] Run the TYPE probe removing the pin allowlist entry; require an assignability error naming `/sessions/:sessionId/pin`.
- [ ] Run HTTP probes for: pin client path mismatch (require `strict path mismatch: observed=POST /sessions/s%201/not-pin; declared=POST /sessions/:sessionId/pin`); pin verb PUT (require `HTTP method mismatch: expected=POST observed=PUT`); zero-fetch rejection (require count 0 and `outcome=rejected(Error: pre-transport probe)`); two pin fetches (require count 2 and both URLs); archiveMany declaring `/sessions/:sessionId/archive` (require the literal pattern wins and both candidates are reported); synchronous builder fetch (phase-0 count 1); duplicate slash (strict path rejection); namespace reassignment (frozen namespace TypeError); listed gateway identity using machine variant; machine identity using gateway variant; wrong gateway path; and equal-specificity tie (both tied patterns).
- [ ] Run TYPE probes for `pin: []` (`TS2322`); sibling method as `args` (`TS2322`); hybrid shared machine fixture with gateway-only fields (`TS2322`/`never`); gateway endpoint as machine route (`TS2322`); arbitrary gateway endpoint (`TS2322`); and adding a required sessions method without a table key (`TS1360`). Also run the runtime empty-list probe and require `[federation sessionsApi.pin] empty fixture list: expected>=1 observed=0`.
- [ ] Run the missing-pin route probe and require typecheck to reject `/sessions/:sessionId/pin`. Keep the `clients.ts` production source unchanged after all probes.
- [ ] Run the documented blind-spot probes separately: XHR-only builder request, scheduled `queueMicrotask` request with a throwing `toJSON`, synchronous serialization request with a throwing `toJSON`, and a new machine-scoped module omitted from both registries. Record that the guard does not detect these, restore any temporary `resolveAppUrl` import/global, and do not present a pass as purity proof. Review all fixture builders for inert arguments and no scheduled/serialization side effects; review the two `filesApi.files` branches and explicit module inventory.
- [ ] After restoring every probe, rerun final `npm run typecheck` and all three focused tests. Run `git diff --check`, then `npm run verify:fast` without concurrent full-suite or heavy work. Require exit 0 for each; record exact commands, exit statuses, and relevant diagnostic excerpts in the implementation handoff without creating a repository log artifact. Verify the test-support module is imported and exports no unused values.
- [ ] Inspect the final diff without changing unrelated state. It must contain only `src/shared/federatedRoutes.ts`, `src/client/src/api/federatedRouteScenarios.testSupport.ts`, `src/client/src/api/federatedRouteContract.test.ts`, `src/server/app.remoteProxy.test.ts`, `src/client/src/api/clients.test.ts`, and `.changeset/remote-session-pin-federation.md`. There is no documentation edit, production client edit, handler edit, build, publish, release, or service restart.
- [ ] Commit only after every probe is restored, all required diagnostic evidence is recorded, final verification passes, and the six-file final diff is confirmed.

**Commit message:** `test(federation): verify route contract mutations`

## Execution summary

**Total tasks:** 11

**Lane ownership:**

| Lane | Tasks | Ownership globs |
| --- | --- | --- |
| `federation-contract` | 1-7, 11 | `src/shared/federatedRoutes.ts`; `src/client/src/api/federatedRouteScenarios.testSupport.ts`; `src/client/src/api/federatedRouteContract.test.ts`; `src/client/src/api/clients.ts` for transient probes only, restored byte-for-byte |
| `proxy-tests` | 8 | `src/server/app.remoteProxy.test.ts` |
| `client-response-tests` | 9 | `src/client/src/api/clients.test.ts` |
| `release-note` | 10 | `.changeset/remote-session-pin-federation.md` |

Different lanes own disjoint file sets. Proxy, client response, and release-note tasks may run concurrently after Task 1 is integrated; federation-contract tasks run in their listed dependency order.

**Dependency edges:**
- Task 1 -> Task 2
- Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7
- Task 1 -> Task 8
- Task 1 -> Task 9
- Task 1 -> Task 10
- Tasks 1-10 -> Task 11

**Expected final verification commands:**
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`
- `npm test -- --run src/server/app.remoteProxy.test.ts`
- `npm test -- --run src/client/src/api/clients.test.ts`
- `git diff --check`
- `npm run verify:fast`

**Specification coverage:**
- §2 allowlist: Task 1.
- §§3-6 typed fixtures, 20-module inventory, runner, exact assertion diagnostics, nested-base matching, purity limits, and unsafe-assertion boundaries: Tasks 2-7 and 11.
- §7 six proxy forwarding and old-remote 404 cases: Task 8.
- §8 pin/unpin response parsing and client-side 404 error: Task 9.
- §9 mechanical mutation probes and blind spots: Task 11.
- §10 unknown-machine and unreachable-transport responses on registered pin paths: Task 8; timeout behavior remains covered by the unchanged focused proxy suite, upstream 404 passthrough by Task 8, browser error mapping by Task 9. No separate local-owner task is added because the only production change is allowlist registration; existing local session and usage handlers remain unchanged.
- §§11-12 Changeset and no documentation change: Task 10.
- §13 typecheck, focused tests, mutation restoration, fast verification, and final scope inspection: Task 11.

**Unresolved acceptance conflict:** The specification §13 requires the five missing allowlist routes to be absent while fixtures are first added, then expects `npm run typecheck` to fail. The task constraint requires Task 1 to add all five routes before fixture-inventory work, and every task commit must be green. Task 11 retains the falsifiable missing-route typecheck mutation, but the original pre-allowlist red-phase order cannot also be met.
