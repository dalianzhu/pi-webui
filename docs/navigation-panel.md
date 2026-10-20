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
