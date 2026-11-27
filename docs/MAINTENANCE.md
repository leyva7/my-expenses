# My Expenses: how it is built and how to change it without breaking it

- **App:** `app/my-expenses.html` (v30). A single file meant to be published as a claude.ai artifact, where it stores data in the artifact's database; outside claude.ai it uses `localStorage`.
- **Local mode:** outside claude.ai everything lives in the `localStorage` key `gastos.local.v1`. On first run, with no data and no categories, it seeds a starter list of 16 categories (`STARTER`).
- **History:** every version change is a commit. To compare styles, get the previous version with `git show HEAD~1:app/my-expenses.html > /tmp/previous.html`.

Internal identifiers (function names such as `vResumen`, tab ids such as `resumen`, storage keys `gastos.*`, internal values such as `importe`) keep their original Spanish names so saved data and links keep working; everything the user sees is in English.

## Structure of `my-expenses.html`

1. **`<style>`.** General rules come first (variables, header, cards, charts, sheets), then each screen. Each selector is defined once per `@media` context. To change something, edit the existing rule; do not append an override at the end.
2. **HTML.** Minimal: header, `#scroller > main#main`, bottom bar `#bnav` and the `#fab` button.
   - **"Native iPhone" design (19 Nov 2026):** D tokens (`--accent-fill`, `--spend` = colour of expenses in charts, `--bar`, `--sheet`, `--card-el`, `--tint-a`; `--exp` is only for warnings/errors); the large `.ltitle` title is inserted by `render()`; pills = `.chips > .chip` and `.subnav` (active = indigo); Summary is laid out in columns `.flow > .fl-a/.fl-b/.fl-c` with `.qa` shortcuts; the `#periodBtn` pill opens `monthSheet()` in Summary and `periodSheet()` everywhere else.
3. **`<script>`.** Split into sections with `/* ---------- name ---------- */` headers:
   - **Data and calculations:** utils, state, storage, periods, aggregations, end-of-month forecast, month-end savings, fixed payments, pace by category, habit changes and insights.
   - **Interface:** charts, views, render, toast, sheets, import/export and events.
   - **Motion:** chart animation, transitions, mobile gestures and boot.

**Glossary (what the user sees and what it is called in the code).**
- **Normal month:** what a typical month costs: the average of the last 6 complete months without extraordinary items (`avgMonthly(6)`, `monthForecast().normal`). No longer shown on the forecast card or in Habits.
- **Day-to-day:** all spending except one-offs. **Normal day-to-day** is the normal month without one-offs (`normalNoLumps()`, = `monthForecast().normalNL`): the single yardstick of the forecast card and of Habits.
- **One-off / extraordinary:** "extraordinary" is the mark the user puts on an expense (`t.x`, shown as "EXTRA"). "One-off" is wider (`isLump()`): an extraordinary expense, any expense of €150 or more (`LUMP`), or a trip (`isTripCat()`). One-offs count in the big figure, not in day-to-day.
- **"You have X left for day-to-day":** what is left of normal day-to-day this month (`monthLeft()`). A margin, not a forecast. Below zero it reads "You are X over on day-to-day".
- **Forecast:** how the month will end. The **total** is the big figure (`monthForecast().p`, one-offs included); the **day-to-day forecast** is `ord`, without one-offs. Habits labels them "Total forecast" and "Day-to-day forecast".
- **Pill:** the coloured tag next to the big figure and in Habits (`pacePill()`): "▲/▼ X% day-to-day", day-to-day forecast vs normal day-to-day. Note that the rounded filter buttons (`.chips > .chip`) and the period selector (`#periodBtn`) are also "pills" in the design; "the pill" on its own means this one.

**Single definitions.** If a screen needs one of these figures, it must call the matching function instead of recomputing it:
- "Normal month": `monthForecast().normal`, which uses `avgMonthly(6)`.
- "Normal day-to-day": `normalNoLumps()`, the same 6 months without one-offs.
- The end-of-month forecast comes from `forecastAt()`. The range comes from `forecastRange()` and the month's savings from `netForecastAt()`.
- A "one-off" expense is one where `isLump()` is true. It lives in the forecast section, with `LUMP` and `isTripCat`.
- The month curve in Habits comes from `monthCurve()` and the day-to-day pill from `pacePill()`; both screens use the same functions.
- Alerts come from `allAlerts()` and are shown only in Summary.
- After saving a transaction, `showSaved()` makes sure it is visible (Summary jumps to its month; Transactions clears a filter that would hide it).

## Forecast card

- **Big figure:** the real total of the month, one-offs included: `monthForecast().p`, equal to `forecastAt().p`.
- **"Fixed still due":** the active fixed payments of the Fixed screen (`fixedScan()`) not yet logged this month.
- **Day-to-day and one-offs.** `monthForecast()` splits the big figure in three: `p = ord + punt + remBig`.
  - `ord`, the day-to-day forecast: spent without one-offs + fixed still due that are not one-offs (`pendNL`) + the rest of the month (`remVar`).
  - `punt`, the known one-offs: those spent this month and any fixed payment still due of €150 or more.
  - `remBig`, "Unexpected": an allowance in case a one-off comes up.
- **One yardstick: `normalNoLumps()`, with or without budgets.** The pill, "You have X left", "You will end ≈ X above normal", the mark on the bar and the grey curve in Habits all measure against the same figure, so they cannot contradict each other. Suggested budgets (the 75th percentile of each category) add up to a month that almost never happens, so they are not used here; budgets stay in Analysis › Habits, category by category.
- **Pill (`pacePill()`):** `dv = (ord − normalNL) / normalNL`. Red when up, green when down, grey within ±5%. Not shown before day 5 (`dv` is `null`). At 320 px it reads only "▲ X%".
- **"You have X left for day-to-day (Y/day)":** `monthLeft()` = normal day-to-day − spent without one-offs − fixed still due that are not one-offs. Y = X ÷ days left (today included).
- **"You will end ≈ X above normal":** shown when the pill is red (`dv ≥ 5%`) and it is not the last day. X = `left.over` = `ord − normalNL`: where you end, so X is always at least what you are already over. A red pill next to "You have X left" therefore always comes with its explanation.
- **"Includes X of one-offs, on top of day-to-day":** shown when `punt` > 0. It explains why a purchase of €150 or more does not move "You have X left", and why the big figure can be high with a green pill.
- **Short card on mobile (below 900 px).** `.fc` has two parts: the summary button `.fc-sum` (eyebrow and pill, big figure, "Still early" or "nothing logged" notes when needed, "You have X left", the two notes above and "Details ⌄") and the details `.fc-det` (`#fcDet`: range, bar, legend, what "You have X left" measures, what one-offs are, "See the pace in Habits"). `fcToggle()` opens and closes the details, sets `aria-expanded` and remembers it in `S.fcOpen`. Closed, the card fits under the Net and above the bottom bar, including on the iPhone SE (320 px) with an "Offline" or "Nothing logged for N days" line above it: below 360 px those lines are shorter (still 44 px to tap through `::after`) and the card's own "nothing logged" note is hidden when the line is already there (class `dd`). The worst case leaves only 5–9 px: if you add anything to the card, run `design.test.js`. From 900 px the details are always visible and tapping the summary goes to Habits.
- **Bar (two bars on the same scale):** day-to-day on top (spent in indigo, fixed still due hatched, expected in light lilac, plus the "normal day-to-day" mark) and one-offs below (known in amber, unexpected in hatched amber, no mark; hidden when there are none). The scale is `max(ord, punt + remBig, normalNL) × 1.06`. Neighbouring segments differ by at least 3:1 or by hatching, with a 2 px gap.
- **Habits › "{Month} pace":** `monthCurve()` draws this month without one-offs, the day-to-day forecast up to `ord`, and normal day-to-day shaped day by day and ending at `normalNL`. The subtitle reads "Total forecast ≈ p · day-to-day ≈ ord · normal normalNL" with the same pill.
- **Last day:** "You close {month} at", without "≈" when nothing is left to forecast, without range and without "above normal". The range is also hidden when both ends round to the same figure.
- **Day change:** `dayCheck()` repaints when you come back to the app and at midnight if the painted day is no longer today.

## How data is saved to the cloud

Everything is in the `storage` section.

- **Outbox first.** `commit()` stores each change in the browser's outbox (`gastos.outbox.v1`) *before* sending it, and `flushOutbox()` removes it only when the cloud confirms. It sends month by month (everything pending for a month in one write), then the settings.
- **Time limit.** Every write goes through `send()`: if the cloud does not answer in 8 s it counts as offline and stays pending. `syncLine()` shows what is pending after 1.5 s ("saving…") or after a failure. Pending changes survive a reload and are retried (on start, on `online`, when the tab comes back and every 15 s).
- **Fatal errors** (permission, quota): `commit()` undoes in the cloud what did arrive, and `showCloud()` shows the cloud plus what is pending; what you typed comes back under "+".
- **Settings by change, not by snapshot.** `cfgRecord()` compares the screen with the cloud and records single changes in `gastos.outbox.v1.cfgops` (a category field, goal, pot, silenced fixed payments, last backup). `writeConfig()` re-reads `meta/config` and applies them with `applyCfg()`. The document keeps an ever-growing mark per item in `cfgAt`, and each change records the mark its device saw; a change is dropped only if the cloud changed that item after what it saw ("Another device changed it later; its value stays").
- **One transaction, one month.** Every written transaction carries `u` (write time). When editing or moving, `commit()` also removes it from any other month where the cloud has it. If it still shows up twice, the newest copy is shown and `fixDupes()` deletes the other. Old duplicates without `u` are shown once (`dupes()`) and never deleted on open.
- **Late writes.** `send()` does not write a document until the previous write has really finished, even if its caller stopped waiting after 8 s; the document waits in `lateW`. If everything pending waits on a hung write **and** the cloud has confirmed another write since (`sendOk`, `onlyHung()`), the line says "N pending changes · waiting for the cloud to confirm…" instead of "offline".
- **Re-checking what was saved.** For 2 minutes (`RECENT_MS`) each tab re-checks, with every cloud snapshot, what it confirmed: `recheckM()` for transactions and `recheckC()` for settings. If a late write from another device undid it, it goes back to the outbox. Each month keeps deletions of the last 90 days in `gone` so nothing deleted on purpose comes back.
- **One outbox per browser.** Each outbox entry has an identity; `saveOutbox()` merges with what other tabs saved (`obMerge()`), and the `storage` event brings in what another tab adds. If the browser cannot store the outbox, the line says "do not reload until the connection is back" instead of "it will be saved".
- **Own settings writes after a reload.** `ownSt` (the `cfgAt` marks this browser wrote) is kept in `gastos.ownSt.v1` for 24 h, so a slow write of your own that lands after a reload is not taken for "another device".
- **Damaged transactions in the cloud.** `showCloud()` passes each transaction through `cleanTx()`: without a valid date or with a non-numeric amount it is not shown; an amount stored as text ("7") is read as a number. Nothing is written back; a toast says how many were skipped.
- **A screen that fails to render.** `render()` wraps `render0()`: an exception shows "Cannot show this screen" with "Download backup" and "Reload" instead of a half-painted page.
- **No silent local mode.** Inside claude.ai, if the database fails the app says "Cannot connect to your data" with Retry and Reload (`errorState()`; also after 15 s without data, `LOAD_MS`). Retry (`relisten()`) starts a new `boot()` generation (`bootGen`). If the browser holds transactions from an old local mode, `localLine()` offers to upload them (`uploadLocal()`).
- **Offline with the data on screen.** `offLine()` shows "Offline · Retry" in one row (on every screen) while `S.offline` is set: after a failed cloud listener (cleared by a new listener) or the browser's `offline` event (cleared by `online`).
- **Import** checks dates, amounts (from 0.01 to under a million) and the types of every settings field; invalid items are ignored and counted. Offline, everything stays pending in the outbox.
- **Security.** Everything that comes from the cloud or a file and is painted as HTML goes through `esc()`, attributes and `data-tip` included; colours must be `#rrggbb` (`okColor()`).

## Toasts, errors and text

- **Toasts (`toast(msg, undo, { err, label })`)** are always shown whole, never cut with "…". They last according to their length (`toastMs()`): at least 5 s, 3 s more with a button, at least 8 s for errors. Screen readers hear them through `#live` (polite) or `#liveErr` (errors).
- **Loading.** Until months and settings arrive, a skeleton is shown and "+" is disabled.
- **Accessible error screen.** The message is in `.err-msg` with `role="alert"`, the focus goes to "Retry" and Tab reaches "Reload".
- **No "screen diagnostics".** Removed (the More entry, triple tap and the `diag/auto` write on every open).
- **Text.** Counts use `nOf(n, "transaction", "transactions")`. Short dates go through `dLoc()` (en-GB, with "Sep" instead of "Sept"). When editing, the amount shows two decimals ("3.20"). In Transactions, two visible categories with the same name (an expense and an income "Gifts") get " · expense" / " · income" on their chips.
- **Browser zoom.** At 150% an iPhone is about 262 px wide, at 200% about 197 px. Two blocks at the end of `<style>`: `max-width:300px` (theme button moves to More, card headers wrap, KPIs in one column) and `max-width:240px` (backup button moves to More, the bottom bar keeps only its icons, rows and grids go to one column, the date picker wraps).
- **Light-mode contrast.** `--muted` #636366, `--inc` #17733A, `--exp` #BA2329 and `--warn` #965004 reach at least 4.5:1 on the real backgrounds.

## Before publishing a change

```bash
git show HEAD:app/my-expenses.html > /tmp/previous.html   # previous version
node tests/calc.test.js                               # 33 calculation checks (all must pass)
node tests/flows.test.js                              # 17 user flows against a fake cloud
node tests/sync.test.js                               # 36 checks with several devices and one shared cloud
node tests/sync2.test.js                              # 48 fine-grained robustness checks
node tests/design.test.js                             # 883 layout checks: 320/375/393 px, light and dark, 150/200 % zoom
node tests/snap.js /tmp/previous.html /tmp/before     # style of every screen, previous version
node tests/snap.js app/my-expenses.html /tmp/after    # style of every screen, new version
node tests/snapdiff.js /tmp/before /tmp/after         # which elements change and in which property
```

- **`calc.test.js`** loads the 897 invented transactions in `sample-data/` with a fixed date of 30 Oct 2026. It checks the forecast (16% mean error in the back-test), "You have X left", the pill (not before day 5), the single yardstick with budgets, "You will end ≈ X above normal" (both still under and already over), that Habits agrees with the pill on days 5, 10, 15, 20 and 25, the last day without range, the savings rate, the goal quota, normal month, fixed payments, alerts, category suggestion, and that exporting and re-importing a CSV duplicates nothing. Some checks inject a few invented expenses to reach a red pill and remove them afterwards.
- **`flows.test.js`** (about 20 s) drives the app like a person on an iPhone 15 against a fake cloud: add, move to another month, delete + undo, offline outbox, fatal error, drafts, typo and date guards, search outside the period and bulk delete.
- **`sync.test.js`** (about 1 minute): each device is a separate browser against a shared cloud in Node, with locks, cut or hung network and injected errors: several offline expenses and a reload, settings from two devices, starting without a database and uploading local data, offline import, one transaction in one month.
- **`sync2.test.js`** (about 5 minutes): late writes, duplicates, outbox shared by tabs, a hung write with a working network, own slow settings writes after a reload, damaged transactions, and opening data written by the previous release (taken from git history; skipped if not found).
- **`design.test.js`** (about 70 s) opens every screen and sheet at 320, 375 and 393 px in light and dark, the error screen and two toasts: no horizontal scroll, no clipped text, tap targets of at least 44 px, contrast of at least 4.5:1; the forecast card closed and open, on 1, 15, 25 and 30 Nov and on the SE with a line above it; the "Offline · Retry" line; and zoom at 150% and 200%.
- **`snap.js`** walks every tab and sub-view, plus the add sheet, on mobile, desktop and mobile landscape, in light and dark themes. It records the computed style of every element and a screenshot.
  - `snapdiff` should only show the screens you meant to change.
  - Two known differences show up even with no change: the header title in Transactions (mobile) and a ±0.02 px shift in the big figure. Both come from font loading timing.
- **`tests/tools/cssmerge.py`** merges repeated CSS rules. It only moves a declaration when no rule in between competes with it. Run `snap.js` and `snapdiff.js` afterwards.

Then commit, rebuild the demo with `python3 tools/build_demo.py` and, if you use the app as a claude.ai artifact, publish `app/my-expenses.html` to the same artifact to keep its link.
