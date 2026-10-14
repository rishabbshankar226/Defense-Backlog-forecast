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

- Each panel runs the full width, with its title, controls and caption in a left column beside the chart. Below 900 px the column moves above the chart.
- The forecast panel opens on the four-quarter view to match the scoreboard. The lowest-error tile carries the accent colour, and its label says why.
- The what-if panel shows trailing four-quarter revenue and the company's backtest bias next to the scenario, since the unshocked scenario can sit well above recent revenue.
- Headless Chrome on macOS will not open a window narrower than 500 px. To check the 390 px phone layout, I loaded the page in a 390 px iframe and confirmed it has no sideways scroll for any company.
- The company cards are the tabs. Once they scroll off the top, a compact bar with the tickers slides in. It is fixed rather than sticky, so showing it never moves the page, and it is inert while hidden so it never takes focus.
- The scenario fan plots each scenario at the quarter four ahead of the latest one. Trailing four-quarter revenue at that quarter is exactly the scenario's revenue over the next four quarters, so each line ends on its own figure. The straight line from today's trailing revenue is a join, not a forecast path, and the note under the chart says so.
- The replay hides each forecast until the head reaches it, and keeps Actual on screen as a faint track. Under reduced motion the Play button is hidden and the scrubber still steps through.
- The book-to-bill strip shares the backlog chart's quarters and a fixed y-axis width, so its bars sit under the same quarters. Hovering any of the backlog, book-to-bill and forecast charts draws a dashed crosshair at the same quarter in the other two.
- The scoreboard's bars and its company dots share one scale, set by the largest per-company error, so LHX's backlog-model error stays on the bar.
- The theme button saves its choice in `localStorage` and applies it before the first paint. Without a saved choice, the page follows the system setting.
- On wide screens the compact bar also links to each panel. The links scroll with JavaScript and never change the hash, because the hash holds the company.
- On narrow screens the scenario figure floats at the foot of the screen while the sliders or grid are in view and the readout is not, so tapping a grid cell always shows its result.
- Touch has no mouseout, so a tapped chart would keep its tooltip and the linked crosshairs. Tapping outside the charts, or scrolling, clears them. Tapping a scoreboard dot shows its label for a moment, since there is no hover.
- `data.json` is preloaded from the page head, so it downloads alongside Chart.js rather than after it. If it fails, the headline says so and offers to try again.
- At 320 px the compact bar's five tickers share its width equally, the replay scrubber wraps under its button, and the what-if grid drops the dollar sign from its cells (their accessible names keep it).
- GitHub Pages serves the site at `/Defense-Backlog-forecast/`, matching the repository name. The lowercase path returns 404.

## Accessibility

- I checked the dashboard against WCAG 2.2 AA. `tests/test_site_a11y.py` runs axe-core (vendored in `tests/vendor`, so it needs no network) in headless Chromium. It runs in light, dark, forced colours, more contrast and at 390 px, with every table and a definition open. The same file checks the skip link, the card arrow keys, the shortcut switch, reading a chart from the keyboard, scenario announcements, and that focus never lands under the compact bar. Without Playwright installed the file is skipped. `make a11y` runs it on its own.
- `1`–`5`, `R` and `?` are single-key shortcuts, which speech input can set off by accident. "Keyboard shortcuts" next to the cards lists them and has a switch that turns them off. The choice is saved in `localStorage` (`dbf-keys`). The arrow keys and Escape keep working either way.
- Each chart takes focus. The arrow keys, Home and End step through its points and show the same tooltip and linked crosshairs a pointer would. A screen reader hears the tooltip's rows. Escape or leaving the chart clears it.
- One polite live region speaks what a change did once it settles: the verdict after a company switch, and the scenario after a slider or grid change. The visible verdict tweens its figures, so it is no longer a live region itself, since that would read out every frame. Spoken text says "billion" and "percentage points" where the page shows "B" and "pp".
- The light Trailing 4Q gray went from `#a9a9a9` to `#8a8a8a`, about 3.4:1 on the surface. That is the floor for a line that carries meaning. The static charts use the same value.
- On phones the "Backlog better/worse" badge shrinks to a mark. It points up for better and down for worse, so it no longer depends on colour.
- Under forced colours (Windows High Contrast), the sliding pills are hidden, and selection uses the system highlight. The swatches keep their own colours.
- The type scale is in rem, so a larger default text size carries through. When the what-if grid is narrow for its text, its cells first drop the dollar sign, then break before the "B" rather than clipping.
- The compact bar now shows and hides on a scroll check instead of an observer. A jump from the foot of the page to the top never crosses the cards, so the observer left the bar covering the title. Tab wrapping round showed it.
