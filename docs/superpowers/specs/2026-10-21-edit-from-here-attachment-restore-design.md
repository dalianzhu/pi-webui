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

Five properties of the current code are load-bearing for this design:

1. **Attachment drafts are a separate store from text drafts.** `PromptAttachmentDraftStore` is keyed
   by `machineSessionKey`; `readScope`/`writeScope`/`completeCapture` copy exactly
   `{ attachments, error }`, so any new field must be threaded through all three.
2. **Two writers already touch one draft.** While the editor is mounted and its `machineId`/
   `sessionId` match a key, the editor's rendered mirror is the live value and persists through the
   scope; on a session change `willUpdate()` *parks* the outgoing mirror into that key
   (`saveDraft(previousKey, this.draft)` and `previousScope.write(...)`). Any out-of-band writer must
   therefore have a defined ownership rule, not just an ordering.
3. **`activeAttachmentScope()` returns an existing handle without comparing it to the current key**,
   so an operation must verify identity itself rather than trusting the handle.
4. **The send path caps a prompt at `MAX_PROMPT_ATTACHMENTS` (16)** via `parsePromptAttachments()`, and
   capture completion appends without any cap, so appending can leave the composer unsendable.
5. **`refreshAfterTreeNavigation()` returns before invoking the editor callback** when the selected
   machine/session identity changed in flight.

The stored image is Pi's resized copy (≤2000×2000, produced by `attachmentsToInlineImages`), not the
original file, and that must not be hidden from the user.

Files sent with "Save to `.pi-webui/attachments`" are unaffected: their mention text is part of the
prompt text and is already restored by the existing text draft.

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
   second chip: the existing chip is promoted in place to restored state, keeping its id and any
   delivery choice attached to it.
5. **Inline by default.** Restored images deliver as inline multimodal content regardless of the saved
   attachment-delivery preference, because that is how they were originally sent. A delivery override
   recorded for an attachment set that the restore does not change is preserved (see §2).
6. **The delivery selector stays authoritative.** Any folder choice made while restored chips are
   present is honored, survives a remount, and survives repeating the restore.

## Approach

### Ownership and commit rule (applies to §2 and §3)

For one `machineSessionKey`, exactly one writer commits at a time:

- **Editor writer.** When a mounted editor's own `machineId`/`sessionId` equal the key, the editor owns
  the draft: it merges into its rendered mirror and persists through the scope.
- **Controller writer.** Otherwise — the editor is unmounted, or its own identity has already moved to
  another session or machine — the controller commits through the same store scope.

The restore asks the editor first, using an **identity-bound** operation that verifies both the
editor's current properties and its resolved scope handle against the expected identity and returns
`false` without mutating anything when they disagree. On `false`, the controller commits.

This yields the needed ordering guarantee rather than relying on callback order:

- If the editor still owns the key, it applies and persists, so its mirror equals the committed draft;
  any later park writes that same value.
- If the editor does not own the key, it has already parked that key (it only parks on an identity
  change) or is unmounted and will never park it, so the controller's commit is the last write.
- A stale handle cannot redirect a write: the editor checks `currentKey()` against the expected
  identity before mutating, and the app callback already rechecks app state after
  `await this.updateComplete` (`PiWebUiApp.ts`, `replacePromptEditorText`).

Both writers use the same pure merge function, so the two paths cannot diverge, and the merge is
idempotent by dedupe if a restore is ever applied twice. **No new lifecycle mechanism, generation
counter, or document-level versioning is introduced.**

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
a truncated payload such as `iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB` (valid PNG signature, 24 bytes, no
`IEND`) that `attachmentsToInlineImages()` would later discard, reproducing the silent loss this fix
removes. The projection therefore requires a **complete image container**:

- base64: non-empty, length a multiple of four, padding only at the end, decodes without error;
- PNG: signature, a chunk walk with consistent lengths, and a terminating `IEND`;
- JPEG: `SOI` first, `EOI` last;
- GIF: `GIF87a`/`GIF89a` header and the `0x3B` trailer;
- WebP: `RIFF`/`WEBP` fourccs and a RIFF size consistent with the payload length.

Anything else is counted as unrestorable. The predicate lives beside the shared attachment helpers as
an **additional** restoration check; `parsePromptAttachments()` keeps its current behavior.

**Bounded claim.** A structurally complete container whose pixel data is corrupt can still fail Pi's
own decode and be dropped server-side. The client cannot prove server decodability — the decoders are
different — so this design claims detection of *everything cheaply provable client-side* (encoding,
container completeness, declared-MIME agreement) and does not claim parity with Pi's decoder. Such a
payload can only arise from a corrupted or hand-edited session file, and this residual case is recorded
as a known limitation rather than hidden behind a stronger guarantee.

**Detecting unrestorable images.** `normalizeContent()` converts an image part with missing `data` or
`mimeType` into a `{ type: "text", text: "[image]" }` placeholder, so by the time `ChatView` sees the
message the bytes are gone. The placeholder part gains an additive `missingImage: true` marker in the
`ChatPart` text variant, rendering identically. The projection counts marked placeholders plus image
parts failing the predicate. Detection is never a string match on `"[image]"`, so a user who typed that
literal is unaffected.

### 2. Composer restore operation (`PromptEditor`)

```ts
replaceDraft(draft: {
  expected: { machineId: string; sessionId: string };
  text: string;
  restored?: readonly ChatRestoredAttachment[];
  unrestorableImageCount?: number;
}): boolean;
```

The operation is synchronous and returns whether it committed:

1. Verify `expected` against `this.machineId`/`this.sessionId` **and** the active scope's `currentKey()`;
   return `false` with no mutation when they disagree.
2. Apply the existing text replacement.
3. Merge `restored` into the rendered mirror through the shared merge (capacity + dedupe + promotion),
   compute the notice from `unrestorableImageCount` plus capacity omissions, set
   `deliveryOverride` to `undefined` only when the restore actually changed the chip set, and persist
   through the scope.

**Shared merge contract.** One pure function is the single mutation path for all append sites — restore
(both writers), `PromptAttachmentDraftStore.completeCapture()`, and the starter composer's
capture/ingest:

```ts
mergePromptAttachments(existing, incoming, capacity = MAX_PROMPT_ATTACHMENTS): {
  attachments: PendingAttachment[];   // deduped, promoted, capped
  omittedForCapacity: number;
};
```

Dedupe by `(kind, mimeType, data)`; a match in `existing` is promoted (`restored: true`) and keeps its
id and any override attached to the set, never duplicated. This closes the cap hole for delayed capture
completion too, which today can produce an unsendable 17-attachment draft. Changing capture from
"silently exceed the cap" to "announce the omission" is a deliberate, tested consequence.

**Draft model.** `PromptAttachmentDraft` gains `deliveryOverride?: PromptAttachmentDelivery` and
`restoreNotice?: string`. `readScope`, `writeScope`, and `completeCapture` copy both fields. An entry is
released only when attachments are empty **and** `error` and `restoreNotice` are undefined;
`deliveryOverride` alone never creates an entry. `restoreNotice` clears on send, composer reset, and a
later restore that is complete — not on capture, which clears only `error`.

**Delivery.**
`anyRestored && promptAttachmentsCanUseInlineDelivery(set) ? deliveryOverride ?? "inline" : existingRule(...)`.
The global preference is never rewritten by a restore. A mixed set (restored image plus generic file)
keeps the existing all-or-nothing folder rule; a test pins it.

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
}) => void | Promise<boolean>;
```

`/tree` navigation passes `restored: undefined` and keeps its current text-only behavior.

`refreshAfterTreeNavigation()` gains one restoration step with a single guarded exit path:

1. `saveDraft(key, text)` (unchanged).
2. `selectSession(...)` authoritative refresh (unchanged).
3. Ask the app to commit the draft; the app awaits `updateComplete`, rechecks app identity, and delegates
   to the identity-bound editor operation, returning whether it committed.
4. **Fallback** when it did not commit — identity changed, editor unmounted, or the operation reported a
   mismatch: the controller commits with the same merge and notice through its own
   `PromptAttachmentDraftStore` handle, and re-applies the text with `saveDraft(key, text)` so a park
   performed by a stale mirror cannot leave the pre-edit text behind.

The step is Edit-only: `/tree` passes no attachments and performs neither the commit nor the fallback.
Cancelled navigation still changes nothing.

## Error Handling

- Navigation cancelled: no draft change at all.
- Selection or machine changed in flight: the restore lands in the original machine/session scope, never
  in the newly selected composer, and the restored text is re-applied after any park.
- Commit failure on the live path: falls back to the controller writer; a failure there surfaces through
  the existing app-state error channel; the navigation is not rolled back.
- Invalid, truncated, non-image, or over-capacity images: never throw; counted, announced, and never
  turned into a chip that the server would silently drop.
- Duplicate bytes: promoted in place, never duplicated.

## Consequences

- The composer can hold chips whose delivery differs from the saved preference; the selector shows and
  controls it and remains authoritative.
- Restored images live in the app-lifetime draft store until send, removal, discard, or reload.
- Re-sent images are resized transcript copies; provenance says so.
- The store now caps appended attachments, so a paste that would exceed 16 announces the omission
  instead of producing an unsendable draft.
- Two new optional draft fields require every scope operation to agree on them; the store tests pin it.

## Non-Goals

- Changing the `/tree` navigator's restore; it would need the target entry's content parts on the wire.
- Persisting attachment drafts across reloads; changing size limits, MIME support, or delivery modes.
- Reconstructing workspace-folder attachments; their path mention already rides in the text.
- Proving server-side decodability; see the bounded claim in §1.
- Any server, session-daemon, or wire-protocol change. This is a client-only fix on the web/UI
  autoreload path.

## Tests And Verification

Per `.agents/skills/testing-guide/SKILL.md`, narrowest failing layer first. Fixtures use real PNG, JPEG,
GIF, and WebP bytes (existing `"QUJD"`-style fixtures are not valid images) plus correctly signed but
truncated/corrupt payloads.

1. **Projection (pure).** Text-only unchanged; one and many images restored; text intact around
   interleaved image parts; `missingImage` counted; a user-authored `"[image]"` not counted;
   pattern-matching `"A"` counted; truncated-container payloads for each format counted; wrong magic
   bytes counted; name and byte size derived.
2. **Merge (pure).** Append, dedupe, promotion of a matching non-restored chip (same id, now restored),
   cap at 16 with `omittedForCapacity`, and `existing + incoming` combinations including a full draft.
3. **Draft store (pure).** Both new fields survive read, write, capture completion, and scope moves;
   override-only creates no entry; notice-only survives; `restoreNotice` survives a capture that clears
   `error`; capture honours the cap.
4. **Composer (jsdom).** Successful restore with an **empty** store commits rendered and stored chips plus
   the notice; repeated restore after choosing folder keeps folder delivery and the same chip; pre-restore
   override cleared only when the chip set changes; restore into a nearly full draft stops at 16 and
   reports; notice only when something was omitted, cleared by a later complete restore.
5. **Ownership and lifecycle.** A restore committed while a session/machine transition is pending leaves
   the original scope with both restored text and chips and leaves the destination untouched; the editor
   refuses on identity or handle mismatch without any cross-scope write, including two machines sharing a
   session id; delayed capture completion cannot exceed 16.
6. **Controller.** Restore after successful navigation; nothing on cancel; fallback writes the original
   scope when the live path declines; `/tree` passes no attachments and writes no chips.
7. **Wiring and send.** The message action passes text, attachments, and the count; restored-only chips
   send inline with the original text; restored image plus generic file takes the folder
   upload/reference-rewrite path.
8. **Accessibility.** Notice exposed as a polite status with a read error present simultaneously; chip
   provenance present in accessible names.

Falsifiability: each core restoration test must fail when successful-path committing, promotion, the
identity guard, cap enforcement, or delivery preservation is removed; callback-call assertions alone do
not count.

Verification: focused Vitest files, `npm run typecheck`, ESLint on changed files, then
`npm run verify:fast`. A patch Changeset accompanies the user-visible fix.

Documentation: add a dedicated **Edit from here attachment behavior** subsection to `docs/config.md` —
its existing Edit from here text covers model selection only — and mirror the same prose in
`docs/config.html`, following `.agents/skills/documentation-guide/SKILL.md`. No new page is introduced.
