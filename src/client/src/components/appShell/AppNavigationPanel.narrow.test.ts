// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Machine, MachineHealth, MachineStatus, WorkspaceActivity } from "../../api";
import { MachineSwitcher } from "../MachineSwitcher";
import { AppNavigationPanel } from "./AppNavigationPanel";
import { AppRefreshControl } from "./AppRefreshControl";

const time = "2026-10-17T00:00:00.000Z";
const localMachine: Machine = { id: "local", name: "Local", kind: "local", createdAt: time, updatedAt: time, status: "online" };
const remoteMachine: Machine = { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.example.test", createdAt: time, updatedAt: time, status: "offline" };
const longNameMachine: Machine = { id: "long", name: "Remote machine with a deliberately very long name that must stay inside its label allocation", kind: "remote", baseUrl: "https://long.example.test", createdAt: time, updatedAt: time, status: "error" };
const unknownStatusMachine: Machine = { id: "unknown", name: "Unknown", kind: "remote", createdAt: time, updatedAt: time };
const machines: Machine[] = [localMachine, remoteMachine, longNameMachine, unknownStatusMachine];
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  else Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
});

function root(element: Element): ShadowRoot {
  if (element.shadowRoot === null) throw new Error("Expected real component shadow root");
  return element.shadowRoot;
}
function required(parent: ParentNode, selector: string): HTMLElement {
  const element = parent.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}
function requiredButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const element = required(parent, selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing ${selector}`);
  return element;
}
function switcher(panel: AppNavigationPanel): MachineSwitcher {
  const element = root(panel).querySelector("machine-switcher");
  if (!(element instanceof MachineSwitcher)) throw new Error("Missing machine-switcher");
  return element;
}
async function settle(panel: AppNavigationPanel): Promise<void> {
  await panel.updateComplete;
  const child = root(panel).querySelector<MachineSwitcher>("machine-switcher");
  if (child !== null) {
    await child.updateComplete;
    await Promise.resolve();
    await child.updateComplete;
  }
  const refresh = root(panel).querySelector<AppRefreshControl>("app-refresh-control");
  if (refresh !== null) await refresh.updateComplete;
}
interface MountOptions {
  machines?: Machine[];
  selectedMachine?: Machine | undefined;
  machineStatuses?: Record<string, MachineHealth>;
  machineActivities?: Record<string, Record<string, WorkspaceActivity>>;
  version?: string | undefined;
}
async function mount(options: MountOptions = {}, refresh = false) {
  const panel = new AppNavigationPanel();
  const onSelect = vi.fn();
  const onNext = vi.fn();
  const onActions = vi.fn();
  const onReload = vi.fn();
  Object.assign(panel, { machines: [...machines], selectedMachine: localMachine, version: "1.26.0" }, options);
  panel.onSelectMachine = onSelect;
  panel.onFocusNavigationTarget = onNext;
  panel.onShowActions = onActions;
  if (refresh) {
    const control = new AppRefreshControl();
    control.onReload = onReload;
    panel.refreshControl = control;
  }
  document.body.append(panel);
  await settle(panel);
  return { panel, onSelect, onNext, onActions, onReload };
}
function health(status: MachineStatus): Record<string, MachineHealth> {
  return { local: { machineId: "local", status, ok: status !== "online", checkedAt: time, error: "not a health-state input" } };
}
function activity(session: boolean, terminal: boolean): Record<string, Record<string, WorkspaceActivity>> {
  return { local: { fixture: { cwd: "/fixture", hasSessionActivity: session, hasTerminalActivity: terminal, updatedAt: time } } };
}
async function key(panel: AppNavigationPanel, target: HTMLElement, value: string): Promise<void> {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, composed: true, cancelable: true }));
  await settle(panel);
}
function button(panel: AppNavigationPanel): HTMLButtonElement {
  return requiredButton(root(switcher(panel)), ".machine-switcher-button");
}
function option(panel: AppNavigationPanel, id: string): HTMLButtonElement {
  return requiredButton(root(switcher(panel)), `.machine-option-main[data-machine-id="${id}"]`);
}

describe("expanded navigation header real DOM", () => {
  it("keeps brand semantics, Actions text and supplied refresh callbacks", async () => {
    const { panel, onActions, onReload } = await mount({}, true);
    const dom = root(panel);
    expect(required(dom, ".brand").getAttribute("aria-label")).toBe("Pi WebUI version 1.26.0");
    expect(required(dom, ".brand-symbol").textContent).toBe("π");
    expect(required(dom, ".brand-symbol").getAttribute("aria-hidden")).toBe("true");
    expect(required(dom, ".brand-wordmark").textContent).toBe("WebUI");
    expect(required(dom, ".brand-version").textContent).toBe("v1.26.0");
    const actions = requiredButton(dom, ".header-actions > button");
    expect(actions.textContent.trim()).toBe("Actions");
    expect(actions.title).toBe("Show Actions");
    expect(actions.getAttribute("aria-label")).toBe("Show Actions");
    const refresh = required(dom, "app-refresh-control");
    if (!(refresh instanceof AppRefreshControl)) throw new Error("Missing app-refresh-control");
    const reload = requiredButton(root(refresh), ".app-refresh-button");
    expect(reload.title).toBe("Full page reload");
    expect(reload.getAttribute("aria-label")).toBe("Full page reload");
    expect(root(refresh).querySelector(".app-refresh-icon")).not.toBeNull();
    actions.click();
    reload.click();
    expect(onActions).toHaveBeenCalledExactlyOnceWith();
    expect(onReload).toHaveBeenCalledExactlyOnceWith();
    panel.version = undefined;
    await settle(panel);
    expect(required(dom, ".brand").getAttribute("aria-label")).toBe("Pi WebUI");
    expect(dom.querySelector(".brand-version")).toBeNull();
    expect(required(dom, ".brand-wordmark").textContent).toBe("WebUI");
  });

  it.each<MachineStatus>(["online", "offline", "error", "unknown"])("describes %s independently of color and health.ok", async (status) => {
    const { panel } = await mount({ machineStatuses: health(status) });
    const selected = button(panel);
    expect(selected.type).toBe("button");
    expect(selected.getAttribute("aria-label")).toBe("Machine: Local. Switch machine.");
    expect(selected.getAttribute("aria-expanded")).toBe("false");
    expect(selected.getAttribute("aria-describedby")).toBe("machine-status-description");
    const description = required(root(switcher(panel)), "#machine-status-description");
    expect(description.textContent.trim()).toBe(`Machine status: ${status}.`);
    expect(description.getAttribute("aria-hidden")).not.toBe("true");
    expect(description.hidden).toBe(false);
    // jsdom does not cascade shadow-root <style> rules, so computed-style hiding is not asserted here.
    // Real visual hiding is covered by the browser acceptance gate.
    const indicator = required(selected, ".machine-status");
    expect(indicator.title).toBe(status);
    expect(indicator.textContent).toBe(status);
    expect(indicator.classList.contains(status)).toBe(true);
  });

  it("preserves own-status, unknown, local, and first-machine fallbacks", async () => {
    const { panel } = await mount({ selectedMachine: remoteMachine, machineStatuses: {} });
    expect(required(root(switcher(panel)), "#machine-status-description").textContent.trim()).toBe("Machine status: offline.");
    expect(button(panel).title).toBe("https://remote.example.test");
    panel.selectedMachine = unknownStatusMachine;
    await settle(panel);
    expect(required(root(switcher(panel)), "#machine-status-description").textContent.trim()).toBe("Machine status: unknown.");
    // exactOptionalPropertyTypes forbids assigning undefined to the optional property directly.
    Reflect.set(panel, "selectedMachine", undefined);
    await settle(panel);
    expect(button(panel).getAttribute("aria-label")).toBe("Machine: Local. Switch machine.");
    panel.machines = machines.slice(1);
    await settle(panel);
    expect(button(panel).getAttribute("aria-label")).toBe("Machine: Remote. Switch machine.");
  });

  it("falls back to the local machine when it is not the first entry", async () => {
    const { panel } = await mount({ machines: [remoteMachine, localMachine], selectedMachine: undefined });
    expect(button(panel).getAttribute("aria-label")).toBe("Machine: Local. Switch machine.");
  });

  it.each([
    ["online", true, true, "session", "Machine active"],
    ["unknown", true, false, "session", "Machine active"],
    ["online", false, true, "terminal", "Machine terminal active"],
    ["unknown", false, true, "terminal", "Machine terminal active"],
    ["online", false, false, undefined, undefined],
    ["offline", true, true, undefined, undefined],
    ["error", true, true, undefined, undefined],
  ] as const)("preserves activity for %s, session=%s, terminal=%s", async (status, session, terminal, kind, label) => {
    const { panel } = await mount({ machineStatuses: health(status), machineActivities: activity(session, terminal) });
    const indicator = button(panel).querySelector(".activity-indicator");
    if (kind === undefined) expect(indicator).toBeNull();
    else {
      expect(indicator?.classList.contains(kind)).toBe(true);
      expect(indicator?.getAttribute("role")).toBe("img");
      expect(indicator?.getAttribute("aria-label")).toBe(label);
      expect(indicator?.getAttribute("title")).toBe(label);
      expect(indicator?.classList.contains(kind === "session" ? "terminal" : "session")).toBe(false);
    }
  });

  it("lists complete menu details and forwards one selection; outside click and disconnect clean up", async () => {
    const { panel, onSelect } = await mount();
    const child = switcher(panel);
    button(panel).click();
    await settle(panel);
    const options = [...root(child).querySelectorAll<HTMLButtonElement>(".machine-option-main")];
    expect(options.map((entry) => entry.dataset["machineId"])).toEqual(machines.map((machine) => machine.id));
    for (const [index, machine] of machines.entries()) {
      const entry = options[index];
      expect(entry?.querySelector(".machine-option-name")?.textContent).toContain(machine.name);
      expect(entry?.querySelector("small")?.textContent).toBe(`${machine.kind === "local" ? "Local Pi WebUI" : machine.baseUrl ?? "Remote Pi WebUI"} · ${machine.status ?? "unknown"}`);
    }
    option(panel, "remote").click();
    await settle(panel);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(remoteMachine);
    expect(root(child).querySelector(".machine-switcher-menu")).toBeNull();
    button(panel).click();
    await settle(panel);
    document.body.click();
    await settle(panel);
    expect(root(child).querySelector(".machine-switcher-menu")).toBeNull();
    expect(onSelect).toHaveBeenCalledTimes(1);
    const remove = vi.spyOn(document, "removeEventListener");
    child.remove();
    const clicks = remove.mock.calls.filter(([type]) => type === "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.[1]).toEqual(expect.any(Function));
  });

  it.each(["ArrowDown", "ArrowUp"])("opens with %s, focuses selected, clamps options and restores focus", async (openingKey) => {
    const { panel, onNext, onSelect } = await mount({ selectedMachine: remoteMachine });
    const child = switcher(panel);
    button(panel).focus();
    await key(panel, button(panel), openingKey);
    expect(root(child).activeElement).toBe(option(panel, "remote"));
    await key(panel, option(panel, "remote"), "ArrowDown");
    expect(root(child).activeElement).toBe(option(panel, "long"));
    await key(panel, option(panel, "long"), "ArrowUp");
    expect(root(child).activeElement).toBe(option(panel, "remote"));
    await key(panel, option(panel, "remote"), "Home");
    await key(panel, option(panel, "local"), "ArrowUp");
    expect(root(child).activeElement).toBe(option(panel, "local"));
    await key(panel, option(panel, "local"), "End");
    await key(panel, option(panel, "unknown"), "ArrowDown");
    expect(root(child).activeElement).toBe(option(panel, "unknown"));
    await key(panel, option(panel, "unknown"), openingKey === "ArrowDown" ? "Escape" : "ArrowLeft");
    expect(root(child).querySelector(".machine-switcher-menu")).toBeNull();
    expect(root(child).activeElement).toBe(button(panel));
    expect(onNext).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(["ArrowDown", "ArrowUp"])("focuses first option with %s when none is selected", async (openingKey) => {
    const { panel } = await mount({ selectedMachine: undefined });
    await key(panel, button(panel), openingKey);
    expect(root(switcher(panel)).activeElement).toBe(option(panel, "local"));
  });

  it("forwards ArrowRight exactly once from the selector and from an option", async () => {
    const { panel, onNext, onSelect } = await mount();
    await key(panel, button(panel), "ArrowRight");
    expect(onNext).toHaveBeenCalledExactlyOnceWith("projects");
    await key(panel, button(panel), "ArrowDown");
    await key(panel, option(panel, "local"), "ArrowRight");
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onNext).toHaveBeenLastCalledWith("projects");
    expect(onSelect).not.toHaveBeenCalled();
    expect(root(switcher(panel)).querySelector(".machine-switcher-menu")).toBeNull();
  });

  it.each([0, 1])("omits the selector for %i configured machines", async (count) => {
    const { panel } = await mount({ machines: machines.slice(0, count) });
    expect(root(panel).querySelector("machine-switcher")).toBeNull();
    expect(root(panel).querySelector("app-refresh-control")).toBeNull();
  });
});
