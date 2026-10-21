# Edit-From-Here Attachment Restore Design

**Date:** 2026-10-21

## Goal

Make **Edit from here** restore the edited user message's attachments into the composer, so the
revised prompt carries the same inputs as the original. Today the action copies text only, silently
dropping every attached image.

## Current Behavior And Defect Evidence

The edit draft is text-only at every hop:

- `ChatView.chatMessageEditText()` (`src/client/src/components/ChatView.ts`) filters
  `part.type === "text"`, and its doc comment records today's behavior as intentional:
  "image parts intentionally remain attachments only".
- The message-action callback is `onEditFromHere(assistantEntryId, editorText)`, so no attachment
  channel exists in the component contract.
- `SessionController.editFromHere()` passes the text to `refreshAfterTreeNavigation()`, which calls
  `saveDraft(key, editorText)` and then `replacePromptEditorText({ text })`.
- `PromptEditor.replaceText()` sets the CodeMirror document and the text draft. Session identity does
  not change, so `willUpdate` never re-adopts the attachment draft, and the message's image never
  reaches `promptAttachmentDrafts`.
- The server route only navigates Pi's tree (`PiSessionService.editFromHere()`), and
  `ClientSessionTreeNavigateResult` carries `editorText` alone.

The image bytes are nevertheless available client-side: transcript image content normalizes to
`{ type: "image", mimeType, data }` (`src/client/src/chatMessages.ts`) and renders as a `data:` URL.
User messages with inline images persist this base64 in session JSONL, so the fix needs no server,
daemon, or wire-protocol change.

Three properties of the current code constrain the design and are load-bearing:

1. **Attachment drafts are a separate store from text drafts.** `PromptAttachmentDraftStore` is keyed
   by `machineSessionKey` and its `readScope`/`writeScope`/`completeCapture` copy exactly
   `{ attachments, error }`. Any new draft field must be threaded through all three, or it silently
   disappears on the next read, write, capture, or scope move.
2. **The send path caps a prompt at `MAX_PROMPT_ATTACHMENTS` (16)** via `parsePromptAttachments()`.
   Appending into a populated draft can therefore make the composer unsendable.
3. **`refreshAfterTreeNavigation()` returns before invoking the editor callback** when the selected
   machine/session identity changed while the request was in flight. A restore that only lives in the
   live-editor callback is dropped exactly in that race.

The stored image is Pi's resized copy (≤2000×2000, produced by `attachmentsToInlineImages`), not the
original file, and that must not be hidden from the user.

Files sent with "Save to `.pi-webui/attachments`" are unaffected: their mention text is part of the
prompt text and is already restored by the existing text draft.

## Accepted Behavior

1. **Restore.** "Edit from here" restores the edited message's inline images as pending composer chips
   alongside the restored text.
2. **Provenance on the chip.** A restored chip carries provenance in its `title` and `aria-label`,
   stating that it was restored from this message and may be a resized copy. No separate badge or
   visual treatment is added.
3. **Notice only on incomplete restore.** When one or more images cannot be reconstructed or do not
   fit, the composer shows one attachment-level status notice naming the count and, when the
   16-attachment cap caused the omission, saying so. A complete restore shows no notice; the chips
   are the signal.
4. **Never destroy user work.** Restored images are appended to whatever the session's draft already
   holds. A restored image whose `(mimeType, base64)` matches an existing pending chip does not create
   a second chip: the existing chip is promoted in place to restored state, keeping its id and any
   explicit delivery choice. Repeating the action is idempotent.
5. **Always inline.** Restored images deliver as inline multimodal content regardless of the saved
   attachment-delivery preference, because that is how they were originally sent. A delivery override
   recorded before the chips existed is cleared by the restore, since it was chosen for a different
   attachment set; the selector visibly shows the resulting mode.
6. **The delivery selector stays authoritative after the restore.** A folder choice made while
   restored chips are present is honored and survives a remount.

## Approach

Three narrow, independently testable pieces.

### 1. Pure draft projection (`ChatView` boundary)

Replace `chatMessageEditText()` with a projection that returns both halves of the draft:

```ts
export interface ChatMessageEditDraft {
  /** Unchanged text semantics: text parts joined with "\n", payload untrimmed. */
  text: string;
  /** Inline images reconstructed from transcript image parts. */
  attachments: readonly ChatRestoredAttachment[];
  /** Images the transcript could not reconstruct; drives the incomplete-restore notice. */
  unrestorableImageCount: number;
}

export function chatMessageEditDraft(message: ChatLine): ChatMessageEditDraft;
```

`ChatRestoredAttachment` is `{ kind: "image"; name: string; mimeType: string; data: string;
size: number }`, the shape `CapturedAttachment` already uses for a captured image, so the composer
adopts it through the existing attachment model instead of a parallel type. `name` derives from
`extensionForImageMimeType`; `size` uses the existing `base64ByteLength()` helper.

**Restorability predicate.** An image part is restorable only when the MIME type is supported *and*
the payload passes a strict byte check, because a chip that the server later drops is exactly the
silent loss this fix removes. `base64Pattern` alone is too permissive: it accepts `"A"`, whose length
cannot be decoded. The projection therefore requires: non-empty payload, length a multiple of four,
padding only at the end, successful prefix decode, and image magic bytes matching the declared MIME
type (PNG, JPEG, GIF, WebP). Anything else — including a payload that base64-decodes to non-image
bytes and would make `resizeImage` return `null` server-side — is counted as unrestorable. This
predicate lives beside the shared attachment helpers so client and server agree on what an inline
image is; it does not weaken `parsePromptAttachments()`.

**Detecting unrestorable images.** `normalizeContent()` converts an image part with missing `data` or
`mimeType` into a `{ type: "text", text: "[image]" }` placeholder, so by the time `ChatView` sees the
message the bytes are already gone. The placeholder part gains an additive `missingImage: true`
marker in the `ChatPart` text variant, rendering identically. The projection counts marked
placeholders plus image parts failing the predicate. Detection is never a string match on `"[image]"`,
so a user who typed that literal text is unaffected.

### 2. Composer restore operation (`PromptEditor`)

One method applies text, chips, and notice together, so they cannot diverge:

```ts
replaceDraft(draft: { text: string; adoptAttachments?: boolean }): void;
```

- Always performs `replaceText()`'s existing work.
- When `adoptAttachments` is true, it reads the session's attachment draft from the store — the
  restored chips are already merged there by the controller (see 3) — adopts them into rendered
  state (including `restoreNotice` and `deliveryOverride`), and persists through the active scope.
  Adopting from the store rather than receiving chips directly makes the operation idempotent and
  guarantees a single source of truth whether or not a remount happened during the refresh.

**Draft model.** `PromptAttachmentDraft` gains two optional fields:

- `deliveryOverride?: PromptAttachmentDelivery` — written only when the user changes the delivery
  selector while restored chips are present, so the forced-inline default never overrides an explicit
  choice and the global preference stays untouched.
- `restoreNotice?: string` — the incomplete-restore status line, deliberately separate from `error`
  so a later paste (which clears `error`) cannot erase it.

`readScope`, `writeScope`, and `completeCapture` copy both new fields. The empty-draft rule becomes:
an entry is released only when `attachments` is empty **and** `error` and `restoreNotice` are
undefined; `deliveryOverride` alone never creates an entry. `restoreNotice` clears on send, composer
reset, and the next restore that is complete, but not on capture.

**Chips.** `PendingAttachment` gains the optional `restored?: true` presentation flag. It is never
sent, because `currentAttachments()` maps explicitly to `PromptAttachment`. A promoted existing chip
keeps its id and gains the flag.

**Delivery.** Effective delivery becomes: when any chip is restored and the whole set is
inline-deliverable, `deliveryOverride ?? "inline"`; otherwise the existing
`effectivePromptAttachmentDelivery()` rule applies. Restoration clears a pre-existing override
(accepted behavior 5). A mixed set — a restored image plus a generic file — keeps the existing
all-or-nothing rule and is saved to the workspace folder with a mention; that is a documented
consequence of the current delivery model, not a regression, and it is pinned by a test.

**Capacity.** The merge respects `MAX_PROMPT_ATTACHMENTS`: after dedupe, restored images are added only
up to the remaining capacity, and any omitted image counts as unrestorable without a separate cause
code. The composer keeps sending under the same cap, so the restore can never make the draft
unsendable.

**Accessibility.** The notice renders as `role="status"` with `aria-live="polite"`, so it is announced
rather than only visible. Chip provenance appears in the chip's `title` and in its `aria-label` and
the remove button's label, so assistive technology receives it too.

### 3. Restore wiring (`SessionController` → `PiWebUiApp`)

`ChatView` passes the whole projection to `onEditFromHere(assistantEntryId, draft)`.

`SessionController` extends its existing composer dependency instead of adding a second one, since
both paths write the same composer draft:

```ts
replacePromptEditorDraft?: (replacement: {
  machineId: string;
  sessionId: string;
  text: string;
  adoptAttachments: boolean;
}) => void | Promise<boolean>;
```

The callback returns whether it applied to the live editor. `/tree` navigation calls it with
`adoptAttachments: false` and keeps its current text-only behavior; only Edit from here sets the flag.

**Merge and fallback.** `refreshAfterTreeNavigation()` gains one draft-scoped restoration step with a
single guarded exit path:

1. `saveDraft(key, text)` (unchanged).
2. `selectSession(...)` authoritative refresh (unchanged; a remount here adopts the store draft, which
   is fine because the store is not yet mutated).
3. Ask the app to apply the draft. The app applies only while its selected machine and session still
   match, and reports `true` when it did.
4. **Fallback:** when the live apply did not happen — identity changed, the editor is unmounted, or the
   apply threw — the controller merges the restored chips, notice, and capacity accounting directly
   into the original session's draft scope through the `PromptAttachmentDraftStore` it already holds.

The fallback is a *post*-return step on purpose. Merging before the identity checks would be clobbered
by `PromptEditor.willUpdate()`, which parks the outgoing session's rendered mirror into the store when
the editor switches sessions: a mirror that predates the restore would overwrite it. Applying first
and merging only when the live apply was rejected keeps the store write last in every path, and the
`adoptAttachments` read-from-store design keeps the two paths from double-applying. This step is
specific to Edit from here; the `/tree` path passes no attachments and performs no merge.

Text and chips stay atomic: the text goes through the unchanged `saveDraft` path, and chips are merged
by the store, so a cancelled navigation still changes nothing.

## Error Handling

- Navigation cancelled: nothing is applied, text or attachments (unchanged behavior).
- Selection or machine changed while in flight: the restored chips land in the original
  machine/session scope through the fallback, never in the newly selected session's composer.
- Restore application failure: the fallback still writes the store scope, and the error is reported
  through the existing app-state error channel, exactly like a failed text replacement; the navigation
  itself is not rolled back.
- Invalid, empty, non-image, or oversized-count images: never throws; counted as unrestorable and
  surfaced by the notice.
- Dedupe: identical bytes already pending are promoted in place, never duplicated.
- Storage: a restore that would exceed 16 attachments stops at the cap instead of producing a draft the
  server rejects on send.

## Consequences

- The composer can hold chips whose delivery differs from the saved preference. This is visible and
  reversible through the existing selector, which remains the single authority after a restore.
- Restored images occupy memory in the app-lifetime draft store until send, removal, discard, or
  reload, matching the existing cost model for pending attachments.
- Re-sent images are the resized transcript copies. Provenance text states this; nothing claims
  byte-identical fidelity to the original file.
- The attachment draft store carries two more optional fields; every scope operation must agree on
  them, which the tests below pin.

## Non-Goals

- Changing the session-tree (`/tree`) navigator's restore. Its chips would need the target entry's
  content parts, which the client never receives, and after navigation its cached transcript is the new
  branch. Tracked as a follow-up, not part of this fix.
- Persisting attachment drafts across reloads; changing size limits, MIME support, or delivery modes.
- Reconstructing workspace-folder attachments; their path mention already rides in the text.
- Any server, session-daemon, or wire-protocol change. This is a client-only fix and needs only the
  web/UI autoreload path.

## Tests And Verification

Narrowest failing layer first, per `.agents/skills/testing-guide/SKILL.md`:

1. **Projection (pure).** Text-only messages unchanged; one and many images restored; text kept intact
   around interleaved image parts; `missingImage` placeholders counted; user-authored `"[image]"`
   literal not counted; malformed-but-pattern-matching payloads such as `"A"` counted; wrong magic
   bytes for the declared MIME type counted; name and byte-size derivation.
2. **Draft store (pure).** `deliveryOverride` and `restoreNotice` survive read, write, capture
   completion, and scope moves; an override-only draft creates no entry; a notice-only draft survives;
   clearing on send and reset.
3. **Composer (jsdom).** Restore adopts store chips; dedupe promotes an existing non-restored chip
   without duplicating it and keeps its id; the `restored` flag never reaches the send payload;
   forced-inline effect for restored-only sets; explicit folder override honored and surviving a
   remount; pre-restore override cleared by the restore; restore into a nearly full draft stops at 16
   and reports the omitted count; notice set only when something was omitted and cleared when a later
   restore is complete.
4. **Controller.** Restore applied after a successful navigation; not applied when cancelled; the
   fallback still writes the original scope when the selection changed to another session, another
   machine with the same session id, or the starter composer; same-session reselection during the
   action retains the restore; live-apply failure still falls back; `/tree` navigation passes no
   attachments and writes no chips.
5. **Wiring.** The message action passes a draft carrying text, attachments, and the unrestorable
   count.
6. **Send path.** Restored-only chips send inline `PromptAttachment[]` with the original text; a
   restored image plus a generic file takes the existing folder upload/reference-rewrite path.
7. **Accessibility.** The notice is exposed as a polite live status, and chip provenance is present in
   the chip and remove-button accessible names.

Verification: focused Vitest files, `npm run typecheck`, ESLint on changed files, then
`npm run verify:fast`. The user-visible behavior change receives a patch Changeset.

Documentation: extend the composer/attachment behavior reference in `docs/config.md` (the existing
canonical user-facing behavior reference, which already documents attachments and Edit from here) and
mirror the same prose in its checked-in `docs/config.html` counterpart, following
`.agents/skills/documentation-guide/SKILL.md`. No new documentation page is introduced.
