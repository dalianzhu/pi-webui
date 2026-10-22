import { describe, expect, it } from "vitest";
import { mergePromptAttachments } from "./promptAttachmentMerge";
import type { CapturedAttachment } from "./promptAttachmentCapture";
import type { PendingAttachment } from "./promptAttachmentDrafts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0FhYGRolJicoKSo0NTY3ODk6Q0RFRUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z";

function captured(overrides: Partial<CapturedAttachment> = {}): CapturedAttachment {
  return { kind: "image", name: "restored.png", mimeType: "image/png", data: PNG, size: 69, ...overrides };
}

function pending(id: string, overrides: Partial<PendingAttachment> = {}): PendingAttachment {
  return { id, ...captured(), ...overrides };
}

describe("mergePromptAttachments", () => {
  it("appends incoming attachments and allocates ids", () => {
    let next = 0;
    expect(mergePromptAttachments([], [captured(), captured({ data: JPEG, mimeType: "image/jpeg", name: "photo.jpg", size: 633 })], () => `new-${String(++next)}`)).toEqual({
      attachments: [
        { id: "new-1", ...captured() },
        { id: "new-2", ...captured({ data: JPEG, mimeType: "image/jpeg", name: "photo.jpg", size: 633 }) },
      ],
      omittedForCapacity: 0,
    });
  });

  it("marks fresh restored attachments while leaving ordinary captures unmarked", () => {
    const result = mergePromptAttachments([], [{ ...captured(), restored: true }], () => "restored-id");

    expect(result.attachments).toEqual([{ id: "restored-id", ...captured(), restored: true }]);
    expect(mergePromptAttachments([], [captured()], () => "capture-id").attachments).toEqual([{ id: "capture-id", ...captured() }]);
  });

  it("deduplicates by MIME and bytes for restored images, promoting matches in place without mutating inputs", () => {
    const existing = [pending("keep", { kind: "file", name: "old.bin", mimeType: "image/png", data: PNG, size: 1 })];
    const incoming = [{ ...captured({ name: "message.png", size: 69 }), restored: true as const }];
    const existingSnapshot = structuredClone(existing);
    const incomingSnapshot = structuredClone(incoming);
    const result = mergePromptAttachments(existing, incoming, () => "unused");

    expect(result).toEqual({
      attachments: [{ id: "keep", kind: "image", name: "message.png", mimeType: "image/png", data: PNG, size: 69, restored: true }],
      omittedForCapacity: 0,
    });
    expect(existing).toEqual(existingSnapshot);
    expect(incoming).toEqual(incomingSnapshot);
  });

  it("never collapses two identical ordinary captures into one chip", () => {
    const result = mergePromptAttachments([], [captured(), captured()], (() => "capture-id"));

    expect(result.attachments).toHaveLength(2);
    expect(result.attachments.map((attachment) => attachment.id)).toEqual(["capture-id", "capture-id"]);
    expect(result.omittedForCapacity).toBe(0);
  });

  it("keeps existing order, deduplicates restored values before applying the cap, and counts only omitted unique values", () => {
    const first = pending("first", { data: JPEG, mimeType: "image/jpeg", name: "first.jpg", size: 633 });
    const second = pending("second", { data: "other-data", mimeType: "text/plain", kind: "file", name: "note.txt", size: 10 });
    const result = mergePromptAttachments(
      [first, second],
      [
        { ...captured({ data: PNG }), restored: true as const },
        { ...captured({ data: PNG, name: "same.png" }), restored: true as const },
        { ...captured({ data: JPEG, mimeType: "image/jpeg" }), restored: true as const },
        { ...captured({ data: "third", mimeType: "application/octet-stream", kind: "file", name: "third.bin", size: 5 }), restored: true as const },
      ],
      (() => "new-id"),
      3,
    );

    expect(result.attachments).toEqual([
      { id: "first", ...captured({ data: JPEG, mimeType: "image/jpeg" }), restored: true },
      second,
      { id: "new-id", ...captured({ data: PNG, name: "same.png" }), restored: true },
    ]);
    expect(result.omittedForCapacity).toBe(1);
  });
});
