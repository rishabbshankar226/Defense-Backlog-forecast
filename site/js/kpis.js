/* Overview: the finding, pooled KPIs, scorecard and the selected company's KPIs. Each KPI
   cell stacks label, value, variance and basis on row tracks shared across its strip.
   Green is favourable, red unfavourable, always with ▲/▼ and a sign. */

import { $, el, esc } from "./dom.js";
import { usdB, signedB, pct, pp, signedPct, times, signedTimes, longDate, inWords, shown } from "./format.js";
import { COMPANY, MODELS, NAMES, PHRASE, HORIZON, BASIS } from "./copy.js";
import { forecastsFor, summarize, sharedSummary, latest } from "./model.js";
import { infoButton } from "./help.js";
import * as store from "./state.js";

/** Favourable, unfavourable or neutral from a difference and which way is good. Judged at
   `dp` decimals, so anything that prints as zero stays uncoloured. */
function tone(d, higherIsBetter, dp = 1) {
  const r = shown(d, dp);
  if (r == null || r === 0 || higherIsBetter == null) return "neutral";
  return (r > 0) === higherIsBetter ? "fav" : "unfav";
}

function card({ id, label, basis, unit, caption, value, cmp, delta, change, good, help, dp }) {
  const t = tone(delta, good, dp);
  const a = el("article", "kpi");
  a.id = id;
  a.dataset.tone = t;
  const head = el("div", "kpi-head");
  head.appendChild(el("h4", "kpi-label", label));
  if (help) head.appendChild(infoButton(help));
  a.appendChild(head);
  // Basis and unit lead the caption. Always four parts, so the row tracks line up.
  const sub = el("p", "kpi-unit");
  sub.appendChild(el("span", "tag", basis + " · " + unit));
  if (caption) sub.appendChild(document.createTextNode(" " + caption));
  a.appendChild(sub);
  a.appendChild(el("p", "kpi-val", value));
  const foot = el("div", "kpi-foot");
  if (change) {
    // Keep each part on one line (glyph with its figure) so narrow cells only break between parts.
    const d = el("p", "kpi-delta " + t);
    change.split(" · ").forEach((part, i) => {
      const span = el("span", "nw");
      if (!i && t !== "neutral") span.appendChild(el("span", "glyph", delta > 0 ? "▲" : "▼"));
      span.appendChild(document.createTextNode(part));
      if (i) d.appendChild(el("span", "sep", "·"));
      d.appendChild(span);
    });
    if (t !== "neutral") d.appendChild(el("span", "sr-only", t === "fav" ? " (favourable)" : " (unfavourable)"));
    foot.appendChild(d);
  }
  foot.appendChild(el("p", "kpi-cmp", cmp));
  a.appendChild(foot);
  return a;
}

// A difference against a baseline, absolute then relative: "+3.6 pp · +62.4% worse".
const versus = (abs, d, base, words) => abs + (base ? " · " + signedPct(d / Math.abs(base) * 100) : "") +
  (words && d ? " " + (d > 0 ? words[0] : words[1]) : "");

/** The finding, from the full-sample results. */
export function renderHeadline(model) {
  const m = model.metrics, h4 = m.mape.H4, tickers = model.tickers;
  const best = MODELS.slice().sort((a, b) => h4[a].ALL - h4[b].ALL)[0];
  const head = $("headline");
  head.textContent = "";
  const parts = ["Over the next four quarters, " + PHRASE[best] + " missed actual revenue by ",
    ["num", pct(h4[best].ALL)], ` on average, the lowest of ${inWords(MODELS.length)} models`];
  if (best === "backlog") parts.push(".");
  else parts.push(", while the backlog model missed by ", ["num", pct(h4.backlog.ALL)], ".");
  parts.forEach((p) => head.appendChild(typeof p === "string" ? document.createTextNode(p) : el("strong", p[0], p[1])));
  const against = tickers.filter((t) => {
    const b = m.mape.H4.backlog[t], n = m.mape.H4.naive[t];
    return b != null && n != null && (best === "backlog" ? b > n : b < n);
  }).map((t) => COMPANY[t] || t);
  const n = inWords(tickers.length);
  $("bottom-line").textContent = (best === "backlog"
    ? `Across the ${n} companies, backlog was a better guide to the next year's revenue than last year's revenue.`
    : `Across the ${n} companies, last year's revenue was a better guide to the next year's than backlog.`) +
    (against.length ? " " + (against.length > 1 ? against.slice(0, -1).join(", ") + " and " + against[against.length - 1] + " were the exceptions."
      : against[0] + " was the exception.") : "");
  const when = el("time", "", longDate(model.asOf));
  when.dateTime = model.asOf;
  const asof = $("asof");
  asof.textContent = "Last updated ";
  asof.appendChild(when);
}

const span = (p) => (p.from === p.to ? String(p.from) : p.from + "–" + p.to);
const statsFor = (model, v, p) => summarize(forecastsFor(model, v, p), v + "|" + p.from + "|" + p.to);

/* ----- every company, pooled: the backlog model's miss, win rate and bias ----- */
export function renderPoolKpis(model, st, period) {
  const v = st.view, H = NAMES[v], s = statsFor(model, v, period);
  const pool = $("kpis-pool");
  pool.textContent = "";
  $("kpis-pool-title").textContent = `All ${inWords(model.tickers.length)} companies · ${HORIZON[v]} · forecast targets ${span(period)}`;
  const mb = s.mape.backlog && s.mape.backlog.ALL, mn = s.mape.naive && s.mape.naive.ALL;
  const nb = s.n.backlog && s.n.backlog.ALL;
  const d = mb != null && mn != null ? mb - mn : null;
  pool.appendChild(card({
    id: "kpi-mape", label: "Backlog-model forecast miss", basis: BASIS.model, unit: "%", help: "mape",
    caption: `MAPE, % of actual GAAP revenue · ${nb || 0} forecasts`,
    value: pct(mb), cmp: `vs. ${pct(mn)} ${H.naive}`,
    delta: d, change: d == null ? "" : versus(pp(d), d, mn, ["worse", "better"]), good: false
  }));
  const w = s.win.ALL;
  pool.appendChild(card({
    id: "kpi-win", label: `Win rate vs ${H.naive}`, basis: BASIS.model, unit: "%", help: "winrate",
    caption: w ? `% of forecasts · ${w.wins} of ${w.n} closer` : "% of forecasts",
    value: w ? pct(w.rate) : "n/a", cmp: "vs. 50.0% coin flip",
    delta: w ? w.rate - 50 : null, change: w ? pp(w.rate - 50) : "", good: true
  }));
  const bb = s.bias.backlog && s.bias.backlog.ALL, bn = s.bias.naive && s.bias.naive.ALL;
  pool.appendChild(card({
    id: "kpi-bias", label: "Backlog-model bias", basis: BASIS.model, unit: "%", help: "bias",
    caption: "Mean signed error, % of actual · + = too high",
    value: signedPct(bb), cmp: `vs. ${signedPct(bn)} ${H.naive}`, delta: null,
    change: bb == null ? "" : bb > 0 ? "Over-forecast" : bb < 0 ? "Under-forecast" : "", good: null
  }));
}

/* ----- the selected company: its latest quarter in the period, against a year earlier ----- */
export function renderCompanyKpis(model, st, period) {
  const v = st.view, H = NAMES[v], t = st.ticker, s = statsFor(model, v, period);
  const co = $("kpis-co");
  co.textContent = "";
  const L = latest(model, t, period);
  if (!L) {
    $("kpis-co-title").textContent = `${COMPANY[t]} (${t})`;
    const empty = el("div", "kpi-empty");
    empty.appendChild(el("p", "", `No quarters for ${COMPANY[t]} in ${span(period)}.`));
    const all = el("button", "btn", "Show all years");
    all.type = "button";
    all.addEventListener("click", () => { store.set({ from: st.bounds.minYear, to: st.bounds.maxYear }); store.flush(); $("kpis-co-title").focus(); });
    empty.appendChild(all);
    co.appendChild(empty);
    return;
  }
  const r = L.row, y = L.yearAgo, q = L.prev;
  $("kpis-co-title").textContent = `${COMPANY[t]} (${t}) · ${r.quarter}, latest quarter in period`;
  const growth = (a, b) => (a == null || b == null || !b ? null : (a / b - 1) * 100);
  const ago = y ? ` ${y.quarter}, a year earlier` : "";
  const bY = growth(r.backlog, y && y.backlog), bQ = growth(r.backlog, q && q.backlog);
  co.appendChild(card({
    id: "kpi-backlog", label: "Backlog (RPO)", basis: BASIS.gaap, unit: "US$B", help: "rpo",
    caption: "Quarter end, as first reported" + (bQ == null ? "" : ` · QoQ ${signedPct(bQ)}`),
    value: usdB(r.backlog), cmp: y ? `vs. ${usdB(y.backlog)}${ago}` : "No year-earlier quarter",
    delta: bY, change: bY == null ? "" : `${signedB(r.backlog - y.backlog)} · ${signedPct(bY)} YoY`, good: true
  }));
  const rY = growth(r.ttm, y && y.ttm);
  co.appendChild(card({
    id: "kpi-revenue", label: "Revenue, trailing four quarters", basis: BASIS.gaap, unit: "US$B", help: "revenue",
    caption: "GAAP net sales, as first reported",
    value: usdB(r.ttm), cmp: y ? `vs. ${usdB(y.ttm)}${ago}` : "No year-earlier quarter",
    delta: rY, change: rY == null ? "" : `${signedB(r.ttm - y.ttm)} · ${signedPct(rY)} YoY`, good: true
  }));
  const cov = r.backlog != null && r.ttm ? r.backlog / r.ttm : null;
  const covY = y && y.backlog != null && y.ttm ? y.backlog / y.ttm : null;
  const dc = cov != null && covY != null ? cov - covY : null;
  co.appendChild(card({
    id: "kpi-coverage", label: "Backlog coverage", basis: BASIS.derived, unit: "×", help: "coverage",
    caption: "Backlog ÷ trailing four-quarter revenue (years)",
    // Two decimals everywhere, so a small change never sits between two figures that print the same.
    value: times(cov, 2), cmp: y ? `vs. ${times(covY, 2)}${ago}` : "No year-earlier quarter",
    delta: dc, dp: 2, change: dc == null ? "" : versus(signedTimes(dc, 2), dc, covY) + " YoY", good: true
  }));
  const cb = s.mape.backlog && s.mape.backlog[t], cn = s.mape.naive && s.mape.naive[t];
  const dm = cb != null && cn != null ? cb - cn : null;
  co.appendChild(card({
    id: "kpi-co-mape", label: `${t} backlog-model miss`, basis: BASIS.model, unit: "%", help: "mape",
    caption: `MAPE · ${HORIZON[v].toLowerCase()} · ${(s.n.backlog && s.n.backlog[t]) || 0} forecasts`,
    value: pct(cb), cmp: `vs. ${pct(cn)} ${H.naive}`,
    delta: dm, change: dm == null ? "" : versus(pp(dm), dm, cn, ["worse", "better"]), good: false
  }));
}

// Variance bar centred on zero (share -1 to 1). Decoration; the figure carries the meaning.
const vbar = (share) => `<span class="vbar" aria-hidden="true"><i style="${share < 0 ? "right" : "left"}:50%;` +
  `width:${(Math.min(1, Math.abs(share)) * 50).toFixed(1)}%"></i></span>`;
const glyph = (t, d) => (t === "neutral" ? "" : d > 0 ? "▲ " : "▼ ");
const said = (t) => (t === "fav" ? '<span class="sr-only"> (favourable)</span>' : t === "unfav" ? '<span class="sr-only"> (unfavourable)</span>' : "");

/* Scorecard: a pooled row plus one per company. Average miss per model, the backlog model's
   Δ vs the baseline and its win rate (each with a bar on a per-column scale), forecasts scored. */
export function renderScorecard(model, st, period) {
  const v = st.view, H = NAMES[v], tickers = model.tickers;
  const rows = forecastsFor(model, v, period), key = v + "|" + period.from + "|" + period.to;
  const s = summarize(rows, key), sh = sharedSummary(rows, "shared|" + key);
  const groups = ["ALL", ...tickers];
  const m = (bag, k, g) => (bag[k] && bag[k][g] != null ? bag[k][g] : null);
  const delta = (g, bag) => (m(bag.mape, "backlog", g) == null || m(bag.mape, "naive", g) == null ? null
    : bag.mape.backlog[g] - bag.mape.naive[g]);
  const widest = Math.max(0, ...groups.map((g) => Math.abs(delta(g, s) || 0))) || 1;
  // Two header rows: what each block of columns compares, then the columns themselves.
  const head = '<colgroup><col></colgroup><colgroup span="3"></colgroup><colgroup span="2"></colgroup><colgroup><col></colgroup>' +
    '<thead><tr><th scope="col" rowspan="2">Company</th>' +
    '<th scope="colgroup" colspan="3" class="grp">Average miss (MAPE), %</th>' +
    // The baseline's last word stays with the one before it, so "4Q" never sits alone.
    `<th scope="colgroup" colspan="2" class="grp">Backlog model vs ${esc(H.naive).replace(/ (\S+)$/, "&nbsp;$1")}</th>` +
    `<th scope="col" rowspan="2" class="n">Forecasts scored<span class="unit">backlog model of ${esc(H.naive)}</span></th></tr><tr>` +
    MODELS.map((x) => `<th scope="col" class="n"><span class="sw sw-${x}" aria-hidden="true"></span>${esc(H[x])}</th>`).join("") +
    '<th scope="col" class="n var">Δ, pp<span class="unit">lower is better</span></th>' +
    '<th scope="col" class="n var">Win rate, %<span class="unit">vs 50% coin flip</span></th></tr></thead>';
  const body = groups.map((g) => {
    const all = g === "ALL", on = g === st.ticker;
    const name = all ? `All ${inWords(tickers.length)}`
      : `<button type="button" class="co-pick" data-t="${g}" aria-pressed="${on}" aria-label="Show ${esc(COMPANY[g])} (${g})">${g}</button>`;
    const low = MODELS.filter((x) => m(s.mape, x, g) != null).sort((a, b) => s.mape[a][g] - s.mape[b][g])[0];
    const mapes = MODELS.map((x) => `<td class="n${x === low ? " low" : ""}">${pct(m(s.mape, x, g))}` +
      `${x === low ? '<span class="sr-only"> (lowest)</span>' : ""}</td>`).join("");
    const d = delta(g, s), dt = tone(d, false);
    const dCell = d == null ? '<td class="n">n/a</td>'
      : `<td class="n var ${dt}">${glyph(dt, d)}${pp(d)}${said(dt)}${vbar(d / widest)}</td>`;
    const w = s.win[g], wt = w ? tone(w.rate - 50, true) : "neutral";
    const wCell = !w ? '<td class="n">n/a</td>'
      : `<td class="n var ${wt}" title="${w.wins} of ${w.n}">${glyph(wt, w.rate - 50)}${pct(w.rate)}${said(wt)}${vbar((w.rate - 50) / 50)}</td>`;
    const nb = m(s.n, "backlog", g) || 0, nn = m(s.n, "naive", g) || 0;
    return `<tr class="${all ? "all" : ""}${on ? " on" : ""}"><th scope="row">${name}</th>${mapes}${dCell}${wCell}` +
      `<td class="n count">${nb} of ${nn}</td></tr>`;
  }).join("");
  const box = $("scorecard");
  box.innerHTML = `<caption class="sr-only">Average forecast miss (MAPE) by company and model, ${esc(HORIZON[v].toLowerCase())}, targets ${period.from} to ${period.to}</caption>` +
    head + "<tbody>" + body + "</tbody>";
  box.querySelectorAll(".co-pick").forEach((b) => {
    b.addEventListener("click", () => store.set({ ticker: b.dataset.t }));
    b.closest("tr").addEventListener("click", (e) => { if (!e.target.closest(".co-pick")) b.click(); });
  });
  // One line. What MAPE means, the shared bar scale and row picking live in the title's definition.
  $("score-note").textContent = "Lower is better; the lowest in each row is shaded. " +
    `${HORIZON[v]} forecasts against actual GAAP revenue, targets ${span(period)}.`;

  // The baselines score origins the backlog model can't, so the published Δ compares different
  // sets. When it does, the note also gives Δ on the shared origins.
  const nb = m(s.n, "backlog", "ALL") || 0, nn = m(s.n, "naive", "ALL") || 0;
  const short = groups.filter((g) => (m(s.n, "naive", g) || 0) > (m(s.n, "backlog", g) || 0));
  const shared = short.filter((g) => delta(g, sh) != null)
    .map((g) => `${pp(delta(g, sh))} for ${g === "ALL" ? "all " + inWords(tickers.length) : g}`);
  const list = shared.length > 2 ? shared.slice(0, -1).join(", ") + " and " + shared[shared.length - 1] : shared.join(" and ");
  $("score-foot").textContent = !nn ? ""
    : nn === nb ? `The backlog model and ${H.naive} score the same ${nb} origins, so Δ compares like with like.`
      : `The backlog model needs tagged backlog at the origin, so it scores ${nb} of the ${nn} forecasts ${H.naive} scores. ` +
        `Δ compares each model's average over its own forecasts, as published` +
        (shared.length ? `; on the origins both score it is ${list}.` : ".");
  return Object.keys(s.mape.naive || {}).length ? null
    : { empty: `No forecasts (${HORIZON[v].toLowerCase()}) with a target in ${span(period)}.` };
}
