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

Three properties of the current code are load-bearing:

1. **Attachment drafts are a separate store from text drafts.** `PromptAttachmentDraftStore` is keyed
   by `machineSessionKey`; `readScope`/`writeScope`/`completeCapture` copy exactly
   `{ attachments, error }`, so any new field must be threaded through all three.
2. **The send path caps a prompt at `MAX_PROMPT_ATTACHMENTS` (16)** via `parsePromptAttachments()`,
   while `completeCapture()` appends without a cap, so appending can leave the composer unsendable.
3. **A mid-flight session or machine reselection already discards the edit draft.** The controller
   saves the restored text at the top of `refreshAfterTreeNavigation()` and returns before the editor
   callback when the selection changed; `PromptEditor.willUpdate()` then parks its stale in-memory
   draft over it. That behavior predates this feature and affects `/tree` navigation identically.

The stored image is Pi's resized copy (≤2000×2000, produced by `attachmentsToInlineImages`), not the
original file, and that must not be hidden from the user.

Files sent with "Save to `.pi-webui/attachments`" are unaffected: their mention text is part of the
prompt text and is already restored by the existing text draft.

## Scope Boundary

Restoration is guaranteed on the normal path: the message action is used while the session stays
selected. It deliberately **inherits** property 3 for the rare mid-flight reselection: nothing is
restored, exactly as the restored text is discarded today, so text and chips never disagree.

Making a composer draft survive an in-flight reselection is a separate problem that also affects the
existing out-of-band text writer in session command results (`sessionController.ts`, `saveDraft` on
`promptDraft`). It requires a park barrier or ownership token in `PromptEditor` plus revisioned text
drafts, and is recorded as a follow-up ("composer draft ownership") rather than folded into this
bugfix. A half-fix that guarded only attachments would produce the worst outcome available — restored
chips beside pre-edit text — so it is explicitly rejected here.

## Accepted Behavior

1. **Restore.** "Edit from here" restores the edited message's inline images as pending composer chips
   alongside the restored text.
2. **Provenance on the chip.** A restored chip carries provenance in its `title` and `aria-label`,
   stating that it was restored from this message and may be a resized copy.
3. **Notice only on incomplete restore.** When one or more images cannot be reconstructed or do not
   fit, the composer shows one attachment-level status notice naming the count and, when the
   16-attachment cap caused an omission, saying so. A complete restore shows no notice.
4. **Never destroy user work.** Restored images are appended to whatever the session's draft already
   holds. A restored image whose `(mimeType, base64)` matches an existing pending chip creates no
   second chip: the existing chip is promoted in place to restored state, keeping its id and the
   delivery choice attached to it.
5. **Inline by default.** Restored images deliver as inline multimodal content regardless of the saved
   attachment-delivery preference, because that is how they were originally sent. A delivery override
   recorded for an attachment set the restore does not change is preserved.
6. **The delivery selector stays authoritative.** Any folder choice made while restored chips are
   present is honored, survives a remount, and survives repeating the restore.

## Approach

### 1. Pure draft projection (`ChatView` boundary)

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
size: number }` — the shape `CapturedAttachment` already uses — so the composer adopts it through the
existing attachment model. `name` derives from `extensionForImageMimeType`; `size` uses the existing
`base64ByteLength()`.

**Restorability predicate.** `base64Pattern` is structurally too weak: it accepts `"A"`, and it accepts
a truncated payload such as `iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB` (valid PNG signature, no `IEND`) that
`attachmentsToInlineImages()` would later discard. The projection therefore requires decode-able base64
(length a multiple of four, padding only at the end, no decode error) **and** minimum structural
validation of the declared container:

- **PNG** — signature, a chunk walk with self-consistent lengths, an `IHDR`, at least one `IDAT`, and a
  terminating `IEND`.
- **JPEG** — `SOI` first, at least one `SOFn` frame header, at least one `SOS`, and `EOI` last.
- **GIF** — `GIF87a`/`GIF89a` header, at least one image descriptor, and the `0x3B` trailer.
- **WebP** — `RIFF` size consistent with the payload, `WEBP` fourcc, and at least one of `VP8 `,
  `VP8L`, or `VP8X` with a consistent chunk size.

Anything else — including marker-only shells such as signature plus `IEND` with no image data, or
`FFD8FFD9` — is counted as unrestorable. The predicate lives beside the shared attachment helpers as an
**additional** restoration check; `parsePromptAttachments()` keeps its current behavior.

**Bounded claim.** Validation proves the client can detect framing and structural incompleteness, and
that the declared MIME type matches the container. It cannot prove Pi's own decoder will accept the
pixel data, because the decoders differ. A structurally valid container with corrupt image data can
still be dropped server-side; that requires a corrupted or hand-edited session file, and it is recorded
as a known limitation instead of being covered by a stronger guarantee. The design does not claim
parity with Pi's decoder.

**Detecting unrestorable images.** `normalizeContent()` converts an image part with missing `data` or
`mimeType` into a `{ type: "text", text: "[image]" }` placeholder, so by the time `ChatView` sees the
message the bytes are gone. The placeholder part gains an additive `missingImage: true` marker in the
`ChatPart` text variant, rendering identically. The projection counts marked placeholders plus image
parts failing the predicate. Detection is never a string match on `"[image]"`, so a user who typed that
literal is unaffected.

### 2. Composer restore operation (`PromptEditor`)

```ts
replaceDraft(draft: {
  text: string;
  restored?: readonly ChatRestoredAttachment[];
  unrestorableImageCount?: number;
}): void;
```

It performs the existing text replacement, then merges `restored` into the rendered mirror through the
shared merge, composes the notice from `unrestorableImageCount` plus capacity omissions, adjusts
`deliveryOverride`, and persists through the active scope. `replaceText()` stays as the text-only entry
point used by `/tree`.

**Shared merge contract.** One pure function is the single append path for restore, capture completion,
and the starter composer's ingest:

```ts
mergePromptAttachments(existing, incoming, capacity = MAX_PROMPT_ATTACHMENTS): {
  attachments: PendingAttachment[];   // deduped, promoted, capped
  omittedForCapacity: number;
};
```

Identity is `(mimeType, data)` — `kind` is excluded, so an image restored from the transcript matches a
chip the user already captured. A match is promoted (`restored: true`) and keeps its id, and the
override attached to the set is preserved; it is never duplicated. Routing capture through the same
merge closes the cap hole that today can produce an unsendable 17-attachment draft. Announcing an
over-cap paste instead of silently exceeding the cap is a deliberate, tested change.

**Draft model.** `PromptAttachmentDraft` gains `deliveryOverride?: PromptAttachmentDelivery` and
`notice?: string`. `readScope`, `writeScope`, and `completeCapture` copy both. An entry is released only
when attachments are empty **and** `error` and `notice` are undefined; `deliveryOverride` alone never
creates an entry. `notice` clears on send and composer reset, is replaced by the next notify-worthy
event, and is independent of `error` (which capture still clears as today). The render guard becomes
"chips or error or notice", so a notice with no chips is still visible.

**Notice text.** One shared formatter produces the message for both causes, so the two writers cannot
disagree: invalid images only ("N image(s) from this message could not be restored."), capacity only
("Only 16 attachments can be sent, so N were not added."), or both in one sentence pair.

**Delivery.**
`anyRestored && promptAttachmentsCanUseInlineDelivery(set) ? deliveryOverride ?? "inline" : existingRule(...)`.
The global preference is never rewritten by a restore, and `changeDelivery()` additionally records
`deliveryOverride` in the draft when restored chips are present. A mixed set (restored image plus
generic file) keeps the existing all-or-nothing folder rule; a test pins it.

**Accessibility.** The notice renders as `role="status"` with `aria-live="polite"`. Chip provenance is
in the chip's `title` and in the chip's and remove button's accessible names.

### 3. Restore wiring (`SessionController` → `PiWebUiApp`)

`ChatView` passes the whole projection to `onEditFromHere(assistantEntryId, draft)`.

The existing composer dependency is extended rather than duplicated, because both paths write the same
draft:

```ts
replacePromptEditorDraft?: (replacement: {
  machineId: string; sessionId: string; text: string;
  restored?: readonly ChatRestoredAttachment[];
  unrestorableImageCount?: number;
}) => void | Promise<void>;
```

`/tree` navigation continues to use `replacePromptEditorText`, so its behavior and signature are
unchanged. `refreshAfterTreeNavigation()` gains one parameter for the draft and hands it to the app
callback after the authoritative refresh, under the same identity guards that protect the text today:

```ts
await this.replacePromptEditorDraft?.({ machineId, sessionId: session.id, ...draft });
```

The app callback mirrors the existing text callback — `await this.updateComplete`, recheck selected
machine and session, then call the editor method — so text and chips are applied by the same function
in the same tick. When the guards reject, nothing is restored: that is the inherited reselection
behavior in the Scope Boundary, not a new failure mode. A cancelled navigation changes nothing.

## Error Handling

- Navigation cancelled: no draft change at all.
- Mid-flight reselection: no restore, matching today's text behavior; no partial or cross-session write.
- Editor application failure: reported through the existing app-state error channel, exactly like a
  failed text replacement; navigation is not rolled back.
- Invalid, truncated, non-image, or marker-only payloads: never throw; counted, announced, never turned
  into a chip that the server would silently drop.
- Over-capacity restore or capture: stops at 16, announces the omission, and always leaves a sendable
  draft.
- Duplicate bytes: promoted in place, never duplicated.

## Consequences

- The composer can hold chips whose delivery differs from the saved preference; the selector shows and
  controls it.
- Restored images live in the app-lifetime draft store until send, removal, discard, or reload.
- Re-sent images are resized transcript copies; provenance says so.
- Capture now announces an over-cap paste instead of producing an unsendable draft.
- Two new optional draft fields require every scope operation to agree on them; store tests pin it.

## Non-Goals

- Making a composer draft survive an in-flight session or machine reselection (see Scope Boundary).
- Changing `/tree` navigation's restore; it would need the target entry's content parts on the wire.
- Persisting attachment drafts across reloads; changing size limits, MIME support, or delivery modes.
- Reconstructing workspace-folder attachments; their path mention already rides in the text.
- Proving server-side decodability; see the bounded claim in §1.
- Any server, session-daemon, or wire-protocol change. This is a client-only fix on the web/UI
  autoreload path.

## Tests And Verification

Per `.agents/skills/testing-guide/SKILL.md`, narrowest failing layer first. Fixtures use real PNG, JPEG,
GIF, and WebP bytes (existing `"QUJD"`-style fixtures are not valid images), plus corrupt variants.

1. **Projection (pure).** Text-only unchanged; one and many images restored; text intact around
   interleaved image parts; `missingImage` counted; user-authored `"[image]"` not counted;
   pattern-matching `"A"` counted; truncated, marker-only, and MIME-mismatched payloads counted for each
   format; malformed PNG chunk length and inconsistent WebP chunk size counted; name and byte size
   derived.
2. **Merge (pure).** Append; dedupe across differing `kind` with the same `(mimeType, data)`; promotion
   keeps the id; cap at 16 with `omittedForCapacity`; capacity accounting before and after dedupe; no
   over-cap result from a delayed capture or starter ingest.
3. **Draft store (pure).** Both new fields survive read, write, capture completion, and scope moves;
   override-only creates no entry; notice-only survives; `notice` survives a capture that clears
   `error`; capture records a capacity notice.
4. **Composer (jsdom).** Restore into an empty store commits rendered and stored chips and sets the
   notice only when something was omitted; notice-only render is visible with no chips; repeated restore
   after choosing folder keeps folder delivery and the same chip; pre-restore override cleared only when
   the chip set changes; restore into a nearly full draft stops at 16 and reports; a later complete
   restore clears the notice.
5. **Controller.** Draft applied after a successful navigation; nothing applied on cancel or after an
   identity change; `/tree` passes text only and writes no chips.
6. **Wiring and send.** The message action passes text, attachments, and the count; restored-only chips
   send inline with the original text; restored image plus generic file takes the folder
   upload/reference-rewrite path.
7. **Accessibility.** Notice exposed as a polite status while an `error` is present; chip provenance
   present in accessible names.

Falsifiability: each core test must fail when the projection's structural validation, the merge's
promotion or cap, the notice composition, or the delivery rule is removed; callback-call assertions
alone do not count.

Verification: focused Vitest files, `npm run typecheck`, ESLint on changed files, then
`npm run verify:fast`. A patch Changeset accompanies the user-visible fix.

Documentation: add a dedicated **Edit from here attachment behavior** subsection to `docs/config.md` —
its existing Edit from here text covers model selection only — and mirror the same prose in
`docs/config.html`, following `.agents/skills/documentation-guide/SKILL.md`. No new page is introduced.
