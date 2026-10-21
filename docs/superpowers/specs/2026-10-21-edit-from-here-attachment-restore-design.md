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
- `SessionController.editFromHere()` passes the text to
  `refreshAfterTreeNavigation()`, which calls `saveDraft(key, editorText)` and then
  `replacePromptEditorText({ text })`.
- `PromptEditor.replaceText()` sets the CodeMirror document and the text draft. Session identity
  does not change, so `willUpdate` never re-adopts the attachment draft, and the message's image
  never reaches `promptAttachmentDrafts`.
- The server route only navigates Pi's tree (`PiSessionService.editFromHere()`), and
  `ClientSessionTreeNavigateResult` carries `editorText` alone.

The image bytes are nevertheless available client-side: transcript image content normalizes to
`{ type: "image", mimeType, data }` (`src/client/src/chatMessages.ts`) and renders as a
`data:` URL. User messages with inline images persist this base64 in session JSONL, so a fix needs
no server, daemon, or wire-protocol change.

The stored image is Pi's resized copy (≤2000×2000, produced by `attachmentsToInlineImages`), not
the original file, and that must not be hidden from the user.

Files sent with "Save to `.pi-webui/attachments`" are unaffected: their mention text is part of the
prompt text and is already restored by the existing text draft.

## Accepted Behavior

1. **Restore.** "Edit from here" restores the edited message's inline images as pending composer
   chips alongside the restored text.
2. **Provenance on the chip.** A restored chip carries provenance in its `title` and `aria-label`,
   stating that it was restored from this message and may be a resized copy. No separate badge or
   visual treatment is added.
3. **Notice only on incomplete restore.** When one or more images cannot be reconstructed, the
   composer shows one attachment-level notice naming the count. A complete restore shows no notice;
   the chips are the signal.
4. **Never destroy user work.** Restored images are appended to whatever the session's draft already
   holds. Restored images whose `(mimeType, base64)` already match a pending attachment are skipped,
   so repeating the action on the same message is idempotent and cannot duplicate chips.
5. **Always inline.** Restored images deliver as inline multimodal content regardless of the saved
   attachment-delivery preference, because that is how they were originally sent.
6. **The delivery selector stays authoritative.** A user who explicitly chooses folder delivery while
   restored chips are present gets folder delivery; the forced-inline default never silently overrides
   an explicit choice.

## Approach

Three narrow, independently testable pieces.

### 1. Pure draft projection (`ChatView` boundary)

Replace `chatMessageEditText()` with a projection that returns both halves of the draft:

```ts
export interface ChatMessageEditDraft {
  /** Unchanged text semantics: text parts joined with "\n", payload untrimmed. */
  text: string;
  /** Inline images reconstructed from transcript image parts, already validated. */
  attachments: readonly ChatRestoredAttachment[];
  /** Images the transcript could not reconstruct; drives the incomplete-restore notice. */
  unrestorableImageCount: number;
}

export function chatMessageEditDraft(message: ChatLine): ChatMessageEditDraft;
```

`ChatRestoredAttachment` is `{ kind: "image"; name: string; mimeType: string; data: string;
size: number }`, the same shape `CapturedAttachment` uses for a captured image, so the composer can
adopt it through the existing capture path instead of a parallel type.

Classification reuses the shared validator (`src/shared/promptAttachments.ts`) per image part rather
than a bespoke check, so the client cannot disagree with what the server will accept on send.
`name` is derived from the MIME type (`extensionForImageMimeType`); `size` is derived from the base64
length.

**Detecting unrestorable images.** `normalizeContent()` converts an image part with missing `data` or
`mimeType` into a `{ type: "text", text: "[image]" }` placeholder, so by the time `ChatView` sees the
message the bytes are already gone. The placeholder part gains an additive
`missingImage: true` marker in the `ChatPart` union, rendering identically. The projection then counts
marked placeholders plus image parts that fail validation. This keeps detection precise instead of
string-matching the placeholder text a user could have typed themselves.

### 2. Composer restore operation (`PromptEditor`)

A single method applies text and attachments together, so they can never diverge:

```ts
replaceDraft(draft: { text: string; attachments?: readonly ChatRestoredAttachment[] }): void;
```

It performs `replaceText()`'s existing work, then for each restored attachment: skip when an
equivalent `(mimeType, data)` chip already exists, otherwise append with an id from the store
(`nextAttachmentId()`), mark it `restored: true`, and persist the draft through the active scope.
`PendingAttachment` gains the optional `restored?: true` flag; it is presentation state and is never
sent, because `currentAttachments()` maps explicitly to `PromptAttachment`.

Delivery follows from the flag rather than from mutation of the persisted preference:

```ts
// effective delivery
restoredPresent && promptAttachmentsCanUseInlineDelivery(attachments)
  ? override ?? "inline"
  : existingRule(override ?? preference, attachments)
```

The draft gains an optional `deliveryOverride`, written only when the user changes the selector while
restored chips are present, so an explicit folder choice survives a remount. `deliveryOverride` clears
with the rest of the draft on send or reset. The stored global preference is untouched by restoration.

A mixed set (a restored image plus a generic file the user attached) keeps the existing
all-or-nothing rule and therefore saves to the workspace folder with a mention. That is a documented
consequence of the current delivery model, not a regression, and it is pinned by a test.

The incomplete-restore notice reuses the draft's existing `attachmentError` channel, which already
renders next to the chips. Restoration sets it only when `unrestorableImageCount > 0`.

### 3. Restore wiring (`SessionController` → `PiWebUiApp`)

`ChatView` passes the full draft to `onEditFromHere(assistantEntryId, draft)`. `SessionController`
carries it into `refreshAfterTreeNavigation()`, which applies it **after** the authoritative
`selectSession()` refresh through a new dependency:

```ts
replacePromptEditorText?: (replacement: { machineId; sessionId; text }) => void | Promise<void>;
replacePromptEditorDraft?: (replacement: { machineId; sessionId; text; attachments; notice? }) => void | Promise<void>;
```

Ordering matters and is preserved: `saveDraft` first, `selectSession` next, draft application last, so
the restored chips are applied to the editor instance that survived the refresh. The application keeps
`replacePromptEditorText`'s existing guards (selected machine and session identity must still match)
and its error propagation into app state.

When the editor is not mounted (`PiWebUiApp.promptEditor` undefined), the app writes the restored
attachments and notice directly into the session's draft scope through the same
`PromptAttachmentDraftStore` the editor uses, so a later mount adopts them instead of losing them.

## Error Handling

- Navigation cancelled: nothing is applied, text or attachments (unchanged behavior).
- Selection changed while the request was in flight: the draft is written to the original session's
  store scope and never into the newly selected session's composer.
- Restore application failure: reported through the existing app-state error channel, exactly like a
  failed text replacement; the navigation itself is not rolled back.
- Invalid or missing image bytes: never throws; counted as unrestorable and surfaced by the notice.
- Dedupe: identical bytes already pending are skipped silently, never duplicated.

## Consequences

- The composer can hold chips whose delivery differs from the saved preference. This is visible and
  reversible through the existing selector, which remains the single authority.
- Restored images occupy memory in the app-lifetime draft store until send, removal, discard, or
  reload, matching the existing cost model for pending attachments.
- Re-sent images are the resized transcript copies. Provenance text states this; nothing claims
  byte-identical fidelity to the original file.

## Non-Goals

- Changing the session-tree (`/tree`) navigator. Its restore would need a protocol change: the client
  never receives the target entry's content parts, and after navigation its cached transcript is the
  new branch. Tracked as a follow-up, not part of this fix.
- Persisting attachment drafts across reloads; changing size limits, MIME support, or delivery modes.
- Reconstructing workspace-folder attachments; their path mention already rides in the text.
- Any server, session-daemon, or wire-protocol change. This is a client-only fix and needs only the
  web/UI autoreload path.

## Tests And Verification

Narrowest failing layer first, per repository convention:

1. Pure projection: text-only messages unchanged; one and many images restored; `missingImage`
   placeholders and invalid base64 counted; unsupported MIME excluded and counted; name/size
   derivation.
2. Composer: restore appends without disturbing existing chips; dedupe on repeat; `restored` flag
   never reaches the wire payload; forced-inline effect when all chips can inline; explicit folder
   override honored and surviving a remount; incomplete-restore notice set only when the count is
   non-zero (jsdom layer).
3. Controller: restore applied only after a successful navigation; not applied when cancelled or when
   the selection changed; editor-absent fallback writes the draft scope; failures surface as app
   state errors.
4. `ChatView` wiring: the message action passes a draft carrying attachments and text.
5. Send path: a composer holding restored chips sends inline `PromptAttachment[]` with the original
   text.

Verification: focused Vitest files, `npm run typecheck`, ESLint on changed files, then
`npm run verify:fast`. User-visible behavior change receives a patch Changeset. Documentation updates
belong in the session/message-actions and attachments documentation under `docs/`.
