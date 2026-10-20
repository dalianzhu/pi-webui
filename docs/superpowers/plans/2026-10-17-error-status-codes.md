# Display HTTP Codes in Model Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the deterministic
> subagent-driven-development controller to implement this plan task-by-task.

**Goal:** Preserve trustworthy HTTP 400-599 statuses on failed session-agent model responses and display them consistently in live and hydrated transcript error lines without changing Pi's installed dependencies, retry policy, or admission policy.

**Architecture:** Add a pure shared status metadata reader, a client-only formatter, and a server stream adapter that enriches the canonical assistant terminal message. Decorate each session-scoped `ModelRuntime.streamSimple` dispatch so foreground calls, cache-warmer refreshes, and virtual-model physical routes own independent transport observations; keep the existing rate-limit wrapper outside the agent stream. Reuse the existing JSONL, browser projection, raw history cache, and transcript normalization boundaries, adding only focused parity assertions and a Changeset.

**Tech Stack:** TypeScript, Vitest, `@earendil-works/pi-ai` 1.2.0 event streams and provider adapters, `@earendil-works/pi-agent-core` `StreamFn`, `@earendil-works/pi-coding-agent` 1.2.0 `ModelRuntime` and `CacheWarmer`, existing `SessionManager`, browser `sessionStorage`, and Changesets.

## Global Constraints

- Node `>=22.19.0` remains the runtime floor; do not use APIs newer than the repository supports.
- Add no runtime dependency, lockfile change, protocol/session version bump, data migration, or installed-package patch.
- Do not replace `globalThis.fetch`, clone or read response bodies, inspect/copy response headers, capture credentials, issue new provider requests, or change provider retry delays, retry controls, admission controls, or rate-limit accounting policy.
- The only persisted addition is the enumerable optional numeric property `piWebUiHttpStatus`, valid only for an integer in `[400, 599]`; do not declaration-merge Pi's `AssistantMessage` or add a second status property.
- Capture only session-agent model-response streams through the decorated `ModelRuntime.streamSimple` dispatch; direct `completeSimple`, `stream`, image, classifier, deferred, tool-result, settings, title, unknown/custom transport, and unrelated operations remain outside transport capture unless an already-present final structured field is read.
- Supported fetch injection is limited to `openai-completions`, `openai-responses`, `azure-openai-responses`, `anthropic-messages`, `mistral-conversations`, `pi-messages`, and `openai-codex-responses`; Google/Vertex and Bedrock receive their original options without a capture fetch.
- `pi-virtual` is a routing marker, never an injection target; invoke the original runtime with the decorated receiver so the SDK's recursive physical dispatch re-enters the decorator.
- Preserve the provider's authoritative final message, partial content, usage, diagnostics, timestamps, duration, identity, existing error text, callback references, event order, terminal reason, and terminal/result object identity; enrichment must precede the wrapper terminal push.
- Per-dispatch transport state is invocation-local and frozen at the first terminal finalization before awaiting a delayed delegate result; cache-warmer and concurrent invocations must never share it, and late observations must be inert.
- Existing browser projections must continue removing only thinking signatures. Do not expose raw response data, encode status in a URL/header/log/new event type, cache formatted chat lines, or bump the raw chat-history cache version.
- Keep `README.md`, the signed-off specification, and the approved design unchanged. Do not rewrite existing Git history; implementation commits are required. Child tasks must not mutate the PM ledger or daemon state. Add the user-facing patch Changeset with the implementation, but do not manually edit `CHANGELOG.md` or package versions.
- The runtime capture change is loaded by the long-lived session daemon. Do not restart it during implementation or tests; the handoff must instruct the user to restart `pi-webui-sessiond.service` after active sessions can be interrupted.

## Task 1: Add Shared Status Reading and Exact Client Formatting

**Implementer tier:** Advanced

**Files:**

- Create: `src/shared/modelHttpError.ts`
- Test: `src/shared/modelHttpError.test.ts`
- Create: `src/client/src/modelErrorText.ts`
- Test: `src/client/src/modelErrorText.test.ts`

**Interfaces:**

- Consumes: no repository feature code; the shared module must have no Pi SDK or runtime imports.
- Produces: `ModelHttpErrorMetadata = { piWebUiHttpStatus?: number }`, `isHttpErrorStatus(value: unknown): value is number`, `readModelHttpErrorStatus(message: unknown): number | undefined`, and `formatAssistantModelError(message: unknown): string | undefined`.
- `readModelHttpErrorStatus` reads an unknown JSON-like value defensively. It first returns a valid local `piWebUiHttpStatus`; when that field is absent or invalid and `api === "bedrock-converse-stream"`, it examines only the last diagnostic with `type === "bedrock_response_failure"` and validates `details.status`.
- `formatAssistantModelError` returns a complete system-line string only for an assistant with `stopReason === "error"`; it uses the shared reader and does not mutate or normalize the original message.

- [ ] **Step 1: Write the failing pure-contract tests**

Create table-driven tests before the implementations. Pin these shared-reader cases exactly:

```ts
expect([400, 429, 500, 599].map(isHttpErrorStatus)).toEqual([true, true, true, true]);
expect([undefined, null, "429", 0, 200, 399, 600, 429.5, Number.NaN, Infinity].map(isHttpErrorStatus))
  .toEqual([false, false, false, false, false, false, false, false, false, false]);
expect(readModelHttpErrorStatus({ piWebUiHttpStatus: 429 })).toBe(429);
expect(readModelHttpErrorStatus({ status: 429, statusCode: 429, code: 429 })).toBeUndefined();
expect(readModelHttpErrorStatus({ api: "bedrock-converse-stream", diagnostics: [
  { type: "bedrock_response_failure", details: { status: 429 } },
  { type: "bedrock_response_failure", details: {} },
] })).toBeUndefined();
expect(readModelHttpErrorStatus({ api: "bedrock-converse-stream", diagnostics: [
  { type: "provider_transport_failure", details: { status: 429 } },
] })).toBeUndefined();
expect(readModelHttpErrorStatus({ api: "bedrock-converse-stream", piWebUiHttpStatus: 503,
  diagnostics: [{ type: "bedrock_response_failure", details: { status: 400 } }] })).toBe(503);
expect(readModelHttpErrorStatus({ api: "bedrock-converse-stream", piWebUiHttpStatus: "503",
  diagnostics: [{ type: "bedrock_response_failure", details: { status: 400 } }] })).toBe(400);
```

Create formatter cases for every exact output in the specification: status 400/429/503 with ordinary descriptions; missing, non-string, and blank descriptions; no status with `terminated`; status 429 with `HTTP 429: ...`, `429: {...}`, `429 status code ...`, `OpenAI API error (429): ...`, `429 Too Many Requests: ...`, `Unknown: 429: ...`, `429 rate limit`, and `provider returned 429`; non-matches such as `request 1429 failed`, `500 tokens were requested`, and `provider returned 500` without metadata; conflicting saved status/text; invalid status values; Bedrock final diagnostic status; and non-assistant, successful, aborted, and tool-result messages returning `undefined`.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
npm test -- --run src/shared/modelHttpError.test.ts src/client/src/modelErrorText.test.ts
```

Expected: FAIL because both new modules are absent. Do not weaken the test cases to match the current formatter.

- [ ] **Step 3: Implement the shared reader and formatter**

Implement the shared module with the exact range predicate and no imports outside the standard language runtime. Use record/array guards so malformed values, arbitrary `status`/`code` properties, symbolic codes, and non-record diagnostics return `undefined`. For Bedrock, locate the last matching failure diagnostic in source order and stop there even when its status is invalid; never search an earlier matching diagnostic after the last one fails validation.

Implement the formatter with this algorithm and no JSON parsing:

```ts
export function formatAssistantModelError(message: unknown): string | undefined {
  if (getString(message, "role") !== "assistant" || getString(message, "stopReason") !== "error") return undefined;
  const detail = getString(message, "errorMessage")?.trim() || "The model returned an error.";
  const status = readModelHttpErrorStatus(message);
  if (status === undefined || explicitlyDisplaysHttpStatus(detail, status)) {
    return `Model response failed: ${detail}`;
  }
  return `Model response failed (HTTP ${String(status)}): ${detail}`;
}
```

Keep `explicitlyDisplaysHttpStatus` private. Match the selected number only with numeric boundaries and only in the approved forms: HTTP labels with optional status/code/error labels; explicit status/status-code labels; `provider returned`; a leading status token with optional reason phrase or JSON/body marker; the installed OpenAI/Azure/Mistral API-error wrappers; and a nested `number:` token after whitespace/colon when the colon is followed by whitespace, `{`, or end of text. Recognize `429 rate limit`/`429 rate-limit` with a word boundary after `limit`; do not match arbitrary `code: 429`, timestamps, request IDs, token counts, or wording-only rate-limit descriptions. Escape the decimal status before composing the regex.

- [ ] **Step 4: Run tests, typecheck, and lint for the new modules**

Run:

```bash
npm test -- --run src/shared/modelHttpError.test.ts src/client/src/modelErrorText.test.ts
npm run typecheck
npx eslint src/shared/modelHttpError.ts src/shared/modelHttpError.test.ts src/client/src/modelErrorText.ts src/client/src/modelErrorText.test.ts
```

Expected: PASS with no failures, no type errors, and no lint errors. Confirm the public exports have the exact names in the Interfaces block and that the shared module does not import `@earendil-works/*`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/modelHttpError.ts src/shared/modelHttpError.test.ts src/client/src/modelErrorText.ts src/client/src/modelErrorText.test.ts
git commit -m "feat(errors): define HTTP status metadata and formatting"
```

## Task 2: Implement the Per-Dispatch Stream Status Adapter

**Implementer tier:** Frontier

**Files:**

- Create: `src/server/sessions/modelHttpErrorStream.ts`
- Test: `src/server/sessions/modelHttpErrorStream.test.ts`

**Interfaces:**

- Consumes from Task 1: `ModelHttpErrorMetadata`, `isHttpErrorStatus`, and `readModelHttpErrorStatus` from `src/shared/modelHttpError.ts`.
- Consumes from installed packages: `StreamFn` from `@earendil-works/pi-agent-core`; `AssistantMessage`, `AssistantMessageEvent`, `AssistantMessageEventStream`, `Api`, `Context`, `Model`, `ModelRuntime`, `SimpleStreamOptions`, and `TranscriptContext` from the Pi packages.
- Produces exactly `withModelHttpErrorStatus(delegate: StreamFn): StreamFn`. Task 3 adds `withModelHttpErrorStatusRuntime(modelRuntime: ModelRuntime): ModelRuntime` in the same module after this per-stream adapter is complete.
- The wrapper returns an `AssistantMessageEventStream` immediately, pumps a synchronous or promised delegate stream without requiring event iteration by the caller, and keeps wrapper/result terminal identity. Function-wrapper memoization may preserve identity; transport/status state must remain per invocation.

- [ ] **Step 1: Write deterministic failing adapter tests**

Add typed local fixtures for assistant terminals, controllable streams, deferred promises, response-producing fetches, and streams whose iterator throws. Do not use sleeps. Cover these required sequences through `withModelHttpErrorStatus` and assert both the iterated terminal event and `await wrapper.result()`:

```text
fetch 400/429/503 -> error                         => exact status
fetch 429 -> fetch 400 -> error                   => 400
fetch 429 -> fetch 200 -> stop                    => no status
fetch 429 -> fetch 200 -> body error              => no status
fetch 200 -> body error                           => no status
fetch 429 -> next fetch rejects                   => no status
fetch rejects before a response                  => no status
fetch 429 -> invalid/non-error response          => no status
fetch 429 -> aborted terminal                    => no status
same wrapped delegate: first invocation 429, second no response => 429 / absent
concurrent A=429 and B=400, settle B first       => A=429 / B=400
concurrent A=429 and B rejects, settle A last     => A=429 / B=absent
overlapping fetches with reversed completion      => ambiguous, absent
pending first fetch then later attempt entry      => prior status clears immediately
late response after finalization                  => terminal stays unchanged
```

Assert the observer calls the supplied fetch with the original arguments and receiver, returns the exact same `Response` object, and never calls `text`, `json`, `arrayBuffer`, `clone`, `getReader`, or reads headers. Assert the caller's options object is unchanged and all non-fetch option/callback references are forwarded. Assert `onResponse` is the exact original reference and its async/throwing behavior is not replaced by the wrapper.

Assert canonical settlement with a terminal event object different from the delegate's `result()` object: the wrapper must use the authoritative result, push exactly one matching `done`/`error` event, call `end` with that same final object, and satisfy:

```ts
const terminal = await collectOneTerminal(wrapper);
const result = await wrapper.result();
expect(terminalMessage(terminal)).toBe(result);
```

Also cover a result-only consumer, an async delegate returning a stream, a stream that ends with a resolving result but no explicit terminal event, synchronous/rejected delegate creation, and an iterator that throws after emitting a partial assistant event. The last case must retain the latest partial content and existing message metadata where available; pre-start failures use the complete zero-usage synthetic assistant fallback with model identity, current timestamp, and the existing error/aborted wording convention.

Add status-source tests for escaping errors only: `statusCode: 400`, `status: 429`, `$metadata.httpStatusCode: 503`, `$response.statusCode: 502`, first numeric `statusCode: 400` winning over `status: 429`, numeric `statusCode: 200` suppressing later `status: 429`, numeric strings being ignored, and a conflicting value under `cause` being ignored. Do not traverse `cause`, parse bodies, or scan arbitrary nested values.

Add installed adapter boundary tests using synthetic fetch responses and the current Pi 1.2.0 packages: OpenAI completions/responses, Azure responses, Anthropic, Mistral, Pi messages, and Codex SSE must retain 400/429 even when the ordinary OpenAI/Anthropic failed request does not invoke `onResponse`; Codex WebSocket-style dispatch must not be forced to SSE. Use a loopback HTTP server for the Bedrock 400 diagnostic and assert the final `bedrock_response_failure.details.status` is read. Exercise Google and Vertex with a fake delegate that proves no non-default fetch is injected, an unknown API passthrough, a Pi messages 200 protocol failure with no invented HTTP code, and a 200 response whose body fails as `terminated`.

- [ ] **Step 2: Run the focused adapter tests and confirm they fail**

Run:

```bash
npm test -- --run src/server/sessions/modelHttpErrorStream.test.ts
```

Expected: FAIL because `modelHttpErrorStream.ts` does not exist. Keep the installed adapter fixtures deterministic and local; do not call real provider endpoints.

- [ ] **Step 3: Implement invocation-local capture and canonical finalization**

Implement `withModelHttpErrorStatus` with supported-API selection based on the `model.api` argument. For `pi-virtual`, pass options through unchanged and let the runtime receiver seam added in Task 3 route the call; for the seven supported physical APIs, select `options.fetch` when present, otherwise capture the current `globalThis.fetch` at invocation time. Copy options and override only `fetch`; leave `onResponse` and every other option reference intact. The observer must use the original receiver/arguments and return or reject exactly what the base fetch returns.

Use an invocation-owned state machine with an attempt counter allocated on fetch entry:

```ts
type Observation =
  | { kind: "unobserved" }
  | { kind: "pending"; attempt: number }
  | { kind: "response"; attempt: number; status: number }
  | { kind: "rejected"; attempt: number }
  | { kind: "ambiguous" };
```

On each entry, increment the attempt, clear eligible status, mark `pending`, and mark the invocation permanently `ambiguous` if another fetch is active. On response or rejection, remove that attempt from the active set; update only if it is the latest-started attempt and the invocation is not ambiguous or finalized. A response status of 200, another non-error, or an invalid status remains a response observation but yields no field. A rejected or pending latest attempt yields no field. After finalization, observer completions do nothing.

Pump the delegate immediately. On the first terminal event, freeze the observation snapshot before awaiting `delegateStream.result()`. Finalize the authoritative result using this frozen observation, then push one terminal event whose kind and reason are derived from the finalized stop reason and call `end(final)`. For a delegate that ends without a terminal event, freeze before awaiting its resolving result and synthesize the matching terminal event. Enrich only assistant `stopReason === "error"`; strip a stale local status from non-error results or when authoritative transport evidence rules it out, and never mutate provider text, content, usage, diagnostics, timestamps, duration, or identity.

Use the final-message reader only when no injected fetch ran. For an escaping delegate/iterator error with no injected fetch, inspect only the current escaping error's first numeric candidate in `statusCode`, `status`, `$metadata.httpStatusCode`, `$response.statusCode`, in that order; validate that one candidate and do not traverse `cause`. If the iterator throws after a partial, clone the latest partial as the synthetic terminal source and replace only stop reason/error text as required. Otherwise synthesize the existing complete zero-usage assistant terminal. Do not await an unresolved delegate result in the catch path.

Keep wrapper memoization separate from state, make repeated wrapping idempotent, and use the existing `createAssistantMessageEventStream` primitive so terminal `push` settles `result()` with the same object.

- [ ] **Step 4: Run adapter tests, typecheck, and lint**

Run:

```bash
npm test -- --run src/server/sessions/modelHttpErrorStream.test.ts
npm run typecheck
npx eslint src/server/sessions/modelHttpErrorStream.ts src/server/sessions/modelHttpErrorStream.test.ts
```

Expected: PASS with no failures. Specifically inspect the pending/late-completion assertions, the body/header non-consumption spies, the terminal/result identity assertion, and the installed OpenAI/Anthropic/Codex/Bedrock boundary results before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/modelHttpErrorStream.ts src/server/sessions/modelHttpErrorStream.test.ts
git commit -m "feat(errors): capture model HTTP status per stream dispatch"
```

## Task 3: Compose the Decorated Runtime with Sessions and Rate Limits

**Implementer tier:** Frontier

**Files:**

- Modify: `src/server/sessions/modelHttpErrorStream.ts:1-260`
- Modify: `src/server/sessions/piSessionService.ts:1040-1122`
- Modify: `src/server/sessions/piSessionService.rateLimits.test.ts`
- Modify: `src/server/sessions/sessionRuntimeRestore.factory.test.ts`
- Create: `src/server/sessions/modelHttpErrorRuntime.test.ts`

**Interfaces:**

- Consumes from Task 2: `withModelHttpErrorStatus(delegate: StreamFn): StreamFn` from `src/server/sessions/modelHttpErrorStream.ts`.
- Consumes existing composition: `createDefaultRuntimeFactory`, `wrapModelStream`, `UtilityModelExtensionRuntimeRefs.streamFunction`, `SessionRuntimeRestore.prepare`, and `PiWebUiAgentSessionSdk.createServices/createFromServices`.
- Produces: `withModelHttpErrorStatusRuntime(modelRuntime: ModelRuntime): ModelRuntime` in `src/server/sessions/modelHttpErrorStream.ts`, plus a session factory that passes one decorated runtime to SDK services and utility-model extension dependencies, passes the original runtime to `restore.prepare`, and leaves the existing rate-limit wrapper as the outermost wrapper around `result.session.agent.streamFunction`.
- Produces runtime behavior where direct `stream`/`completeSimple`, image/classifier, deferred, auth, refresh, and unrelated ModelRuntime methods remain bound to the original runtime and never acquire capture through this feature.

- [ ] **Step 1: Write failing runtime/factory composition tests**

Create `modelHttpErrorRuntime.test.ts` around an actual installed `ModelRuntime` with a registered synthetic provider. Assert that decorating the same runtime twice returns the same proxy and that the proxy's non-`streamSimple` methods are callable with the original receiver. Assert direct `completeSimple` and image/classifier/deferred-style entry points do not receive an observing fetch.

Register two installed virtual models: one routing to a supported physical OpenAI-style model and one routing to a Google or Vertex physical model. The supported route must re-enter the decorated physical dispatch and produce `piWebUiHttpStatus: 429`; the Google/Vertex route must reach normal dispatch with no non-default fetch and must not trigger the adapter's custom-fetch rejection. Add a failed virtual-route fixture that remains uncoded.

Use the installed public `CacheWarmer` with one request-options object shared by the foreground and warmer calls. Keep the foreground stream unresolved, return 200 for its fetch, trigger the warmer refresh with a 429, then finalize the foreground as `terminated`; both foreground terminal and result must omit the status. Repeat with foreground 429 whose finalization is delayed and warmer 200; both foreground terminal and result must retain 429. Use controlled timers/promises or the installed warmer boundary, never sleeps, disabled warming, forced transports, SDK patches, or a fake shared closure as the production implementation.

Extend the factory/rate-limit tests to cover both an omitted owner and an enabled owner. Capture the `createServices` arguments and assert its `modelRuntime` is the decorated runtime, while the restore test asserts `prepare` receives the original `testModelRuntime`. Assert `runtimeRefs.streamFunction` is the same existing composed stream function used by the agent and utility branch-summary handlers. For an admitted call, assert one delegate dispatch and one unchanged usage completion; for blocked and pre-dispatch-aborted calls, assert no `streamSimple`/fetch/status work.

- [ ] **Step 2: Run the runtime and factory tests and confirm they fail**

Run:

```bash
npm test -- --run src/server/sessions/modelHttpErrorRuntime.test.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/sessions/sessionRuntimeRestore.factory.test.ts
```

Expected: FAIL because the runtime decorator is not wired and the new runtime test file is absent. Existing rate-limit and restore expectations must remain meaningful; do not remove them to make the new assertions pass.

- [ ] **Step 3: Install the runtime proxy at the factory boundary**

At the start of the returned `createDefaultRuntimeFactory` function, construct the decorated runtime once:

```ts
const statusModelRuntime = withModelHttpErrorStatusRuntime(modelRuntime);
const services = await sdk.createServices({
  cwd,
  agentDir,
  modelRuntime: statusModelRuntime,
  resourceLoaderOptions: {
    extensionFactories: [createUtilityModelExtension({
      resolver: utilityModelResolver,
      modelRuntime: statusModelRuntime,
      refs: runtimeRefs,
      logger,
    })],
  },
});
```

Keep `restore.prepare({ ..., modelRuntime })` on the original runtime. Keep the existing `delegateStreamFunction`, conditional `wrapModelStream(modelRateLimitOwner, delegateStreamFunction)`, assignment to `result.session.agent.streamFunction`, and `runtimeRefs.streamFunction` unchanged except for importing the new runtime decorator. With no owner, the delegate remains the capture-capable SDK stream; with an owner, the limiter remains outside it.

Implement `withModelHttpErrorStatusRuntime` with a `WeakMap<ModelRuntime, ModelRuntime>` identity cache and a `Proxy`. Special-case only the `streamSimple` property. For `model.api === "pi-virtual"` and unsupported physical APIs, invoke the original `ModelRuntime.streamSimple` with the decorated proxy as `this` and unchanged options. For supported physical APIs, call `withModelHttpErrorStatus` around an invocation that applies the original method with the decorated receiver. Bind every other function property to the original runtime so the class's private state and excluded entry points remain valid.

The decorated receiver is mandatory: the installed virtual branch calls `this.streamSimple(route.model, context, routedOptions)`, so the recursive call must find the proxy's special property and capture only the selected physical route. Do not install a fetch observer at the virtual marker, do not globally wrap `fetch`, and do not pass the proxy to `restore.prepare`.

- [ ] **Step 4: Run runtime/factory tests, typecheck, and lint**

Run:

```bash
npm test -- --run src/server/sessions/modelHttpErrorRuntime.test.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/sessions/sessionRuntimeRestore.factory.test.ts
npm run typecheck
npx eslint src/server/sessions/piSessionService.ts src/server/sessions/modelHttpErrorRuntime.test.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/sessions/sessionRuntimeRestore.factory.test.ts
```

Expected: PASS with no failures. Verify the installed virtual-route and CacheWarmer scenarios both fail under a shared stream-closure design but pass with per-`streamSimple` ownership, and verify limiter admission/accounting is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions/piSessionService.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/sessions/sessionRuntimeRestore.factory.test.ts src/server/sessions/modelHttpErrorRuntime.test.ts
git commit -m "feat(sessions): compose per-dispatch model error capture"
```

## Task 4: Wire Client History Parity and Release Handoff

**Implementer tier:** Advanced

**Files:**

- Modify: `src/client/src/chatMessages.ts:1-76`
- Modify: `src/client/src/chatMessages.test.ts:1-75`
- Modify: `src/client/src/chatTranscript.test.ts`
- Modify: `src/client/src/chatHistoryCache.test.ts`
- Modify: `src/client/src/api/parsers.test.ts`
- Modify: `src/server/browserMessageProjection.test.ts`
- Modify: `src/server/sessions/modelHttpErrorStream.test.ts`
- Create: `.changeset/show-model-http-error-status.md`

**Interfaces:**

- Consumes from Task 1: `formatAssistantModelError(message: unknown): string | undefined` and `readModelHttpErrorStatus(message: unknown): number | undefined`.
- Consumes from existing client boundaries: `normalizeMessage`, `normalizeMessages`, `applyTranscriptEvent`, `parseMessagePage`, `readChatHistoryCache`, `writeChatHistoryCache`, and `projectBrowserMessage`/`projectBrowserSessionEvent`.
- Consumes from Task 2: the real `SessionManager` persistence fixture location `src/server/sessions/modelHttpErrorStream.test.ts`; the persistence assertion must run under the required focused server test command.
- Produces: one client formatter path for live `message.end`, loaded history, and raw cached messages, preserving partial output and existing `withMessageMeta` timestamp/provider/model metadata; browser history and live events retain the additive scalar while thinking signatures remain redacted only at the browser boundary.

- [ ] **Step 1: Write failing integration and parity tests**

Update `chatMessages.test.ts` so the assistant error line comes from the formatter and includes `(HTTP 429)` for a raw message carrying `piWebUiHttpStatus: 429`; preserve the existing uncoded `terminated` behavior, partial assistant content, metadata, historical coded descriptions, and malformed/200/600 status fallback. Add a live transcript test that finalizes the same partial assistant error through `applyTranscriptEvent` and compares its visible lines with `normalizeMessages([rawMessage])`.

Extend the browser projection test with a complete assistant error carrying `piWebUiHttpStatus: 429` and a thinking signature. Assert history and `message.end` JSON payloads retain the scalar, equal one another, remove only the thinking signature, and leave the stored object unchanged. Extend the parser test to prove `parseMessagePage` returns the unknown scalar unchanged.

Stub only the `sessionStorage` boundary in `chatHistoryCache.test.ts`, restore it in `finally`, and round-trip a raw page containing the coded assistant message through `writeChatHistoryCache` and `readChatHistoryCache`. Assert the raw message and `piWebUiHttpStatus` survive JSON serialization; never assert against a formatted system card or change the v2 key.

Add a real durable fixture to `modelHttpErrorStream.test.ts` using `mkdtemp`, an explicit session directory, `SessionManager.create`, `appendMessage`, `getSessionFile`, `readFile`, `SessionManager.open`, `getBranch`, `buildSessionContext`, and cleanup in `finally`. Use a complete assistant error with timestamp `1792200000000`, provider `openai`, model `example-model`, text content `partial answer`, a thinking signature, and `piWebUiHttpStatus: 429`. Assert JSONL, reopened branch/context, browser history projection, and browser `message.end` projection retain every original field except the intended browser thinking-signature removal. Compare live normalized lines, reopened-history lines, and cached-raw-history lines exactly, including `assistant partial answer` followed by `Model response failed (HTTP 429): Rate limit exceeded.`

- [ ] **Step 2: Run the focused client/server tests and confirm they fail**

Run:

```bash
npm test -- --run src/client/src/chatMessages.test.ts src/client/src/chatTranscript.test.ts src/client/src/chatHistoryCache.test.ts src/client/src/api/parsers.test.ts src/server/browserMessageProjection.test.ts src/server/sessions/modelHttpErrorStream.test.ts
```

Expected: FAIL because `chatMessages.ts` still formats every model error without status and the new parity assertions are absent. Keep existing history/cache tests and their cleanup behavior intact.

- [ ] **Step 3: Connect normalization to the shared formatter and add the Changeset**

In `chatMessages.ts`, replace only the private `assistantErrorLine` detail construction with the shared formatter:

```ts
function assistantErrorLine(message: unknown): ChatLine | undefined {
  const text = formatAssistantModelError(message);
  return text === undefined ? undefined : textMessage("system", text);
}
```

Keep `normalizeMessage`'s visible assistant content path, `textMessage("system", ...)`, and `withMessageMeta(errorLine, message)` unchanged so partial content and timestamp/model attribution remain visible. Do not add a new `ChatLine` field, HTML rendering, parser allowlist, protocol event, cache version, or projection rewrite. The existing projection and parser spreads should be proven by the tests rather than broadened.

Create the user-facing patch fragment:

```md
---
"@hyperdreamer/pi-webui": patch
---

Show known HTTP status codes on failed model responses and preserve them in saved session history.
```

Do not edit `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, or the signed-off specification.

- [ ] **Step 4: Run all focused checks and final repository verification**

Run the required focused commands serially:

```bash
npm test -- --run src/shared/modelHttpError.test.ts src/server/sessions/modelHttpErrorStream.test.ts src/server/sessions/modelHttpErrorRuntime.test.ts src/server/sessions/piSessionService.rateLimits.test.ts
npm test -- --run src/client/src/modelErrorText.test.ts src/client/src/chatMessages.test.ts src/client/src/chatTranscript.test.ts src/client/src/chatHistoryCache.test.ts src/server/browserMessageProjection.test.ts src/client/src/api/parsers.test.ts
npm run typecheck
npx eslint src/shared/modelHttpError.ts src/shared/modelHttpError.test.ts src/client/src/modelErrorText.ts src/client/src/modelErrorText.test.ts src/client/src/chatMessages.ts src/client/src/chatMessages.test.ts src/client/src/chatTranscript.test.ts src/client/src/chatHistoryCache.test.ts src/client/src/api/parsers.test.ts src/server/browserMessageProjection.test.ts src/server/sessions/modelHttpErrorStream.ts src/server/sessions/modelHttpErrorStream.test.ts src/server/sessions/modelHttpErrorRuntime.test.ts src/server/sessions/piSessionService.ts src/server/sessions/piSessionService.rateLimits.test.ts src/server/sessions/sessionRuntimeRestore.factory.test.ts
npm run verify:fast
npm run verify
```

Run `npm run verify:fast` and `npm run verify` one at a time; the latter is the serial final profile. Also run `git diff --check`, inspect that the Changeset is the only release-note artifact, and confirm no dependency, spec/design, PM-ledger, daemon, or generated changelog changes exist. Expected result: all commands pass with no failures.

The implementation handoff must state that the session capture module and factory are loaded by the long-lived daemon and activation requires, at a suitable point after active sessions are safe to interrupt:

```bash
systemctl --user restart pi-webui-sessiond.service
```

Do not execute that restart as part of implementation or verification. UI/API autoreload alone does not update capture inside an already-running session daemon.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/chatMessages.ts src/client/src/chatMessages.test.ts src/client/src/chatTranscript.test.ts src/client/src/chatHistoryCache.test.ts src/client/src/api/parsers.test.ts src/server/browserMessageProjection.test.ts src/server/sessions/modelHttpErrorStream.test.ts .changeset/show-model-http-error-status.md
git commit -m "feat(ui): display preserved model HTTP error statuses"
```
