/* Shared chart machinery: one Chart.js plugin for every custom drawing, one HTML tooltip,
   one options builder with explicit axes, the legend, linked crosshairs and keyboard reading.
   Chart.js is loaded as a classic script before the modules, so it is the global `Chart`. */

import { $, el, still, fade, announce } from "../dom.js";
import { usdB, spoken } from "../format.js";
import { keyHelp } from "../copy.js";
import { setHelp, infoButton } from "../help.js";

export const charts = {};
const LINKED = ["c-backlog", "c-btb", "c-fc"];  // charts whose crosshairs follow one another by quarter

/* ---------- the plugin ---------- */

const theme = {
  id: "dbfTheme",
  beforeDatasetsDraw(chart) {
    if (chart.$future != null) drawFuture(chart);
    if (chart.$upto != null) drawGhost(chart);
    const ctx = chart.ctx;
    ctx.save();
    if (chart.$upto != null) {
      ctx.beginPath();
      ctx.rect(0, 0, headX(chart) + 1, chart.height);
      ctx.clip();
    }
    if (chart.$band) drawBand(chart);
    if (chart.$baseline != null) drawBaseline(chart);
    if (chart.$crosshair) drawCrosshair(chart);
  },
  afterDatasetsDraw(chart) {
    if (chart.$miss && chart.$upto == null) drawMiss(chart);
    if (chart.$connectors) drawConnectors(chart);
    chart.ctx.restore();
    if (chart.$upto != null) {
      if (chart.$miss) drawMiss(chart);
      drawHead(chart);
    } else if (chart.$ends) drawEnds(chart);
    if (chart.$link != null && chart.config.type === "line") drawLink(chart);
  }
};

export function font(size, weight = 600) { return weight + " " + size + "px " + Chart.defaults.font.family; }

// A solid crosshair where the pointer is; a dashed one where a linked chart's pointer is.
function drawCrosshair(chart) {
  const a = chart.chartArea, ctx = chart.ctx;
  const act = chart.tooltip ? chart.tooltip.getActiveElements() : [];
  const cx = act.length ? act[0].element.x : chart.$link != null ? chart.scales.x.getPixelForValue(chart.$link) : null;
  if (cx == null) return;
  const x = Math.round(cx) + 0.5;
  ctx.beginPath();
  ctx.moveTo(x, a.top);
  ctx.lineTo(x, a.bottom);
  ctx.lineWidth = 1;
  ctx.strokeStyle = chart.$colors.cross;
  if (!act.length) ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// A reference rule across the plot at one value, such as book-to-bill of 1.0×.
function drawBaseline(chart) {
  const a = chart.chartArea, ctx = chart.ctx, y = Math.round(chart.scales.y.getPixelForValue(chart.$baseline)) + 0.5;
  if (y < a.top || y > a.bottom) return;
  ctx.save();
  ctx.strokeStyle = chart.$colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.left, y);
  ctx.lineTo(a.right, y);
  ctx.stroke();
  ctx.restore();
}

// Where another chart is pointing, mark each line's value at that quarter.
function drawLink(chart) {
  const ctx = chart.ctx, act = chart.tooltip ? chart.tooltip.getActiveElements() : [];
  if (act.length) return;
  ctx.save();
  chart.data.datasets.forEach((ds, i) => {
    if (!chart.isDatasetVisible(i)) return;
    const p = chart.getDatasetMeta(i).data[chart.$link];
    if (!p || p.skip || !isFinite(p.y)) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = ds.borderColor;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = chart.$colors.surface;
    ctx.stroke();
  });
  ctx.restore();
}

/** Pointing at a quarter in one linked chart marks the same quarter in the others. */
export function linkHover(evt, els, chart) {
  const label = els && els.length && evt.type !== "mouseout" ? chart.data.labels[els[0].index] : null;
  LINKED.forEach((id) => {
    const ch = charts[id];
    if (!ch || ch === chart) return;
    const i = label == null ? -1 : ch.data.labels.indexOf(label), v = i < 0 ? null : i;
    if (ch.$link !== v) { ch.$link = v; ch.draw(); }
  });
}

// The replay head's x position, between two forecasts while it moves.
export function headX(chart) {
  const xs = chart.scales.x, u = chart.$upto, i = Math.floor(u), f = u - i;
  const x0 = xs.getPixelForValue(i), n = chart.data.labels.length;
  return i + 1 < n ? x0 + (xs.getPixelForValue(i + 1) - x0) * f : x0;
}

// During a replay, Actual stays on screen as a faint track ahead of the head.
function drawGhost(chart) {
  if (!chart.isDatasetVisible(0)) return;
  const pts = chart.getDatasetMeta(0).data, ctx = chart.ctx;
  let pen = false;
  ctx.save();
  ctx.strokeStyle = chart.$colors.track;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p) => {
    if (!p || p.skip || !isFinite(p.y)) { pen = false; return; }
    if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    pen = true;
  });
  ctx.stroke();
  ctx.restore();
}

// The replay head: a dotted rule at the forecast being read, labelled with its quarter.
function drawHead(chart) {
  const a = chart.chartArea, ctx = chart.ctx, c = chart.$colors, x = Math.round(headX(chart)) + 0.5;
  ctx.save();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(x, a.top);
  ctx.lineTo(x, a.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  if (chart.$headLabel) {
    ctx.font = font(11);
    ctx.textBaseline = "middle";
    const w = ctx.measureText(chart.$headLabel).width + 10, h = 18;
    const bx = Math.max(a.left, Math.min(x - w / 2, a.right - w)), by = a.top;
    ctx.fillStyle = c.ink;
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = c.surface;
    ctx.textAlign = "center";
    ctx.fillText(chart.$headLabel, bx + w / 2, by + h / 2 + 0.5);
  }
  ctx.restore();
}

// The gap between the backlog forecast and Actual, shaded so every miss reads as an area.
// Neutral: a miss is shown by its size, and judged against the baselines elsewhere.
function drawBand(chart) {
  if (!chart.isDatasetVisible(0) || !chart.isDatasetVisible(1)) return;
  const A = chart.getDatasetMeta(0).data, B = chart.getDatasetMeta(1).data, ctx = chart.ctx;
  const ok = (p) => p && !p.skip && isFinite(p.y);
  ctx.save();
  ctx.fillStyle = chart.$colors.band;
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      ctx.beginPath();
      run.forEach((i, j) => (j ? ctx.lineTo(A[i].x, A[i].y) : ctx.moveTo(A[i].x, A[i].y)));
      for (let j = run.length - 1; j >= 0; j--) ctx.lineTo(B[run[j]].x, B[run[j]].y);
      ctx.closePath();
      ctx.fill();
    }
    run = [];
  };
  for (let i = 0; i < A.length; i++) { if (ok(A[i]) && ok(B[i])) run.push(i); else flush(); }
  flush();
  ctx.restore();
}

// The forecast span of the scenario fan, as a light wash with its name at the top.
function drawFuture(chart) {
  const a = chart.chartArea, ctx = chart.ctx, c = chart.$colors;
  const x = chart.scales.x.getPixelForValue(chart.$future);
  ctx.save();
  ctx.fillStyle = c.wash;
  ctx.fillRect(x, a.top, a.right - x, a.bottom - a.top);
  if (chart.$futureLabel) {
    ctx.font = font(11);
    ctx.fillStyle = c.muted;
    ctx.textBaseline = "top";
    ctx.fillText(chart.$futureLabel, x + 6, a.top + 4);
  }
  ctx.restore();
}

// Each line's latest value at its right end, anchored to the line by a leader, nudged
// apart so none overlap.
function drawEnds(chart) {
  const a = chart.chartArea, ctx = chart.ctx, c = chart.$colors, items = [];
  chart.data.datasets.forEach((ds, i) => {
    if (!chart.isDatasetVisible(i)) return;
    if (chart.$endKeys && !chart.$endKeys.includes(ds.key)) return;
    let j = ds.data.length - 1;
    while (j >= 0 && ds.data[j] == null) j--;
    const p = j >= 0 ? chart.getDatasetMeta(i).data[j] : null;
    if (!p || !isFinite(p.y)) return;
    items.push({ y: p.y, px: p.x, py: p.y, text: usdB(ds.data[j] * 1e9), color: ds.borderColor });
  });
  items.sort((p, q) => p.y - q.y);
  for (let k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < 14) items[k].y = items[k - 1].y + 14;
  const over = items.length ? items[items.length - 1].y - (a.bottom - 2) : 0;
  if (over > 0) items.forEach((it) => { it.y -= over; });
  ctx.save();
  ctx.font = font(12);
  ctx.textBaseline = "middle";
  items.forEach((it) => {
    const x = a.right + 6;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(it.px, it.py);
    ctx.lineTo(x + 6, it.y);
    ctx.stroke();
    ctx.fillStyle = c.ink2;
    ctx.fillText(it.text, x + 9, it.y);
  });
  ctx.restore();
}

// The largest miss: a ring on the forecast and a bracket to what happened, in ink.
function drawMiss(chart) {
  const m = chart.$miss, c = chart.$colors, ctx = chart.ctx;
  if (m.index < 0 || !chart.isDatasetVisible(m.ds)) return;
  const p = chart.getDatasetMeta(m.ds).data[m.index];
  if (!p || p.skip || !isFinite(p.y)) return;
  const q = chart.isDatasetVisible(m.ref) ? chart.getDatasetMeta(m.ref).data[m.index] : null;
  const hasQ = q && !q.skip && isFinite(q.y);
  ctx.save();
  ctx.strokeStyle = c.ink;
  if (hasQ) {
    const x = Math.round(p.x) + 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, p.y);
    ctx.lineTo(x, q.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (m.label) {
    // A boxed tag beside the ring, so it reads over the lines. It goes right of the ring,
    // else left, and always stays inside the plot; on a narrow plot it drops to the figure.
    const a = chart.chartArea, size = a.right - a.left < 360 ? 11 : 12, gap = 8, padX = 4, h = size + 6;
    ctx.font = font(size);
    const room = Math.max(a.right - p.x, p.x - a.left) - gap;
    const text = m.short && ctx.measureText(m.label).width + 2 * padX > room ? m.short : m.label;
    const w = ctx.measureText(text).width + 2 * padX;
    let bx = p.x + gap;
    if (bx + w > a.right) bx = p.x - gap - w;
    bx = Math.max(a.left + 2, Math.min(bx, a.right - 2 - w));
    const mid = hasQ ? (p.y + q.y) / 2 : p.y;
    const by = Math.max(a.top + 2, Math.min(mid - h / 2, a.bottom - 2 - h));
    ctx.fillStyle = c.surface;
    ctx.fillRect(bx, by, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.axis;
    ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(w), Math.round(h));
    ctx.fillStyle = c.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + padX, by + h / 2 + 0.5);
  }
  ctx.restore();
}

// Waterfall: a hairline from where each step ends to where the next starts, and each
// bar's value just above it. A label with no room is dropped; the table beside it has all.
function drawConnectors(chart) {
  const bars = chart.getDatasetMeta(0).data, ctx = chart.ctx;
  ctx.save();
  ctx.strokeStyle = chart.$colors.axis;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (let i = 0; i < bars.length - 1; i++) {
    const a = bars[i], b = bars[i + 1], y = Math.round(a.y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(a.x + a.width / 2, y);
    ctx.lineTo(b.x - b.width / 2, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const size = chart.width < 400 ? 11 : 12, placed = [], top = chart.chartArea.top - 16;
  ctx.font = font(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = chart.$colors.ink2;
  bars.forEach((bar, j) => {
    if (!chart.$values) return;
    const text = chart.$values[j], w = ctx.measureText(text).width + 6;
    const box = { l: bar.x - w / 2, r: bar.x + w / 2, b: Math.min(bar.y, bar.base) - 3 };
    const hits = () => placed.some((p) => box.l < p.r && box.r > p.l && box.b > p.b - size - 2 && box.b - size - 2 < p.b);
    while (hits() && box.b - size > top) box.b -= size + 3;
    if (hits() || box.b - size < top) return;
    placed.push(box);
    ctx.fillText(text, bar.x, box.b);
  });
  ctx.restore();
}

/* ---------- tooltip ---------- */

// One HTML tooltip for every chart, with figures right-aligned in their own columns.
function externalTip(context) {
  const chart = context.chart, model = context.tooltip, box = chart.canvas.parentNode;
  let tip = box.querySelector(".tip");
  if (!tip) {
    tip = el("div", "tip");
    tip.setAttribute("aria-hidden", "true");
    box.appendChild(tip);
  }
  const spec = model.opacity && model.dataPoints && model.dataPoints.length && chart.$tip ? chart.$tip(model.dataPoints) : null;
  if (!spec) { tip.classList.remove("show"); return; }
  tip.textContent = "";
  if (spec.title) tip.appendChild(el("div", "tip-title", spec.title));
  const rows = el("div", "tip-rows");
  spec.rows.forEach((r) => {
    const sw = el("span", "tip-sw" + (r.dash ? " dash" : ""));
    sw.style.setProperty("--c", r.color);
    rows.appendChild(sw);
    rows.appendChild(el("span", "tip-label", r.label));
    rows.appendChild(el("span", "tip-val", r.value));
    rows.appendChild(el("span", "tip-x", r.extra || ""));
  });
  tip.appendChild(rows);
  if (spec.note) {
    const note = el("div", "tip-note");
    note.appendChild(el("strong", "", spec.note[0]));
    note.appendChild(document.createTextNode(" " + spec.note[1]));
    tip.appendChild(note);
  }
  const W = box.clientWidth, H = box.clientHeight, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = model.caretX + 14;
  if (x + w > W) x = model.caretX - 14 - w;
  x = Math.max(0, Math.min(x, W - w));
  const y = Math.max(0, Math.min(model.caretY - h / 2, H - h));
  tip.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  tip.classList.add("show");
}

/* ---------- options ---------- */

const tickB = (v) => (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US") + "B";

/**
 * Shared options with explicit axes: an axis line and tick marks on both axes, and a
 * title on each that names the unit and scale.
 * @param c       colours from colors()
 * @param yTitle  y-axis title, e.g. "US$ billions"
 * @param xTitle  x-axis title, or "" for none
 * @param yTick   tick formatter; dollars in billions by default
 */
export function baseOptions(c, yTitle, xTitle, yTick = tickB) {
  const tick = { size: 11 };
  const axisTitle = (text) => ({ display: !!text, text, color: c.muted, font: { size: 11, weight: 600 }, padding: 4 });
  return {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),
    animation: still() ? false : { duration: 250 },
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 4, right: 72 } },
    plugins: { legend: { display: false }, tooltip: { enabled: false, external: externalTip } },
    scales: {
      x: {
        title: axisTitle(xTitle),
        ticks: { color: c.muted, font: tick, maxRotation: 0, autoSkip: false, padding: 4, callback: yearTick },
        grid: { display: true, drawOnChartArea: false, drawTicks: true, tickLength: 4, color: c.axis },
        border: { display: true, color: c.axis, width: 1 }
      },
      y: {
        title: axisTitle(yTitle),
        ticks: { color: c.muted, font: tick, padding: 4, maxTicksLimit: 6, callback: yTick },
        grid: { color: c.grid, drawTicks: true, tickLength: 4, tickColor: c.axis },
        border: { display: true, color: c.axis, width: 1 }
      }
    }
  };
}

// Quarterly axes are labelled at each year's first quarter (every other year when narrow).
// Each Q1 gets a tick mark; tooltips name the exact quarter.
function yearTick(value) {
  const q = this.getLabelForValue(value);
  if (typeof q !== "string" || !/Q1$/.test(q)) return "";
  const y = +q.slice(0, 4);
  const years = this.chart.data.labels.filter((l) => /Q1$/.test(l)).length;
  return this.chart.width < 520 && years > 6 && y % 2 ? "" : String(y);
}

/** Charts that share a quarter axis: one y-axis width, so stacked plots line up. */
export function linked(opts) {
  opts.scales.y.afterFit = (scale) => { scale.width = 64; };
  opts.onHover = linkHover;
  return opts;
}

export function lineSet(c, label, values, color, width, key, dash) {
  return {
    label, data: values, key, $color: color,
    borderColor: color, backgroundColor: color, borderWidth: width, borderDash: dash || [],
    borderCapStyle: "round", borderJoinStyle: "round", tension: 0, spanGaps: false,
    pointRadius: 0, pointHitRadius: 6, pointHoverRadius: 4,
    pointHoverBackgroundColor: color, pointHoverBorderColor: c.surface, pointHoverBorderWidth: 2
  };
}

/* ---------- create or update ---------- */

let registered = false;

/** Create a chart once; after that change it in place. Extras are attached before the redraw. */
export function upsert(id, config, extras) {
  if (!registered) { Chart.register(theme); registered = true; }
  let ch = charts[id];
  if (!ch) {
    ch = charts[id] = new Chart($(id), config);
    Object.assign(ch, extras);
    if (LINKED.includes(id)) $(id).addEventListener("mouseleave", () => linkHover({ type: "mouseout" }, [], ch));
    ch.update("none");
    return ch;
  }
  Object.assign(ch, extras);
  ch.$spot = undefined;
  ch.data.labels = config.data.labels;
  const cur = ch.data.datasets;
  config.data.datasets.forEach((ds, i) => {
    if (cur[i]) Object.keys(ds).forEach((k) => { cur[i][k] = ds[k]; });
    else cur.push(ds);
  });
  cur.length = config.data.datasets.length;
  ch.options = config.options;
  ch.update();
  return ch;
}

/** A chart's summary for screen readers, in spoken units. */
export function describe(id, text) { $(id).setAttribute("aria-label", spoken(text)); }

/* ---------- legend ---------- */

// Pointing at a legend entry dims every other line.
function spotlight(chart, i) {
  if (chart.$spot === i) return;
  chart.$spot = i;
  chart.data.datasets.forEach((ds, j) => {
    const col = i == null || j === i ? ds.$color : fade(ds.$color, 0.18);
    ds.borderColor = col;
    ds.backgroundColor = col;
  });
  chart.update("none");
}

/**
 * HTML legend: one toggle per line, drawn in the line's own style (solid or dashed), with
 * its basis tag and a definition button for any term of art. Pressing it hides the line.
 */
export function renderLegend(boxId, chart, which, view, basis) {
  const box = $(boxId), sets = chart.data.datasets;
  if (box.children.length !== sets.length) {
    box.textContent = "";
    sets.forEach((ds, i) => {
      const item = el("span", "key");
      const b = el("button", "chip");
      b.type = "button";
      b.appendChild(el("span", "chip-sw"));
      b.appendChild(el("span", "chip-label"));
      b.appendChild(el("span", "tag"));
      b.addEventListener("click", () => {
        const show = !chart.isDatasetVisible(i);
        chart.setDatasetVisibility(i, show);
        chart.$spot = undefined;
        spotlight(chart, null);
        b.setAttribute("aria-pressed", show ? "true" : "false");
      });
      const on = () => { if (chart.isDatasetVisible(i)) spotlight(chart, i); };
      const off = () => spotlight(chart, null);
      b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") on(); });
      b.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") off(); });
      b.addEventListener("focus", () => { if (b.matches(":focus-visible")) on(); });
      b.addEventListener("blur", off);
      item.appendChild(b);
      item.appendChild(infoButton(null));
      box.appendChild(item);
    });
  }
  sets.forEach((ds, i) => {
    const item = box.children[i], b = item.querySelector(".chip"), sw = b.querySelector(".chip-sw");
    sw.style.setProperty("--c", ds.$color || ds.borderColor);
    sw.classList.toggle("dash", !!(ds.borderDash && ds.borderDash.length));
    b.querySelector(".chip-label").textContent = ds.label;
    b.querySelector(".tag").textContent = basis[ds.key] || "";
    b.setAttribute("aria-pressed", chart.isDatasetVisible(i) ? "true" : "false");
    setHelp(item.querySelector(".info"), keyHelp(which, view, ds.key));
  });
}

/* ---------- reading a chart from the keyboard ---------- */

function pointsAt(ch, i) {
  const out = [];
  ch.data.datasets.forEach((ds, j) => {
    if (!ch.isDatasetVisible(j) || ds.key === "s" || ds.data[i] == null) return;
    out.push({ dataIndex: i, datasetIndex: j, index: i, dataset: ds, raw: ds.data[i], element: ch.getDatasetMeta(j).data[i] });
  });
  return out;
}

function stops(ch) {
  const out = [];
  for (let i = 0; i < ch.data.labels.length; i++) {
    const pts = pointsAt(ch, i);
    if (pts.length && ch.$tip && ch.$tip(pts)) out.push(i);
  }
  return out;
}

function tipText(spec) {
  return [spec.title].concat(spec.rows.map((r) => r.label + " " + r.value + (r.extra ? ", " + r.extra : "")))
    .filter(Boolean).join(". ") + ".";
}

export function clearTips() {
  Object.values(charts).forEach((ch) => {
    const act = ch.tooltip ? ch.tooltip.getActiveElements() : [];
    if (ch.$link == null && !act.length) return;
    ch.$link = null;
    ch.setActiveElements([]);
    if (ch.tooltip) ch.tooltip.setActiveElements([], { x: 0, y: 0 });
    ch.update("none");
  });
}

// A focused chart steps through its points with the arrow keys, showing the same tooltip
// and linked crosshairs a pointer would, and speaking the tooltip's rows.
function stepChart(e) {
  const id = e.currentTarget.id, ch = charts[id];
  if (!ch) return;
  if (e.key === "Escape") {
    if (ch.$kbd == null) return;
    ch.$kbd = null;
    clearTips();
    return;
  }
  const list = stops(ch);
  if (!list.length) return;
  const at = list.indexOf(ch.$kbd);
  let j;
  if (e.key === "ArrowRight") j = at < 0 ? 0 : Math.min(list.length - 1, at + 1);
  else if (e.key === "ArrowLeft") j = at < 0 ? list.length - 1 : Math.max(0, at - 1);
  else if (e.key === "Home") j = 0;
  else if (e.key === "End") j = list.length - 1;
  else return;
  e.preventDefault();
  const i = list[j], pts = pointsAt(ch, i);
  ch.$kbd = i;
  const act = pts.map((p) => ({ datasetIndex: p.datasetIndex, index: i }));
  const el0 = pts[0].element;
  ch.setActiveElements(act);
  if (ch.tooltip) ch.tooltip.setActiveElements(act, { x: el0 ? el0.x : 0, y: el0 ? el0.y : 0 });
  ch.update("none");
  if (LINKED.includes(id)) linkHover({ type: "keydown" }, act, ch);
  announce(tipText(ch.$tip(pts)), 150);
}

export function watchCharts() {
  ["c-backlog", "c-btb", "c-fc", "c-bridge", "c-fan"].forEach((id) => {
    const canvas = $(id);
    canvas.addEventListener("keydown", stepChart);
    canvas.addEventListener("blur", () => {
      const ch = charts[id];
      if (ch && ch.$kbd != null) { ch.$kbd = null; clearTips(); }
    });
  });
  // Touch has no mouseout: tapping elsewhere, or scrolling, clears a tooltip.
  let touched = false;
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    if (e.target.closest && e.target.closest(".chart")) { touched = true; return; }
    if (touched) { touched = false; clearTips(); }
  }, { passive: true });
  window.addEventListener("scroll", () => { if (touched) { touched = false; clearTips(); } }, { passive: true });
  // A hidden tooltip keeps its last position. After the window narrows (a phone turned
  // upright) that can sit past the new edge and widen the page, so it goes back to 0.
  window.addEventListener("resize", () => {
    document.querySelectorAll(".tip").forEach((t) => { if (!t.classList.contains("show")) t.style.transform = ""; });
  });
}
