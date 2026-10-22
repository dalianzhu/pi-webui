import { describe, expect, it } from "vitest";
import { PromptAttachmentDraftStore, promptAttachmentDrafts, type PendingAttachment } from "./promptAttachmentDrafts";

function imageAttachment(id: string, name: string, data = "UE5H"): PendingAttachment {
  return { id, kind: "image", name, mimeType: "image/png", data, size: 3 };
}

function capturedImage(name: string, data = "UE5H") {
  return { kind: "image" as const, name, mimeType: "image/png", data, size: 3 };
}

describe("PromptAttachmentDraftStore", () => {
  it("returns an empty draft for an unknown key", () => {
    const store = new PromptAttachmentDraftStore();

    expect(store.read("local:session-a")).toEqual({ attachments: [] });
    expect(Object.hasOwn(store.read("local:session-a"), "error")).toBe(false);
  });

  it("keeps drafts isolated per key", () => {
    const store = new PromptAttachmentDraftStore();
    store.write("local:session-a", { attachments: [imageAttachment("attachment-1", "a.png")] });

    expect(store.read("local:session-b")).toEqual({ attachments: [] });
    expect(store.read("local:session-a").attachments.map((attachment) => attachment.name)).toEqual(["a.png"]);
  });

  it("does not expose stored arrays to callers", () => {
    const store = new PromptAttachmentDraftStore();
    const attachments = [imageAttachment("attachment-1", "a.png")];
    store.write("local:session-a", { attachments });

    attachments.push(imageAttachment("attachment-2", "b.png"));
    const read = store.read("local:session-a");
    const mutableRead: PendingAttachment[] = [...read.attachments];
    mutableRead.push(imageAttachment("attachment-3", "c.png"));

    expect(store.read("local:session-a").attachments.map((attachment) => attachment.name)).toEqual(["a.png"]);
  });

  it("deletes an entry when a draft becomes completely empty", () => {
    const store = new PromptAttachmentDraftStore();
    store.write("local:session-a", { attachments: [imageAttachment("attachment-1", "a.png")] });

    store.write("local:session-a", { attachments: [] });

    expect(store.read("local:session-a")).toEqual({ attachments: [] });
    expect(store.hasEntry("local:session-a")).toBe(false);
  });

  it("copies delivery override and notice through reads, writes, captures, and moves", () => {
    const store = new PromptAttachmentDraftStore();
    store.write("local:session-a", {
      attachments: [imageAttachment("attachment-1", "a.png")],
      deliveryOverride: "folder",
      notice: "restore notice",
    });

    const scope = store.openScope("local:session-a");
    expect(scope.read()).toEqual({
      attachments: [imageAttachment("attachment-1", "a.png")],
      deliveryOverride: "folder",
      notice: "restore notice",
    });

    scope.beginCapture().complete([capturedImage("b.png", "UE5I")], undefined);
    expect(store.read("local:session-a")).toEqual({
      attachments: [imageAttachment("attachment-1", "a.png"), { id: "attachment-1", ...capturedImage("b.png", "UE5I") }],
      deliveryOverride: "folder",
      notice: "restore notice",
    });

    store.move("local:session-a", "local:session-b");
    expect(store.read("local:session-b")).toEqual({
      attachments: [imageAttachment("attachment-1", "a.png"), { id: "attachment-1", ...capturedImage("b.png", "UE5I") }],
      deliveryOverride: "folder",
      notice: "restore notice",
    });
  });

  it("does not retain a delivery override by itself, but retains a notice without chips", () => {
    const store = new PromptAttachmentDraftStore();

    store.write("local:override-only", { attachments: [], deliveryOverride: "folder" });
    expect(store.hasEntry("local:override-only")).toBe(false);

    store.write("local:notice-only", { attachments: [], deliveryOverride: "folder", notice: "restore notice" });
    expect(store.read("local:notice-only")).toEqual({ attachments: [], deliveryOverride: "folder", notice: "restore notice" });
    expect(store.hasEntry("local:notice-only")).toBe(true);
  });

  it("clears capture errors, preserves a prior notice, and replaces it on capacity omission", () => {
    const store = new PromptAttachmentDraftStore();
    const key = "local:session-a";
    store.write(key, {
      attachments: [imageAttachment("attachment-1", "existing.png")],
      error: "read failed",
      notice: "prior restore notice",
      deliveryOverride: "folder",
    });

    store.openScope(key).beginCapture().complete([capturedImage("new.png", "UE5I")], undefined);
    expect(store.read(key)).toEqual({
      attachments: [imageAttachment("attachment-1", "existing.png"), { id: "attachment-1", ...capturedImage("new.png", "UE5I") }],
      deliveryOverride: "folder",
      notice: "prior restore notice",
    });

    const fullKey = "local:full";
    store.write(fullKey, {
      attachments: Array.from({ length: 16 }, (_, index) => imageAttachment(`existing-${String(index)}`, `existing-${String(index)}.png`, `UE${String(index).padStart(2, "0")}`)),
      notice: "prior restore notice",
    });
    store.openScope(fullKey).beginCapture().complete([capturedImage("omitted.png", "NEW")], undefined);
    expect(store.read(fullKey).notice).toBe("Only 16 attachments can be sent, so 1 was not added.");
    expect(store.read(fullKey).attachments).toHaveLength(16);
  });

  it("retains an error-only draft so a read failure stays visible", () => {
    const store = new PromptAttachmentDraftStore();

    store.write("local:session-a", { attachments: [], error: "Failed to read an attachment." });

    expect(store.read("local:session-a")).toEqual({ attachments: [], error: "Failed to read an attachment." });
    expect(store.hasEntry("local:session-a")).toBe(true);
  });

  it("moves a draft to a new key and clears the source", () => {
    const store = new PromptAttachmentDraftStore();
    store.write("local:pending-session-1", { attachments: [imageAttachment("attachment-1", "a.png")] });

    store.move("local:pending-session-1", "local:real-session");

    expect(store.read("local:pending-session-1")).toEqual({ attachments: [] });
    expect(store.read("local:real-session").attachments.map((attachment) => attachment.name)).toEqual(["a.png"]);
  });

  it("clears the destination when moving from a key with no draft", () => {
    const store = new PromptAttachmentDraftStore();
    store.write("local:real-session", { attachments: [imageAttachment("attachment-1", "stale.png")] });

    store.move("local:pending-session-1", "local:real-session");

    expect(store.read("local:real-session")).toEqual({ attachments: [] });
  });

  it("clears a draft by key", () => {
    const store = new PromptAttachmentDraftStore();
    store.write("local:session-a", { attachments: [imageAttachment("attachment-1", "a.png")], error: "boom" });

    store.clear("local:session-a");

    expect(store.read("local:session-a")).toEqual({ attachments: [] });
  });

  it("allocates attachment ids that never repeat across keys or clears", () => {
    const store = new PromptAttachmentDraftStore();

    const first = store.nextAttachmentId();
    store.write("local:session-a", { attachments: [imageAttachment(first, "a.png")] });
    store.clear("local:session-a");
    const second = store.nextAttachmentId();
    const third = store.nextAttachmentId();

    expect(first).toBe("attachment-1");
    expect(second).toBe("attachment-2");
    expect(third).toBe("attachment-3");
  });

  it("exposes one shared app-lifetime store", () => {
    expect(promptAttachmentDrafts).toBeInstanceOf(PromptAttachmentDraftStore);
  });
});
