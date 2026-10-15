# Notes

Choices I made along the way, and why.

## Data

- **LHX backlog gaps.** LHX's 10-Qs for the first three quarters of 2020 and 2021 don't tag `RevenueRemainingPerformanceObligation` at the quarter's own end. The 2020Q1 filing tags none, and the rest only tag the prior fiscal year end (2020-01-03 or 2021-01-01). Quarterly tagging starts with the 2022Q1 10-Q (accession 0000202058-22-000029). I kept LHX in, as preregistered, and the backlog model just skips any forecast that needs one of those six quarters. That's why it scores fewer LHX forecasts than the baselines.
- **HII's backlog jump.** Tagged backlog goes from $23.0B at 2018Q4 to $40.6B at 2019Q1. I couldn't find a filing sentence that explains it, so the README describes it and leaves it there.
- **Raw files stay out of git.** `make data` only fetches a companyfacts file if it's missing, and `data/raw/MANIFEST.json` records each file's hash and size.

## Model

- **Bridge residual.** The residual is the revenue change minus the sum of the three effects, which is how the preregistration words it. Subtracting them one at a time moves the float result by about a millionth of a dollar, so it doesn't matter either way.
- **Pooled comparisons.** Because of the LHX gaps the baselines score more forecasts than the backlog model. `report.py` also ranks the three models on the forecasts they share and prints whether the ranking holds. It does.

## Workbook

- Every sheet except `About` freezes panes at `B2`.
- openpyxl stamps the save time into the file, so I pin the document dates and zip entry times to the as-of date. Rebuilding gives identical bytes.

## Dashboard

- **No build step.** Native ES modules under `site/js/`, with Chart.js vendored and loaded first as a classic script. GitHub Pages serves it at `/Defense-Backlog-forecast/`; the lowercase path 404s.
- **Layout.** The answer goes first: the finding is the biggest line on the page, next to the pooled KPIs, with a scorecard by company below it. Then the selected company's charts (backlog, forecasts, the revenue bridge, the what-if), then the full data table and the method. Under 1200 px it's one column.
- **One data model.** `site/js/model.js` flattens `data.json` once into quarter, forecast and bridge rows plus the what-if grid. The KPIs, every chart and the table read only from those rows, so a chart can't disagree with the table under it. `summarize()` computes the error stats for any filter, and `sharedSummary()` does the same on the origins every model scores, which is what the scorecard's like-for-like note uses.
- **Reconciliation.** `site/js/reconcile.js` recomputes, in whole cents, every trailing four-quarter figure, each bridge year's revenue and steps, and every forecast's actual from the quarterly rows. It also re-derives the published misses and win rates, the bridge drivers and the what-if's starting rate. The table footer shows the result for whatever's in view, and `tests/test_site_data.py` asserts the same identities on `data.json` in CI.
- **Rounding.** Rounding the three bridge effects to the cent leaves a one-cent gap in three company-years (HII 2024, LHX 2023, LMT 2021), so the overlap is the balancing figure and the steps add up exactly. The bridge table rounds each figure once to $0.1M, again with the overlap balancing, so the printed column foots. Changes are worked from unrounded figures and coloured as they print, so a change that rounds to zero is never red or green.
- **Scales.** The backlog chart always starts at zero so the gap between backlog and revenue reads at its true size. The bridge needs a cut axis for its steps to be visible, so its two total bars get break marks and the caption says the axis doesn't start at zero.
- **Colour.** Red and green only mean a variance (error vs the baseline, win rate vs 50%, year-on-year growth, coverage, book-to-bill vs 1.0×, bridge steps), and always come with ▲/▼ and a sign. Series colours are never red or green. Bias and the what-if aren't coloured, since neither direction is good or bad.
- **Type.** IBM Plex Sans, self-hosted as one variable woff2, with a local fallback sized to its metrics. Its digits are all one width, so tables and ticks line up without a monospaced face. All the sizes, colours and spacing are tokens at the top of `site/style.css`.
- **Units and basis.** Every figure says its unit and whether it's GAAP as first reported, derived, or model output. Tooltips give reported figures in both $B and $M so you can find them in the table.
- **Audit trail.** `data.json` carries each quarter's period end, the accession numbers its backlog and revenue came from, and whether Q4 is full year minus nine months. The table links each accession to its EDGAR folder.
- **Loading without layout shift.** Every panel starts as `data-state="loading"` with a skeleton at its final size. Slots the data fills hold a hidden stand-in of the real text with `#` for each digit. Plex's `#` is wider than its digits, so a tiny `@font-face` covering only `#` scales it down. The stand-in then wraps exactly like the real text, and the HTML still holds no figures. With `data.json` held back, nothing moves more than 0.1 px when it arrives at 1440, 1280 or 390 px.
- **Failures.** A failed download or a throw on start shows a page-level error with Try again. After that each panel renders in its own guard, so one bad panel only marks itself as failed. A filter that empties a panel says why and offers Show all years when the period was narrowed.
- **Table.** Rows get a lowercase search key once, filter-and-sort is memoised, search waits for 150 ms of quiet, and rows render 200 at a time. Export CSV writes the filtered rows at full precision in dollars.
- **What-if.** Always starts from the latest quarter, so the period filter doesn't touch it. The readout lists its inputs (today's backlog and the four-quarter conversion implied by the no-change case) rather than multiplying them, because rounded inputs won't multiply back to the rounded total. It also shows trailing revenue and the backtest bias, since the no-change scenario can sit well above recent revenue.
- **Theme.** The theme button saves to `localStorage` and applies before first paint; otherwise the page follows the system setting.

## Accessibility

- I aimed for WCAG 2.2 AA. `tests/test_site_a11y.py` runs axe-core (vendored, no network) in headless Chromium across light, dark, forced colours, more contrast and a 390 px phone, plus empty and error states. It also checks the skip link, keyboard chart reading, the shortcut switch, focus never landing under the sticky header, reconciliation for every company, and the table's search, sort and export. It skips itself without Playwright; `make a11y` runs it alone.
- Company, horizon and bridge-year controls are radio groups: one tab stop, then arrow keys, Home and End.
- `1`–`5`, `R` and `?` are single-key shortcuts. Speech input can set those off by accident, so the Shortcuts dialog has a switch to turn them off (saved as `dbf-keys`).
- Charts take focus, and the arrow keys step through points with the same tooltip and crosshairs as the mouse. Screen readers hear the tooltip rows.
- One polite live region reads out what a filter or scenario change did once it settles, saying "billion" and "percentage points" rather than "B" and "pp".
- The sticky header changes height as the filters wrap, so a ResizeObserver keeps `scroll-padding-top` in sync and anything focused underneath gets scrolled clear (WCAG 2.4.11). Empty or failed panels hide what's under their message for the same reason.
- No meaning rests on colour: variances carry ▲/▼, a sign, and "favourable"/"unfavourable" for screen readers.
- Under forced colours, selection uses the system highlight, and the scorecard's bars and selected row stay visible.
- Table links are at least 24 px tall, and on touch screens every control is at least 44 px.
