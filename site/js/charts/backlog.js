/* Backlog against trailing four-quarter revenue, by quarter, for the selected company. */

import { $ } from "../dom.js";
import { usdB, usdM, signedPct, longDate, shown } from "../format.js";
import { COMPANY } from "../copy.js";
import { quartersFor } from "../model.js";
import { baseOptions, linked, lineSet, upsert, renderLegend, describe } from "./base.js";

const toB = (v) => (v == null ? null : v / 1e9);

export function renderBacklog(model, st, c, period) {
  const t = st.ticker, rows = quartersFor(model, t, period);
  if (!rows.length) return { empty: `No quarters for ${COMPANY[t]} in ${period.from}–${period.to}.` };

  const labels = rows.map((r) => r.quarter);
  // From zero for every company, so the gap between the lines shows backlog against revenue
  // at its true scale (the coverage KPI), not against wherever the axis happened to start.
  const opts = linked(baseOptions(c, "US$ billions · GAAP", "Fiscal quarter"));
  opts.scales.y.beginAtZero = true;
  const ch = upsert("c-backlog", {
    type: "line",
    data: {
      labels,
      datasets: [
        lineSet(c, "Backlog (RPO), quarter end", rows.map((r) => toB(r.backlog)), c.backlog, 2.25, "backlog"),
        lineSet(c, "Revenue, trailing four quarters", rows.map((r) => toB(r.ttm)), c.ttm, 2.25, "ttm")
      ]
    },
    options: opts
  }, {
    $colors: c,
    $crosshair: true,
    $ends: true,
    // Each figure against the same quarter a year earlier, whichever period is shown.
    $tip: (pts) => {
      const r = rows[pts[0].dataIndex], all = model.byTicker[t].quarters, y = all[all.indexOf(r) - 4];
      return {
        title: r.quarter + (r.periodEnd ? " · quarter ended " + longDate(r.periodEnd) : ""),
        cols: ["", "US$B", "US$M", "vs year ago"],
        rows: pts.map((p) => {
          const k = p.dataset.key, v = r[k], was = y ? y[k] : null;
          const g = v == null || was == null || !was ? null : (v / was - 1) * 100;
          const s = shown(g);  // judged as printed, so "+0.0%" is never coloured
          return { color: p.dataset.$color, label: p.dataset.label, value: usdB(v), extra: usdM(v),
            change: g == null ? "" : (s > 0 ? "▲ " : s < 0 ? "▼ " : "") + signedPct(g), tone: s > 0 ? "fav" : s < 0 ? "unfav" : null };
        })
      };
    }
  });
  renderLegend("lg-backlog", ch, "backlog", st.view, { backlog: "GAAP", ttm: "GAAP" });

  const last = rows[rows.length - 1];
  const gaps = rows.filter((r) => r.backlog == null).map((r) => r.quarter);
  describe("c-backlog", `${t} backlog and trailing four-quarter revenue by quarter. At ${last.quarter}, backlog was ` +
    `${usdB(last.backlog)} and trailing revenue ${usdB(last.ttm)}.`);
  $("backlog-note").textContent = "US$ billions at each quarter end. Backlog is remaining performance obligations; " +
    "revenue is the GAAP total over the trailing four quarters." +
    (gaps.length ? " Breaks in the backlog line are quarters whose filings tag no backlog for the quarter's own end: " + gaps.join(", ") + "." : "");
  return null;
}
