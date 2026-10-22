import { MAX_PROMPT_ATTACHMENTS } from "../../shared/promptAttachments";

export function formatAttachmentNotice(counts: { invalid: number; omittedForCapacity: number }): string | undefined {
  const invalid = Math.max(0, Math.floor(counts.invalid));
  const omitted = Math.max(0, Math.floor(counts.omittedForCapacity));
  const sentences: string[] = [];
  if (invalid > 0) sentences.push(`${String(invalid)} image${invalid === 1 ? "" : "s"} from this message could not be restored.`);
  if (omitted > 0) sentences.push(`Only ${String(MAX_PROMPT_ATTACHMENTS)} attachments can be sent, so ${String(omitted)} ${omitted === 1 ? "was" : "were"} not added.`);
  return sentences.length === 0 ? undefined : sentences.join(" ");
}
