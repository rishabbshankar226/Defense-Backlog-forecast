/* Every label and definition on the page. None of it
   holds a figure: every number is built from data.json at load. */

export const COMPANY = {
  HII: "Huntington Ingalls Industries",
  LHX: "L3Harris Technologies",
  LMT: "Lockheed Martin",
  NOC: "Northrop Grumman",
  RTX: "RTX"
};

export const MODELS = ["backlog", "naive", "naive_drift"];

export const NAMES = {
  h1: { backlog: "Backlog model", naive: "Seasonal naive", naive_drift: "Seasonal naive with drift" },
  h4: { backlog: "Backlog model", naive: "Trailing 4Q", naive_drift: "Trailing 4Q with drift" }
};

export const HORIZON = { h1: "Next quarter", h4: "Next four quarters" };

export const PHRASE = {
  backlog: "the backlog model",
  naive: "repeating the last four quarters' revenue",
  naive_drift: "repeating the last four quarters' revenue grown at its recent rate"
};

/* The basis of a figure, shown as a small tag beside it. */
export const BASIS = { gaap: "GAAP", derived: "Derived", model: "Model" };

export const HELP = {
  rpo: { ask: "What is backlog?", terms: [["Backlog (RPO)", "Remaining performance obligations: the value of work a company is under contract to deliver but has not yet recognised as revenue. It is taken from each filing as first reported."]] },
  revenue: { ask: "What revenue is shown?", terms: [["Revenue (GAAP)", "Total revenues or net sales as reported in each 10-Q or 10-K, as first reported. Q4 is the full year less the first nine months."]] },
  mape: { ask: "What is the average forecast miss?", terms: [["Average forecast miss (MAPE)", "The average size of each forecast's miss as a share of actual revenue. It ignores whether a forecast was too high or too low."]] },
  winrate: { ask: "What is the win rate?", terms: [["Win rate", "The share of forecasts where the backlog model missed by less than the naive baseline made at the same origin. 50% is a coin flip."]] },
  bias: { ask: "What is bias?", terms: [["Bias (mean signed error)", "The average of forecast less actual, as a share of actual. Positive means the model forecast too high. It is shown without colour, since neither direction is good in itself."]] },
  coverage: { ask: "What is backlog coverage?", terms: [["Backlog coverage", "Backlog divided by revenue over the trailing four quarters: roughly how many years of signed work are on the books at the current pace."]] },
  model: { ask: "What is the backlog model?", terms: [["Backlog model", "Multiplies the latest backlog by the share of backlog that turned into revenue in comparable periods one to two years earlier."]] },
  trailing: { ask: "What is trailing 4Q?", terms: [["Trailing 4Q", "Assumes the next four quarters bring the same revenue as the last four."]] },
  trailing_drift: { ask: "What is trailing 4Q with drift?", terms: [["Trailing 4Q with drift", "The last four quarters' revenue, grown at the rate it grew over the year before."]] },
  seasonal: { ask: "What is seasonal naive?", terms: [["Seasonal naive", "Assumes next quarter's revenue matches the same quarter a year earlier."]] },
  seasonal_drift: { ask: "What is seasonal naive with drift?", terms: [["Seasonal naive with drift", "The same quarter a year earlier, grown at the rate trailing revenue grew over the past year."]] },
  bridge: { ask: "What are conversion rate and overlap?", terms: [
    ["Annual conversion rate", "The share of the backlog at the start of a year that became revenue during that year."],
    ["Overlap (interaction)", "The part of the change that comes from backlog and conversion moving at the same time, so the three effects add up exactly. Shown to the cent, it absorbs any rounding."]] },
  shock: { ask: "What is a change in backlog?", terms: [["Change in backlog", "A hypothetical rise or fall in today's backlog, as a percentage of it."]] },
  shift: { ask: "What is a change in conversion rate?", terms: [["Change in conversion rate (pp)", "A hypothetical change to the four-quarter conversion rate, in percentage points: an absolute change in the rate, not a percentage of it."]] },
  conv4: { ask: "What is the four-quarter conversion rate?", terms: [["Four-quarter conversion rate", "Revenue over the next four quarters divided by the backlog at their start. The scenario starts from its average over the four origins one to two years before the latest quarter, the rate the backlog model uses."]] },
  btb: { ask: "What is implied book-to-bill?", terms: [
    ["Implied book-to-bill", "Orders implied by the filings, divided by the quarter's revenue. The implied orders are the change in backlog plus the quarter's revenue, so above 1 means backlog grew that quarter."],
    ["A residual, not an orders figure", "The implied orders also absorb cancellations, currency moves and acquisitions, so a single quarter can jump."]] },
  recon: { ask: "What does reconciliation check?", terms: [["Reconciliation", "Each chart total is recomputed in whole cents from the rows in this table and compared. Any difference above $0.00 fails the check and is listed."]] },
  colour: { ask: "What do red and green mean?", terms: [["Red and green", "Green marks a favourable variance and red an unfavourable one, always with ▲ or ▼ and a sign. Lines and bars that only identify a series are never red or green."]] }
};

export const APE_NOTE = ["Variance:", "forecast less actual revenue. As a share of actual, its size is the miss (APE)."];

/** Which definition sits beside each legend entry. */
export function keyHelp(chart, view, key) {
  if (chart === "backlog") return key === "backlog" ? "rpo" : key === "ttm" ? "revenue" : null;
  if (key === "backlog") return "model";
  if (key === "naive") return view === "h1" ? "seasonal" : "trailing";
  if (key === "naive_drift") return view === "h1" ? "seasonal_drift" : "trailing_drift";
  return null;
}
