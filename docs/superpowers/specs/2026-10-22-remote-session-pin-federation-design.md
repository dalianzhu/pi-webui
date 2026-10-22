# Remote session pin/unpin federation

**Date:** 2026-10-22
**Status:** Approved design, revision 9 (design review 8: APPROVED, 2 minor wording corrections applied)

## Problem

Pinning or unpinning a session owned by a remote machine fails with
`HttpRequestError: API route not found`. The same action on a local session works.

Pinning itself is not broken. Federation is. The gateway forwards a machine-scoped
request only when the path appears in `FEDERATED_HTTP_ROUTES`
(`src/shared/federatedRoutes.ts`), because `registerMachineProxyRoutes`
(`src/server/machines/machineProxyRoutes.ts:20-27`) iterates that list to build
`/api/machines/:machineId<path>` routes for `REMOTE_HTTP_ROUTES`. A machine-scoped
path with no entry falls through to the JSON 404.

The chain for the reported bug:

| Step | Location |
| --- | --- |
| Server registers the routes | `src/server/sessions/sessionRoutes.ts:526,534` |
| Client builds `/api/machines/<id>/sessions/<sid>/pin` | `src/client/src/api/clients.ts:530-531` via `sessionPath` |
| Allowlist has project pin, not session pin | `src/shared/federatedRoutes.ts:59-60` |
| Unregistered machine-scoped API path | `404 { error: "API route not found" }` |

Local sessions are unaffected for a different reason than "no machine prefix": local
requests also address `/api/machines/local/...`, and that prefix is served by the
session-daemon proxy in `src/server/sessiond/sessionProxyRoutes.ts:63-64`, whose
`app.all(`${prefix}/sessions/*`)` forwards any session path to the local daemon. Remote
machine ids have no such wildcard; they have only the explicit allowlist.

The `API route not found` body the user saw is installed conditionally, at
`src/server/app.ts:434-438`: `buildApp` registers that not-found handler only when a
client distribution directory is served. In API-only mode the runtime answers with
Fastify's default 404 JSON instead. The reported message therefore also dates the
failure to a full build, not to a bare server.

Session pinning shipped in `73d64c2` (v1.6.1) without touching `federatedRoutes.ts`.
Project pinning shipped in `eb4912f` and did add its two routes, which is why pinning
projects works remotely and pinning sessions does not.

## Why the defect class survived

`src/client/src/api/federatedRouteContract.test.ts` asserts that every machine-scoped
client call it makes matches an allowlisted route. It knows which calls to make because
the list is written by hand, so it covers exactly the methods someone remembered to
list. `sessionsApi.pin` and `unpin` were never listed.

Re-derived inventory of machine-aware client methods that the contract test never
executes — 25 in total:

| Module | Unexercised methods | Allowlist entry present | Entry asserted by a dedicated `it()` in this test |
| --- | --- | --- | --- |
| `sessionsApi` | `pin`, `unpin`, `forceCleanup` | **no** | n/a |
| `projectsApi` | `projectUsage`, `projectUsageCount` | **no** | n/a |
| `sessionsApi` | `modelPolicy`, `setModelPolicy`, `notificationInbox`, `dismissNotification`, `dismissAllNotifications` | yes | yes (filter-based `it()` blocks) |
| `sessionsApi` | `dismissWarning`, `startPlusSession`, `sessionDefaultsV2` | yes | no |
| `projectsApi` | `closeProjectTree` | yes | no |
| `modelsConfigApi` | `config`, `save`, `test`, `limitsStatus` | yes | no |
| `modelTiersApi` | `settings`, `save` | yes | no |
| `utilityModelsApi` | `settings`, `save` | yes | no |
| `recentProjectsApi` | `recentProjects`, `recordRecentProject`, `removeRecentProject` | yes | yes |

A filter-based `it()` block asserts that an **allowlist entry exists**; it does not
execute the client method. The contract test's only `modelsConfigApi` call is
`discover`; `/models-config/limits` is asserted in
`src/server/app.remoteProxy.test.ts:567`, a different file. "Not exercised" is also not
"broken": twenty of the twenty-five are allowlisted and work; only five paths are
missing.

The five missing paths, all with working local routes
(`src/server/sessions/sessionRoutes.ts:526,534,144`,
`src/server/usage/projectUsageRoutes.ts:33,44`):

- `POST /sessions/:sessionId/pin`
- `POST /sessions/:sessionId/unpin`
- `POST /sessions/cleanup/force`
- `POST /sessions/project-usage`
- `POST /sessions/project-usage/count`

Remote Force Cleanup is the same bug with a different button.

## Decision

Add the five missing allowlist entries, and add a guard that makes the federated
contract executable: every machine-scoped client API method must be exercised by a
fixture that declares the allowlist route it is supposed to request. A machine-scoped
method therefore cannot ship without either allowlist coverage or a fixture that a
reviewer must explicitly approve as effect-free; the boundaries — fetch transport, the
listed modules, per-branch coverage, and fixture purity — are enumerated in "Scope of the
guard's claim".

### Scope of the fix

`src/shared/federatedRoutes.ts` gains the five entries beside their closest relatives,
so the list documents the relationship: `pin`/`unpin` next to
`/sessions/:sessionId/reorder` (they mutate the same ordering metadata through
`runSessionOrderMutation`), `/sessions/cleanup/force` next to `/sessions/cleanup`, and
`/sessions/project-usage[/count]` next to the `/sessions` collection routes.

No server, service, store, client-logic, or parser change: `parseSessionInfo` already
accepts an optional boolean `pinned` (`src/client/src/api/parsers.ts:349`), and
owner-side `pin`/`unpin` already run through `runSessionOrderMutation`.

### The guard

New test-support module
`src/client/src/api/federatedRouteScenarios.testSupport.ts`.

```ts
// distributive projection: keeps the method<->path correlation, drops proxy policy
type AllowlistedRouteKey = (typeof FEDERATED_HTTP_ROUTES)[number] extends infer R
  ? R extends { readonly method: infer M; readonly path: infer P }
    ? { readonly method: M; readonly path: P }
    : never
  : never;

// closed union: a gateway fixture cannot name an arbitrary URL
type GatewayEndpoint = "api/pi-webui/runtime";

type MethodOf<Api, K extends keyof Api> = Extract<Api[K], (...args: never[]) => unknown>;
type ParamsOf<M> = M extends (...args: infer A) => unknown ? A : never;
type NonEmpty<T> = readonly [T, ...T[]];

// A fixture supplies arguments only; the runner performs the call, so a request
// observed during that invocation is attributed to it. Fixture purity is a review
// obligation, not a guarantee — see "Scope of the guard's claim".
type Fixture<M> =
  | { readonly kind: "machine"; readonly route: AllowlistedRouteKey;
      readonly httpMethod?: never; readonly endpoint?: never;
      readonly args: (machineId: string) => ParamsOf<M> }
  | { readonly kind: "gateway"; readonly httpMethod: "GET"; readonly endpoint: GatewayEndpoint;
      readonly route?: never;
      readonly args: (machineId: string) => ParamsOf<M> };

type ScenarioTable<Api extends object> = {
  // `extends infer T ? ...` makes the key filter distributive; a plain
  // `Api[K] extends (...args) => unknown ? K : never` excludes an optional method
  // (`T | undefined`) from the table instead of requiring it.
  readonly [K in keyof Api as Api[K] extends infer T
    ? T extends (...args: never[]) => unknown ? K : never
    : never]-?: NonEmpty<Fixture<MethodOf<Api, K>>>;
};
```

Three properties are deliberate, and each was verified by compiling against a replica of
the real allowlist shape with `tsc 6.0.3` and the repository's `tsconfig.json` options:

- **`AllowlistedRouteKey`, not `(typeof FEDERATED_HTTP_ROUTES)[number]`.** Several
  allowlist members carry `timeoutMs` (proxy policy, for example
  `federatedRoutes.ts:124`). The tuple member would force fixtures to restate proxy
  timeouts and reject a correct `{method, path}` for tree navigation. The projection
  keeps the method↔path correlation and drops the policy: a pair compiles, a wrong
  method for a real path is `TS2322`, a misspelled path is `TS2820` with a `Did you
  mean` hint, and copying `timeoutMs` into a fixture is `TS2353`.
- **`kind` discriminant plus opposite `never` fields.** `kind` selects the runtime
  branch, and `httpMethod?: never` / `endpoint?: never` on the machine variant with
  `route?: never` on the gateway variant make the variants genuinely exclusive. The
  `never` fields are required, not decorative: excess-property checking only applies to
  fresh object literals, so a shared `as const` object carrying `kind: "machine"`, a
  valid `route`, **and** `httpMethod`/`endpoint` would otherwise be accepted. With them,
  that shared object is rejected (`TS2322`, `"GET"` not assignable to `never`).
- **`GatewayEndpoint` as a literal union.** `piWebUiRuntime` requests
  `api/pi-webui/runtime`, which is deliberately not in the allowlist, so it cannot
  satisfy a `route` declaration (`TS2322`). Its variant is bounded to a closed set of
  known gateway endpoints instead of an open `string`, and a machine-addressed URL such
  as `api/machines/remote-a/sessions/s%201/pin` is not assignable to it — so a machine
  method cannot dodge the allowlist by being declared gateway-shaped.

### The runner

Fixtures run **sequentially**, each with a fresh baseline: the runner records the
`fetch` call index before a fixture and reads only calls appended after it. The existing
test issues its calls concurrently through one shared mock
(`federatedRouteContract.test.ts:129`), which cannot attribute overlapping requests.

**The runner performs the call; the fixture only supplies arguments.** Earlier revisions
handed the fixture a callback, which could not prove *provenance*: a fixture could catch
a pre-fetch rejection (for example `utilityModelsApi.save` with a session-only context
throws inside validation before any `fetch`, `src/client/src/api/clients.ts:317`) and
then call an unrelated method that requests an allowlisted route, satisfying both a
counter and a route check while never exercising the assigned method. With
`args: (machineId) => ParamsOf<M>` a fixture has no place to invoke an API *during the
invocation*: the runner is the caller, so a request observed in that interval is
attributable to it, subject to the purity caveat below. `ParamsOf<M>` is
`Parameters<M>`, so a fixture cannot hand over a sibling method either (`TS2322`), and
trailing optional parameters may be omitted.

Per fixture the runner runs two phases and asserts:

0. **No synchronously observable request while the arguments were built.** The runner
   freezes each client API namespace for the duration of the run, so a fixture cannot
   reassign `sessionsApi.pin`. It then records the `fetch` baseline, evaluates
   `args(machineId)`, and requires the `fetch` count to be unchanged. A builder that
   issues its own request directly — the counterexample that defeated revision 7 — fails
   here. A builder that *schedules* one (`queueMicrotask`, `setTimeout`, a promise
   callback) is not caught by this phase; that is part of the purity blind spot below.
1. **Exactly one `fetch` call** was attributed to the invocation itself. Zero means the
   method rejected before transport — a failure, and a different outcome from a
   rejection *after* a fetch, which passes because the request under assertion was
   observed. Every successful request-producing branch in the classified modules issues
   one `fetch`; the runner reports the count rather than assuming it.
2. **The observed call matches the declaration**, by variant:
   - machine: the request method equals `route.method`, its path matches `route.path`
     under a **strict** segment matcher, and the declared pattern is
     the **most specific** allowlist pattern matching that request (fewest `:param`
     segments). The tie-break matters: `POST /sessions/bulk/archive` is matched by both
     the literal allowlist entry and `/sessions/:sessionId/archive`, so without it an
     `archiveMany` fixture could declare the parameterised pattern of a different
     registered route and still pass. With it, the declaration must be the route that
     actually matches, and a mismatch reports every overlapping pattern.

     The matcher is stricter than the test's existing `pathMatchesPattern`
     (`federatedRouteContract.test.ts:323`), which drops empty segments and therefore
     accepts `//sessions/s%201/pin`, `/sessions//s%201/pin`, and
     `/sessions/s%201/pin/` as matches for `/sessions/:sessionId/pin` — paths the
     installed router rejects with a 404. The runner keeps empty segments significant and
     requires the same segment count, so a malformed path cannot satisfy the route
     assertion.

     Measured against the current allowlist: of the 123 exported entries (118 direct
     plus the five spread `WORKSPACE_TASKS_FEDERATED_HTTP_ROUTES`), exactly one
     observation is matched by more than one pattern — `POST /sessions/bulk/archive`,
     matched by the literal entry and by `/sessions/:sessionId/archive` — and the
     most-specific rule resolves it uniquely. There is no equal-specificity tie; if a
     future entry creates one, the assertion fails and names the tied patterns rather
     than choosing.
   - gateway: the fixture's identity must appear in the closed
     `GATEWAY_ADDRESSED_METHODS` map (below); the request must not be machine-addressed
     (no `/api/machines/` segment); and it must equal the declared endpoint after the
     same base resolution the client uses. The contract test runs under a nested base
     (`document.baseURI = https://pi.example.test/nested/pi-webui/`,
     `federatedRouteContract.test.ts:124-125`), so `api/pi-webui/runtime` resolves to
     `https://pi.example.test/nested/pi-webui/api/pi-webui/runtime` and is compared
     there, not as a bare pathname.

```ts
const GATEWAY_ADDRESSED_METHODS = { piWebUiApi: ["piWebUiRuntime"] } as const;
```

The map is the runtime half of the gateway rule: a `gateway` fixture is legal only for
an identity listed there, and a listed identity must use the `gateway` variant. A future
genuinely gateway-addressed method is added here deliberately, in the same change that
extends `GatewayEndpoint`.

The runner holds its unsafe assertions in two small helpers plus the one call site, each
with a comment naming the invariant that justifies it: `tableRows(table)` yields
`[methodKey, fixtures]` pairs, `methodAt(api, key)` returns the method for that same
key, and the invocation site spreads `ParamsOf<M>` back into the typed method. TypeScript
cannot iterate a mapped type while preserving the key↔method correlation, so that is
where the casts live. Any additional cast must document its invariant the same way.

### The module inventory

The machine-scoped modules are listed explicitly, one line each:

```ts
const MACHINE_SCOPED_CLIENT_APIS = {
  sessionsApi, projectsApi, workspacesApi, terminalsApi, filesApi, gitApi,
  activityApi, piWebUiApi, configApi, modelsConfigApi, modelTiersApi,
  utilityModelsApi, skillsConfigApi, piPackagesApi, piPackagePluginsApi,
  memoryApi, learnedSkillsApi, pluginsApi, recentProjectsApi, workspaceTasksApi,
} as const;
```

`piWebUiApi.piWebUiRuntime` stays in `piWebUiApi`'s table and uses the gateway variant,
so it is covered by completeness rather than exempted.

`machinesApi`, `ttsApi`, and `speechInputApi` are gateway-local and have no table:
machine registration happens on the gateway you are talking to, and the speech boundary
is host-served. They are excluded by declaration, not by accident.

### Scope of the guard's claim

The guard is bounded deliberately, and this section is part of the contract.

**It guarantees:** every function-valued member of every listed module has at least one
fixture (compile time); no fixture list is empty (compile time and runtime); every
machine fixture declares a real allowlist member with the matching method (compile
time); the client API namespaces are frozen during the run; and, for every executed
fixture, no `fetch` occurs while the arguments are built, the runner then invokes the
assigned method, exactly one `fetch` occurs during that invocation, and it matches the
declared route as the most specific allowlist pattern (strict segment matching) or the
declared closed gateway endpoint.

**Fixture purity is a review obligation, not a guarantee.** A fixture is arbitrary code,
so no in-process harness can prove that the observed request came from the assigned
method rather than from a side effect. Three variants exist, and only the first two are
closed mechanically:

| Variant | Status |
| --- | --- |
| Reassigning an exported API object (`sessionsApi.pin = …`) | **closed** — namespaces are frozen for the run |
| A builder issuing its request synchronously | **closed** — phase 0 requires an unchanged `fetch` count |
| A side effect scheduled to run during the invocation, for example a builder that queues a call via `queueMicrotask` while the argument object's `toJSON` getter throws so the assigned method never reaches `fetch` | **open** — indistinguishable in-process from real work |

The open variant is why the guarantee above is phrased as observation and attribution
rather than proof. Reviewers must confirm that a fixture only builds arguments and does
not schedule work; that is the single review-checked rule. A harness that could enforce
purity — isolating fixtures in a sandbox process — is out of scope for this fix, and two
independent reviews concluded that calling this proportionate is acceptable once the
claim is stated as a review-bounded contract.

### Why the guard stays in this change

Review 4 recommended cutting the guard into a separate change; review 5 recommended
keeping it once its contract was corrected. It stays, because the user approved a scope
that includes preventing the recurrence, and this bug is the second time the same
omission shipped — project pinning got its two allowlist entries while session pinning
did not. The machinery is deliberately small: a fixture table stated in the same shape
the allowlist uses, plus one sequential runner that performs each call itself. The
ownership map, `SHARED_ROUTES`, the query/body DSL, the invocation counter, and the
export-namespace/facade discovery from earlier revisions are all gone.

### Data and control flow

Unchanged. `pin`/`unpin` on the owning runtime mutate `SessionMetadataStore` inside
`runSessionOrderMutation` and return the updated `SessionInfo`; the gateway forwards
method, encoded path, JSON body, and status. The client parses with `parseSessionInfo`
and calls `replaceSession`. Federation adds no caching, no retry, and no locking:
`reorder`, which shares the same mutation path, is already federated this way.

### Error behavior and compatibility

Federation behavior is inherited from `machineProxyRoutes` and unchanged:

- unknown machine id → `404 { error: "Machine not found" }`
- remote unreachable → `502`, remote timeout → `504`, both with `machineId` and `detail`
- a remote 4xx/5xx status and body are forwarded verbatim

**There is no enforced runtime version floor.** `MachineService.add`
(`src/server/machines/machineService.ts:44-50`) validates a name and a base URL only,
and neither the client nor the gateway gates pinning on a capability or a version. An
older remote is therefore reachable in principle, and it would answer
`404 API route not found` from its own gateway.

That case is accepted and specified rather than assumed away: the remote's 404 is
forwarded verbatim, the client surfaces it as the same `HttpRequestError`, and the
behavior is covered by a test that a remote `404 { error: "API route not found" }` passes
through with status and body intact. No capability flag is added — it would add a state
the client cannot currently distinguish from any other remote 404, and the fix for an
outdated remote is to update it.

### Non-goals

- No UI change. The star toggle and the Pin/Unpin menu item already render for remote
  sessions; they fail only at the request. No mockups are needed.
- No capability flag, no settings, no migration.
- No reverse check that each allowlisted path resolves to a real server route. Fastify's
  `hasRoute` requires identical parameter names and `printRoutes` parsing is brittle,
  while the failure it would catch (server route deleted, allowlist kept) is not the
  reported defect.
- No federation of `ttsApi`, `speechInputApi`, or `machinesApi`.

## Testing

Fail first, then pass, then prove every assertion is falsifiable.

1. **Red.** The failure is a compile error, not a test failure, so the red command is
   `npm run typecheck`. Writing the five fixtures before their allowlist entries exist
   fails with an assignability error naming each path: `TS2820` (with a `Did you mean`
   hint) for `pin`, `unpin`, and `sessions/cleanup/force`, and `TS2322` without a
   suggestion for the two `sessionId`-free `project-usage` paths. All five fail. Vitest
   transpiles without type-checking, so the runtime half cannot provide this oracle; it
   is proved falsifiable by the mutation probes below.
2. **Green.** Add the five allowlist entries; the declarations compile and the fixtures
   pass against the real client requests.
3. **Proxy forwarding**, five cases in `src/server/app.remoteProxy.test.ts`, modelled on
   the reorder case at `:448`: `pin`, `unpin`, `sessions/cleanup/force`,
   `sessions/project-usage`, `sessions/project-usage/count` — each asserting the remote
   path, the preserved JSON body, and the forwarded status and body.
4. **Remote-error passthrough:** a remote `404 { error: "API route not found" }` reaches
   the browser with the same status and body.
5. **Client response shape:** the `pin` fixture resolves with a `SessionInfo` carrying
   `pinned: true` and the `unpin` fixture with `pinned: false`, proving the forwarded
   payload still parses through `parseSessionInfo`.
6. **Mutation probes**, each applied and reverted:

   | Probe | Must fail |
   | --- | --- |
   | remove `pin` from `FEDERATED_HTTP_ROUTES` | `npm run typecheck`, assignability error naming `/sessions/:sessionId/pin` |
   | point the client at a path that does not match the declaration | request assertion, reporting observed vs declared |
   | `archiveMany` fixture declares `/sessions/:sessionId/archive` | request assertion, reporting both overlapping patterns and the most-specific rule |
   | `pin: []` | `TS2322` via `NonEmpty` |
   | fixture `args` issues any `fetch`-producing call | phase 0 assertion (requests while building arguments) |
   | fixture `args` calls an XHR-only API before returning | **not detected** — documented transport obligation |
   | client path gains a duplicate slash (`/sessions//s%201/pin`) | strict segment matcher rejects it; the test's own `pathMatchesPattern` would accept it |
   | reassign `sessionsApi.pin` from a fixture | frozen-namespace assertion |
   | builder schedules its request (`queueMicrotask`) while `toJSON` throws during the invocation | **not detected** — the open purity variant, documented above |
   | argument object whose `toJSON` getter throws while another request is issued synchronously inside the invocation | **not detected** — same open variant |
   | supply a sibling method as `args` | `TS2322` |
   | `pin` fixture carries `kind: "machine"` **and** `httpMethod`/`endpoint` via a shared `as const` object | `TS2322`, `"GET"` not assignable to `never` |
   | use a gateway endpoint as a machine `route` | `TS2322` (not an allowlist member) |
   | give a `GATEWAY_ADDRESSED_METHODS` identity a machine route (a real allowlist entry) | runtime identity check (this compiles, so the runtime half is the oracle) |
   | `piWebUiRuntime` fixture requests a different gateway path | gateway assertion |
   | add a required method to `sessionsApi` | `npm run typecheck`, `TS1360` missing table key |
   | add a machine-scoped API module and do not list it | **not detected** — documented inventory obligation |

7. **Commands.** `npm run typecheck`,
   `npm test -- --run src/client/src/api/federatedRouteContract.test.ts`,
   `npm test -- --run src/server/app.remoteProxy.test.ts`, then `npm run verify:fast`.

## Risks

- The conversion rewrites the largest block of an existing test. Each converted call
  becomes one fixture declaring the route it must request, so the diff is mechanical and
  reviewable; the filter-based `it()` blocks, the WebSocket block, and the
  image-preview direct-URL check stay untouched.
- Per-branch coverage, new-module listing, handler identity behind an overlapping
  pattern, non-fetch transport, and fixture purity are review obligations, stated above
  rather than implied. Fixture purity is the one that cannot be mechanised in-process.
- Two centralised helpers plus the invocation site hold the runner's unsafe
  assertions, each justified in place; a new cast needs its own invariant, not a copy of
  the pattern.
- `knip` and `eslint` cover `src/**/*.ts`, so the new test-support module must be
  imported by the contract test it serves and must not export anything unused.

## Documentation and release

No user-facing documentation change: `docs/machines.html` describes federated
capabilities ("projects, workspaces, sessions, files, git state, activity, terminals, Pi
package management"), not individual endpoints, and pin/unpin is already implied by
"sessions".

One patch changeset: remote session pin/unpin, Force Cleanup, and project usage
statistics no longer fail with `API route not found`.
