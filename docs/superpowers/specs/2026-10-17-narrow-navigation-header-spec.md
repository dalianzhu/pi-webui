# Narrow navigation header — technical specification

Date: 2026-10-17
Status: pending user sign-off
Design: `2026-10-17-narrow-navigation-header-design.md` (sha256 `081d45c6…`, approved by user)

This specification is normative. Where it and the design differ, this document wins and
the design is considered superseded on that point.

## 1. Scope

### 1.1 Files that may change

| path | change |
| --- | --- |
| `src/client/src/appShell/panelResizeController.ts` | navigation `minWidth` 180 → 324 |
| `src/client/src/components/MachineSwitcher.ts` | container declaration, text floor, kicker nowrap, health-word query, description node, `machineTitle` |
| `src/client/src/components/appShell/AppNavigationPanel.ts` | `navigation-header` container on `:host`, version-label query |
| `src/client/src/components/ActivityRail.ts` | `onReload` / `showReload` properties and a fixed reload button |
| `src/client/src/appShell/appShellController.ts` | refresh placement predicates |
| `src/client/src/components/PiWebUiApp.ts` | wire rail reload, stop passing header refresh |
| `src/client/src/appShell/panelResizeController.test.ts` | new floor expectations |
| `src/client/src/components/appShell/AppNavigationPanel.test.ts` | version-label rules |
| `src/client/src/components/MachineSwitcher.test.ts` (new) | description, health-word state, title |
| `src/client/src/components/ActivityRail.test.ts` (extended) | reload slot |
| `src/client/src/appShell/appShellController.test.ts` (new or extended) | refresh permission matrix |
| `scripts/verify-narrow-navigation-header.mjs` (new) | Chromium gate |
| `package.json` | one script entry |
| `.changeset/narrow-navigation-header.md` (new) | patch changeset |
| `docs/navigation-panel.md` (new) | user-facing behaviour |

### 1.2 Forbidden

- `MachineList` / compact-navigation component: untouched.
- `src/server/**`, `sessiond`, routes, API contracts, persistence formats.
- `src/client/src/components/shared.ts`: untouched (the 44px rail reserve and shell grid
  stay as they are).
- Dependencies: no additions or upgrades.
- Version number and `CHANGELOG.md`: untouched.
- `AppRefreshControl`: unchanged; still used by the context bar.

## 2. Panel minimum width

`PANEL_RESIZE_CONSTRAINTS.navigation.minWidth` becomes `324`.

Unchanged: `defaultWidth` 340, `maxWidth` 4096, `keyboardStep` 24,
`largeKeyboardStep` 72, and the `shared.ts` CSS fallback `--navigation-panel-size: 340px`.

Required behaviour:

- `clampPanelWidth("navigation", 50)` → `324`.
- `clampPanelWidth("navigation", 260)` → `324`.
- `clampPanelWidth("navigation", 340)` → `340`.
- `clampPanelWidth("navigation", Number.NaN)` → `340` (the default, now inside range).
- Drag and keyboard resizing cannot go below 324.
- A stored raw version-1 preference of `260` loads as `324` through the existing
  read-time clamp; no storage migration.

The workspace panel's constraints are unchanged.

## 3. Header layout

### 3.1 Containers

`AppNavigationPanel` `:host` establishes the header container:

```css
:host { container-type: inline-size; container-name: navigation-header; }
```

`MachineSwitcher` `:host` establishes the switcher container:

```css
:host { container-type: inline-size; container-name: machine-switcher; }
```

Both are `inline-size` containment only. Neither may add `contain`, `transform`,
`filter`, or `will-change`, because those would create a fixed-position containing block
and change menu placement.

### 3.2 Version label

```css
@container navigation-header (inline-size < 372px) { .brand-version { display: none; } }
```

- The version label is the `v<version>` span inside `.brand`.
- `π` and the `WebUI` wordmark are never hidden.
- The brand's `aria-label` (`Pi WebUI` / `Pi WebUI version <v>`) is unchanged, so hiding
  the visual label removes no information from assistive technology.
- When `version` is undefined no version span is rendered at all; the rule is inert.

### 3.3 Machine switcher text

- `.machine-switcher-kicker { white-space: nowrap; }` — no wrapping of `MACHINE`.
- `.machine-switcher-text { min-width: 48px; }` — reserves the kicker's measured width.
- `.machine-switcher-label` keeps `min-width: 0; overflow: hidden; text-overflow:
  ellipsis; white-space: nowrap` and is the only truncating element.
- No change to `.machine-switcher-button` padding (8px), gap (6px), or border (1px).

### 3.4 Health word

```css
@container machine-switcher (width < 150px) {
  .machine-switcher-button > .machine-status {
    font-size: 0; width: 7px; height: 7px; border-radius: 50%;
    background: currentColor; overflow: hidden; flex: 0 0 auto;
  }
}
```

- Above the threshold the existing word renders unchanged (`.online`, `.offline`,
  `.error`, `.unknown` colour rules untouched).
- Below it the word becomes a 7px dot coloured by the existing per-status rules.
- The dot must not be the only carrier of status: see §4.
- The health word and the health dot never both occupy horizontal space; the word
  replaces the dot.

## 4. Accessibility

The selected status element (`.machine-status`) carries its own `title` containing the
current health label (`online` / `offline` / `error` / `unknown`), in both the word and the
dot state, so hovering the dot still exposes the health value as text. This is separate
from the button tooltip described below: the button tooltip carries machine identity, the
status tooltip carries health.

The selected button keeps:

- accessible name `Machine: <name>. Switch machine.`
- `aria-expanded` reflecting menu state
- `title` from `machineTitle()` (machine identity)

Added, in `MachineSwitcher`'s own shadow root:

- a visually hidden `<span id="machine-status-description">Machine status:
  <status>.</span>` rendered for every status and at every width (word or dot)
- `aria-describedby="machine-status-description"` on the selected button
- the id is stable and unique per component instance; only one switcher is mounted at a
  time per navigation panel
- styling is local to `MachineSwitcher`'s stylesheet (the `shared.ts` visually-hidden
  utility does not cross shadow boundaries): `position: absolute; width: 1px; height:
  1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path:
  inset(50%); white-space: nowrap; border: 0;` and never `display: none` or
  `visibility: hidden`.

`machineTitle(machine)` becomes:

```
machine.name                       when there is no baseUrl
`${machine.name} — ${baseUrl}`     when baseUrl exists
```

so a truncated name remains recoverable through the tooltip. The menu entries and the
accessible name already carry the full name.

Menu entries keep the full health word for every machine, unchanged.

## 5. Refresh placement

The navigation header never renders a refresh control.

`AppShellController`:

- delete `shouldShowAppRefreshInHeader()`
- `shouldShowAppRefreshInRail()` = `this.isPwaDisplayMode && !this.isMobileNavigationLayout`
- `shouldShowAppRefreshInContextBar()` = `this.isPwaDisplayMode && !this.isDesktopActivityRailLayout`

Permission matrix (asserted):

| width | PWA | rail | context bar | header |
| --- | --- | --- | --- | --- |
| ≥ 1181 | yes | yes (persistent) | no | no |
| 761–1180 | yes | yes (drawer) | yes | no |
| ≤ 760 | yes | no | yes | no |
| any | no | no | no | no |

`ActivityRail`:

- properties `onReload?: () => void` and `showReload = false`
- when `showReload` is true, renders one `<button class="icon-button rail-reload-button"
  title="Full page reload" aria-label="Full page reload">` with the refresh glyph
- position: after `.rail-spacer` and immediately before the settings button, in every
  layout including when no plugin separator is rendered
- the button is not part of `railOrder`, `ReorderableRailItem`, drag handling, or reorder
  persistence
- the compact drawer renders it through the existing `renderRailContents()` path, so no
  separate drawer wiring is required

`PiWebUiApp`:

- passes `.onReload=${() => { this.hardReloadApp(); }}` and
  `.showReload=${this.appShell.shouldShowAppRefreshInRail()}`
- stops passing `refreshControl` to `app-navigation-panel`
- keeps `.refreshControl=${...}` on the context bar path driven by
  `shouldShowAppRefreshInContextBar()`

`AppNavigationPanel.refreshControl` remains declared (optional) but is no longer supplied.
Removing the property is out of scope.

## 6. Interaction contracts (must not regress)

- Click, `Enter`, and `Space` on the selected button open the menu and set
  `aria-expanded="true"`.
- `ArrowDown` / `ArrowUp` open the menu, move between options, and clamp at the ends.
- `Escape` closes the menu and restores focus to the selected button.
- `ArrowLeft` closes and restores focus; `ArrowRight` closes and forwards to the next
  section exactly once.
- Selecting an option calls `onSelect` once with that machine.
- `onRemove`, `onShowActions`, `onFocusNextSection`, `onCancelKeyboardNavigation`,
  `onReload` keep their signatures and single-invocation behaviour.
- The menu stays viewport-fixed and anchored to the trigger; it may extend outside the
  navigation panel.
- Zero machines: no switcher rendered in the header.
- **One machine: the header does not render the switcher.** This is existing application
  behaviour and is preserved, not changed: `AppNavigationPanel` renders the switcher only
  through `shouldShowMachinesSection(machines)`, which returns `machines.length > 1`
  (`AppNavigationPanel.ts:128,352`), and the same helper governs the compact machine list
  and navigation focus ordering (`AppNavigationPanel.ts:145,367`). That helper must not be
  modified.
- The standalone `MachineSwitcher` component can render a single machine when mounted
  directly. That component-level capability is unchanged and is tested only as component
  behaviour; it does not imply the header shows a one-machine switcher.
- Menu lists every machine it is given, in order.
- Activity indicators keep their existing precedence and suppression rules (suppressed
  for `offline` and `error`).

## 7. Testing

### 7.1 jsdom

`panelResizeController.test.ts`: the clamp expectations in §2, including the raw stored
`260` → `324` case seeded as raw version-1 JSON.

`MachineSwitcher.test.ts` (new) and `AppNavigationPanel.test.ts` (extended):

- kicker DOM text is `Machine` (uppercase comes from CSS `text-transform`), and its
  computed `white-space` is not asserted here (jsdom cannot read shadow-root stylesheets)
- the description node's visually-hidden declarations are verified by inspecting the
  component's static stylesheet (`MachineSwitcher.styles.cssText`) the way
  `SessionModelPolicyControl.test.ts:48` does, asserting the rule sets the clipping
  properties and does **not** set `display: none` or `visibility: hidden`; jsdom
  computed styles for a shadow stylesheet are not trusted for this
- accessible name, menu contents with health words, `title` containing the machine name
  for a remote machine with a `baseUrl`, and `.machine-status` `title` equal to the health
  label for all four statuses (word and dot states)
- a standalone `MachineSwitcher` mounted with one machine renders without throwing; the
  header path (`AppNavigationPanel`) renders no switcher for zero or one machine and does
  render it for two
- arrow/Escape handling and focus restoration via explicit events
- callback forwarding and zero/one-machine omission

`ActivityRail.test.ts` (extended): reload button renders iff `showReload`, has the accessible
name `Full page reload`, invokes `onReload` once, appears before the settings button, and
is absent from reorder handling.

`appShellController.test.ts`: the §5 permission matrix at 760/761 and 1180/1181 for PWA
and non-PWA.

### 7.2 Chromium (`scripts/verify-narrow-navigation-header.mjs`)

Invoked by `npm run verify:narrow-navigation-header`; requires `CHROME_BIN` or a
discoverable Chromium and **fails loudly** when absent. Not part of `npm run verify`.

- 1600×900, desktop layout, production `appStyles` and theme tokens, version label
  present in the fixture.
- Outer columns 324, 340, 366, 370, 415, 416, 460, 600:
  - each element in the overlap set (kicker, name, health indicator, activity indicator,
    chevron) asserted present with a positive box before any comparison; activity is only
    required in states where production renders it
  - no rect intersection between them (0.75px tolerance)
  - kicker's measured advance (including letter-spacing, uppercased as rendered) fits its
    laid-out width
  - `.machine-status` `title` is present and equals the health label in the dot state at
    324 (the state where the word is not rendered)
  - text column ≥ 48; selected button and header `scrollWidth <= clientWidth`
  - short name readable (≥ 40px) at 324; a long name ellipsizes while the kicker does not
- Version boundary: hidden at 415, shown at 416; no overlap at either.
- Health-word boundary: for each of the four statuses, at switcher widths immediately
  below, at, and above 150px, assert the word/dot state and the no-overlap guarantee.
- Monotonicity: sweeping 324→600 in small steps, health-word visibility is
  non-decreasing.
- Drawer-layout geometry at 1100px viewport width: inner panel equals the outer column and
  the version rule behaves accordingly.
- Menu anchoring: the open menu's rect is derived from the trigger rect and is not
  clipped by the header.
- Native input: real `Input.dispatchKeyEvent` `Enter` and `Space` on the focused selected
  button open the menu with `aria-expanded="true"`; `Escape` closes and restores focus.
- Refresh: PWA ≥ 1181 renders exactly one control in the rail and none in the header; at
  1100 the context bar shows one and opening the drawer exposes the rail one; at 700 only
  the context bar; non-PWA none. Reload activation is exercised through application
  wiring.
- Negative control: `--source-overlay` of the 1.26.0 `MachineSwitcher.ts` and
  `AppNavigationPanel.ts` must exit non-zero on a kicker/overlap/readability assertion, not
  on a missing selector or import.
- Cleanup of Chromium, Vite child, temp profile/port is bounded and runs on failure paths.

### 7.3 Final gate

`npm run verify` (typecheck, lint, knip, serial Vitest) plus the Chromium gate, both
recorded.

## 8. Deliverables

- Patch changeset `.changeset/narrow-navigation-header.md` describing the minimum-width
  change, the health-word/version-label behaviour, and the refresh relocation.
  `CHANGELOG.md` is not edited.
- `docs/navigation-panel.md` documenting the minimum width, when the version label and
  health word hide, and where refresh appears in each layout.
- README unchanged (it stays a landing page).

## 9. Acceptance summary

1. At 324 the header shows `MACHINE`, a readable name (or ellipsis), a health indicator,
   the activity indicator when applicable, and the chevron, with no overlap.
2. The panel cannot be resized below 324; the default remains 340.
3. The health word is visible at wide widths and replaced by a dot when the switcher is
   below 150px, with status always available to assistive technology.
4. The version label is hidden below inner 372 and visible from it.
5. In PWA mode the refresh control lives in the rail (or the context bar in the drawer
   band) and never in the header.
6. `npm run verify` and `npm run verify:narrow-navigation-header` both pass, and the
   negative control fails for the right reason.
