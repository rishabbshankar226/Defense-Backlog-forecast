/* Reconciliation. Each check recomputes a figure the charts or KPIs show from the rows in
   the granular table, in whole cents, and compares. A check passes only at a difference of
   exactly $0.00 (or, for the error rates, under 1e-9 percentage points). */

import { MODELS } from "./copy.js";
import { cents } from "./format.js";
import { inPeriod, summarize } from "./model.js";

function check(id, name, unit) {
  return { id, name, unit, n: 0, maxDiff: 0, failures: [] };
}

function compare(c, diff, what, tol = 0) {
  c.n++;
  const d = Math.abs(diff);
  if (d > c.maxDiff) c.maxDiff = d;
  if (d > tol) c.failures.push(what);
}

/**
 * Run every check for the companies in scope and the period shown.
 * Returns an array of { id, name, unit, n, maxDiff, failures }.
 */
export function reconcile(model, tickers, period) {
  const ttm = check("ttm", "Trailing four-quarter revenue charted = sum of its four quarterly revenue rows", "cents");
  const annual = check("annual", "Bridge annual revenue = sum of that year's quarterly revenue rows", "cents");
  const steps = check("steps", "Bridge: prior-year revenue + backlog + conversion + overlap = current-year revenue", "cents");
  const actual = check("actual", "Forecast actuals = quarterly revenue rows (one quarter, or the sum of four)", "cents");
  const metrics = check("metrics", "Average miss and win rate recomputed from the forecast rows = published results", "pp");

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

    rows.forEach((r, i) => {
      if (r.ttm == null || !inPeriod(r.year, period)) return;
      const s = sumC(i - 3, 4);
      compare(ttm, s == null ? Infinity : cents(r.ttm) - s, `${t} ${r.quarter}`);
    });

    model.bridgeRows.filter((b) => b.ticker === t && inPeriod(b.year, period)).forEach((b) => {
      [[b.year, b.c.current], [b.year - 1, b.c.prior]].forEach(([y, v]) => {
        const i = idx.get(y + "Q1");
        const s = i == null ? null : sumC(i, 4);
        compare(annual, s == null ? Infinity : v - s, `${t} ${y}`);
      });
      compare(steps, b.c.prior + b.c.backlog + b.c.conv + b.c.overlap - b.c.current, `${t} ${b.year}`);
      // The overlap plug may move the model's own overlap by rounding only: at most one cent.
      compare(steps, Math.max(0, Math.abs(b.c.overlap - b.c.overlapRaw) - 1), `${t} ${b.year} overlap rounding`);
    });

    model.forecastRows.filter((f) => f.ticker === t && f.model === "naive" && inPeriod(f.year, period)).forEach((f) => {
      const j = idx.get(f.target);
      const s = j == null ? null : f.horizon === "h1" ? cents(rev.get(f.target)) : sumC(j - 3, 4);
      compare(actual, s == null ? Infinity : cents(f.actual) - s, `${t} ${f.horizon.toUpperCase()} ${f.target}`);
    });
  });

  // The published results cover the full sample, so this one ignores the period.
  const groups = tickers.length > 1 ? ["ALL", ...tickers] : tickers;
  ["h1", "h4"].forEach((h) => {
    const H = h.toUpperCase();
    const s = summarize(model.forecastRows.filter((r) => r.horizon === h), "recon|" + h);
    groups.forEach((g) => {
      MODELS.forEach((m) => {
        const pub = model.metrics.mape[H][m][g], got = s.mape[m] ? s.mape[m][g] : undefined;
        if (pub == null && got == null) return;
        compare(metrics, got == null || pub == null ? Infinity : got - pub, `${H} ${m} ${g} average miss`, 1e-9);
      });
      const pub = model.metrics.win_rate_vs_naive[H][g], got = s.win[g] ? s.win[g].rate : null;
      if (pub != null || got != null) compare(metrics, got == null || pub == null ? Infinity : got - pub, `${H} ${g} win rate`, 1e-9);
    });
    if (groups[0] === "ALL") compare(metrics, (s.win.ALL ? s.win.ALL.n : 0) - model.metrics.n[H], `${H} forecast count`);
  });

  const all = [ttm, annual, steps, actual, metrics];
  all.forEach((c) => { if (c.failures.length && window.console) console.error("Reconciliation failed:", c.name, c.failures); });
  return all;
}
