/* Dashboard for the defense backlog forecast. Every figure comes from data.json. */
(function () {
  "use strict";

  var NAMES = {
    h1: { backlog: "Backlog model", naive: "Seasonal naive", naive_drift: "Seasonal naive with drift" },
    h4: { backlog: "Backlog model", naive: "Trailing 4Q", naive_drift: "Trailing 4Q with drift" }
  };
  var PHRASE = {
    backlog: "the backlog model",
    naive: "repeating the last four quarters' revenue",
    naive_drift: "repeating the last four quarters' revenue grown at its recent rate"
  };
  var MODELS = ["backlog", "naive", "naive_drift"];
  // A plain description under each model's name in the scoreboard.
  var GLOSS = {
    backlog: "Backlog × past conversion rate",
    naive: "Last four quarters, repeated",
    naive_drift: "Last four quarters, plus recent growth"
  };
  var TITLE = document.title;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* ---------- helper text for a broad audience ----------
     It sits beside the checked copy and never
     replaces it, and it holds no figures: every number still comes from data.json. */
  var COMPANY = {
    HII: "Huntington Ingalls Industries",
    LHX: "L3Harris Technologies",
    LMT: "Lockheed Martin",
    NOC: "Northrop Grumman",
    RTX: "RTX"
  };
  var HELP = {
    rpo: { ask: "What is backlog?", terms: [["Backlog (RPO)", "Remaining performance obligations: the value of work a company is under contract to deliver but has not yet recognised as revenue. It is taken from each filing as first reported."]] },
    mape: { ask: "What is the average forecast miss?", terms: [["Average forecast miss (pooled MAPE)", "The average size of each forecast's miss as a share of actual revenue, across every forecast for all five companies. It ignores whether a forecast was too high or too low."]] },
    model: { ask: "What is the backlog model?", terms: [["Backlog model", "Multiplies the latest backlog by the share of backlog that turned into revenue in comparable periods one to two years earlier."]] },
    trailing: { ask: "What is trailing 4Q?", terms: [["Trailing 4Q", "Assumes the next four quarters bring the same revenue as the last four."]] },
    trailing_drift: { ask: "What is trailing 4Q with drift?", terms: [["Trailing 4Q with drift", "The last four quarters' revenue, grown at the rate it grew over the year before."]] },
    seasonal: { ask: "What is seasonal naive?", terms: [["Seasonal naive", "Assumes next quarter's revenue matches the same quarter a year earlier."]] },
    seasonal_drift: { ask: "What is seasonal naive with drift?", terms: [["Seasonal naive with drift", "The same quarter a year earlier, grown at the rate trailing revenue grew over the past year."]] },
    bridge: { ask: "What are conversion rate and overlap?", terms: [
      ["Conversion rate", "The share of the backlog at the start of a year that became revenue during that year."],
      ["Overlap (interaction)", "The part of the change that comes from backlog and conversion moving at the same time, so the three effects add up exactly."]] },
    shock: { ask: "What is a change in backlog?", terms: [["Change in backlog", "A hypothetical rise or fall in today's backlog, as a percentage of it."]] },
    shift: { ask: "What is a change in conversion rate?", terms: [["Change in conversion rate (pp)", "A hypothetical change to the conversion rate, in percentage points: an absolute change in the rate, not a percentage of it."]] },
    btb: { ask: "What is implied book-to-bill?", terms: [
      ["Implied book-to-bill", "Orders implied by the filings, divided by the quarter's revenue. The implied orders are the change in backlog plus the quarter's revenue, so above 1 means backlog grew that quarter."],
      ["A residual, not an orders figure", "The implied orders also absorb cancellations, currency moves and acquisitions, so a single quarter can jump."]] },
    cards: { ask: "What do the company cards show?", terms: [
      ["Backlog better or worse", "Whether the backlog model's four-quarter forecasts for that company missed by less or by more, on average, than repeating the last four quarters' revenue."],
      ["Years of revenue in backlog", "The latest backlog divided by revenue over the last four quarters: roughly how many years of signed work are on the books at the current pace."],
      ["The small chart", "Backlog (the coloured line and shading) and revenue over the trailing four quarters (the dark line), on one scale starting at zero."]] }
  };
  var APE_NOTE = ["Off by:", "how far the forecast was from actual revenue, as a share of actual."];
  var TABLE_SHOW = "Show as table", TABLE_HIDE = "Hide table";

  // Which definition sits beside each key entry.
  function keyHelp(chartId, view, key) {
    if (chartId === "c-backlog") return key === "backlog" ? "rpo" : null;
    if (key === "backlog") return "model";
    if (key === "naive") return view === "h1" ? "seasonal" : "trailing";
    if (key === "naive_drift") return view === "h1" ? "seasonal_drift" : "trailing_drift";
    return null;
  }
  var TWEEN_MS = 250;      // what-if number tween
  var PANEL_INDEX = { "c-backlog": 3, "c-btb": 3, "c-fc": 4, "c-bridge": 5, "c-fan": 6 };
  var LINKED = ["c-backlog", "c-btb", "c-fc"];   // charts whose crosshairs follow one another by quarter
  var REPLAY_STEP_MS = 280; // time the replay spends on each forecast
  var LAST_INTRO = 8;      // highest --i in index.html

  var data, tickers, charts = {};
  var state = { ticker: null, view: "h4", year: null, shock: null, shift: null };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var coarse = window.matchMedia("(pointer: coarse)");
  var darkMode = window.matchMedia("(prefers-color-scheme: dark)");
  var introDone = false, introAt = 0;

  function $(id) { return document.getElementById(id); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function ms(name) { var v = css(name); return /ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000 || 0; }
  function still() { return reduceMotion.matches; }
  function colors() {
    return {
      ink: css("--ink"), muted: css("--muted"), grid: css("--grid"), accent: css("--accent"),
      naive: css("--naive"), drift: css("--drift"), surface: css("--surface"), line: css("--line"),
      cross: css("--crosshair"), ink2: css("--ink-2"), accentSoft: css("--accent-soft"),
      track: css("--track-strong"), wash: css("--hover")
    };
  }
  function modelColor(c, m) { return m === "backlog" ? c.accent : m === "naive" ? c.naive : c.drift; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function billions(v) { return v == null ? "n/a" : "$" + (v / 1e9).toFixed(1) + "B"; }
  function signedBillions(v) {
    if (Math.abs(v) < 5e7) return "under $0.1B";
    return (v < 0 ? "−" : "+") + "$" + Math.abs(v / 1e9).toFixed(1) + "B";
  }
  function pct(v) { return v == null ? "n/a" : v.toFixed(1) + "%"; }
  function signedPct(v, unit) { return (v < 0 ? "−" : v > 0 ? "+" : "") + Math.abs(v).toString() + (unit || "%"); }
  function rate(v) { return Math.round(v * 100) + "%"; }
  function longDate(iso) {
    var p = iso.split("-");
    return +p[2] + " " + MONTHS[+p[1] - 1] + " " + p[0];
  }
  function ape(f, a) { return f == null || a == null ? null : Math.abs(a - f) / a * 100; }

  // The same figures as a screen reader should say them: "$12.3 billion", "1.5 percentage
  // points". Visible text keeps the compact forms.
  function spoken(text) {
    return String(text)
      .replace(/\$(\d[\d.,]*)B\b/g, "$$$1 billion")
      .replace(/(\d)\s?pp\b/g, "$1 percentage points");
  }

  // One polite live region for what a change did. Rapid changes (a slider drag, arrow
  // presses) restart the wait, so only the settled state is spoken. Clearing it first
  // makes a repeat of the same sentence speak again.
  var announceTimer = 0;
  function announce(text, wait) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      var box = $("announce");
      if (!box) return;
      box.textContent = "";
      setTimeout(function () { box.textContent = spoken(text); }, 30);
    }, wait == null ? 400 : wait);
  }

  /* ---------- motion ---------- */

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // Tween a number with requestAnimationFrame. The last frame always writes `to` exactly.
  // Returns a function that stops it, so a newer tween can take over mid-flight.
  function tween(from, to, dur, step) {
    if (still() || document.hidden || !(dur > 0) || from === to) { step(to); return function () {}; }
    var t0 = null, raf;
    function frame(now) {
      if (t0 == null) t0 = now;
      var p = Math.min(1, (now - t0) / dur);
      step(p === 1 ? to : from + (to - from) * easeOut(p));
      if (p < 1) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return function () { cancelAnimationFrame(raf); };
  }

  // Slide a segmented control's pill to its selected option, FLIP-style: jump to the
  // new box, invert back to the old one with a transform, then let the transition play.
  function placePill(group, animate) {
    var pill = group.querySelector(".pill");
    var on = group.querySelector('[aria-selected="true"], [aria-pressed="true"]');
    if (!pill || !on) return;
    var first = pill._box, last = { x: on.offsetLeft, w: on.offsetWidth };
    pill.style.width = last.w + "px";
    if (animate && first && !still() && (first.x !== last.x || first.w !== last.w)) {
      pill.style.transition = "none";
      pill.style.transform = "translateX(" + first.x + "px) scaleX(" + first.w / last.w + ")";
      void pill.offsetWidth;
      pill.style.transition = "";
    }
    pill.style.transform = "translateX(" + last.x + "px)";
    pill._box = last;
  }

  function addPill(group) {
    var pill = el("span", "pill");
    pill.setAttribute("aria-hidden", "true");
    group.insertBefore(pill, group.firstChild);
    if (window.ResizeObserver) new ResizeObserver(function () { placePill(group, false); }).observe(group);
  }

  // The label is drawn twice: ink on the track, and a light copy (CSS ::before, from
  // data-label and hidden from assistive tech) that fades in over the pill.
  function twoTone(button, text) {
    button.textContent = "";
    button.setAttribute("data-label", text);
    button.appendChild(el("span", "lbl", text));
  }

  /* ---------- chart theme ---------- */

  // Draw-in clip, replay head, miss band, crosshair, largest-miss marker and waterfall
  // connectors, in one plugin.
  var theme = {
    id: "dbfTheme",
    beforeDatasetsDraw: function (chart) {
      var a = chart.chartArea, ctx = chart.ctx, r = chart.$reveal == null ? 1 : chart.$reveal;
      if (chart.$future != null) drawFuture(chart);
      if (chart.$upto != null) drawGhost(chart);
      ctx.save();
      if (r < 1 || chart.$upto != null) {
        var right = a.left - 4 + (a.right - a.left + 12) * r;
        if (chart.$upto != null) right = Math.min(right, headX(chart) + 1);
        ctx.beginPath();
        ctx.rect(0, 0, right, chart.height);
        ctx.clip();
      }
      if (chart.$band) drawBand(chart);
      if (chart.$baseline != null) drawBaseline(chart);
      // A solid crosshair where the pointer is; a dashed one where another chart's
      // pointer is, at the same quarter.
      if (chart.$crosshair) {
        var act = chart.tooltip ? chart.tooltip.getActiveElements() : [];
        var cx = act.length ? act[0].element.x : chart.$link != null ? chart.scales.x.getPixelForValue(chart.$link) : null;
        if (cx != null) {
          var x = Math.round(cx) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, a.top);
          ctx.lineTo(x, a.bottom);
          ctx.lineWidth = 1;
          ctx.strokeStyle = chart.$colors.cross;
          if (!act.length) ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    },
    afterDatasetsDraw: function (chart) {
      // The miss marker reveals with the draw-in, but during a replay it sits on the
      // head, so it is drawn outside the clip there.
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

  // A reference rule across the plot at one value, such as book-to-bill of 1.
  function drawBaseline(chart) {
    var a = chart.chartArea, ctx = chart.ctx, y = Math.round(chart.scales.y.getPixelForValue(chart.$baseline)) + 0.5;
    if (y < a.top || y > a.bottom) return;
    ctx.save();
    ctx.strokeStyle = chart.$colors.muted;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.left, y);
    ctx.lineTo(a.right, y);
    ctx.stroke();
    ctx.restore();
  }

  // Where another chart is pointing, mark each line's value at that quarter.
  function drawLink(chart) {
    var ctx = chart.ctx, act = chart.tooltip ? chart.tooltip.getActiveElements() : [];
    if (act.length) return;
    ctx.save();
    chart.data.datasets.forEach(function (ds, i) {
      if (!chart.isDatasetVisible(i)) return;
      var p = chart.getDatasetMeta(i).data[chart.$link];
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

  // Pointing at a quarter in one linked chart marks the same quarter in the others.
  function linkHover(evt, els, chart) {
    var label = els && els.length && evt.type !== "mouseout" ? chart.data.labels[els[0].index] : null;
    LINKED.forEach(function (id) {
      var ch = charts[id];
      if (!ch || ch === chart) return;
      var i = label == null ? -1 : ch.data.labels.indexOf(label), v = i < 0 ? null : i;
      if (ch.$link !== v) { ch.$link = v; ch.draw(); }
    });
  }

  // The x position of the replay head, which sits between two forecasts while it moves.
  function headX(chart) {
    var xs = chart.scales.x, u = chart.$upto, i = Math.floor(u), f = u - i;
    var x0 = xs.getPixelForValue(i), n = chart.data.labels.length;
    return i + 1 < n ? x0 + (xs.getPixelForValue(i + 1) - x0) * f : x0;
  }

  // During a replay, the whole of Actual stays on screen as a faint track ahead of the head.
  function drawGhost(chart) {
    if (!chart.isDatasetVisible(0)) return;
    var pts = chart.getDatasetMeta(0).data, ctx = chart.ctx, pen = false;
    ctx.save();
    ctx.strokeStyle = chart.$colors.track;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(function (p) {
      if (!p || p.skip || !isFinite(p.y)) { pen = false; return; }
      if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      pen = true;
    });
    ctx.stroke();
    ctx.restore();
  }

  // The replay head: a dotted rule at the forecast being read, labelled with its quarter.
  function drawHead(chart) {
    var a = chart.chartArea, ctx = chart.ctx, c = chart.$colors, x = Math.round(headX(chart)) + 0.5;
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, a.top);
    ctx.lineTo(x, a.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (chart.$headLabel) {
      ctx.font = font(11);
      ctx.textBaseline = "middle";
      var w = ctx.measureText(chart.$headLabel).width + 12, h = 20;
      var bx = Math.max(a.left, Math.min(x - w / 2, a.right - w)), by = a.top - 2;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 4); else ctx.rect(bx, by, w, h);
      ctx.fill();
      ctx.fillStyle = c.surface;
      ctx.textAlign = "center";
      ctx.fillText(chart.$headLabel, bx + w / 2, by + h / 2 + 0.5);
    }
    ctx.restore();
  }

  // The gap between the backlog forecast and Actual, shaded so every miss reads as an area.
  // One path per unbroken run, so neighbouring segments never double the tint at their seams.
  function drawBand(chart) {
    if (!chart.isDatasetVisible(0) || !chart.isDatasetVisible(1)) return;
    var A = chart.getDatasetMeta(0).data, B = chart.getDatasetMeta(1).data, ctx = chart.ctx;
    var ok = function (p) { return p && !p.skip && isFinite(p.y); };
    ctx.save();
    ctx.fillStyle = chart.$colors.accentSoft;
    if (chart.$spot != null && chart.$spot > 1) ctx.globalAlpha = 0.3;
    var run = [];
    function flush() {
      if (run.length > 1) {
        ctx.beginPath();
        run.forEach(function (i, j) { if (j) ctx.lineTo(A[i].x, A[i].y); else ctx.moveTo(A[i].x, A[i].y); });
        for (var j = run.length - 1; j >= 0; j--) ctx.lineTo(B[run[j]].x, B[run[j]].y);
        ctx.closePath();
        ctx.fill();
      }
      run = [];
    }
    for (var i = 0; i < A.length; i++) { if (ok(A[i]) && ok(B[i])) run.push(i); else flush(); }
    flush();
    ctx.restore();
  }

  // The forecast span of the scenario fan, as a light wash with its name at the top.
  function drawFuture(chart) {
    var a = chart.chartArea, ctx = chart.ctx, c = chart.$colors;
    var x = chart.scales.x.getPixelForValue(chart.$future);
    ctx.save();
    ctx.fillStyle = c.wash;
    ctx.fillRect(x, a.top, a.right - x, a.bottom - a.top);
    if (chart.$futureLabel) {
      ctx.font = font(11);
      ctx.fillStyle = c.muted;
      ctx.textBaseline = "top";
      ctx.fillText(chart.$futureLabel, x + 8, a.top + 6);
    }
    ctx.restore();
  }

  function font(size) { return "600 " + size + "px " + Chart.defaults.font.family; }

  // Label each line at its right end with its latest value, nudged apart so none overlap.
  // They fade in over the last quarter of the draw-in.
  function drawEnds(chart) {
    var a = chart.chartArea, ctx = chart.ctx, c = chart.$colors;
    var r = chart.$reveal == null ? 1 : chart.$reveal, alpha = Math.max(0, Math.min(1, (r - 0.75) / 0.25));
    if (!alpha) return;
    var items = [];
    chart.data.datasets.forEach(function (ds, i) {
      if (!chart.isDatasetVisible(i)) return;
      if (chart.$endKeys && chart.$endKeys.indexOf(ds.key) < 0) return;
      var j = ds.data.length - 1;
      while (j >= 0 && ds.data[j] == null) j--;
      var p = j >= 0 ? chart.getDatasetMeta(i).data[j] : null;
      if (!p || !isFinite(p.y)) return;
      items.push({ y: p.y, px: p.x, py: p.y, text: billions(ds.data[j] * 1e9), color: ds.borderColor,
        dim: chart.$spot != null && chart.$spot !== i });
    });
    items.sort(function (p, q) { return p.y - q.y; });
    var gap = 14, k;
    for (k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < gap) items[k].y = items[k - 1].y + gap;
    var over = items.length ? items[items.length - 1].y - (a.bottom - 2) : 0;
    if (over > 0) items.forEach(function (it) { it.y -= over; });
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font(12);
    ctx.textBaseline = "middle";
    items.forEach(function (it) {
      var x = a.right + 6;
      ctx.globalAlpha = alpha * (it.dim ? 0.3 : 1);
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(it.px, it.py);
      ctx.lineTo(x, it.y);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, it.y);
      ctx.lineTo(x + 7, it.y);
      ctx.stroke();
      ctx.fillStyle = c.ink2;
      ctx.fillText(it.text, x + 11, it.y);
    });
    ctx.restore();
  }

  // The largest miss: a ring on the forecast and a bracket down (or up) to what happened.
  function drawMiss(chart) {
    var m = chart.$miss, c = chart.$colors, ctx = chart.ctx;
    if (m.index < 0 || !chart.isDatasetVisible(m.ds)) return;
    var p = chart.getDatasetMeta(m.ds).data[m.index];
    if (!p || p.skip || !isFinite(p.y)) return;
    var q = chart.isDatasetVisible(m.ref) ? chart.getDatasetMeta(m.ref).data[m.index] : null;
    ctx.save();
    if (chart.$spot != null && chart.$spot !== m.ds) ctx.globalAlpha = 0.2;
    ctx.strokeStyle = c.accent;
    if (q && !q.skip && isFinite(q.y)) {
      var x = Math.round(p.x) + 0.5;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, p.y);
      ctx.lineTo(x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x - 4, Math.round(q.y) + 0.5);
      ctx.lineTo(x + 4, Math.round(q.y) + 0.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = c.surface;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
    ctx.fillStyle = c.accent;
    ctx.fill();
    if (m.label) {
      var a = chart.chartArea, ty = q && !q.skip && isFinite(q.y) ? (p.y + q.y) / 2 : p.y;
      ctx.font = font(12);
      ctx.textBaseline = "middle";
      var w = ctx.measureText(m.label).width, tx = p.x + 9;
      ctx.textAlign = "left";
      if (tx + w > a.right) { tx = p.x - 9; ctx.textAlign = "right"; }
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = c.surface;
      ctx.strokeText(m.label, tx, ty);
      ctx.fillStyle = c.accent;
      ctx.fillText(m.label, tx, ty);
    }
    ctx.restore();
  }

  // A hairline from where each waterfall step ends to where the next one starts.
  function drawConnectors(chart) {
    var bars = chart.getDatasetMeta(0).data, ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = chart.$colors.muted;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (var i = 0; i < bars.length - 1; i++) {
      var a = bars[i], b = bars[i + 1], y = Math.round(a.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(a.x + a.width / 2, y);
      ctx.lineTo(b.x - b.width / 2, y);
      ctx.stroke();
    }
    // Each bar's value sits just above it. Totals are placed first, then steps from the
    // largest down; a label that would overlap one already placed moves up a line, and if
    // there is no room left it is dropped (the caption still states it).
    ctx.globalAlpha = 1;
    var size = chart.width < 400 ? 11 : 12, placed = [], top = chart.chartArea.top - 18;
    ctx.font = font(size);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = chart.$colors.ink2;
    var order = bars.map(function (bar, j) { return j; }).sort(function (i, j) {
      var total = function (k) { return k === 0 || k === bars.length - 1 ? 1 : 0; };
      return total(j) - total(i) || Math.abs(bars[j].y - bars[j].base) - Math.abs(bars[i].y - bars[i].base);
    });
    order.forEach(function (j) {
      var bar = bars[j];
      if (Math.abs(bar.y - bar.base) < 0.5 || !chart.$values) return;
      var text = chart.$values[j], w = ctx.measureText(text).width + 6;
      var box = { l: bar.x - w / 2, r: bar.x + w / 2, b: Math.min(bar.y, bar.base) - 4 };
      var hits = function () {
        return placed.some(function (p) { return box.l < p.r && box.r > p.l && box.b > p.b - size - 2 && box.b - size - 2 < p.b; });
      };
      while (hits() && box.b - size > top) box.b -= size + 3;
      if (hits() || box.b - size < top) return;
      placed.push(box);
      ctx.fillText(text, bar.x, box.b);
    });
    ctx.restore();
  }

  // One HTML tooltip for every chart, styled like the panels, with figures right-aligned.
  function externalTip(context) {
    var chart = context.chart, model = context.tooltip, box = chart.canvas.parentNode;
    var tip = box.querySelector(".tip");
    if (!tip) {
      tip = el("div", "tip jump");
      tip.setAttribute("aria-hidden", "true");
      box.appendChild(tip);
    }
    if (!model.opacity || !model.dataPoints || !model.dataPoints.length || !chart.$tip) {
      tip.classList.remove("show");
      return;
    }
    var spec = chart.$tip(model.dataPoints);
    if (!spec) { tip.classList.remove("show"); return; }
    tip.textContent = "";
    if (spec.title) tip.appendChild(el("div", "tip-title", spec.title));
    var rows = el("div", "tip-rows");
    spec.rows.forEach(function (r) {
      var sw = el("span", "tip-sw");
      sw.style.background = r.color;
      rows.appendChild(sw);
      rows.appendChild(el("span", "tip-label", r.label));
      rows.appendChild(el("span", "tip-val", r.value));
      rows.appendChild(el("span", "tip-x", r.extra || ""));
    });
    tip.appendChild(rows);
    if (spec.note) {
      var note = el("div", "tip-note");
      note.appendChild(el("strong", "", spec.note[0]));
      note.appendChild(document.createTextNode(" " + spec.note[1]));
      tip.appendChild(note);
    }

    var W = box.clientWidth, H = box.clientHeight, w = tip.offsetWidth, h = tip.offsetHeight;
    var x = model.caretX + 16;
    if (x + w > W) x = model.caretX - 16 - w;
    x = Math.max(0, Math.min(x, W - w));
    var y = Math.max(0, Math.min(model.caretY - h / 2, H - h));
    var fresh = !tip.classList.contains("show");
    if (fresh) tip.classList.add("jump");
    tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    if (fresh) { void tip.offsetWidth; tip.classList.remove("jump"); }
    tip.classList.add("show");
  }

  // The y unit is a line of text above the plot rather than a rotated axis title.
  function baseOptions(c, unitId, yTitle, xTitle) {
    var tick = { size: 12 };
    $(unitId).textContent = yTitle;
    return {
      responsive: true,
      devicePixelRatio: pixelRatio(),
      maintainAspectRatio: false,
      animation: still() ? false : { duration: ms("--dur-3"), easing: "easeInOutCubic" },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 6, right: 76 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, external: externalTip }
      },
      scales: {
        x: {
          title: { display: !!xTitle, text: xTitle, color: c.muted, font: tick, padding: { top: 8 } },
          ticks: { color: c.muted, font: tick, maxRotation: 0, autoSkip: false, padding: 6, callback: yearTick },
          grid: { display: false },
          border: { color: c.line }
        },
        y: {
          title: { display: false, text: yTitle },
          ticks: { color: c.muted, font: tick, padding: 8, maxTicksLimit: 7 },
          grid: { color: c.grid, drawTicks: false },
          border: { display: false }
        }
      }
    };
  }

  // Quarterly axes are labelled at each year's first quarter, every other year when narrow
  // and there are enough years that the axis would crowd. Tooltips still name the exact quarter.
  function yearTick(value) {
    var q = this.getLabelForValue(value);
    if (!/Q1$/.test(q)) return "";
    var y = +q.slice(0, 4);
    var years = this.chart.data.labels.filter(function (l) { return /Q1$/.test(l); }).length;
    return this.chart.width < 520 && years > 6 && y % 2 ? "" : String(y);
  }

  function lineSet(c, label, values, color, width, key) {
    return {
      label: label, data: values, key: key, $color: color,
      borderColor: color, backgroundColor: color, borderWidth: width,
      borderCapStyle: "round", borderJoinStyle: "round", tension: 0, spanGaps: false,
      pointRadius: 0, pointHitRadius: 6, pointHoverRadius: 4,
      pointHoverBackgroundColor: color, pointHoverBorderColor: c.surface, pointHoverBorderWidth: 2
    };
  }

  // Create a chart once; after that, change it in place so its lines and bars morph.
  // `extras` (colours, labels, annotations) are attached before the chart redraws, so the
  // first frame of an update never shows the previous company's or year's figures.
  // Canvas resolution. Charts are drawn at no less than twice the screen's density, so
  // lines and labels stay smooth on standard displays, and at twice the device density
  // (up to 4x) on touch screens, where pinch-zoom magnifies the canvas without redrawing it.
  function pixelRatio() {
    var dpr = window.devicePixelRatio || 1;
    return Math.min(4, Math.max(2, coarse.matches ? dpr * 2 : dpr));
  }

  // Browser zoom and moving the window to another monitor change the density; redraw at
  // the new one. A resolution query catches a monitor change, which resizes nothing, and
  // a resize check catches zoom wherever that query does not fire.
  var drawnRatio = null;
  function applyDensity() {
    var r = pixelRatio();
    if (r === drawnRatio) return;
    drawnRatio = r;
    Object.keys(charts).forEach(function (id) {
      charts[id].options.devicePixelRatio = r;
      charts[id].resize();
    });
  }

  function watchDensity() {
    drawnRatio = pixelRatio();
    window.addEventListener("resize", applyDensity);
    // A hidden tooltip keeps its last position. After the window narrows (a phone turned
    // upright) that can sit past the new edge and widen the page, so it goes back to 0.
    window.addEventListener("resize", function () {
      document.querySelectorAll(".tip").forEach(function (t) {
        if (!t.classList.contains("show")) t.style.transform = "";
      });
    });
    (function listen() {
      if (!window.matchMedia) return;
      var mq = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
      if (!mq.addEventListener) return;
      mq.addEventListener("change", function onChange() {
        mq.removeEventListener("change", onChange);
        applyDensity();
        listen();
      });
    })();
  }

  function upsert(id, config, extras) {
    var ch = charts[id];
    if (!ch) {
      var anim = config.options.animation;
      config.options.animation = false;
      ch = charts[id] = new Chart($(id), config);
      ch.options.animation = anim;
      Object.assign(ch, extras);
      if (config.type === "line" || ch.$clipReveal) ch.$reveal = still() ? 1 : 0;
      if (LINKED.indexOf(id) >= 0) $(id).addEventListener("mouseleave", function () { linkHover({ type: "mouseout" }, [], ch); });
      ch.draw();
      return ch;
    }
    Object.assign(ch, extras);
    ch.$spot = undefined;     // fresh datasets arrive at full colour
    ch.data.labels = config.data.labels;
    var cur = ch.data.datasets;
    config.data.datasets.forEach(function (ds, i) {
      if (cur[i]) Object.keys(ds).forEach(function (k) { cur[i][k] = ds[k]; });
      else cur.push(ds);
    });
    cur.length = config.data.datasets.length;
    ch.options = config.options;
    ch.update();
    return ch;
  }

  function fade(hex, alpha) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  // Pointing at a key entry dims every other line, so one series can be followed through
  // a crowded chart. The colour change animates with the chart's own easing.
  function spotlight(chart, i) {
    if (chart.$spot === i) return;
    chart.$spot = i;
    chart.data.datasets.forEach(function (ds, j) {
      var col = i == null || j === i ? ds.$color : fade(ds.$color, 0.16);
      ds.borderColor = col;
      ds.backgroundColor = col;
    });
    chart.update();
  }

  // HTML legend: one chip per line, pressed while the line is shown, with a definition
  // button beside any entry whose name is a term of art.
  function renderLegend(id, chart) {
    var box = $(id), sets = chart.data.datasets;
    if (box.children.length !== sets.length) {
      box.textContent = "";
      sets.forEach(function (ds, i) {
        var item = el("span", "key");
        var b = el("button", "chip wash");
        b.type = "button";
        b.appendChild(el("span", "chip-sw"));
        b.appendChild(el("span", "chip-label"));
        b.addEventListener("click", function () {
          var show = !chart.isDatasetVisible(i);
          chart.setDatasetVisibility(i, show);
          chart.$spot = undefined;
          spotlight(chart, show && b.$hot ? i : null);
          b.setAttribute("aria-pressed", show ? "true" : "false");
        });
        // Spotlight follows a real mouse hover or keyboard focus only. A tap on a touch
        // screen fires the same events, and would otherwise leave a line stuck in focus.
        var on = function () { b.$hot = true; if (chart.isDatasetVisible(i)) spotlight(chart, i); };
        var off = function () { b.$hot = false; spotlight(chart, null); };
        b.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") on(); });
        b.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") off(); });
        b.addEventListener("focus", function () { if (b.matches(":focus-visible")) on(); });
        b.addEventListener("blur", off);
        item.appendChild(b);
        item.appendChild(infoButton(null));
        box.appendChild(item);
      });
    }
    sets.forEach(function (ds, i) {
      var item = box.children[i], b = item.querySelector(".chip");
      var sw = b.querySelector(".chip-sw");
      sw.style.setProperty("--c", ds.$color || ds.borderColor);
      sw.classList.toggle("dash", !!(ds.borderDash && ds.borderDash.length));
      b.querySelector(".chip-label").textContent = ds.label;
      b.setAttribute("aria-pressed", chart.isDatasetVisible(i) ? "true" : "false");
      setHelp(item.querySelector(".info"), keyHelp(id === "lg-backlog" ? "c-backlog" : "c-fc", state.view, ds.key));
    });
  }

  /* ---------- definitions: a toggletip per term ---------- */

  var ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' +
    '<circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.25"/>' +
    '<path d="M8 7.2v4M8 4.7v.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var openInfo = null;

  function infoButton(key) {
    var b = el("button", "info");
    b.type = "button";
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-controls", "def");
    setHelp(b, key);
    return b;
  }

  function setHelp(b, key) {
    if (!b.firstChild) b.innerHTML = ICON;
    b.dataset.help = key || "";
    b.hidden = !key;
    if (key) b.setAttribute("aria-label", HELP[key].ask);
    if (openInfo === b) closeInfo();
  }

  // The bubble is one live region shared by every button: filling it is announced, and
  // the button keeps focus, so Escape or a second press closes it where you are.
  function showInfo(b) {
    if (openInfo === b) { closeInfo(); return; }
    closeInfo();
    var def = $("def"), help = HELP[b.dataset.help];
    if (!help) return;
    openInfo = b;
    b.setAttribute("aria-expanded", "true");
    help.terms.forEach(function (t) {
      var row = el("p", "");
      row.appendChild(el("strong", "", t[0]));
      row.appendChild(document.createTextNode(" " + t[1]));
      def.appendChild(row);
    });
    placeInfo();
    void def.offsetWidth;
    def.classList.add("open");
  }

  // Keep the bubble beside its button as the page scrolls; close it once the button
  // has left the screen.
  function placeInfo() {
    if (!openInfo) return;
    var def = $("def"), r = openInfo.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) { closeInfo(); return; }
    var w = def.offsetWidth, h = def.offsetHeight, gap = 8;
    var x = Math.max(16, Math.min(r.left - 12, innerWidth - w - 16));
    var below = r.bottom + gap + h <= innerHeight - 8;
    def.style.left = Math.round(x) + "px";
    def.style.top = Math.round(below ? r.bottom + gap : r.top - gap - h) + "px";
    def.classList.toggle("above", !below);
  }

  function closeInfo() {
    if (!openInfo) return;
    openInfo.setAttribute("aria-expanded", "false");
    openInfo = null;
    var def = $("def");
    def.classList.remove("open", "above");
    def.textContent = "";
  }

  function watchInfo() {
    document.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".info") : null;
      if (b) { showInfo(b); return; }
      if (openInfo && !$("def").contains(e.target)) closeInfo();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openInfo) { var b = openInfo; closeInfo(); b.focus(); }
    });
    window.addEventListener("scroll", placeInfo, { passive: true });
    window.addEventListener("resize", placeInfo);
    document.querySelectorAll("button.info[data-help]").forEach(function (b) { setHelp(b, b.dataset.help); });
  }

  /* ---------- the same figures as a table ---------- */

  // Each chart can be read as a table built from the figures it draws, using the
  // chart's own title, series names and axis label.
  function renderTable(id, spec) {
    var box = $(id);
    if (!box) return;
    box.$spec = spec;
    // The box scrolls, so it takes focus for the keyboard and is named for screen readers.
    box.setAttribute("aria-label", spec.caption + ", table");
    if (box.hidden) return;
    box.textContent = "";
    var t = el("table", "");
    t.appendChild(el("caption", "", spec.caption));
    var head = document.createElement("thead"), hr = document.createElement("tr");
    spec.head.forEach(function (h) { var th = el("th", "", h); th.scope = "col"; hr.appendChild(th); });
    head.appendChild(hr);
    t.appendChild(head);
    var body = document.createElement("tbody");
    spec.rows.forEach(function (row) {
      var tr = document.createElement("tr");
      row.forEach(function (v, j) {
        var c = el(j ? "td" : "th", "", v);
        if (!j) c.scope = "row";
        tr.appendChild(c);
      });
      body.appendChild(tr);
    });
    t.appendChild(body);
    box.appendChild(t);
  }

  function watchTables() {
    document.querySelectorAll(".table-toggle").forEach(function (b) {
      b.addEventListener("click", function () {
        var box = $(b.getAttribute("aria-controls")), open = box.hidden;
        box.hidden = !open;
        b.setAttribute("aria-expanded", open ? "true" : "false");
        b.textContent = open ? TABLE_HIDE : TABLE_SHOW;
        if (open && box.$spec) renderTable(box.id, box.$spec);
      });
    });
  }

  // Draw a chart in the first time it scrolls into view, after its panel has arrived.
  function reveal(id) {
    var ch = charts[id];
    if (!ch || ch.$revealed) return;
    ch.$revealed = true;
    var wait = still() ? 0 : Math.max(0, introAt + PANEL_INDEX[id] * ms("--stagger") - performance.now());
    setTimeout(function () {
      if (ch.$bars) {
        ch.$connectors = true;
        ch.data.datasets[0].data = ch.$bars;
        ch.update(still() ? "none" : "reveal");
      } else {
        tween(0, 1, ms("--dur-3"), function (p) { ch.$reveal = p; ch.draw(); });
      }
    }, wait);
  }

  function revealAll() { Object.keys(charts).forEach(reveal); }

  function watchCharts() {
    if (still() || !window.IntersectionObserver) { revealAll(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { io.unobserve(e.target); reveal(e.target.id); }
      });
    }, { threshold: 0.2 });
    Object.keys(charts).forEach(function (id) { io.observe($(id)); });
  }

  /* ---------- header and scoreboard ---------- */

  function countUp(node, value, delay) {
    node.textContent = pct(value);
    if (introDone || still()) return;
    // Reserve the final width so the shorter numbers on the way up never move anything.
    node.style.minWidth = Math.ceil(node.getBoundingClientRect().width) + "px";
    node.textContent = pct(0);
    setTimeout(function () {
      tween(0, value, ms("--dur-4"), function (v) { node.textContent = pct(v); });
    }, delay);
  }

  function renderHeader() {
    var m = data.metrics, h4 = m.mape.H4;
    var best = MODELS.slice().sort(function (a, b) { return h4[a].ALL - h4[b].ALL; })[0];
    var fig = function (text, isBest) { return el("span", "num" + (isBest ? " best" : ""), text); };
    var parts = ["Over the next four quarters, " + PHRASE[best] + " missed actual revenue by ",
      fig(pct(h4[best].ALL), true), " on average, the lowest of three models"];
    if (best === "backlog") parts.push(".");
    else parts.push(", while the backlog model missed by ", fig(pct(h4.backlog.ALL), false), ".");
    var head = $("headline");
    head.textContent = "";
    parts.forEach(function (p) { head.appendChild(typeof p === "string" ? document.createTextNode(p) : p); });
    // The pooled result, then any company that went the other way, judged on the same
    // comparison as its verdict (backlog model against trailing 4Q).
    var against = tickers.filter(function (t) {
      var b = m.mape.H4.backlog[t], n = m.mape.H4.naive[t];
      return b != null && n != null && (best === "backlog" ? b > n : b < n);
    }).map(function (t) { return COMPANY[t] || t; });
    $("bottom-line").textContent = (best === "backlog"
      ? "In short: across the five companies taken together, backlog was a better guide to the next year's revenue than last year's revenue."
      : "In short: across the five companies taken together, last year's revenue was a better guide to the next year's than backlog.") +
      (against.length ? " " + (against.length > 1 ? against.slice(0, -1).join(", ") + " and " + against[against.length - 1] + " were the exceptions."
        : against[0] + " was the exception.") : "");
    var asof = $("asof"), when = el("time", "", longDate(data.as_of));
    when.dateTime = data.as_of;
    asof.textContent = "Data as of ";
    asof.appendChild(when);

    var c = colors(), tiles = $("tiles"), stagger = ms("--stagger");
    // One scale for the pooled bars and each company's dot, so the dots never run off the end.
    var scale = Math.max.apply(null, [].concat.apply([], MODELS.map(function (k) {
      return Object.keys(h4[k]).map(function (t) { return h4[k][t]; });
    })).filter(function (v) { return v != null; }));
    tiles.innerHTML = "";
    tiles.setAttribute("role", "list");
    // One row per figure: label and value, then a bar on a shared scale so the gaps read at a glance.
    function row(i, cls, name, color, value, share, sub, flag, dots) {
      var t = el("div", "tile" + (cls ? " " + cls : ""));
      t.setAttribute("role", "listitem");
      t.innerHTML = '<div class="name"></div><div class="val"></div><div class="bar" aria-hidden="true"><i></i></div><div class="sub"></div>';
      if (color) {
        var sw = el("span", "swatch");
        sw.style.background = color;
        t.querySelector(".name").appendChild(sw);
      }
      t.querySelector(".name").appendChild(document.createTextNode(name));
      t.querySelector(".sub").textContent = sub;
      if (flag) {
        t.querySelector(".sub").appendChild(document.createTextNode(" "));
        t.querySelector(".sub").appendChild(el("span", "flag", flag));
      }
      var fill = t.querySelector(".bar i");
      fill.style.background = color || c.accent;
      tiles.appendChild(t);
      var delay = (i + 2) * stagger;
      countUp(t.querySelector(".val"), value, delay);
      grow(fill, share, delay);
      if (dots) {
        addDots(t.querySelector(".bar"), dots, color || c.ink, delay);
        // The dots only name themselves on hover, so the same figures are written out here.
        t.appendChild(el("span", "sr-only", "By company: " + dots.map(function (d) { return d.label; }).join(", ") + "."));
      }
      return t;
    }
    var perCo = function (block, fmt, max) {
      return tickers.filter(function (t) { return block[t] != null; }).map(function (t) {
        return { t: t, at: block[t] / max, label: t + " " + fmt(block[t]) };
      });
    };
    MODELS.forEach(function (k, i) {
      row(i, k === best ? "best" : "", NAMES.h4[k], modelColor(c, k), h4[k].ALL, h4[k].ALL / scale,
        GLOSS[k], k === best ? "Lowest error" : null, perCo(h4[k], pct, scale));
    });
    var win = m.win_rate_vs_naive.H4.ALL;
    var w = row(3, "win", "Backlog model was closer", null, win, win / 100,
      "than trailing 4Q in " + Math.round(win / 100 * m.n.H4) + " of " + m.n.H4 + " four-quarter forecasts", null,
      perCo(m.win_rate_vs_naive.H4, pct, 100));
    w.querySelector(".bar").appendChild(el("b", "half"));
    if (state.ticker) markDots(state.ticker);
  }

  // Each company's own figure as a dot on the tile's bar. Pointing at one names it, and
  // choosing it picks that company; the cards below do the same for keyboard users.
  function addDots(bar, dots, color, delay) {
    dots.forEach(function (d, j) {
      var dot = el("span", "co-dot");
      dot.dataset.t = d.t;
      dot.dataset.label = d.label;
      dot.style.left = (Math.max(0, Math.min(1, d.at)) * 100) + "%";
      dot.style.setProperty("--c", color);
      dot.addEventListener("click", function () { selectTicker(d.t, true); });
      dot.addEventListener("pointerup", function (e) {
        if (e.pointerType === "mouse") return;
        document.querySelectorAll("#tiles .co-dot.named").forEach(function (n) { n.classList.remove("named"); });
        dot.classList.add("named");
        clearTimeout(dot.$named);
        dot.$named = setTimeout(function () { dot.classList.remove("named"); }, 1200);
      });
      if (!introDone && !still()) {
        dot.style.opacity = "0";
        setTimeout(function () { dot.style.opacity = ""; }, delay + ms("--dur-4") + j * ms("--stagger"));
      }
      bar.appendChild(dot);
    });
  }

  function markDots(t) {
    document.querySelectorAll("#tiles .co-dot").forEach(function (d) { d.classList.toggle("on", d.dataset.t === t); });
  }

  function grow(fill, share, delay) {
    var to = "scaleX(" + share + ")";
    if (introDone || still()) { fill.style.transform = to; return; }
    fill.style.transform = "scaleX(0)";
    setTimeout(function () { fill.style.transform = to; }, delay);
  }

  /* ---------- company cards and the compact bar ---------- */

  // A small backlog and trailing-revenue chart for a card, on one scale from zero.
  // Quarters with no tagged backlog leave a break, as they do in the full chart.
  function sparkSvg(co) {
    var W = 120, H = 40, n = co.quarters.length;
    var max = Math.max.apply(null, co.backlog_usd.concat(co.ttm_revenue_usd).filter(function (v) { return v != null; }));
    function pts(arr) {
      return arr.map(function (v, i) { return v == null ? null : [i / (n - 1) * W, H - 1 - v / max * (H - 3)]; });
    }
    function runs(p) {
      var out = [], cur = [];
      p.forEach(function (q) { if (q) cur.push(q); else { if (cur.length) out.push(cur); cur = []; } });
      if (cur.length) out.push(cur);
      return out;
    }
    function xy(q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }
    function line(p) { return runs(p).map(function (r) { return "M" + r.map(xy).join("L"); }).join(""); }
    function area(p) {
      return runs(p).filter(function (r) { return r.length > 1; }).map(function (r) {
        return "M" + r[0][0].toFixed(1) + " " + H + "L" + r.map(xy).join("L") + "L" + r[r.length - 1][0].toFixed(1) + " " + H + "Z";
      }).join("");
    }
    var b = pts(co.backlog_usd), r = pts(co.ttm_revenue_usd);
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<path class="sp-area" d="' + area(b) + '"/>' +
      '<path class="sp-rev" vector-effect="non-scaling-stroke" d="' + line(r) + '"/>' +
      '<path class="sp-bl" vector-effect="non-scaling-stroke" d="' + line(b) + '"/></svg>';
  }

  // The cards are the company tabs: each one names a company and sums up its record.
  function renderCards() {
    var box = $("cards"), m = data.metrics;
    box.textContent = "";
    tickers.forEach(function (t, i) {
      var co = data.companies[t], L = co.quarters.length - 1, name = COMPANY[t] || t;
      var bk = m.mape.H4.backlog[t], nv = m.mape.H4.naive[t];
      var cover = co.backlog_usd[L] != null && co.ttm_revenue_usd[L] ? co.backlog_usd[L] / co.ttm_revenue_usd[L] : null;
      var b = el("button", "card");
      b.type = "button";
      b.id = "tab-" + t;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "company");
      var top = el("span", "card-top");
      top.appendChild(el("span", "card-tk", t));
      var said = name + " (" + t + ").";
      if (bk != null && nv != null) {
        var better = bk < nv, badge = el("span", "badge " + (better ? "up" : "down"));
        badge.appendChild(el("span", "badge-dot"));
        badge.appendChild(el("span", "badge-txt", better ? "Backlog better" : "Backlog worse"));
        top.appendChild(badge);
        said += better ? " Backlog better." : " Backlog worse.";
      }
      b.appendChild(top);
      b.appendChild(el("span", "card-name", name));
      var sp = el("span", "card-spark");
      sp.innerHTML = sparkSvg(co);
      b.appendChild(sp);
      if (cover != null) {
        var cov = el("span", "card-cov");
        cov.appendChild(el("strong", "", cover.toFixed(1)));
        cov.appendChild(document.createTextNode(" years of revenue in backlog"));
        b.appendChild(cov);
        said += " " + cover.toFixed(1) + " years of revenue in backlog.";
      }
      b.setAttribute("aria-label", said);
      b.addEventListener("click", function () { selectTicker(t, true); });
      box.appendChild(b);
    });
    addPill(box);
    box.addEventListener("keydown", function (e) {
      var i = tickers.indexOf(state.ticker), j = i;
      if (e.key === "ArrowRight") j = (i + 1) % tickers.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + tickers.length) % tickers.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = tickers.length - 1;
      else return;
      e.preventDefault();
      selectTicker(tickers[j], true);
      $("tab-" + tickers[j]).focus();
    });
  }

  // The compact bar repeats the choice as plain toggle buttons once the cards are off screen.
  function renderTabs() {
    var bar = $("tabs");
    bar.innerHTML = "";
    tickers.forEach(function (t) {
      var b = el("button", "wash");
      b.type = "button";
      b.id = "cb-" + t;
      b.setAttribute("aria-label", COMPANY[t] ? COMPANY[t] + " (" + t + ")" : t);
      twoTone(b, t);
      b.addEventListener("click", function () { selectTicker(t, true); });
      bar.appendChild(b);
    });
    addPill(bar);
  }

  function selectTicker(t, push) {
    var changed = state.ticker !== t;
    state.ticker = t;
    tickers.forEach(function (k) {
      var card = $("tab-" + k), on = k === t;
      card.setAttribute("aria-selected", on ? "true" : "false");
      card.tabIndex = on ? 0 : -1;
      $("cb-" + k).setAttribute("aria-pressed", on ? "true" : "false");
    });
    placePill($("cards"), true);
    placePill($("tabs"), true);
    markBackdrop(t);
    markDots(t);
    $("co-name").textContent = COMPANY[t] || "";
    $("company").setAttribute("aria-labelledby", "tab-" + t);
    if (push && location.hash !== "#" + t) history.replaceState(null, "", location.pathname + location.search + "#" + t);
    // Words re-settle with a short fade while the charts morph to the new company.
    if (push && changed && introDone && !still()) {
      ["company", "verdict"].forEach(function (id) {
        var n = $(id);
        n.classList.remove("swap");
        void n.offsetWidth;
        n.classList.add("swap");
      });
    }
    state.year = null;
    renderVerdict(t);
    renderCompany();
    // The tab and the history entry name the company in view.
    document.title = (COMPANY[t] ? COMPANY[t] + " (" + t + ")" : t) + " · " + TITLE;
    // The verdict's figures tween, so it is not a live region itself; its settled
    // sentence is spoken once instead.
    if (changed && introDone) announce(($("verdict").textContent || COMPANY[t] || t), 250);
  }

  // One sentence on how the backlog model did for the selected company. Its figures run
  // from the previous company's to the new one's.
  function renderVerdict(t) {
    var m = data.metrics, b = m.mape.H4.backlog[t], n = m.mape.H4.naive[t], w = m.win_rate_vs_naive.H4[t];
    var box = $("verdict"), prev = box.$prev, nums = [];
    box.textContent = "";
    if (b == null || n == null) { box.$prev = null; return; }
    var name = COMPANY[t] || t, fig = function (v) { var s = el("span", "num", pct(v)); nums.push([s, v]); return s; };
    [el("strong", "", "Backlog did " + (b < n ? "better" : "worse") + " for " + name + ": "),
      "its four-quarter forecasts missed by ", fig(b), " on average, against ", fig(n),
      " for trailing 4Q" + (w == null ? "." : ", and came closer in "), w == null ? "" : fig(w), w == null ? "" : " of them."]
      .forEach(function (p) { box.appendChild(typeof p === "string" ? document.createTextNode(p) : p); });
    box.$prev = nums.map(function (x) { return x[1]; });
    if (!prev || !introDone) return;
    nums.forEach(function (x, j) {
      if (prev[j] != null) tween(prev[j], x[1], ms("--dur-4"), function (v) { x[0].textContent = pct(v); });
    });
  }

  // The compact bar slides in once the cards have scrolled off the top, and out again
  // when they return. While hidden it is inert, so it never takes focus.
  // It is checked on scroll rather than with an observer: a jump from the foot of the
  // page to the top (Tab wrapping round, the Home key) never crosses the cards, so an
  // observer would leave the bar over the title.
  function watchSticky() {
    var bar = $("cbar"), cards = $("cards"), queued = false, shown = null;
    function check() {
      queued = false;
      var show = cards.getBoundingClientRect().bottom < 0;
      if (show === shown) return;
      shown = show;
      bar.classList.toggle("show", show);
      if (show) { bar.removeAttribute("inert"); placePill($("tabs"), false); }
      else bar.setAttribute("inert", "");
    }
    window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(check); } }, { passive: true });
    window.addEventListener("resize", check);
    check();
  }

  // A hairline under the compact bar shows how far down the page you are.
  function watchProgress() {
    var bar = $("progress"), queued = false;
    function paint() {
      queued = false;
      var max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0) + ")";
    }
    window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
    window.addEventListener("resize", paint);
    paint();
  }

  /* ---------- backdrop: every company's backlog, behind the title ---------- */

  // Each company's backlog indexed to 100 at its first tagged quarter, on one calendar axis.
  // It is decoration, hidden from assistive tech; the charts below carry the figures.
  function renderBackdrop() {
    var svg = $("backdrop"), W = 600, H = 200;
    var qi = function (q) { return +q.slice(0, 4) * 4 + +q.slice(5) - 1; };
    var lo = Infinity, hi = -Infinity, q0 = Infinity, q1 = -Infinity;
    var series = tickers.map(function (t) {
      var co = data.companies[t], first = null;
      return { t: t, pts: co.quarters.map(function (q, i) {
        var v = co.backlog_usd[i];
        q0 = Math.min(q0, qi(q)); q1 = Math.max(q1, qi(q));
        if (v == null) return null;
        if (first == null) first = v;
        var x = v / first * 100;
        lo = Math.min(lo, x); hi = Math.max(hi, x);
        return [qi(q), x];
      }) };
    });
    var html = "";
    series.forEach(function (s) {
      var d = "", pen = false;
      s.pts.forEach(function (p) {
        if (!p) { pen = false; return; }
        var x = (p[0] - q0) / (q1 - q0) * W, y = H - 4 - (p[1] - lo) / (hi - lo) * (H - 8);
        d += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        pen = true;
      });
      html += '<path data-t="' + s.t + '" vector-effect="non-scaling-stroke" d="' + d + '"/>';
    });
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = html;
  }

  // The selected company's line is drawn last, in the accent colour.
  function markBackdrop(t) {
    var svg = $("backdrop");
    svg.querySelectorAll("path").forEach(function (p) {
      var on = p.getAttribute("data-t") === t;
      p.classList.toggle("on", on);
      if (on) svg.appendChild(p);
    });
  }

  /* ---------- panels ---------- */

  // A chart's summary for screen readers, in spoken units.
  function describe(id, text) { $(id).setAttribute("aria-label", spoken(text)); }

  function renderBacklog(co, c) {
    var toB = function (v) { return v == null ? null : v / 1e9; };
    var ch = upsert("c-backlog", {
      type: "line",
      data: {
        labels: co.quarters,
        datasets: [
          lineSet(c, "Backlog (RPO)", co.backlog_usd.map(toB), c.accent, 2.5, "backlog"),
          lineSet(c, "Revenue, trailing four quarters", co.ttm_revenue_usd.map(toB), c.ink, 2.5, "ttm")
        ]
      },
      options: linked(baseOptions(c, "u-backlog", "US dollars, billions ($B)", "Quarter"))
    }, {
      $colors: c,
      $crosshair: true,
      $ends: true,
      $tip: function (pts) {
        return {
          title: co.quarters[pts[0].dataIndex],
          rows: pts.map(function (p) {
            return { color: p.dataset.borderColor, label: p.dataset.label, value: billions(p.raw == null ? null : p.raw * 1e9) };
          })
        };
      }
    });
    renderLegend("lg-backlog", ch);
    renderTable("t-backlog", {
      caption: "Backlog and revenue",
      head: ["Quarter", "Backlog (RPO)", "Revenue, trailing four quarters", "Implied book-to-bill"],
      rows: co.quarters.map(function (q, i) {
        return [q, billions(co.backlog_usd[i]), billions(co.ttm_revenue_usd[i]), co.book_to_bill[i] == null ? "n/a" : co.book_to_bill[i].toFixed(2)];
      })
    });
    renderBtb(co, c);

    var L = co.quarters.length - 1;
    var gaps = co.quarters.filter(function (q, i) { return co.backlog_usd[i] == null; });
    describe("c-backlog", co.ticker + " backlog and trailing four-quarter revenue by quarter. At " +
      co.quarters[L] + ", backlog was " + billions(co.backlog_usd[L]) + " and trailing revenue " + billions(co.ttm_revenue_usd[L]) + ".");
    $("backlog-note").textContent = "Backlog at each quarter end against revenue over the trailing four quarters, in $B. " +
      "When the backlog line climbs faster than revenue, more signed work is waiting to be delivered." +
      (gaps.length ? " Breaks in the backlog line are quarters whose filings tag no backlog for the quarter's own end: " + gaps.join(", ") + "." : "");
  }

  // Charts that share a quarter axis: the same y-axis width, so their plots line up when
  // stacked, and a crosshair that follows the pointer in any of them.
  function linked(opts) {
    opts.scales.y.afterFit = function (scale) { scale.width = 52; };
    opts.onHover = linkHover;
    return opts;
  }

  // Implied book-to-bill under the backlog chart, quarter for quarter: a bar up from 1
  // when backlog grew in the quarter, down from 1 when it shrank.
  function renderBtb(co, c) {
    var v = co.book_to_bill;
    var fills = v.map(function (x) { return x == null ? c.track : x >= 1 ? fade(c.accent, 0.75) : c.drift; });
    var opts = linked(baseOptions(c, "u-btb", "Implied book-to-bill, each quarter", ""));
    opts.scales.x.ticks.display = false;
    opts.scales.x.border = { color: c.line };
    opts.scales.y.ticks.maxTicksLimit = 3;
    opts.scales.y.ticks.callback = function (x) { return x.toFixed(1); };
    opts.scales.y.suggestedMin = 0.5;
    opts.scales.y.suggestedMax = 1.5;
    var shown = v.filter(function (x) { return x != null; });
    upsert("c-btb", {
      type: "bar",
      data: {
        labels: co.quarters,
        datasets: [{
          data: v.map(function (x) { return x == null ? null : [1, x]; }),
          backgroundColor: fills, hoverBackgroundColor: fills,
          borderRadius: 2, borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.9
        }]
      },
      options: opts
    }, {
      $colors: c,
      $crosshair: true,
      $clipReveal: true,
      $baseline: 1,
      $tip: function (pts) {
        var i = pts[0].dataIndex;
        if (v[i] == null) return null;
        return { title: co.quarters[i], rows: [{ color: fills[i], label: "Implied book-to-bill", value: v[i].toFixed(2) }] };
      }
    });
    var L = co.quarters.length - 1, up = shown.filter(function (x) { return x >= 1; }).length;
    describe("c-btb", co.ticker + " implied book-to-bill by quarter: at or above 1 in " + up + " of " + shown.length +
      " quarters" + (v[L] == null ? "." : ", and " + v[L].toFixed(2) + " at " + co.quarters[L] + "."));
  }

  function renderForecast(co, c) {
    stopReplay();
    var v = state.view, block = co[v];
    var actual = block.actual_usd;
    var toB = function (x) { return x == null ? null : x / 1e9; };
    var apes = {};
    MODELS.forEach(function (m) { apes[m] = block[m].map(function (f, i) { return ape(f, actual[i]); }); });

    var worst = -1;
    apes.backlog.forEach(function (a, i) { if (a != null && (worst < 0 || a > apes.backlog[worst])) worst = i; });

    var actualSet = lineSet(c, "Actual", actual.map(toB), c.ink, 2.75, "actual");
    actualSet.order = 0;
    var datasets = [actualSet];
    MODELS.forEach(function (m) {
      var ds = lineSet(c, NAMES[v][m], block[m].map(toB), modelColor(c, m), m === "backlog" ? 2 : 1.5, m);
      ds.order = 1;
      // The two baselines are both gray; dashing one keeps them apart without relying on shade.
      ds.borderDash = m === "naive_drift" ? [6, 4] : [];
      datasets.push(ds);
    });

    var worstMark = { index: worst, ds: 1, ref: 0, label: worst >= 0 ? pct(apes.backlog[worst]) : "" };
    var ch = upsert("c-fc", {
      type: "line",
      data: { labels: block.target, datasets: datasets },
      options: linked(baseOptions(c, "u-fc", v === "h1" ? "Quarterly revenue, $B" : "Revenue over four quarters, $B",
        v === "h1" ? "Quarter forecast" : "Last quarter of the four forecast"))
    }, {
      $colors: c,
      $crosshair: true,
      $ends: true,
      $band: true,
      $upto: null,
      $miss: worstMark,
      $worst: worstMark,
      $tip: function (pts) {
        var i = pts[0].dataIndex;
        return {
          title: block.target[i] + " (forecast made at " + block.origin[i] + ")",
        note: APE_NOTE,
          rows: pts.map(function (p) {
            var k = p.dataset.key, color = p.dataset.borderColor;
            if (k === "actual") return { color: color, label: "Actual", value: billions(actual[i]) };
            if (block[k][i] == null) return { color: color, label: p.dataset.label, value: "no forecast" };
            return { color: color, label: p.dataset.label, value: billions(block[k][i]), extra: "off by " + pct(apes[k][i]) };
          })
        };
      }
    });
    renderLegend("lg-fc", ch);
    setupReplay(block, apes, v);
    renderTable("t-fc", {
      caption: "Forecast against actual",
      head: [v === "h1" ? "Quarter forecast" : "Last quarter of the four forecast", "Actual"].concat(MODELS.map(function (m) { return NAMES[v][m]; })),
      rows: block.target.map(function (q, i) {
        return [q, billions(actual[i])].concat(MODELS.map(function (m) { return block[m][i] == null ? "no forecast" : billions(block[m][i]); }));
      })
    });

    var skipped = block.backlog.filter(function (x) { return x == null; }).length;
    var when = v === "h1" ? block.target[worst] : "the four quarters to " + block.target[worst];
    var cap = worst >= 0 ? "Biggest backlog-model miss: " + when + ", " + pct(apes.backlog[worst]) +
      " off (forecast " + billions(block.backlog[worst]) + ", actual " + billions(actual[worst]) + ")." : "";
    if (skipped) cap += " The backlog model skips " + skipped + " origins that need a quarter with no tagged backlog.";
    $("miss").textContent = cap;
    $("fc-note").textContent = v === "h1"
      ? "Each point is one forecast of a quarter's revenue, made a quarter ahead using only what was known then, and plotted at the quarter it forecast."
      : "Each point is one forecast of the next four quarters' revenue, made using only what was known at the time, and plotted at the last of those quarters.";

    var mape = data.metrics.mape[v.toUpperCase()];
    describe("c-fc", co.ticker + " " + (v === "h1" ? "next-quarter" : "next-four-quarter") +
      " forecasts against actual revenue. Average miss: " + MODELS.map(function (m) { return NAMES[v][m] + " " + pct(mape[m][co.ticker]); }).join(", ") + ". " + cap);
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-view") === v ? "true" : "false");
    });
  }

  /* ---------- replay the backtest ---------- */

  // The forecast chart can be played back in the order the forecasts were made. A head
  // moves along the quarters, everything after it is hidden (Actual stays as a faint
  // track), and the running average miss of each method updates as it goes.
  var replay = { at: null, raf: 0, playing: false, n: 0, k: -1, rows: null };
  var PLAY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>';

  function setupReplay(block, apes, view) {
    replay.block = block;
    replay.apes = apes;
    replay.view = view;
    replay.n = block.target.length;
    replay.k = null;    // forces the first readout
    var box = $("replay-out");
    box.textContent = "";
    replay.title = el("div", "ro-title");
    box.appendChild(replay.title);
    var c = colors();
    replay.rows = {};
    MODELS.forEach(function (m) {
      var row = el("div", "ro-row");
      var sw = el("span", "ro-sw");
      sw.style.background = modelColor(c, m);
      row.appendChild(sw);
      row.appendChild(el("span", "ro-name", NAMES[view][m]));
      var bar = el("span", "ro-bar"), fill = el("i", "");
      fill.style.background = modelColor(c, m);
      bar.appendChild(fill);
      bar.setAttribute("aria-hidden", "true");
      row.appendChild(bar);
      var val = el("span", "ro-val");
      row.appendChild(val);
      box.appendChild(row);
      replay.rows[m] = { row: row, fill: fill, val: val };
    });
    var scrub = $("scrub");
    scrub.min = 0;
    scrub.max = Math.max(0, replay.n - 1);
    scrub.step = 1;
    $("play").hidden = still();
    setHead(null);
    syncPlay();
  }

  // Move the head to a forecast index, fractional while it travels, or to null for the
  // whole record with its largest miss marked.
  function setHead(u) {
    var ch = charts["c-fc"];
    if (!ch || !replay.n) return;
    replay.at = u;
    var k = u == null ? replay.n - 1 : Math.floor(u + 1e-6);
    ch.$upto = u;
    ch.$headLabel = u == null ? "" : replay.block.target[k];
    ch.$miss = u == null ? ch.$worst : {
      index: k, ds: 1, ref: 0, label: replay.apes.backlog[k] == null ? "" : pct(replay.apes.backlog[k])
    };
    ch.draw();
    var scrub = $("scrub");
    scrub.value = k;
    scrub.style.setProperty("--p", replay.n > 1 ? k / (replay.n - 1) : 1);
    scrub.setAttribute("aria-valuetext", u == null ? "All forecasts" : "Forecasts up to " + replay.block.target[k]);
    var key = u == null ? -1 : k;
    if (key !== replay.k) { replay.k = key; writeReplay(k, u == null); }
  }

  function writeReplay(k, all) {
    replay.title.textContent = all ? "Average miss, every forecast" : "Average miss, forecasts up to " + replay.block.target[k];
    var means = {}, top = 0, best = null;
    MODELS.forEach(function (m) {
      var sum = 0, n = 0;
      for (var i = 0; i <= k; i++) { var a = replay.apes[m][i]; if (a != null) { sum += a; n++; } }
      means[m] = n ? sum / n : null;
      if (means[m] != null) {
        top = Math.max(top, means[m]);
        if (best == null || means[m] < means[best]) best = m;
      }
    });
    MODELS.forEach(function (m) {
      var r = replay.rows[m], v = means[m];
      r.val.textContent = v == null ? "not yet" : pct(v);
      r.fill.style.transform = "scaleX(" + (v == null || !top ? 0 : v / top) + ")";
      r.row.classList.toggle("best", m === best);
    });
  }

  function syncPlay() {
    var b = $("play"), mid = replay.at != null && replay.at < replay.n - 1;
    b.innerHTML = replay.playing ? PAUSE_ICON : PLAY_ICON;
    b.appendChild(el("span", "", replay.playing ? "Pause" : mid ? "Continue" : "Replay the backtest"));
    b.setAttribute("aria-pressed", replay.playing ? "true" : "false");
    $("replay").classList.toggle("on", replay.at != null);
  }

  function play() {
    if (replay.playing) { pause(); return; }
    if (still() || replay.n < 2) return;
    var from = replay.at == null || replay.at >= replay.n - 1 ? 0 : replay.at, t0 = null;
    replay.playing = true;
    $("replay-out").setAttribute("aria-busy", "true");
    syncPlay();
    function frame(now) {
      if (t0 == null) t0 = now;
      var u = Math.min(replay.n - 1, from + (now - t0) / REPLAY_STEP_MS);
      setHead(u);
      if (u < replay.n - 1) { replay.raf = requestAnimationFrame(frame); return; }
      replay.playing = false;
      $("replay-out").removeAttribute("aria-busy");
      setHead(null);
      syncPlay();
    }
    replay.raf = requestAnimationFrame(frame);
  }

  // Stop where the head is, on the forecast it has reached.
  function pause() {
    cancelAnimationFrame(replay.raf);
    replay.playing = false;
    $("replay-out").removeAttribute("aria-busy");
    if (replay.at != null) setHead(Math.floor(replay.at + 1e-6));
    syncPlay();
  }

  // A new company or horizon ends any replay; renderForecast then redraws the whole record.
  function stopReplay() {
    cancelAnimationFrame(replay.raf);
    replay.playing = false;
    replay.at = null;
    $("replay-out").removeAttribute("aria-busy");
  }

  function watchReplay() {
    $("play").addEventListener("click", play);
    $("scrub").addEventListener("input", function () {
      if (replay.playing) {
        cancelAnimationFrame(replay.raf);
        replay.playing = false;
        $("replay-out").removeAttribute("aria-busy");
      }
      var k = +$("scrub").value;
      setHead(k >= replay.n - 1 ? null : k);
      syncPlay();
    });
  }

  // Name the bigger of the backlog and conversion effects only when it is at least twice
  // the other; closer than that, say they were about even.
  function driver(bk, cv) {
    var x = Math.abs(bk), y = Math.abs(cv);
    if (x < 2 * y && y < 2 * x) {
      return (bk >= 0) === (cv >= 0) ? "Backlog and conversion moved revenue the same way, by similar amounts. "
        : "Backlog and conversion pulled in opposite directions by similar amounts. ";
    }
    return x > y
      ? "The bigger driver was a " + (bk >= 0 ? "larger" : "smaller") + " starting backlog. "
      : "The bigger driver was turning " + (cv >= 0 ? "more" : "less") + " of the backlog into revenue. ";
  }

  // The bridge's years as a segmented control, rebuilt only when the company's years change.
  // Arrow keys step through the years, Home and End jump to the ends.
  function renderYears(co, years) {
    var box = $("years"), key = years.join(",");
    if (box.$key !== key) {
      box.$key = key;
      box.textContent = "";
      years.forEach(function (y) {
        var b = el("button", "wash");
        b.type = "button";
        b.dataset.year = y;
        twoTone(b, String(y));
        b.addEventListener("click", function () {
          if (state.year === y) return;
          state.year = y;
          renderBridge(data.companies[state.ticker], colors());
        });
        box.appendChild(b);
      });
      addPill(box);
      if (!box.$keys) {
        box.$keys = true;
        box.addEventListener("keydown", function (e) {
          var list = data.companies[state.ticker].bridge.map(function (r) { return r.year; });
          var i = list.indexOf(state.year), j = i;
          if (e.key === "ArrowRight") j = Math.min(list.length - 1, i + 1);
          else if (e.key === "ArrowLeft") j = Math.max(0, i - 1);
          else if (e.key === "Home") j = 0;
          else if (e.key === "End") j = list.length - 1;
          else return;
          e.preventDefault();
          if (j === i) return;
          state.year = list[j];
          renderBridge(data.companies[state.ticker], colors());
          box.querySelector('[data-year="' + state.year + '"]').focus();
        });
      }
    }
    box.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", +b.dataset.year === state.year ? "true" : "false");
    });
    placePill(box, introDone);
  }

  function renderBridge(co, c) {
    var years = co.bridge.map(function (r) { return r.year; });
    if (state.year == null || years.indexOf(state.year) < 0) state.year = years[years.length - 1];
    renderYears(co, years);
    var r = co.bridge.filter(function (x) { return x.year === state.year; })[0];
    var steps = [r.backlog_effect_usd, r.conversion_effect_usd, r.interaction_usd];
    var level = r.revenue_prior_usd, bars = [[0, r.revenue_prior_usd]], kinds = ["total"];
    steps.forEach(function (d) { bars.push([level, level + d]); kinds.push(d >= 0 ? "up" : "down"); level += d; });
    bars.push([0, r.revenue_usd]); kinds.push("total");
    var labels = [[String(state.year - 1), "revenue"], ["Backlog", "effect"], ["Conversion", "effect"], ["Overlap", "effect"], [String(state.year), "revenue"]];
    var values = [r.revenue_prior_usd].concat(steps, [r.revenue_usd]);
    var lows = bars.slice(1, 4).map(function (b) { return Math.min(b[0], b[1]); }).concat([r.revenue_prior_usd, r.revenue_usd]);
    var highs = bars.slice(1, 4).map(function (b) { return Math.max(b[0], b[1]); }).concat([r.revenue_prior_usd, r.revenue_usd]);
    var lo = Math.min.apply(null, lows), hi = Math.max.apply(null, highs), pad = (hi - lo) * 0.6 || hi * 0.05;

    var opts = baseOptions(c, "u-bridge", "US dollars, billions ($B)", "");
    opts.layout = { padding: { top: 20, right: 6 } };
    opts.interaction = { mode: "nearest", intersect: true };
    delete opts.scales.x.ticks.callback;
    opts.scales.x.ticks.font = { size: window.innerWidth < 520 ? 11 : 12 };
    delete opts.scales.y.ticks.maxTicksLimit;
    var yLo = Math.max(0, (lo - pad) / 1e9), yHi = (hi + pad * 0.5) / 1e9;
    var step = Math.pow(10, Math.floor(Math.log10(yHi - yLo)));
    if ((yHi - yLo) / step < 3) step /= 2;
    var yMin = Math.floor(yLo / step) * step;
    opts.scales.y.min = yMin;
    opts.scales.y.max = Math.ceil(yHi / step) * step;
    opts.scales.y.ticks.stepSize = step;
    // On first view the bars grow from where each one starts, one after another.
    opts.transitions = {
      reveal: {
        animation: {
          duration: ms("--dur-2"),
          easing: "easeOutCubic",
          delay: function (ctx) { return ctx.type === "data" ? ctx.dataIndex * ms("--stagger") : 0; }
        }
      }
    };

    var fills = kinds.map(function (k) { return k === "total" ? c.ink : k === "up" ? c.accent : c.drift; });
    var real = bars.map(function (b) { return [b[0] / 1e9, b[1] / 1e9]; });
    var prev = charts["c-bridge"];
    upsert("c-bridge", {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          data: prev && prev.$revealed ? real : real.map(function (b) { return [b[0], b[0]]; }),
          backgroundColor: fills, hoverBackgroundColor: fills,
          borderRadius: 4, borderSkipped: false, barPercentage: 0.66, categoryPercentage: 0.9, maxBarThickness: 72
        }]
      },
      options: opts
    }, {
      $bars: real,
      $colors: c,
      $values: values.map(function (x, i) { return kinds[i] === "total" ? billions(x) : signedBillions(x); }),
      $tip: function (pts) {
        var i = pts[0].dataIndex;
        return {
          rows: [{
            color: fills[i],
            label: labels[i].join(" ").replace("- ", ""),
            value: kinds[i] === "total" ? billions(values[i]) : signedBillions(values[i])
          }]
        };
      }
    });

    var change = r.revenue_usd - r.revenue_prior_usd;
    var cap = state.year + " revenue " + (change >= 0 ? "rose " : "fell ") + billions(Math.abs(change)) + " to " + billions(r.revenue_usd) +
      ". Backlog effect " + signedBillions(steps[0]) + ", conversion effect " + signedBillions(steps[1]) +
      ", overlap " + signedBillions(steps[2]) + ". " +
      driver(steps[0], steps[1]) +
      (rate(r.conversion_prior) === rate(r.conversion)
        ? "Conversion held at " + rate(r.conversion) + " of starting backlog."
        : "Conversion went from " + rate(r.conversion_prior) + " to " + rate(r.conversion) + " of starting backlog.") +
      (yMin > 0 ? " The axis starts above zero." : "");
    $("bridge-cap").textContent = cap;
    renderTable("t-bridge", {
      caption: "What moved revenue",
      head: ["Step", "US dollars, billions ($B)"],
      rows: labels.map(function (l, i) { return [l.join(" ").replace("- ", ""), kinds[i] === "total" ? billions(values[i]) : signedBillions(values[i])]; })
    });
    describe("c-bridge", co.ticker + " revenue bridge for " + state.year + ". " + cap);
  }

  /* ---------- what if ---------- */

  var scenario = { shown: null, stop: function () {} };

  function writeScenario(val, base) {
    var d = val - base, delta = $("fwd-delta");
    $("fwd").textContent = billions(val);
    delta.textContent = "";
    if (d === 0) {
      delta.textContent = "Today's backlog at its typical conversion rate: " + billions(base);
    } else {
      delta.appendChild(el("strong", "", signedBillions(d) + " (" + (d < 0 ? "−" : "+") + Math.abs(d / base * 100).toFixed(1) + "%)"));
      delta.appendChild(document.createTextNode(" compared with " + billions(base) + " with no change"));
    }
    $("peek-num").textContent = billions(val);
    $("peek-delta").textContent = d === 0 ? "No change"
      : signedBillions(d) + " (" + (d < 0 ? "−" : "+") + Math.abs(d / base * 100).toFixed(1) + "%)";
  }

  function buildGrid(co, c, shocks, shifts, cell) {
    var all = co.sensitivity.map(function (r) { return r.forward_revenue_usd; });
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    var table = $("grid");
    Array.prototype.slice.call(table.querySelectorAll("thead, tbody")).forEach(function (n) { n.remove(); });
    var thead = document.createElement("thead"), hr = document.createElement("tr");
    var corner = el("th", "");
    corner.appendChild(el("span", "corner", "Backlog"));
    hr.appendChild(corner);
    shifts.forEach(function (f) { var th = el("th", "", signedPct(f, " pp")); th.scope = "col"; th.dataset.f = f; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement("tbody");
    shocks.slice().reverse().forEach(function (s) {
      var tr = document.createElement("tr"), th = el("th", "", signedPct(s));
      th.scope = "row"; th.dataset.s = s; tr.appendChild(th);
      shifts.forEach(function (f) {
        var v = cell(s, f), td = document.createElement("td"), b = el("button", "wash" + (s === 0 && f === 0 ? " base" : ""));
        // The dollar sign is its own span, so the smallest phones can drop it to fit.
        b.appendChild(el("span", "cur", "$"));
        // A break opportunity before the unit, for text too large to fit on one line.
        b.appendChild(document.createTextNode(billions(v).slice(1, -1)));
        b.appendChild(document.createElement("wbr"));
        b.appendChild(document.createTextNode("B"));
        var share = mx > mn ? (v - mn) / (mx - mn) : 0.5;
        b.type = "button";
        b.dataset.s = s;
        b.dataset.f = f;
        b.style.background = "color-mix(in oklab, " + c.accent + " " + Math.round(7 + share * 53) + "%, " + c.surface + ")";
        b.setAttribute("aria-label", spoken("Backlog " + signedPct(s) + ", conversion " + signedPct(f, " percentage points") + ": " + billions(v)));
        // Pointing at a cell lights its row and column headers, so it reads as coordinates.
        // Only a real mouse: a tap would leave the preview stuck on.
        b.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") hover(s, f); });
        b.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hover(null, null); });
        b.addEventListener("click", function () {
          state.shock = s; state.shift = f;
          renderWhatIf(data.companies[state.ticker], colors(), true);
          syncQuery();
        });
        td.appendChild(b); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    table.$key = co.ticker + "|" + c.accent + "|" + c.surface;
  }

  // Arrow keys move through the grid and choose the scenario under the cursor, the way
  // a radio group does; Home and End jump to the ends of a row.
  function gridKeys(e) {
    var b = e.target.closest ? e.target.closest("td button") : null;
    if (!b) return;
    var td = b.parentNode, tr = td.parentNode, body = tr.parentNode;
    var r = tr.sectionRowIndex, c = td.cellIndex - 1, rows = body.rows.length, cols = tr.cells.length - 1;
    if (e.key === "ArrowUp") r = Math.max(0, r - 1);
    else if (e.key === "ArrowDown") r = Math.min(rows - 1, r + 1);
    else if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
    else if (e.key === "ArrowRight") c = Math.min(cols - 1, c + 1);
    else if (e.key === "Home") c = 0;
    else if (e.key === "End") c = cols - 1;
    else return;
    e.preventDefault();
    var next = body.rows[r].cells[c + 1].querySelector("button");
    if (next !== b) { next.click(); next.focus(); }
  }

  function hover(s, f) {
    $("grid").querySelectorAll("th[data-s], th[data-f]").forEach(function (th) {
      th.classList.toggle("hv", th.dataset.s != null ? s != null && +th.dataset.s === s : f != null && +th.dataset.f === f);
    });
    previewFan(s, f);
  }

  // Pointing at a grid cell lifts that scenario's line out of the fan.
  function previewFan(s, f) {
    var ch = charts["c-fan"];
    if (!ch || !ch.$cells) return;
    var i = s == null ? null : ch.$cells[s + "|" + f];
    if (i === undefined) i = null;
    if (ch.$preview === i) return;
    ch.$preview = i;
    ch.data.datasets.forEach(function (ds, j) {
      if (ds.key !== "s") return;
      ds.borderColor = j === i ? fade(ch.$colors.accent, 0.6) : ds.$color;
      ds.borderWidth = j === i ? 2 : 1;
    });
    ch.update("none");
  }

  // Move the selection ring over the chosen cell. offsetLeft ignores the press scale.
  function moveRing(animate) {
    var wrap = $("grid-wrap"), ring = $("ring"), on = $("grid").querySelector("button.on");
    if (!on) { ring.style.opacity = "0"; return; }
    var x = 0, y = 0;
    for (var n = on; n && n !== wrap; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    ring.style.width = on.offsetWidth + 6 + "px";
    ring.style.height = on.offsetHeight + 6 + "px";
    if (!animate) ring.style.transition = "none";
    ring.style.transform = "translate(" + (x - 3) + "px," + (y - 3) + "px)";
    if (!animate) { void ring.offsetWidth; ring.style.transition = ""; }
    ring.style.opacity = "1";
  }

  function renderWhatIf(co, c, fromInput) {
    var shocks = [], shifts = [];
    co.sensitivity.forEach(function (r) {
      if (shocks.indexOf(r.backlog_shock_pct) < 0) shocks.push(r.backlog_shock_pct);
      if (shifts.indexOf(r.conversion_shift_pp) < 0) shifts.push(r.conversion_shift_pp);
    });
    shocks.sort(function (a, b) { return a - b; });
    shifts.sort(function (a, b) { return a - b; });
    if (state.shock == null || shocks.indexOf(state.shock) < 0) state.shock = 0;
    if (state.shift == null || shifts.indexOf(state.shift) < 0) state.shift = 0;

    function cell(s, f) {
      return co.sensitivity.filter(function (r) { return r.backlog_shock_pct === s && r.conversion_shift_pp === f; })[0].forward_revenue_usd;
    }
    var shockIn = $("shock"), shiftIn = $("shift");
    [[shockIn, shocks, state.shock, "shock-ticks", "%"], [shiftIn, shifts, state.shift, "shift-ticks", " pp"]].forEach(function (a) {
      var i = a[1].indexOf(a[2]), n = a[1].length - 1;
      a[0].min = 0; a[0].max = n; a[0].step = 1; a[0].value = i;
      a[0].style.setProperty("--p", n ? i / n : 0.5);
      var ticks = $(a[3]);
      ticks.innerHTML = "";
      a[1].forEach(function (v, j) {
        var s = el("span", j === i ? "on" : "", signedPct(v, a[4]));
        s.style.left = (n ? j / n * 100 : 50) + "%";
        ticks.appendChild(s);
      });
    });
    shockIn.setAttribute("aria-valuetext", signedPct(state.shock) + " backlog");
    shiftIn.setAttribute("aria-valuetext", signedPct(state.shift, " percentage points") + " conversion");
    $("reset").setAttribute("aria-disabled", state.shock === 0 && state.shift === 0 ? "true" : "false");
    shockIn.oninput = function () { state.shock = shocks[+shockIn.value]; renderWhatIf(co, colors(), true); syncQuery(); };
    shiftIn.oninput = function () { state.shift = shifts[+shiftIn.value]; renderWhatIf(co, colors(), true); syncQuery(); };

    var base = cell(0, 0), val = cell(state.shock, state.shift);
    $("shock-out").textContent = signedPct(state.shock);
    $("shift-out").textContent = signedPct(state.shift, " pp");
    scenario.stop();
    if (fromInput && scenario.shown != null) {
      scenario.stop = tween(scenario.shown, val, TWEEN_MS, function (x) { scenario.shown = x; writeScenario(x, base); });
    } else {
      scenario.shown = val;
      writeScenario(val, base);
    }

    var L = co.quarters.length - 1, ttm = co.ttm_revenue_usd[L], bias = data.metrics.bias.H4.backlog[co.ticker];
    var gap = (base / ttm - 1) * 100;
    $("fwd-context").textContent = "Revenue over the four quarters to " + co.quarters[L] + " was " + billions(ttm) +
      ", so the no-change scenario sits " + Math.abs(gap).toFixed(1) + "% " + (gap >= 0 ? "above" : "below") + " it." +
      (bias == null ? "" : " In past tests the backlog model's four-quarter forecasts for " + co.ticker + " ran " +
        Math.abs(bias).toFixed(1) + "% " + (bias >= 0 ? "high" : "low") + " on average.");

    var table = $("grid");
    if (table.$key !== co.ticker + "|" + c.accent + "|" + c.surface) buildGrid(co, c, shocks, shifts, cell);
    table.querySelectorAll("td button").forEach(function (b) {
      var on = +b.dataset.s === state.shock && +b.dataset.f === state.shift;
      b.classList.toggle("on", on);
      b.tabIndex = on ? 0 : -1;    // one tab stop for the whole grid; arrows move within it
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // Light up the row and column headers of the chosen scenario.
    table.querySelectorAll("th[data-s], th[data-f]").forEach(function (th) {
      th.classList.toggle("hl", th.dataset.s != null ? +th.dataset.s === state.shock : +th.dataset.f === state.shift);
    });
    moveRing(introDone);
    renderFan(co, c, shocks, shifts, cell);
    if (fromInput) {
      var d = val - base;
      announce("Backlog " + signedPct(state.shock) + ", conversion " + signedPct(state.shift, " pp") +
        ": scenario revenue " + billions(val) + (d === 0 ? ", no change." : ", " + (d > 0 ? "up " : "down ") +
        billions(Math.abs(d)) + " (" + Math.abs(d / base * 100).toFixed(1) + "%) from no change."));
    }
  }

  function nextQuarter(q, n) {
    var k = +q.slice(5) - 1 + n;
    return (+q.slice(0, 4) + Math.floor(k / 4)) + "Q" + (k % 4 + 1);
  }

  // Trailing four-quarter revenue up to the latest quarter, then every scenario as a line
  // to the quarter four ahead. Trailing revenue at that quarter is exactly the scenario's
  // revenue over the next four, so each line ends at its own figure.
  function renderFan(co, c, shocks, shifts, cell) {
    var L = co.quarters.length - 1, H = Math.min(8, L + 1), start = L - H + 1;
    var labels = co.quarters.slice(start).concat([1, 2, 3, 4].map(function (n) { return nextQuarter(co.quarters[L], n); }));
    var at = H - 1, end = labels.length - 1, ttm = co.ttm_revenue_usd[L];
    var toB = function (v) { return v == null ? null : v / 1e9; };
    var path = function (v) {
      var d = labels.map(function () { return null; });
      d[at] = toB(ttm);
      d[end] = toB(v);
      return d;
    };
    var hist = lineSet(c, "Revenue, trailing four quarters", co.ttm_revenue_usd.slice(start).map(toB).concat([null, null, null, null]), c.ink, 2.5, "ttm");
    hist.order = 0;
    var datasets = [hist], all = [], cells = {};
    shocks.forEach(function (s) {
      shifts.forEach(function (f) {
        var v = cell(s, f);
        all.push(v);
        if (s === 0 && f === 0) return;
        var ds = lineSet(c, "Scenario", path(v), fade(c.muted, 0.22), 1, "s");
        ds.spanGaps = true;
        ds.order = 3;
        ds.pointHitRadius = 0;
        ds.pointHoverRadius = 0;
        cells[s + "|" + f] = datasets.length;
        datasets.push(ds);
      });
    });
    var base = cell(0, 0), val = cell(state.shock, state.shift);
    var none = lineSet(c, "No change", path(base), c.ink, 1.5, "base");
    none.borderDash = [5, 4];
    none.spanGaps = true;
    none.order = 2;
    var sel = lineSet(c, "Selected scenario", path(val), c.accent, 2.75, "sel");
    sel.spanGaps = true;
    sel.order = 1;
    datasets.push(none, sel);
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), isBase = state.shock === 0 && state.shift === 0;

    var opts = baseOptions(c, "u-fan", "Revenue over four quarters, $B", "");
    opts.scales.y.ticks.maxTicksLimit = 5;
    upsert("c-fan", { type: "line", data: { labels: labels, datasets: datasets }, options: opts }, {
      $colors: c,
      $crosshair: true,
      $ends: true,
      $endKeys: isBase ? ["sel"] : ["base", "sel"],
      $future: at,
      $futureLabel: "Next four quarters",
      $cells: cells,
      $preview: null,
      $tip: function (pts) {
        var i = pts[0].dataIndex;
        if (i <= at) {
          return { title: labels[i], rows: [{ color: c.ink, label: "Revenue, trailing four quarters", value: billions(co.ttm_revenue_usd[start + i]) }] };
        }
        if (i !== end) return null;
        var rows = [{ color: c.accent, label: "Selected scenario", value: billions(val) }];
        if (!isBase) rows.push({ color: c.ink, label: "No change", value: billions(base) });
        rows.push({ color: fade(c.muted, 0.5), label: "Lowest to highest", value: billions(mn) + " to " + billions(mx) });
        return { title: "Four quarters to " + labels[end], rows: rows };
      }
    });
    var cap = co.ticker + " revenue over the four quarters to " + co.quarters[L] + " was " + billions(ttm) +
      ". The " + all.length + " scenarios for the four quarters to " + labels[end] + " run from " + billions(mn) +
      " to " + billions(mx) + "; the selected one is " + billions(val) + ".";
    describe("c-fan", cap);
    renderTable("t-fan", {
      caption: $("fan-title").textContent,
      head: ["Quarter", "Revenue over four quarters, $B"],
      rows: co.ttm_revenue_usd.slice(start).map(function (v, i) { return [labels[i], billions(v)]; }).concat([
        [labels[end] + ", selected scenario", billions(val)],
        [labels[end] + ", no change", billions(base)],
        [labels[end] + ", lowest scenario", billions(mn)],
        [labels[end] + ", highest scenario", billions(mx)]
      ])
    });
  }

  function renderCompany() {
    var co = data.companies[state.ticker], c = colors();
    renderBacklog(co, c);
    renderForecast(co, c);
    renderBridge(co, c);
    renderWhatIf(co, c);
  }

  /* ---------- light and dark ---------- */

  var SUN = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var MOON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : darkMode.matches;
  }

  // The button shows the theme it switches to. A chosen theme also sets the browser's
  // own bar colour, which otherwise follows the system setting.
  function syncTheme() {
    var b = $("theme"), dark = isDark();
    b.innerHTML = dark ? SUN : MOON;
    b.setAttribute("aria-label", dark ? "Use the light theme" : "Use the dark theme");
    b.title = dark ? "Light theme" : "Dark theme";
    if (document.documentElement.hasAttribute("data-theme")) {
      document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute("content", css("--bg")); });
    }
  }

  function watchTheme(rerender) {
    syncTheme();
    $("theme").addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("dbf-theme", next); } catch (e) { /* the choice lasts for this visit only */ }
      syncTheme();
      rerender();
    });
  }

  /* ---------- section links, the scenario pill and touch tooltips ---------- */

  // The compact bar's section links scroll to a panel without touching the hash, which
  // holds the company, then hand focus to the panel's heading. The link for the panel
  // under the bar is marked as the current one.
  function watchJump() {
    var links = [].slice.call($("jump").querySelectorAll("a")), queued = false;
    // The skip link works the same way, so it never replaces the company in the hash.
    document.querySelector(".skip").addEventListener("click", function (e) {
      e.preventDefault();
      var to = $("cos");
      to.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });
      to.focus({ preventScroll: true });
    });
    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        var panel = $(a.getAttribute("href").slice(1));
        if (!panel) return;
        e.preventDefault();
        panel.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });
        var h = panel.querySelector("h2");
        if (h) h.focus({ preventScroll: true });
      });
    });
    function spy() {
      queued = false;
      var cur = null, end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      links.forEach(function (a) {
        if ($(a.getAttribute("href").slice(1)).getBoundingClientRect().top <= 120) cur = a;
      });
      if (end) cur = links[links.length - 1];
      links.forEach(function (a) {
        if (a === cur) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
      });
    }
    window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(spy); } }, { passive: true });
    spy();
  }

  // On a narrow screen the scenario figure rides at the foot of the screen while the
  // sliders or grid are in view and the readout itself is not.
  function watchPeek() {
    var pill = $("peek"), narrow = window.matchMedia("(max-width: 900px)");
    if (!window.IntersectionObserver) return;
    var seen = { num: true, ctl: false, grid: false };
    function sync() { pill.classList.toggle("show", narrow.matches && !seen.num && (seen.ctl || seen.grid)); }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { seen[e.target.$peek] = e.isIntersecting; });
      sync();
    }, { rootMargin: "-64px 0px -72px 0px" });
    [[$("fwd"), "num"], [document.querySelector(".whatif .controls"), "ctl"], [$("grid-wrap"), "grid"]].forEach(function (t) {
      t[0].$peek = t[1];
      io.observe(t[0]);
    });
    if (narrow.addEventListener) narrow.addEventListener("change", sync);
  }

  // A tap leaves a chart's tooltip and the linked crosshairs on screen, since touch has no
  // mouseout. Tapping anywhere else, or scrolling, clears them.
  function clearTips() {
    Object.keys(charts).forEach(function (id) {
      var ch = charts[id], act = ch.tooltip ? ch.tooltip.getActiveElements() : [];
      if (ch.$link == null && !act.length) return;
      ch.$link = null;
      ch.setActiveElements([]);
      if (ch.tooltip) ch.tooltip.setActiveElements([], { x: 0, y: 0 });
      ch.update("none");
    });
  }

  /* ---------- reading a chart from the keyboard ---------- */

  // A focused chart steps through its points with the arrow keys. Each step shows the
  // same tooltip and linked crosshairs a pointer would, and speaks the tooltip's rows.
  var CHART_IDS = ["c-backlog", "c-btb", "c-fc", "c-bridge", "c-fan"];

  // The points a pointer at quarter i would pick up, shaped like Chart.js's own.
  function pointsAt(ch, i) {
    var out = [];
    ch.data.datasets.forEach(function (ds, j) {
      if (!ch.isDatasetVisible(j) || ds.key === "s" || ds.data[i] == null) return;
      out.push({ dataIndex: i, datasetIndex: j, index: i, dataset: ds, raw: ds.data[i], element: ch.getDatasetMeta(j).data[i] });
    });
    return out;
  }

  // Only the indexes whose tooltip says something: the fan's empty future quarters and
  // the gaps in book-to-bill are skipped.
  function stops(ch) {
    var out = [];
    for (var i = 0; i < ch.data.labels.length; i++) {
      var pts = pointsAt(ch, i);
      if (pts.length && ch.$tip && ch.$tip(pts)) out.push(i);
    }
    return out;
  }

  function tipText(spec) {
    return [spec.title].concat(spec.rows.map(function (r) {
      return r.label + " " + r.value + (r.extra ? ", " + r.extra : "");
    })).filter(Boolean).join(". ") + ".";
  }

  function stepChart(e) {
    var id = e.currentTarget.id, ch = charts[id];
    if (!ch) return;
    if (e.key === "Escape") {
      if (ch.$kbd == null) return;
      ch.$kbd = null;
      clearTips();
      return;
    }
    var list = stops(ch);
    if (!list.length) return;
    var at = list.indexOf(ch.$kbd), j;
    if (e.key === "ArrowRight") j = at < 0 ? 0 : Math.min(list.length - 1, at + 1);
    else if (e.key === "ArrowLeft") j = at < 0 ? list.length - 1 : Math.max(0, at - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = list.length - 1;
    else return;
    e.preventDefault();
    var i = list[j], pts = pointsAt(ch, i);
    ch.$kbd = i;
    var act = pts.map(function (p) { return { datasetIndex: p.datasetIndex, index: i }; });
    var el0 = pts[0].element;
    ch.setActiveElements(act);
    if (ch.tooltip) ch.tooltip.setActiveElements(act, { x: el0 ? el0.x : 0, y: el0 ? el0.y : 0 });
    ch.update("none");
    if (LINKED.indexOf(id) >= 0) linkHover({ type: "keydown" }, act, ch);
    announce(tipText(ch.$tip(pts)), 150);
  }

  function watchChartKeys() {
    CHART_IDS.forEach(function (id) {
      var canvas = $(id);
      canvas.addEventListener("keydown", stepChart);
      canvas.addEventListener("blur", function () {
        var ch = charts[id];
        if (ch && ch.$kbd != null) { ch.$kbd = null; clearTips(); }
      });
    });
  }

  function watchTouchTips() {
    var touched = false;
    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      if (e.target.closest && e.target.closest(".chart")) { touched = true; return; }
      if (touched) { touched = false; clearTips(); }
    }, { passive: true });
    window.addEventListener("scroll", function () { if (touched) { touched = false; clearTips(); } }, { passive: true });
  }

  /* ---------- keyboard shortcuts ---------- */

  // 1 to 5 pick a company, R plays or pauses the replay and ? lists them. They stand
  // aside while a text field, slider, menu or dialog has focus, and whenever a modifier
  // key is held. Single keys can be set off by speech input, so the list carries a
  // switch that turns them off; the choice is kept for the next visit.
  var keysOn = true;
  try { keysOn = localStorage.getItem("dbf-keys") !== "off"; } catch (e) { /* on for this visit */ }

  function syncKeys() {
    var sw = $("keys-switch");
    sw.setAttribute("aria-checked", keysOn ? "true" : "false");
    $("keys-open").textContent = keysOn ? "Keyboard shortcuts" : "Keyboard shortcuts (off)";
    document.querySelectorAll("#cards .card").forEach(function (b, i) {
      if (keysOn && i < 9) b.setAttribute("aria-keyshortcuts", String(i + 1)); else b.removeAttribute("aria-keyshortcuts");
    });
    if (keysOn) $("play").setAttribute("aria-keyshortcuts", "R"); else $("play").removeAttribute("aria-keyshortcuts");
    document.documentElement.classList.toggle("keys-off", !keysOn);
  }

  function watchKeysDialog() {
    var dlg = $("keys-dlg"), opener = null;
    function open() {
      opener = document.activeElement;
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
      $("keys-switch").focus();
    }
    function close() {
      if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
    }
    dlg.addEventListener("close", function () { if (opener && opener.focus) opener.focus(); });
    // A click on the backdrop, outside the box, closes it.
    dlg.addEventListener("click", function (e) {
      if (e.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    $("keys-open").addEventListener("click", open);
    $("keys-close").addEventListener("click", close);
    $("keys-switch").addEventListener("click", function () {
      keysOn = !keysOn;
      try { localStorage.setItem("dbf-keys", keysOn ? "on" : "off"); } catch (e) { /* this visit only */ }
      syncKeys();
      announce(keysOn ? "Single-key shortcuts on." : "Single-key shortcuts off.", 0);
    });
    syncKeys();
    return open;
  }

  function watchKeys() {
    var openKeys = watchKeysDialog();
    document.addEventListener("keydown", function (e) {
      if (!keysOn || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      if ($("keys-dlg").open) return;
      if (e.key === "?") { e.preventDefault(); openKeys(); return; }
      var n = /^[1-9]$/.test(e.key) ? +e.key : 0;
      if (n && n <= tickers.length) {
        var onCard = document.activeElement && document.activeElement.closest && document.activeElement.closest("#cards");
        selectTicker(tickers[n - 1], true);
        if (onCard) $("tab-" + tickers[n - 1]).focus();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        var r = $("replay").getBoundingClientRect(), away = r.top < 0 || r.bottom > innerHeight;
        if (still()) {
          // No animation: rewind to the first forecast and hand the scrubber the keyboard,
          // so the arrow keys step through the backtest instead.
          if (away) $("fc-title").closest(".panel").scrollIntoView({ block: "start" });
          var s = $("scrub");
          s.value = s.min;
          s.dispatchEvent(new Event("input"));
          s.focus();
          return;
        }
        if (away) $("fc-title").closest(".panel").scrollIntoView({ block: "start", behavior: "smooth" });
        play();
      }
    });
  }

  /* ---------- URL state: #LMT?view=h4&shock=-5&shift=1.5 ---------- */

  function readUrl() {
    var h = location.hash.replace("#", "").toUpperCase();
    var q = new URLSearchParams(location.search);
    state.ticker = tickers.indexOf(h) >= 0 ? h : tickers.indexOf("LMT") >= 0 ? "LMT" : tickers[0];
    var view = (q.get("view") || "").toLowerCase();
    if (view === "h1" || view === "h4") state.view = view;
    if (q.has("shock")) state.shock = parseFloat(q.get("shock"));
    if (q.has("shift")) state.shift = parseFloat(q.get("shift"));
  }

  function syncQuery() {
    var q = new URLSearchParams(location.search);
    if (state.view !== "h4") q.set("view", state.view); else q.delete("view");
    if (state.shock) q.set("shock", state.shock); else q.delete("shock");
    if (state.shift) q.set("shift", state.shift); else q.delete("shift");
    var s = q.toString();
    history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + "#" + state.ticker);
  }

  /* ---------- start ---------- */

  function ready() {
    if (introDone) return;
    var root = document.documentElement;
    root.classList.add("ready");
    introAt = performance.now();
    var last = LAST_INTRO * ms("--stagger") + ms("--dur-3");
    setTimeout(function () { root.classList.add("intro-done"); }, last + 50);
    introDone = true;
  }

  function init(json) {
    data = json;
    tickers = Object.keys(data.companies);
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.register(theme);
    readUrl();
    renderHeader();
    renderBackdrop();
    renderCards();
    renderTabs();

    var seg = $("seg");
    seg.querySelectorAll("button").forEach(function (b) {
      b.classList.add("wash");
      twoTone(b, b.textContent);
      b.addEventListener("click", function () {
        state.view = b.getAttribute("data-view");
        renderForecast(data.companies[state.ticker], colors());
        placePill(seg, true);
        syncQuery();
      });
    });
    addPill(seg);

    window.addEventListener("hashchange", function () {
      var h = location.hash.replace("#", "").toUpperCase();
      if (tickers.indexOf(h) >= 0 && h !== state.ticker) selectTicker(h, false);
    });
    var rerender = function () {
      renderHeader();
      renderCompany();
      if (still()) revealAll();
    };
    if (darkMode.addEventListener) {
      darkMode.addEventListener("change", function () { syncTheme(); rerender(); });
      reduceMotion.addEventListener("change", rerender);
    }
    if (window.ResizeObserver) new ResizeObserver(function () { moveRing(false); }).observe($("grid-wrap"));
    $("grid").addEventListener("keydown", gridKeys);
    $("reset").addEventListener("click", function () {
      if (state.shock === 0 && state.shift === 0) return;
      state.shock = 0; state.shift = 0;
      renderWhatIf(data.companies[state.ticker], colors(), true);
      syncQuery();
    });
    watchInfo();
    watchTables();
    watchDensity();
    watchReplay();
    watchTheme(rerender);
    watchKeys();

    selectTicker(state.ticker, false);
    placePill(seg, false);
    watchSticky();
    watchProgress();
    watchJump();
    watchPeek();
    watchTouchTips();
    watchChartKeys();
    // Reveal on the next frame, or shortly after if frames are being held back.
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      ready();
      watchCharts();
    };
    requestAnimationFrame(start);
    setTimeout(start, 100);
  }

  // A failed download says so and offers another try; the page is shown either way.
  function failed(err) {
    if (window.console) console.error(err);
    var head = $("headline"), b = el("button", "retry wash", "Try again");
    head.textContent = "The data did not load. ";
    head.setAttribute("role", "alert");
    b.type = "button";
    b.addEventListener("click", function () {
      head.removeAttribute("role");
      head.textContent = "Loading the results.";
      load();
    });
    head.appendChild(b);
    document.documentElement.classList.add("ready");
    b.focus();
  }

  function load() {
    fetch("data.json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(init, failed)
      .catch(function (err) {
        if (window.console) console.error(err);
        document.documentElement.classList.add("ready");
      });
  }

  load();
})();
