// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { trackReadingPosition } from "./codeReadingPosition";

// jsdom cannot lay out CodeMirror. Fake only its documented layout/measure
// boundary; use a real EditorState and real DOM scroll/input events.
function editor(lines = 100, initiallyVisible = true) {
  const scrollDOM = document.createElement("div");
  document.body.append(scrollDOM);
  let layoutVisible = initiallyVisible;
  Object.defineProperties(scrollDOM, {
    clientWidth: { get: () => layoutVisible ? 700 : 0 },
    clientHeight: { get: () => layoutVisible ? 350 : 0 },
  });
  let notifyResize: () => void = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() { return undefined; }
    disconnect = disconnect;
  });
  const state = EditorState.create({ doc: Array.from({ length: lines }, (_, i) => `line ${String(i + 1)}`).join("\n") });
  const measures: (() => void)[] = [];
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let measuring = false;
  const dispatch = vi.fn<EditorView["dispatch"]>(() => {
    if (measuring) throw new Error("CodeMirror forbids dispatch during measurement");
  });
  let visibleLine = 1;
  const view = {
    state,
    scrollDOM,
    documentTop: 0,
    documentPadding: { top: 4 },
    lineBlockAt: (position: number) => ({ top: (state.doc.lineAt(position).number - 1) * 20 }),
    dispatch,
    requestMeasure: <T>(request?: { read: () => T; write?: (value: T) => void }) => {
      if (request !== undefined) measures.push(() => {
        measuring = true;
        try { request.write?.(request.read()); } finally { measuring = false; }
      });
    },
    lineBlockAtHeight: vi.fn(() => ({ from: state.doc.line(scrollDOM.isConnected && layoutVisible ? visibleLine : 1).from })),
  };
  return {
    view, scrollDOM, dispatch, disconnect,
    setVisible: (visible: boolean) => { layoutVisible = visible; notifyResize(); },
    detach: () => { scrollDOM.remove(); scrollDOM.scrollTop = 0; },
    show: (line: number) => { visibleLine = line; scrollDOM.dispatchEvent(new Event("scroll")); },
    measure: () => { measures.shift()?.(); },
    frame: () => { frames.shift()?.(0); },
    settle: () => {
      for (let i = 0; i < 20 && (measures.length > 0 || frames.length > 0); i += 1) {
        measures.shift()?.();
        frames.shift()?.(0);
      }
    },
  };
}

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("code reading position", () => {
  it("restores only after measurement and ignores restoration scrolls", () => {
    const h = editor();
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 45, report);
    h.show(1);
    expect(report).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.measure();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.frame();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.scrollDOM.scrollTop).toBe(884);
    h.show(45);
    expect(report).not.toHaveBeenCalled();
    h.settle();
    expect(report).toHaveBeenLastCalledWith(45);
    expect(h.scrollDOM.scrollTop).toBe(884);
    h.show(62);
    h.settle();
    expect(report).toHaveBeenLastCalledWith(62);
    stop();
    h.show(70);
    expect(report).toHaveBeenLastCalledWith(62);
  });

  it("clamps shortened files and falls back to first line for invalid positions", () => {
    for (const [requested, expected] of [[500, 10], [0, 1], [NaN, 1], [-5, 1]] as const) {
      const h = editor(10);
      const report = vi.fn();
      const stop = trackReadingPosition(h.view, requested, report);
      h.measure();
      h.frame();
      h.show(expected);
      h.settle();
      expect(report).toHaveBeenLastCalledWith(expected);
      stop();
    }
  });

  it("does not move the viewport if the user interacts before deferred restoration", () => {
    const h = editor();
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 45, report);
    h.scrollDOM.dispatchEvent(new Event("wheel"));
    h.show(20);
    h.settle();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(20);
    stop();
  });

  it("does not overwrite user scroll after restoration was scheduled", () => {
    const h = editor();
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 45, report);
    h.measure();
    h.frame();
    h.measure();
    h.scrollDOM.dispatchEvent(new Event("pointerdown"));
    h.show(60);
    h.settle();
    expect(report).toHaveBeenLastCalledWith(60);
    expect(report).not.toHaveBeenCalledWith(45);
    stop();
  });

  it("preserves the final pending visible line when navigation beats measurement", () => {
    const h = editor();
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 1, report);
    h.settle();
    h.show(35);
    const sampled = h.view.lineBlockAtHeight.mock.calls.length;
    h.detach();
    stop();
    expect(h.view.lineBlockAtHeight).toHaveBeenCalledTimes(sampled);
    expect(h.disconnect).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(35);
    h.settle();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("does not report or restore hidden layouts, then restores when shown", () => {
    const h = editor(200, false);
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 120, report);
    h.settle();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    h.setVisible(true);
    h.measure();
    h.frame();
    h.show(120);
    h.settle();
    expect(report).toHaveBeenLastCalledWith(120);
    h.setVisible(false);
    h.show(2);
    h.settle();
    expect(report).toHaveBeenCalledExactlyOnceWith(120);
    stop();
    h.setVisible(true);
    h.settle();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("invalidates an in-progress restore when hidden and retries after showing", () => {
    const h = editor();
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 45, report);
    h.measure();
    h.setVisible(false);
    h.settle();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    h.setVisible(true);
    h.measure();
    h.frame();
    h.show(45);
    h.settle();
    expect(report).toHaveBeenCalledExactlyOnceWith(45);
    stop();
  });

  it("rounds fractional target offsets into the requested line", () => {
    const h = editor();
    h.view.lineBlockAt = () => ({ top: 2053.015625 });
    const stop = trackReadingPosition(h.view, 45, vi.fn());
    h.settle();
    expect(h.scrollDOM.scrollTop).toBe(2058);
    stop();
  });

  it("does not apply a pending restore after user input between measure and animation frame", () => {
    const h = editor();
    const stop = trackReadingPosition(h.view, 45, vi.fn());
    h.measure();
    h.scrollDOM.dispatchEvent(new Event("wheel"));
    h.frame();
    expect(h.dispatch).not.toHaveBeenCalled();
    stop();
  });

  it("adopts pointerdown without scroll as the baseline for hide/show", () => {
    const h = editor(200);
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 120, report);
    h.scrollDOM.dispatchEvent(new Event("pointerdown"));
    h.settle();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(1);
    h.setVisible(false);
    h.setVisible(true);
    h.settle();
    expect(h.scrollDOM.scrollTop).toBe(4);
    expect(report).toHaveBeenLastCalledWith(1);
    stop();
  });

  it("cancels a stale editor's deferred positioning on disconnect", () => {
    const h = editor();
    const report = vi.fn();
    const stop = trackReadingPosition(h.view, 45, report);
    stop();
    h.measure();
    h.frame();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
