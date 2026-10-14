/* The granular table: every row behind the charts, searchable, sortable and exportable,
   with totals and a reconciliation of the chart figures against these rows.

   Performance: rows are flattened once (model.js) with a lowercase search key. A filter and
   sort result is memoised on its inputs, and rows are written as one HTML string per page
   of 200, so filtering stays quick on tens of thousands of rows. */

import { $, el, esc, debounce, announce } from "./dom.js";
import { usdM, signedM, pct, signedPct, times, usdCents, inWords } from "./format.js";
import { COMPANY, NAMES, HORIZON, MODELS } from "./copy.js";
import { inPeriod, summarize } from "./model.js";
import { reconcile } from "./reconcile.js";
import * as store from "./state.js";

const PAGE = 200;
const edgar = (cik, accn) => `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accn.replace(/-/g, "")}/`;
const accnCell = (r, accn) => (accn ? `<a href="${edgar(r.cik, accn)}" rel="noopener">${esc(accn)}</a>` : "n/a");
const METHOD = { reported_3m: "Reported", fy_minus_9m: "FY − 9M" };

/* Column definitions. `get` is the raw value (sorted on, and exported); `fmt` the cell. */
const QUARTER_COLS = [
  { key: "ticker", label: "Company", get: (r) => r.ticker },
  { key: "quarter", label: "Quarter", get: (r) => r.qi, csv: (r) => r.quarter, fmt: (r) => r.quarter },
  { key: "periodEnd", label: "Period end", get: (r) => r.periodEnd || "" },
  { key: "backlog", label: "Backlog (RPO)", unit: "US$M · GAAP", num: true, get: (r) => r.backlog, fmt: (r) => usdM(r.backlog) },
  { key: "revenue", label: "Revenue, quarter", unit: "US$M · GAAP", num: true, get: (r) => r.revenue, fmt: (r) => usdM(r.revenue) },
  { key: "ttm", label: "Revenue, trailing 4Q", unit: "US$M · GAAP", num: true, get: (r) => r.ttm, fmt: (r) => usdM(r.ttm) },
  { key: "bookings", label: "Implied bookings", unit: "US$M · derived", num: true, get: (r) => r.bookings, fmt: (r) => usdM(r.bookings) },
  { key: "btb", label: "Book-to-bill", unit: "× · derived", num: true, get: (r) => r.btb, fmt: (r) => times(r.btb, 2) },
  { key: "method", label: "Quarter revenue", unit: "basis", get: (r) => r.method || "", fmt: (r) => METHOD[r.method] || "n/a" },
  { key: "backlogAccn", label: "Backlog filing", unit: "SEC accession", get: (r) => r.backlogAccn || "", fmt: (r) => accnCell(r, r.backlogAccn), html: true },
  { key: "revenueAccn", label: "Revenue filing", unit: "SEC accession", get: (r) => r.revenueAccn || "", fmt: (r) => accnCell(r, r.revenueAccn), html: true }
];

const FORECAST_COLS = [
  { key: "ticker", label: "Company", get: (r) => r.ticker },
  { key: "model", label: "Model", get: (r) => r.model, fmt: (r) => NAMES[r.horizon][r.model] },
  { key: "origin", label: "Made at", get: (r) => r.origin },
  { key: "target", label: "Target", unit: "last quarter", get: (r) => r.target },
  { key: "forecast", label: "Forecast", unit: "US$M · model", num: true, get: (r) => r.forecast, fmt: (r) => usdM(r.forecast, 1) },
  { key: "actual", label: "Actual", unit: "US$M · GAAP", num: true, get: (r) => r.actual, fmt: (r) => usdM(r.actual) },
  { key: "error", label: "Error", unit: "US$M · fcst − actual", num: true, get: (r) => r.error, fmt: (r) => signedM(r.error, 1) },
  { key: "ape", label: "Miss (APE)", unit: "% of actual", num: true, get: (r) => r.ape, fmt: (r) => pct(r.ape, 2) },
  { key: "beatsNaive", label: "Beat naive", unit: "backlog model", get: (r) => (r.beatsNaive == null ? "" : r.beatsNaive ? "Yes" : "No"),
    fmt: (r) => (r.beatsNaive == null ? '<span class="dim">n/a</span>' : r.beatsNaive ? '<span class="fav">▲ Yes</span>' : '<span class="unfav">▼ No</span>'), html: true }
];

const MODEL_ORDER = { backlog: 0, naive: 1, naive_drift: 2 };
const memo = new Map();

/** Filter and sort; memoised on every input that changes the result. */
function select(model, st) {
  const tab = st.tab, sort = st.sort && st.sort.tab === tab ? st.sort : null;
  const key = [tab, st.scope, st.ticker, st.from, st.to, st.view, st.model, st.query, sort ? sort.key + sort.dir : ""].join("|");
  if (memo.has(key)) return memo.get(key);
  const terms = st.query.toLowerCase().split(/\s+/).filter(Boolean);
  const p = { from: st.from, to: st.to };
  const src = tab === "quarters" ? model.quarterRows : model.forecastRows;
  const out = src.filter((r) => (st.scope === "all" || r.ticker === st.ticker) && inPeriod(r.year, p) &&
    (tab === "quarters" || (r.horizon === st.view && (st.model === "all" || r.model === st.model))) &&
    terms.every((t) => r.key.includes(t)));
  if (sort) {
    const col = (tab === "quarters" ? QUARTER_COLS : FORECAST_COLS).find((c) => c.key === sort.key);
    const dir = sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null || x === "") return 1;   // blanks last, either direction
      if (y == null || y === "") return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  } else if (tab === "forecasts") {
    out.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0) || (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0) ||
      MODEL_ORDER[a.model] - MODEL_ORDER[b.model]);
  }
  if (memo.size > 200) memo.clear();
  memo.set(key, out);
  return out;
}

function head(cols, st) {
  const sort = st.sort && st.sort.tab === st.tab ? st.sort : null;
  return "<tr>" + cols.map((c) => {
    const s = sort && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : null;
    return `<th scope="col" class="${c.num ? "n" : ""}"${s ? ` aria-sort="${s}"` : ""}>` +
      `<button type="button" class="sort" data-key="${c.key}">${esc(c.label)}` +
      (c.unit ? `<span class="unit">${esc(c.unit)}</span>` : "") +
      `<span class="arrow" aria-hidden="true">${s === "ascending" ? "▲" : s === "descending" ? "▼" : "↕"}</span></button></th>`;
  }).join("") + "</tr>";
}

function body(cols, rows, limit) {
  let html = "";
  const n = Math.min(rows.length, limit);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    html += "<tr>";
    for (let j = 0; j < cols.length; j++) {
      const c = cols[j], v = c.fmt ? c.fmt(r) : c.get(r);
      const text = c.html ? v : esc(v == null ? "n/a" : v);
      html += j === 0 ? `<th scope="row">${text}</th>` : `<td class="${c.num ? "n" : ""}">${text}</td>`;
    }
    html += "</tr>";
  }
  return html;
}

// Totals: flows add up; point-in-time balances and ratios do not, and say so. The error
// figures come from the same summary as the KPIs, at the KPIs' precision, so a filtered
// set that matches a KPI's scope prints the same number.
function foot(tab, cols, rows, st) {
  const sum = (k) => rows.reduce((s, r) => (r[k] == null ? s : s + r[k]), 0);
  const gaps = (k) => rows.filter((r) => r[k] == null).length;
  const excluded = (k) => (gaps(k) ? `<span class="unit">${gaps(k)} n/a excluded</span>` : "");
  const s = tab === "forecasts" ? summarize(rows) : null;
  const one = tab === "forecasts" && st.model !== "all" ? st.model : null;
  const cell = (c) => {
    if (tab === "quarters") {
      if (c.key === "revenue" || c.key === "bookings") return usdM(sum(c.key)) + excluded(c.key);
      if (c.key === "btb") {
        const both = rows.filter((r) => r.bookings != null && r.revenue != null);
        const rev = both.reduce((s, r) => s + r.revenue, 0);
        return rev ? times(both.reduce((s, r) => s + r.bookings, 0) / rev, 2) + '<span class="unit">Σ bookings ÷ Σ revenue</span>' : "n/a";
      }
      if (c.key === "backlog" || c.key === "ttm") return '<span class="dim">Not additive</span>';
      return "";
    }
    if (c.key === "error") {
      return one ? signedM(sum("error") / rows.length, 1) + '<span class="unit">mean</span>' : '<span class="dim">Pick a model</span>';
    }
    if (c.key === "ape") {
      // Across all three models an average miss means nothing, so each model gets its own.
      const ms = one ? [one] : MODELS.filter((m) => s.mape[m] && s.mape[m].ALL != null);
      return ms.map((m) => pct(s.mape[m].ALL) + `<span class="unit">${one ? "MAPE · bias " + signedPct(s.bias[m].ALL)
        : esc(NAMES[st.view][m]) + " MAPE"}</span>`).join("");
    }
    if (c.key === "beatsNaive") {
      const w = s.win.ALL;
      return w ? `${w.wins} of ${w.n}<span class="unit">${pct(w.rate)} win rate</span>` : "n/a";
    }
    return "";
  };
  return `<tr><th scope="row">Total of all ${rows.length.toLocaleString("en-US")} filtered rows</th>` +
    cols.slice(1).map((c) => `<td class="${c.num ? "n" : ""}">${cell(c)}</td>`).join("") + "</tr>";
}

function scopeText(model, st) {
  const who = st.scope === "all" ? `all ${inWords(model.tickers.length)} companies` : COMPANY[st.ticker] + " (" + st.ticker + ")";
  return `${who}, ${st.from}–${st.to}`;
}

/** Draw the table for the current state. Returns null, or an empty-state message. */
export function renderTable(model, st) {
  const tab = st.tab, cols = tab === "quarters" ? QUARTER_COLS : FORECAST_COLS;
  ["quarters", "forecasts"].forEach((k) => {
    const b = $("tt-" + k), on = k === tab;
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  });
  $("tbl").setAttribute("aria-labelledby", "tt-" + tab);
  $("t-model-wrap").hidden = tab !== "forecasts";
  $("t-scope").value = st.scope;
  $("t-model").value = st.model;

  const rows = select(model, st);
  const table = $("data");
  const caption = (tab === "quarters"
    ? "Quarterly fundamentals: backlog and revenue as first reported, US$ millions"
    : `Backtest forecasts, ${HORIZON[st.view].toLowerCase()}, US$ millions`) + " · " + scopeText(model, st);
  table.querySelector("caption").textContent = caption;
  $("t-caption").textContent = caption;
  table.querySelector("thead").innerHTML = head(cols, st);
  const tbody = table.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty"><td colspan="${cols.length}"><p>No rows match ${esc(scopeText(model, st))}` +
      `${st.query ? ` and “${esc(st.query)}”` : ""}${tab === "forecasts" && st.model !== "all" ? " for this model" : ""}.</p>` +
      '<button type="button" class="btn" id="t-clear">Clear filters</button></td></tr>';
    $("t-clear").addEventListener("click", () => {
      $("t-search").value = "";
      store.set({ query: "", model: "all", scope: "all",
        from: st.bounds.minYear, to: st.bounds.maxYear });
      // The button goes with the redraw, so focus moves to the search box, not the page.
      store.flush();
      $("t-search").focus();
    });
  } else {
    tbody.innerHTML = body(cols, rows, st.limit);
  }
  table.querySelector("tfoot").innerHTML = rows.length ? foot(tab, cols, rows, st) : "";
  const more = $("t-more");
  more.hidden = rows.length <= st.limit;
  more.textContent = `Show ${Math.min(PAGE, rows.length - st.limit).toLocaleString("en-US")} more of ${rows.length.toLocaleString("en-US")}`;
  $("t-count").textContent = rows.length
    ? `Showing ${Math.min(rows.length, st.limit).toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows`
    : "No rows";

  renderRecon(model, st);
  return null;
}

/* Reconciliation, for the companies in scope and the period shown. */
function renderRecon(model, st) {
  const tickers = st.scope === "all" ? model.tickers : [st.ticker];
  const checks = reconcile(model, tickers, { from: st.from, to: st.to }, st.view);
  const passed = checks.filter((c) => !c.failures.length).length;
  const cash = checks.filter((c) => c.unit === "cents");
  // A check that fails on a missing row has no finite difference; it must not read as $0.00.
  const missing = cash.some((c) => !isFinite(c.maxDiff));
  const maxCents = Math.round(Math.max(0, ...cash.map((c) => c.maxDiff)));
  const ok = passed === checks.length;
  const none = checks.every((c) => !c.n);
  const box = $("recon");
  box.dataset.ok = ok ? "true" : "false";
  $("recon-sum").innerHTML = none ? `Nothing to check for ${esc(scopeText(model, st))}`
    : `<span class="${ok ? "fav" : "unfav"}">${ok ? "✓" : "✗"} ${passed} of ${checks.length} checks pass</span>` +
    ` · max difference ${missing ? "n/a (missing rows)" : usdCents(maxCents)} · ${esc(scopeText(model, st))}`;
  const max = (c) => (!c.n ? "" : !isFinite(c.maxDiff) ? ", max n/a"
    : c.unit === "cents" ? ", max " + usdCents(Math.round(c.maxDiff)) : ", max " + c.maxDiff.toExponential(1) + " pp");
  $("recon-list").innerHTML = checks.map((c) => `<li class="${c.failures.length ? "unfav" : ""}">` +
    `<span class="mark" aria-hidden="true">${c.failures.length ? "✗" : c.n ? "✓" : "–"}</span>${esc(c.name)} ` +
    `<span class="dim">(${c.n ? c.n.toLocaleString("en-US") + " compared" + max(c) : "nothing in this period"})</span>` +
    (c.failures.length ? `<span class="sr-only">Failed.</span> Failed: ${esc(c.failures.slice(0, 8).join(", "))}${c.failures.length > 8 ? "…" : ""}` : "") +
    "</li>").join("");
}

function toCsv(model, st) {
  const cols = st.tab === "quarters" ? QUARTER_COLS : FORECAST_COLS;
  const rows = select(model, st);
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const header = cols.map((c) => q(c.label + (c.unit ? " (" + c.unit + ")" : ""))).join(",");
  // Raw values at full precision, in US dollars: the export is for checking, not reading.
  const lines = rows.map((r) => cols.map((c) => q(c.csv ? c.csv(r) : c.key === "model" ? r.model : c.get(r))).join(","));
  return [header.replace(/US\$M/g, "US$"), ...lines].join("\n") + "\n";
}

/** Wire the controls once. */
export function watchTable(model) {
  $("t-scope").querySelector('option[value="all"]').textContent = `All ${inWords(model.tickers.length)} companies`;
  const tabs = ["quarters", "forecasts"];
  tabs.forEach((k) => $("tt-" + k).addEventListener("click", () => store.set({ tab: k, limit: PAGE })));
  $("t-tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.indexOf(store.get().tab);
    const j = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    store.set({ tab: tabs[j], limit: PAGE });
    store.flush();
    $("tt-" + tabs[j]).focus();
  });
  $("t-scope").addEventListener("change", (e) => store.set({ scope: e.target.value, limit: PAGE }));
  $("t-model").addEventListener("change", (e) => store.set({ model: e.target.value, limit: PAGE }));
  $("t-search").addEventListener("input", debounce((e) => store.set({ query: e.target.value.trim(), limit: PAGE }), 150));
  $("t-more").addEventListener("click", () => store.set({ limit: store.get().limit + PAGE }));
  // The header and totals rows stick to the scroll box's edges, so a focused cell link
  // that lands under either is scrolled clear of it (WCAG 2.4.11).
  $("tbl").addEventListener("focusin", (e) => {
    const box = $("tbl"), t = e.target;
    if (t === box || t.closest("thead, tfoot")) return;
    // Measure the sticky cells, not thead/tfoot: only the cells stick, so the sections'
    // own boxes sit where they would be unpinned.
    const r = t.getBoundingClientRect();
    const th = box.querySelector("thead th"), tf = box.querySelector("tfoot th, tfoot td");
    const head = th ? th.getBoundingClientRect().bottom : -Infinity;
    const foot = tf ? tf.getBoundingClientRect().top : Infinity;
    if (r.top < head) box.scrollTop -= head - r.top + 4;
    else if (r.bottom > foot) box.scrollTop += r.bottom - foot + 4;
  });
  $("data").querySelector("thead").addEventListener("click", (e) => {
    const b = e.target.closest("button.sort");
    if (!b) return;
    const st = store.get(), cur = st.sort && st.sort.tab === st.tab && st.sort.key === b.dataset.key ? st.sort.dir : null;
    store.set({ sort: { tab: st.tab, key: b.dataset.key, dir: cur === "asc" ? "desc" : "asc" } });
    store.flush();
    const again = $("data").querySelector(`button.sort[data-key="${b.dataset.key}"]`);
    if (again) again.focus();
    announce("Sorted by " + b.firstChild.textContent + ", " + (cur === "asc" ? "descending" : "ascending") + ".", 0);
  });
  $("t-export").addEventListener("click", () => {
    const st = store.get();
    const blob = new Blob([toCsv(model, st)], { type: "text/csv;charset=utf-8" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `defense-backlog-${st.tab}-${st.scope === "all" ? "all" : st.ticker}-${st.from}-${st.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
