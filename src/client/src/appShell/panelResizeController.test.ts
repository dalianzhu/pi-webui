import type { ReactiveControllerHost } from "lit";
import { describe, expect, it } from "vitest";
import {
  clampPanelWidth,
  PANEL_SIZE_STORAGE_KEY,
  PanelResizeController,
  panelResizeDelta,
  panelWidthFromDrag,
  panelWidthFromKeyboard,
  readStoredPanelSizes,
  writeStoredPanelSizes,
} from "./panelResizeController";

describe("panel resize behavior", () => {
  it("resizes left and right panels in opposite drag directions", () => {
    expect(panelResizeDelta("navigation", 100, 140)).toBe(40);
    expect(panelWidthFromDrag("navigation", 300, 100, 140)).toBe(340);

    expect(panelResizeDelta("workspace", 100, 140)).toBe(-40);
    expect(panelWidthFromDrag("workspace", 500, 100, 140)).toBe(460);
  });

  it("clamps panel widths to broad fallback bounds", () => {
    expect(clampPanelWidth("navigation", 50)).toBe(324);
    expect(clampPanelWidth("navigation", 9000)).toBe(4096);
    expect(clampPanelWidth("workspace", 50)).toBe(240);
    expect(clampPanelWidth("workspace", 9000)).toBe(4096);
  });

  it("keeps the navigation default while enforcing the new floor", () => {
    expect(clampPanelWidth("navigation", 50)).toBe(324);
    expect(clampPanelWidth("navigation", 260)).toBe(324);
    expect(clampPanelWidth("navigation", 340)).toBe(340);
    expect(clampPanelWidth("navigation", Number.NaN)).toBe(340);
    expect(clampPanelWidth("navigation", 9000)).toBe(4096);
    expect(panelWidthFromDrag("navigation", 340, 100, -100)).toBe(324);
    expect(panelWidthFromKeyboard("navigation", 340, "ArrowLeft")).toBe(324);
    expect(panelWidthFromKeyboard("navigation", 324, "ArrowLeft")).toBe(324);
    expect(panelWidthFromKeyboard("navigation", 340, "ArrowLeft", { largeStep: true })).toBe(324);
    expect(panelWidthFromKeyboard("navigation", 340, "ArrowRight")).toBe(364);
    expect(panelWidthFromKeyboard("navigation", 340, "ArrowRight", { largeStep: true })).toBe(412);
    expect(panelWidthFromKeyboard("navigation", 340, "Home")).toBe(324);
    expect(panelWidthFromKeyboard("navigation", 340, "End")).toBe(4096);
  });

  it("supports narrower viewport-aware constraints", () => {
    const constraints = { minWidth: 200, maxWidth: 900, defaultWidth: 340, keyboardStep: 24, largeKeyboardStep: 72 };

    expect(clampPanelWidth("navigation", 100, constraints)).toBe(200);
    expect(clampPanelWidth("navigation", 1200, constraints)).toBe(900);
  });

  it("supports keyboard resizing in panel-relative directions", () => {
    expect(panelWidthFromKeyboard("navigation", 300, "ArrowRight")).toBe(324);
    expect(panelWidthFromKeyboard("navigation", 300, "ArrowLeft")).toBe(324);
    expect(panelWidthFromKeyboard("workspace", 500, "ArrowLeft")).toBe(524);
    expect(panelWidthFromKeyboard("workspace", 500, "ArrowRight")).toBe(476);
    expect(panelWidthFromKeyboard("workspace", 500, "Home")).toBe(240);
    expect(panelWidthFromKeyboard("workspace", 500, "End")).toBe(4096);
    expect(panelWidthFromKeyboard("workspace", 500, "Enter")).toBeUndefined();
  });

  it("reads, writes, and clears stored panel widths", () => {
    const storage = new FakeStorage();

    expect(readStoredPanelSizes(storage)).toEqual({});
    writeStoredPanelSizes({ navigationPanelWidth: 260, workspacePanelWidth: 640 }, storage);

    expect(JSON.parse(storage.value(PANEL_SIZE_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      navigationPanelWidth: 324,
      workspacePanelWidth: 640,
    });
    expect(readStoredPanelSizes(storage)).toEqual({ navigationPanelWidth: 324, workspacePanelWidth: 640 });

    writeStoredPanelSizes({}, storage);
    expect(storage.value(PANEL_SIZE_STORAGE_KEY)).toBeUndefined();
    expect(readStoredPanelSizes(storage)).toEqual({});
  });

  it("loads an old raw version-1 width without rewriting it", () => {
    const raw = '{"version":1,"navigationPanelWidth":260,"workspacePanelWidth":640}';
    const storage = new FakeStorage({ [PANEL_SIZE_STORAGE_KEY]: raw });
    expect(readStoredPanelSizes(storage)).toEqual({ navigationPanelWidth: 324, workspacePanelWidth: 640 });
    const host: ReactiveControllerHost = {
      addController: () => undefined,
      removeController: () => undefined,
      requestUpdate: () => undefined,
      updateComplete: Promise.resolve(true),
    };
    expect(new PanelResizeController(host, { storage }).panelWidth("navigation")).toBe(324);
    expect(storage.value(PANEL_SIZE_STORAGE_KEY)).toBe(raw);
  });

  it("clamps stored panel widths and ignores invalid values", () => {
    const storage = new FakeStorage({
      [PANEL_SIZE_STORAGE_KEY]: JSON.stringify({ version: 1, navigationPanelWidth: 9999, workspacePanelWidth: "wide" }),
    });

    expect(readStoredPanelSizes(storage)).toEqual({ navigationPanelWidth: 4096 });
  });

  it("ignores storage failures", () => {
    const storage = new ThrowingStorage();

    expect(readStoredPanelSizes(storage)).toEqual({});
    expect(() => { writeStoredPanelSizes({ navigationPanelWidth: 260 }, storage); }).not.toThrow();
  });
});

class FakeStorage {
  private readonly values = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  value(key: string): string | undefined {
    return this.values.get(key);
  }
}

class ThrowingStorage {
  getItem(): string | null {
    throw new Error("blocked");
  }

  setItem(): void {
    throw new Error("blocked");
  }

  removeItem(): void {
    throw new Error("blocked");
  }
}
