/* The executive summary: the finding in one sentence, the KPI cards and the scorecard.

   Every KPI card shows: what it is, its basis (GAAP / Derived / Model), its unit and scale,
   the current value, the baseline it is compared with, and the variance. Variance colour
   follows one rule: green is favourable and red unfavourable, always with ▲/▼ and a sign. */

import { $, el, esc } from "./dom.js";
import { usdB, pct, pp, signedPct, times, signedTimes, longDate } from "./format.js";
import { COMPANY, MODELS, NAMES, PHRASE, HORIZON, BASIS } from "./copy.js";
import { forecastsFor, summarize, latest } from "./model.js";
import { infoButton } from "./help.js";
import * as store from "./state.js";

/** Favourable, unfavourable or neutral, from a difference and which way is good. */
function tone(d, higherIsBetter) {
  if (d == null || d === 0 || higherIsBetter == null) return "neutral";
  return (d > 0) === higherIsBetter ? "fav" : "unfav";
}

function card({ id, label, basis, unit, value, cmp, delta, deltaText, good, help, note }) {
  const t = tone(delta, good);
  const a = el("article", "kpi");
  a.id = id;
  a.dataset.tone = t;
  const head = el("div", "kpi-head");
  head.appendChild(el("h3", "kpi-label", label));
  if (help) head.appendChild(infoButton(help));
  head.appendChild(el("span", "tag", basis));
  a.appendChild(head);
  a.appendChild(el("p", "kpi-unit", unit));
  a.appendChild(el("p", "kpi-val", value));
  const foot = el("div", "kpi-foot");
  foot.appendChild(el("p", "kpi-cmp", cmp));
  if (deltaText) {
    const d = el("p", "kpi-delta " + t);
    if (t !== "neutral") d.appendChild(el("span", "glyph", delta > 0 ? "▲" : "▼"));
    d.appendChild(document.createTextNode(deltaText));
    if (t !== "neutral") d.appendChild(el("span", "sr-only", t === "fav" ? " (favourable)" : " (unfavourable)"));
    foot.appendChild(d);
  }
  a.appendChild(foot);
  if (note) a.appendChild(el("p", "kpi-note", note));
  return a;
}

/** The finding, built from the full-sample results. The sentence is kept word for word. */
export function renderHeadline(model) {
  const m = model.metrics, h4 = m.mape.H4, tickers = model.tickers;
  const best = MODELS.slice().sort((a, b) => h4[a].ALL - h4[b].ALL)[0];
  const head = $("headline");
  head.textContent = "";
  const parts = ["Over the next four quarters, " + PHRASE[best] + " missed actual revenue by ",
    ["num", pct(h4[best].ALL)], " on average, the lowest of three models"];
  if (best === "backlog") parts.push(".");
  else parts.push(", while the backlog model missed by ", ["num", pct(h4.backlog.ALL)], ".");
  parts.forEach((p) => head.appendChild(typeof p === "string" ? document.createTextNode(p) : el("strong", p[0], p[1])));
  const against = tickers.filter((t) => {
    const b = m.mape.H4.backlog[t], n = m.mape.H4.naive[t];
    return b != null && n != null && (best === "backlog" ? b > n : b < n);
  }).map((t) => COMPANY[t] || t);
  $("bottom-line").textContent = (best === "backlog"
    ? "In short: across the five companies taken together, backlog was a better guide to the next year's revenue than last year's revenue."
    : "In short: across the five companies taken together, last year's revenue was a better guide to the next year's than backlog.") +
    (against.length ? " " + (against.length > 1 ? against.slice(0, -1).join(", ") + " and " + against[against.length - 1] + " were the exceptions."
      : against[0] + " was the exception.") : "");
  const when = el("time", "", longDate(model.asOf));
  when.dateTime = model.asOf;
  const asof = $("asof");
  asof.textContent = "Data as of ";
  asof.appendChild(when);
}

export function renderKpis(model, st, period) {
  const v = st.view, H = NAMES[v], t = st.ticker;
  const rows = forecastsFor(model, v, period);
  const key = v + "|" + period.from + "|" + period.to;
  const s = summarize(rows, key);
  const span = period.from === period.to ? String(period.from) : period.from + "–" + period.to;

  /* ----- A: all five companies ----- */
  const pool = $("kpis-pool");
  pool.textContent = "";
  $("kpis-pool-title").textContent = `All five companies · ${HORIZON[v]} · forecast targets ${span}`;
  const mb = s.mape.backlog && s.mape.backlog.ALL, mn = s.mape.naive && s.mape.naive.ALL;
  const nb = s.n.backlog && s.n.backlog.ALL;
  pool.appendChild(card({
    id: "kpi-mape", label: "Backlog-model forecast miss", basis: BASIS.model, help: "mape",
    unit: `MAPE, % of actual GAAP revenue · ${nb || 0} forecasts`,
    value: pct(mb), cmp: `vs ${H.naive} ${pct(mn)}`,
    delta: mb != null && mn != null ? mb - mn : null, deltaText: mb != null && mn != null ? pp(mb - mn) + (mb > mn ? " worse" : mb < mn ? " better" : "") : "",
    good: false
  }));
  const w = s.win.ALL;
  pool.appendChild(card({
    id: "kpi-win", label: `Win rate vs ${H.naive}`, basis: BASIS.model, help: "winrate",
    unit: w ? `% of forecasts · ${w.wins} of ${w.n} closer` : "% of forecasts",
    value: w ? pct(w.rate) : "n/a", cmp: "vs 50.0% coin flip",
    delta: w ? w.rate - 50 : null, deltaText: w ? pp(w.rate - 50) : "", good: true
  }));
  const bb = s.bias.backlog && s.bias.backlog.ALL, bn = s.bias.naive && s.bias.naive.ALL;
  pool.appendChild(card({
    id: "kpi-bias", label: "Backlog-model bias", basis: BASIS.model, help: "bias",
    unit: "Mean signed error, % of actual · + = too high",
    value: signedPct(bb), cmp: `vs ${H.naive} ${signedPct(bn)}`, delta: null,
    deltaText: bb == null ? "" : bb > 0 ? "Over-forecast" : bb < 0 ? "Under-forecast" : "", good: null
  }));

  // Coverage of the sample: the backlog model needs tagged backlog, so it scores fewer
  // origins than the baseline. Shown without colour; it is a completeness figure.
  const nn = (s.n.naive && s.n.naive.ALL) || 0;
  pool.appendChild(card({
    id: "kpi-n", label: "Forecasts scored", basis: BASIS.model,
    unit: "Backlog-model forecasts, count",
    value: String(nb || 0), cmp: `vs ${H.naive} ${nn}`, delta: null,
    deltaText: !nn ? "No forecasts in this period" : nn > (nb || 0) ? `${nn - (nb || 0)} origins lack tagged backlog` : "Same origins scored", good: null
  }));

  /* ----- B: the selected company ----- */
  const co = $("kpis-co");
  co.textContent = "";
  const L = latest(model, t, period);
  if (!L) {
    $("kpis-co-title").textContent = `${COMPANY[t]} (${t})`;
    co.appendChild(el("p", "kpi-empty", `No quarters for ${COMPANY[t]} in ${span}.`));
    return;
  }
  const r = L.row, y = L.yearAgo, q = L.prev;
  $("kpis-co-title").textContent = `${COMPANY[t]} (${t}) · ${r.quarter}, latest quarter in period`;
  const growth = (a, b) => (a == null || b == null || !b ? null : (a / b - 1) * 100);
  const bY = growth(r.backlog, y && y.backlog), bQ = growth(r.backlog, q && q.backlog);
  co.appendChild(card({
    id: "kpi-backlog", label: "Backlog (RPO)", basis: BASIS.gaap, help: "rpo",
    unit: "US$ billions, quarter end, as first reported",
    value: usdB(r.backlog), cmp: y ? `vs ${y.quarter} ${usdB(y.backlog)} · QoQ ${signedPct(bQ)}` : "No year-earlier quarter",
    delta: bY, deltaText: bY == null ? "" : signedPct(bY) + " YoY", good: true
  }));
  const rY = growth(r.ttm, y && y.ttm);
  co.appendChild(card({
    id: "kpi-revenue", label: "Revenue, trailing four quarters", basis: BASIS.gaap, help: "revenue",
    unit: "US$ billions, GAAP net sales, as first reported",
    value: usdB(r.ttm), cmp: y ? `vs ${y.quarter} ${usdB(y.ttm)}` : "No year-earlier quarter",
    delta: rY, deltaText: rY == null ? "" : signedPct(rY) + " YoY", good: true
  }));
  const cov = r.backlog != null && r.ttm ? r.backlog / r.ttm : null;
  const covY = y && y.backlog != null && y.ttm ? y.backlog / y.ttm : null;
  co.appendChild(card({
    id: "kpi-coverage", label: "Backlog coverage", basis: BASIS.derived, help: "coverage",
    unit: "× trailing four-quarter revenue (years)",
    value: times(cov), cmp: y ? `vs ${y.quarter} ${times(covY)}` : "No year-earlier quarter",
    delta: cov != null && covY != null ? cov - covY : null,
    deltaText: cov != null && covY != null ? signedTimes(cov - covY, 2) + " YoY" : "", good: true
  }));
  const cb = s.mape.backlog && s.mape.backlog[t], cn = s.mape.naive && s.mape.naive[t];
  co.appendChild(card({
    id: "kpi-co-mape", label: `${t} backlog-model miss`, basis: BASIS.model, help: "mape",
    unit: `MAPE, % · ${HORIZON[v].toLowerCase()} · ${(s.n.backlog && s.n.backlog[t]) || 0} forecasts`,
    value: pct(cb), cmp: `vs ${H.naive} ${pct(cn)}`,
    delta: cb != null && cn != null ? cb - cn : null,
    deltaText: cb != null && cn != null ? pp(cb - cn) + (cb > cn ? " · backlog worse" : cb < cn ? " · backlog better" : "") : "",
    good: false
  }));
}

/* The scorecard: average miss by model and company for the horizon and period, with the
   lowest in each column marked, and the backlog model's variance against the baseline. */
export function renderScorecard(model, st, period) {
  const v = st.view, H = NAMES[v], tickers = model.tickers;
  const s = summarize(forecastsFor(model, v, period), v + "|" + period.from + "|" + period.to);
  const groups = ["ALL", ...tickers];
  const box = $("scorecard");
  const head = '<thead><tr><th scope="col">MAPE, %</th>' + groups.map((g) => g === "ALL"
    ? '<th scope="col" class="n">All five</th>'
    : `<th scope="col" class="n${g === st.ticker ? " on" : ""}"><button type="button" class="co-pick" data-t="${g}" aria-pressed="${g === st.ticker}" aria-label="Show ${esc(COMPANY[g])} (${g})">${g}</button></th>`).join("") + "</tr></thead>";
  const lowest = {};
  groups.forEach((g) => {
    lowest[g] = MODELS.filter((m) => s.mape[m] && s.mape[m][g] != null)
      .sort((a, b) => s.mape[a][g] - s.mape[b][g])[0];
  });
  const cls = (g) => (g === st.ticker ? " on" : "");
  const rowsHtml = MODELS.map((m) => `<tr><th scope="row"><span class="sw sw-${m}" aria-hidden="true"></span>${esc(H[m])}</th>` +
    groups.map((g) => {
      const x = s.mape[m] && s.mape[m][g];
      const low = lowest[g] === m;
      return `<td class="n${cls(g)}${low ? " low" : ""}">${pct(x)}${low ? '<span class="sr-only"> (lowest)</span>' : ""}</td>`;
    }).join("") + "</tr>").join("");
  const deltaRow = `<tr class="var"><th scope="row">Δ backlog vs ${esc(H.naive)}, pp</th>` + groups.map((g) => {
    const b = s.mape.backlog && s.mape.backlog[g], n = s.mape.naive && s.mape.naive[g];
    if (b == null || n == null) return `<td class="n${cls(g)}">n/a</td>`;
    const d = b - n, t = tone(d, false);
    return `<td class="n ${t}${cls(g)}">${t === "neutral" ? "" : d > 0 ? "▲ " : "▼ "}${pp(d)}<span class="sr-only">${t === "fav" ? " (favourable)" : t === "unfav" ? " (unfavourable)" : ""}</span></td>`;
  }).join("") + "</tr>";
  const winRow = `<tr><th scope="row">Win rate vs ${esc(H.naive)}, %</th>` + groups.map((g) => {
    const w = s.win[g];
    if (!w) return `<td class="n${cls(g)}">n/a</td>`;
    const t = tone(w.rate - 50, true);
    return `<td class="n ${t}${cls(g)}" title="${w.wins} of ${w.n}">${t === "neutral" ? "" : w.rate > 50 ? "▲ " : "▼ "}${pct(w.rate)}</td>`;
  }).join("") + "</tr>";
  const nRow = `<tr class="count"><th scope="row">Backlog-model forecasts, n</th>` +
    groups.map((g) => `<td class="n${cls(g)}">${(s.n.backlog && s.n.backlog[g]) || 0}</td>`).join("") + "</tr>";
  box.innerHTML = `<caption class="sr-only">Average forecast miss (MAPE) by model and company, ${esc(HORIZON[v].toLowerCase())}, targets ${period.from} to ${period.to}</caption>` +
    head + "<tbody>" + rowsHtml + deltaRow + winRow + nRow + "</tbody>";
  box.querySelectorAll(".co-pick").forEach((b) => b.addEventListener("click", () => store.set({ ticker: b.dataset.t })));
  $("score-note").textContent = `Mean absolute percentage error of each ${HORIZON[v].toLowerCase()} forecast against actual GAAP revenue, ` +
    `targets ${period.from}–${period.to}. Lower is better; the lowest in each column is bold and underlined. A column header picks that company.`;
  return Object.keys(s.mape.naive || {}).length ? null
    : { empty: `No forecasts (${HORIZON[v].toLowerCase()}) with a target in ${period.from}–${period.to}.` };
}
