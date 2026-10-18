// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Machine, MachineStatus, SessionInfo, SessionReorderRequest } from "../../api";
import { templateValueAfterMarker, templateValuesAfterMarker } from "../../templateInspection.testSupport";
import { AppNavigationPanel, NAVIGATION_RESOURCE_UNDERBAR_ITEMS, navigationResourceUnderbarItemIsEnabled, shouldShowMachinesSection } from "./AppNavigationPanel";
import { MachineSwitcher } from "../MachineSwitcher";

beforeEach(() => {
  // jsdom has no layout and no scrollIntoView implementation.
  if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  }
});

afterEach(() => {
  // Replacing the body disconnects mounts, which also removes their document listeners.
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function root(panel: AppNavigationPanel): ShadowRoot {
  const shadowRoot = panel.shadowRoot;
  if (shadowRoot === null) throw new Error("Expected an open shadow root");
  return shadowRoot;
}

function panelElement(panel: AppNavigationPanel, selector: string): HTMLElement {
  const found = root(panel).querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`Expected ${selector} inside the navigation panel shadow root`);
  return found;
}

function panelSwitcher(panel: AppNavigationPanel): MachineSwitcher {
  const found = root(panel).querySelector("machine-switcher");
  if (!(found instanceof MachineSwitcher)) throw new Error("Expected the navigation panel machine switcher");
  return found;
}

async function mountPanel(configure: (panel: AppNavigationPanel) => void = () => undefined): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  configure(panel);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function switcherRoot(switcher: MachineSwitcher): ShadowRoot {
  const shadowRoot = switcher.shadowRoot;
  if (shadowRoot === null) throw new Error("Expected an open switcher shadow root");
  return shadowRoot;
}

function remoteMachine(status: MachineStatus = "online"): Machine {
  return { ...machine("remote"), name: "Long remote workstation name", baseUrl: "https://remote.example.test", status };
}

describe("app-navigation-panel wordmark", () => {
  it("renders a large pi symbol beside the WebUI name", async () => {
    const panel = await mountPanel();
    const brand = panelElement(panel, "header .brand");

    expect(brand.getAttribute("aria-label")).toBe("Pi WebUI");
    expect(panelElement(panel, ".brand-symbol").textContent).toBe("π");
    expect(panelElement(panel, ".brand-symbol").getAttribute("aria-hidden")).toBe("true");
    expect(panelElement(panel, ".brand > span:not(.brand-symbol)").textContent).toBe("WebUI");
    expect(root(panel).querySelector(".brand-version")).toBeNull();
    expect(brand.textContent).not.toContain("PI WEBUI");
    expect(AppNavigationPanel.styles.cssText).toMatch(/\.brand-symbol\s*\{[^}]*font-size:\s*28px;/);
  });

  it("renders the current version beside the WebUI name", async () => {
    const panel = await mountPanel((instance) => { instance.version = "1.5.1"; });
    const brand = panelElement(panel, "header .brand");
    const version = panelElement(panel, ".brand-version");

    expect(brand.getAttribute("aria-label")).toBe("Pi WebUI version 1.5.1");
    expect(version.textContent).toBe("v1.5.1");
    expect(Array.from(brand.children).at(-1)).toBe(version);
    expect(AppNavigationPanel.styles.cssText).toMatch(/\.brand-version\s*\{[^}]*font-size:\s*12px;/);
  });
});

describe("app-navigation-panel header machines", () => {
  it("omits the switcher for zero and one machine and renders it for two", async () => {
    const none = await mountPanel();
    expect(root(none).querySelector("machine-switcher")).toBeNull();
    document.body.replaceChildren();

    const one = await mountPanel((panel) => {
      panel.machines = [machine("local")];
      panel.selectedMachine = machine("local");
    });
    expect(root(one).querySelector("machine-switcher")).toBeNull();
    document.body.replaceChildren();

    const two = await mountPanel((panel) => {
      panel.machines = [machine("local"), remoteMachine()];
      panel.selectedMachine = remoteMachine();
    });
    const switcher = panelSwitcher(two);
    expect(switcher.machines.map((entry) => entry.id)).toEqual(["local", "remote"]);
    expect(shouldShowMachinesSection([machine("local")])).toBe(false);
  });

  it("uses the header container query for the version label", () => {
    expect(AppNavigationPanel.styles.cssText).toMatch(/:host\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*navigation-header;/);
    expect(AppNavigationPanel.styles.cssText).toMatch(/@container\s+navigation-header\s*\(inline-size\s*<\s*372px\)\s*\{\s*\.brand-version\s*\{\s*display:\s*none;\s*\}\s*\}/);
  });
});

describe("app-navigation-panel machine callback forwarding", () => {
  it("forwards machine selection, removal, section focus, cancellation, and actions once", async () => {
    const onSelectMachine = vi.fn();
    const onRemoveMachine = vi.fn();
    const onFocusNavigationTarget = vi.fn();
    const onCancelKeyboardNavigation = vi.fn();
    const onShowActions = vi.fn();
    const local = machine("local");
    const remote = remoteMachine();
    const panel = await mountPanel((instance) => {
      instance.machines = [local, remote];
      instance.selectedMachine = remote;
      instance.onSelectMachine = onSelectMachine;
      instance.onRemoveMachine = onRemoveMachine;
      instance.onFocusNavigationTarget = onFocusNavigationTarget;
      instance.onCancelKeyboardNavigation = onCancelKeyboardNavigation;
      instance.onShowActions = onShowActions;
    });
    const switcher = panelSwitcher(panel);
    await switcher.updateComplete;
    const switcherShadow = switcherRoot(switcher);

    const trigger = switcherShadow.querySelector<HTMLElement>(".machine-switcher-button");
    if (trigger === null) throw new Error("Expected the selected machine button");
    trigger.click();
    await switcher.updateComplete;

    const localOption = switcherShadow.querySelector<HTMLElement>('.machine-option-main[data-machine-id="local"]');
    if (localOption === null) throw new Error("Expected the local machine option");
    localOption.click();
    expect(onSelectMachine).toHaveBeenCalledOnce();
    expect(onSelectMachine).toHaveBeenCalledWith(local);

    trigger.click();
    await switcher.updateComplete;
    const actionsToggle = switcherShadow.querySelector<HTMLElement>(".machine-option-actions-toggle");
    if (actionsToggle === null) throw new Error("Expected the remote machine actions toggle");
    actionsToggle.click();
    await switcher.updateComplete;
    const remove = switcherShadow.querySelector<HTMLElement>(".machine-option-actions-panel button.danger");
    if (remove === null) throw new Error("Expected the remote machine remove control");
    remove.click();
    expect(onRemoveMachine).toHaveBeenCalledOnce();
    expect(onRemoveMachine).toHaveBeenCalledWith(remote);

    trigger.click();
    await switcher.updateComplete;
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true, composed: true }));
    expect(onFocusNavigationTarget).toHaveBeenCalledOnce();
    expect(onFocusNavigationTarget).toHaveBeenCalledWith("projects");

    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    expect(onCancelKeyboardNavigation).toHaveBeenCalledOnce();

    panelElement(panel, '.header-actions button[aria-label="Show Actions"]').click();
    expect(onShowActions).toHaveBeenCalledOnce();
  });

  it("keeps the machines focus target pointed at the rendered switcher", async () => {
    const remote = remoteMachine();
    const panel = await mountPanel((instance) => {
      instance.machines = [machine("local"), remote];
      instance.selectedMachine = remote;
    });
    const switcher = panelSwitcher(panel);

    await expect(panel.focusSection("machines")).resolves.toBe(true);
    await switcher.updateComplete;
    const selectedOption = switcherRoot(switcher).querySelector(".machine-option.selected .machine-option-main");
    if (selectedOption === null) throw new Error("Expected the selected machine option");
    expect(selectedOption.getAttribute("data-machine-id")).toBe("remote");
    expect(switcherRoot(switcher).activeElement).toBe(selectedOption);
  });
});

describe("app-navigation-panel resource underbar", () => {
  it("defines the static Models, Skills, and Plugins controls in display order", () => {
    expect(NAVIGATION_RESOURCE_UNDERBAR_ITEMS).toEqual([
      { id: "models", label: "Models" },
      { id: "skills", label: "Skills" },
      { id: "plugins", label: "Plugins" },
    ]);
    expect(AppNavigationPanel.styles.cssText).toMatch(/grid-template-columns:\s*repeat\(3,/);
  });

  it("keeps the resource underbar pinned when Sessions is collapsed", () => {
    expect(AppNavigationPanel.styles.cssText).toMatch(/\.resource-underbar\s*\{[^}]*margin-top:\s*auto;/);
  });

  it("enables Models and enables workspace-scoped Skills and Plugins", () => {
    expect(navigationResourceUnderbarItemIsEnabled("models", false)).toBe(true);
    expect(navigationResourceUnderbarItemIsEnabled("skills", true)).toBe(true);
    expect(navigationResourceUnderbarItemIsEnabled("skills", false)).toBe(false);
    expect(navigationResourceUnderbarItemIsEnabled("plugins", true)).toBe(true);
    expect(navigationResourceUnderbarItemIsEnabled("plugins", false)).toBe(false);
  });

});

describe("app-navigation-panel project creation", () => {
  // The Node test environment has no DOM harness, so inspect the custom-element
  // callback boundary rather than testing Lit internals or layout.
  it("forwards the Projects section add action to the application", () => {
    const panel = new AppNavigationPanel();
    const onAddProject = vi.fn();
    panel.onAddProject = onAddProject;

    const onAdd = templateValueAfterMarker(panel.render(), ".onAdd=");
    if (!isCallback(onAdd)) throw new Error("Expected ProjectList add callback");
    onAdd();

    expect(onAddProject).toHaveBeenCalledOnce();
  });
});

describe("app-navigation-panel expanded project browser", () => {
  // The Node test environment has no DOM harness, so inspect the custom-element
  // callback boundary rather than testing Lit internals or layout.
  it("forwards the expanded project browser action from ProjectList", () => {
    const panel = new AppNavigationPanel();
    const onOpenProjectBrowser = vi.fn();
    panel.onOpenProjectBrowser = onOpenProjectBrowser;
    const onOpenExpanded = projectBrowserOpenCallback(templateValueAfterMarker(panel.render(), ".onOpenExpanded="));
    const restoreFocus = () => undefined;

    onOpenExpanded(restoreFocus);

    expect(onOpenProjectBrowser).toHaveBeenCalledOnce();
    expect(onOpenProjectBrowser).toHaveBeenCalledWith(restoreFocus);
  });
});

describe("app-navigation-panel expanded session browser", () => {
  // The Node test environment has no DOM harness, so inspect the custom-element
  // callback boundary rather than testing Lit internals or layout.
  it("forwards the expanded session browser action only when the project-scoped callback is available", () => {
    const panel = new AppNavigationPanel();
    const onOpenSessionBrowser = vi.fn();
    panel.onOpenSessionBrowser = onOpenSessionBrowser;
    const callbacks = templateValuesAfterMarker(panel.render(), ".onOpenExpanded=");
    const onOpenExpanded = projectBrowserOpenCallback(callbacks.at(-1));
    const restoreFocus = () => undefined;

    onOpenExpanded(restoreFocus);

    expect(onOpenSessionBrowser).toHaveBeenCalledOnce();
    expect(onOpenSessionBrowser).toHaveBeenCalledWith(restoreFocus);
  });
});

describe("app-navigation-panel session reorder wiring", () => {
  // The Node test environment has no DOM harness, so inspect the custom-element
  // callback boundary rather than testing Lit internals or layout.
  it("forwards session reorder capability and requests to SessionList", async () => {
    const panel = new AppNavigationPanel();
    const pending = Promise.resolve();
    const onReorderSession = vi.fn(() => pending);
    panel.canReorderSessions = true;
    panel.onReorderSession = onReorderSession;
    const rendered = panel.render();

    expect(templateValueAfterMarker(rendered, ".canReorder=")).toBe(true);
    const callback = templateValueAfterMarker(rendered, ".onReorder=");
    if (!isReorderCallback(callback)) throw new Error("Expected SessionList reorder callback");
    const selected = sessionFixture("selected");
    const request = reorderRequestFixture(selected);
    expect(callback(selected, request)).toBe(pending);
    await pending;

    expect(onReorderSession).toHaveBeenCalledWith(selected, request);
  });
});

describe("shouldShowMachinesSection", () => {
  it("hides machine navigation when there is no machine choice", () => {
    expect(shouldShowMachinesSection([])).toBe(false);
    expect(shouldShowMachinesSection([machine("local")])).toBe(false);
  });

  it("shows machine navigation when there are multiple machines", () => {
    expect(shouldShowMachinesSection([machine("local"), machine("remote-a")])).toBe(true);
  });
});

type ProjectBrowserOpenCallback = (restoreFocus: () => void) => void;

function projectBrowserOpenCallback(value: unknown): ProjectBrowserOpenCallback {
  if (!isProjectBrowserOpenCallback(value)) throw new Error("Expected expanded project browser callback");
  return value;
}

function isProjectBrowserOpenCallback(value: unknown): value is ProjectBrowserOpenCallback {
  return typeof value === "function";
}

function isCallback(value: unknown): value is () => void {
  return typeof value === "function";
}

function isReorderCallback(value: unknown): value is (session: SessionInfo, input: SessionReorderRequest) => void | Promise<void> {
  return typeof value === "function";
}

function sessionFixture(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/sessions/${id}.jsonl`,
    persisted: true,
    created: "now",
    modified: "now",
    messageCount: 0,
    firstMessage: id,
  };
}

function reorderRequestFixture(selected: SessionInfo): SessionReorderRequest {
  return {
    cwd: selected.cwd,
    scope: { kind: "root", cwd: selected.cwd },
    pinned: false,
    catalogCwds: [selected.cwd],
    orderedSessions: [{ id: selected.id, cwd: selected.cwd }],
  };
}

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}
