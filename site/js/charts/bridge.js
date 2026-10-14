/* The revenue bridge: how one year's revenue got from the year before's, split into a
   backlog effect, a conversion effect and their overlap. The bars are built from whole
   cents with the overlap as the plug, so the last step lands exactly on the current-year
   bar, and the table beside the chart foots at the precision it shows. */

import { $, el } from "../dom.js";
import { usdB, usdM, signedB, signedM, usdCents, cents, rate } from "../format.js";
import { COMPANY } from "../copy.js";
import { inPeriod } from "../model.js";
import { baseOptions, upsert, describe } from "./base.js";
import * as store from "../state.js";

// Name the bigger driver only when it is at least twice the other.
function driver(bk, cv) {
  const x = Math.abs(bk), y = Math.abs(cv);
  if (x < 2 * y && y < 2 * x) {
    return (bk >= 0) === (cv >= 0) ? "Backlog and conversion moved revenue the same way, by similar amounts. "
      : "Backlog and conversion pulled in opposite directions by similar amounts. ";
  }
  return x > y
    ? "The bigger driver was a " + (bk >= 0 ? "larger" : "smaller") + " starting backlog. "
    : "The bigger driver was turning " + (cv >= 0 ? "more" : "less") + " of the backlog into revenue. ";
}

// The width of the widest word in the chart's tick font, measured once on a spare canvas.
let measure = null;
function widest(words, size) {
  measure = measure || document.createElement("canvas").getContext("2d");
  measure.font = size + "px " + Chart.defaults.font.family;
  return Math.max(...words.map((w) => measure.measureText(w).width));
}

function renderYears(years, current) {
  const box = $("years"), key = years.join(",");
  if (box.$key !== key) {
    box.$key = key;
    box.textContent = "";
    years.forEach((y) => {
      const b = el("button", "", String(y));
      b.type = "button";
      b.dataset.year = y;
      b.addEventListener("click", () => store.set({ year: y }));
      box.appendChild(b);
    });
    if (!box.$keys) {
      box.$keys = true;
      box.addEventListener("keydown", (e) => {
        const list = [...box.querySelectorAll("button")].map((b) => +b.dataset.year);
        const i = list.indexOf(store.get().year);
        let j = i;
        if (e.key === "ArrowRight") j = Math.min(list.length - 1, i + 1);
        else if (e.key === "ArrowLeft") j = Math.max(0, i - 1);
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = list.length - 1;
        else return;
        e.preventDefault();
        if (j === i) return;
        store.set({ year: list[j] });
        store.flush();
        box.querySelector(`[data-year="${list[j]}"]`).focus();
      });
    }
  }
  box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.year === current ? "true" : "false"));
}

export function renderBridge(model, st, c, period) {
  const t = st.ticker;
  const rows = model.bridgeRows.filter((r) => r.ticker === t && inPeriod(r.year, period));
  if (!rows.length) {
    renderYears([], null);
    $("bridge-table").textContent = "";
    $("bridge-cap").textContent = "";
    return { empty: `No full calendar years with a bridge for ${COMPANY[t]} in ${period.from}–${period.to}.` };
  }
  const years = rows.map((r) => r.year);
  let year = st.year;
  if (year == null || !years.includes(year)) year = years[years.length - 1];
  if (year !== st.year) st.year = year;  // a quiet correction: not a change the reader made
  renderYears(years, year);
  const r = rows.find((x) => x.year === year), k = r.c;

  // Steps in dollars, from cents: prior + backlog + conversion + overlap === current, exactly.
  const steps = [k.backlog / 100, k.conv / 100, k.overlap / 100];
  let level = k.prior / 100;
  const bars = [[0, level]], kinds = ["total"];
  steps.forEach((d) => { bars.push([level, level + d]); kinds.push(d > 0 ? "up" : d < 0 ? "down" : "flat"); level += d; });
  bars.push([0, k.current / 100]);
  kinds.push("total");
  const labels = [[String(year - 1), "revenue"], ["Backlog", "effect"], ["Conversion", "effect"], ["Overlap", "effect"], [String(year), "revenue"]];
  const values = [k.prior / 100, ...steps, k.current / 100];

  const lo = Math.min(...bars.slice(1, 4).map((b) => Math.min(...b)), k.prior / 100, k.current / 100);
  const hi = Math.max(...bars.slice(1, 4).map((b) => Math.max(...b)), k.prior / 100, k.current / 100);
  const pad = (hi - lo) * 0.6 || hi * 0.05;
  const opts = baseOptions(c, "US$ billions", "");
  opts.layout = { padding: { top: 18, right: 6 } };
  opts.interaction = { mode: "nearest", intersect: true };
  // When the full step names are wider than the space each bar has, they shorten so they
  // don't run together; the tooltip and the table beside the chart keep the full names.
  const narrow = [[String(year - 1), "revenue"], ["Backlog"], ["Conv."], ["Overlap"], [String(year), "revenue"]];
  const need = widest(labels.flat(), opts.scales.x.ticks.font.size) + 4;
  opts.scales.x.ticks.callback = function (v, i) {
    const ch = this.chart, a = ch.chartArea;
    const per = (a ? a.right - a.left : ch.width - 70) / labels.length;
    return per >= need ? labels[i] : narrow[i];
  };
  const yLo = Math.max(0, (lo - pad) / 1e9), yHi = (hi + pad * 0.5) / 1e9;
  let step = Math.pow(10, Math.floor(Math.log10(yHi - yLo)));
  if ((yHi - yLo) / step < 3) step /= 2;
  const yMin = Math.floor(yLo / step) * step;
  Object.assign(opts.scales.y, { min: yMin, max: Math.ceil(yHi / step) * step });
  opts.scales.y.ticks.stepSize = step;

  const fills = kinds.map((x) => (x === "total" ? c.ink : x === "up" ? c.fav : x === "down" ? c.unfav : c.axis));
  // Under $50M a step reads in millions, to the same tenth as the table beside the chart.
  const fmt = (v, i) => (kinds[i] === "total" ? usdB(v) : Math.abs(v) < 5e7 ? signedM(v, 1) : signedB(v));
  upsert("c-bridge", {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: bars.map((b) => [b[0] / 1e9, b[1] / 1e9]),
        backgroundColor: fills, hoverBackgroundColor: fills,
        borderSkipped: false, barPercentage: 0.62, categoryPercentage: 0.9, maxBarThickness: 64
      }]
    },
    options: opts
  }, {
    $colors: c,
    $connectors: true,
    $values: values.map(fmt),
    $tip: (pts) => {
      const i = pts[0].dataIndex, cts = [k.prior, k.backlog, k.conv, k.overlap, k.current][i];
      return { rows: [{ color: fills[i], label: labels[i].join(" "), value: fmt(values[i], i), extra: usdCents(cts) }] };
    }
  });

  renderBridgeTable(r, year);

  const change = r.current - r.prior;
  const cap = `${year} revenue ${change >= 0 ? "rose" : "fell"} ${usdB(Math.abs(change))} to ${usdB(r.current)}. ` +
    `Backlog effect ${fmt(steps[0], 1)}, conversion effect ${fmt(steps[1], 2)}, overlap ${fmt(steps[2], 3)}. ` +
    driver(steps[0], steps[1]) +
    (rate(r.convPrior) === rate(r.conv) ? `Conversion held at ${rate(r.conv)} of starting backlog.`
      : `Conversion went from ${rate(r.convPrior)} to ${rate(r.conv)} of starting backlog.`) +
    (yMin > 0 ? " The axis starts above zero." : "");
  $("bridge-cap").textContent = cap;
  describe("c-bridge", `${t} revenue bridge for ${year}. ${cap}`);
  return null;
}

// The bridge as a table in US$ millions to one decimal. Each figure is its own value rounded
// once, so no printed step is off by more than half a tenth; when those roundings do not
// add up, a rounding line takes up the difference and the column still foots as printed.
// The last row checks the bridge identity itself, in dollars, to the cent.
function renderBridgeTable(r, year) {
  const k = r.c, unit = 1e7;  // cents per $0.1M
  const P = Math.round(k.prior / unit), C = Math.round(k.current / unit);
  const B = Math.round(k.backlog / unit), V = Math.round(k.conv / unit), O = Math.round(k.overlapRaw / unit);
  const R = C - P - B - V - O;
  const tenths = (x) => x * 1e5;
  const sign = (x) => (x > 0 ? "fav" : x < 0 ? "unfav" : "");
  const rows = [
    [`${year - 1} revenue (GAAP)`, usdM(tenths(P), 1), ""],
    ["Backlog effect", signedM(tenths(B), 1), sign(k.backlog)],
    ["Conversion effect", signedM(tenths(V), 1), sign(k.conv)],
    ["Overlap", signedM(tenths(O), 1), sign(k.overlapRaw)]
  ];
  if (R) rows.push(["Rounding to $0.1M", signedM(tenths(R), 1), ""]);
  rows.push([`${year} revenue (GAAP)`, usdM(tenths(C), 1), "total"]);
  const diff = cents(r.current - r.prior - r.backlogEffect - r.convEffect - r.interaction);
  const html = '<table class="mini"><caption class="sr-only">Revenue bridge, ' + year + ", US$ millions</caption>" +
    '<thead><tr><th scope="col">Step</th><th scope="col" class="n">US$M</th></tr></thead><tbody>' +
    rows.map(([a, b, cls]) => `<tr class="${cls === "total" ? "total" : ""}"><th scope="row">${a}</th>` +
      `<td class="n ${cls !== "total" ? cls : ""}">${cls === "fav" ? "▲ " : cls === "unfav" ? "▼ " : ""}${b}</td></tr>`).join("") +
    `</tbody><tfoot><tr><th scope="row">Check, to the cent</th><td class="n ${diff === 0 ? "ok" : "unfav"}">${diff === 0 ? "✓ " : "✗ "}${usdCents(diff)}</td></tr></tfoot></table>`;
  $("bridge-table").innerHTML = html;
}
