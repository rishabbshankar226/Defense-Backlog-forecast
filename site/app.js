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
    shift: { ask: "What is a change in conversion rate?", terms: [["Change in conversion rate (pp)", "A hypothetical change to the conversion rate, in percentage points: an absolute change in the rate, not a percentage of it."]] }
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
  var PANEL_INDEX = { "c-backlog": 3, "c-fc": 4, "c-bridge": 5 };
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
      cross: css("--crosshair"), ink2: css("--ink-2")
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

  // Draw-in clip, crosshair, largest-miss marker and waterfall connectors, in one plugin.
  var theme = {
    id: "dbfTheme",
    beforeDatasetsDraw: function (chart) {
      var a = chart.chartArea, ctx = chart.ctx, r = chart.$reveal == null ? 1 : chart.$reveal;
      ctx.save();
      if (r < 1) {
        ctx.beginPath();
        ctx.rect(0, 0, a.left - 4 + (a.right - a.left + 12) * r, chart.height);
        ctx.clip();
      }
      if (chart.$crosshair) {
        var act = chart.tooltip ? chart.tooltip.getActiveElements() : [];
        if (act.length) {
          var x = Math.round(act[0].element.x) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, a.top);
          ctx.lineTo(x, a.bottom);
          ctx.lineWidth = 1;
          ctx.strokeStyle = chart.$colors.cross;
          ctx.stroke();
        }
      }
    },
    afterDatasetsDraw: function (chart) {
      if (chart.$miss) drawMiss(chart);
      if (chart.$connectors) drawConnectors(chart);
      chart.ctx.restore();
      if (chart.$ends) drawEnds(chart);
    }
  };

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

  // Quarterly axes are labelled at each year's first quarter, every other year when narrow.
  // Tooltips still name the exact quarter.
  function yearTick(value) {
    var q = this.getLabelForValue(value);
    if (!/Q1$/.test(q)) return "";
    var y = +q.slice(0, 4);
    return this.chart.width < 520 && y % 2 ? "" : String(y);
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
      if (config.type === "line") ch.$reveal = still() ? 1 : 0;
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
      if (ch.config.type === "bar") {
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
    $("asof").textContent = "Data as of " + longDate(data.as_of);

    var c = colors(), tiles = $("tiles"), stagger = ms("--stagger");
    var scale = Math.max.apply(null, MODELS.map(function (k) { return h4[k].ALL; }));
    tiles.innerHTML = "";
    // One row per figure: label and value, then a bar on a shared scale so the gaps read at a glance.
    function row(i, cls, name, color, value, share, sub, flag) {
      var t = el("div", "tile" + (cls ? " " + cls : ""));
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
      return t;
    }
    MODELS.forEach(function (k, i) {
      row(i, k === best ? "best" : "", NAMES.h4[k], modelColor(c, k), h4[k].ALL, h4[k].ALL / scale,
        GLOSS[k], k === best ? "Lowest error" : null);
    });
    var win = m.win_rate_vs_naive.H4.ALL;
    var w = row(3, "win", "Backlog model was closer", null, win, win / 100,
      "than trailing 4Q in " + Math.round(win / 100 * m.n.H4) + " of " + m.n.H4 + " four-quarter forecasts");
    w.querySelector(".bar").appendChild(el("b", "half"));
  }

  function grow(fill, share, delay) {
    var to = "scaleX(" + share + ")";
    if (introDone || still()) { fill.style.transform = to; return; }
    fill.style.transform = "scaleX(0)";
    setTimeout(function () { fill.style.transform = to; }, delay);
  }

  /* ---------- tabs ---------- */

  function renderTabs() {
    var bar = $("tabs");
    bar.innerHTML = "";
    tickers.forEach(function (t) {
      var b = el("button", "wash");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.id = "tab-" + t;
      b.setAttribute("aria-label", COMPANY[t] ? COMPANY[t] + " (" + t + ")" : t);
      twoTone(b, t);
      b.addEventListener("click", function () { selectTicker(t, true); });
      bar.appendChild(b);
    });
    addPill(bar);
    bar.addEventListener("keydown", function (e) {
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

  function selectTicker(t, push) {
    state.ticker = t;
    tickers.forEach(function (k) {
      var b = $("tab-" + k), on = k === t;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    placePill($("tabs"), true);
    $("co-name").textContent = COMPANY[t] || "";
    $("company").setAttribute("aria-labelledby", "tab-" + t);
    if (push && location.hash !== "#" + t) history.replaceState(null, "", location.pathname + location.search + "#" + t);
    state.year = null;
    renderVerdict(t);
    renderCompany();
  }

  // One sentence on how the backlog model did for the selected company.
  function renderVerdict(t) {
    var m = data.metrics, b = m.mape.H4.backlog[t], n = m.mape.H4.naive[t], w = m.win_rate_vs_naive.H4[t];
    var box = $("verdict");
    box.textContent = "";
    if (b == null || n == null) return;
    var name = COMPANY[t] || t, fig = function (text) { return el("span", "num", text); };
    [el("strong", "", "Backlog did " + (b < n ? "better" : "worse") + " for " + name + ": "),
      "its four-quarter forecasts missed by ", fig(pct(b)), " on average, against ", fig(pct(n)),
      " for trailing 4Q" + (w == null ? "." : ", and came closer in "), w == null ? "" : fig(pct(w)), w == null ? "" : " of them."]
      .forEach(function (p) { box.appendChild(typeof p === "string" ? document.createTextNode(p) : p); });
  }

  // Show the tab bar's backdrop and hairline only once it is stuck to the top.
  function watchSticky() {
    if (!window.IntersectionObserver) return;
    var bar = $("tabbar");
    new IntersectionObserver(function (entries) {
      var e = entries[0];
      bar.classList.toggle("stuck", !e.isIntersecting && e.boundingClientRect.top < 0);
    }).observe($("tabbar-sentinel"));
  }

  /* ---------- panels ---------- */

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
      options: baseOptions(c, "u-backlog", "US dollars, billions ($B)", "Quarter")
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
      head: ["Quarter", "Backlog (RPO)", "Revenue, trailing four quarters"],
      rows: co.quarters.map(function (q, i) { return [q, billions(co.backlog_usd[i]), billions(co.ttm_revenue_usd[i])]; })
    });

    var L = co.quarters.length - 1;
    var gaps = co.quarters.filter(function (q, i) { return co.backlog_usd[i] == null; });
    $("c-backlog").setAttribute("aria-label", co.ticker + " backlog and trailing four-quarter revenue by quarter. At " +
      co.quarters[L] + ", backlog was " + billions(co.backlog_usd[L]) + " and trailing revenue " + billions(co.ttm_revenue_usd[L]) + ".");
    $("backlog-note").textContent = "Backlog at each quarter end against revenue over the trailing four quarters, in $B. " +
      "When the backlog line climbs faster than revenue, more signed work is waiting to be delivered." +
      (gaps.length ? " Breaks in the backlog line are quarters whose filings tag no backlog for the quarter's own end: " + gaps.join(", ") + "." : "");
  }

  function renderForecast(co, c) {
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

    var ch = upsert("c-fc", {
      type: "line",
      data: { labels: block.target, datasets: datasets },
      options: baseOptions(c, "u-fc", v === "h1" ? "Quarterly revenue, $B" : "Revenue over four quarters, $B",
        v === "h1" ? "Quarter forecast" : "Last quarter of the four forecast")
    }, {
      $colors: c,
      $crosshair: true,
      $ends: true,
      $miss: { index: worst, ds: 1, ref: 0, label: worst >= 0 ? pct(apes.backlog[worst]) : "" },
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
    $("c-fc").setAttribute("aria-label", co.ticker + " " + (v === "h1" ? "next-quarter" : "next-four-quarter") +
      " forecasts against actual revenue. MAPE: " + MODELS.map(function (m) { return NAMES[v][m] + " " + pct(mape[m][co.ticker]); }).join(", ") + ". " + cap);
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-view") === v ? "true" : "false");
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

  function renderBridge(co, c) {
    var sel = $("year");
    var years = co.bridge.map(function (r) { return r.year; });
    if (state.year == null || years.indexOf(state.year) < 0) state.year = years[years.length - 1];
    sel.innerHTML = "";
    years.forEach(function (y) {
      var o = document.createElement("option");
      o.value = y; o.textContent = y; o.selected = y === state.year;
      sel.appendChild(o);
    });
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
      head: ["", "US dollars, billions ($B)"],
      rows: labels.map(function (l, i) { return [l.join(" ").replace("- ", ""), kinds[i] === "total" ? billions(values[i]) : signedBillions(values[i])]; })
    });
    $("c-bridge").setAttribute("aria-label", co.ticker + " revenue bridge for " + state.year + ". " + cap);
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
  }

  function buildGrid(co, c, shocks, shifts, cell) {
    var all = co.sensitivity.map(function (r) { return r.forward_revenue_usd; });
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    var table = $("grid");
    Array.prototype.slice.call(table.querySelectorAll("thead, tbody")).forEach(function (n) { n.remove(); });
    var thead = document.createElement("thead"), hr = document.createElement("tr");
    hr.appendChild(el("th", "", "Backlog"));
    shifts.forEach(function (f) { var th = el("th", "", signedPct(f, " pp")); th.scope = "col"; th.dataset.f = f; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement("tbody");
    shocks.slice().reverse().forEach(function (s) {
      var tr = document.createElement("tr"), th = el("th", "", signedPct(s));
      th.scope = "row"; th.dataset.s = s; tr.appendChild(th);
      shifts.forEach(function (f) {
        var v = cell(s, f), td = document.createElement("td"), b = el("button", "wash" + (s === 0 && f === 0 ? " base" : ""), billions(v));
        var share = mx > mn ? (v - mn) / (mx - mn) : 0.5;
        b.type = "button";
        b.dataset.s = s;
        b.dataset.f = f;
        b.style.background = "color-mix(in oklab, " + c.accent + " " + Math.round(7 + share * 53) + "%, " + c.surface + ")";
        b.setAttribute("aria-label", "Backlog " + signedPct(s) + ", conversion " + signedPct(f, " percentage points") + ": " + billions(v));
        // Pointing at a cell lights its row and column headers, so it reads as coordinates.
        b.addEventListener("mouseenter", function () { hover(s, f); });
        b.addEventListener("mouseleave", function () { hover(null, null); });
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
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    // Light up the row and column headers of the chosen scenario.
    table.querySelectorAll("th[data-s], th[data-f]").forEach(function (th) {
      th.classList.toggle("hl", th.dataset.s != null ? +th.dataset.s === state.shock : +th.dataset.f === state.shift);
    });
    moveRing(introDone);
  }

  function renderCompany() {
    var co = data.companies[state.ticker], c = colors();
    renderBacklog(co, c);
    renderForecast(co, c);
    renderBridge(co, c);
    renderWhatIf(co, c);
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

    $("year").addEventListener("change", function () {
      state.year = +$("year").value;
      renderBridge(data.companies[state.ticker], colors());
    });
    window.addEventListener("hashchange", function () {
      var h = location.hash.replace("#", "").toUpperCase();
      if (tickers.indexOf(h) >= 0 && h !== state.ticker) selectTicker(h, false);
    });
    var rerender = function () {
      renderHeader();
      renderCompany();
      if (still()) revealAll();
    };
    if (darkMode.addEventListener) { darkMode.addEventListener("change", rerender); reduceMotion.addEventListener("change", rerender); }
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

    selectTicker(state.ticker, false);
    placePill(seg, false);
    watchSticky();
    requestAnimationFrame(function () {
      ready();
      watchCharts();
    });
  }

  fetch("data.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function (err) {
      if (window.console) console.error(err);
      $("headline").textContent = "The data file did not load. Serve this folder over HTTP and reload.";
      document.documentElement.classList.add("ready");
    });
})();
