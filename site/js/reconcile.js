/* Reconciliation. Each check recomputes a figure the charts or KPIs show from the rows in
   the granular table, in whole cents, and compares. A check passes only at a difference of
   exactly $0.00 (or, for the error rates, under 1e-9 percentage points). */

import { MODELS } from "./copy.js";
import { cents } from "./format.js";
import { ape, inPeriod, summarize, forecastsFor } from "./model.js";

function check(id, name, unit) {
  return { id, name, unit, n: 0, maxDiff: 0, failures: [] };
}

function compare(c, diff, what, tol = 0) {
  c.n++;
  const d = Math.abs(diff);
  if (d > c.maxDiff) c.maxDiff = d;
  if (d > tol) c.failures.push(what);
}

// Compare a published figure with its recomputation; both missing is a match, one missing a failure.
function same(c, pub, got, what, tol) {
  if (pub == null && got == null) return;
  compare(c, pub == null || got == null ? Infinity : got - pub, what, tol);
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Run every check for the companies in scope, the horizon and the period shown.
 * Returns an array of { id, name, unit, n, maxDiff, failures }.
 */
export function reconcile(model, tickers, period, view) {
  const ttm = check("ttm", "Trailing four-quarter revenue charted = sum of its four quarterly revenue rows", "cents");
  const annual = check("annual", "Bridge annual revenue = sum of that year's quarterly revenue rows", "cents");
  const steps = check("steps", "Bridge effects recomputed from the backlog and revenue rows, and prior-year revenue + backlog + conversion + overlap = current-year revenue", "cents");
  const bookings = check("bookings", "Implied bookings = change in backlog + quarterly revenue, and book-to-bill = bookings ÷ revenue", "cents");
  const actual = check("actual", "Forecast actuals = quarterly revenue rows (one quarter, or the sum of four)", "cents");
  const scenario = check("scenario", "What-if scenarios recomputed from the latest backlog and the typical conversion rate", "cents");
  const kpi = check("kpi", "KPI and scorecard miss, bias and win count = the forecast rows in this period, recomputed from forecast and actual", "pp");
  const metrics = check("metrics", "Average miss, bias, win rate and count recomputed from the forecast rows = published results", "pp");

  tickers.forEach((t) => {
    const rows = model.byTicker[t].quarters;
    const rev = new Map(rows.map((r) => [r.quarter, r.revenue]));
    const idx = new Map(rows.map((r, i) => [r.quarter, i]));
    const sumC = (from, n) => {
      let s = 0;
      for (let k = from; k < from + n; k++) {
        if (!rows[k] || rows[k].revenue == null) return null;
        s += cents(rows[k].revenue);
      }
      return s;
    };
    // The same sum in dollars, for a ratio: null when any quarter is missing.
    const sum = (from, n) => {
      let s = 0;
      for (let k = from; k < from + n; k++) {
        if (!rows[k] || rows[k].revenue == null) return null;
        s += rows[k].revenue;
      }
      return s;
    };

    rows.forEach((r, i) => {
      if (!inPeriod(r.year, period)) return;
      if (r.ttm != null) {
        const s = sumC(i - 3, 4);
        compare(ttm, s == null ? Infinity : cents(r.ttm) - s, `${t} ${r.quarter}`);
      }
      const p = rows[i - 1];
      const b = p && r.backlog != null && p.backlog != null && r.revenue != null ? r.backlog - p.backlog + r.revenue : null;
      same(bookings, r.bookings == null ? null : cents(r.bookings), b == null ? null : cents(b), `${t} ${r.quarter} bookings`, 0);
      // A ratio, so compared as a fraction rather than in cents.
      same(bookings, r.btb, b == null || !r.revenue ? null : b / r.revenue, `${t} ${r.quarter} book-to-bill`, 1e-12);
    });

    model.bridgeRows.filter((b) => b.ticker === t && inPeriod(b.year, period)).forEach((b) => {
      [[b.year, b.c.current], [b.year - 1, b.c.prior]].forEach(([y, v]) => {
        const i = idx.get(y + "Q1");
        const s = i == null ? null : sumC(i, 4);
        compare(annual, s == null ? Infinity : v - s, `${t} ${y}`);
      });
      // Starting backlog is the prior year's Q4; conversion is the year's revenue over it.
      const i0 = idx.get(b.year - 2 + "Q4"), i1 = idx.get(b.year - 1 + "Q4");
      const b0 = i0 == null ? null : rows[i0].backlog, b1 = i1 == null ? null : rows[i1].backlog;
      const r0 = idx.has(b.year - 1 + "Q1") ? sum(idx.get(b.year - 1 + "Q1"), 4) : null;
      const r1 = idx.has(b.year + "Q1") ? sum(idx.get(b.year + "Q1"), 4) : null;
      if ([b0, b1, r0, r1].some((x) => x == null)) {
        compare(steps, Infinity, `${t} ${b.year} inputs`);
      } else {
        const c0 = r0 / b0, c1 = r1 / b1;
        compare(steps, cents((b1 - b0) * c0) - b.c.backlog, `${t} ${b.year} backlog effect`);
        compare(steps, cents(b0 * (c1 - c0)) - b.c.conv, `${t} ${b.year} conversion effect`);
        compare(steps, cents((b1 - b0) * (c1 - c0)) - b.c.overlapRaw, `${t} ${b.year} overlap`);
      }
      // The identity in dollars, from the model's own effects rather than the plug.
      compare(steps, cents(b.current - b.prior - b.backlogEffect - b.convEffect - b.interaction), `${t} ${b.year} steps`);
      // The plug the chart draws may move the model's own overlap by rounding only: at most one cent.
      compare(steps, Math.max(0, Math.abs(b.c.overlap - b.c.overlapRaw) - 1), `${t} ${b.year} overlap rounding`);
    });

    model.forecastRows.filter((f) => f.ticker === t && f.model === "naive" && inPeriod(f.year, period)).forEach((f) => {
      const j = idx.get(f.target);
      const s = j == null ? null : f.horizon === "h1" ? cents(rev.get(f.target)) : sumC(j - 3, 4);
      compare(actual, s == null ? Infinity : cents(f.actual) - s, `${t} ${f.horizon.toUpperCase()} ${f.target}`);
    });

    // The typical four-quarter conversion: revenue over the next four quarters ÷ backlog,
    // averaged over the origins four to seven quarters before the latest.
    const S = model.sens[t], L = rows.length - 1;
    const conv4 = (k) => (k < 0 || k + 4 > L || rows[k].backlog == null || !rows[k].backlog ? null : sum(k + 1, 4) == null ? null : sum(k + 1, 4) / rows[k].backlog);
    const cs = [4, 5, 6, 7].map((k) => conv4(L - k));
    const base = cs.some((x) => x == null) ? null : mean(cs);
    S.shocks.forEach((s) => S.shifts.forEach((f) => {
      const want = base == null || rows[L].backlog == null ? null : rows[L].backlog * (1 + s / 100) * (base + f / 100);
      const got = S.cell(s, f);
      same(scenario, got == null ? null : cents(got), want == null ? null : cents(want), `${t} ${s}% ${f} pp`, 0);
    }));
  });

  const groups = ["ALL", ...tickers];

  // The KPIs and scorecard: every forecast in the period, with APE and bias worked again
  // from the Forecast and Actual columns, against the shared summary they are drawn from.
  const fc = forecastsFor(model, view, period);
  const s = summarize(fc, view + "|" + period.from + "|" + period.to);
  groups.forEach((g) => {
    MODELS.forEach((m) => {
      const sel = fc.filter((r) => r.model === m && (g === "ALL" || r.ticker === g));
      const got = (f) => (sel.length ? mean(sel.map(f)) : null);
      same(kpi, s.mape[m] ? s.mape[m][g] : null, got((r) => ape(r.forecast, r.actual)), `${view} ${m} ${g} average miss`, 1e-9);
      same(kpi, s.bias[m] ? s.bias[m][g] : null, got((r) => (r.forecast - r.actual) / r.actual * 100), `${view} ${m} ${g} bias`, 1e-9);
    });
    const naive = new Map(fc.filter((r) => r.model === "naive").map((r) => [r.ticker + r.origin, r]));
    const scored = fc.filter((r) => r.model === "backlog" && (g === "ALL" || r.ticker === g) && naive.has(r.ticker + r.origin));
    const wins = scored.filter((r) => ape(r.forecast, r.actual) < ape(naive.get(r.ticker + r.origin).forecast, r.actual)).length;
    same(kpi, s.win[g] ? s.win[g].wins : null, scored.length ? wins : null, `${view} ${g} wins`, 0);
  });

  // The published results cover the full sample, so this one ignores the period.
  ["h1", "h4"].forEach((h) => {
    const H = h.toUpperCase();
    const all = summarize(model.forecastRows.filter((r) => r.horizon === h), "recon|" + h);
    groups.forEach((g) => {
      MODELS.forEach((m) => {
        same(metrics, model.metrics.mape[H][m][g], all.mape[m] ? all.mape[m][g] : null, `${H} ${m} ${g} average miss`, 1e-9);
        same(metrics, model.metrics.bias[H][m][g], all.bias[m] ? all.bias[m][g] : null, `${H} ${m} ${g} bias`, 1e-9);
      });
      same(metrics, model.metrics.win_rate_vs_naive[H][g], all.win[g] ? all.win[g].rate : null, `${H} ${g} win rate`, 1e-9);
    });
    compare(metrics, (all.n.backlog ? all.n.backlog.ALL : 0) - model.metrics.n[H], `${H} forecast count`);
  });

  const out = [ttm, annual, steps, bookings, actual, scenario, kpi, metrics];
  out.forEach((c) => { if (c.failures.length && window.console) console.error("Reconciliation failed:", c.name, c.failures); });
  return out;
}
