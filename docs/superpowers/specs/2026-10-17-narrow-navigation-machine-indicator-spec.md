# Technical Specification: Narrow Navigation Machine Indicator

**Date:** 2026-10-17

**Status:** Independently reviewed; approved by the user for implementation

**Related Design Document:** `docs/superpowers/specs/2026-10-17-narrow-navigation-machine-indicator-design.md`

**Target Package:** `@hyperdreamer/pi-webui`

**Change Class:** user-visible bug fix (patch)

**Runtime impact:** client/UI only; no session-daemon restart

## 1. Purpose and Scope

The expanded navigation header currently keeps the brand, machine selector, optional PWA
refresh control, and Actions control in one flex row. At the desktop minimum navigation
column, the activity-rail reserve leaves the expanded panel too little inline space for
that row. The selected machine label can collapse to an unusable width while the health
state and chevron overflow into the panel clip.

This specification implements the approved design as a contained presentation change:

1. At an expanded navigation host inline size below 416px, the header becomes a two-row
   grid. The compact pi-only brand and the refresh/Actions group occupy row one. The
   machine selector occupies row two.
2. At exactly 416px and above, the existing single-line presentation remains in use.
3. The selected health word becomes a seven-pixel colored dot in narrow mode while its
   complete state remains available through a same-shadow-root accessible description and
   a tooltip. The health word remains visibly rendered in wide mode and in every menu
   entry.
4. Existing machine data, selection callbacks, menu state, fixed viewport menu
   positioning, keyboard navigation, focus behavior, activity precedence, and health
   fallback semantics remain unchanged.

The change does not alter application state or the navigation panel's width constraints.
It is a CSS/container-query layout change plus the minimum internal markup needed for the
brand class and explicit selected-status description.

### 1.1 Production ownership and file list

Production edits are limited to:

- `src/client/src/components/appShell/AppNavigationPanel.ts`
  - named inline-size container on the expanded navigation host;
  - brand wordmark class;
  - narrow header grid, spacing, and placement rules.
- `src/client/src/components/MachineSwitcher.ts`
  - selected status description and status tooltip;
  - narrow selected-status dot presentation.

The implementation may add these verification files:

- `src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts`
  - jsdom real-DOM behavior and accessibility tests.
- `scripts/verify-narrow-navigation-machine-indicator.mjs`
  - the separate offline raw-CDP geometry and interaction acceptance harness.
- `package.json`
  - one script entry for the acceptance harness only; no dependency or version change.
- `.changeset/narrow-navigation-machine-indicator.md`
  - the eventual user-visible patch release fragment in Section 8.

No other production source file is in scope.

### 1.2 Explicitly unchanged ownership

Do not modify:

- `MachineList` or compact/mobile machine navigation;
- `AppRefreshControl`, including its 36px button, icon, label, or callback;
- `src/client/src/components/shared.ts`, including `appStyles` and the 44px desktop
  activity-rail reserve;
- `src/client/src/appShell/panelResizeController.ts`, including the 180px minimum and
  340px default navigation widths;
- `PiWebUiApp.ts`, app-shell state, routes, API clients, machine persistence, or config;
- `src/server/sessiond.ts`, session-daemon ownership, daemon protocol, or session runtime;
- package dependencies, `package.json` version (`1.26.0`), generated changelog, or route
  contracts.

The browser fixture may import these existing components and styles, but must not change
or instrument the live application.

### 1.3 Non-Goals

- Redesigning the machine menu, machine-management action menu, or navigation sections.
- Changing the collapsed/mobile navigation `MachineList` or its breakpoint behavior.
- Changing panel resize constraints, persisted panel widths, machine persistence, or
  machine health APIs.
- Adding a new machine status model, API field, route, configuration key, or public
  component property.
- Changing menu option content, menu width/positioning, keyboard conventions, focus
  targets, or callback signatures.
- Adding a generic responsive controller, resize observer, JavaScript measurement, or
  browser-testing framework.
- Changing session-daemon runtime ownership, the session protocol, or any server-side
  behavior.
- Changing package dependencies, package version, generated changelog, or release
  channel.

## 2. Behavioral Contract

### 2.1 Responsive boundary and measured box

`app-navigation-panel` is the named inline-size query container. The implementation must
add the equivalent of:

```css
:host {
  container-type: inline-size;
  container-name: navigation-header;
}
```

The exact narrow query is:

```css
@container navigation-header (inline-size < 416px) { ... }
```

There is no alternate breakpoint for this feature. The base/normal header presentation is
single-line and therefore applies at exactly 416px and above.

The query measures the `app-navigation-panel` host content box. The host does not receive
new padding, and the query must not be moved to the padded `header`; the header's 8px or
12px padding is inside the host and is not part of the queried inline size. The
implementation must not use `window.matchMedia`, a resize listener, `ResizeObserver`, a
JavaScript width state, or a generic responsive-layout controller.

### 2.2 AppNavigationPanel DOM contract

Keep the existing header order and callback wiring. The rendered structure must remain:

```html
<header>
  <strong class="brand" aria-label="Pi WebUI...">
    <span class="brand-symbol" aria-hidden="true">π</span>
    <span class="brand-wordmark">WebUI</span>
    <span class="brand-version">v1.26.0</span>
  </strong>
  <machine-switcher>...</machine-switcher>
  <div class="header-actions">
    [the supplied app-refresh-control, when present]
    <button title="Show Actions" aria-label="Show Actions">Actions</button>
  </div>
</header>
```

The `brand-wordmark` class is the only required semantic addition to the existing
wordmark span. The version span remains omitted when `version` is undefined. The
accessible label remains exactly the current value: `Pi WebUI` without a version, or
`Pi WebUI version <version>` with one. Hiding the wordmark and version visually in narrow
mode must not hide or change that label.

The visible `Actions` text remains present at every width. Do not replace it with an
icon-only button, shorten it, or hide it in narrow mode. Its title, accessible name, click
handler, and `onShowActions` callback remain unchanged.

### 2.3 AppNavigationPanel CSS contract

Preserve the existing wide styles unless a rule below explicitly changes them. In wide
mode the header remains a single flex row, the brand retains its current visual size, the
machine selector remains the flexible item, the supplied refresh control remains 36px,
and the header action group retains its current visible label and control sizes.

Inside the exact narrow query:

- `header` uses a two-row grid with `padding: 8px` on all sides;
- the grid has `column-gap: 4px` and `row-gap: 8px`;
- the first column is the flexible column and the second column is the intrinsic action
  group column (`minmax(0, 1fr) auto` is the intended shape);
- `.brand` is in row 1, column 1;
- `.header-actions` is in row 1, column 2;
- `machine-switcher` spans both columns in row 2 and remains `min-width: 0`;
- `.header-actions` uses a 4px gap between its children;
- the Actions button keeps its existing height and receives 3px inline padding in narrow
  mode; its label must remain on one line;
- `.brand-wordmark` and `.brand-version` are `display: none` in narrow mode; the pi
  symbol remains visible;
- the supplied refresh control is not resized or hidden by this component. When present,
  its nested `.app-refresh-button` remains 36px by 36px and its callback remains intact.

The narrow grid must fit at the actual 180px desktop navigation column: the desktop
activity rail reserves 44px, leaving a 136px `app-navigation-panel` host and a 120px
header content box after the two 8px inline paddings. No third row is allowed, including
when the refresh control is present.

Do not add transforms, `contain: paint`, new overflow clipping, or any fixed-position
containing block that could change the existing viewport-positioned machine menus.

### 2.4 MachineSwitcher selected control contract

The selected machine control remains a real `<button type="button">` with the existing
class and behavior. Keep the existing selected-machine fallback and label contracts:

```ts
const selected = this.selectedMachine();
const status = machineStatus(selected, this.statuses);
```

`selectedMachine()` continues to choose `this.selected`, then the machine with id
`"local"`, then the first machine. `machineStatus()` continues to resolve exactly as:

```ts
statuses[machine.id]?.status ?? machine.status ?? "unknown"
```

Do not infer a different status from `MachineHealth.ok`, `error`, or any other field.

The selected button retains:

- `title=${machineTitle(selected)}`, where a remote machine with `baseUrl` uses that
  base URL and otherwise the machine name is used;
- `aria-label="Machine: <selected name>. Switch machine."`;
- `aria-expanded` reflecting the existing `open` state;
- the existing activity indicator, kicker text `Machine`, selected name, health state,
  and chevron in that order;
- the existing `@click` and `@keydown` handlers.

Add a stable same-shadow-root status description with exactly this contract:

```html
<button
  ...
  aria-describedby="machine-status-description"
>
  ...
  <span class="machine-status <status>" title="online">online</span>
  ...
</button>
<span id="machine-status-description" class="machine-status-description">
  Machine status: online.
</span>
```

The status word and sentence vary only by the resolved lower-case status:

- `online` -> `Machine status: online.`
- `offline` -> `Machine status: offline.`
- `error` -> `Machine status: error.`
- `unknown` -> `Machine status: unknown.`

The `id` is local to the `MachineSwitcher` shadow root and must not be generated from a
machine id. The description must remain in the accessibility tree; use a standard visual
hiding technique, not `display: none` or `aria-hidden="true"`. The selected button's
accessible name remains the explicit `aria-label`; `aria-describedby` supplies the health
state independently of color or descendant text.

The selected `.machine-status` keeps the existing status classes and wide-mode text and
color. Its `title` is the exact lower-case health word above. In narrow mode it becomes a
7px colored dot:

- `online`: existing success color;
- `offline` and `error`: existing danger color;
- `unknown`: existing muted color.

The narrow dot must not display the health word visually, but the word remains in the DOM
for the existing wide rendering and the tooltip remains available. Do not change the
status text in menu entries.

### 2.5 Activity and menu invariants

`renderActivity()` and the activity model remain unchanged:

- offline and error machines suppress the activity indicator;
- online and unknown machines may show activity;
- session activity takes precedence over terminal activity through the existing
  `machineActivityIndicator()` behavior;
- existing `role="img"`, `aria-label`, and `title` values for activity indicators remain.

The menu continues to render every machine with its name, machine type/base URL detail,
and complete health word. Keep its existing fixed positioning, width, maximum-height
calculation, z-index, click propagation handling, and viewport constraints. The narrow
button width must not constrain the menu.

The following behavior is unchanged and must be covered by tests:

- click, native Enter, and native Space toggle the machine menu as they do today;
- ArrowUp and ArrowDown from the selector open the menu and focus the selected option, or
  the first option when there is no selected option;
- ArrowUp and ArrowDown move through options; Home and End select the first and last
  option respectively, with the existing clamping behavior;
- Escape and ArrowLeft from an open option close the menu and return focus to the
  selector button;
- ArrowRight from the selector and from an open option invokes the existing next-section
  callback exactly once for the key event;
- selecting a machine closes the menu and invokes `onSelect` exactly once;
- outside click and component disconnect cleanup remain unchanged;
- a CSS-only width change across the 416px boundary preserves selected machine, open
  menu, focused element, and callbacks. Opening a menu after the change still computes
  its position from the new button rectangle.

The selector remains omitted when there are zero or one configured machines. This feature
never changes that `shouldShowMachinesSection()` decision.

## 3. Observable Layout Matrix

The acceptance fixture must use a desktop viewport of at least 1181px; the required
reference viewport is 1600x900. It must mount the real `appStyles` shell layout with the
same desktop `aside` and activity-rail reserve. It must set the navigation column through
`--navigation-panel-size` and must not use a 180px browser viewport as a substitute for a
180px navigation column.

At the reference minimum:

| Measurement | Required value or property |
| --- | --- |
| navigation column | 180px |
| desktop rail reserve (`.shell > aside` padding-left) | 44px |
| `app-navigation-panel` host inline size | 136px |
| narrow header inline padding | 8px each side |
| narrow header content box | 120px |
| narrow header mode | two rows |
| refresh button, when supplied | 36px x 36px |
| Actions label | visible and contained |
| selected health dot | 7px x 7px in narrow mode |

The fixture must exercise both refresh states, no activity, session activity, terminal
activity, all four health states, and a deliberately long remote name. It must assert
that, for every exercised state:

- the brand, complete action group, machine selector, status indicator, activity
  indicator, and chevron are contained by the header and host;
- the visible primary controls do not overlap pairwise;
- the `Machine` kicker and `Local` name have a positive readable allocation and `Local`
  is not ellipsized in the approved minimum fixtures;
- long names ellipsize only inside the existing label allocation and do not expand or
  escape the selector;
- offline and error cases have no activity indicator;
- session activity wins over terminal activity when both are present;
- the refresh control is absent when not supplied and present at 36px when supplied.

The exact boundary matrix uses the same desktop fixture and version `1.26.0`:

| Host inline size | Desktop column after 44px reserve | Required mode | Required visible content |
| ---: | ---: | --- | --- |
| 415px | 459px | narrow two-row grid | pi, refresh when supplied, `Actions`, `Machine`, `Local`, activity when eligible, health dot, chevron |
| 416px | 460px | single-line | pi, `WebUI`, `v1.26.0`, selector, health word, refresh when supplied, `Actions` |
| 417px | 461px | single-line | same as 416px |

At all three host sizes, run with and without the refresh control. At 415px, assert the
brand/action group remains row one and the selector row is row two. At 416px and 417px,
assert the header is one row and the brand wordmark, version, and health word are visible.
Use unknown health plus eligible activity in the boundary fit case so the fixed content
budget is exercised. The fixture must assert no clipping or overlap at either side of the
exact boundary.

## 4. Test Plan

### 4.1 Real-DOM component tests

Add `src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts` with the
file-level `// @vitest-environment jsdom` directive. Import and mount the real
`AppNavigationPanel`, `MachineSwitcher`, and `AppRefreshControl` custom elements. Use
`document.body.append`, real shadow-root queries, real DOM events, and
`await element.updateComplete` (including the nested machine switcher's update) for the
fixture lifecycle. Clean the document and restore mocks after every test.

Use deterministic `Machine` fixtures for `Local`, at least one remote machine with a
base URL, and one long remote name. Set properties directly on the real panel; do not
instantiate `PiWebUiApp`, start a session daemon, call an API, or use a state publisher
that can overwrite the fixture.

Required component cases:

1. **Brand and controls.** Assert the brand accessible label with and without a version,
   the `brand-symbol` content and `aria-hidden`, the explicit `brand-wordmark` and
   `brand-version` elements, visible `Actions` text and its existing label/title, and
   the supplied `app-refresh-control` with its 36px component contract and reload
   callback. These are DOM/semantics assertions; do not claim jsdom proves geometry.
2. **Selected status description.** For `online`, `offline`, `error`, and `unknown`,
   assert the selected button's exact accessible name, exact
   `aria-describedby="machine-status-description"`, exact description sentence, and
   status tooltip word. Include fallback cases where the statuses map omits the selected
   machine and the machine's own `status` is used, and where both are absent and
   `unknown` is used.
3. **Activity and health semantics.** Assert activity is rendered for eligible online
   or unknown fixtures, session activity takes precedence over terminal activity, and
   offline/error fixtures suppress activity. Assert the existing activity accessible
   labels and titles.
4. **Menu content and callbacks.** Open the real menu with a click and assert every
   machine name, local/remote detail, and complete health word is present. Select an
   option and assert the supplied callback is called exactly once and the menu closes.
   Assert outside click cleanup and that the remote button title remains its base URL.
5. **Actions and refresh callbacks.** Use real button clicks and assert `onShowActions`
   and the refresh callback are each forwarded exactly once. This test does not replace
   native keyboard coverage in the browser harness.
6. **Focus and keyboard handler semantics.** Use the real DOM to cover menu open,
   selected-option focus, relative/Home/End option navigation, Escape/ArrowLeft focus
   return, and ArrowRight callback forwarding. Assert focus through the relevant shadow
   root's `activeElement`; do not use template inspection to stand in for focus or
   accessibility behavior.

Do not add `TemplateResult` extraction to these tests. The existing
`templateInspection.testSupport.ts` escape hatch is for Lit event wiring only and must
not be used for content, layout, focus, or accessibility assertions. Do not assert
geometry from a CSS string; jsdom has no layout engine.

### 4.2 Offline raw-CDP browser acceptance

Add a separate script:

```text
scripts/verify-narrow-navigation-machine-indicator.mjs
```

and expose it through a separate package script, for example:

```json
"verify:narrow-navigation-machine-indicator": "node scripts/verify-narrow-navigation-machine-indicator.mjs"
```

The script must be self-contained and offline. It may start a temporary Vite fixture
server that serves a page importing the real source components and `appStyles`, but it
must not start the web/API server, session daemon, or `PiWebUiApp`. The fixture must mount
the actual `AppNavigationPanel` and actual `AppRefreshControl` inside a shell using the
real `appStyles` desktop grid and 44px rail reserve. Apply `appStyles` through a real
shadow host so its `:host` system-font rules take effect, and supply the production theme
tokens. Do not substitute fixture-only fonts or duplicate the responsive layout rules.
Keep all data and callbacks local and deterministic so no application update can replace
the measured DOM.

The script must use the raw Node WebSocket CDP pattern already present in
`scripts/capture-screenshots.mjs`; do not add Playwright, Puppeteer, or another browser
framework. It must:

- honor `CHROME_BIN` and fail with a clear nonzero error if Chromium cannot be found;
- allocate temporary localhost server and CDP ports rather than requiring fixed ports;
- use an isolated temporary Chrome profile directory;
- use bounded connection, navigation, CDP-evaluation, and assertion waits;
- bound browser/server termination and cleanup even after a failed readiness wait or
  CDP request;
- clean up the browser, server, temporary profile, and logs in a `finally` path;
- fail loudly on missing Chromium, timeout, console error, assertion failure, or cleanup
  failure; it must never silently skip or pass because browser support is unavailable.

The one reproducible acceptance command is:

```bash
CHROME_BIN="${CHROME_BIN:?Set CHROME_BIN to a Chromium binary}" npm run verify:narrow-navigation-machine-indicator
```

The script may support the repository's existing Chromium discovery fallback for local
convenience, but the explicit command above is the required CI/manual acceptance form and
must remain a separate command from `npm run verify`.

The browser harness must exercise these assertions:

#### Geometry and mode

- At 1600x900, set the shell navigation column to 180px and assert the 44px desktop
  reserve, 136px navigation host, 8px narrow padding, and 120px narrow content box.
- Assert header/action-group/selector containment and pairwise non-overlap using real
  `getBoundingClientRect()` values with a documented subpixel tolerance.
- Assert the primary controls' `scrollWidth`/`clientWidth` relationships so no claimed
  readable label is merely present but clipped.
- Run the 415/416/417 host matrix through the corresponding 459/460/461 desktop
  columns. Assert the exact two-row/one-row boundary, wordmark/version visibility,
  health-dot/health-word presentation, refresh presence/absence, and fit with
  `1.26.0`, unknown status, activity, and `Local`.
- Run the minimum-width fixture with no activity, session activity, terminal activity,
  each health state, refresh absent/present, and the long remote name. Assert the
  offline/error activity suppression rule and intentional long-name ellipsis.

#### Native interaction and focus

- Focus the real selector button and use CDP `Input.dispatchKeyEvent` for native Enter
  and Space. Assert the menu toggles as it does for a physical key press; do not use a
  programmatic `.click()` as the Enter/Space evidence.
- Cover selector click, ArrowUp, ArrowDown, option ArrowUp/ArrowDown, Home, End,
  Escape, ArrowLeft, and ArrowRight. Assert selected-option focus, option navigation,
  focus return, next-section callback, and no duplicate selection callback.
- Assert full menu content for every machine, including type/base URL and health word.
- Keep the menu open, change only the shell width across 415 -> 416 -> 417 and back,
  and assert selected machine, open state, focused element, and callback counters are
  unchanged. Then close/reopen after resizing and assert the fixed menu position is
  computed from the new selector button rectangle and remains inside the viewport.
- Exercise Actions and refresh controls with native browser interaction and assert their
  existing callbacks.

### 4.3 Negative-control regression evidence

The browser geometry gate must fail against the original one-row implementation. The
acceptance script must accept an optional `--source-overlay <directory>` that resolves
only the pre-fix `AppNavigationPanel.ts` and `MachineSwitcher.ts` modules from a
read-only temporary overlay. Record the exact pre-fix revision and module-to-overlay
mapping. A Vite load hook may serve those old modules while preserving their normal
relative imports. The overlay is made from `git show` output or a detached read-only
worktree; it must never edit the delivery target or the base checkout.

Run the same CDP assertions against that overlay before marking the fix verified. The
pre-fix run must fail on at least the 180px minimum-width geometry and/or the exact
415/416/417 mode boundary, demonstrating that the browser test detects the defect rather
than only checking for new markup. An import failure, missing new markup, or startup
failure is not regression evidence. Do not weaken the fixed-tree assertions to make the
old overlay pass.

## 5. Implementation Constraints and Compatibility

1. Keep all state transitions and callback boundaries unchanged. `open`, `menuStyle`,
   `openActionsMachineId`, `actionMenuStyle`, selected-machine fallback, and menu cleanup
   remain owned by `MachineSwitcher`.
2. Do not introduce a public property, event, API response, route, machine field,
   configuration key, or dependency.
3. Do not refactor `MachineList` to share a new responsive controller or create a generic
   layout abstraction for this one header.
4. Do not add a resize observer, resize event, matchMedia subscription, polling loop, or
   JavaScript measurement. CSS container queries are the sole responsive mechanism.
5. Do not change the existing fixed menu calculation. A menu opened after a resize reads
   the new button rectangle through the current open path; a menu already open keeps its
   current state and focus during CSS-only layout changes.
6. Keep the machine menu and action menu fixed-positioned. Do not add an ancestor
   transform, paint containment, or overflow rule that traps either menu.
7. Keep the change ASCII by default and add only short comments where the container
   query or visually hidden status description needs orientation.
8. The source fix is user-visible and requires a patch Changeset, but this design/spec
   document alone does not create a Changeset or edit `CHANGELOG.md`.

## 6. Verification Order and Commands

Run these commands serially; do not run the browser harness or repository verification
concurrently with typechecking, linting, or the full test suite.

1. Focused real-DOM tests:

   ```bash
   npm test -- --run src/client/src/components/appShell/AppNavigationPanel.narrow.test.ts
   ```

2. Typecheck:

   ```bash
   npm run typecheck
   ```

3. Lint:

   ```bash
   npm run lint
   ```

4. Required offline browser acceptance:

   ```bash
   CHROME_BIN="${CHROME_BIN:?Set CHROME_BIN to a Chromium binary}" npm run verify:narrow-navigation-machine-indicator
   ```

5. Final repository verification, after the preceding commands have completed:

   ```bash
   npm run verify
   ```

`npm run verify` remains the final repository gate. The browser acceptance command stays
separate because it needs an isolated browser/profile/server lifecycle and must fail
clearly when Chromium is unavailable. A missing browser is never converted into a
Vitest-only pass.

Expected verification evidence:

- focused jsdom tests pass with real component DOM and no template-inspection assertions
  for content/accessibility/layout;
- the CDP harness passes all geometry, fit, state, focus, callback, menu, and exact
  breakpoint assertions and the read-only old-source overlay fails its regression gate;
- typecheck and lint pass without new suppressions or unused exports;
- the final `npm run verify` passes with no unrelated file modifications.

## 7. Operational Behavior

This change is loaded by the web/UI process only. It does not alter
`src/server/sessiond.ts`, session runtime ownership, the daemon protocol, APIs, routes,
or persisted machine data.

No manual `pi-webui-sessiond.service` restart is required. The UI development service or
the normal client build/reload path is sufficient to pick up the component changes. The
browser acceptance fixture must never connect to or restart either systemd user service.

## 8. Changeset and Release Note

The eventual source fix must add exactly one patch Changeset:

`.changeset/narrow-navigation-machine-indicator.md`

```markdown
---
"@hyperdreamer/pi-webui": patch
---

Keep the expanded navigation machine selector readable at narrow widths.
```

Do not hand-edit `CHANGELOG.md`; release automation generates it from Changesets. A
spec-only change or design-only commit does not need this fragment, but the user-visible
production fix does.

## 9. Implementation Checklist

1. Add `navigation-header` inline-size containment to `AppNavigationPanel` without adding
   host padding or changing compact/mobile rendering.
2. Add the explicit `brand-wordmark` class and implement the exact narrow two-row grid,
   spacing, placement, hidden visual wordmark/version, and 3px Actions inline padding.
3. Add the selected status description, exact `aria-describedby` reference, exact status
   sentence, and health-word tooltip to `MachineSwitcher`.
4. Add the narrow 7px status-dot styles through the exact ancestor container query while
   preserving wide status text, colors, activity behavior, and menu content.
5. Add the jsdom real-DOM tests and the standalone raw-CDP harness with the deterministic
   shell fixture, exact breakpoint matrix, native keyboard coverage, and old-source
   negative control.
6. Add only the separate package script needed to invoke the acceptance harness.
7. Add the patch Changeset for the source fix; leave version and `CHANGELOG.md` alone.
8. Run the verification commands in Section 6 serially.

## 10. Open Questions

None. The design decisions, exact boundary, status fallback, accessibility text, layout
budget, testing layers, browser prerequisite, release-note behavior, and operational
restart requirements are resolved above. The user approved this specification for
autonomous planning, implementation, and testing.
