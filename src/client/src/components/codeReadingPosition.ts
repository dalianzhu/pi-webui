import type { EditorState } from "@codemirror/state";

interface ReadingPositionView {
  state: EditorState;
  scrollDOM: HTMLElement;
  documentPadding: { top: number };
  lineBlockAt(pos: number): { top: number };
  lineBlockAtHeight(height: number): { from: number };
  requestMeasure<T>(request: { key?: object; read: () => T; write?: (value: T) => void }): void;
}

/** Owns one editor's visibility-aware restore and visible-line observation. */
export function trackReadingPosition(view: ReadingPositionView, initialLine: number, report: ((line: number) => void) | undefined): () => void {
  let targetLine = Math.max(1, Math.min(view.state.doc.lines, Number.isSafeInteger(initialLine) ? initialLine : 1));
  let stopped = false;
  let ready = false;
  let restoring = false;
  let generation = 0;
  let pendingLine: number | undefined;
  let frame: number | undefined;
  const scrollMeasureKey = {};
  const hasLayout = () => view.scrollDOM.isConnected && view.scrollDOM.clientWidth > 0 && view.scrollDOM.clientHeight > 0;
  const visibleLine = () => {
    const height = Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top);
    return view.state.doc.lineAt(view.lineBlockAtHeight(height).from).number;
  };
  const flushCachedLine = () => {
    const line = pendingLine;
    pendingLine = undefined;
    if (line !== undefined) report?.(line);
  };
  const suspend = () => {
    generation += 1;
    ready = false;
    restoring = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    // This sample was captured while attached and visible. Never sample a
    // hidden/detached scroller: Chrome can already have reset scrollTop to zero.
    flushCachedLine();
  };
  const current = (token: number) => {
    if (stopped || token !== generation) return false;
    if (hasLayout()) return true;
    suspend();
    return false;
  };
  const onScroll = () => {
    if (stopped || !ready) return;
    if (!hasLayout()) { suspend(); return; }
    const token = generation;
    // Cache before navigation can detach the editor. Refine after CodeMirror's
    // virtualized layout measurement, but teardown uses only this valid cache.
    const sampled = visibleLine();
    if (!current(token)) return;
    targetLine = sampled;
    pendingLine = sampled;
    view.requestMeasure({
      key: scrollMeasureKey,
      read: () => current(token) && ready ? visibleLine() : undefined,
      write: (line) => {
        if (!current(token) || !ready || line === undefined) return;
        targetLine = line;
        pendingLine = line;
        flushCachedLine();
      },
    });
  };
  const onInteraction = () => {
    if (stopped || !hasLayout()) return;
    generation += 1;
    ready = true;
    restoring = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    // A click/key can take ownership without producing a scroll event. Adopt
    // that viewport now so a later hide/show cannot revive initialLine.
    onScroll();
  };
  const interactions = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  for (const event of interactions) view.scrollDOM.addEventListener(event, onInteraction, { passive: true });

  const beginRestore = () => {
    if (stopped || ready || restoring || !hasLayout()) return;
    restoring = true;
    const token = ++generation;
    const position = view.state.doc.line(targetLine).from;
    view.requestMeasure({
      read: () => current(token) ? view.lineBlockAt(position).top + view.documentPadding.top : undefined,
      write: (estimatedTop) => {
        if (estimatedTop === undefined || !current(token)) return;
        // Move to the estimated block, let CodeMirror render/measure it, then
        // align to its measured top below. Do not dispatch scrollIntoView: its
        // queued core scrollTarget would outlive a user's cancellation token.
        frame = requestAnimationFrame(() => {
          if (!current(token)) return;
          view.scrollDOM.scrollTop = Math.ceil(estimatedTop);
          view.requestMeasure({
            read: () => current(token),
            write: (rendered) => {
              if (!rendered || !current(token)) return;
              frame = requestAnimationFrame(() => {
                if (!current(token)) return;
                view.requestMeasure({
                  read: () => current(token) ? view.lineBlockAt(position).top + view.documentPadding.top : undefined,
                  write: (top) => {
                    if (top === undefined || !current(token)) return;
                    // Round into the target line, never to the preceding line's
                    // last fractional pixel on quantized browser scrollers.
                    view.scrollDOM.scrollTop = Math.ceil(top);
                    frame = requestAnimationFrame(() => {
                      if (!current(token)) return;
                      restoring = false;
                      ready = true;
                      onScroll();
                    });
                  },
                });
              });
            },
          });
        });
      },
    });
  };
  const observer = new ResizeObserver(() => {
    if (stopped) return;
    if (!hasLayout()) {
      if (ready || restoring) suspend();
    } else beginRestore();
  });
  observer.observe(view.scrollDOM);
  beginRestore();

  return () => {
    // Invalidate queued reads before reporting; report callbacks must not revive
    // an old measurement. No DOM/layout reads are safe in disconnectedCallback.
    stopped = true;
    generation += 1;
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    view.scrollDOM.removeEventListener("scroll", onScroll);
    for (const event of interactions) view.scrollDOM.removeEventListener(event, onInteraction);
    flushCachedLine();
  };
}
