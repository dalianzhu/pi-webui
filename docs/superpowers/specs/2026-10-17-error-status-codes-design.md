# Display HTTP codes in model error messages

Date: 2026-10-17
Status: Approved by the user on 2026-10-17; display option A selected.
Delivery target: `refs/heads/main` at baseline `3f7e949bab02b65839359b652fcbfcb500dd2d6b`.

## User problem

A failed model response currently produces a system card such as:

```text
SYSTEM
Model response failed: terminated
```

The user wants errors to show their codes, for example 400 and 429, so failures can be diagnosed without guessing from a vague message. The screenshot identifies model-response system cards as the initial scope.

## Proposed behavior

Show a known HTTP failure status next to the model-error description. Preserve the provider's useful error detail and the existing timestamp/model attribution. Apply the same presentation to live messages and loaded session history.

Use only an actual HTTP error status (an integer from 400 through 599) obtained for the failing request, an explicit structured error status, or an unambiguous existing status in the provider's error text. Do not infer 429 from rate-limit wording or infer 500 from `terminated`. A dropped connection can have no HTTP error response at all; in that case retain the description without manufacturing a code. A successful HTTP 200 followed by a stream failure must not be presented as an HTTP error code.

Preserve status information early enough that it remains available after reloading the transcript. Historical messages that already contain an explicit code can display it. A historical `terminated` message with no saved status cannot acquire a code retroactively.

## Display options

### A — inline status (selected)

```text
┌─────────────────────────────────────────────────────────────┐
│ SYSTEM                         time · provider/model        │
├─────────────────────────────────────────────────────────────┤
│ Model response failed (HTTP 429): Rate limit exceeded.       │
└─────────────────────────────────────────────────────────────┘
```

For a bad request:

```text
Model response failed (HTTP 400): Invalid request.
```

This keeps the status with the explanation when users copy error text, and fits the existing system card with a small presentation change.

### B — status badge in the header

```text
┌─────────────────────────────────────────────────────────────┐
│ SYSTEM  [HTTP 429]              time · provider/model        │
├─────────────────────────────────────────────────────────────┤
│ Model response failed: Rate limit exceeded.                  │
└─────────────────────────────────────────────────────────────┘
```

The badge is easier to scan in a long transcript, but adds a new rendering contract for the card and separates the status from copied message text unless copying is extended too.

The user selected A on 2026-10-17. Implement the inline status, keeping the existing appearance for errors whose HTTP status is unavailable. B is retained here only as the reviewed alternative.

## Approaches considered

1. **Capture and preserve known status, then format it consistently — recommended.** Protects status information before provider failures become plain transcript strings, and uses one client presentation path for both live and saved messages. Request metadata stays local to its own model invocation.
2. **Change only the client formatter.** Smaller surface, but can display only codes that already survived into saved messages. This cannot improve a generic `terminated` error that lost its HTTP status earlier.
3. **Add a general diagnostic-details panel.** Could accommodate request IDs and other troubleshooting information, but adds unrelated UI and is unnecessary for displaying error codes.

## Existing boundaries and architecture

- `src/client/src/chatMessages.ts` normalizes raw messages. `assistantErrorLine()` currently reads only `errorMessage` and constructs the system-card text.
- `src/client/src/chatTranscript.ts` uses the normalization path when final live assistant messages arrive. History normalization uses the same model-error projection.
- `src/server/browserMessageProjection.ts` removes provider thinking signatures but otherwise preserves message properties. It is not currently dropping a dedicated status field.
- Pi's installed `AssistantMessage` contract contains `errorMessage` and no dedicated HTTP-status property. Its request options offer response observation and an injectable fetch function; exact adapter behavior must be pinned in the technical specification before selecting the capture seam.
- `src/server/rateLimits/modelRateLimitAdapters.ts` already wraps model streams and synthesizes errors for thrown exceptions. `createDefaultRuntimeFactory()` in `src/server/sessions/piSessionService.ts` installs that wrapper on each session runtime.

Keep the implementation proportionate: a focused status-extraction/preservation boundary and a consistent error-message formatter. Do not patch installed Pi dependencies, replace global fetch, introduce process-wide last-error state, or change retry/admission behavior to collect codes. Compose any existing request observers and preserve custom transport behavior.

A capture implementation must associate status with the final failed attempt of the same invocation. An earlier retry response must not label a later successful response or a later connection failure. Concurrent sessions must not exchange status information. Confirm which provider/transport paths expose reliable status and document the absence of status honestly elsewhere.

The technical specification will name the exact additive representation and capture seam after the display choice is approved. It must prove that the representation survives Pi persistence and browser transport, without exposing headers, credentials, or raw response bodies.

## Scope

This proposal covers failed model responses displayed in the transcript, including errors after partial assistant output and errors loaded from saved history. Existing descriptions, partial output, model attribution, and timestamps remain visible.

It does not redesign every settings dialog or tool error, introduce retry controls, map connection failures to invented HTTP statuses, or retrofit missing diagnostics into old session files.

## Acceptance criteria and verification strategy

- A model failure with a known 400, 429, or 5xx status visibly includes that exact code in the selected layout.
- Existing provider text that already includes a code is preserved without a redundant status label in the same error description.
- A generic `terminated` or connection-failure error with no known status remains readable and carries no guessed status.
- Successful responses, aborted requests, and ordinary tool results do not gain model-error labels.
- Partial assistant output is followed by the coded error rather than replaced or discarded.
- Live finalization and hydration of the same saved message produce equivalent visible errors.
- Retry and concurrent-invocation fixtures demonstrate that status belongs to the correct failing attempt.
- Focused normalizer/transcript tests and tests at the chosen runtime boundary cover these behaviors. Full repository verification runs before final delivery, following the testing guide.
- A user-facing Changeset accompanies the completed implementation. Generated `CHANGELOG.md` is left to the release workflow.

## Operational implications

The recommended capture approach is expected to touch code loaded by the session daemon. Once implemented and delivered, the user will need to manually restart `pi-webui-sessiond.service` to activate runtime capture. UI/API autoreload alone cannot activate changes inside a running session daemon. Do not restart the daemon while active sessions are working as part of design or implementation.

## Approved decisions

- Initial scope: model-error transcript cards shown in the screenshot.
- Display choice: A, inline HTTP code in `Model response failed (HTTP 429): …`.
- Preserve known status in live messages and saved history; keep an uncoded description when no HTTP error status is known.
- User approval: the user's reply `A` accepted the recommended design and selected its presentation.
