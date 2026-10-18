# Narrow Navigation Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the deterministic subagent-driven-development controller to implement this plan task-by-task.

**Goal:** Keep the navigation header readable and operable at a 324px minimum outer column width, preserve machine status accessibility, and move PWA reload controls into the Activity Rail and context bar.

**Architecture:** Use two local CSS inline-size containers for progressive disclosure while retaining the existing shell grid, 44px desktop rail reserve, resize preference format, and machine-selection policy. Keep refresh placement in `AppShellController`, render the fixed rail action through `ActivityRail.renderRailContents()`, and retain `AppRefreshControl` for the context bar. Prove component contracts with focused Vitest tests and actual geometry/native input with an isolated Chromium/CDP fixture that imports production modules.

**Tech Stack:** Existing TypeScript, Lit, Vitest/jsdom, Vite, Node.js built-ins, and Chromium DevTools Protocol; no added packages.

**Authority:** Read `docs/superpowers/specs/2026-10-17-narrow-navigation-header-design.md` first, then `docs/superpowers/specs/2026-10-17-narrow-navigation-header-spec.md`. The technical specification is normative where the two differ. Execute Tasks 1–5 in order; this document authorizes future implementation steps, while the planning session only writes and validates this plan.

## Global Constraints

- Use `.agents/skills/code-quality-architecture/SKILL.md`, `.agents/skills/testing-guide/SKILL.md`, `.agents/skills/documentation-guide/SKILL.md`, and `.agents/skills/changeset-changelog/SKILL.md` for their respective work.
- Modify only the paths named in each task's Files block; together they are the specification §1.1 allowlist. The implementation plan itself is a planning artifact, not an additional production-code allowance.
- Do not change `MachineList`, compact-navigation components, `src/client/src/components/shared.ts`, `AppRefreshControl`, `src/server/**`, sessiond, routes, API contracts, persistence formats, dependencies, lockfiles, package version, `CHANGELOG.md`, or `README.md`. Do not change `shouldShowMachinesSection()` or its `machines.length > 1` policy.
- Change only `PANEL_RESIZE_CONSTRAINTS.navigation.minWidth` from 180 to 324 in the resize implementation. Keep default 340, maximum 4096, keyboard step 24, large keyboard step 72, workspace constraints, storage key `pi-webui:panel-sizes:v1`, envelope version 1, and CSS fallback `--navigation-panel-size: 340px` unchanged. Raw persisted 260 is clamped on reading without a migration/writeback.
- Outer column means the shell's `--navigation-panel-size`; inner panel means the measured `app-navigation-panel` width. At viewport widths ≥1181px, the unchanged shell reserves 44px inside the outer column, so inner = outer − 44px. At 761–1180px, inner = outer. Header padding consumes another 24px; account for measured borders separately.
- `AppNavigationPanel` host: `container-type: inline-size; container-name: navigation-header;`. Hide only `.brand-version` under `@container navigation-header (inline-size < 372px)`. Keep π, WebUI, and the brand's existing full accessible name. Undefined `version` renders no version span.
- `MachineSwitcher` host: `container-type: inline-size; container-name: machine-switcher;`. Set `.machine-switcher-text { min-width: 48px; }` and `.machine-switcher-kicker { white-space: nowrap; }`. The kicker and name are separate grid rows; reserve their maximum width, not their sum. Only the name ellipsizes. Preserve button horizontal padding 8px, gap 6px, border 1px, and existing health colours/activity rules.
- Use exactly `@container machine-switcher (width < 150px)` on `.machine-switcher-button > .machine-status` for `font-size: 0; width: 7px; height: 7px; border-radius: 50%; background: currentColor; overflow: hidden; flex: 0 0 auto;`. At 150px and above the existing health word renders. Menu health words remain unchanged. Do not render separate simultaneous word/dot boxes.
- Neither container may add `contain`, `transform`, `filter`, or `will-change`. The machine menu remains viewport-fixed with its existing anchoring formula and may extend outside the panel.
- The selected button keeps `aria-label="Machine: <name>. Switch machine."`, `aria-expanded`, and an identity tooltip. `machineTitle(machine)` returns `machine.name` without a baseUrl and `${machine.name} — ${machine.baseUrl}` with one. The status element separately gets `title` equal to online/offline/error/unknown.
- Add a shadow-local `#machine-status-description` with `Machine status: <status>.` for every status/width and reference it with `aria-describedby="machine-status-description"`. The fixed id is unique within each switcher's shadow root, including when two standalone instances are tested. Use the exact visually-hidden clipping declarations in specification §4; never `display: none` or `visibility: hidden`.
- Header refresh is always absent. Keep the optional `AppNavigationPanel.refreshControl` declaration for compatibility, remove its rendered interpolation, and stop supplying it from `PiWebUiApp`. Delete `shouldShowAppRefreshInHeader()`. Add `shouldShowAppRefreshInRail(): boolean` = PWA && !mobile; change `shouldShowAppRefreshInContextBar(): boolean` = PWA && !desktop-rail.
- PWA refresh matrix: ≥1181px persistent rail only; 761–1180px visible context bar plus rail action when its drawer is opened; ≤760px context bar only; non-PWA none. `ActivityRail` gets `onReload?: () => void` and `showReload = false`; reload is after `.rail-spacer` and immediately before settings, including no-plugin layouts, and is excluded from all ordering/drag/persistence types.
- Preserve callback types and exactly-once behaviour. The existing selected-trigger Escape handler cancels navigation even with a menu open; minimally distinguish open-menu dismissal from closed-menu cancellation so click/native Enter/native Space → Escape closes and restores focus. Handle open-trigger ArrowLeft/ArrowRight consistently with option handling; do not add custom Enter/Space activation that duplicates the native button click.
- Header zero/one-machine omission and standalone one-machine support are distinct contracts. Keep menu order, full menu health words, and session-over-terminal activity precedence; suppress activity for offline/error.
- Use jsdom for DOM, callback, accessibility-attribute, and explicit arrow/focus tests. Inspect `MachineSwitcher.styles.cssText` through a temporary document stylesheet for the hidden-description declarations, following `SessionModelPolicyControl.test.ts`; do not trust jsdom shadow computed styles, simulate pixel layout there, or claim synthetic key events prove native activation.
- Respect strict TypeScript settings, especially `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noPropertyAccessFromIndexSignature`; narrow queried nodes, omit absent optional fields, and use `dataset["key"]` syntax. Keep new helpers local unless actual reuse requires an existing shared boundary.
- Browser harness resources, fixture HTML/module content, logs, profiles, source overlays, and ports live under a temporary directory. The only checked-in harness file is `scripts/verify-narrow-navigation-header.mjs`; use the already installed Vite and Node/CDP facilities. Do not run an application API server, a session daemon, an npm install, or a build that writes unrelated artifacts for this fixture.
- Browser gate: 1600×900; production `appStyles` and PI WEBUI dark theme tokens; nonempty version fixture `1.26.0`; required outer widths 324, 340, 366, 370, 415, 416, 460, 600; geometry tolerance 0.75px. Presence/positive-box assertions precede comparisons. Run geometry assertions before newer accessibility/refresh assertions so the old-source negative control fails on the actual layout defect.
- `npm run verify:narrow-navigation-header` is a separate required Chromium gate, never added to `npm run verify`. Chromium absence is an error, never a skipped success. Final acceptance requires `npm run verify`, the positive Chromium gate, and a 1.26.0 source-overlay run failing specifically on kicker fit, overlap, or readability.
- Do not run full suites or Chromium concurrently with other heavy jobs. Each task records exact commands/outcomes, verifies its diff, and ends with its specified Conventional Commit commands. The planner must not execute these implementation commits.

## Task 1: Raise the navigation resize floor and pin preference compatibility

**Implementer tier:** Standard

**Files:**
- modify: `src/client/src/appShell/panelResizeController.ts:37-42` — `PANEL_RESIZE_CONSTRAINTS.navigation.minWidth` only.
- modify: `src/client/src/appShell/panelResizeController.test.ts:1-115` — clamp, drag, keyboard, and raw preference regressions.

**Interfaces:**
- Consumes existing `clampPanelWidth(side: ResizablePanelSide, width: number, constraints?: PanelResizeConstraints): number`, `panelWidthFromDrag(side, startWidth, startClientX, currentClientX, constraints?): number`, `panelWidthFromKeyboard(side, currentWidth, key, options?): number | undefined`, `readStoredPanelSizes(storage?): PanelSizePreferences`, and `PANEL_SIZE_STORAGE_KEY` from `panelResizeController.ts`.
- Produces the same exports/signatures with navigation minimum 324 and unchanged version-1 read-time clamping. `PanelResizeController.panelWidth("navigation")` must also expose 324 for a raw stored 260.

### Step 1: Add explicit clamp and input-boundary regressions

- [ ] Extend the existing test file, using its `FakeStorage` and `ThrowingStorage` rather than introducing a test-support module. Import `PanelResizeController` and `ReactiveControllerHost` if exercising the controller constructor. Add these actual behavioural cases:

```ts
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
```

- [ ] Update the old 180 expectation and the old navigation ArrowLeft 300→276 expectation to 324. Keep workspace direction/Home/End tests intact. In the existing write/read/clear test, the writer's input 260 now serializes and reads as 324; update both assertions. This writer case does not replace the separate raw-JSON compatibility test.

### Step 2: Observe the failing floor tests

- [ ] Run `npm test -- --run src/client/src/appShell/panelResizeController.test.ts`. Expect assertions showing the current minimum 180/old 260 read result rather than the required 324. Resolve import/type/test-harness failures before treating the failure as the red phase.

### Step 3: Make the one-value implementation change

- [ ] Change only the navigation entry's minimum:

```ts
navigation: { minWidth: 324, maxWidth: 4096, defaultWidth: 340, keyboardStep: 24, largeKeyboardStep: 72 },
```

- [ ] Do not change `clampPanelWidth`, preference parsing/writing, storage version, viewport-aware override support, workspace constraints, or shell CSS.

### Step 4: Verify the floor and unchanged neighbouring behaviour

- [ ] Run the focused test command from Step 2, then `npm run typecheck` and `npx eslint src/client/src/appShell/panelResizeController.ts src/client/src/appShell/panelResizeController.test.ts`. Expect success with no failures; record results without pinning a brittle test count.
- [ ] Run `git diff --check` and inspect `git diff -- src/client/src/appShell/panelResizeController.ts src/client/src/appShell/panelResizeController.test.ts`. The production diff must contain only the 180→324 constant change.

### Step 5: Commit the verified resize change

- [ ] Execute:

```bash
git add src/client/src/appShell/panelResizeController.ts src/client/src/appShell/panelResizeController.test.ts
git commit -m "fix: enforce a readable navigation panel minimum"
```

## Task 2: Implement the local header layout and accessible machine presentation

**Implementer tier:** Advanced

**Files:**
- modify: `src/client/src/components/MachineSwitcher.ts:48-289` — selected-button markup, minimal open-trigger keyboard dismissal, and local CSS; `:312-325` — `machineTitle()` (baseline line numbers).
- create: `src/client/src/components/MachineSwitcher.test.ts` — real jsdom component tests and static stylesheet checks.
- modify: `src/client/src/components/appShell/AppNavigationPanel.ts:274-288` — host container and version-label query only in this task.
- modify: `src/client/src/components/appShell/AppNavigationPanel.test.ts:1-192` — DOM wordmark, header omission, and callback-forwarding regressions.

**Interfaces:**
- Consumes unchanged `Machine`, `MachineHealth`, and `WorkspaceActivity` from the existing client API; a machine fixture has `id`, `name`, `kind`, `createdAt`, `updatedAt`, and optional `baseUrl`/`status`.
- Consumes `MachineSwitcher.machines: Machine[]`, `selected?: Machine`, `statuses: Record<string, MachineHealth>`, `activities: Record<string, Record<string, WorkspaceActivity>>`, `onSelect?: (machine: Machine) => void | Promise<void>`, `onRemove?: (machine: Machine) => void | Promise<void>`, `onFocusNextSection?: () => void | Promise<void>`, and `onCancelKeyboardNavigation?: () => void | Promise<void>`.
- Produces the same public properties and `focusSelectedOrFirst(): Promise<boolean>`, plus the selected button's status title/description relationship and the two named CSS containers. Retains `AppNavigationPanel.version: string | undefined`, optional `refreshControl: unknown`, `onShowActions?: () => void`, `onSelectMachine`, `onRemoveMachine`, `onFocusNavigationTarget`, and `onCancelKeyboardNavigation` signatures. Refresh removal belongs to Task 3.

### Step 1: Establish small real-DOM test fixtures

- [ ] Add `// @vitest-environment jsdom` to the new switcher test and the existing navigation-panel test. Keep existing narrow template-wiring tests working; do not introduce new TemplateResult extraction for focus, keyboard, styling, or accessibility.
- [ ] Define file-local typed machine fixtures and mount helpers in the new switcher test. In `AppNavigationPanel.test.ts`, reuse its existing `machine(id)` helper and extend individual fixture objects rather than declaring another helper with the same name. Use a local machine and a remote machine with an intentionally long human-readable name and `baseUrl: "https://remote.example.test"`. Set properties before appending, await `updateComplete`, and assert query results are actual HTML elements. A representative setup for the new switcher file is:

```ts
function machine(id: string, name: string): Machine {
  const common = { id, name, createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z" };
  return id === "local"
    ? { ...common, kind: "local" }
    : { ...common, kind: "remote", baseUrl: "https://remote.example.test" };
}

async function mountSwitcher(status: MachineStatus): Promise<MachineSwitcher> {
  const local = machine("local", "Local");
  const remote = { ...machine("remote", "Long remote workstation name"), status };
  const element = new MachineSwitcher();
  element.machines = [local, remote];
  element.selected = remote;
  document.body.append(element);
  await element.updateComplete;
  return element;
}
```

- [ ] Remove mounted elements in `afterEach` so their document click listeners disconnect. Only stub/restore `HTMLElement.prototype.scrollIntoView` if jsdom lacks it; do not fake focus, shadow roots, bounding boxes, or the component under test. Restore all mocks/globals and temporary `<style>` elements.

### Step 2: Add the accessibility and stylesheet regressions

- [ ] For each of `online`, `offline`, `error`, `unknown`, assert the actual selected button is a native `button[type=button]`, has exact full accessible-name attribute, initially `aria-expanded="false"`, identity title containing both the remote name and URL, status element title equal to the current health word, and `aria-describedby` resolving inside that switcher's shadow root to exactly `Machine status: <status>.`. Assert kicker DOM text is `Machine`, and menu `<small>` text retains each machine's health word.
- [ ] Repeat DOM invariants after assigning narrow/wide host widths (for example 104px/194px). Label these as width-independent DOM tests; Task 4 proves actual dot/word states. Update `statuses` after mounting and await rendering to prove the description/status title changes with authoritative health. Test a local machine with no URL and require its name-only tooltip.
- [ ] Add a static stylesheet helper following `SessionModelPolicyControl.test.ts`:

```ts
function componentStyleRule(selector: string): CSSStyleDeclaration {
  const element = document.createElement("style");
  element.textContent = MachineSwitcher.styles.cssText;
  document.head.append(element);
  try {
    const rule = Array.from(element.sheet?.cssRules ?? []).find(
      (candidate): candidate is CSSStyleRule => candidate instanceof CSSStyleRule && candidate.selectorText === selector,
    );
    if (rule === undefined) throw new Error(`Missing stylesheet rule: ${selector}`);
    return rule.style;
  } finally {
    element.remove();
  }
}
```

- [ ] For `#machine-status-description`, assert `position:absolute`, width/height `1px`, padding `0`, margin `-1px`, overflow `hidden`, `clip` equivalent to `rect(0 0 0 0)` (normalize whitespace/commas), `clip-path:inset(50%)`, `white-space:nowrap`, border `0`, and absence of `display:none`/`visibility:hidden`. Use `getPropertyValue()`; tolerate CSSOM's harmless numeric serialization such as `0px`. Inspect static CSS text for the two container declarations, kicker nowrap, text 48px floor, exact direct-child health selector/150px query, and 372px version query. Do not assert computed shadow styles in jsdom.
- [ ] Mount two standalone instances, resolve each description locally, and assert each root contains exactly one matching id. Test standalone zero machines produces no selected button and one machine renders safely.
- [ ] In navigation-panel DOM tests, cover `version` undefined (no span, brand label `Pi WebUI`) and `"1.5.1"` (span `v1.5.1`, full brand label, visible π/WebUI DOM). At zero/one/two machines assert absent/absent/present switcher without changing `shouldShowMachinesSection()`.

### Step 3: Add explicit interaction and forwarding regressions

- [ ] Use actual `.click()` and bubbling/cancelable `KeyboardEvent` dispatch against rendered buttons. Await component updates and use `shadowRoot.activeElement` for focus. Opening by explicit click sets expanded true and lists all supplied machine ids in input order; no jsdom Enter/Space claim.
- [ ] With three machines and the first selected, ArrowDown/ArrowUp on the selected trigger open and focus the selected/first option; repeated option ArrowDown/ArrowUp moves and clamps at the last/first option. Keep Home/End behaviour intact. Escape and ArrowLeft from an option close the menu and restore selected-trigger focus.
- [ ] Add failing cases for click → trigger Escape and click → trigger ArrowLeft: the menu must close, expanded become false, focus stay/return on the trigger, and navigation cancellation must not fire. Trigger ArrowRight while open must close and call `onFocusNextSection` once. Closed-trigger Escape still calls `onCancelKeyboardNavigation` once. Option ArrowRight must close and forward once.
- [ ] Selecting a `.machine-option-main` calls `onSelect` once with that machine. Click a remote machine's `Actions for <name>` control and then `Remove <name>`; require `onRemove` once. Verify remote-only removal availability remains governed by existing `canRemoveMachine()`.
- [ ] Supply `WorkspaceActivity` records with `cwd`, `hasSessionActivity`, `hasTerminalActivity`, `updatedAt`: session wins when both flags are true; terminal renders when only terminal is true; offline/error suppress the indicator. Assert the existing `.activity-indicator.session`/`.terminal` DOM and health words in menu entries.
- [ ] Mount `AppNavigationPanel` with two machines and callback spies, then use the child switcher's real DOM to verify `onSelectMachine`, `onRemoveMachine`, forward-to-`onFocusNavigationTarget("projects")`, and closed-trigger `onCancelKeyboardNavigation` each fire once. Click the header `Show Actions` button and assert `onShowActions` once. Preserve the existing focus-section policy and callback return behaviour.

### Step 4: Run the new cases before implementation

- [ ] Run `npm test -- --run src/client/src/components/MachineSwitcher.test.ts src/client/src/components/appShell/AppNavigationPanel.test.ts`. Expect failures for missing descriptions/status titles, old URL-only tooltip, missing local declarations, and open-trigger dismissal. Fix test-environment/import issues separately; do not relax assertions to make the current defect pass.

### Step 5: Apply the local layout/accessibility changes

- [ ] Merge the required host container declarations into the existing `:host` rules, preserving their other declarations. Add the exact version query to `AppNavigationPanel.styles`. Do not alter brand markup/accessible-name construction or its existing 12px version font.
- [ ] In the selected-button template, add `aria-describedby="machine-status-description"`; give its direct `.machine-status` span `title=${machineStatusLabel(status)}`; render a sibling `<span id="machine-status-description">Machine status: ${machineStatusLabel(status)}.</span>` in the same shadow root. Keep it outside the button so it contributes only through `aria-describedby`, and do not alter menu status markup.
- [ ] Apply these exact local rules, replacing the existing text minimum 0 while retaining its flex/grid declarations:

```css
.machine-switcher-text { min-width: 48px; }
.machine-switcher-kicker { white-space: nowrap; }
#machine-status-description {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%);
  white-space: nowrap; border: 0;
}
@container machine-switcher (width < 150px) {
  .machine-switcher-button > .machine-status {
    font-size: 0; width: 7px; height: 7px; border-radius: 50%;
    background: currentColor; overflow: hidden; flex: 0 0 auto;
  }
}
```

- [ ] Keep `.machine-switcher-label` as the sole truncating element with `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`. Do not change the existing selected-button metrics or colour/activity/menu rules. Implement the existing local helper as:

```ts
function machineTitle(machine: Machine): string {
  return machine.baseUrl === undefined ? machine.name : `${machine.name} — ${machine.baseUrl}`;
}
```

### Step 6: Correct only the open-trigger dismissal gap

- [ ] In `handleSwitcherButtonKeydown()`, preserve native Enter/Space activation and the existing arrow-to-option path. Before the closed-menu cancel branch, intercept open-menu Escape/ArrowLeft, prevent default/propagation, set `open = false` and `openActionsMachineId = undefined`, and restore focus after `updateComplete`. In the existing trigger ArrowRight branch, close an open menu/action state before calling the unchanged `onFocusNextSection` callback once. Do not call `onCancelKeyboardNavigation` for open-menu dismissal.
- [ ] Leave the existing option navigation, selection/removal methods, menu anchoring function, and document-click listener ownership intact. If extracting a private close-and-refocus helper for the two trigger keys, keep it within `MachineSwitcher.ts` and do not widen public interfaces.

### Step 7: Verify the component contracts

- [ ] Run the focused tests from Step 4, `npm run typecheck`, and `npx eslint src/client/src/components/MachineSwitcher.ts src/client/src/components/MachineSwitcher.test.ts src/client/src/components/appShell/AppNavigationPanel.ts src/client/src/components/appShell/AppNavigationPanel.test.ts`. Expect all to pass.
- [ ] Inspect the four-file diff and run `git diff --check`. Confirm `shouldShowMachinesSection()`, compact machine-list markup, `MachineList.ts`, `shared.ts`, and menu geometry have no changes. Chromium geometry/native input remain an explicit Task 4 gate.

### Step 8: Commit the verified presentation change

- [ ] Execute:

```bash
git add src/client/src/components/MachineSwitcher.ts src/client/src/components/MachineSwitcher.test.ts src/client/src/components/appShell/AppNavigationPanel.ts src/client/src/components/appShell/AppNavigationPanel.test.ts
git commit -m "fix: preserve narrow header machine readability and accessibility"
```

## Task 3: Move PWA refresh into the fixed rail slot and context bar

**Implementer tier:** Advanced

**Files:**
- modify: `src/client/src/appShell/appShellController.ts:49-59` — refresh predicates.
- modify: `src/client/src/appShell/appShellController.test.ts:1-98` — permission matrix and media transitions.
- modify: `src/client/src/components/ActivityRail.ts:15-89` and `:365-415` — new properties/callback and fixed reload renderer.
- modify: `src/client/src/components/ActivityRail.test.ts:1-489` — reload DOM, invocation, position, and reorder exclusions.
- modify: `src/client/src/components/PiWebUiApp.ts:2470-2514` and `:4892-4921` — remove header binding and add rail bindings inside `render()`; keep context-bar/renderAppRefresh/hardReloadApp unchanged.
- modify: `src/client/src/components/appShell/AppNavigationPanel.ts:140-143` — remove refresh interpolation, retain declaration.
- modify: `src/client/src/components/appShell/AppNavigationPanel.test.ts` — prove supplied legacy refresh content is not rendered.

**Interfaces:**
- Consumes existing `AppShellControllerOptions` injectable `mobileNavigationMedia?: MediaQueryList | undefined`, `activityRailDesktopMedia?: MediaQueryList | undefined`, and `pwaDisplayModeMedia?: MediaQueryList[] | undefined`, plus existing `isMobileNavigationLayout`, `isDesktopActivityRailLayout`, and `isPwaDisplayMode` state.
- Produces `shouldShowAppRefreshInRail(): boolean` and changed `shouldShowAppRefreshInContextBar(): boolean`; removes `shouldShowAppRefreshInHeader()`.
- Produces `ActivityRail.onReload?: () => void` and `showReload: boolean` (default false), with one fixed `.icon-button.rail-reload-button` titled/named `Full page reload` when allowed. Consumes existing `invokeCoreAction(action: (() => void) | undefined): void` so drawer close precedes callback.
- Consumes existing private `PiWebUiApp.hardReloadApp(): void`, which calls `window.location.reload()`, and `renderAppRefresh()`, which renders the unchanged `app-refresh-control` callback for `AppContextBar.refreshControl: unknown`.

### Step 1: Add controller matrix regressions at both exact breakpoints

- [ ] Extend the existing `FakeMediaQueryList`/`FakeHost` test setup. Inject all three media sources so Node defaults cannot hide a boundary error. Test each width 760, 761, 1180, 1181 for both PWA true and false using the following structure:

```ts
for (const width of [760, 761, 1180, 1181]) {
  for (const pwa of [false, true]) {
    it(`places refresh at ${width}px with PWA=${String(pwa)}`, () => {
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
```

- [ ] Ensure navigator's `standalone` fallback is false in these cases using a restored test boundary stub if necessary. Add one connected-controller case that dispatches mobile/desktop/PWA changes and checks refreshed predicates and `requestUpdate`; disconnect and assert every media listener removed. Retain the existing desktop-layout/disconnect test.

### Step 2: Add rail and header DOM regressions

- [ ] Use jsdom for new `ActivityRail.test.ts` DOM assertions (add the environment directive and local append/update/cleanup helpers). Preserve existing narrowly justified template-wiring tests; correct their environment comments if now stale. Reuse the file's desktop-media fake and restore any test that temporarily substitutes global `HTMLElement` before the next DOM test.
- [ ] Mount persistent and compact-open rails with `showReload` false/true. Require zero/one matching buttons; verify native button type, `title`, `aria-label`, and refresh SVG hidden from assistive technology. Set `pluginItems=[]` for the no-separator case and also retain a nonempty-plugin case.
- [ ] Assert real DOM sibling order: `rail.querySelector(".rail-spacer")?.nextElementSibling === reload` and `reload.nextElementSibling === settings`. Changing/reversing `railOrder` must not move reload from that fixed slot. It must have no `data-rail-item`, `draggable`, or draggable-true property, and `railOrder`/order-change payloads must exclude reload.
- [ ] Click the rendered reload button with an `onReload` spy and require one call. In a compact-open rail capture the call order as `["close", "reload"]` via `onCloseCompact`/`onReload`; undefined `onReload` must be safe. Exercise a dragstart on reload and a subsequent drop with a spied `onRailOrderChange`; require no ordering change attributable to reload. Do not add it to `ReorderableRailItem`, `DEFAULT_RAIL_ORDER`, or persistence.
- [ ] In the navigation-panel jsdom test, assign a Lit sentinel to the retained compatibility property and assert it is not rendered:

```ts
const panel = new AppNavigationPanel();
panel.refreshControl = html`<button data-refresh-sentinel>Legacy refresh</button>`;
document.body.append(panel);
await panel.updateComplete;
expect(panel.shadowRoot?.querySelector("[data-refresh-sentinel]")).toBeNull();
expect(panel.shadowRoot?.querySelector('button[aria-label="Show Actions"]')).not.toBeNull();
```

### Step 3: Observe the refresh regressions

- [ ] Run `npm test -- --run src/client/src/appShell/appShellController.test.ts src/client/src/components/ActivityRail.test.ts src/client/src/components/appShell/AppNavigationPanel.test.ts`. The new controller method, fixed action, and legacy-header omission cases must fail for the intended current behaviour before implementation.

### Step 4: Replace the predicates and add the fixed reload renderer

- [ ] Replace the header predicate with the rail predicate, and implement context-bar permission exactly:

```ts
shouldShowAppRefreshInRail(): boolean {
  return this.isPwaDisplayMode && !this.isMobileNavigationLayout;
}

shouldShowAppRefreshInContextBar(): boolean {
  return this.isPwaDisplayMode && !this.isDesktopActivityRailLayout;
}
```

- [ ] Add to `ActivityRail`:

```ts
@property({ attribute: false }) onReload?: () => void;
@property({ type: Boolean }) showReload = false;
private readonly reloadApp = (): void => { this.invokeCoreAction(this.onReload); };
```

- [ ] Add a private `renderReloadButton(): TemplateResult` using `type="button"`, `class="icon-button rail-reload-button"`, `title="Full page reload"`, `aria-label="Full page reload"`, and `@click=${this.reloadApp}`. Reuse the existing rail SVG conventions (20px, currentColor stroke, `aria-hidden="true"`, `focusable="false"`) and the four refresh paths already in `AppRefreshControl.ts`: `M20 6v5h-5`, `M4 18v-5h5`, `M18.2 9A7 7 0 0 0 6.1 6.8L4 9`, `M5.8 15a7 7 0 0 0 12.1 2.2L20 15`. Do not edit `AppRefreshControl.ts`.
- [ ] In `renderRailContents()`, after the unconditional `.rail-spacer`, insert `${this.showReload ? this.renderReloadButton() : nothing}` immediately before `${this.renderSettingsButton()}`. Use the existing `nothing` import. This single path covers persistent and compact rails; do not add another drawer renderer or any drag metadata.

### Step 5: Wire the real application and remove header rendering

- [ ] In the actual `<activity-rail>` template inside `PiWebUiApp.render()` (there is no `renderActivityRail()` helper), add:

```ts
.onReload=${() => { this.hardReloadApp(); }}
.showReload=${this.appShell.shouldShowAppRefreshInRail()}
```

- [ ] Remove `.refreshControl=${this.appShell.shouldShowAppRefreshInHeader() ? this.renderAppRefresh() : undefined}` from `renderNavigationPanel()`. Remove `${this.refreshControl}` from `AppNavigationPanel`'s `.header-actions`, keeping the property declaration and Actions button/wrapper.
- [ ] Keep the context-bar binding `.refreshControl=${this.appShell.shouldShowAppRefreshInContextBar() ? this.renderAppRefresh() : undefined}` and the existing `renderAppRefresh()`/`hardReloadApp()` implementations. Do not change context-bar/compact-navigation components.

### Step 6: Verify matrix, integration types, and fixed-slot scope

- [ ] Run the focused tests from Step 3, `npm run typecheck`, and `npx eslint src/client/src/appShell/appShellController.ts src/client/src/appShell/appShellController.test.ts src/client/src/components/ActivityRail.ts src/client/src/components/ActivityRail.test.ts src/client/src/components/PiWebUiApp.ts src/client/src/components/appShell/AppNavigationPanel.ts src/client/src/components/appShell/AppNavigationPanel.test.ts`. Expect success.
- [ ] Run `rg -n 'shouldShowAppRefreshInHeader|shouldShowAppRefreshInRail|shouldShowAppRefreshInContextBar|refreshControl=' src/client/src/appShell/appShellController.ts src/client/src/components/PiWebUiApp.ts src/client/src/components/appShell/AppNavigationPanel.ts`. Production results must show no old header predicate, the new rail predicate/binding, and only the context-bar refresh binding. The test asserting the removed method's absence is deliberately outside this search.
- [ ] Inspect the seven-file diff and run `git diff --check`. Actual PWA placement and reload activation through `PiWebUiApp` are proved by Task 4's Chromium scenarios, without adding a test file outside the specification allowlist.

### Step 7: Commit the verified refresh relocation

- [ ] Execute:

```bash
git add src/client/src/appShell/appShellController.ts src/client/src/appShell/appShellController.test.ts src/client/src/components/ActivityRail.ts src/client/src/components/ActivityRail.test.ts src/client/src/components/PiWebUiApp.ts src/client/src/components/appShell/AppNavigationPanel.ts src/client/src/components/appShell/AppNavigationPanel.test.ts
git commit -m "fix: place PWA reload controls in the rail and context bar"
```

## Task 4: Add the deterministic Chromium geometry and native-input gate

**Implementer tier:** Advanced

**Files:**
- create: `scripts/verify-narrow-navigation-header.mjs` — self-contained parent runner, Vite child mode, virtual fixtures, assertions, and cleanup.
- modify: `package.json:30-50` — add only `"verify:narrow-navigation-header": "node scripts/verify-narrow-navigation-header.mjs"` beside the existing screenshot/verification scripts.

**Interfaces:**
- Consumes unchanged `appStyles` (used as `PiWebUiApp.styles`), `PiWebUiApp`, `AppNavigationPanel`, `MachineSwitcher`, `ActivityRail`, `AppContextBar`, `themePackPlugin`, `applyPiWebUiTheme`, and `THEME_TOKENS` through Vite-transformed imports of their actual existing paths.
- Consumes Tasks 1–3 contracts verbatim: outer minimum 324/default 340; header inner threshold 372; switcher threshold 150; text floor 48; description/status titles; rail `showReload: boolean`, `onReload?: () => void`; `AppShellController.shouldShowAppRefreshInRail(): boolean` and `shouldShowAppRefreshInContextBar(): boolean`.
- Produces CLI `node scripts/verify-narrow-navigation-header.mjs [--chrome-bin <executable>] [--source-overlay <directory>]`. CLI executable overrides `CHROME_BIN`, then use executable discovery. An explicit but invalid executable is an error, not a fallback. Unknown/missing arguments exit nonzero.
- `--source-overlay` directory contains exactly the replacement paths `src/client/src/components/MachineSwitcher.ts` and `src/client/src/components/appShell/AppNavigationPanel.ts`. Replace their Vite-loaded source text while preserving the current repository module ids/import resolution; all other modules, fixtures, and assertions stay identical. No production edits or silent overlay skips.
- A passing run prints tested cases and a final JSON summary; a failing run prints an assertion category and case dimensions, child/module/runtime errors, and retained log location if useful, then exits nonzero after bounded cleanup. Missing selectors/imports/startup failures have separate setup categories and cannot count as an acceptable negative control.

### Step 1: Add the runner, package entry, and bounded process protocol

- [ ] Add the single package script without changing `verify`, package version, dependencies, or lockfile. Implement the runner as Node ESM using `node:assert/strict`, `node:child_process`, `node:events`, `node:fs/promises`, `node:net`, `node:os`, `node:path`, and `node:url` as needed, plus existing `vite` and Node's WebSocket. Do not import `capture-screenshots.mjs` because it has top-level execution; adapt its small `findChrome`, `chromeArgs`, `openPage`, CDP request-id handling, and cleanup patterns locally.
- [ ] Parent creates one `mkdtemp` root, spawns this same script with a private `--vite-child` mode over IPC, and starts Chromium with a temporary profile, headless-new/no-sandbox flags as in `capture-screenshots.mjs`, and `--remote-debugging-port=0`. Read `DevToolsActivePort` from that private profile; Vite binds port 0 and reports its actual loopback port over IPC. This avoids a free-port allocation race and leaves no persistent port file.
- [ ] Child calls Vite `createServer()` with `configFile:false`, repository client root, cache directory under the temp root, loopback-only host, `server.port:0`, and only the fixture/overlay plugins described in Step 2. Serve a unique fixture route. Never start `src/server/index.ts`/sessiond or connect to the user's existing application.
- [ ] Give startup/fixture waits finite bounds (30s startup, 15s fixture readiness), every CDP call a timeout (10s), and the complete run a five-minute deadline. Reject pending CDP calls on socket close/process exit; report page exceptions, import failures, and failed fixture requests. Wait on explicit readiness, `updateComplete`, document fonts, and animation frames rather than fixed sleeps.
- [ ] Register cleanup before spawning. On success, thrown assertion, startup failure, deadline, SIGINT, or SIGTERM: close page/CDP, request browser close and Vite shutdown, await children for at most 2s each, send SIGTERM then after at most 2s SIGKILL, reap each child, and remove the temp profile/cache/DevTools port directory with bounded retries. Remove watchdog timers/listeners and temporary fixture globals. Cleanup must be idempotent and preserve the original nonzero failure. Do not leave `setInterval`/promises keeping the process alive.
- [ ] Fail loudly before opening a fixture if no executable is available: `Chromium was not found. Install chromium-browser/chromium or set CHROME_BIN=/path/to/chrome.` Add a private child-mode argument parser that cannot bypass normal assertions in the public CLI.

### Step 2: Serve production components and a strict source overlay

- [ ] The fixture Vite plugin serves virtual HTML and a JS entry; keep both in the one script. Import production modules through Vite, not copied CSS/templates. Import `PiWebUiApp` from `src/client/src/components/PiWebUiApp.ts`, `MachineSwitcher` from its sibling, `themePackPlugin` from `src/client/src/plugins/themes/index.ts`, and `applyPiWebUiTheme`/`THEME_TOKENS` from `src/client/src/theme.ts`. Virtual fixture URL paths are harness-only local Vite resources, not new production application routes.
- [ ] Preserve the actual app rendering, `AppShellController`, panel controllers, header components, drawer launcher, and `hardReloadApp()` behaviour. Suppress only the app's network/session lifecycle in the fixture: replace the instance's/prototype's `PiWebUiApp.connectedCallback` and `disconnectedCallback` with the corresponding `LitElement.prototype` methods before mounting, so registered reactive controllers still connect/disconnect. Do not replace render methods, refresh predicates, header markup/styles, media-query results for viewport widths, or callbacks under test. Use no selected project/workspace/session, so unrelated network polling/terminal startup is inactive. Fail on unexpected API requests rather than serving fabricated application data.
- [ ] Set PWA input before constructing the app, e.g. fixture-controlled `navigator.standalone`, while preserving native `window.matchMedia` for width breakpoints. In each fresh scenario page seed raw version-1 panel size JSON before constructing the app, and populate its existing `state` with two deterministic machines, selected machine, `machineStatuses`, and `machineActivities`. Set `piWebUiStatus.components.web.runtimeVersion` via the existing state shape to `"1.26.0"`; verify the actual rendered `.brand-version` contains `v1.26.0` even when CSS hides it. Use an actual valid `PiWebUiStatusResponse` fixture with required `packageName`, `generatedAt`, component statuses, `release`, `commands`, and `messages`, following `PiWebUiApp.version.test.ts`'s existing response fixture. Do not add a synthetic property that production rendering never reads.
- [ ] Obtain the real dark contribution from `(await themePackPlugin.activate()).contributions.themes` with id `pi-webui-dark`, qualify its id as `themes:pi-webui-dark`, and apply it with `applyPiWebUiTheme()`. Assert every `THEME_TOKENS` value required by this contribution is present on the document root and that the production host stylesheet is `appStyles`. Set only document/body viewport/reset dimensions needed for the fixture, and no substitute font, padding, flex, button, or component layout rules. Let production font declarations govern all measurements.
- [ ] Expose a small fixture object with `app`, async `setOuterWidth(width)`, async `setMachine({name,status,activity})`, and readiness/measurement methods. `setOuterWidth` calls the existing panel controller's `resizePanel("navigation", width, {persist:false})` or sets the production shell custom property after controller initialization, then waits for rendering and two animation frames. Do not pass inner widths off as outer columns. Read actual controller/DOM values after every operation.
- [ ] For the 150px switcher matrix, mount the real `MachineSwitcher` directly in the same themed page and set only its host width to 149px, 150px, 151px; do not overwrite its shadow CSS. This explicitly tests the switcher's own query independently of header space allocation. Restore/remove this fixture before application-layout cases.
- [ ] Overlay Vite plugin uses `enforce:"pre"` and matches the two exact normalized absolute ids under the current repo root, stripping only Vite query suffixes. For a match, read `<overlay>/<same repo-relative path>` and return that source from `load()`, retaining the original id so relative imports still resolve in the current tree and each custom element has one canonical module identity. Reject missing/unreadable overlay files up front; log both replacements. Do not overlay `shared.ts`, current app wiring, fixture assertions, or dependency files.

### Step 3: Implement geometry helpers that cannot pass on invisible elements

- [ ] Keep DOM measurement/readiness helpers in the virtual browser module and return serializable rects/computed values to the parent; perform numerical comparisons with the parent runner's `node:assert/strict` import. The browser fixture must not import Node assertion modules. Use categories `FIXTURE_SELECTOR`, `FIXTURE_IMPORT`, `FIXTURE_RUNTIME`, `KICKER_FIT`, `OVERLAP`, `READABILITY`, `BOUNDARY`, `MONOTONICITY`, `MENU_ANCHOR`, `NATIVE_INPUT`, `REFRESH`, and `CLEANUP` with width/status/activity/name in every failure. Missing selectors/imports must never be recategorized as layout defects.
- [ ] First resolve every required node and assert a positive width/height with a finite rect: `.machine-switcher-kicker`, `.machine-switcher-label`, selected `.machine-status`, `.machine-chevron`, and `.activity-indicator` only when production should render one. A present but zero-sized kicker/name is a `KICKER_FIT`/`READABILITY` failure; an absent node is always `FIXTURE_SELECTOR`. Also require positive selected-button/header/text-column boxes before comparing them.
- [ ] Compare all pairs in the overlap set in two dimensions, including the vertically separated kicker/name rows. A gap in either axis means no overlap; do not reject the same text column merely because both rows share x coordinates:

```js
const EPSILON = 0.75;
function intersection(a, b) {
  return {
    width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  };
}
function assertSeparate(a, b, label) {
  const overlap = intersection(a, b);
  assert.ok(!(overlap.width > EPSILON && overlap.height > EPSILON), `OVERLAP ${label}: ${JSON.stringify(overlap)}`);
}
```

- [ ] Measure the uppercased kicker's advance with its actual computed font and letter-spacing, not raw `textContent.length` or a hard-coded glyph width. Obtain a DOM Range rect for its rendered text; cross-check a canvas `measureText(renderedText)` with the computed font and CSS letter-spacing (Chromium includes the trailing letter spacing in the inline advance). Require a single rendered line, `white-space:nowrap`, measured advance ≤ laid-out width + 0.75px, and no kicker clipping/ellipsis. The name may ellipsize; the kicker may not.
- [ ] Require text-column width ≥48px (allow only 0.75px numerical tolerance), selected button and header `scrollWidth <= clientWidth`, and a short name `Local` width ≥40px at outer 324. For a long name, require positive visible label width, actual overflow (`scrollWidth > clientWidth`), and computed `overflow:hidden`, `text-overflow:ellipsis`, `white-space:nowrap`; verify its tooltip/accessible name still carries the full identity. Do not count an absent/zero-width label as successful ellipsis.
- [ ] Run these geometry/readability assertions first, before requiring the new description node, status tooltip, rail refresh, or query-container declaration. That sequencing lets unchanged 1.26.0 modules reach an existing-selector geometry assertion.

### Step 4: Cover the full width, status, activity, and query-boundary matrices

- [ ] At viewport 1600×900 and `deviceScaleFactor:1`, run outer columns `[324,340,366,370,415,416,460,600]` for short and long names, all four statuses, and no/session/terminal activity inputs. When both session and terminal are true, require the existing session indicator. For offline/error require absence despite active input; for online/unknown active inputs require a positive activity box. Assert every applicable non-overlap/readability invariant after awaiting layout.
- [ ] At outer 324, require health is the dot (`font-size:0`, 7×7px, currentColor background, positive box) and `.machine-status.title` equals its status word, while the shadow description and `aria-describedby` still expose status. At wide widths require the health word has nonzero computed font-size and no separate dot element. Menu health text remains full-sized for all statuses.
- [ ] Assert actual outer/inner sizes at every listed column: outer from the `#navigation-panel`/shell column measurement, inner from `app-navigation-panel`, with desktop inner = outer −44 within tolerance. In particular 415→371px inner hides `.brand-version`; 416→372px inner shows it. Require positive π/WebUI/Actions boxes and no header-element overlap at both boundaries, using actual display/rect state rather than presence alone.
- [ ] At standalone switcher widths 149,150,151 for every status, assert dot/word/word respectively, exact status tooltip, status-description relationship, required activity behaviour, positive boxes, and the same non-overlap checks. Keep menu `<small>` health words unaffected by the direct-child rule even with the narrow trigger.
- [ ] Sweep outer 324→600 in increments of 2px (include the odd 415px boundary separately, sort/deduplicate). For each of online/unknown with active input and offline/error with suppressed activity, compute `wordVisible = computed font-size > 0 && positive status box`; require it never goes true→false as outer width increases. Re-run positive-box/no-overlap checks through the sweep and report the first failing adjacent widths with measured inner/switcher sizes.
- [ ] At viewport 1100×900, repeat outer 324,340,366,370,371,372,415,416,460,600 as valid drawer-layout header cases. Assert inner = outer (no 44px reserve), version hidden at inner 371 and shown at 372, and the selected geometry remains non-overlapping. This drawer geometry case is separate from the PWA refresh drawer-open case.

### Step 5: Verify fixed menu anchoring and native key activation

- [ ] At 1600×900/outer324 with a long machine name, open the menu through the actual trigger and measure both rects. Expected width is `min(280, innerWidth - 16)`; expected left is `min(max(8, trigger.left), max(8, innerWidth - 8 - expectedWidth))`; expected top is rounded `trigger.bottom`; compare existing rounding within 0.75px. Assert computed `position:fixed`, viewport bounds, and menu bottom constrained by available height. Require it extends outside the header at this narrow width, and a deep shadow-aware `elementFromPoint` near its extended visible region hits a menu descendant rather than a clipping overlay. Do not use only bounding rects as proof of visibility.
- [ ] Focus the actual selected button and use CDP, not in-page `KeyboardEvent` or `element.click()`, for native activation. Dispatch full down/up sequences; Space activates on keyup:

```js
await cdp.send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r",
});
await cdp.send("Input.dispatchKeyEvent", {
  type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
});
// In a separate closed-menu case:
await cdp.send("Input.dispatchKeyEvent", {
  type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: " ", unmodifiedText: " ",
});
await cdp.send("Input.dispatchKeyEvent", {
  type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32,
});
```

- [ ] After each activation require a visible menu, `aria-expanded="true"`, and unchanged selected-button accessible name/description. Send native Escape down/up (`key:"Escape"`, `code:"Escape"`, virtual key 27), wait for updates, then require menu absence, expanded false, and deep active element equal to the selected trigger. Include pointer click → Escape as a third trigger-focus dismissal case. Do not move focus to an option artificially before Escape; this must cover the existing trigger gap fixed in Task 2.

### Step 6: Verify PWA placement and reload through application wiring

- [ ] Use the real mounted `PiWebUiApp` and fresh scenario pages for PWA/non-PWA at widths 1600,1181,1180,1100,761,760,700 (height900). Read reload buttons inside the appropriate component shadow roots and assert positive/visible boxes as well as counts. All navigation headers must contain zero reload controls, including a mobile header when its normal view is active.
- [ ] PWA 1600/1181: exactly one visible `.rail-reload-button` in persistent rail, zero context `app-refresh-control`, zero header reloads. PWA 1180/1100/761: closed drawer has no visible rail reload, context bar has exactly one visible `app-refresh-control`; click its actual Activity Rail launcher, require one visible rail reload and the still-present context control. PWA760/700: context control only, and opening the Activity Rail still exposes no rail reload. Non-PWA: zero reload controls in header/context/rail with drawer both closed and opened. Do not incorrectly demand only one total control while the middle-band drawer is open; the specification permits both surfaces.
- [ ] Locate the real context-bar launcher by its accessible label from `AppContextBar.ts`; do not invoke an internal open method or construct a separate rail to prove app wiring. Verify rail reload remains directly before settings and after spacer in the open drawer.
- [ ] Exercise actual application reload activation from desktop rail, middle-band drawer rail, middle-band context control, and mobile context control. Keep `hardReloadApp()` and `window.location.reload()` real: wrap the fixture instance's `hardReloadApp` only to increment a `sessionStorage` invocation counter before calling the bound original. Register the CDP navigation wait before clicking the actual control, require exactly one counter increment, a new main-frame document/loader, fixture readiness in the reloaded page, and correct refresh placement again. Do not call an assigned callback directly, monkeypatch `location.reload`, or replace `onReload` with a spy that bypasses `PiWebUiApp`.

### Step 7: Run the positive gate and its exact old-source negative control

- [ ] Run `node --check scripts/verify-narrow-navigation-header.mjs`, `npx eslint scripts/verify-narrow-navigation-header.mjs`, `npm run typecheck`, and `npm run verify:narrow-navigation-header` serially. Expect syntax/lint/types and every browser case to pass. During harness development, an assertion must report a concrete measured value, never a skip or a swallowed exception. If normative geometry fails after Tasks 1–3, report the measured design/spec conflict; do not weaken thresholds/assertions, inject substitute CSS, or edit production files outside this task's allowance.
- [ ] Prepare the negative control from the locally available exact `v1.26.0` git object (currently commit `3f7e949bab02b65839359b652fcbfcb500dd2d6b`), using this shell procedure after the positive run. It reads git state but does not check out/reset files:

```bash
negative_root=$(mktemp -d /tmp/pi-webui-narrow-negative.XXXXXX)
mkdir -p "$negative_root/src/client/src/components/appShell"
git show v1.26.0:src/client/src/components/MachineSwitcher.ts > "$negative_root/src/client/src/components/MachineSwitcher.ts"
git show v1.26.0:src/client/src/components/appShell/AppNavigationPanel.ts > "$negative_root/src/client/src/components/appShell/AppNavigationPanel.ts"
set +e
npm run verify:narrow-navigation-header -- --source-overlay "$negative_root" > "$negative_root/run.log" 2>&1
negative_status=$?
set -e
printf 'Negative-control exit: %s\n' "$negative_status"
```

- [ ] Before accepting the run, compare each extracted file's `git hash-object` with `git rev-parse v1.26.0:<same-path>`; require exact bytes. Inspect the logged failure and assert `negative_status != 0` and category `KICKER_FIT`, `OVERLAP`, or `READABILITY`. Missing selector/import, old-source description absence, startup timeout, refresh differences, or an intentional unconditional error do not satisfy this control. Keep fixture/assertion ordering identical with and without overlay. Record the two blob hashes, exit code, first failing width, assertion, and measured values; then `rm -rf -- "$negative_root"` only after confirming it is the created `/tmp/pi-webui-narrow-negative.*` directory.
- [ ] Verify an invalid explicit executable (`CHROME_BIN=/definitely/missing/chromium npm run verify:narrow-navigation-header`) exits nonzero with an actionable executable error. Trigger one managed assertion failure via the negative overlay and one interrupted run; after each, confirm no spawned Chromium/Vite child remains and the private temp profile/port directory has been removed. Do not broaden this into an unrelated process cleanup script.
- [ ] Run `git diff --check`; inspect `git diff -- package.json` to confirm exactly one script addition and no dependency/version changes. Confirm `npm run verify` has not acquired a Chromium requirement.

### Step 8: Commit the verified browser gate

- [ ] Execute:

```bash
git add scripts/verify-narrow-navigation-header.mjs package.json
git commit -m "test: verify narrow navigation headers with Chromium"
```

## Task 5: Document the behaviour, add a patch changeset, and run final acceptance

**Implementer tier:** Standard

**Files:**
- create: `.changeset/narrow-navigation-header.md` — one patch release note for the complete user-visible fix.
- create: `docs/navigation-panel.md` — canonical concise operating guidance for navigation width, progressive disclosure, and refresh placement.

**Interfaces:**
- Consumes final behaviour: outer minimum324/default340, header version hidden below inner372, selected health word replaced below switcher150, full identity/status accessible, and PWA placement predicates `shouldShowAppRefreshInRail(): boolean` / `shouldShowAppRefreshInContextBar(): boolean` from Task3.
- Consumes `npm run verify:narrow-navigation-header` and its `--source-overlay <directory>` negative-control interface from Task4; consumes existing `npm run verify` (typecheck/lint/knip/serial Vitest).
- Produces only documentation and a Changesets patch fragment for `@hyperdreamer/pi-webui`; performs no release/version/publish action.

### Step 1: Write the exact patch changeset

- [ ] Create `.changeset/narrow-navigation-header.md` with:

````markdown
---
"@hyperdreamer/pi-webui": patch
---

Keep the navigation header readable by raising its minimum column width to 324px while retaining the 340px default. Hide the visual version label in narrow headers and replace cramped machine health words with status dots while keeping machine names and health text accessible. Move installed-app reload controls from the navigation header to the Activity Rail, with context-bar access in smaller layouts.
````

- [ ] Do not run `changeset version`, change package metadata, generate `CHANGELOG.md`, tag, publish, or alter unrelated fragments.

### Step 2: Write the canonical navigation-panel documentation

- [ ] Create `docs/navigation-panel.md` with the following complete content, preserving the distinction between outer columns, inner panels, and switcher widths:

````markdown
# Navigation panel

The navigation column can be resized down to 324px. Its default width remains 340px. An older saved width below 324px is clamped when it is loaded; no preference migration is needed.

## Header labels

The π symbol, WebUI wordmark, and Actions control remain available as the column narrows. The visual version label hides when the navigation panel itself is narrower than 372px and returns from 372px. The brand's accessible name continues to include the version.

On desktop layouts at least 1181px wide, the 44px Activity Rail is reserved inside the navigation column. This means the version label hides at a 415px column and appears at 416px. In the 761–1180px drawer layout, the inner panel uses the full column width, so the version boundary is 372px of column width.

When more than one machine is available, the header shows the machine switcher. Long names use an ellipsis; the full name remains in the accessible label and tooltip. Remote-machine tooltips also include the address. With zero or one machine, the header omits the switcher.

The selected machine's health word becomes a coloured dot when the switcher itself is narrower than 150px. The word returns from 150px. Hovering the health indicator still shows the status text, and assistive technology receives a description such as “Machine status: online.” Menu entries continue to show full health words. Activity indicators retain their existing behaviour and are suppressed for offline or error states.

## Reloading an installed app

The navigation header has no reload control. In installed-app/PWA display mode, use the control named **Full page reload** in these locations:

| Window width | Reload location |
| --- | --- |
| 1181px and wider | Activity Rail, immediately above Settings |
| 761–1180px | Context bar; also in the Activity Rail drawer when it is open |
| 760px and narrower | Context bar |

These reload controls are not shown in an ordinary browser tab. The rail reload action has a fixed position and does not participate in rail reordering.

## Developer verification

Run `npm run verify` for the standard checks. Run `npm run verify:narrow-navigation-header` separately for actual header geometry, container-query boundaries, native keyboard activation, and reload placement. The latter requires a discoverable Chromium executable or `CHROME_BIN=/path/to/chrome` and fails if Chromium is unavailable.

The browser harness accepts `--source-overlay <directory>` for a regression negative control. The directory must contain `src/client/src/components/MachineSwitcher.ts` and `src/client/src/components/appShell/AppNavigationPanel.ts` extracted unchanged from `v1.26.0`. That run must fail on kicker fit, overlap, or name readability; an import or missing-selector failure is not valid evidence.
````

- [ ] This is a new canonical page under the specification allowlist; do not grow the README or add unrelated index/HTML files. Review the words against measured Task4 results, especially 415/416 versus inner372 and health words versus the switcher's own150 threshold. If a measured contract differs, resolve it as a specification discrepancy instead of silently documenting a different implementation.

### Step 3: Review release-note and documentation scope

- [ ] Verify the changeset front matter targets the actual package `@hyperdreamer/pi-webui` with `patch`, includes all three user-visible changes, and contains no version bump/release claim. Verify the documentation's commands match `package.json` and referenced source paths exist. No links beyond the allowlist are required.
- [ ] Run `git diff --check` and inspect both newly written files explicitly (untracked files do not appear in an ordinary `git diff`). Confirm `README.md`, `CHANGELOG.md`, lockfiles, forbidden components, and all server/daemon code remain unchanged throughout the implementation.

### Step 4: Run and record the final acceptance gates

- [ ] With no competing heavy jobs, run `npm run verify`, then `npm run verify:narrow-navigation-header`. Record exact commands, exit statuses, and substantive pass output. Do not substitute `verify:fast`, a prior task's output, jsdom, screenshots alone, or an assertion-free smoke run for these two final gates.
- [ ] Run the unchanged `v1.26.0` source-overlay procedure from Task4 against the final candidate; independently recheck the extracted source blob hashes and require the nonzero kicker/overlap/readability assertion. Remove the created overlay directory afterward. Preserve the evidence in the execution handoff rather than adding an unapproved repository report file.
- [ ] Review `git diff --stat HEAD`, `git status --short`, and `git diff --check`. Confirm the only current task changes are the two Files entries, all previous commits stayed inside the specification's allowlist, the final package version is still `1.26.0`, and the normal `verify` script remains Chromium-independent. Report any unrelated pre-existing verification failure accurately; do not change forbidden/out-of-task files to hide it.
- [ ] Final execution handoff must map specification §§2–8 to Tasks1–5, include focused and final verification evidence, positive/negative browser results, and note that this client-only change uses the UI/API autoreload path; no session daemon restart is needed because no daemon-loaded code changes.

### Step 5: Commit the verified documentation and release note

- [ ] Execute:

```bash
git add .changeset/narrow-navigation-header.md docs/navigation-panel.md
git commit -m "docs: explain narrow navigation headers and reload placement"
```
