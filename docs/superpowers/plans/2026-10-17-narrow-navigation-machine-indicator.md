# Narrow Navigation Machine Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the deterministic
> subagent-driven-development controller to implement this plan task-by-task.
> Leave the checkboxes unchanged; the controller owns execution state.

**Goal:** Keep the expanded navigation machine selector readable and accessible at its real minimum desktop column without changing machine interaction or state ownership.

**Architecture:** Make a local CSS/container-query and internal-markup change in the two existing components. Real-DOM tests pin semantics and existing interaction; a separate offline raw-CDP fixture proves geometry, native keyboard activation, resize preservation, and an old-source negative control. Both tasks belong to the sequential `navigation` lane; no application controller or shared layout abstraction is added.

**Tech Stack:** Existing TypeScript, Lit, Vitest/jsdom, Vite, Node native WebSocket/CDP, and locally installed Chromium. Node remains `>=22.19.0`; package version remains `1.26.0`.

### Approved Inputs And Inspection Baseline

- Design: `docs/superpowers/specs/2026-10-17-narrow-navigation-machine-indicator-design.md`.
- Approved specification: `docs/superpowers/specs/2026-10-17-narrow-navigation-machine-indicator-spec.md`; user approval: `I approve it!`.
- Inspected integration revision: `5f8e27e9859cafe75c7c325b4b657fce0f8eb8d9`. Both production modules at this revision are the original one-row implementation. Line ranges below refer to this baseline.
- Inspected real implementations: `AppNavigationPanel.ts:120-150,274-306`, `MachineSwitcher.ts:45-82,124-271,274-334`, `AppRefreshControl.ts:1-42`, `shared.ts:86-150`, `src/client/index.html:11-58`, `workspaceActivity.ts:1-35`, and `activityBadge.ts:1-20`.
- Existing patterns: `ActivityRail.compactFocus.test.ts` supplies real shadow-root focus testing; `scripts/capture-screenshots.mjs:355-543` supplies native Node WebSocket CDP and Chromium process patterns. This harness adds bounds to every external wait rather than copying that script's unbounded requests or swallowed navigation failures.
- CodeGraph was attempted with the explicit integration project path; this worktree has no index. Direct source inspection is the substantiated fallback, not an implementation blocker.

### File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/client/src/components/appShell/AppNavigationPanel.ts` | Container, wordmark class, narrow header grid only | 1 |
| `src/client/src/components/MachineSwitcher.ts` | Internal status description/tooltip and selected-only dot CSS | 1 |
| `src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts` | Real component DOM, health/activity, callbacks, focus, cleanup | 1 |
| `.changeset/narrow-navigation-machine-indicator.md` | Exact approved patch note | 1 |
| `scripts/verify-narrow-navigation-machine-indicator.mjs` | Standalone offline fixture, bounded raw-CDP runner, geometry/native interaction/overlay gate | 2 |
| `package.json` | Exactly one additional browser verification script | 2 |

### Spec-To-Task Coverage

| Specification | Implementing task and evidence |
| --- | --- |
| 1, 2.1-2.3, 5: ownership, container box, boundary, narrow grid, compact unchanged | Task 1 source patches; Task 2 measured minimum/boundary/wider matrices |
| 2.4: exact name, health description, tooltip, status fallback/colors | Task 1 real-DOM health/fallback cases and selected-only CSS; Task 2 visible dot/word checks |
| 2.5: activity precedence, complete menu, callbacks, clamped navigation, cleanup | Task 1 real-DOM interaction tests; Task 2 native input and menu checks |
| 2.5, 3: CSS-only open-menu/focus preservation and newly anchored reopening | Task 2 identity/counter checks while resizing and measured fixed-menu reopen checks |
| 3, 4.2: actual shell/font/tokens, 180/44/136/120, 1600x900, all states | Task 2 real-shadow-host fixture and geometry matrices |
| 4.1: jsdom lifecycle/cleanup, no template extraction or layout claims | Task 1 complete new real-DOM test file |
| 4.2-4.3: separate command, offline lifecycle, old-module overlay failure | Task 2 self-contained script, exact overlay mapping/revision, geometry-first negative control |
| 6: focused serial checks and one final repository gate | Task 1 focused red/green; Task 2 serial focused/typecheck/lint/browser, then one `npm run verify` before PM audit |
| 7-8: UI-only operations, no restart, exact patch Changeset | Global Constraints and Task 1 fragment; Task 2 never starts application services |

## Global Constraints

- Work only in the supplied PM-owned task cwd (the isolated lane worktree during SDD). The planner writes only this plan; implementation workers touch only their task allowlists. Do not edit the delivery checkout or mutate Git during planning. Parent owns commit/push and orchestration; commit blocks below are parent-only handoff instructions, not worker authorization. Do not spawn children from a task.
- Production edits are limited to `src/client/src/components/appShell/AppNavigationPanel.ts` and `src/client/src/components/MachineSwitcher.ts`. The implementation may add `src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts`, `scripts/verify-narrow-navigation-machine-indicator.mjs`, one script entry in `package.json`, and `.changeset/narrow-navigation-machine-indicator.md`. No other production source file is in scope.
- Do not modify `MachineList` or compact/mobile machine navigation; `AppRefreshControl`, including its 36px button, icon, label, or callback; `src/client/src/components/shared.ts`, including `appStyles` and the 44px desktop activity-rail reserve; or `src/client/src/appShell/panelResizeController.ts`, including the 180px minimum and 340px default navigation widths.
- Do not modify `PiWebUiApp.ts`, app-shell state, routes, API clients, machine persistence, config, `src/server/sessiond.ts`, session-daemon ownership, daemon protocol, or session runtime. Do not change package dependencies, `package.json` version (`1.26.0`), generated changelog, route contracts, or release channel. No new dependencies, public component properties, events, machine fields, configuration keys, or generic controllers/frameworks.
- `app-navigation-panel` is the named inline-size query container. Add `container-type: inline-size; container-name: navigation-header;` to its host. The exact narrow query is `@container navigation-header (inline-size < 416px)`. There is no alternate breakpoint for this feature. The base/normal header presentation is single-line and therefore applies at exactly 416px and above.
- The query measures the `app-navigation-panel` host content box. The host does not receive new padding, and the query must not be moved to the padded `header`; the header's 8px or 12px padding is inside the host and is not part of the queried inline size. Do not use `window.matchMedia`, a resize listener, `ResizeObserver`, a JavaScript width state, polling loop, or a generic responsive-layout controller. CSS container queries are the sole responsive mechanism; measurement is acceptance-fixture-only.
- Keep the existing header order and callback wiring: brand, machine switcher, `.header-actions` containing supplied refresh followed by Actions. The `brand-wordmark` class is the only required semantic addition to the existing wordmark span. The version span remains omitted when `version` is undefined. The accessible label remains exactly `Pi WebUI` without a version, or `Pi WebUI version <version>` with one.
- The visible `Actions` text remains present at every width. Do not replace it with an icon-only button, shorten it, or hide it in narrow mode. Its title, accessible name, click handler, and `onShowActions` callback remain unchanged.
- Preserve the existing wide styles unless a narrow rule explicitly changes them. Inside the exact narrow query: two-row grid; `padding: 8px`; `column-gap: 4px`; `row-gap: 8px`; `grid-template-columns: minmax(0, 1fr) auto`; brand row 1 column 1; actions row 1 column 2; switcher row 2 spanning both columns with `min-width: 0`; action group gap 4px; Actions existing height with 3px inline padding and one-line label; visual wordmark/version `display: none`; pi remains visible. The supplied refresh control is not resized or hidden; its nested `.app-refresh-button` remains 36px by 36px.
- The narrow grid must fit at the actual 180px desktop navigation column: the desktop activity rail reserves 44px, leaving a 136px `app-navigation-panel` host and a 120px header content box after the two 8px inline paddings. No third row is allowed, including when the refresh control is present.
- Do not add transforms, `contain: paint`, new overflow clipping, or any fixed-position containing block that could change the existing viewport-positioned machine menus. Keep the machine menu and action menu fixed-positioned, with existing width, maximum-height calculation, z-index, click propagation handling, and viewport constraints. The narrow button width must not constrain the menu.
- Keep `const selected = this.selectedMachine(); const status = machineStatus(selected, this.statuses);`. `selectedMachine()` continues to choose `this.selected`, then machine id `local`, then the first machine. `machineStatus()` continues to resolve exactly as `statuses[machine.id]?.status ?? machine.status ?? "unknown"`. Do not infer a different status from `MachineHealth.ok`, `error`, or any other field.
- The selected control remains a real `<button type="button">` with its existing class, `title=${machineTitle(selected)}`, `aria-label="Machine: <selected name>. Switch machine."`, `aria-expanded`, click/keydown handlers, activity/kicker/name/health/chevron order, and remote base-URL title contract.
- Add exactly `aria-describedby="machine-status-description"` and a stable same-shadow-root `<span id="machine-status-description" class="machine-status-description">Machine status: <status>.</span>`. Status sentences are exactly `Machine status: online.`, `Machine status: offline.`, `Machine status: error.`, and `Machine status: unknown.`. The id must not be generated from a machine id. The description must remain in the accessibility tree; use a standard visual hiding technique, not `display: none` or `aria-hidden="true"`. The explicit accessible name is unchanged.
- The selected `.machine-status` retains its existing status classes and text and receives the exact lower-case status word as its `title`. In narrow mode only, show a 7px colored dot: online existing success color; offline/error existing danger color; unknown existing muted color. Keep the health word in the DOM, hide it visually only in the selected narrow indicator, and leave complete menu-entry health words unchanged.
- `renderActivity()` and the activity model remain unchanged: offline/error suppress activity, online/unknown may show it, session activity takes precedence over terminal activity, and existing `role="img"`, `aria-label`, and `title` remain.
- Keep all state transitions and callback boundaries unchanged. `open`, `menuStyle`, `openActionsMachineId`, `actionMenuStyle`, selected-machine fallback, and menu cleanup remain owned by `MachineSwitcher`. Preserve click/native Enter/native Space toggles, selected-or-first ArrowUp/Down opening, clamped option ArrowUp/Down/Home/End, Escape/ArrowLeft close-and-return-focus, ArrowRight next-section forwarding exactly once, selection exactly once, outside click, disconnect cleanup, and zero/one-machine omission through `shouldShowMachinesSection()`.
- A CSS-only width change across the 416px boundary preserves selected machine, open menu, focused element, and callbacks. Opening a menu after the change still computes its position from the new button rectangle. Do not change the existing fixed menu calculation.
- Required browser viewport: 1600x900 (desktop at least 1181px). Mount the real `appStyles` shell layout with the same desktop `aside` and activity-rail reserve; set the column through `--navigation-panel-size`. Do not use a 180px browser viewport as a substitute for a 180px navigation column. Apply `appStyles` through a real shadow host so its `:host` system-font rules take effect, and supply the production theme tokens. Do not substitute fixture-only fonts or duplicate responsive layout rules.
- Exact boundary matrix, version `1.26.0`, with and without refresh: host 415px / desktop column 459px = two-row narrow; host 416px / column 460px = single-line; host 417px / column 461px = single-line. Use unknown health plus eligible activity and `Local` for the boundary fit case. At minimum exercise no/session/terminal activity, both-activity precedence, all four health states, both refresh states, and a deliberately long remote name. Assert contained nonoverlapping controls, readable kicker/Local without ellipsis, intentional long-name ellipsis, refresh 36x36, and dot 7x7.
- Tests use the file-level `// @vitest-environment jsdom`, real `AppNavigationPanel`, `MachineSwitcher`, and `AppRefreshControl`, `document.body.append`, shadow-root queries, DOM events, and `updateComplete` including the nested switcher. Clean DOM and restore mocks after every test. No `TemplateResult` extraction; no content/accessibility/focus assertions through template internals; no geometry claims from jsdom or CSS strings.
- The harness is self-contained and offline and uses the raw Node WebSocket CDP pattern already present in `scripts/capture-screenshots.mjs`. Do not add Playwright, Puppeteer, or another browser framework. Never start the web/API server, session daemon, `PiWebUiApp`, or either systemd user service; callbacks/data stay local and deterministic.
- Honor `CHROME_BIN`; missing Chromium is a clear nonzero failure, never a skip. Allocate temporary localhost server and CDP ports, use an isolated temporary Chrome profile, bound connection/navigation/CDP-evaluation/assertion waits and termination after failures, and clean browser/server/profile/logs in `finally`. Fail loudly on timeout, console error, assertion failure, or cleanup failure.
- The script must accept `--source-overlay <directory>` resolving only the original `AppNavigationPanel.ts` and `MachineSwitcher.ts` from a read-only temporary overlay, preserving normal relative imports. Record pre-fix revision `5f8e27e9859cafe75c7c325b4b657fce0f8eb8d9` and map each original repository-relative module path to `<overlay>/<same repository-relative path>`. Run the same CDP assertions against it. The original run must fail on 180px geometry and/or exact boundary mode, not missing selector, import, new markup, or startup. Do not edit the delivery/base checkout or weaken fixed-tree assertions.
- Required separate browser command: `CHROME_BIN="${CHROME_BIN:?Set CHROME_BIN to a Chromium binary}" npm run verify:narrow-navigation-machine-indicator`. Keep it separate from `npm run verify`. All verification is serial; focused tests, typecheck, lint, then browser acceptance. Run full `npm run verify` exactly once at completion after browser acceptance and before PM audit, not once per task, and never concurrently with heavy verification. No broad tests/builds during planning.
- The source fix requires exactly `.changeset/narrow-navigation-machine-indicator.md` with frontmatter `"@hyperdreamer/pi-webui": patch` and text `Keep the expanded navigation machine selector readable at narrow widths.`. Do not hand-edit `CHANGELOG.md`. Keep the change ASCII by default and use only short orienting comments.
- This change is loaded by the web/UI process only. No manual `pi-webui-sessiond.service` restart is required; the UI development service or normal client build/reload path is sufficient.

## Task 1: Fix narrow header presentation and accessible machine health

**Implementer tier:** Advanced
**Lane:** navigation
**Category:** values

**Files:**
- Modify: `src/client/src/components/appShell/AppNavigationPanel.ts:127-127,275-285,305-305` (line numbers are original-baseline anchors; keep all other markup and handlers).
- Modify: `src/client/src/components/MachineSwitcher.ts:53-77,282-285` (selected markup/status CSS only).
- Create/Test: `src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts`.
- Create: `.changeset/narrow-navigation-machine-indicator.md`.

**Interfaces:**
- Consumes unchanged `AppNavigationPanel extends LitElement`: `machines: Machine[]`, `selectedMachine?: Machine`, `machineStatuses: Record<string, MachineHealth>`, `machineActivities: Record<string, Record<string, WorkspaceActivity>>`, `version: string | undefined`, `refreshControl: unknown`, `compact: boolean`, `onShowActions?: () => void`, `onSelectMachine?: (machine: Machine) => void | Promise<void>`, `onFocusNavigationTarget?: (target: NavigationSection | "chat") => void | Promise<void>`.
- Consumes unchanged `MachineSwitcher extends LitElement`: `machines: Machine[]`, `selected?: Machine`, `statuses: Record<string, MachineHealth>`, `activities: Record<string, Record<string, WorkspaceActivity>>`, `onSelect?: (machine: Machine) => void | Promise<void>`, `onFocusNextSection?: () => void | Promise<void>`, `focusSelectedOrFirst(): Promise<boolean>`.
- Consumes `AppRefreshControl extends LitElement` with `onReload?: () => void`; its `.app-refresh-button` is the existing 36x36 control. Consumes `shouldShowMachinesSection(machines: readonly Machine[]): boolean` unchanged.
- Types from `src/client/src/api.ts`: `Machine = { id: string; name: string; kind: "local" | "remote"; baseUrl?: string; createdAt: string; updatedAt: string; status?: MachineStatus; statusMessage?: string }`; `MachineStatus = "unknown" | "online" | "offline" | "error"`; `MachineHealth = { machineId: string; ok: boolean; checkedAt: string; status?: MachineStatus; web?: PiWebUiComponentStatus; sessiond?: PiWebUiComponentStatus; error?: string }`; `WorkspaceActivity = { cwd: string; hasSessionActivity: boolean; hasTerminalActivity: boolean; updatedAt: string }`. Optional web/sessiond fields are not read or changed.
- Produces unchanged public component/callback signatures and these internal DOM/CSS contracts for Task 2: host container `navigation-header`; `.brand-wordmark`; selected button `aria-describedby="machine-status-description"`; sibling `#machine-status-description`; selected `.machine-status[title]`; exact query/grid/dot from Global Constraints. Existing `.brand`, `header`, `.header-actions`, `.machine-switcher-button`, `.machine-switcher-text`, `.machine-switcher-kicker`, `.machine-switcher-label`, `.machine-chevron`, `.activity-indicator`, `.machine-option-main[data-machine-id]`, and `.machine-switcher-menu` remain.

### Step 1: Add the complete real-DOM regression file

- [ ] Create the following file. All new semantic regressions and existing interaction coverage belong to the same red/green cycle as the two source patches. `scrollIntoView` is the sole missing jsdom browser-method stub; it is restored, not promoted to a shared harness. The refresh DOM test deliberately leaves its 36px geometry to Task 2.

```ts
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Machine, MachineHealth, MachineStatus, WorkspaceActivity } from "../../api";
import { MachineSwitcher } from "../MachineSwitcher";
import { AppNavigationPanel } from "./AppNavigationPanel";
import { AppRefreshControl } from "./AppRefreshControl";

const time = "2026-10-17T00:00:00.000Z";
const machines: Machine[] = [
  { id: "local", name: "Local", kind: "local", createdAt: time, updatedAt: time, status: "online" },
  { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.example.test", createdAt: time, updatedAt: time, status: "offline" },
  { id: "long", name: "Remote machine with a deliberately very long name that must stay inside its label allocation", kind: "remote", baseUrl: "https://long.example.test", createdAt: time, updatedAt: time, status: "error" },
  { id: "unknown", name: "Unknown", kind: "remote", createdAt: time, updatedAt: time },
];
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
function required<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}
function switcher(panel: AppNavigationPanel): MachineSwitcher {
  return required<MachineSwitcher>(root(panel), "machine-switcher");
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
async function mount(options: Partial<Pick<AppNavigationPanel, "machines" | "selectedMachine" | "machineStatuses" | "machineActivities" | "version">> = {}, refresh = false) {
  const panel = new AppNavigationPanel();
  const onSelect = vi.fn();
  const onNext = vi.fn();
  const onActions = vi.fn();
  const onReload = vi.fn();
  Object.assign(panel, { machines: [...machines], selectedMachine: machines[0], version: "1.26.0" }, options);
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
  return required<HTMLButtonElement>(root(switcher(panel)), ".machine-switcher-button");
}
function option(panel: AppNavigationPanel, id: string): HTMLButtonElement {
  return required<HTMLButtonElement>(root(switcher(panel)), `.machine-option-main[data-machine-id="${id}"]`);
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
    const actions = required<HTMLButtonElement>(dom, ".header-actions > button");
    expect(actions.textContent?.trim()).toBe("Actions");
    expect(actions.title).toBe("Show Actions");
    expect(actions.getAttribute("aria-label")).toBe("Show Actions");
    const refresh = required<AppRefreshControl>(dom, "app-refresh-control");
    const reload = required<HTMLButtonElement>(root(refresh), ".app-refresh-button");
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
    const description = required<HTMLElement>(root(switcher(panel)), "#machine-status-description");
    expect(description.textContent?.trim()).toBe(`Machine status: ${status}.`);
    expect(description.getAttribute("aria-hidden")).not.toBe("true");
    expect(description.hidden).toBe(false);
    expect(getComputedStyle(description).display).not.toBe("none");
    expect(getComputedStyle(description).visibility).not.toBe("hidden");
    const indicator = required<HTMLElement>(selected, ".machine-status");
    expect(indicator.title).toBe(status);
    expect(indicator.textContent).toBe(status);
    expect(indicator.classList.contains(status)).toBe(true);
  });

  it("preserves own-status, unknown, local, and first-machine fallbacks", async () => {
    const { panel } = await mount({ selectedMachine: machines[1], machineStatuses: {} });
    expect(required(root(switcher(panel)), "#machine-status-description").textContent?.trim()).toBe("Machine status: offline.");
    expect(button(panel).title).toBe("https://remote.example.test");
    panel.selectedMachine = machines[3];
    await settle(panel);
    expect(required(root(switcher(panel)), "#machine-status-description").textContent?.trim()).toBe("Machine status: unknown.");
    panel.selectedMachine = undefined;
    await settle(panel);
    expect(button(panel).getAttribute("aria-label")).toBe("Machine: Local. Switch machine.");
    panel.machines = machines.slice(1);
    await settle(panel);
    expect(button(panel).getAttribute("aria-label")).toBe("Machine: Remote. Switch machine.");
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
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(machines[1]);
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
    const { panel, onNext, onSelect } = await mount({ selectedMachine: machines[1] });
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
```

### Step 2: Demonstrate the focused red phase

- [ ] Run `npm test -- --run src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts`. Expect genuine new-contract failures (`.brand-wordmark`, `aria-describedby`, and status description/tooltip) against the original components, not module resolution or custom-element registration failures. Existing interaction cases may already pass. Do not commit this red state.

### Step 3: Apply only the two presentation patches and exact Changeset

- [ ] In `AppNavigationPanel.ts:127`, change only the existing wordmark `<span>WebUI</span>` to `<span class="brand-wordmark">WebUI</span>`. Keep the brand expression, version branch, order, and all callback expressions byte-for-byte otherwise. Replace the host style at original line 275 with:

```css
    :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; container-type: inline-size; container-name: navigation-header; }
```

- [ ] Append this query after the existing base `button` rule at original line 305. The compact-header selector stays in the base stylesheet and still wins by specificity. The `:host` is not queried from its own stylesheet; these rules style its descendants.

```css
    @container navigation-header (inline-size < 416px) {
      header { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 4px; row-gap: 8px; padding: 8px; }
      .brand { grid-row: 1; grid-column: 1; }
      .header-actions { grid-row: 1; grid-column: 2; gap: 4px; }
      machine-switcher { grid-row: 2; grid-column: 1 / -1; min-width: 0; }
      .header-actions > button { padding-inline: 3px; white-space: nowrap; }
      .brand-wordmark, .brand-version { display: none; }
    }
```

- [ ] In `MachineSwitcher.ts:53-77`, add `aria-describedby="machine-status-description"` immediately after `aria-expanded`. Replace only the selected health span and add the description immediately after the selected button, before the conditional menu:

```ts
          <span class=${`machine-status ${status}`} title=${machineStatusLabel(status)}>${machineStatusLabel(status)}</span>
          <span class="machine-chevron" aria-hidden="true">▾</span>
        </button>
        <span id="machine-status-description" class="machine-status-description">Machine status: ${machineStatusLabel(status)}.</span>
```

- [ ] After existing selected status color rules at original lines 282-284, insert this CSS. The visually hidden node is not removed from the accessibility tree. The ancestor named query does not create a second container or change any menu selector.

```css
    .machine-status-description { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
    @container navigation-header (inline-size < 416px) {
      .machine-switcher-button > .machine-status { width: 7px; height: 7px; border-radius: 50%; background: currentColor; font-size: 0; overflow: hidden; }
    }
```

- [ ] Create `.changeset/narrow-navigation-machine-indicator.md` with exactly:

```markdown
---
"@hyperdreamer/pi-webui": patch
---

Keep the expanded navigation machine selector readable at narrow widths.
```

### Step 4: Complete the green phase serially

- [ ] Run, one at a time:

```bash
npm test -- --run src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts src/client/src/components/appShell/AppNavigationPanel.test.ts
npm run typecheck
npm run lint
git diff --check
```

Expected: new real-DOM suite and existing navigation suite pass; typecheck/lint succeed without suppressions. Review the diff for unchanged state methods, menu styles/calculation, refresh component, compact/mobile rules, package version/dependencies, and no unrelated edits. Do not run `verify`, `verify:fast`, a build, or a browser yet. Geometry is not proven by this task.

### Step 5: Commit handoff to parent

- [ ] Report focused red/green command results and the exact four changed paths. The task deliverable is green, not a deliberately failing test commit. Parent alone performs the commit after its gate:

```bash
git add src/client/src/components/appShell/AppNavigationPanel.ts src/client/src/components/MachineSwitcher.ts src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts .changeset/narrow-navigation-machine-indicator.md
git commit -m "fix(navigation): keep narrow machine selector readable"
```

## Task 2: Add standalone offline browser acceptance and old-source regression gate

**Implementer tier:** Advanced
**Lane:** navigation
**Category:** values

**Files:**
- Create/Test: `scripts/verify-narrow-navigation-machine-indicator.mjs`.
- Modify: `package.json:39-40` (insert one script directly after `capture:screenshots`; no other package edits).

**Interfaces:**
- Consumes Task 1's unchanged registered `AppNavigationPanel extends LitElement` (`app-navigation-panel`) with `machines: Machine[]`, `selectedMachine?: Machine`, `machineStatuses: Record<string, MachineHealth>`, `machineActivities: Record<string, Record<string, WorkspaceActivity>>`, `version: string | undefined`, `refreshControl: unknown`, `onSelectMachine?: (machine: Machine) => void | Promise<void>`, `onShowActions?: () => void`, `onFocusNavigationTarget?: (target: NavigationSection | "chat") => void | Promise<void>`, and `updateComplete: Promise<boolean>`.
- Consumes Task 1's unchanged `MachineSwitcher extends LitElement` (`machine-switcher`) with `selected?: Machine`, `machines: Machine[]`, `statuses: Record<string, MachineHealth>`, `activities: Record<string, Record<string, WorkspaceActivity>>`, `updateComplete: Promise<boolean>` and existing selector/menu/focus ownership. Uses real DOM selectors `.machine-switcher-button`, `.machine-switcher-text`, `.machine-switcher-kicker`, `.machine-switcher-label`, `.machine-status`, `.machine-chevron`, `.activity-indicator`, `.machine-switcher-menu`, `.machine-option-main[data-machine-id]`.
- Consumes Task 1's added internal contracts: host container `navigation-header`; exact `<416px` query; `.brand-wordmark`; selected `aria-describedby="machine-status-description"`; same-root `#machine-status-description`; selected `.machine-status[title]` containing the health word, rendered as 7x7 only in narrow mode. No new production export is needed.
- Consumes unchanged `AppRefreshControl extends LitElement` (`app-refresh-control`), `onReload?: () => void`, `.app-refresh-button`, `updateComplete: Promise<boolean>`; `appStyles: CSSResult` exported from `src/client/src/components/shared.ts`; production `<style>` in `src/client/index.html`; and existing `ActivityRail` registration from `src/client/src/components/ActivityRail.ts`.
- Consumes existing types structurally in the browser fixture: `Machine = { id: string; name: string; kind: "local" | "remote"; baseUrl?: string; createdAt: string; updatedAt: string; status?: "online" | "offline" | "error" | "unknown" }`; `MachineHealth = { machineId: string; ok: boolean; checkedAt: string; status?: "online" | "offline" | "error" | "unknown" }`; `WorkspaceActivity = { cwd: string; hasSessionActivity: boolean; hasTerminalActivity: boolean; updatedAt: string }`. These are fixture objects, not new production types.
- Produces CLI `node scripts/verify-narrow-navigation-machine-indicator.mjs [--source-overlay <directory>]`: exit 0 only when every fixed-tree assertion and cleanup passes; otherwise nonzero with diagnostics. Overlay maps only the two exact repository-relative production paths to the same paths beneath the supplied directory; Vite keeps the original module ids so relative imports remain normal.
- Produces one package script `verify:narrow-navigation-machine-indicator`. The internal fixture-only API has the exact structural signatures below; these document the JavaScript in this task, not a second artifact, application API, or new public component property.

```ts
type FixtureMachineId = "local" | "remote" | "long" | "unknown";
type FixtureHealth = "online" | "offline" | "error" | "unknown";
type FixtureActivity = "none" | "session" | "terminal" | "both";
type FixtureCase = { column?: number; refresh?: boolean; health?: FixtureHealth; activity?: FixtureActivity; selected?: FixtureMachineId };
type LayoutCase = FixtureCase & { column: number; refresh: boolean };
type FixtureCounters = { select: number; next: number; actions: number; reload: number };
type FixtureRect = { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
type FixtureTarget = "selector" | "option" | "actions" | "refresh";
type FixtureExpectation = Partial<FixtureCounters> & { open?: boolean; focused?: "selector" | FixtureMachineId; selected?: FixtureMachineId };
type NarrowFixture = {
  reset(options?: FixtureCase): Promise<void>;
  resize(column: number): Promise<void>;
  layout(options: LayoutCase): void;
  checkMenu(): void;
  focus(kind: FixtureTarget, id?: FixtureMachineId): void;
  target(kind: FixtureTarget, id?: FixtureMachineId): { x: number; y: number };
  expectState(options?: FixtureExpectation): void;
  remember(): void;
  unchanged(): void;
  counters(): FixtureCounters;
  snapshot(): { host: FixtureRect; button: FixtureRect; menu: FixtureRect | null; selected: FixtureMachineId; counts: FixtureCounters };
};
```

### Step 1: Create the bounded browser runner and fixture

- [ ] Create the complete script below. It uses a child mode of the same file for Vite, so even a stuck Vite close cannot make cleanup unbounded. This is a single feature-specific acceptance script, not a browser framework. The geometry check is deliberately first, before any newly added markup is required, making the original-source negative control falsifiable. All geometric comparisons use 0.75 CSS-pixel tolerance (covers rounded menu anchors and fractional system-font metrics; does not permit a missing row or clipped label).

```js
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const repo = resolve(dirname(self), "..");
const modules = [
  "src/client/src/components/appShell/AppNavigationPanel.ts",
  "src/client/src/components/MachineSwitcher.ts",
];
const oldRevision = "5f8e27e9859cafe75c7c325b4b657fce0f8eb8d9";
const argv = process.argv.slice(2);
const serverMode = argv[0] === "--fixture-server";
const options = new Map();
for (let index = serverMode ? 1 : 0; index < argv.length; index += 2) {
  const flag = argv[index];
  const value = argv[index + 1];
  const allowed = serverMode ? ["--port", "--temp-root", "--source-overlay"] : ["--source-overlay"];
  assert(allowed.includes(flag) && value && !value.startsWith("--") && !options.has(flag), `Invalid arguments: ${argv.join(" ")}`);
  options.set(flag, value);
}
const overlay = options.has("--source-overlay") ? resolve(options.get("--source-overlay")) : undefined;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function until(probe, ms, label, signal) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    try { const value = await probe(); signal?.throwIfAborted(); if (value) return value; } catch (error) { last = error; }
    signal?.throwIfAborted();
    await sleep(40);
  }
  throw new Error(`Timeout: ${label}${last ? `: ${last.message}` : ""}`);
}
async function port() {
  const server = createPortServer();
  try {
    await bounded(new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); }), 2000, "port allocation");
    const address = server.address();
    assert(address && typeof address === "object");
    return address.port;
  } finally {
    if (server.listening) await bounded(new Promise((done, reject) => server.close((error) => error ? reject(error) : done())), 2000, "port release");
  }
}
async function json(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(1000) });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return response.json();
}

class CDP {
  constructor(ws, onEvent, signal) {
    this.ws = ws;
    this.onEvent = onEvent;
    this.signal = signal;
    this.pending = new Map();
    this.next = 1;
    this.closed = false;
    ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id !== undefined) {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(JSON.stringify(message.error)));
          else request.resolve(message.result ?? {});
        } else this.onEvent(message.method, message.params ?? {});
      } catch (error) { this.fail(error); }
    });
    ws.addEventListener("close", () => { this.closed = true; this.fail(new Error("CDP socket closed")); });
    ws.addEventListener("error", () => this.fail(new Error("CDP socket error")));
  }
  static async connect(url, onEvent, signal) {
    signal.throwIfAborted();
    const ws = new WebSocket(url);
    const client = new CDP(ws, onEvent, signal);
    try {
      await bounded(new Promise((done, reject) => {
        ws.addEventListener("open", done, { once: true });
        ws.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
      }), 5000, "CDP connection");
      signal.throwIfAborted();
      return client;
    } catch (error) { ws.close(); throw error; }
  }
  fail(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}) {
    if (this.signal.aborted) return Promise.reject(this.signal.reason);
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP unavailable: ${method}`));
    const id = this.next++;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: CDP ${method}`)); }, 8000);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Browser assertion: ${JSON.stringify(result.exceptionDetails)}`);
    return result.result?.value;
  }
  async close() {
    if (this.closed) return;
    const closed = new Promise((done) => this.ws.addEventListener("close", done, { once: true }));
    this.ws.close();
    await bounded(closed, 2000, "CDP close");
  }
}

async function browserFixture({ AppNavigationPanel, AppRefreshControl, appStyles }) {
  const tolerance = 0.75;
  const time = "2026-10-17T00:00:00.000Z";
  const machines = [
    { id: "local", name: "Local", kind: "local", status: "online" },
    { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.example.test", status: "offline" },
    { id: "long", name: "Remote machine with a deliberately very long name that must stay inside its label allocation", kind: "remote", baseUrl: "https://long.example.test", status: "error" },
    { id: "unknown", name: "Unknown", kind: "remote" },
  ].map((machine) => ({ ...machine, createdAt: time, updatedAt: time }));
  const host = document.createElement("narrow-navigation-fixture");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = appStyles.cssText;
  const shell = document.createElement("div");
  shell.className = "shell";
  // Layout/font/rail rules are imported, not recreated here.
  shell.innerHTML = '<activity-rail></activity-rail><aside></aside><div class="navigation-panel-edge"></div><main></main><div class="workspace-panel-edge"></div><workspace-panel></workspace-panel>';
  const panel = new AppNavigationPanel();
  shell.querySelector("aside").append(panel);
  shadow.append(style, shell);
  document.body.append(host);
  const counts = { select: 0, next: 0, actions: 0, reload: 0 };
  let saved;
  const must = (condition, message) => { if (!condition) throw new Error(message); };
  const near = (actual, expected, name) => must(Math.abs(actual - expected) <= tolerance, `[GEOMETRY] ${name}: ${actual}, expected ${expected}`);
  const get = (parent, selector) => { const value = parent.querySelector(selector); must(value, `Missing ${selector}`); return value; };
  const child = () => get(panel.shadowRoot, "machine-switcher");
  const button = () => get(child().shadowRoot, ".machine-switcher-button");
  const menu = () => child().shadowRoot.querySelector(".machine-switcher-menu");
  const option = (id) => get(child().shadowRoot, `.machine-option-main[data-machine-id="${id}"]`);
  const rect = (element) => element.getBoundingClientRect();
  const contained = (inner, outer, label) => {
    const a = rect(inner), b = rect(outer);
    must(a.width > 0 && a.height > 0 && a.left >= b.left - tolerance && a.right <= b.right + tolerance && a.top >= b.top - tolerance && a.bottom <= b.bottom + tolerance, `[GEOMETRY] ${label} not contained: ${JSON.stringify(a.toJSON())} in ${JSON.stringify(b.toJSON())}`);
  };
  const nonoverlap = (elements, label) => {
    for (let a = 0; a < elements.length; a += 1) for (let b = a + 1; b < elements.length; b += 1) {
      const x = rect(elements[a]), y = rect(elements[b]);
      must(Math.min(x.right, y.right) - Math.max(x.left, y.left) <= tolerance || Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) <= tolerance, `[GEOMETRY] ${label} overlap ${a}/${b}`);
    }
  };
  const readable = (element, label) => {
    must(element.clientWidth > 0 && element.scrollWidth <= element.clientWidth + 1, `[GEOMETRY] ${label} clipped: ${element.scrollWidth}/${element.clientWidth}`);
  };
  const visible = (element) => getComputedStyle(element).display !== "none" && rect(element).width > 0;
  async function flush() {
    await panel.updateComplete;
    await child().updateComplete;
    const refresh = panel.shadowRoot.querySelector("app-refresh-control");
    if (refresh) await refresh.updateComplete;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }
  async function resize(column) { shell.style.setProperty("--navigation-panel-size", `${column}px`); await flush(); }
  async function reset({ column = 180, refresh = false, health = "unknown", activity = "both", selected = "local" } = {}) {
    // Close any previous menu via its public DOM, not by writing private state.
    document.body.click();
    panel.machines = machines;
    panel.selectedMachine = machines.find((machine) => machine.id === selected);
    panel.version = "1.26.0";
    panel.machineStatuses = { [selected]: { machineId: selected, status: health, ok: health === "online", checkedAt: time } };
    panel.machineActivities = { [selected]: { fixture: { cwd: "/fixture", hasSessionActivity: activity === "session" || activity === "both", hasTerminalActivity: activity === "terminal" || activity === "both", updatedAt: time } } };
    panel.onSelectMachine = (machine) => { counts.select += 1; panel.selectedMachine = machine; };
    panel.onShowActions = () => { counts.actions += 1; };
    panel.onFocusNavigationTarget = (target) => { must(target === "projects", `Wrong next section ${target}`); counts.next += 1; };
    if (refresh) {
      const control = new AppRefreshControl();
      control.onReload = () => { counts.reload += 1; };
      panel.refreshControl = control;
    } else panel.refreshControl = undefined;
    for (const name of Object.keys(counts)) counts[name] = 0;
    await resize(column);
  }
  function layout({ column, refresh, health = "unknown", activity = "both", selected = "local" }) {
    const header = get(panel.shadowRoot, "header");
    const h = getComputedStyle(header);
    const narrow = column - 44 < 416;
    // FIRST gate uses only old DOM: original modules must fail here for mode.
    must(h.display === (narrow ? "grid" : "flex"), `[GEOMETRY] mode at column ${column}, host ${rect(panel).width}: ${h.display}; expected ${narrow ? "grid" : "flex"}`);
    near(window.innerWidth, 1600, "viewport width");
    near(window.innerHeight, 900, "viewport height");
    near(rect(shell.querySelector("aside")).width, column, "navigation column");
    near(parseFloat(getComputedStyle(shell.querySelector("aside")).paddingLeft), 44, "desktop rail reserve");
    near(rect(panel).width, column - 44, "host content box");
    near(parseFloat(getComputedStyle(panel).paddingLeft) || 0, 0, "host padding");
    near(parseFloat(h.paddingLeft), narrow ? 8 : 12, "header left padding");
    near(parseFloat(h.paddingRight), narrow ? 8 : 12, "header right padding");
    near(parseFloat(h.paddingTop), narrow ? 8 : 12, "header top padding");
    near(parseFloat(h.paddingBottom), narrow ? 8 : 12, "header bottom padding");
    if (column === 180) near(rect(header).width - parseFloat(h.paddingLeft) - parseFloat(h.paddingRight) - parseFloat(h.borderLeftWidth) - parseFloat(h.borderRightWidth), 120, "header content box");
    must(getComputedStyle(host).fontFamily.includes("system-ui"), "Fixture did not apply appStyles :host system font");
    must(getComputedStyle(host).getPropertyValue("--pi-success").trim() === "#3fb950", "Production tokens not supplied");
    const brand = get(panel.shadowRoot, ".brand");
    const actions = get(panel.shadowRoot, ".header-actions");
    const action = get(actions, "button");
    const selectedButton = button();
    const status = get(selectedButton, ".machine-status");
    const kicker = get(selectedButton, ".machine-switcher-kicker");
    const label = get(selectedButton, ".machine-switcher-label");
    const chevron = get(selectedButton, ".machine-chevron");
    const mark = get(brand, ".brand-wordmark");
    const version = get(brand, ".brand-version");
    must(visible(mark) === !narrow && visible(version) === !narrow, "Wrong brand visibility");
    must(version.textContent === "v1.26.0" && brand.getAttribute("aria-label") === "Pi WebUI version 1.26.0", "Brand semantics drift");
    for (const element of [brand, actions, child(), selectedButton, status, chevron, get(brand, ".brand-symbol")]) { contained(element, header, element.className || element.tagName); contained(element, panel, element.tagName); }
    for (const element of [kicker, label, status, chevron]) contained(element, selectedButton, element.className);
    nonoverlap([brand, actions, selectedButton], "primary controls");
    readable(action, "Actions");
    readable(selectedButton, "selector");
    readable(actions, "action group");
    readable(kicker, "Machine kicker");
    must(action.textContent.trim() === "Actions" && visible(action), "Actions label lost");
    if (selected === "local") { must(label.textContent === "Local", "Wrong selected label"); readable(label, "Local"); }
    else {
      must(label.scrollWidth > label.clientWidth && label.clientWidth > 0, "Long label must intentionally ellipsize");
      const l = getComputedStyle(label);
      must(l.textOverflow === "ellipsis" && l.overflowX === "hidden" && l.whiteSpace === "nowrap", "Long-name ellipsis contract changed");
    }
    if (narrow) {
      near(parseFloat(h.columnGap), 4, "column gap"); near(parseFloat(h.rowGap), 8, "row gap");
      near(parseFloat(getComputedStyle(actions).gap), 4, "action gap");
      near(parseFloat(getComputedStyle(action).paddingLeft), 3, "Actions inline padding");
      near(rect(selectedButton).top, Math.max(rect(brand).bottom, rect(actions).bottom) + 8, "selector on exactly row two, no third row");
      near(rect(header).bottom - parseFloat(h.borderBottomWidth) - rect(selectedButton).bottom, 8, "no trailing third row");
      must(Math.min(rect(brand).bottom, rect(actions).bottom) > Math.max(rect(brand).top, rect(actions).top), "Brand/actions not on first row");
      near(rect(status).width, 7, "health dot width"); near(rect(status).height, 7, "health dot height");
      must(getComputedStyle(status).fontSize === "0px", "Health word visually exposed in dot mode");
      must(getComputedStyle(status).backgroundColor === getComputedStyle(status).color, "Dot must use health color");
    } else {
      const row = [rect(brand), rect(actions), rect(selectedButton)];
      must(Math.min(...row.map((r) => r.bottom)) > Math.max(...row.map((r) => r.top)), "Wide header is not one row");
      must(parseFloat(getComputedStyle(status).fontSize) > 0, "Health word hidden in wide mode");
      readable(status, "health word");
    }
    must(status.textContent === health && status.title === health, "Selected health content or tooltip drift");
    must(selectedButton.getAttribute("aria-describedby") === "machine-status-description", "Missing selected status association");
    const description = get(child().shadowRoot, "#machine-status-description");
    must(description.textContent.trim() === `Machine status: ${health}.` && getComputedStyle(description).display !== "none" && getComputedStyle(description).visibility !== "hidden" && description.getAttribute("aria-hidden") !== "true", "Status description unavailable");
    const colorToken = health === "online" ? "--pi-success" : health === "unknown" ? "--pi-muted" : "--pi-danger";
    const probe = document.createElement("span"); probe.style.color = `var(${colorToken})`; host.append(probe);
    must(getComputedStyle(status).color === getComputedStyle(probe).color, `Wrong ${health} color`); probe.remove();
    const active = selectedButton.querySelector(".activity-indicator");
    const eligible = health !== "offline" && health !== "error" && activity !== "none";
    must(Boolean(active) === eligible, "Activity suppression drift");
    if (active) {
      const session = activity === "session" || activity === "both";
      const text = session ? "Machine active" : "Machine terminal active";
      must(active.classList.contains(session ? "session" : "terminal") && !active.classList.contains(session ? "terminal" : "session"), "Activity precedence drift");
      must(active.getAttribute("role") === "img" && active.getAttribute("aria-label") === text && active.title === text, "Activity accessibility drift");
      contained(active, selectedButton, "activity"); contained(active, header, "activity"); contained(active, panel, "activity");
    }
    nonoverlap([get(selectedButton, ".machine-switcher-text"), status, chevron, ...(active ? [active] : [])], "selector items");
    const control = actions.querySelector("app-refresh-control");
    must(Boolean(control) === refresh, "Refresh presence drift");
    contained(action, actions, "Actions button");
    if (control) {
      const reload = get(control.shadowRoot, ".app-refresh-button");
      near(rect(reload).width, 36, "refresh width"); near(rect(reload).height, 36, "refresh height");
      contained(reload, actions, "refresh"); contained(reload, header, "refresh"); contained(reload, panel, "refresh");
      nonoverlap([control, action], "action buttons");
    }
  }
  function checkMenu() {
    const value = menu(); must(value, "Expected open menu");
    const r = rect(value), trigger = rect(button());
    must(getComputedStyle(value).position === "fixed", "Menu lost viewport positioning");
    near(r.width, 280, "menu width independent of selector");
    near(r.top, Math.round(trigger.bottom), "reopened menu top from current trigger");
    near(r.left, Math.round(Math.min(Math.max(8, trigger.left), 1600 - 8 - 280)), "menu viewport left");
    must(r.left >= 8 - tolerance && r.right <= 1592 + tolerance && r.bottom <= 892 + tolerance, "Menu outside viewport");
    near(parseFloat(value.style.maxHeight), Math.round(Math.max(0, 900 - trigger.bottom - 8)), "menu maximum height");
    must(getComputedStyle(value).zIndex === "10000", "Menu z-index drift");
    const entries = [...value.querySelectorAll(".machine-option-main")];
    must(entries.length === machines.length, "Menu omitted machines");
    for (const [index, machine] of machines.entries()) {
      const entry = entries[index];
      const status = panel.machineStatuses[machine.id]?.status ?? machine.status ?? "unknown";
      must(entry.dataset.machineId === machine.id && get(entry, ".machine-option-name").textContent.includes(machine.name), "Menu name/order drift");
      must(get(entry, "small").textContent === `${machine.kind === "local" ? "Local Pi WebUI" : machine.baseUrl ?? "Remote Pi WebUI"} · ${status}`, "Menu lost complete detail/health word");
    }
  }
  function element(kind, id) {
    if (kind === "selector") return button();
    if (kind === "option") return option(id);
    if (kind === "actions") return get(panel.shadowRoot, ".header-actions > button");
    if (kind === "refresh") return get(get(panel.shadowRoot, "app-refresh-control").shadowRoot, ".app-refresh-button");
    throw new Error(`Unknown target ${kind}`);
  }
  function expectState({ open, focused, selected, select, next, actions, reload } = {}) {
    if (open !== undefined) must(Boolean(menu()) === open && button().getAttribute("aria-expanded") === String(open), `Menu open expected ${open}`);
    if (focused !== undefined) must(child().shadowRoot.activeElement === (focused === "selector" ? button() : option(focused)), `Focus expected ${focused}`);
    if (selected !== undefined) must(panel.selectedMachine.id === selected, `Selected expected ${selected}`);
    for (const [name, value] of Object.entries({ select, next, actions, reload })) if (value !== undefined) must(counts[name] === value, `Counter ${name}: ${counts[name]}, expected ${value}`);
  }
  await reset();
  await document.fonts.ready;
  window.narrowFixture = {
    reset, resize, layout, checkMenu, expectState,
    focus: (kind, id) => element(kind, id).focus(),
    target: (kind, id) => { const r = rect(element(kind, id)); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
    counters: () => ({ ...counts }),
    remember: () => { saved = { panel, child: child(), button: button(), focused: child().shadowRoot.activeElement, selected: panel.selectedMachine, counts: JSON.stringify(counts) }; },
    unchanged: () => { must(saved.panel === panel && saved.child === child() && saved.button === button() && saved.focused === child().shadowRoot.activeElement && saved.selected === panel.selectedMachine && saved.counts === JSON.stringify(counts) && Boolean(menu()), "CSS resize changed identity/state/focus/callbacks"); },
    snapshot: () => ({ host: rect(panel).toJSON(), button: rect(button()).toJSON(), menu: menu() ? rect(menu()).toJSON() : null, selected: panel.selectedMachine.id, counts: { ...counts } }),
  };
}

async function serveFixture() {
  const fixturePort = Number(options.get("--port"));
  const temp = options.get("--temp-root");
  assert(Number.isInteger(fixturePort) && fixturePort > 0 && temp, "Invalid fixture-server arguments");
  const { createServer } = await import("vite");
  const sourceHtml = await readFile(join(repo, "src/client/index.html"), "utf8");
  const theme = sourceHtml.match(/<style>[\s\S]*?<\/style>/u)?.[0];
  assert(theme?.includes("--pi-success"), "Production theme style not found");
  const overlaySources = new Map();
  if (overlay) for (const path of modules) overlaySources.set(resolve(repo, path), await readFile(join(overlay, path), "utf8"));
  const javascript = [
    'import { AppNavigationPanel } from "/src/client/src/components/appShell/AppNavigationPanel.ts";',
    'import { AppRefreshControl } from "/src/client/src/components/appShell/AppRefreshControl.ts";',
    'import "/src/client/src/components/ActivityRail.ts";',
    'import { appStyles } from "/src/client/src/components/shared.ts";',
    `await (${browserFixture.toString()})({ AppNavigationPanel, AppRefreshControl, appStyles });`,
  ].join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">${theme}</head><body><script type="module" src="/narrow-fixture.js"></script></body></html>`;
  const fixturePlugin = {
    name: "narrow-navigation-offline-fixture", enforce: "pre",
    load(id) { return overlaySources.get(id.split("?")[0]) ?? null; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === "/" || request.url === "/narrow-fixture.js") {
          response.statusCode = 200;
          response.setHeader("Content-Type", request.url === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
          response.end(request.url === "/" ? html : javascript);
        } else next();
      });
    },
  };
  const server = await createServer({
    configFile: false, root: repo, cacheDir: join(temp, "vite-cache"), logLevel: "warn", clearScreen: false,
    plugins: [fixturePlugin],
    optimizeDeps: { noDiscovery: true, include: ["lit", "lit/decorators.js"] },
    server: { host: "127.0.0.1", port: fixturePort, strictPort: true, hmr: false, fs: { allow: [repo] } },
  });
  await bounded(server.listen(), 10000, "fixture listen");
  console.log(`Fixture ready on ${fixturePort}`);
}

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const result = spawnSync("which", [name], { encoding: "utf8", timeout: 1000 });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error("Chromium was not found. Set CHROME_BIN to a Chromium binary; browser acceptance cannot be skipped.");
}
function start(command, args, label, temp, failures) {
  const child = spawn(command, args, { cwd: repo, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  child.once("error", (error) => failures.push(`${label}: ${error.message}`));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    try { appendFileSync(join(temp, `${label}.log`), chunk); }
    catch (error) { failures.push(`${label} log: ${error.message}`); }
  });
  return child;
}
async function stop(child, label) {
  if (!child?.pid) return;
  const signal = (value) => {
    try { if (process.platform === "win32") child.kill(value); else process.kill(-child.pid, value); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  signal("SIGTERM");
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 1500, `${label} TERM`); }
  catch { signal("SIGKILL"); await until(() => child.exitCode !== null || child.signalCode !== null, 2500, `${label} KILL`); }
  signal("SIGKILL"); // Also reap Chromium/optimizer descendants in this isolated process group.
}

async function acceptance(cdp, origin, failures, signal) {
  const evaluate = (expression) => cdp.evaluate(expression);
  const call = (name, ...args) => evaluate(`window.narrowFixture.${name}(...${JSON.stringify(args)})`);
  const checkFailures = () => assert.equal(failures.length, 0, failures.join("\n"));
  async function key(key) {
    const keys = { Enter: ["Enter", 13, "\r"], " ": ["Space", 32, " "], ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], Home: ["Home", 36], End: ["End", 35], Escape: ["Escape", 27] };
    const [code, virtualKey, text] = keys[key];
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, ...(text ? { text, unmodifiedText: text } : {}) });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
    await call("resize", (await call("snapshot")).host.width + 44);
    checkFailures();
  }
  async function click(kind, id) {
    const { x, y } = await call("target", kind, id);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await call("resize", (await call("snapshot")).host.width + 44);
    checkFailures();
  }
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: origin });
  await until(async () => { checkFailures(); return evaluate("Boolean(window.narrowFixture)"); }, 15000, "fixture navigation/ready", signal);
  checkFailures();

  // Old modules reach this existing-DOM mode assertion before any new selector.
  await call("layout", { column: 180, refresh: false });
  console.log("PASS initial minimum geometry gate");
  let states = 0;
  for (const refresh of [false, true]) for (const health of ["online", "offline", "error", "unknown"]) for (const activity of ["none", "session", "terminal", "both"]) for (const selected of ["local", "long"]) {
    const state = { column: 180, refresh, health, activity, selected };
    await call("reset", state); await call("layout", state); states += 1; checkFailures();
  }
  for (const column of [459, 460, 461, 600]) for (const refresh of [false, true]) {
    const state = { column, refresh, health: "unknown", activity: "both", selected: "local" };
    await call("reset", state); await call("layout", state); checkFailures();
  }
  console.log(`PASS ${states} minimum states plus 415/416/417 and wider host modes, both refresh states`);

  for (const nativeKey of ["Enter", " "]) {
    await call("reset"); await call("focus", "selector");
    await key(nativeKey); await call("expectState", { open: true, select: 0 }); await call("checkMenu");
    await key(nativeKey); await call("expectState", { open: false, select: 0 });
  }
  await call("reset", { health: "online" });
  await click("selector"); await call("checkMenu");
  await click("option", "remote");
  await call("expectState", { open: false, selected: "remote", select: 1 });
  await click("selector");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 1500, y: 850, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1500, y: 850, button: "left", clickCount: 1 });
  await call("resize", 180); await call("expectState", { open: false, select: 1 });

  for (const openingKey of ["ArrowUp", "ArrowDown"]) {
    await call("reset", { selected: "remote" }); await call("focus", "selector"); await key(openingKey);
    await call("expectState", { open: true, focused: "remote" });
    await key("ArrowDown"); await call("expectState", { focused: "long" });
    await key("ArrowUp"); await call("expectState", { focused: "remote" });
    await key("Home"); await key("ArrowUp"); await call("expectState", { focused: "local" });
    await key("End"); await key("ArrowDown"); await call("expectState", { focused: "unknown" });
    await key(openingKey === "ArrowUp" ? "Escape" : "ArrowLeft");
    await call("expectState", { open: false, focused: "selector", select: 0, next: 0 });
  }
  await call("reset"); await call("focus", "selector"); await key("ArrowRight");
  await call("expectState", { next: 1, select: 0 });
  await key("ArrowDown"); await key("ArrowRight");
  await call("expectState", { open: false, next: 2, select: 0 });

  for (const refresh of [false, true]) {
    await call("reset", { column: 459, refresh, health: "unknown", activity: "both" });
    await call("focus", "selector"); await key("ArrowDown"); await key("ArrowDown");
    await call("expectState", { focused: "remote", selected: "local", open: true }); await call("remember");
    for (const column of [460, 461, 460, 459]) {
      await call("resize", column); await call("unchanged");
      await call("layout", { column, refresh });
    }
    const before = await call("snapshot");
    await key("Escape"); await call("resize", 460); await click("selector"); await call("checkMenu");
    const after = await call("snapshot");
    assert(Math.abs(before.button.bottom - after.button.bottom) > 1, "Resize fixture did not move the trigger; reopen check is vacuous");
    await call("expectState", { selected: "local", select: 0, next: 0, actions: 0, reload: 0 });
  }
  await call("reset", { refresh: true });
  await click("actions"); await click("refresh");
  await call("expectState", { actions: 1, reload: 1, select: 0, next: 0 });
  checkFailures();
  console.log("PASS native Enter/Space/click, full menu, clamped navigation, focus, resize identity, menu reanchor, Actions and refresh callbacks");
}

async function run() {
  const chromeBin = findChrome();
  const temp = await mkdtemp(join(tmpdir(), "pi-webui-narrow-navigation-"));
  const failures = [];
  const cleanupErrors = [];
  let chrome, server, cdp, primary, workPromise;
  let timer;
  const controller = new AbortController();
  const signal = controller.signal;
  const signalHandlers = new Map();
  try {
    if (overlay) {
      console.log(`Source overlay baseline ${oldRevision}`);
      for (const path of modules) { assert(existsSync(join(overlay, path)), `Missing overlay module ${path}`); console.log(`${path} -> ${join(overlay, path)}`); }
    }
    const profile = join(temp, "profile"); await mkdir(profile);
    const serverPort = await port();
    let debugPort = await port();
    for (let attempt = 0; debugPort === serverPort && attempt < 8; attempt += 1) debugPort = await port();
    assert.notEqual(debugPort, serverPort, "Could not allocate distinct temporary ports");
    const origin = `http://127.0.0.1:${serverPort}/`;
    server = start(process.execPath, [self, "--fixture-server", "--port", String(serverPort), "--temp-root", temp, ...(overlay ? ["--source-overlay", overlay] : [])], "vite", temp, failures);
    const work = async () => {
      await until(async () => { assert.equal(failures.length, 0, failures.join("\n")); const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); return response.ok; }, 15000, "fixture HTTP readiness", signal);
      signal.throwIfAborted();
      chrome = start(chromeBin, ["--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--window-size=1600,900", "--force-device-scale-factor=1", "--disable-background-networking", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-features=Translate,MediaRouter,OptimizationHints", "--no-default-browser-check", "--no-first-run", "--no-sandbox", "about:blank"], "chromium", temp, failures);
      await until(() => { assert.equal(failures.length, 0, failures.join("\n")); return json(`http://127.0.0.1:${debugPort}/json/version`); }, 10000, "Chromium readiness", signal);
      signal.throwIfAborted();
      const page = await json(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
      cdp = await CDP.connect(page.webSocketDebuggerUrl, (method, params) => {
        if (method === "Runtime.exceptionThrown") failures.push(`Browser exception: ${JSON.stringify(params.exceptionDetails)}`);
        if (method === "Runtime.consoleAPICalled" && params.type === "error") failures.push(`Console error: ${JSON.stringify(params.args)}`);
        if (method === "Log.entryAdded" && params.entry?.level === "error") failures.push(`Browser log error: ${params.entry.text}`);
        if (method === "Network.requestWillBeSent" && /^https?:/u.test(params.request.url) && new URL(params.request.url).origin !== new URL(origin).origin) failures.push(`Offline violation: ${params.request.url}`);
      }, signal);
      await acceptance(cdp, origin, failures, signal);
    };
    const interrupted = new Promise((_, reject) => {
      for (const signal of ["SIGINT", "SIGTERM"]) { const handler = () => reject(new Error(`Interrupted: ${signal}`)); signalHandlers.set(signal, handler); process.once(signal, handler); }
    });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Acceptance exceeded 120000ms wall-clock budget")), 120000); });
    workPromise = work();
    await Promise.race([workPromise, interrupted, deadline]);
  } catch (error) {
    primary = error;
    controller.abort(error);
    cdp?.fail(error);
    for (const name of ["vite", "chromium"]) {
      try { console.error(`${name} log tail:\n${(await readFile(join(temp, `${name}.log`), "utf8")).slice(-12000)}`); }
      catch (logError) { if (logError.code !== "ENOENT") cleanupErrors.push(logError); }
    }
  } finally {
    clearTimeout(timer);
    controller.abort(new Error("Acceptance runner stopped"));
    cdp?.fail(signal.reason);
    if (workPromise) {
      try { await bounded(workPromise.catch(() => {}), 10000, "acceptance cancellation drain"); }
      catch (error) { cleanupErrors.push(error); }
    }
    for (const [name, handler] of signalHandlers) process.removeListener(name, handler);
    for (const [label, action] of [["CDP", () => cdp?.close()], ["Chromium", () => stop(chrome, "Chromium")], ["Vite", () => stop(server, "Vite")], ["temporary files", () => bounded(rm(temp, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }), 3000, "temporary cleanup")]]) {
      try { await action(); } catch (error) { cleanupErrors.push(new Error(`${label} cleanup failed: ${error.message}`)); }
    }
  }
  if (failures.length) cleanupErrors.push(new Error(failures.join("\n")));
  if (primary || cleanupErrors.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors], "Narrow navigation acceptance failed");
  console.log("PASS narrow navigation acceptance; browser/server/profile/logs cleaned");
}

try { if (serverMode) await serveFixture(); else await run(); }
catch (error) { console.error(error); process.exitCode = 1; }
```

### Step 2: Add the separate package script

- [ ] Insert exactly this property after `capture:screenshots` in `package.json:39-40`; do not add it to `verify` and do not edit dependencies/version/lockfile:

```json
    "verify:narrow-navigation-machine-indicator": "node scripts/verify-narrow-navigation-machine-indicator.mjs",
```

### Step 3: Prove the old-source red phase without editing a checkout

- [ ] Run the following serial negative control from the supplied PM-owned task cwd after creating the script and package entry. It creates only a disposable read-only source overlay and external evidence log, reads the exact original revision, and uses the same command/assertions as the fixed tree. `--source-overlay` does not change source on disk. A nonzero exit is required AND its cause must include `[GEOMETRY] mode at column 180`; an import/startup/missing-selector failure is rejected as invalid evidence. Do not commit a failing normal harness or old sources.

```bash
set -eu
BASE=5f8e27e9859cafe75c7c325b4b657fce0f8eb8d9
OVERLAY=$(mktemp -d)
EVIDENCE=$(mktemp)
trap 'chmod -R u+w "$OVERLAY"; rm -rf "$OVERLAY"; rm -f "$EVIDENCE"' EXIT
for FILE in src/client/src/components/appShell/AppNavigationPanel.ts src/client/src/components/MachineSwitcher.ts; do
  mkdir -p "$OVERLAY/$(dirname "$FILE")"
  git show "$BASE:$FILE" > "$OVERLAY/$FILE"
  printf '%s:%s -> %s/%s\n' "$BASE" "$FILE" "$OVERLAY" "$FILE"
done
chmod -R a-w "$OVERLAY"
set +e
CHROME_BIN="${CHROME_BIN:?Set CHROME_BIN to a Chromium binary}" npm run verify:narrow-navigation-machine-indicator -- --source-overlay "$OVERLAY" > "$EVIDENCE" 2>&1
RESULT=$?
set -e
test "$RESULT" -ne 0
grep -F '[GEOMETRY] mode at column 180' "$EVIDENCE"
# Preserve this exact baseline, mapping, exit, and matching diagnostic in the task report.
printf 'Expected original-source exit: %s\n' "$RESULT"
```

If Chromium is missing, stop with that explicit prerequisite failure. Never substitute a skip or count it as the red proof. Resolve runner startup issues in the same task until the original implementation reaches the geometry assertion. Normal fixed-tree acceptance must remain green before handoff.

### Step 4: Run focused and browser green checks serially

- [ ] Run these commands one at a time, after the old-source geometry failure is recorded. This repeats focused checks for the combined tree, not a second broad verification profile:

```bash
node --check scripts/verify-narrow-navigation-machine-indicator.mjs
npm test -- --run src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts
npm run typecheck
npm run lint
CHROME_BIN="${CHROME_BIN:?Set CHROME_BIN to a Chromium binary}" npm run verify:narrow-navigation-machine-indicator
git diff --check
```

Expected: fixed tree passes 64 minimum states (2 refresh x 4 health x 4 activity x 2 selected-name fixtures), exact 415/416/417 plus wider host checks with both refresh states, native keyboard and pointer activation, menu/focus/callback invariants, resize identity, and post-resize fixed-menu anchoring; all children and temporary artifacts are cleaned. Failures must be corrected within the task's red/green cycle. Source behavior changes, if unexpectedly needed, require parent review because this task's production allowlist is only the package script.

### Step 5: Run the single final repository gate before PM audit

- [ ] After every preceding focused/typecheck/lint/browser command has finished and the machine is otherwise idle, run exactly once:

```bash
npm run verify
```

This is the one full repository verification for the completed change, before PM audit. It already performs typecheck, lint, Knip, and the serial full suite. Do not run `verify:fast`, a redundant full suite, or any concurrent heavy job. Report the exact command result and any unrelated failure honestly; do not weaken acceptance. Review `git status --short` and `git diff --check` to confirm only the six approved implementation paths plus this pre-existing plan/spec handoff material differ. No browser requirement is folded into `npm run verify`.

### Step 6: Commit handoff to parent

- [ ] Deliver the green harness/package change, complete command results, exact old-source revision/mapping/geometry failure, and final verification result. Parent alone commits after the gate and then performs PM audit/orchestration; workers neither commit nor push:

```bash
git add scripts/verify-narrow-navigation-machine-indicator.mjs package.json
git commit -m "test(navigation): add offline narrow header acceptance"
```
