import { MAX_PROMPT_ATTACHMENTS } from "../../shared/promptAttachments";
import type { CapturedAttachment } from "./promptAttachmentCapture";
import type { PendingAttachment } from "./promptAttachmentDrafts";

type MergeableAttachment = CapturedAttachment & { restored?: true };

/**
 * Merge a batch into a pending attachment set without mutating either input.
 *
 * Ordinary captures always append, exactly as before: two files a user adds
 * with identical bytes are still two chips, because that is what they picked.
 * Only a *restored* attachment is deduplicated, by `(mimeType, data)`, against
 * the pending set — restoring the same message twice must not duplicate an
 * image the user already holds. A match is promoted in place and keeps its id.
 */
export function mergePromptAttachments(
  existing: readonly PendingAttachment[],
  incoming: readonly MergeableAttachment[],
  nextId: () => string,
  capacity = MAX_PROMPT_ATTACHMENTS,
): { attachments: PendingAttachment[]; omittedForCapacity: number } {
  const attachments = existing.map((attachment) => ({ ...attachment }));
  const positions = new Map<string, number>();
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (attachment !== undefined) positions.set(attachmentIdentity(attachment), index);
  }

  const limit = Math.max(0, Math.floor(capacity));
  let omittedForCapacity = 0;
  for (const attachment of incoming) {
    if (attachment.restored === true) {
      const identity = attachmentIdentity(attachment);
      const existingIndex = positions.get(identity);
      if (existingIndex !== undefined) {
        const current = attachments[existingIndex];
        if (current !== undefined) {
          attachments[existingIndex] = {
            ...current,
            ...attachment,
            restored: true,
            id: current.id,
          };
        }
        continue;
      }
    }
    if (attachments.length >= limit) {
      omittedForCapacity += 1;
      continue;
    }
    const next: PendingAttachment = { id: nextId(), ...attachment };
    if (attachment.restored === true) positions.set(attachmentIdentity(next), attachments.length);
    attachments.push(next);
  }

  return { attachments, omittedForCapacity };
}

function attachmentIdentity(attachment: Pick<CapturedAttachment, "mimeType" | "data">): string {
  return `${attachment.mimeType}\u0000${attachment.data}`;
}
