# Narrow navigation header — design (v2, revision 5)

Date: 2026-10-17
Status: revision 5, passed design review 5
Supersedes: `2026-10-17-narrow-navigation-machine-indicator-design.md` (reverted in `97cdd1d`)

## Problem

At narrow navigation-panel widths the machine indicator in the header renders badly.
Measured on a live 1.26.0 build (Chromium, desktop layout, real `appStyles` and
production theme tokens):

| outer column | inner panel | brand | Actions | switcher | observable result |
| --- | --- | --- | --- | --- | --- |
| 180 | 136 | 72.3 | 63.7 | 0 | machine selector absent |
| 260 | 216 | 117.7 | 63.7 | 0 | machine selector absent |
| 300 | 256 | 117.7 | 63.7 | 34.6 | name invisible |
| **340 (default)** | **296** | **117.7** | **63.7** | **74.6** | `MACHINE`, `online`, and the name overlap |
| 460 | 416 | 117.7 | 63.7 | 194.6 | `online` overlaps the name |

Two independent defects: (a) the selector collapses to zero width when brand +
Actions exhaust the row; (b) once it has some width its own contents overlap because
nothing reserves space for them. The previous attempt fixed (a) and verified only
containment, so (b) shipped and the header looked wrong.

## Terminology

- **outer column** — `--navigation-panel-size`, what `panelResizeController` clamps.
  At >= 1181px the 44px Activity Rail sits inside this column
  (`shared.ts:139`).
- **inner panel** — `app-navigation-panel` width. In the desktop rail layout
  (>= 1181px) this is outer column − 44; in the 761–1180px drawer layout it equals the
  outer column, because no persistent rail reserves space there.
- **header content** — inner panel − 24 header padding − borders (`AppNavigationPanel.ts:277`).
- **switcher** — the `machine-switcher` child inside the header.

## Internal layout fact (corrects review 1 B-005)

`.machine-switcher-text` is a **two-row grid**: kicker above name. The text column
therefore needs `max(kicker, name)`, not `kicker + name`. The round-1 design added
them and over-reserved by 48px.

The kicker is a grid item and is not directly clipped by the name's ellipsis rule,
but it can still be squeezed because the text column lives in a flex child with
`min-width: 0`. Reserving it needs an explicit floor, not just `white-space: nowrap`.

## Width derivation (replaces all earlier estimates)

All component widths measured on the live app with production theme fonts:

| piece | width |
| --- | --- |
| `π WebUI` (version label hidden) | 72.3 |
| `π WebUI v1.26.0` | 117.7 |
| Actions button | 63.7 |
| health indicator | 7.0 |
| activity indicator | 7.0 |
| chevron | 5.5 |
| button padding + gaps + borders | 16 + 18 + 2 |
| kicker `MACHINE` floor | 48.0 |

Switcher minimum with the health word hidden:

```
48.0 + 7 + 7 + 5.5 + 16 + 18 + 2 = 103.5
```

Outer column floor, version label hidden, full row + rail + header padding + 2 gaps:

```
44 (rail) + 24 (header padding) + 16 (2 x 8 flex gaps) + 72.3 (brand) + 63.7 (Actions) + 103.5 = 323.5  ->  324
```

324 is the minimum. `PANEL_RESIZE_CONSTRAINTS.navigation.minWidth` becomes **324**.

The table below is derived from the component measurements above (arithmetic), not a
browser capture. The implementer's Chromium gate reproduces it; any disagreement there
is a defect in this design, not a rounding detail. Text column is the switcher minus
non-text costs (padding 16, gaps 18, borders 2, health indicator, activity 7, chevron
5.5).

| outer | inner | brand | switcher | health | text column (word hidden only) |
| --- | --- | --- | --- | --- | --- |
| 324 | 280 | 72.3 | 104.0 | dot | 48.5 |
| 340 | 296 | 72.3 | 120.0 | dot | 64.5 |
| 366 | 322 | 72.3 | 146.0 | dot | 90.5 |
| 370 | 326 | 72.3 | 150.0 | **word** | n/a (word shown) |
| 415 | 371 | 72.3 | 195.0 | word | n/a |
| 416 | 372 | 117.7 | 150.6 | word | n/a |
| 460 | 416 | 117.7 | 194.6 | word | n/a |

The text column is only computed for word-hidden rows, because when the word is shown its
own width depends on the status text, which makes a single "text column" figure
meaningless rather than merely approximate.

324 is the smallest width whose text column (48.5) still clears the 48px kicker floor;
320 gives 44.5 and is therefore excluded.

### Default stays 340 (review 1 B-002)

324 < 340, so nothing else must move:

- `panelResizeController.navigation.defaultWidth` stays **340**.
- The `shared.ts:93` CSS fallback stays **340**, now inside the valid range.
- The non-finite `clampPanelWidth` fallback returns 340, also in range.
- Stored widths below 324 clamp up at read time via the existing
  `clampPanelWidth` path; no storage migration.

### Name truncation at the floor

At 324 the name slot is ~48px, so `192.168.191.5` truncates. Accepted by the product
owner: the badge carries status when space is tight. **The full name must remain
recoverable via the tooltip**, which requires a fix: `machineTitle()` currently
returns `machine.baseUrl ?? machine.name` (`MachineSwitcher.ts:318`), so a remote
machine's tooltip shows its URL, not its name. The selected-machine tooltip becomes
`<name>` (optionally `<name> — <baseUrl>`), so the truncated name is recoverable. Menu
entries and the accessible name already carry the full name.

## Decision 1: version label hides before the row breaks

The brand version label (`v1.26.0`) is hidden while the header cannot afford it, and
returns only once it can return **without** taking room back from the health word:

```css
:host { container-type: inline-size; container-name: navigation-header; }
@container navigation-header (inline-size < 372px) { .brand-version { display: none; } }
```

The container is the `app-navigation-panel` host itself, so the query measures the
**inner panel** width (outer column − 44 in the desktop rail layout). 372 is the inner
width at outer 416: inner 371 (outer 415) stays hidden, inner 372 (outer 416) shows it.
The return point is set by the *full brand* budget, not by the first width where the
compact row merely survives:

```
fixed cost, version hidden = 44 + 24 + 16 + 72.3 + 63.7 = 220.0
fixed cost, version shown  = 44 + 24 + 16 + 117.7 + 63.7 = 265.4
version may return when switcher still gets >= 150 (health threshold):
  265.4 + 150 = 415.4 outer  ->  371.4 inner  ->  threshold 372 inner (416 outer)
```

In the 761–1180px layout there is no persistent 44px rail (`ActivityRail` is a drawer),
so the inner panel equals the outer column; the same 372px rule then returns the version
at outer 372 rather than 416. That is intentional: the rule tracks available header
space, which is what it is for, and the health-word query independently guarantees the
word only appears when the switcher can afford it.

### Why the threshold is 372 inner and not the first surviving width

Hiding the version and showing the health word are two independent container queries.
Choosing the version's return point independently of the health threshold delays the
health word badly and couples the two in a way that is easy to get wrong. If the version
returned at the first width where the compact row fits (outer 370):

| outer | version | switcher | health word |
| --- | --- | --- | --- |
| 366 | hidden | 146.0 | hidden (below 150) |
| 369 | hidden | 149.0 | hidden |
| 370 | **returns** | **104.6** | hidden — lost 44.4px |
| 415 | shown | 149.6 | hidden |
| 416 | shown | 150.6 | shown |

That alternative would suppress the health word until outer 416 purely to pay for the
version label, delaying a useful indicator by 46px of panel width for a decorative one.
Tying the version's return to the health threshold returns the label only once the
*word* is already affordable, which is the ordering that matters. Verified sequence with
the 372 inner rule (desktop rail layout):

| outer | inner | version | switcher | health word |
| --- | --- | --- | --- | --- |
| 324 | 280 | hidden | 104.0 | hidden |
| 368 | 324 | hidden | 148.0 | hidden |
| 370 | 326 | hidden | 150.0 | **shown** |
| 412 | 368 | hidden | 192.0 | shown |
| 415 | 371 | hidden | 195.0 | shown |
| 416 | 372 | **returns** | 150.6 | shown |
| 460 | 416 | shown | 194.6 | shown |

Across 324→600 the health word turns on exactly once, at outer 370, and never turns off
again; the version returns exactly once, at outer 416.

`π` and the `WebUI` wordmark are never hidden. The brand's accessible label
(`Pi WebUI version <v>`) is unchanged either way, so hiding the visual label does not
remove information from assistive technology.

## Decision 2: health word hides only when the switcher cannot afford it

```css
@container machine-switcher (width < 150px) { /* dot instead of word */ }
```

150 is derived from the widest status, not from `online`. The word **replaces** the dot,
so the shown-word case does not also carry a health dot:

```
48 (text floor) + 7 (activity) + 5.5 (chevron)
  + 16 (padding) + 18 (3 x 6 gaps) + 2 (borders) + wordWidth = 96.5 + wordWidth
```

`unknown` is the widest word at 11px (~44px in the installed font), so the requirement is
~140.5px; `online` needs ~125.9. 150 covers all four statuses with activity present and
leaves margin for font variation. An earlier draft used 126, correct only for `online`
(~29.4), and would have overflowed for `unknown`.

The dot uses `background: currentColor` with the existing per-status colour rules.
Colour is never the sole carrier: every width gets a same-shadow-root description node
(`Machine status: <status>.`) referenced by `aria-describedby`, a `title` tooltip on
the selected status, and full health words in the menu entries.

## Decision 3: kicker integrity

The health query needs a container that measures the **button's** border-box width, not
the padded content box. Declare it at the switcher host boundary:

```css
:host { container-type: inline-size; container-name: machine-switcher; }
```

Rules:

- `.machine-switcher-kicker { white-space: nowrap }`.
- `.machine-switcher-text { min-width: 48px }` reserves the kicker's measured width.
- `.machine-switcher-label` is the only truncating element (`overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; min-width: 0`).
- `white-space: nowrap` alone is explicitly not claimed to reserve width; the floor
  is.

## Decision 4: refresh moves into the Activity Rail in PWA mode

Reading implemented: **relocate the existing PWA/fullscreen refresh action into the
Activity Rail**. Ordinary browser mode keeps no refresh control; this does not add one.
`isPwaDisplayMode` (standalone, fullscreen, minimal-ui, iOS standalone) is unchanged.

Breakpoints are the existing constants: `MOBILE_NAVIGATION_MEDIA_QUERY`
`(max-width: 760px)` and `ACTIVITY_RAIL_DESKTOP_MEDIA_QUERY` `(min-width: 1181px)`
(`appShellController.ts:6-7`). The persistent 44px rail exists only at >= 1181px; at
761–1180px the rail is a drawer opened from the context bar.

| layout | PWA | refresh location |
| --- | --- | --- |
| >= 1181px | yes | **rail button** (persistent rail) |
| 761–1180px | yes | **context bar button** (visible, not behind the drawer) and also the rail drawer button |
| <= 760px | yes | context bar button (unchanged) |
| any | no | none (unchanged) |

Predicates, made explicit so table and code cannot drift:

- `shouldShowAppRefreshInRail()` = `isPwaDisplayMode && !isMobileNavigationLayout`
  (>= 761px). This deliberately includes the 761–1180px band, because the compact
  drawer renders through the same `renderRailContents()` path and would otherwise
  never show the action (`ActivityRail.ts:404,436,449`). `ActivityRail` already
  suppresses its contents while the drawer is closed.
- `shouldShowAppRefreshInContextBar()` = `isPwaDisplayMode && !isDesktopActivityRailLayout`
  (<= 1180px), covering both the mobile layout and the 761–1180px band, so that band
  has a visible control and not only a drawer entry.
- The navigation header never renders a refresh control. `shouldShowAppRefreshInHeader()`
  is deleted and its call site removed.

Resulting permission matrix (asserted in tests):

| width | rail | context bar | header |
| --- | --- | --- | --- |
| 1181+ | yes (persistent) | no | no |
| 761–1180 | yes (drawer) | yes (visible) | no |
| <= 760 | no (mobile layout) | yes | no |

This makes the table authoritative: the header is no longer a refresh location at any
width, and the 761–1180px band gets a visible control rather than only a drawer entry.

Implementation:

- `ActivityRail` gains `onReload?: () => void` and `showReload = false`.
- Renders a `.icon-button` with accessible name `Full page reload`, title `Full page
  reload`, and the same refresh glyph, in a **fixed, non-reorderable** slot after the
  plugin separator and before the settings button, immediately following
  `.rail-spacer` so it sits among the bottom controls. It renders whenever `showReload`
  is true, including when no plugin separator exists.
- Not added to `ReorderableRailItem`: reordering is persisted per user, and a new item
  id would require an order migration. The fixed slot avoids that.
- It does not reuse `AppRefreshControl` (36px circular); the rail button is 34px and
  uses the rail's own `.icon-button` styling. `AppRefreshControl` remains for the
  context bar.
- `PiWebUiApp` passes `.onReload=${() => this.hardReloadApp()}` and
  `.showReload=${this.appShell.shouldShowAppRefreshInRail()}` to the rail, and no
  longer passes `refreshControl` to the navigation panel.
- `AppNavigationPanel.refreshControl` remains as an optional property for
  compatibility but is no longer supplied by `PiWebUiApp`.

## Interaction contracts (unchanged)

- Selected-machine accessible name `Machine: <name>. Switch machine.`
- `aria-expanded`; menu lists every machine with full health words.
- Click, `Enter`, `Space`, `ArrowDown`/`ArrowUp` open; `Escape` closes and restores
  focus; `ArrowRight` forwards.
- Callback signatures unchanged (`onSelect`, `onRemove`, `onShowActions`,
  `onFocusNextSection`, `onCancelKeyboardNavigation`, `onReload`).
- Menu keeps its existing viewport-fixed positioning, and the container declarations
  above do not change that: `container-type: inline-size` does not create a
  fixed-position containing block, so menu coordinates stay viewport-based. The
  Chromium gate asserts a menu trigger/menu coordinate relationship to pin this.
- Zero-machine and single-machine rendering unchanged.

## Verification plan

**jsdom** (DOM, accessibility, state — anything not requiring layout or native input):
- Kicker **DOM text is `Machine`**; uppercase rendering comes from CSS
  (`text-transform`), so jsdom asserts the literal `Machine`, and Chromium asserts the
  rendered uppercase form and its advance. An earlier draft asserted `MACHINE` as the
  source text, which would have failed.
- The description node exists with exact `Machine status: <status>.` text for all four
  statuses, `aria-describedby` resolves within the same shadow root, and the node is
  present whether the word is shown or not.
- Selected accessible name, menu contents with health words, callback forwarding,
  zero/one-machine omission.
- ArrowUp/ArrowDown/Escape handling, focus restoration, and `aria-expanded` state
  transitions driven by explicit events.
- `clampPanelWidth("navigation", 50)` is 324; `clampPanelWidth("navigation", NaN)` is
  340; drag and keyboard clamping use 324; a raw stored width of 260 clamps to 324
  (seeded as raw version-1 JSON, not via a write/read round trip).
- Rail renders the reload button iff `showReload`, and its accessible name is
  `Full page reload`; it is absent from `railOrder` and from reorder handling.
- Controller predicates at 1180/1181 and 760/761 for PWA and non-PWA, expecting the
  permission matrix above.

**Chromium** (all layout claims, and all native input; jsdom can neither compute layout
nor read shadow-root stylesheets, and synthetic key events do not trigger a native
button's default activation — an in-memory probe confirmed Enter/Space on a focused
jsdom button emitted zero clicks):
- 1600x900, desktop, production `appStyles` and theme; version label asserted
  **present** in the fixture so the row is measured with its real width.
- Outer columns **324, 340, 369, 370, 415, 416, 460, 600**:
  - every element in the overlap set (kicker, name, health indicator, activity
    indicator, chevron) is asserted present with a positive box **before** any rect
    comparison;
  - no rect intersection between them (0.75px tolerance);
  - kicker rendered extent fits its allocated box in the actual font (compare the
    untruncated kicker's measured advance, including letter-spacing, against its
    laid-out width), not just integer `scrollWidth === clientWidth`;
  - text column width >= 48; selected button and header `scrollWidth <= clientWidth`;
  - short name readable (>= 40px) at 324; long name ellipsizes while the kicker does
    not; tooltip exposes the full name.
- **Monotonicity sweep** across 324→600 in small steps: the health word must not
  toggle off as the panel widens. Assert the word's visibility is non-decreasing in
  width, which is the defect the two coupled thresholds could otherwise reintroduce.
- **Drawer-layout geometry** at an intermediate viewport (e.g. 1100px wide, PWA): with
  no persistent rail, assert inner panel == outer column, and assert outer 371 shows the
  version only at 372 inner (i.e. verify the same rule against the rail-less mapping).
- **Menu anchoring**: opening the menu leaves it viewport-anchored to the trigger (menu
  rect derived from the trigger rect, not clipped by the header), pinning that the new
  container declarations did not create a fixed-position containing block.
- Health-word threshold: verify all four statuses immediately below, at, and above
  150px switcher width. Activity is asserted present only in the states where production
  renders it (it is intentionally suppressed for `offline` and `error`), so the
  positive-box guard checks the indicators each state actually produces rather than
  demanding an impossible activity box.
- Version threshold: version hidden at 415, shown at 416; no overlap at either.
- **Native input**: real `Enter` and `Space` `Input.dispatchKeyEvent` on the focused
  selected button must open the menu and set `aria-expanded="true"`; `Escape` must
  close it and restore focus. These are Chromium-only.
- Refresh: PWA at >= 1181 renders exactly one refresh control and it is in the rail,
  none in the header; at 1100 the context bar shows a visible control **and** opening
  the drawer exposes the rail control; at 700 the context bar only; non-PWA renders
  none. Reload activation is exercised through the application wiring, not only the
  component property.
- Negative control: the same harness against the 1.26.0 modules fails on a
  kicker/overlap/readability assertion — not on a missing selector or import.
- Missing Chromium fails loudly; never skips.
- Entrypoint: `scripts/verify-narrow-navigation-header.mjs`, run via
  `npm run verify:narrow-navigation-header`. `npm run verify` (typecheck, lint, knip,
  serial Vitest) does not run it; the browser gate is invoked explicitly and its result
  recorded alongside the full run.

## Deliverables

- Patch Changeset (`.changeset/narrow-navigation-header.md`) per
  `.agents/skills/changeset-changelog/SKILL.md`; `CHANGELOG.md` is not edited.
- Documentation under `docs/` describing the new minimum width, the health-word
  threshold, the version-label behaviour, and the PWA refresh location, per
  `.agents/skills/documentation-guide/SKILL.md`. README stays a landing page.

## Risks

- Minimum rises 180 → 324; stored narrower widths clamp up and the panel widens for
  those users.
- The health word now hides below a 150px switcher, i.e. at more widths than the
  round-1 draft's 126px; the dot, tooltip, menu, and description carry the meaning.
- The version label hides below outer 416 (inner 372), a visible change across a wide
  range of widths. It is tied to the health-word threshold rather than to the first
  width where the row survives, so the health word never toggles back off as the panel
  widens. In the 761–1180px drawer layout there is no 44px rail, so the same rule returns
  the label at outer 372 there.
- At the 324 floor the machine name truncates heavily for IP-named machines; the
  tooltip fix is what keeps it recoverable.
- The 48px text floor is derived from measured `MACHINE` width in the installed font;
  a font change could require revisiting it, which is why Chromium asserts the actual
  advance.
