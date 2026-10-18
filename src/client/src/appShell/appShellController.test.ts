import type { ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_RAIL_DESKTOP_MEDIA_QUERY, AppShellController } from "./appShellController";

class FakeMediaQueryListEvent extends Event {
  readonly media = ACTIVITY_RAIL_DESKTOP_MEDIA_QUERY;

  constructor(readonly matches: boolean) {
    super("change");
  }
}

class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media = ACTIVITY_RAIL_DESKTOP_MEDIA_QUERY;
  onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null;
  private readonly changeListeners = new Set<EventListenerOrEventListenerObject>();

  constructor(public matches: boolean) {
    super();
  }

  addListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
    if (listener !== null) this.addEventListener("change", listener);
  }

  removeListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
    if (listener !== null) this.removeEventListener("change", listener);
  }

  override addEventListener<K extends keyof MediaQueryListEventMap>(
    type: K,
    listener: (this: MediaQueryList, event: MediaQueryListEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    super.addEventListener(type, listener, options);
    if (type === "change") this.changeListeners.add(listener);
  }

  override removeEventListener<K extends keyof MediaQueryListEventMap>(
    type: K,
    listener: (this: MediaQueryList, event: MediaQueryListEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, listener, options);
    if (type === "change") this.changeListeners.delete(listener);
  }

  dispatchChange(matches: boolean): void {
    this.matches = matches;
    const event = new FakeMediaQueryListEvent(matches);
    this.dispatchEvent(event);
    this.onchange?.call(this, event);
  }

  listenerCount(): number {
    return this.changeListeners.size;
  }
}

class FakeHost implements ReactiveControllerHost {
  readonly addController = vi.fn<ReactiveControllerHost["addController"]>();
  readonly removeController = vi.fn<ReactiveControllerHost["removeController"]>();
  readonly requestUpdate = vi.fn();
  readonly updateComplete = Promise.resolve(true);
}

describe("AppShellController", () => {
  it("updates the desktop-rail layout signal and removes its media listener when disconnected", () => {
    const activityRailDesktopMedia = new FakeMediaQueryList(false);
    const host = new FakeHost();
    const controller = new AppShellController(host, {
      activityRailDesktopMedia,
      pwaDisplayModeMedia: [],
    });

    controller.hostConnected();
    expect(controller.isDesktopActivityRailLayout).toBe(false);

    activityRailDesktopMedia.dispatchChange(true);

    expect(controller.isDesktopActivityRailLayout).toBe(true);
    expect(host.requestUpdate).toHaveBeenCalledOnce();

    controller.hostDisconnected();

    expect(activityRailDesktopMedia.listenerCount()).toBe(0);

    host.requestUpdate.mockClear();
    activityRailDesktopMedia.dispatchChange(false);

    expect(controller.isDesktopActivityRailLayout).toBe(true);
    expect(host.requestUpdate).not.toHaveBeenCalled();
  });

  describe("PWA refresh placement", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    for (const width of [760, 761, 1180, 1181]) {
      for (const pwa of [false, true]) {
        it(`places refresh at ${String(width)}px with PWA=${String(pwa)}`, () => {
          // Node's navigator has no iOS standalone flag, but stub it anyway so a
          // changed host default cannot hide a breakpoint error.
          vi.stubGlobal("navigator", {});
          const controller = new AppShellController(new FakeHost(), {
            mobileNavigationMedia: new FakeMediaQueryList(width <= 760),
            activityRailDesktopMedia: new FakeMediaQueryList(width >= 1181),
            pwaDisplayModeMedia: [new FakeMediaQueryList(pwa)],
          });
          expect(controller.shouldShowAppRefreshInRail()).toBe(pwa && width > 760);
          expect(controller.shouldShowAppRefreshInContextBar()).toBe(pwa && width < 1181);
          expect("shouldShowAppRefreshInHeader" in controller).toBe(false);
        });
      }
    }

    it("refreshes the placement predicates and removes every listener on layout changes", () => {
      vi.stubGlobal("navigator", {});
      const mobileNavigationMedia = new FakeMediaQueryList(false);
      const activityRailDesktopMedia = new FakeMediaQueryList(true);
      const pwaDisplayModeMedia = new FakeMediaQueryList(false);
      const host = new FakeHost();
      const controller = new AppShellController(host, {
        mobileNavigationMedia,
        activityRailDesktopMedia,
        pwaDisplayModeMedia: [pwaDisplayModeMedia],
      });

      controller.hostConnected();
      // Wide layout, not a PWA: no refresh control anywhere.
      expect(controller.shouldShowAppRefreshInRail()).toBe(false);
      expect(controller.shouldShowAppRefreshInContextBar()).toBe(false);

      // Same width installed as a PWA: the persistent rail owns the control.
      pwaDisplayModeMedia.dispatchChange(true);
      expect(controller.shouldShowAppRefreshInRail()).toBe(true);
      expect(controller.shouldShowAppRefreshInContextBar()).toBe(false);
      expect(host.requestUpdate).toHaveBeenCalledTimes(1);

      // 1180px: the stack layout shows the context bar; the drawer's rail keeps its action.
      activityRailDesktopMedia.dispatchChange(false);
      expect(controller.shouldShowAppRefreshInRail()).toBe(true);
      expect(controller.shouldShowAppRefreshInContextBar()).toBe(true);
      expect(host.requestUpdate).toHaveBeenCalledTimes(2);

      // 760px: the context bar only.
      mobileNavigationMedia.dispatchChange(true);
      expect(controller.shouldShowAppRefreshInRail()).toBe(false);
      expect(controller.shouldShowAppRefreshInContextBar()).toBe(true);
      expect(host.requestUpdate).toHaveBeenCalledTimes(3);

      controller.hostDisconnected();
      expect(mobileNavigationMedia.listenerCount()).toBe(0);
      expect(activityRailDesktopMedia.listenerCount()).toBe(0);
      expect(pwaDisplayModeMedia.listenerCount()).toBe(0);
    });
  });
});
