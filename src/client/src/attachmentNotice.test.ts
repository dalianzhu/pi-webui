import { describe, expect, it } from "vitest";
import { formatAttachmentNotice } from "./attachmentNotice";

describe("formatAttachmentNotice", () => {
  it.each([
    [{ invalid: 0, omittedForCapacity: 0 }, undefined],
    [{ invalid: 1, omittedForCapacity: 0 }, "1 image from this message could not be restored."],
    [{ invalid: 2, omittedForCapacity: 0 }, "2 images from this message could not be restored."],
    [{ invalid: 0, omittedForCapacity: 1 }, "Only 16 attachments can be sent, so 1 was not added."],
    [{ invalid: 0, omittedForCapacity: 2 }, "Only 16 attachments can be sent, so 2 were not added."],
    [{ invalid: 1, omittedForCapacity: 2 }, "1 image from this message could not be restored. Only 16 attachments can be sent, so 2 were not added."],
  ])("formats %j", (counts, expected) => {
    expect(formatAttachmentNotice(counts)).toBe(expected);
  });
});
