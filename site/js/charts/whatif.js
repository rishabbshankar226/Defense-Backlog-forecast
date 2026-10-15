/* What-if: move today's backlog or its conversion rate and see next-four-quarter revenue.
   It's a scenario, not a variance against a plan, so no red or green. */

import { $, el, announce, fade } from "../dom.js";
import { usdB, usdM, signedB, setting, pct, spoken } from "../format.js";
import { COMPANY } from "../copy.js";
import { baseOptions, lineSet, upsert, describe, charts } from "./base.js";
import { summarize } from "../model.js";
import * as store from "../state.js";

function nextQuarter(q, n) {
  const k = +q.slice(5) - 1 + n;
  return (+q.slice(0, 4) + Math.floor(k / 4)) + "Q" + (k % 4 + 1);
}

function delta(val, base) {
  const d = val - base;
  return d === 0 ? "No change" : signedB(d) + " (" + (d < 0 ? "−" : "+") + pct(Math.abs(d / base * 100)) + ")";
}

export function renderWhatIf(model, st, c, fromInput) {
  const t = st.ticker, S = model.sens[t], rows = model.byTicker[t].quarters, last = rows[rows.length - 1];
  const base = S.cell(0, 0);
  if (base == null) return { empty: `No scenario for ${COMPANY[t]}: its latest filing tags no backlog.` };
  if (!S.shocks.includes(st.shock)) st.shock = 0;
  if (!S.shifts.includes(st.shift)) st.shift = 0;
  const val = S.cell(st.shock, st.shift);

  [["shock", S.shocks, st.shock, "%"], ["shift", S.shifts, st.shift, " pp"]].forEach(([id, list, cur, unit]) => {
    const input = $(id), i = list.indexOf(cur), n = list.length - 1;
    Object.assign(input, { min: 0, max: n, step: 1, value: i });
    input.setAttribute("aria-valuetext", setting(cur, unit === "%" ? "%" : " percentage points") + (id === "shock" ? " backlog" : " conversion"));
    input.oninput = () => store.set({ [id]: list[+input.value] });
    $(id + "-out").textContent = setting(cur, unit);
    const ticks = $(id + "-ticks");
    ticks.textContent = "";
    list.forEach((v, j) => {
      const s = el("span", j === i ? "on" : "", setting(v, unit));
      s.style.left = (n ? j / n * 100 : 50) + "%";
      ticks.appendChild(s);
    });
  });
  $("reset").setAttribute("aria-disabled", st.shock === 0 && st.shift === 0 ? "true" : "false");

  $("fwd").textContent = usdB(val);
  $("fwd-m").textContent = usdM(val);
  $("fwd-delta").textContent = st.shock === 0 && st.shift === 0
    ? "Today's backlog at its typical conversion rate"
    : delta(val, base) + " against " + usdB(base) + " with no change";
  // Inputs: today's backlog and the four-quarter conversion implied by the no-change scenario.
  // Shown as inputs, not a product, since rounded inputs won't multiply back to the rounded total.
  const conv = base / last.backlog * 100, inputs = $("fwd-inputs");
  inputs.textContent = "";
  [`Backlog ${usdB(last.backlog * (1 + st.shock / 100))}${st.shock ? ` (${setting(st.shock)})` : ""}`,
    `four-quarter conversion ${pct(conv + st.shift)}${st.shift ? ` (${setting(st.shift, " pp")})` : ""}`].forEach((part, i) => {
    if (i) inputs.appendChild(document.createTextNode(" · "));
    inputs.appendChild(el("span", "nw", part));  // each input breaks as a whole
  });
  $("peek-num").textContent = usdB(val);
  $("peek-delta").textContent = delta(val, base);

  // The same summary the reconciliation checks against the published results.
  const bias = summarize(model.forecastRows.filter((r) => r.horizon === "h4"), "recon|h4").bias.backlog[t], gap = (base / last.ttm - 1) * 100;
  $("fwd-context").textContent = `Trailing four-quarter revenue to ${last.quarter} was ${usdB(last.ttm)}, so the no-change ` +
    `scenario sits ${pct(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} it.` +
    (bias == null ? "" : ` In the backtest, the backlog model's four-quarter forecasts for ${t} ran ${pct(Math.abs(bias))} ${bias >= 0 ? "high" : "low"} on average.`);
  $("whatif-from").textContent = `From ${last.quarter}, the latest quarter, for ${nextQuarter(last.quarter, 1)}–${nextQuarter(last.quarter, 4)}. ` +
    "The period filter does not apply here.";

  const table = $("grid");
  if (table.$key !== t + "|" + c.backlog + "|" + c.surface) buildGrid(t, S, c);
  table.querySelectorAll("td button").forEach((b) => {
    const on = +b.dataset.s === st.shock && +b.dataset.f === st.shift;
    b.classList.toggle("on", on);
    b.tabIndex = on ? 0 : -1;
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  table.querySelectorAll("th[data-s], th[data-f]").forEach((th) => {
    th.classList.toggle("hl", th.dataset.s != null ? +th.dataset.s === st.shock : +th.dataset.f === st.shift);
  });
  renderFan(t, S, rows, c, st);
  if (fromInput) {
    announce(`Backlog ${setting(st.shock)}, conversion ${setting(st.shift, " pp")}: scenario revenue ${usdB(val)}, ` +
      (val === base ? "no change." : delta(val, base) + " from no change."));
  }
  return null;
}

// 5 × 5 grid on a single-hue scale. Neutral, since a higher scenario isn't "better".
function buildGrid(t, S, c) {
  const all = [];
  S.shocks.forEach((s) => S.shifts.forEach((f) => all.push(S.cell(s, f))));
  const mn = Math.min(...all), mx = Math.max(...all), table = $("grid");
  table.querySelectorAll("thead, tbody").forEach((n) => n.remove());
  const thead = document.createElement("thead"), hr = document.createElement("tr");
  const corner = el("th", "");
  corner.appendChild(el("span", "corner", "Backlog ↓ / Conversion →"));
  hr.appendChild(corner);
  S.shifts.forEach((f) => { const th = el("th", "", setting(f, " pp")); th.scope = "col"; th.dataset.f = f; hr.appendChild(th); });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  S.shocks.slice().reverse().forEach((s) => {
    const tr = document.createElement("tr"), th = el("th", "", setting(s));
    th.scope = "row";
    th.dataset.s = s;
    tr.appendChild(th);
    S.shifts.forEach((f) => {
      const v = S.cell(s, f), td = document.createElement("td");
      const b = el("button", s === 0 && f === 0 ? "base" : "");
      b.appendChild(el("span", "cur", "$"));
      b.appendChild(document.createTextNode(usdB(v).slice(1, -1)));
      b.appendChild(el("span", "cur", "B"));
      const share = mx > mn ? (v - mn) / (mx - mn) : 0.5;
      b.type = "button";
      b.dataset.s = s;
      b.dataset.f = f;
      b.style.background = `color-mix(in srgb, ${c.backlog} ${Math.round(6 + share * 36)}%, ${c.surface})`;
      b.setAttribute("aria-label", spoken(`Backlog ${setting(s)}, conversion ${setting(f, " percentage points")}: ${usdB(v)}`));
      b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hover(s, f); });
      b.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hover(null, null); });
      b.addEventListener("click", () => store.set({ shock: s, shift: f }));
      td.appendChild(b);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  table.$key = t + "|" + c.backlog + "|" + c.surface;
}

// Arrow keys move and select, like a radio group.
export function gridKeys(e) {
  const b = e.target.closest ? e.target.closest("td button") : null;
  if (!b) return;
  const td = b.parentNode, tr = td.parentNode, body = tr.parentNode;
  let r = tr.sectionRowIndex, col = td.cellIndex - 1;
  const rows = body.rows.length, cols = tr.cells.length - 1;
  if (e.key === "ArrowUp") r = Math.max(0, r - 1);
  else if (e.key === "ArrowDown") r = Math.min(rows - 1, r + 1);
  else if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
  else if (e.key === "ArrowRight") col = Math.min(cols - 1, col + 1);
  else if (e.key === "Home") col = 0;
  else if (e.key === "End") col = cols - 1;
  else return;
  e.preventDefault();
  const next = body.rows[r].cells[col + 1].querySelector("button");
  if (next !== b) { next.click(); store.flush(); next.focus(); }
}

function hover(s, f) {
  $("grid").querySelectorAll("th[data-s], th[data-f]").forEach((th) => {
    th.classList.toggle("hv", th.dataset.s != null ? s != null && +th.dataset.s === s : f != null && +th.dataset.f === f);
  });
  const ch = charts["c-fan"];
  if (!ch || !ch.$cells) return;
  let i = s == null ? null : ch.$cells[s + "|" + f];
  if (i === undefined) i = null;
  if (ch.$preview === i) return;
  ch.$preview = i;
  ch.data.datasets.forEach((ds, j) => {
    if (ds.key !== "s") return;
    ds.borderColor = j === i ? fade(ch.$colors.backlog, 0.7) : ds.$color;
    ds.borderWidth = j === i ? 2 : 1;
  });
  ch.update("none");
}

// Trailing revenue up to the latest quarter, then a straight line four quarters out to each
// scenario's total.
function renderFan(t, S, rows, c, st) {
  const L = rows.length - 1, H = Math.min(8, L + 1), start = L - H + 1, last = rows[L];
  const labels = rows.slice(start).map((r) => r.quarter).concat([1, 2, 3, 4].map((n) => nextQuarter(last.quarter, n)));
  const at = H - 1, end = labels.length - 1, toB = (v) => (v == null ? null : v / 1e9);
  const path = (v) => { const d = labels.map(() => null); d[at] = toB(last.ttm); d[end] = toB(v); return d; };
  const hist = lineSet(c, "Revenue, trailing four quarters (GAAP)", rows.slice(start).map((r) => toB(r.ttm)).concat([null, null, null, null]), c.ttm, 2.25, "ttm");
  const datasets = [hist], all = [], cells = {};
  S.shocks.forEach((s) => S.shifts.forEach((f) => {
    const v = S.cell(s, f);
    all.push(v);
    if (s === 0 && f === 0) return;
    const ds = lineSet(c, "Scenario", path(v), fade(c.muted, 0.25), 1, "s");
    Object.assign(ds, { spanGaps: true, pointHitRadius: 0, pointHoverRadius: 0 });
    cells[s + "|" + f] = datasets.length;
    datasets.push(ds);
  }));
  const base = S.cell(0, 0), val = S.cell(st.shock, st.shift), isBase = st.shock === 0 && st.shift === 0;
  const none = lineSet(c, "No change", path(base), c.ink, 1.5, "base", [5, 4]);
  none.spanGaps = true;
  const sel = lineSet(c, "Selected scenario", path(val), c.backlog, 2.5, "sel");
  sel.spanGaps = true;
  datasets.push(none, sel);
  const mn = Math.min(...all), mx = Math.max(...all);
  // GAAP history and model scenarios share the axis; the key and span labels tell them apart.
  const opts = baseOptions(c, "US$ billions", "");
  opts.scales.y.ticks.maxTicksLimit = 5;
  upsert("c-fan", { type: "line", data: { labels, datasets }, options: opts }, {
    $colors: c, $crosshair: true, $ends: true, $endKeys: isBase ? ["sel"] : ["base", "sel"],
    $future: at, $futureLabel: `Next four quarters, ${labels[at + 1]}–${labels[end]}`, $futureShort: ["Next four quarters", "Next 4Q"],
    $pastLabel: "Reported", $cells: cells, $preview: null,
    $tip: (pts) => {
      const i = pts[0].dataIndex;
      if (i <= at) {
        const v = rows[start + i].ttm;
        return { title: labels[i], rows: [{ color: c.ttm, label: "Revenue, trailing four quarters", value: usdB(v), extra: usdM(v) }] };
      }
      if (i !== end) return null;
      const out = [{ color: c.backlog, label: "Selected scenario", value: usdB(val), extra: usdM(val) }];
      if (!isBase) out.push({ color: c.ink, label: "No change", value: usdB(base), extra: usdM(base), dash: true });
      out.push({ color: c.muted, label: `Range of all ${all.length}`, value: usdB(mn) + " to " + usdB(mx) });
      return { title: "Four quarters to " + labels[end] + " (model scenario)", rows: out };
    }
  });
  describe("c-fan", `${t} revenue over the four quarters to ${last.quarter} was ${usdB(last.ttm)}. The ${all.length} scenarios ` +
    `for the four quarters to ${labels[end]} run from ${usdB(mn)} to ${usdB(mx)}; the selected one is ${usdB(val)}.`);
}

/* Phones: pin the scenario figure to the bottom while the controls are in view and the readout isn't. */
export function watchPeek() {
  const pill = $("peek"), narrow = window.matchMedia("(max-width: 900px)");
  if (!window.IntersectionObserver) return;
  const seen = { num: true, ctl: false, grid: false };
  const sync = () => pill.classList.toggle("show", narrow.matches && !seen.num && (seen.ctl || seen.grid));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { seen[e.target.$peek] = e.isIntersecting; });
    sync();
  }, { rootMargin: "-64px 0px -72px 0px" });
  [[$("fwd"), "num"], [document.querySelector(".whatif .controls"), "ctl"], [$("grid-wrap"), "grid"]].forEach(([n, k]) => {
    n.$peek = k;
    io.observe(n);
  });
  if (narrow.addEventListener) narrow.addEventListener("change", sync);
}
