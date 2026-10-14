# Preregistration

I wrote this design down and committed it before fetching any data or computing any result. No definition, window or company here changed after I saw a number.

## Question

Does backlog at quarter end forecast the next quarters' revenue better than last year's revenue does? I report the answer whichever way it falls.

## Reporting rule

The headline gives the pooled H4 MAPE of all three models and names the lowest. Anything I try after seeing results goes in `results/exploratory/` and under `### Exploratory` in the README's Method section, labelled as tried after the fact. It never becomes the headline.

## Companies

Each is read from its `START` through `2026Q2`. `AS_OF` is `2026-10-13`.

| Ticker | CIK | START | Why that start |
|---|---|---|---|
| HII | 0001501585 | 2018Q1 | |
| LHX | 0000202058 | 2020Q1 | L3 and Harris merged on 2019-06-29; the six-month transition period to 2020-01-03 was filed on a 10-KT |
| LMT | 0000936468 | 2018Q1 | |
| NOC | 0001133421 | 2018Q3 | Orbital ATK closed on 2018-06-06 |
| RTX | 0000101829 | 2020Q2 | UTC became RTX on 2020-04-03, the day Otis and Carrier spun off |

General Dynamics is left out. Its 10-Qs last tagged `RevenueRemainingPerformanceObligation` for the quarter ended 2018-09-30, and its revenue facts since 2021 are full-year only (read 2026-10-13 from SEC's companyconcept API).

## Source

`https://data.sec.gov/api/xbrl/companyfacts/CIK<10 digits>.json`, sent with a `User-Agent` naming a contact, at most 5 requests a second. A file is fetched only when it is missing from `data/raw/`, so later SEC filings never change a run. `data/raw/MANIFEST.json` holds each file's sha256 and byte count.

## Extraction

Read `facts.us-gaap.<tag>.units.USD`:

1. Keep facts whose `form` is exactly `10-Q` or `10-K` and whose `filed` is on or before `AS_OF`.
2. A fact's quarter: subtract 15 days from `end` and take that date's calendar quarter. LHX's 52/53-week quarters end a few days off the calendar quarter end.
3. **First reported.** Sort candidates by `filed`, then `accn`, then the later `end` first, then tag rank, then `val`. Take the first. Later filings restate, and the backtest uses what was known at the time.
4. **Backlog:** facts of `RevenueRemainingPerformanceObligation` with no `start`, first reported per quarter.
5. **Revenue:** pool the facts that have a `start` from `Revenues` (rank 0) and `RevenueFromContractWithCustomerExcludingAssessedTax` (rank 1). Days = `end` − `start`.
   - A three-month fact (80 to 100 days) in the quarter, first reported: method `reported_3m`.
   - Otherwise a full-year fact (350 to 380 days) in the quarter, first reported, less the first-reported nine-month fact (260 to 290 days, either tag) with the same `start`: method `fy_minus_9m`. Tag, accession and filed date come from the full-year fact.
   - **Misdated full years.** LHX's FY2025 10-K tags full-year revenue with a three-month start date. So a three-month fact whose value exceeds the first-reported nine-month fact ending the day before its `start` is set aside before the first rule. When neither rule above gives a value, the first-reported set-aside fact less that nine-month fact is the quarter: method `fy_minus_9m`, with tag, accession and filed date from the set-aside fact.
   - Otherwise blank.
6. `data/processed/quarterly.csv` has one row per ticker and quarter from `START` to `2026Q2`, sorted by ticker then quarter, with exactly these columns:
   `ticker,quarter,period_end,backlog_usd,backlog_accn,backlog_filed,revenue_usd,revenue_method,revenue_tag,revenue_accn,revenue_filed`.
   Quarters read `2024Q3`. Dollars are whole USD. `period_end` is the backlog fact's `end`. A missing value is an empty cell. With no gaps this is 151 rows.

## Model

For one ticker at quarter index t: B is backlog, R is revenue, s is START's index and L is 2026Q2's.

- One-quarter conversion c(t) = R(t+1) / B(t). Four-quarter conversion r(t) = [R(t+1) + … + R(t+4)] / B(t). TTM(t) = R(t−3) + … + R(t).
- Implied bookings(t) = B(t) − B(t−1) + R(t), for t > s. Book-to-bill(t) = implied bookings(t) / R(t).
- **H1:** origins t = s+8 to L−1, target t+1.
  backlog `B(t) × [c(t−4) + c(t−8)] / 2`; naive `R(t−3)`; naive_drift `R(t−3) × TTM(t) / TTM(t−4)`.
- **H4:** origins t = s+8 to L−4; actual = R(t+1) + … + R(t+4); the target label is t+4.
  backlog `B(t) × mean of r(t−4), r(t−5), r(t−6), r(t−7)`; naive `TTM(t)`; naive_drift `TTM(t)² / TTM(t−4)`.
- Every input of a forecast is known at its origin. A forecast with a blank input is skipped.
- APE = |actual − forecast| / actual × 100. Signed error = (forecast − actual) / actual × 100.

## Bridge

Take each year Y with (Y−2)Q4 at or after START and YQ4 at or before 2026Q2. Rev(Y) is R over Y's four quarters, BS(Y) is B at (Y−1)Q4, and conv(Y) = Rev(Y) / BS(Y).

- backlog effect = [BS(Y) − BS(Y−1)] × conv(Y−1)
- conversion effect = BS(Y−1) × [conv(Y) − conv(Y−1)]
- interaction = [BS(Y) − BS(Y−1)] × [conv(Y) − conv(Y−1)]
- residual = [Rev(Y) − Rev(Y−1)] − the three effects, within 1 USD.

## Sensitivity

base = the mean of r(L−4) to r(L−7). Forward four-quarter revenue = B(L) × (1 + shock/100) × (base + shift/100), for shock in −10, −5, 0, 5, 10 and shift in −3, −1.5, 0, 1.5, 3 percentage points of r.

## Outputs

Exact columns, floats at full precision.

| File | Columns | Rows with no gaps |
|---|---|---|
| `results/backtest.csv` | `ticker,horizon,origin,target,model,forecast_usd,actual_usd,ape_pct`; `horizon` is H1 or H4, `model` is backlog, naive or naive_drift | 3 × (106 + 91) = 591 |
| `results/bridge.csv` | `ticker,year,revenue_prior_usd,revenue_usd,backlog_start_prior_usd,backlog_start_usd,conversion_prior,conversion,backlog_effect_usd,conversion_effect_usd,interaction_usd,residual_usd` | 26 |
| `results/sensitivity.csv` | `ticker,backlog_shock_pct,conversion_shift_pp,forward_revenue_usd` | 125 |

`results/metrics.json` reads `{"as_of": "2026-10-13", "n": {"H1": …, "H4": …}, "mape": {horizon: {model: {"ALL": …, ticker: …}}}, "bias": …, "win_rate_vs_naive": {horizon: {"ALL": …, ticker: …}}}`, with `bias` in the shape of `mape`. `n` counts backlog forecasts. MAPE is the mean APE, and ALL pools every forecast. Bias is the mean signed error. Win rate is the percent of origins where the backlog APE sits strictly below the naive APE. An empty group is `null`.
