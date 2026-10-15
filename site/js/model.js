/* Data model. data.json is flattened once into row arrays, and the KPIs, charts and table
   only read these, so a chart and the table under it can't disagree.

   quarterRows   company × quarter (reported backlog and revenue)
   forecastRows  company × horizon × origin × model (the backtest)
   bridgeRows    company × year (revenue bridge, also in cents)
   sens          what-if grid per company */

import { MODELS } from "./copy.js";
import { cents } from "./format.js";

const yearOf = (q) => +q.slice(0, 4);
const qIndex = (q) => yearOf(q) * 4 + +q.slice(5) - 1;

export function buildModel(data) {
  const tickers = Object.keys(data.companies);
  const quarterRows = [], forecastRows = [], bridgeRows = [], sens = {}, byTicker = {};

  tickers.forEach((t) => {
    const co = data.companies[t];
    const rows = co.quarters.map((q, i) => ({
      ticker: t, quarter: q, year: yearOf(q), qi: qIndex(q),
      periodEnd: co.period_end ? co.period_end[i] : null,
      backlog: co.backlog_usd[i], revenue: co.revenue_usd[i],
      ttm: co.ttm_revenue_usd[i], bookings: co.implied_bookings_usd[i], btb: co.book_to_bill[i],
      method: co.revenue_method ? co.revenue_method[i] : null,
      backlogAccn: co.backlog_accn ? co.backlog_accn[i] : null,
      revenueAccn: co.revenue_accn ? co.revenue_accn[i] : null,
      cik: co.cik || null
    }));
    rows.forEach((r) => { r.key = [r.ticker, r.quarter, r.periodEnd, r.backlogAccn, r.revenueAccn].join(" ").toLowerCase(); });
    quarterRows.push(...rows);

    ["h1", "h4"].forEach((h) => {
      const b = co[h];
      b.origin.forEach((o, i) => {
        const actual = b.actual_usd[i];
        const apes = {};
        MODELS.forEach((m) => { apes[m] = ape(b[m][i], actual); });
        MODELS.forEach((m) => {
          const f = b[m][i];
          if (f == null) return;
          forecastRows.push({
            ticker: t, horizon: h, origin: o, target: b.target[i], year: yearOf(b.target[i]), model: m,
            forecast: f, actual, error: f - actual, ape: apes[m], naiveApe: apes.naive,
            beatsNaive: m === "backlog" && apes.naive != null ? apes.backlog < apes.naive : null,
            key: [t, h, o, b.target[i], m].join(" ").toLowerCase()
          });
        });
      });
    });

    co.bridge.forEach((r) => {
      // In whole cents, with the overlap as the plug, so the steps add to the change exactly.
      const c = { prior: cents(r.revenue_prior_usd), current: cents(r.revenue_usd),
        backlog: cents(r.backlog_effect_usd), conv: cents(r.conversion_effect_usd), overlapRaw: cents(r.interaction_usd) };
      c.overlap = c.current - c.prior - c.backlog - c.conv;
      bridgeRows.push({ ticker: t, year: r.year, prior: r.revenue_prior_usd, current: r.revenue_usd,
        backlogEffect: r.backlog_effect_usd, convEffect: r.conversion_effect_usd, interaction: r.interaction_usd,
        residual: r.residual_usd, convPrior: r.conversion_prior, conv: r.conversion,
        backlogStartPrior: r.backlog_start_prior_usd, backlogStart: r.backlog_start_usd, c });
    });

    const shocks = [...new Set(co.sensitivity.map((r) => r.backlog_shock_pct))].sort((a, b) => a - b);
    const shifts = [...new Set(co.sensitivity.map((r) => r.conversion_shift_pp))].sort((a, b) => a - b);
    const grid = new Map(co.sensitivity.map((r) => [r.backlog_shock_pct + "|" + r.conversion_shift_pp, r.forward_revenue_usd]));
    sens[t] = { shocks, shifts, cell: (s, f) => (grid.has(s + "|" + f) ? grid.get(s + "|" + f) : null) };

    byTicker[t] = { quarters: rows };
  });

  const years = quarterRows.map((r) => r.year);
  return Object.freeze({
    asOf: data.as_of, labels: data.labels || {}, metrics: data.metrics, tickers,
    quarterRows: Object.freeze(quarterRows), forecastRows: Object.freeze(forecastRows),
    bridgeRows: Object.freeze(bridgeRows), sens, byTicker,
    minYear: Math.min(...years), maxYear: Math.max(...years)
  });
}

export function ape(f, a) { return f == null || a == null || a === 0 ? null : Math.abs(a - f) / a * 100; }

export const inPeriod = (year, p) => year >= p.from && year <= p.to;

/** A company's quarters within the period, oldest first. */
export function quartersFor(model, t, period) {
  return model.byTicker[t].quarters.filter((r) => inPeriod(r.year, period));
}

/** The latest quarter in the period for a company, and the rows one and four quarters before it. */
export function latest(model, t, period) {
  const all = model.byTicker[t].quarters;
  let i = all.length - 1;
  while (i >= 0 && all[i].year > period.to) i--;
  if (i < 0 || all[i].year < period.from) return null;
  return { row: all[i], prev: all[i - 1] || null, yearAgo: all[i - 4] || null, all, i };
}

/* Error stats over a set of forecast rows, by model and company. The KPIs, scorecard and
   table footer all use this, so they agree under any filter. */
const memo = new Map();
export function summarize(rows, memoKey) {
  if (memoKey && memo.has(memoKey)) return memo.get(memoKey);
  const out = { mape: {}, bias: {}, n: {}, win: {} };
  const add = (bag, m, g, v) => {
    bag[m] = bag[m] || {};
    const cell = bag[m][g] = bag[m][g] || { sum: 0, n: 0 };
    cell.sum += v; cell.n++;
  };
  const apeSum = {}, biasSum = {}, wins = {};
  rows.forEach((r) => {
    [r.ticker, "ALL"].forEach((g) => {
      add(apeSum, r.model, g, r.ape);
      add(biasSum, r.model, g, r.error / r.actual * 100);
      if (r.beatsNaive != null) {
        const w = wins[g] = wins[g] || { wins: 0, n: 0 };
        w.n++; if (r.beatsNaive) w.wins++;
      }
    });
  });
  MODELS.forEach((m) => {
    out.mape[m] = {}; out.bias[m] = {}; out.n[m] = {};
    Object.entries(apeSum[m] || {}).forEach(([g, c]) => {
      out.mape[m][g] = c.sum / c.n;
      out.n[m][g] = c.n;
      out.bias[m][g] = biasSum[m][g].sum / biasSum[m][g].n;
    });
  });
  Object.entries(wins).forEach(([g, w]) => { out.win[g] = { wins: w.wins, n: w.n, rate: w.wins / w.n * 100 }; });
  if (memoKey) memo.set(memoKey, out);
  return out;
}

/** Forecast rows for one horizon within the period. */
export function forecastsFor(model, view, period) {
  return model.forecastRows.filter((r) => r.horizon === view && inPeriod(r.year, period));
}

/* Same stats on the origins the backlog model also scores. The baselines don't need backlog,
   so they score extra origins; this keeps model comparisons like for like. The published
   results keep every origin. */
export function sharedSummary(rows, memoKey) {
  const scored = new Set(rows.filter((r) => r.model === "backlog").map((r) => r.ticker + "|" + r.horizon + "|" + r.origin));
  return summarize(rows.filter((r) => scored.has(r.ticker + "|" + r.horizon + "|" + r.origin)), memoKey);
}
