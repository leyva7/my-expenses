# My Expenses: how it is built and how to change it without breaking it

- **App:** `app/my-expenses.html` (v20). A single file meant to be published as a claude.ai artifact, where it stores data in the artifact's database; outside claude.ai it uses `localStorage`.
- **Local mode:** outside claude.ai everything lives in the `localStorage` key `gastos.local.v1`. On first run, with no data and no categories, it seeds a starter list of 16 categories (`STARTER`).
- **History:** every version change is a commit. To compare styles, get the previous version with `git show HEAD~1:app/my-expenses.html > /tmp/previous.html`.

Internal identifiers (function names such as `vResumen`, tab ids such as `resumen`, storage keys `gastos.*`) keep their original Spanish names so saved data and links keep working; everything the user sees is in English.

## Structure of `my-expenses.html`

1. **`<style>`.** General rules come first (variables, header, cards, charts, sheets), then each screen. Each selector is defined once per `@media` context. To change something, edit the existing rule; do not append an override at the end.
2. **HTML.** Minimal: header, `#scroller > main#main`, bottom bar `#bnav` and the `#fab` button.
   - **"Native iPhone" design (19 Nov 2026):** D tokens (`--accent-fill`, `--spend` = colour of expenses in charts, `--bar`, `--sheet`, `--card-el`, `--tint-a`; `--exp` is only for warnings/errors); the large `.ltitle` title is inserted by `render()`; pills = `.chips > .chip` and `.subnav` (active = indigo); Summary is laid out in columns `.flow > .fl-a/.fl-b/.fl-c` with `.qa` shortcuts; the `#periodBtn` pill opens `monthSheet()` in Summary and `periodSheet()` everywhere else.
3. **`<script>`.** Split into sections with `/* ---------- name ---------- */` headers:
   - **Data and calculations:** utils, state, storage, periods, aggregations, end-of-month forecast, month-end savings, fixed payments, pace by category, habit changes and insights.
   - **Interface:** charts, views, render, toast, sheets, import/export and events.
   - **Motion:** chart animation, transitions, mobile gestures and boot.

**Single definitions.** If a screen needs one of these figures, it must call the matching function instead of recomputing it:
- "Normal month" is the average of the last 6 complete months without extraordinary items: `monthForecast().normal`, which uses `avgMonthly(6)`.
- The end-of-month forecast comes from `forecastAt()`. The range comes from `forecastRange()` and the month's savings from `netForecastAt()`.
- A "one-off" expense is one where `isLump()` is true: extraordinary, €150 or more, or a trip.
- Alerts come from `allAlerts()` and are shown only in Summary.
- The forecast card shows the real total, extraordinary expenses included; only its "vs normal month" comparison and the pace chart leave them out, using `monthForecast().xs`.
- After saving a transaction, `showSaved()` makes sure it is visible (Summary jumps to its month; Transactions clears a filter that would hide it).

## Before publishing a change

```bash
git show HEAD:app/my-expenses.html > /tmp/previous.html   # previous version
node tests/calc.test.js                               # 14 calculation checks (all must pass)
node tests/snap.js /tmp/previous.html /tmp/before     # style of every screen, previous version
node tests/snap.js app/my-expenses.html /tmp/after    # style of every screen, new version
node tests/snapdiff.js /tmp/before /tmp/after         # which elements change and in which property
```

- **`calc.test.js`** loads the 897 invented transactions in `sample-data/` with a fixed date of 30 Oct 2026. It checks the forecast (16% mean error), savings rate, normal month, fixed payments, alerts, category suggestion, and that exporting and re-importing a CSV duplicates nothing.
- **`snap.js`** walks every tab and sub-view, plus the add sheet, on mobile, desktop and mobile landscape, in light and dark themes. It records the computed style of every element and a screenshot.
  - `snapdiff` should only show the screens you meant to change.
  - Two known differences show up even with no change: the header title in Transactions (mobile) and a ±0.02 px shift in the big figure. Both come from font loading timing.
- **`tests/tools/cssmerge.py`** merges repeated CSS rules. It only moves a declaration when no rule in between competes with it. Run `snap.js` and `snapdiff.js` afterwards.

Then commit, rebuild the demo with `python3 tools/build_demo.py` and, if you use the app as a claude.ai artifact, publish `app/my-expenses.html` to the same artifact to keep its link.
