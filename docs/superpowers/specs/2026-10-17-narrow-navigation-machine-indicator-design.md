# Narrow Navigation Machine Selector Design

**Date:** 2026-10-17
**Status:** Collaborative design approved; review refinements recorded below
**Scope:** Expanded navigation panel machine selector

## Background

At a desktop browser viewport of at least 1181px, the navigation panel permits a minimum column width of 180px. The activity rail reserves 44px, leaving an `app-navigation-panel` host inline size of 136px. The current header adds 12px padding on each side, leaving a 112px content box. Its brand, `machine-switcher`, and Actions controls share one flex row. Installed PWA mode also inserts a 36px refresh button into that row.

A Chromium reproduction at the real 180px constraint measured the selected-machine button at 18px wide, with zero usable width for its machine text. The fixed health status and chevron extended past the panel boundary. The panel clips that overflow, so the machine selector is no longer readable or reliably usable.

The affected control is `MachineSwitcher` in the expanded navigation panel. The compact `MachineList` used by the alternate navigation mode is outside this change.

## Approved Design

Use `app-navigation-panel` as a named inline-size query container (`navigation-header`). The query measures the host's content-box inline size, which has no host padding; it does not measure the header's padded inner box. Use the exact range `@container navigation-header (inline-size < 416px)` for narrow mode. At exactly 416px and above, use single-line mode.

### Single-line mode

Retain the current brand, machine selector, refresh control when supplied, and Actions control on one row, with their current sizes and visible labels:

```text
[ π WebUI v1.26.0 ] [ Machine / Local / unknown / ▾ ] [ ↻ ] [ Actions ]
```

The 416px threshold covers the PWA case and active-machine indicator as well as the longest health label. At that host size, the measured fixed budget is 24px header padding + 16px gaps + 117.66px brand + 107.72px refresh/Actions group, leaving a 150.62px selector. With `unknown` status and a session activity indicator, the selector has 58.05px for its text, enough for the 47.52px `Machine` kicker and the name `Local`. On desktop this is a 460px total navigation column after the 44px rail reserve. A single conservative threshold serves both browser and PWA modes.

Machine names longer than their allocation retain the existing ellipsis behavior.

### Narrow mode

Below a 416px host inline size, use a two-row grid:

```text
[ π ]                              [ ↻, if supplied ] [ Actions ]
[ activity, if active ] [ Machine / Local ] [ health dot ] [ ▾ ]
```

The brand symbol and action group occupy row one; the machine selector spans both columns in row two. Use 8px header padding, 4px column/action-group gaps, an 8px row gap, and 3px inline padding on the Actions button. These spacing changes preserve its visible `Actions` label and existing height. Keep the refresh button at its existing 36px size and retain its callback. At the 180px desktop column, this leaves a 120px inner width: the measured refresh/Actions group is 91.72px and the π glyph is 20.84px, fitting with the 4px column gap.

Hide only the visual brand wordmark and version in narrow mode; retain its accessible label. The machine selector retains the `Machine` kicker, selected name, optional activity indicator, and chevron. Show health as a colored 7px dot to leave room for activity and the name. Preserve the exact health word through an explicit accessible description and a tooltip on the health indicator; it remains visible in each menu entry.

The narrow selector is 120px wide at the minimum column. With activity and health dots present, its measured text allocation is 64.47px, enough for the kicker and `Local`. Long names ellipsize within that allocation. No third row is introduced, including when a refresh control is present.

The user chose the dedicated selector row and approved collapsing the brand wordmark/version to π at narrow widths. Review refinements add the PWA width budget, compact spacing, explicit health description, and exact container boundary while retaining that arrangement.

### Interaction and accessibility

The layout change does not alter the machine-switching interaction:

- click, Enter, and Space continue to toggle the machine menu;
- ArrowUp and ArrowDown continue to open the menu and focus the selected machine;
- the button keeps the accessible name `Machine: <selected name>. Switch machine.`;
- `aria-describedby` references a same-shadow-root status node containing `Machine status: <online|offline|error|unknown>.` at every width; merely retaining descendant text under an explicitly named button is insufficient;
- the health dot uses the existing success/danger/muted colors and a tooltip with the health word; its description supplies the state independently of color;
- the menu continues to list every machine with its name, type/base URL, and health state;
- focus navigation to the next navigation section is unchanged;
- the machine control remains a real button at every width.

## Architecture and Ownership

`AppNavigationPanel` owns the responsive header layout because it owns the brand, machine switcher placement, and Actions control. It will:

- establish the host as the named `navigation-header` inline-size container;
- add an explicit class to the visual `WebUI` wordmark so narrow-mode hiding is intentional;
- apply the narrow two-row grid and spacing below the exact 416px host threshold;
- place brand and action group explicitly in row one and make the nested `machine-switcher` span row two;
- preserve the supplied refresh control and its callback without changing `AppRefreshControl`.

`MachineSwitcher` retains ownership of machine data, menu state, keyboard handling, and menu positioning. Styles in its own shadow root may query the ancestor named `navigation-header` container to compact the selected health display; no additional size container is needed. Its new status description is internal, with no changes to public properties or callbacks. Do not add transforms, paint containment, or other fixed-position containing blocks that would trap the viewport-positioned menus.

No API, machine persistence, route, session-runtime, or mobile `MachineList` changes are required.

## Visual Mockup

The approved mockup uses the actual 180px navigation column: 44px rail plus 136px host. A browser prototype of the reviewed spacing also contains the refresh button and active-machine state in that width:

```text
Current at 180px                 Reviewed narrow mode
+----+--------------+             +----+--------------+
|rail| π WebUI ...  |             |rail| π  ↻ Actions |
|    | selector --->| clipped     |    | Machine      |
|    |              |             |    | ● Local  ● ▾ |
+----+--------------+             +----+--------------+
```

The first dot represents optional machine activity; the trailing dot represents health. At a host inline size of 416px and above, the brand wordmark/version and health word reappear in the single-line header.

## Error and Edge Behavior

- If there is one or zero configured machines, `AppNavigationPanel` continues to omit the machine switcher as it does today.
- If the selected machine name is long, the existing label ellipsis prevents it from expanding the button. Its full name remains in the button's accessible name and the menu entry. Preserve the existing `title` contract: a remote machine may show its base URL instead of its name.
- If machine health is unknown, the narrow health dot uses the existing muted status color and the explicit description says `Machine status: unknown.`.
- If the machine has terminal/session activity, the activity indicator remains visible and the machine text is the flexible item that may ellipsize.
- The fixed menu remains viewport-positioned and continues to use its existing width and max-height calculations; it is not constrained by the narrow button width.
- Resizing across the container threshold must preserve the selected machine, open menu, focused DOM element, and callbacks. This is a CSS layout switch; existing menu-position calculations remain unchanged, and a menu opened after resizing anchors to the new button position.

## Verification Strategy

1. Use real DOM/component tests for the brand label, selected-machine accessible name and description in all four health states, full machine menu content, and Actions/refresh callbacks. Use native keyboard input in Chromium for Enter/Space activation.
2. Add a browser geometry regression using the raw-CDP harness pattern. Use a desktop viewport such as 1600×900 (at least 1181px wide), set the navigation column to 180px, and assert the 44px rail reserve, 136px host, and revised 120px inner header width (8px padding per side). A 180px browser viewport is not the fixture.
3. At that constraint, test refresh absent/present, no activity/session activity/terminal activity, all health states, and a long remote name. Assert nonzero readable kicker/name allocation, containment of brand, full action group and its buttons, full selector, dots and chevron, and absence of clipping or overlap. Assert the `Local` fixture fits without ellipsis; allow intentional ellipsis for long names.
4. Probe host inline sizes 415px, exactly 416px, and 417px (desktop columns 459/460/461px) plus wider widths, with and without refresh. Check two rows below the boundary and one row at/above it, visible brand/status words in wide mode, and readable kicker/`Local` with unknown health plus activity. For the bounded fit assertion, use version `1.26.0`, the real system font, and deterministic machine data rather than a live app that may republish the fixture while measuring.
5. Check click, native Enter and Space activation; ArrowUp/Down opening and focusing the selected option; Up/Down/Home/End option navigation; Escape/Left closing and returning focus; Right forwarding to the next navigation section; and selection forwarding the intended machine once. Keep the menu open while resizing across the threshold and assert that selection, menu state, and focus survive. Check all names, type/base URL, and health states remain in the list.
6. Run focused Vitest tests, typecheck, lint, and the repository's required final verification profile before delivery. Browser geometry evidence must fail against the original one-row implementation; markup/style-string assertions alone cannot prove layout.

## Non-Goals

- Redesigning the machine menu or machine-management actions.
- Changing the collapsed/mobile navigation `MachineList`.
- Changing panel resize constraints or storage.
- Adding a new machine status model or API field.
- Replacing the existing machine selector with an icon-only unlabeled control.
