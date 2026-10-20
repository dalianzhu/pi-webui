# Display HTTP codes in model errors: technical specification

Date: 2026-10-17

Status: Draft for independent specification review and final user sign-off. The product design and inline presentation option A are approved; this document does not authorize implementation.

Target: `refs/heads/main`, baseline `3f7e949bab02b65839359b652fcbfcb500dd2d6b`.

Package baseline: `@hyperdreamer/pi-webui` 1.26.0; installed Pi AI, Agent Core and Coding Agent 1.2.0.

## 1. Outcome and scope

A failed assistant response whose final failing request has a known HTTP error status displays:

```text
Model response failed (HTTP 429): Rate limit exceeded.
```

The status is an integer from 400 through 599. Keep the existing system-card appearance, timestamp, provider/model attribution and any partial assistant output. Live finalization and hydration of the same saved message must produce equal visible error lines.

If the provider description already explicitly displays the selected code, retain that description under the existing `Model response failed: ` prefix. Do not add another copy of the status. This is the approved design's existing-coded-text exception, specified precisely in section 6; there is no badge or additional UI surface.

An error with no trustworthy HTTP error status retains its existing description:

```text
Model response failed: terminated
```

A 200 response followed by a broken body stream is a stream failure. A rejected fetch can have no HTTP response. Neither case acquires an earlier attempt's 429. Historical uncoded errors remain uncoded; existing codes in historical provider text remain visible.

This change covers the session agent's model-response streams, including calls that use the installed shared session stream function through utility runtime references. It does not extend direct `ModelRuntime.completeSimple`, image/classifier operations, tool results, settings errors, session titles or external/custom transports that do not expose a reliable status. It adds no retry controls, configuration keys or diagnostics panel.

## 2. Evidence and design constraints

The approved [design](2026-10-17-error-status-codes-design.md) and independent design review are inputs. The new research is recorded outside the repository in the run's reports directory:

```text
/home/henry/.local/state/pi/project-manager/runs/
4074842dc9aaf003446194e3e1d1201d34aca2f4bd236012ec3be919dd6e7164/
pm-run-20261017-030352-869b50c2/reports/
```

The three lines above form one directory path. Its evidence files are:

- `design-review-2.md`: independent design verdict PASS and specification requirements.
- `provider-status-research.md`: initial SDK investigation.
- `error-status-codes-spec-evidence.md`: commands, results, source locations and limits of the new evidence.
- `error-status-codes-probes.mjs`: diagnostic executable against this worktree's installed dependencies.
- `error-status-codes-probe-results.json`: complete results, including the real persistence round trip.
- `virtual-model-route-probe.mjs`: installed-`ModelRuntime` virtual-route probe for the supported physical adapter and Google no-custom-fetch correction.

The installed OpenAI completions/responses, Azure and Anthropic adapters invoke `onResponse` after their request helper succeeds. Injected HTTP 400/429 responses did **not** invoke that hook. The Codex SSE probe converted a real synthetic 429 response into `You have hit your ChatGPT usage limit.`, losing the code from the description. An injected fetch can observe those responses without reading their bodies. Mistral, Pi messages and Codex SSE invoke their response hooks earlier, but using different capture mechanisms for these adapters is unnecessary.

The installed agent loop finalizes from `await response.result()` (`pi-agent-core/dist/agent-loop.js:271-332`). Adding a property only to an emitted event is insufficient. Pi Coding Agent persists that final message via `SessionManager.appendMessage`. The real save/reopen probe verified that an enumerable numeric additive property survives JSONL storage, reopening, branch/context reconstruction and both browser projections.

No dependency or lockfile changes, installed-package patches, global fetch replacement, response/body cloning, new body reads, new header capture, credential capture, new provider requests, retry-policy changes or admission-policy changes are permitted. Existing SDK body handling continues normally. Capture operates when rate limiting is disabled.

CodeGraph was attempted first for source navigation. This worktree has no index; the tool directed fallback source inspection without further CodeGraph calls. The evidence report records the inspected SDK documentation and exact source paths.

## 3. Representation and module boundaries

### 3.1 Additive message field

Use this single enumerable JSON property on a final assistant error message:

```ts
interface ModelHttpErrorMetadata {
  piWebUiHttpStatus?: number;
}
```

A persisted example is:

```json
{
  "role": "assistant",
  "api": "openai-codex-responses",
  "provider": "openai-codex",
  "model": "example-model",
  "content": [],
  "stopReason": "error",
  "errorMessage": "You have hit your ChatGPT usage limit.",
  "timestamp": 1792200000000,
  "piWebUiHttpStatus": 429
}
```

The example omits existing usage fields for readability; production messages retain all SDK-required fields. The property means an HTTP failure status associated with this terminal error, rather than a provider application code, WebSocket close code or retry counter.

Only a finite integer in `[400, 599]` is valid. Absence is represented by an omitted property. Do not use 0, 200, null, numeric strings, a guessed default or a second status property. The SDK's `AssistantMessage` is not modified or declaration-merged. Server code uses the local intersection `AssistantMessage & ModelHttpErrorMetadata` where needed. The optional property is additive to the existing unknown-message browser envelope and JSONL message entry; no protocol/session version bump or data migration is needed.

### 3.2 Public surfaces

| Module | Required public surface | Responsibility |
| --- | --- | --- |
| New `src/shared/modelHttpError.ts` | `ModelHttpErrorMetadata`; `isHttpErrorStatus(value: unknown): value is number`; `readModelHttpErrorStatus(message: unknown): number \| undefined` | Pure range validation and reading the local field or the known final Bedrock diagnostic. No SDK/runtime imports. |
| New `src/server/sessions/modelHttpErrorStream.ts` | `withModelHttpErrorStatus(delegate: StreamFn): StreamFn`; `withModelHttpErrorStatusRuntime(modelRuntime: ModelRuntime): ModelRuntime` | Per-invocation/per-attempt transport observation, final-message enrichment and forwarding stream settlement. The runtime decorator owns the `streamSimple` dispatch boundary so SDK auxiliary calls receive independent observation state. |
| New `src/client/src/modelErrorText.ts` | `formatAssistantModelError(message: unknown): string \| undefined` | Error eligibility, description fallback and exact inline/duplicate-code presentation. |
| Existing `src/server/sessions/piSessionService.ts` | Existing `createDefaultRuntimeFactory` signature | Decorate the session-scoped `ModelRuntime.streamSimple` boundary independently of the limiter; retain the existing composed agent stream for utility runtime references. |
| Existing `src/client/src/chatMessages.ts` | Existing `normalizeMessage`/`normalizeMessages` signatures | Have `assistantErrorLine` obtain text from the formatter, retaining `textMessage("system", text)` and `withMessageMeta` behavior. |

Keep transport policy, attempt bookkeeping, escaped-error extraction and stream pumping private to the server module. Keep text-code recognition private to the client formatter. Do not export test-only helpers or construct a provider registry/service for this change. Function-wrapper identity may be memoized with `WeakMap`/`WeakSet`; response/status state may not live there.

`readModelHttpErrorStatus` reads unknown input defensively. First use a valid `piWebUiHttpStatus`. If that is absent or invalid, and `api === "bedrock-converse-stream"`, inspect the **last** diagnostic whose `type === "bedrock_response_failure"`, and validate its `details.status`. Do not search earlier matching diagnostics when the last one's status is absent/invalid. Ignore diagnostics of other types, arbitrary `status`/`code` properties on messages, non-record containers, malformed arrays and symbolic provider codes. This allows an existing saved Bedrock failure with explicit metadata to display its saved code without rewriting history.

### 3.3 Runtime composition

The installed Coding Agent SDK retains one `requestOptions` object for both the foreground agent request and its `CacheWarmer` refresh. Therefore, do **not** install the observing fetch only on `result.session.agent.streamFunction`: that would give the foreground and an auxiliary refresh the same observation closure and could attach a refresh's 429 to a later foreground `terminated` error.

Decorate the session-scoped `ModelRuntime` at its `streamSimple` dispatch boundary before passing it to the installed SDK services. The decorator intercepts only `streamSimple`; it delegates every other runtime method to the original runtime with the original runtime as receiver. This preserves the class's private state and leaves excluded entry points untouched.

The `streamSimple` method needs a deliberate decorated-receiver seam for virtual models. The installed runtime identifies virtual catalog entries with `model.api === "pi-virtual"`; that value is a routing marker, not a physical adapter. For a virtual model, the decorator must pass the original options through without installing a fetch observer, but invoke the original `ModelRuntime.streamSimple` with the decorated runtime as its `this` receiver. The installed method then resolves the route and calls `this.streamSimple(route.model, context, routedOptions)`. That recursive call re-enters the decorator at the selected physical model. A supported physical API receives the normal per-dispatch capture wrapper; Google/Vertex, Bedrock and unknown physical APIs receive their original options. The outer SDK `lazyStream` forwards the physical stream's terminal/result, so the physical dispatch's enriched message remains canonical. Do not inject for `pi-virtual` before routing: doing so breaks virtual routes to adapters that reject a non-default custom fetch.

For a supported physical dispatch, invoke the per-stream adapter with a fresh copy of the options. Thus the foreground and cache-warmer calls may share the SDK-created options object, but they receive distinct observing fetch closures and terminal state. Virtual routing itself does not allocate capture state; the selected physical recursive dispatch does.

Conceptually, the existing factory becomes:

```ts
const statusModelRuntime = withModelHttpErrorStatusRuntime(modelRuntime);
const services = await sdk.createServices({
  cwd,
  agentDir,
  modelRuntime: statusModelRuntime,
  resourceLoaderOptions: {
    extensionFactories: [
      createUtilityModelExtension({
        modelRuntime: statusModelRuntime,
        refs: runtimeRefs,
        // existing resolver/logger fields
      }),
    ],
  },
});
// restore.prepare continues to receive the original modelRuntime.
const delegateStreamFunction = result.session.agent.streamFunction;
const streamFunction = modelRateLimitOwner === undefined
  ? delegateStreamFunction
  : wrapModelStream(modelRateLimitOwner, delegateStreamFunction);
result.session.agent.streamFunction = streamFunction;
runtimeRefs.streamFunction = streamFunction;
```

`withModelHttpErrorStatusRuntime` is idempotent: decorating the same runtime twice returns the same runtime proxy. Its `streamSimple` method uses `withModelHttpErrorStatus` internally; repeated decoration of a bare stream delegate also returns the same capture wrapper. Every supported physical `streamSimple` dispatch still gets fresh observation state. The per-stream adapter supplies an `AssistantMessageEventStream` immediately, handles either synchronous or promised delegate streams, and starts its forwarding pump independently of whether the caller iterates events or calls only `result()`.

The limiter remains outermost around the existing agent `streamFunction`: it controls admission before the decorated runtime's `streamSimple` dispatch, and accounts the enriched terminal message's unchanged usage. Local blocked/admission-aborted outcomes do not dispatch `streamSimple`, run fetch or acquire a provider status. Keep limiter accounting and wrapper tagging unchanged. Do not change `wrapModelCompletion`, intercept `completeSimple`, or add capture to image/classifier/deferred/unrelated runtime entry points. Utility runtime references continue to receive the same composed agent stream function; they do not receive a separately wrapped stream.

## 4. Capture, attempt reset and terminal settlement

### 4.1 Request options and supported fetch injection

`pi-virtual` is not a physical adapter and is never an injection target. When `model.api === "pi-virtual"`, pass the caller's options through unchanged and invoke the original runtime with the decorated receiver as required by §3.3. The installed runtime's recursive `this.streamSimple(route.model, ...)` call then selects the physical API and re-enters this rule. This is the only route-aware behavior needed at the boundary: it captures supported physical routes without giving Google/Vertex a custom fetch.

For a selected physical model, inject the observing fetch only for these installed, fetch-capable API identifiers:

```text
openai-completions
openai-responses
azure-openai-responses
anthropic-messages
mistral-conversations
pi-messages
openai-codex-responses
```

Select `options.fetch` when supplied, otherwise select the current `globalThis.fetch` at invocation time. Create a new options object overriding only `fetch` for the delegate. Do not mutate the caller's options, fetch or callback. Preserve every other property, including unknown extension properties, auth, headers, `env`, `signal`, `onPayload`, `onProviderStreamEvent`, retry values, timeout values, session/cache settings and transport selection.

The observing fetch forwards the original arguments and custom fetch receiver, returns the **same Response object**, and propagates the same thrown/rejected error. Its only response inspection is `.status`. It must not call `text`, `json`, `arrayBuffer`, `clone`, `getReader` or inspect/copy response headers, URLs or bodies. The SDK continues to own response consumption.

Leave an existing `onResponse` callback unchanged and pass the same reference to the delegate. The new boundary does not replace, invoke, suppress, await again or catch that callback. Its invocation count/order, arguments, asynchronous completion and failure behavior remain the provider's responsibility. This composes with existing observers without making them the capture source. In particular, do not install an onResponse-only fallback for an API without an attempt-start boundary.

For Bedrock, both Google APIs and unknown physical API identifiers, pass the original options through without injecting fetch. An explicit caller-supplied custom fetch on a Google path retains its existing SDK behavior; this feature does not silently remove it. An injected SDK client/custom delegate that bypasses options.fetch has no transport observation, even when it uses a known API identifier.

Codex may choose WebSocket or fall back to SSE internally. Supplying options.fetch does not change that choice. Pure WebSocket traffic produces no fetch observation; SSE attempts use the same observing fetch. Never force SSE to obtain a status.

### 4.2 Invocation-owned state

The ownership boundary in §3.3 is mandatory, not an optimization. The installed `sdk.js` calls `cacheWarmer.start({ ..., options: requestOptions })` and then `modelRuntime.streamSimple(..., requestOptions)`. The warmer later calls `modelRuntime.streamSimple` with a spread of those retained options. A fetch wrapper installed around the agent stream would therefore observe both operations. The decorated runtime must instead copy and wrap `options.fetch` separately on **each** `streamSimple` call. A foreground response that remains open while a warmer refresh returns 429 must leave the foreground invocation's later 200/`terminated` result uncoded; a warmer's successful refresh must likewise never clear a foreground 429 that is awaiting finalization.

Allocate state when the per-stream wrapper is called for a supported physical dispatch, before invoking the delegate. A virtual routing call itself passes through without capture state; its physical recursive `streamSimple` call owns the state. At minimum distinguish:

| Observation | Meaning |
| --- | --- |
| unobserved | No injected fetch has started in this invocation. |
| pending(attempt) | A new fetch has started and no response has been received. |
| response(attempt, status) | That attempt returned a response; retain the numeric value even when it is not an error status. |
| rejected(attempt) | That attempt threw/rejected without returning a response. |
| ambiguous | More than one fetch was simultaneously active inside this invocation. Transport-derived attachment is disabled for this invocation. |

Number attempts on **fetch entry**, not on response-hook execution or promise completion. At each new fetch entry, immediately replace the previous observation with pending and clear the eligible status. On response, record that attempt's response; a 200, invalid status or non-error status clears any preceding HTTP error. On rejection, record rejected and retain no previous status. Only the latest-started attempt may publish its observation. A late completion from an older attempt cannot overwrite newer state. Once the invocation settles, late observations are inert.

Installed request/retry/fallback loops inspected for the fetch-capable paths issue their model requests serially. For a custom delegate issuing overlapping fetches within one invocation, permanently mark that invocation ambiguous and do not attach a transport status. Do not guess which HTTP response caused the model error. Overlap between **different** invocations is normal and uses separate state, even for the same provider, model, delegate or session.

Provider-internal retries, Anthropic strict-tool fallback and Codex SSE fallback requests are each observed at fetch entry. A higher-level agent retry invokes the wrapper again with new state. A virtual-model outer stream shares the physical recursive stream's final message but not a separate outer observation state. No state is shared across these calls. Capture adds no request, retry, wait, timer, admission token or retry-delay override. In particular, a retry-delay rejection immediately after a 429, with no subsequent fetch, may retain that 429; a later fetch rejection may not.

### 4.3 Status selection at finalization

Apply enrichment only to `role === "assistant"` with `stopReason === "error"`. Successful, length-limited, tool-use and aborted terminal messages get no new status. Strip an existing local `piWebUiHttpStatus` from non-error results or where current transport evidence rules it out; preserve the rest of the message. Do not mutate the provider's description, content, usage, stop reason, model identity, timestamps, duration or diagnostics.

Choose the additive field as follows:

1. If at least one injected fetch ran in this invocation, the observation is authoritative. Attach its final response status only if it is a valid 400–599 integer and the observation is neither pending, rejected nor ambiguous. A last response of 200 or an invalid/non-error status means **no field**. Do not fall back to an earlier response, hook, SDK cause, stale message field or earlier diagnostic.
2. If no injected fetch ran, use a valid final-message status from `readModelHttpErrorStatus`. Bedrock uses its terminal failure diagnostic rather than remembered response-hook state. A final Bedrock diagnostic without status yields no code, even if an earlier response hook saw 429.
3. If the delegate/iterator itself throws rather than returning a terminal assistant error, and no authoritative fetch observation exists, inspect that **current escaping error** for known SDK status fields. In order, use the first numeric candidate from `statusCode`, `status`, `$metadata.httpStatusCode`, `$response.statusCode`, then validate it. An explicit numeric 200/600/NaN in the first numeric slot yields no code; do not fall through it to a conflicting later slot. Non-numeric slots are skipped. Do not traverse `cause`, parse JSON bodies, scan arbitrary nested values or map an error name to a number.
4. Otherwise omit the field. Provider text remains untouched and can already display an explicit code; server capture never mines descriptions or bodies for a replacement status.

An invalid local field is removed when preparing a terminal result; a valid final Bedrock diagnostic may still supply the code under rule 2. Browser formatting independently ignores malformed saved fields. The only persisted addition is the validated number.

### 4.4 One canonical final message

Forward nonterminal events in order with their existing partial payloads. On the first delegate terminal event, obtain the delegate's authoritative `result()` and enrich **that final message**. Use the same finalized object for the forwarded terminal payload and the wrapper's `result()`:

```text
wrapper terminal.error/message === await wrapper.result()
```

For a compliant delegate, preserve terminal event kind/reason. Its final stop reason determines whether the event is `done` or `error` if an unusual delegate supplies inconsistent event/result objects. Retain terminal reason corresponding to that final stop reason. Do not enrich only a temporary event clone or settle result with the original unmodified message. The outer SDK event-stream primitive resolves result as soon as a terminal is pushed; enrichment must precede that push. Call `end(finalMessage)` with the same object after pushing the terminal. Settle at most once.

A valid stream ending via `end(finalMessage)` without an explicit terminal event is finalized from its resolving result and given one matching wrapper terminal event. As with the installed SDK contract, a delegate must resolve its result when it ends; an invalid delegate that never settles result is not assigned a fabricated timeout by this feature.

If delegate creation, promised delegate resolution or iteration throws, synthesize a complete SDK-compatible assistant terminal using the existing wrapper convention: model identity from the call, empty content, zero usage/cost, current timestamp and `Error.message` or `String(error)`. Use `aborted` when the invocation signal is aborted, otherwise `error`; only the latter is eligible for status selection. Do not wait on a broken delegate's potentially unresolved result in this catch path. The outer limiter still completes exactly one dispatched call. This translation does not rethrow a network exception through the rate limiter and lose its structured status.

## 5. Persistence, daemon and browser transport

The data path is:

```text
provider fetch/final diagnostic → capture wrapper's canonical final message
→ optional rate-limit wrapper → agent response.result()
→ message_end → AgentSession → SessionManager.appendMessage
→ JSONL → SessionManager.open/getBranch → historyMessages
→ browser projection + JSON HTTP history / WebSocket message.end
→ raw browser history cache → shared message normalizer → system card
```

The real probe used a complete synthetic assistant message with partial content and `piWebUiHttpStatus: 429`. `SessionManager.create`, `appendMessage`, on-disk JSONL parsing, `SessionManager.open`, `getBranch` and `buildSessionContext` all retained that field and every other original message value. Passing the reopened message through the actual history and event browser projections preserved the field; their JSON message payloads were equal. Thinking signatures were removed only in the browser projection. See the evidence report and result JSON for the assertions and exact command.

The implementation must keep these existing boundaries:

- `piSessionService.ts::historyMessages` returns the saved assistant message from the selected branch. It must not reconstruct an allowlist that drops the property.
- The daemon/session event mapping creates `message.end` with that message. Any JSON daemon/proxy forwarding must preserve the unknown message object. No status is encoded into a new protocol event, URL, header or log.
- `browserMessageProjection.ts` retains the optional scalar while keeping its existing thinking-signature redaction. No new message body/header data is exposed by capture.
- `sessionRoutes.ts` and the realtime event hub serialize the projected message. `SessionUiEvent`'s existing `message?: unknown` and `MessagePage.messages: unknown[]` remain sufficient.
- The client message-page parser retains unknown message fields. `chatHistoryCache.ts` stores **raw** messages as JSON under its existing v2 key and 30-minute TTL. Preserve that format; do not cache the formatted system card or bump the cache version for an optional scalar.
- `chatTranscript.ts` normalizes final `message.end` through the same `normalizeMessage` path as loaded history. Error finalization preserves partial content and follows it with one system error line.

No broad transport/cache refactor is required. If existing boundaries already preserve the property, add focused assertions rather than unrelated production edits. Client code validates unknown values at the formatter/shared-reader boundary; invalid saved data never breaks history loading. Existing clients ignore the new field, and new clients still display messages from old daemons without it. Reconnecting to an old cached uncoded message cannot reconstruct missing status. Existing saved Bedrock diagnostics and coded provider descriptions can supply only the information actually stored in them.

## 6. Formatter contract and exact presentation

`formatAssistantModelError(message)` returns undefined unless the raw message is an assistant with `stopReason === "error"`. A tool result, user/system message, successful assistant or aborted assistant returns undefined even if it contains `errorMessage` or status-shaped properties.

For eligible messages, take a string `errorMessage`, trim its outer whitespace, and use `The model returned an error.` if it is missing, non-string or empty. Preserve the rest of the description, including provider prefixes, punctuation, internal whitespace and existing truncation markers. Obtain the selected status with `readModelHttpErrorStatus`; the local field has priority over a saved Bedrock diagnostic.

The exact formatting rule is:

| Selected status | Description explicitly contains that same HTTP code | Text |
| --- | --- | --- |
| none | any | `Model response failed: ${detail}` |
| valid code | yes | `Model response failed: ${detail}` |
| valid code | no | `Model response failed (HTTP ${code}): ${detail}` |

Thus new uncoded descriptions get option A, and existing coded descriptions stay intact without another status label. Do not remove or rewrite a provider's code/prefix to canonicalize it. Historical strings are displayed as saved, including their explicit codes, without parsing them into new persisted metadata. No arbitrary text is converted into a new HTTP number.

For duplicate suppression, the candidate number is already validated; recognition only asks whether the **same** number is explicitly displayed as an HTTP status. Use case-insensitive matching with numeric boundaries (never match 429 inside 1429). These forms are recognized:

1. An `HTTP` label with optional `status`, `status code`, `code` or `error`, optional colon/equals separator and horizontal whitespace, followed by the selected number: `HTTP 429`, `HTTP status: 429`, `HTTP error 429`.
2. An explicit `status` or `status code` label followed by that number, or `provider returned 429` / `provider returned HTTP 429`. These phrases may appear within provider detail.
3. A status token at the start of the description: `429: ...`, `429 status code ...`, `429 {…}`, `429 : ...`, or `429 <reason phrase>: ...`. The reason-phrase form requires one or more ASCII words separated by spaces/hyphens and a following colon; it covers `429 Too Many Requests: ...`. The existing `429 rate limit` / `429 rate-limit` form is also recognized, with a word boundary after `limit`. A bare `500 tokens` is not a recognized HTTP status.
4. An installed provider wrapper `OpenAI API error (429): ...`, `Azure OpenAI API error (429): ...`, or `Mistral API error (429): ...`.
5. A nested `429: ` token after whitespace/colon, as in `Unknown: 429: {…}` or `Server requested … . 429: {…}`, provided the colon is followed by whitespace, an opening JSON brace or end of text. Do not match timestamp/digit continuations such as `429:12`.

These rules do not parse JSON values, infer 429 from wording alone, recognize general `code: 429` application codes, inspect `rawStopReason`, or interpret WebSocket close codes. Numeric tokens mentioned as model names, token counts or request IDs are not codes.

If a valid local field is 429 and the detail explicitly says HTTP 400, the field still selects 429. Show `Model response failed (HTTP 429): HTTP 400: Invalid request.` Preserve the conflicting provider text; do not silently rewrite it or select 400. If the detail also explicitly contains the selected 429, suppress the extra header under the normal duplicate rule. The runtime's stronger transport evidence takes precedence when producing the saved local field.

Malformed status metadata is ignored. It never becomes a label or a reason to suppress a valid selected code. Original provider text remains visible in all cases. Use the existing text part renderer; do not add HTML interpretation or a new ChatLine metadata field.

## 7. Provider and transport coverage

Coverage is tied to the installed Pi 1.2.0 adapter implementation, not the provider name alone. OpenAI-compatible services using a supported API and honoring its injected fetch receive that API's coverage. SDK upgrades require rechecking the adapter seam before broadening claims.

| Adapter/transport | Trustworthy source | Coverage and limit |
| --- | --- | --- |
| `openai-completions` | Each injected fetch response | Includes failed 400/429 requests before onResponse; later retries reset state. Compatible endpoints follow this path. |
| `openai-responses` | Each injected fetch response | Same; existing `OpenAI API error (N)` strings retain their code without duplication. |
| `azure-openai-responses` | Each injected fetch response | Same; Azure configuration/auth and retry options remain intact. |
| `anthropic-messages` | Each injected fetch response | Ordinary, OAuth, Copilot and federation client construction passes fetch. Reset applies to strict-tool request fallback as well as retries. An external supplied SDK client may bypass this fetch. |
| `mistral-conversations` | Injected fetch response | Captures errors independently of its hook and existing `Mistral API error (N)` string. |
| `pi-messages` HTTP/SSE | Injected **outer** HTTP response | Captures gateway 4xx/5xx. A 200 protocol stream error does not imply a 4xx/5xx. The installed converter does not carry arbitrary upstream terminal properties, so upstream model statuses discarded by that protocol cannot be recovered. |
| `openai-codex-responses`, SSE | Each injected fetch response | Captures real HTTP status despite friendly text losing it. Internal retries reset state. |
| Codex WebSocket or cached WebSocket | No fetch HTTP capture | Keep provider text; no conversion of close/error codes to HTTP. A genuine final additive field can still be read. If the provider falls back to SSE, only the subsequent SSE attempts supply capture evidence. Never change transport selection. |
| `bedrock-converse-stream` | Last final `bedrock_response_failure.details.status` | Derived by the installed adapter from the caught exception's `$metadata.httpStatusCode`. Verified with a real loopback 400. No injection into Smithy transport and no hook-status cache. A 200 stream exception lacking HTTP error metadata stays uncoded. |
| `google-generative-ai`, `google-vertex` | Existing final local field, if supplied; existing description | Both reject non-default custom fetch. Do not inject it. Their SDK errors may have numeric `.status`, but normal adapters catch/format errors before this seam; a discarded code cannot be recovered. Already-coded descriptions remain visible verbatim. |
| `pi-virtual` routed to a physical model | The selected physical adapter's source | Never inject at the `pi-virtual` routing marker. Re-enter the decorated `streamSimple` boundary for the physical route: supported fetch adapters receive capture, while Google/Vertex, Bedrock and unknown APIs retain original options. Failed routing remains uncoded unless the final escaping error supplies an explicit status. |
| Unknown API/custom extension, faux provider | Existing final local field, or current escaping error's explicit SDK status | No fetch is injected. No promise of observing internal transports, SDK clients, auth refresh requests or failures whose status has already been discarded. |

Every row retains the uncoded fallback. An `onResponse` callback is not proof that every failed attempt was observed. A successful response hook, provider error name (`ThrottlingException`, `RESOURCE_EXHAUSTED`), rate-limit description or stream `terminated` cannot manufacture an HTTP failure status.

## 8. Concrete acceptance fixtures

The following fixtures are requirements for the implementation tests, rather than tests claimed to pass against a feature that has not been implemented. Use small typed fixtures and the existing SDK event-stream primitive. The external research executable supplies reproducible adapter examples; it is not a production test helper.

### 8.1 Shared validation and status sources

| Input | Expected status |
| --- | --- |
| `400`, `429`, `500`, `599` | accepted unchanged |
| `undefined`, null, `"429"`, 0, 200, 399, 600, 429.5, NaN, Infinity | rejected |
| Assistant with `piWebUiHttpStatus: 429` | 429 |
| Assistant with only generic `status: 429`, `statusCode: 429` or `code: 429` | none at shared message reader |
| Bedrock message with last failure diagnostic `{details:{status:400}}` | 400 |
| Bedrock diagnostics `[status429, latest failure without status]` | none |
| Other-API message with Bedrock-shaped diagnostic, or diagnostic type `provider_transport_failure` | none |
| Bedrock local field 503 and final diagnostic 400 | 503 |
| Invalid local field and valid final Bedrock diagnostic 400 | 400 |

For **escaping errors only**, test separate fixtures with `statusCode:400`, `status:429`, `$metadata:{httpStatusCode:503}` and `$response:{statusCode:502}`; each attaches that code when no fetch ran. `statusCode:400` plus `status:429` selects 400. `statusCode:200` plus `status:429` yields no code. Numeric strings and a prior error stored under `cause` yield no code.

### 8.2 Transport attempt and composition fixtures

Run these through `withModelHttpErrorStatus`, assert both the final event and `result()`, and retain the original terminal detail unless the fixture deliberately throws:

| Invocation sequence | Terminal | Expected local field |
| --- | --- | --- |
| fetch 400 / 429 / 503, then error | error | exact 400 / 429 / 503 |
| fetch 429 → fetch 400, then error | error | 400 |
| fetch 429 → fetch 200, valid completion | stop | absent |
| fetch 429 → fetch 200, body errors with `terminated` | error | absent |
| fetch 200, body errors with `terminated` | error | absent |
| fetch 429 → next fetch rejects with `Connection error.` | error | absent |
| first fetch rejects / delegate fails before request with no status | error | absent |
| fetch 429 → response with invalid/non-error status in a typed boundary fake | error | absent |
| fetch 429, caller aborts | aborted | absent |
| first call 429; second invocation of same wrapped function has no response | error / error | 429 / absent |
| Two concurrent calls; A gets 429, B gets 400, settle B before A | error / error | A=429, B=400 |
| Two concurrent calls; A gets 429, B rejects, settle A last | error / error | A=429, B=absent |
| Two overlapping fetches in one invocation with reversed completion order | error | absent; no older response publishes a code |
| Bedrock hook receives 429; final failure diagnostic has no status | error | absent |
| Bedrock final failure diagnostic has 400 and uncoded detail | error | 400 |

Use controlled promises for concurrency and late completion, with no sleeps. Include a pending/latest-attempt fixture so clearing occurs on **entry**, not merely when the next promise resolves. Assert no prior status is exposed after completion.

An injected custom fetch is called with the original arguments/receiver, the returned Response is identical, and body/clone/read methods are untouched by observation. Assert original options remain unchanged and every non-fetch option/callback reference is forwarded. An async `onResponse` retains its provider timing and is called exactly once where the fixture adapter calls it; a throwing callback keeps its existing failure behavior. A real installed OpenAI or Anthropic 400/429 fixture must demonstrate that capture succeeds even when the actual SDK never invokes onResponse. Include a real Codex SSE fixture with the friendly uncoded 429 message.

Test Google/Bedrock/unknown API passthrough without adding fetch. Test a pure WebSocket-style delegate that never calls fetch, and Codex-style WebSocket failure followed by SSE fetch 400, without forcing a different transport option.

Using the installed `ModelRuntime` virtual routing path, register one virtual model that routes to a supported fetch adapter and one that routes to Google or Vertex. The supported route must re-enter the decorated physical dispatch, observe a synthetic 429 and put `piWebUiHttpStatus: 429` on both its canonical terminal and `result()` message. The Google/Vertex route must pass no non-default custom fetch to the physical adapter and reach its normal dispatch behavior; it must not regress into the adapter's custom-fetch rejection. Also cover failed virtual routing as an uncoded fallback. These fixtures must prove that the decorator treats `pi-virtual` as a routing marker rather than an injection target.

Test wrapper idempotence, an async delegate returning a stream, a result-only consumer, an end-with-result stream without a terminal event, and the escaping-error path. Supply a terminal event object different from the delegate's result object and verify that the **result** is used as the canonical source. Both wrapper surfaces must reference the same finalized object, with one terminal event and unchanged content/usage/identity metadata. The canonical result must be ready without requiring the consumer to drain the wrapper's event queue.

At `createDefaultRuntimeFactory`, exercise capture with an omitted rate-limit owner and with an enabled owner. For an admitted call, assert exactly one delegate dispatch and one existing accounting completion with unchanged usage. For blocked/admission-aborted calls, assert no delegate fetch and no status. Verify utility runtime references receive the same composed stream. Existing rate-limit tests remain authoritative for queue/budget behavior.

Add a deterministic installed-boundary regression for the cache warmer: use one SDK-created request-options object; let the foreground fetch return 200 while its body/stream remains open, trigger the installed warmer refresh, let the refresh fetch return 429, then finalize the foreground as `terminated`. The foreground terminal and `result()` must both omit `piWebUiHttpStatus`; the refresh's observation must not be reused for it. The same fixture must include a foreground 429 whose finalization is deliberately delayed, followed by a warmer refresh returning 200; the foreground terminal and `result()` must retain 429. The regression must fail under the old shared-closure ownership described at the start of §4.2 and pass when `streamSimple` dispatch ownership is used. Do not disable warming, force a transport, patch the installed SDK or treat every serial use of a retained fetch as a foreground retry.

### 8.3 Exact formatter outputs

Each row is an assistant `stopReason: "error"` unless stated otherwise. Fields not shown are absent.

| Metadata / description | Expected text |
| --- | --- |
| status 400; `Invalid request.` | `Model response failed (HTTP 400): Invalid request.` |
| status 429; `Rate limit exceeded.` | `Model response failed (HTTP 429): Rate limit exceeded.` |
| status 503; `Service unavailable.` | `Model response failed (HTTP 503): Service unavailable.` |
| status 429; `You have hit your ChatGPT usage limit.` | `Model response failed (HTTP 429): You have hit your ChatGPT usage limit.` |
| status 400; missing/blank description | `Model response failed (HTTP 400): The model returned an error.` |
| no status; `terminated` | `Model response failed: terminated` |
| no status; `Rate limit exceeded.` | `Model response failed: Rate limit exceeded.` |
| no status; missing/non-string/blank description | `Model response failed: The model returned an error.` |
| status 429; `HTTP 429: Rate limit exceeded.` | `Model response failed: HTTP 429: Rate limit exceeded.` |
| status 429; `429: {"message":"Rate limit exceeded"}` | `Model response failed: 429: {"message":"Rate limit exceeded"}` |
| status 400; `400 status code (no body)` | `Model response failed: 400 status code (no body)` |
| status 429; `429 {"error":{"message":"Rate limit exceeded"}}` | `Model response failed: 429 {"error":{"message":"Rate limit exceeded"}}` |
| status 429; `OpenAI API error (429): quota exhausted` | `Model response failed: OpenAI API error (429): quota exhausted` |
| status 400; `Azure OpenAI API error (400): invalid` | `Model response failed: Azure OpenAI API error (400): invalid` |
| status 429; `Mistral API error (429): quota exhausted` | `Model response failed: Mistral API error (429): quota exhausted` |
| status 429; `429 Too Many Requests: quota exhausted` | `Model response failed: 429 Too Many Requests: quota exhausted` |
| status 429; `Unknown: 429: quota exhausted` | `Model response failed: Unknown: 429: quota exhausted` |
| status 429; `429 rate limit` | `Model response failed: 429 rate limit` |
| no status; `provider returned 500` | `Model response failed: provider returned 500` |
| status 429; `provider returned 429` | `Model response failed: provider returned 429` |
| status 429; `request 1429 failed` | `Model response failed (HTTP 429): request 1429 failed` |
| status 500; `500 tokens were requested` | `Model response failed (HTTP 500): 500 tokens were requested` |
| status 429; `HTTP 400: Invalid request.` | `Model response failed (HTTP 429): HTTP 400: Invalid request.` |
| invalid saved status `"429"`, 200 or 600; `terminated` | `Model response failed: terminated` |
| saved Bedrock final diagnostic 400; `Validation error: Invalid probe request` | `Model response failed (HTTP 400): Validation error: Invalid probe request` |
| tool result, stop success, or aborted assistant carrying status 429 | undefined; no model-error system line |

Also test case-insensitive recognized labels, trimming at the outer boundary, non-HTTP numeric strings, and malformed status/diagnostic containers. Coded historical text is preserved rather than reformatted; the existing `429 rate limit` and `provider returned 500` expectations remain valid.

### 8.4 Persistence, cache and transcript equivalence

Use one real installed `SessionManager` fixture with `mkdtemp`, explicit session directory, `appendMessage`, `getSessionFile`, `open` and cleanup in `finally`. Do not substitute an in-memory-only manager or a serialization mock for the durable assertion.

Its assistant error has status 429, detail `Rate limit exceeded.`, timestamp `1792200000000`, provider `openai`, model `example-model` and text content `partial answer`. Assert:

1. The JSONL assistant entry, reopened branch message and reopened context retain status 429 and every existing message field.
2. Browser history projection and `message.end` projection retain the scalar and continue removing thinking signatures from browser output without mutating the stored message.
3. Message-page parsing and `writeChatHistoryCache`/`readChatHistoryCache` retain the raw message and scalar through real JSON serialization. Stub only the sessionStorage boundary, and restore it afterward.
4. Live transcript finalization, normalization of reopened history and normalization of the cached raw history yield equal visible lines: assistant `partial answer`, followed by system `Model response failed (HTTP 429): Rate limit exceeded.` Both lines retain the existing timestamp/model metadata supplied by normalization.
5. An otherwise identical historical `terminated` message without a saved status stays `Model response failed: terminated`. A stored 200 or malformed property cannot be rendered as an HTTP failure.

## 9. Verification, release note and operation

The repository testing guide governs implementation verification. Keep assertions at the shared helper, stream adapter, runtime factory, message normalizer/transcript, browser projection and cache boundaries described above. Extend existing tests where appropriate; avoid a new UI harness or screenshot suite for a text-only formatter change.

Required focused commands after implementation, covering the changed boundaries, are:

```bash
npm test -- --run src/shared/modelHttpError.test.ts src/server/sessions/modelHttpErrorStream.test.ts src/server/sessions/piSessionService.rateLimits.test.ts
npm test -- --run src/client/src/modelErrorText.test.ts src/client/src/chatMessages.test.ts src/client/src/chatTranscript.test.ts src/client/src/chatHistoryCache.test.ts src/server/browserMessageProjection.test.ts
npm run typecheck
```

Keep the real save/reopen fixture in `modelHttpErrorStream.test.ts` or one of the named existing boundary files so these focused commands execute it. Run lint on touched TypeScript files as directed by the testing guide. Routine broad implementation validation uses `npm run verify:fast`; final delivery/integration requires `npm run verify` (serial test profile). Do not run full suites concurrently with other heavy tests. Run `git diff --check` and inspect documentation links. This drafting phase ran the external diagnostics; it does not claim the future acceptance tests or repository implementation suite have passed.

The implementation must add a patch Changeset for `@hyperdreamer/pi-webui` with user-facing text such as:

```md
---
"@hyperdreamer/pi-webui": patch
---

Show known HTTP status codes on failed model responses and preserve them in saved session history.
```

The Changeset belongs with the implementation. Do not manually edit generated `CHANGELOG.md`, bump package versions or add a fragment for this internal specification alone. Keep `README.md` unchanged. If operational/user troubleshooting documentation is updated during implementation, use the canonical detailed pages under `docs/` according to the documentation guide.

The runtime capture module and factory are loaded by the long-lived session daemon. After the implementation is delivered, activation requires the user to manually restart `pi-webui-sessiond.service` at a suitable point for active work:

```bash
systemctl --user restart pi-webui-sessiond.service
```

UI/API autoreload via `pi-webui-ui-dev.service` activates the formatter but cannot update capture inside a running session daemon. State this manual-restart requirement in the implementation handoff. Do not restart the daemon or interrupt active sessions while drafting, implementing or testing this change.

## 10. Review handoff

The selected approach is an additive numeric message property populated by an invocation-local stream adapter using injected fetch on verified adapters and final structured Bedrock diagnostics, then displayed through one shared client formatter. The technical capture boundary is the session-scoped `ModelRuntime.streamSimple` dispatch, which isolates foreground requests from SDK cache-warming requests while preserving the approved limiter and transport behavior. Existing coded descriptions remain intact; unavailable status stays uncoded. The SDK persistence assumption is backed by a real temporary save/reopen experiment.

The first independent specification review found and documented one high-severity ownership defect in the original agent-stream-only seam. This revision corrects that defect without changing the approved presentation, scope, retry policy, admission policy or provider coverage; the installed cache-warmer regression is now an explicit acceptance fixture. The revised artifact requires a fresh independent specification review before final user sign-off. Unobservable Google/custom/WebSocket and HTTP-200 stream statuses remain explicit coverage limits, not guessed codes. This artifact contains behavioral and interface contracts, not an implementation task plan; no production code, dependency, Git history, PM ledger or daemon state was changed for drafting.
