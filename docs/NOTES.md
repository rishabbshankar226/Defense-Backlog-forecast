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

- At desktop width the backlog and forecast panels share a row, and the bridge sits beside the what-if panel, which needs room for its 5 by 5 grid. Below 900 px everything stacks.
- The forecast panel opens on the four-quarter view to match the scoreboard. The lowest-error tile carries the accent colour, and its label says why.
- The what-if panel shows trailing four-quarter revenue and the company's backtest bias next to the scenario, since the unshocked scenario can sit well above recent revenue.
- Headless Chrome on macOS will not open a window narrower than 500 px. To check the 390 px phone layout, I loaded the page in a 390 px iframe and confirmed it has no sideways scroll for any company.
- The company cards are the tabs. Once they scroll off the top, a compact bar with the tickers slides in. It is fixed rather than sticky, so showing it never moves the page, and it is inert while hidden so it never takes focus.
- The scenario fan plots each scenario at the quarter four ahead of the latest one. Trailing four-quarter revenue at that quarter is exactly the scenario's revenue over the next four quarters, so each line ends on its own figure. The straight line from today's trailing revenue is a join, not a forecast path, and the note under the chart says so.
- The replay hides each forecast until the head reaches it, and keeps Actual on screen as a faint track. Under reduced motion the Play button is hidden and the scrubber still steps through.
- The book-to-bill strip shares the backlog chart's quarters and a fixed y-axis width, so its bars sit under the same quarters. Hovering any of the backlog, book-to-bill and forecast charts draws a dashed crosshair at the same quarter in the other two.
- The scoreboard's bars and its company dots share one scale, set by the largest per-company error, so LHX's backlog-model error stays on the bar.
- The theme button saves its choice in `localStorage` and applies it before the first paint. Without a saved choice, the page follows the system setting.
- GitHub Pages serves the site at `/Defense-Backlog-forecast/`, matching the repository name. The lowercase path returns 404.
