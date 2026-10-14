# Notes

Choices I made while building this, and the reasons for them.

## Data

- **LHX backlog gaps.** LHX's 10-Qs for the first three quarters of 2020 and 2021 never tag `RevenueRemainingPerformanceObligation` at the quarter's own end. The 2020Q1 filing tags none, and the rest tag only the prior fiscal year end (2020-01-03 or 2021-01-01). Quarterly tagging starts with the 10-Q for 2022Q1 (accession 0000202058-22-000029). I kept LHX as preregistered. The backlog model skips any forecast that needs one of those six quarters, so it scores fewer LHX forecasts than the two baselines.
- **HII's backlog jump.** HII's tagged backlog goes from $23.0B at 2018Q4 to $40.6B at 2019Q1. I found no filing sentence that explains it, so the README describes it and stops there.
- **Raw files stay out of git.** `make data` fetches a companyfacts file only when it is missing, and `data/raw/MANIFEST.json` records each file's hash and size.

## Model

- **Bridge residual.** I compute the residual as the revenue change less the sum of the three effects, which follows the preregistered wording. Subtracting the effects one at a time moves the float result by about a millionth of a dollar. Either way it is rounding noise.
- **Pooled comparisons.** The baselines score more forecasts than the backlog model because of the LHX gaps. `report.py` also ranks the three models on the forecasts they share and prints whether the ranking holds. It does.

## Workbook

- Every sheet except `About` freezes panes at `B2`. `About` is a single column of text.
- openpyxl stamps the save time into the file, so I pin the document dates and zip entry times to the as-of date. A rebuild writes identical bytes.

## Dashboard

- **Layout.** The page follows a Z: title and source at top left, and the global filters (company, horizon, period) at top right in a sticky header. Under them sit the finding and the KPI cards, then the trend charts two to a row, then the granular table and the method. Below 1200 px the charts go to one column, and below 900 px the header stops being sticky.
- **One data model.** `site/js/model.js` flattens `data.json` once into quarter rows, forecast rows, bridge rows and the what-if grid. The KPIs, every chart and the table read only those rows, so a chart and the table under it cannot disagree. `summarize()` computes the error statistics for any filter, and the KPIs, the scorecard and the table footer all call it.
- **Reconciliation.** `site/js/reconcile.js` recomputes, in whole cents, every trailing four-quarter figure, every bridge year's revenue, each bridge's steps, and every forecast's actual, from the quarterly rows. It also recomputes the published average misses and win rates from the forecast rows. The footer of the table shows the result for the companies and period in view. `tests/test_site_data.py` asserts the same identities on `data.json` in CI.
- **Bridge rounding.** Rounding the three bridge effects to the cent leaves a one-cent gap in three company-years (HII 2024, LHX 2023, LMT 2021). The overlap is shown as the balancing figure, so the steps add to the change exactly. The table beside the chart rounds each figure once, to $0.1M, with the overlap again as the balancing figure, so the printed column foots too.
- **Red and green.** Red and green appear only on a variance: an error against the baseline, the win rate against 50%, growth year on year, coverage against a year earlier, book-to-bill against 1.0×, and bridge steps. Each carries ▲ or ▼ and a sign as well. Series colours are slate-blue, ink and two slates, never red or green. Bias, the what-if change and the what-if grid are shown without colour, since neither direction is good or bad in itself.
- **Units and basis.** Every figure names its unit and scale (US$ billions in charts and KPIs, US$ millions in the table) and its basis: GAAP as first reported, derived from GAAP, or model. Tooltips give each reported figure in both $B and $M, so the $M figure can be found in the table.
- **Audit trail.** `data.json` also carries each quarter's period end, the accession numbers of the filings its backlog and revenue came from, and whether Q4 revenue is the full year less nine months. The table links each accession to its EDGAR folder. These keys are additive; the existing keys are unchanged.
- **States.** Every panel starts as `data-state="loading"` in the HTML, with a skeleton of its final size, so nothing moves when the data arrives. A failed download, a bad response or a throw while starting shows a page-level error with Try again. Each panel draws inside its own guard: a throw marks only that panel as failed. A filter that leaves a panel with nothing to show gives it an empty state that says why, with Show all years when the period was narrowed. The table says when no rows match and offers Clear filters.
- **Table performance.** Rows are flattened once with a lowercase search key. A filter and sort result is memoised on its inputs, the search waits for 150 ms of quiet, and rows are written 200 at a time as one HTML string. Export CSV writes the filtered rows at full precision in US dollars.
- **What-if.** It always starts from the latest quarter, so the period filter does not apply to it, and the panel says so. It shows trailing four-quarter revenue and the backtest bias next to the scenario, since the no-change scenario can sit well above recent revenue. The fan's lines are joins to each scenario's total, not quarter-by-quarter paths.
- **Replay.** The forecast chart can play back in the order the forecasts were made. Under reduced motion the Play button is hidden and the scrubber still steps through.
- **Linked crosshairs.** The book-to-bill strip shares the backlog chart's quarters and y-axis width. Pointing at any of the backlog, book-to-bill and forecast charts draws a dashed crosshair at the same quarter in the other two.
- **No decoration.** The backdrop sparkline, the how-to strip, the staggered intro and the count-up numbers are gone. Chart updates animate for 250 ms, and not at all under reduced motion.
- The theme button saves its choice in `localStorage` and applies it before the first paint. Without a saved choice, the page follows the system setting.
- The front end is native ES modules under `site/js/`, with no build step. Chart.js is vendored and loaded first as a classic script.
- GitHub Pages serves the site at `/Defense-Backlog-forecast/`, matching the repository name. The lowercase path returns 404.

## Accessibility

- I checked the dashboard against WCAG 2.2 AA. `tests/test_site_a11y.py` runs axe-core (vendored in `tests/vendor`, so it needs no network) in headless Chromium. It runs in light, dark, forced colours, more contrast and at 390 px, with a definition and the reconciliation list open, and again with empty panels. The same file checks the skip link, the company filter's arrow keys, the shortcut switch, reading a chart from the keyboard, scenario announcements, that focus never lands under the sticky header, reconciliation for each company, the empty and error states, and the table's search, sort and export. Without Playwright installed the file is skipped. `make a11y` runs it on its own.
- The company, horizon and bridge-year controls are radio groups or pressed buttons: one tab stop, with the arrow keys, Home and End moving through them.
- `1`–`5`, `R` and `?` are single-key shortcuts, which speech input can set off by accident. "Shortcuts" in the header lists them and has a switch that turns them off. The choice is saved in `localStorage` (`dbf-keys`). The arrow keys and Escape keep working either way.
- Each chart takes focus. The arrow keys, Home and End step through its points and show the same tooltip and linked crosshairs a pointer would. A screen reader hears the tooltip's rows. Escape or leaving the chart clears it.
- One polite live region speaks what a change did once it settles: the filters after a change, and the scenario after a slider or grid change. Spoken text says "billion", "million" and "percentage points" where the page shows "B", "M" and "pp".
- The sticky header's height changes as the filters wrap. A ResizeObserver keeps `scroll-padding-top` at its measured height, and anything that takes focus under it is scrolled clear.
- Every variance carries ▲ or ▼ and a sign, and the KPI cards add "favourable" or "unfavourable" for screen readers, so no meaning rests on colour.
- Under forced colours (Windows High Contrast), selection uses the system highlight and the line swatches keep their own colours.
- The type scale is in rem, so a larger default text size carries through. When the what-if grid is narrow, its cells drop the dollar sign; their accessible names keep it.
- Links in the table are at least 24 px tall (WCAG 2.5.8).
