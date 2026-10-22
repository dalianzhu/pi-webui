# Edit-From-Here Attachment Restore — Technical Specification

**Date:** 2026-10-21
**Design:** `docs/superpowers/specs/2026-10-21-edit-from-here-attachment-restore-design.md` (approved)

This spec pins the concrete modules, signatures, and behaviors the design leaves to implementation.
Where this file and the design disagree, the design wins and this file is corrected.

## Scope Reminder

Client-only. No server, session-daemon, or wire-protocol change. Guarantee applies to the normal path;
a mid-flight session/machine reselection keeps today's behavior (no restore) and is a documented
follow-up ("composer draft ownership").

## Modules

### 1. `src/shared/imageStructure.ts` (new)

```ts
/** Strict base64 -> bytes. Returns undefined for empty, mis-padded, non-multiple-of-four, or invalid input. */
export function decodeStrictBase64(data: string): Uint8Array | undefined;

/** True when the bytes are a structurally complete image container of the declared supported type. */
export function isStructurallyCompleteImage(bytes: Uint8Array, mimeType: string): boolean;
```

Parsers implement the design's table exactly: PNG (`IHDR` length 13 with non-zero dimensions, ≥1 `IDAT`
length > 0, final `IEND` length 0, walk ends at payload end, chunk lengths self-consistent); JPEG (`SOI`,
≥1 `SOFn` with non-zero dimensions, ≥1 `SOS` with ≥1 entropy-coded byte before the next marker, marker
walk continues across progressive scans, `EOI` last); GIF (`GIF87a`/`GIF89a`, screen descriptor, block
walk, ≥1 image descriptor with non-zero dimensions and ≥1 non-empty data sub-block before `0x00`,
trailer last); WebP (`RIFF` size consistent, `WEBP`, padded chunk walk, image data from a top-level
`VP8 ` or `VP8L` with length > 0 **or** from an `ANMF` frame whose 16-byte header precedes nested padded
chunks containing one). `VP8X` never satisfies image data on its own.

Parsers must never throw on truncated input; every failure returns `false`.

### 2. `src/client/src/promptAttachmentMerge.ts` (new)

```ts
export function mergePromptAttachments(
  existing: readonly PendingAttachment[],
  incoming: readonly CapturedAttachment[],
  nextId: () => string,
  capacity?: number, // default MAX_PROMPT_ATTACHMENTS
): { attachments: PendingAttachment[]; omittedForCapacity: number };
```

- Identity: `(mimeType, data)`. A match promotes in place: keeps array position and `id`, preserves the
  set's delivery override, gains `restored: true`, adopts the incoming `kind`, `name`, and metadata.
- Non-matches append with `nextId()` until capacity is exhausted; the remainder counts as
  `omittedForCapacity`. Capacity counts duplicates only once (dedupe before cap).
- Never mutates its inputs.

### 3. `src/client/src/attachmentNotice.ts` (new)

```ts
export function formatAttachmentNotice(counts: { invalid: number; omittedForCapacity: number }): string | undefined;
```

Returns `undefined` when both counts are zero. Invalid-only: `"N image(s) from this message could not be
restored."` Capacity-only: `"Only 16 attachments can be sent, so N were not added."` Both: the two
sentences joined. Singular/plural handled; the cap number comes from `MAX_PROMPT_ATTACHMENTS`.

### 4. `src/client/src/chatMessages.ts` (edit)

The `[image]` placeholder for an image part with missing `data`/`mimeType` gains `missingImage: true` on
the text part (additive optional property on the `ChatPart` text variant in `components/shared.ts`).
Rendering is unchanged.

### 5. `src/client/src/components/ChatView.ts` (edit)

Replace `chatMessageEditText` with:

```ts
export interface ChatRestoredAttachment { kind: "image"; name: string; mimeType: string; data: string; size: number }
export interface ChatMessageEditDraft {
  text: string;
  attachments: readonly ChatRestoredAttachment[];
  unrestorableImageCount: number;
}
export function chatMessageEditDraft(message: ChatLine): ChatMessageEditDraft;
```

`text` keeps today's semantics (text parts joined with `\n`, untrimmed). Each image part is decoded with
`decodeStrictBase64` and accepted only when `isStructurallyCompleteImage` passes; accepted parts become
`ChatRestoredAttachment` with `name` from `extensionForImageMimeType` and `size` from the decoded byte
length. Rejected parts and `missingImage` placeholders increment `unrestorableImageCount`. Delete the
now-unused `chatMessageEditText` and update its tests.

`onEditFromHere` becomes `(assistantEntryId: string, draft: ChatMessageEditDraft) => void | Promise<void>`.

### 6. `src/client/src/promptAttachmentDrafts.ts` (edit)

`PendingAttachment = CapturedAttachment & { id: string; restored?: true }`.
`PromptAttachmentDraft` gains `deliveryOverride?: PromptAttachmentDelivery` and `notice?: string`;
`readScope`, `writeScope`, and `completeCapture` copy both. Entry release requires empty `attachments`
plus `error` and `notice` both undefined. `completeCapture` routes through `mergePromptAttachments`, sets
`notice` from `formatAttachmentNotice` only when it omitted for capacity (otherwise preserves the
existing notice) and keeps clearing `error` as today. `beginCapture().complete()` keeps its current
`(attachments, error)` signature.

### 7. `src/client/src/promptAttachmentCapture.ts` (edit)

`effectivePromptAttachmentDelivery(preference, attachments, override?)`: when any attachment is
`restored` and the whole set is inline-deliverable, return `override ?? "inline"`; otherwise keep the
current all-or-nothing rule (`override ?? preference` when inline-deliverable, else `"folder"`).

### 8. `src/client/src/components/PromptEditor.ts` (edit)

- `replaceDraft({ text, restored?, unrestorableImageCount? })`: performs `replaceText`'s work, merges
  `restored` through the shared merge (ids from `attachmentDrafts.nextAttachmentId()`), composes
  `notice` via `formatAttachmentNotice` (`invalid = unrestorableImageCount ?? 0`, capacity from the
  merge), sets `deliveryOverride` to `undefined` only when the merge changed the chip set, and persists
  through `persistAttachmentDraft()`. `replaceText` stays for `/tree`.
- Restore applies only when `restored` is a non-empty array or `unrestorableImageCount > 0`.
- Render guard: chips, `attachmentError`, or `notice`.
- Notice element: `<div class="attachment-notice" role="status" aria-live="polite">`.
- Chip provenance: `title` and the chip's/remove button's `aria-label` include
  `restored from this message; may be a resized copy`.
- `changeDelivery()` additionally writes `deliveryOverride` into the draft when any chip is restored.
- Starter composer (no scope) keeps both new fields as component-local state and uses the same merge.

### 9. `src/client/src/controllers/sessionController.ts` (edit)

Replace the `replacePromptEditorText` dependency/field/call with one
`replacePromptEditorDraft?: (replacement: PromptEditorDraftReplacement) => void | Promise<void>` where
`PromptEditorDraftReplacement = { machineId; sessionId; text; restored?; unrestorableImageCount? }`.
`refreshAfterTreeNavigation(session, machineId, draft, tree?)` takes the draft object
(`editFromHere` passes the projection; the `/tree` path passes `{ text: result.editorText ?? "" }`).
Dispatch happens exactly once, after the authoritative refresh and inside the existing identity guards.
Preserve today's failure precedence verbatim: a thrown callback error is recorded and rethrown first; a
captured `selectSession` refresh error is recorded and rethrown only when the callback did not throw.

### 10. `src/client/src/components/PiWebUiApp.ts` (edit)

`handleEditFromHere(assistantEntryId, draft)` forwards the draft; the controller dependency becomes
`replacePromptEditorDraft`, implemented as `await this.updateComplete`, recheck machine/session, then
`this.promptEditor?.replaceDraft({...})` (or `replaceText` when neither attachment field is present).

## Behavior Matrix

| Situation | Result |
| --- | --- |
| Text-only message | text restored, no chips, no notice |
| One or more restorable images | chips restored (appended, deduped), inline delivery by default |
| Some images unrestorable | restore continues, notice names the count |
| Draft already holds chips | existing chips kept in place and order, duplicates promoted, nothing lost |
| Draft would exceed 16 | added up to the cap, notice names the omitted count |
| Restore repeated after choosing folder | chips promoted, folder choice kept |
| Capture over cap | added up to the cap, notice announces the omission |
| `notice` with zero chips | rendered (guard covers notice-only draft) |
| `/tree` navigation | text only, no chips, no notice write |
| Navigation cancelled | nothing changes |
| Mid-flight reselection | nothing restored (documented boundary) |

## Tests

Follow `.agents/skills/testing-guide/SKILL.md`. Required files/cases:

1. `src/shared/imageStructure.test.ts` — per-format accept/reject incl. the design's rejection table,
   progressive JPEG, animated WebP, odd-size RIFF padding, MIME/container mismatch, truncated input.
2. `src/client/src/promptAttachmentMerge.test.ts` — append, dedupe by `(mimeType, data)` across differing
   `kind`, promotion keeps id/position and adopts image metadata, cap accounting, input immutability.
3. `src/client/src/attachmentNotice.test.ts` — invalid-only, capacity-only, both, zero, pluralization.
4. `src/client/src/components/ChatView.test.ts` (update) — projection cases incl. `missingImage`-marked
   placeholder vs a user-typed `"[image]"`, plus the new callback payload.
5. `src/client/src/promptAttachmentDrafts.test.ts` (update) — new fields survive read/write/capture/move;
   notice-only entry survives; capture preserves an existing notice unless it omits; cap enforced.
6. `src/client/src/components/PromptEditor*.test.ts` (update/extend, jsdom where needed) — restore into an
   empty store, notice-only render, promotion without duplication, folder override preserved across
   remount and repeated restore, forced inline when all chips are restored, mixed file+image → folder,
   cap omission.
7. `src/client/src/controllers/sessionController.tree.test.ts` (update) — one dispatch per navigation,
   `/tree` payload has no attachment fields, cancel/identity-change suppression, refresh-failure
   precedence unchanged.

Falsifiability: each core case must fail if the corresponding mechanism is removed (structural
predicate, promotion, cap, notice composition, delivery rule, single dispatch). Use real image bytes
for fixtures, not `"QUJD"`.

## Documentation And Changeset

- `docs/faq.html`: one new `<article id="edit-from-here-attachments">` entry plus its link in the page's
  in-page index list, covering restore, "copy kept in the transcript, which may be a resized version of
  the original file", the incomplete-restore notice, and the reselect boundary.
- `.changeset/*.md`: one patch Changeset describing the user-visible fix.

## Verification

```bash
npx vitest run <touched test files>
npm run typecheck
npx eslint <changed files>
npm run verify:fast
```

Commit locally on the integration branch only. Do not push, do not merge, do not touch the delivery
target or any file outside the integration worktree.
