// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { trackReadingPosition } from "./codeReadingPosition";

const originalClientRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const originalBoundingRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

// Real EditorView dispatch, wheel handlers, and core RAF/measure consumption.
// Only geometry (unavailable in jsdom) and the helper's measure queue are faked.
// A positive control proves the public scrollHandler observes core targets.
function editor() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const enqueue = (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  const cancel = (id: number) => { frames.delete(id); };
  vi.stubGlobal("requestAnimationFrame", enqueue);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(enqueue);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(cancel);
  vi.stubGlobal("ResizeObserver", class {
    observe() { return undefined; }
    disconnect() { return undefined; }
  });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => Object.assign([], { item: () => null }) });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(0, 0, 10, 20) });
  const coreScroll = vi.fn((_view: EditorView, range: { head: number }) => {
    // Simulate the default physical scrolling at the public override boundary.
    _view.scrollDOM.scrollTop = (_view.state.doc.lineAt(range.head).number - 1) * 20 + 4;
    return true;
  });
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: Array.from({ length: 300 }, (_, index) => `line ${String(index + 1)}`).join("\n"),
      extensions: [EditorView.scrollHandler.of(coreScroll)],
    }),
  });
  Object.defineProperties(view.scrollDOM, { clientWidth: { get: () => 700 }, clientHeight: { get: () => 350 } });
  vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 700, 350));
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 700, 350));
  vi.spyOn(view.contentDOM, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 4 - view.scrollDOM.scrollTop, 650, 6000));
  const helperMeasures: (() => void)[] = [];
  const adapter = {
    get state() { return view.state; },
    scrollDOM: view.scrollDOM,
    documentPadding: { top: 4 },
    lineBlockAt: (position: number) => ({ top: (view.state.doc.lineAt(position).number - 1) * 20 }),
    lineBlockAtHeight: (height: number) => ({ from: view.state.doc.line(Math.max(1, Math.min(300, Math.floor(height / 20) + 1))).from }),
    dispatch: (spec: TransactionSpec) => { view.dispatch(spec); },
    requestMeasure: <T>(request: { read: () => T; write?: (value: T) => void }) => {
      helperMeasures.push(() => request.write?.(request.read()));
    },
  };
  const frame = () => {
    const entry = frames.entries().next().value;
    if (entry === undefined) return;
    const [id, callback] = entry;
    frames.delete(id);
    callback(0);
  };
  const drainCore = () => {
    for (let index = 0; index < 30 && frames.size > 0; index += 1) frame();
    if (frames.size > 0) throw new Error("Core measurement did not settle");
  };
  drainCore();
  return { view, adapter, coreScroll, frame, drainCore, measure: () => { helperMeasures.shift()?.(); } };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  if (originalClientRects === undefined) Reflect.deleteProperty(Range.prototype, "getClientRects");
  else Object.defineProperty(Range.prototype, "getClientRects", originalClientRects);
  if (originalBoundingRect === undefined) Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  else Object.defineProperty(Range.prototype, "getBoundingClientRect", originalBoundingRect);
});

describe("reading position with real CodeMirror scheduling", () => {
  it("positive control: the actual core consumes dispatched scroll effects", () => {
    const h = editor();
    try {
      h.view.dispatch({ effects: EditorView.scrollIntoView(h.view.state.doc.line(120).from, { y: "start", yMargin: 0 }) });
      h.drainCore();
      expect(h.coreScroll).toHaveBeenCalled();
      expect(h.view.scrollDOM.scrollTop).toBe(2384);
    } finally { h.view.destroy(); }
  });

  it("leaves no pending core restore to override wheel input after the first positioning frame", () => {
    const h = editor();
    const dispatch = vi.spyOn(h.view, "dispatch");
    const report = vi.fn();
    const stop = trackReadingPosition(h.adapter, 120, report);
    try {
      h.measure();
      h.frame();
      expect(h.view.scrollDOM.scrollTop).toBe(2384);
      // This is precisely the old dispatch→core measure window. Wheel takes
      // ownership before any further core or helper measurement is processed.
      h.view.scrollDOM.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
      h.view.scrollDOM.scrollTop = 400;
      h.view.scrollDOM.dispatchEvent(new Event("scroll"));
      h.drainCore();
      for (let index = 0; index < 10; index += 1) { h.measure(); h.drainCore(); }
      expect(dispatch).not.toHaveBeenCalled();
      expect(h.coreScroll).not.toHaveBeenCalled();
      expect(h.view.scrollDOM.scrollTop).toBe(400);
      expect(report).toHaveBeenLastCalledWith(20);
    } finally { stop(); h.view.destroy(); }
  });
});
