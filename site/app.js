/* Dashboard for the defense backlog forecast. Every figure comes from data.json. */
(function () {
  "use strict";

  var NAMES = {
    h1: { backlog: "Backlog model", naive: "Seasonal naive", naive_drift: "Seasonal naive with drift" },
    h4: { backlog: "Backlog model", naive: "Trailing 4Q", naive_drift: "Trailing 4Q with drift" }
  };
  var PHRASE = { backlog: "the backlog model", naive: "the trailing four quarters", naive_drift: "the trailing four quarters with drift" };
  var MODELS = ["backlog", "naive", "naive_drift"];

  var data, tickers, charts = {};
  var state = { ticker: null, view: "h1", year: null, shock: null, shift: null };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var darkMode = window.matchMedia("(prefers-color-scheme: dark)");

  function $(id) { return document.getElementById(id); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function colors() {
    return {
      ink: css("--ink"), muted: css("--muted"), grid: css("--grid"), accent: css("--accent"),
      naive: css("--naive"), drift: css("--drift"), surface: css("--surface"), line: css("--line")
    };
  }
  function modelColor(c, m) { return m === "backlog" ? c.accent : m === "naive" ? c.naive : c.drift; }

  function billions(v) { return v == null ? "n/a" : "$" + (v / 1e9).toFixed(1) + "B"; }
  function signedBillions(v) {
    if (Math.abs(v) < 5e7) return "under $0.1B";
    return (v < 0 ? "−" : "+") + "$" + Math.abs(v / 1e9).toFixed(1) + "B";
  }
  function pct(v) { return v == null ? "n/a" : v.toFixed(1) + "%"; }
  function signedPct(v, unit) { return (v < 0 ? "−" : v > 0 ? "+" : "") + Math.abs(v).toString() + (unit || "%"); }
  function ape(f, a) { return f == null || a == null ? null : Math.abs(a - f) / a * 100; }

  function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), config);
    return charts[id];
  }

  function baseOptions(c, yTitle, xTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion.matches ? false : { duration: 350 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { color: c.ink, boxWidth: 14, boxHeight: 2, padding: 12 } },
        tooltip: { backgroundColor: c.surface, titleColor: c.ink, bodyColor: c.ink, borderColor: c.line, borderWidth: 1 }
      },
      scales: {
        x: { title: { display: true, text: xTitle, color: c.muted }, ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 14 }, grid: { display: false } },
        y: { title: { display: true, text: yTitle, color: c.muted }, ticks: { color: c.muted }, grid: { color: c.grid } }
      }
    };
  }

  /* ---------- header and scoreboard ---------- */

  function renderHeader() {
    var m = data.metrics, h4 = m.mape.H4;
    var best = MODELS.slice().sort(function (a, b) { return h4[a].ALL - h4[b].ALL; })[0];
    var line = "Over the next four quarters, " + PHRASE[best] + " missed revenue by " + pct(h4[best].ALL) +
      " on average, the lowest of three models";
    line += best === "backlog" ? "." : ", while the backlog model missed by " + pct(h4.backlog.ALL) + ".";
    $("headline").textContent = line;
    $("asof").textContent = "Data as of " + data.as_of;

    var c = colors(), tiles = $("tiles");
    tiles.innerHTML = "";
    MODELS.forEach(function (k) {
      var t = document.createElement("div");
      t.className = "tile" + (k === best ? " best" : "");
      t.innerHTML = '<div class="name"><span class="swatch"></span></div><div class="val"></div><div class="sub"></div>';
      t.querySelector(".swatch").style.background = modelColor(c, k);
      t.querySelector(".name").appendChild(document.createTextNode(NAMES.h4[k]));
      t.querySelector(".val").textContent = pct(h4[k].ALL);
      t.querySelector(".sub").textContent = k === best ? "Lowest pooled error" : "Pooled MAPE";
      tiles.appendChild(t);
    });
    var w = document.createElement("div");
    w.className = "tile";
    w.innerHTML = '<div class="name">Backlog model beats trailing 4Q</div><div class="val"></div><div class="sub"></div>';
    w.querySelector(".val").textContent = pct(m.win_rate_vs_naive.H4.ALL);
    w.querySelector(".sub").textContent = "of " + m.n.H4 + " four-quarter forecasts";
    tiles.appendChild(w);
  }

  /* ---------- tabs ---------- */

  function renderTabs() {
    var bar = $("tabs");
    bar.innerHTML = "";
    tickers.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.id = "tab-" + t;
      b.textContent = t;
      b.addEventListener("click", function () { selectTicker(t, true); });
      bar.appendChild(b);
    });
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
    $("company").setAttribute("aria-labelledby", "tab-" + t);
    if (push && location.hash !== "#" + t) history.replaceState(null, "", location.pathname + location.search + "#" + t);
    state.year = null;
    renderCompany();
  }

  /* ---------- panels ---------- */

  function renderBacklog(co, c) {
    var toB = function (v) { return v == null ? null : v / 1e9; };
    var opts = baseOptions(c, "US dollars, billions ($B)", "Quarter");
    opts.plugins.tooltip.callbacks = { label: function (ctx) { return ctx.dataset.label + ": " + billions(ctx.raw == null ? null : ctx.raw * 1e9); } };
    makeChart("c-backlog", {
      type: "line",
      data: {
        labels: co.quarters,
        datasets: [
          { label: "Backlog (RPO)", data: co.backlog_usd.map(toB), borderColor: c.accent, backgroundColor: c.accent, borderWidth: 2.5, pointRadius: 0, spanGaps: false },
          { label: "Revenue, trailing four quarters", data: co.ttm_revenue_usd.map(toB), borderColor: c.ink, backgroundColor: c.ink, borderWidth: 2.5, pointRadius: 0, spanGaps: false }
        ]
      },
      options: opts
    });
    var L = co.quarters.length - 1;
    var gaps = co.quarters.filter(function (q, i) { return co.backlog_usd[i] == null; });
    $("c-backlog").setAttribute("aria-label", co.ticker + " backlog and trailing four-quarter revenue by quarter. At " +
      co.quarters[L] + ", backlog was " + billions(co.backlog_usd[L]) + " and trailing revenue " + billions(co.ttm_revenue_usd[L]) + ".");
    $("backlog-note").textContent = "Backlog at each quarter end against revenue over the trailing four quarters, in $B." +
      (gaps.length ? " Breaks in the backlog line are quarters with no backlog tagged in the filing: " + gaps.join(", ") + "." : "");
  }

  function renderForecast(co, c) {
    var v = state.view, block = co[v];
    var actual = block.actual_usd;
    var toB = function (x) { return x == null ? null : x / 1e9; };
    var apes = {};
    MODELS.forEach(function (m) { apes[m] = block[m].map(function (f, i) { return ape(f, actual[i]); }); });

    var worst = -1;
    apes.backlog.forEach(function (a, i) { if (a != null && (worst < 0 || a > apes.backlog[worst])) worst = i; });

    var datasets = [{
      label: "Actual", data: actual.map(toB), borderColor: c.ink, backgroundColor: c.ink,
      borderWidth: 3, pointRadius: 0, order: 0, key: "actual"
    }];
    MODELS.forEach(function (m) {
      datasets.push({
        label: NAMES[v][m], data: block[m].map(toB), borderColor: modelColor(c, m), backgroundColor: modelColor(c, m),
        borderWidth: m === "backlog" ? 2 : 1.5, spanGaps: false, key: m, order: 1,
        pointRadius: block[m].map(function (x, i) { return m === "backlog" && i === worst ? 6 : 0; }),
        pointHoverRadius: 4, pointBorderColor: c.surface, pointBorderWidth: 1.5
      });
    });

    var opts = baseOptions(c, v === "h1" ? "Quarterly revenue, $B" : "Revenue over four quarters, $B",
      v === "h1" ? "Quarter forecast" : "Last quarter of the four forecast");
    opts.plugins.tooltip.callbacks = {
      title: function (items) {
        var i = items[0].dataIndex;
        return block.target[i] + " (forecast made at " + block.origin[i] + ")";
      },
      label: function (ctx) {
        var k = ctx.dataset.key, i = ctx.dataIndex;
        if (k === "actual") return "Actual: " + billions(actual[i]);
        if (block[k][i] == null) return ctx.dataset.label + ": no forecast";
        return ctx.dataset.label + ": " + billions(block[k][i]) + ", APE " + pct(apes[k][i]);
      }
    };
    makeChart("c-fc", { type: "line", data: { labels: block.target, datasets: datasets }, options: opts });

    var skipped = block.backlog.filter(function (x) { return x == null; }).length;
    var cap = worst >= 0 ? "Largest miss: " + block.target[worst] + ", " + pct(apes.backlog[worst]) +
      " (backlog model, forecast " + billions(block.backlog[worst]) + " against " + billions(actual[worst]) + ")." : "";
    if (skipped) cap += " The backlog model skips " + skipped + " origins that need a quarter with no tagged backlog.";
    $("miss").textContent = cap;

    var mape = data.metrics.mape[v.toUpperCase()];
    $("c-fc").setAttribute("aria-label", co.ticker + " " + (v === "h1" ? "next-quarter" : "next-four-quarter") +
      " forecasts against actual revenue. MAPE: " + MODELS.map(function (m) { return NAMES[v][m] + " " + pct(mape[m][co.ticker]); }).join(", ") + ". " + cap);
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-view") === v ? "true" : "false");
    });
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
    var labels = [[String(state.year - 1), "revenue"], ["Backlog", "effect"], ["Conversion", "effect"], ["Inter-", "action"], [String(state.year), "revenue"]];
    var values = [r.revenue_prior_usd].concat(steps, [r.revenue_usd]);
    var lows = bars.slice(1, 4).map(function (b) { return Math.min(b[0], b[1]); }).concat([r.revenue_prior_usd, r.revenue_usd]);
    var highs = bars.slice(1, 4).map(function (b) { return Math.max(b[0], b[1]); }).concat([r.revenue_prior_usd, r.revenue_usd]);
    var lo = Math.min.apply(null, lows), hi = Math.max.apply(null, highs), pad = (hi - lo) * 0.6 || hi * 0.05;

    var opts = baseOptions(c, "US dollars, billions ($B)", "");
    opts.interaction = { mode: "nearest", intersect: true };
    opts.plugins.legend = { display: false };
    opts.scales.x.title.display = false;
    opts.scales.x.ticks.autoSkip = false;
    opts.scales.x.ticks.font = { size: window.innerWidth < 520 ? 10 : 12 };
    var yLo = Math.max(0, (lo - pad) / 1e9), yHi = (hi + pad * 0.5) / 1e9;
    var step = Math.pow(10, Math.floor(Math.log10(yHi - yLo)));
    if ((yHi - yLo) / step < 3) step /= 2;
    opts.scales.y.min = Math.floor(yLo / step) * step;
    opts.scales.y.max = Math.ceil(yHi / step) * step;
    opts.scales.y.ticks.stepSize = step;
    opts.plugins.tooltip.callbacks = {
      label: function (ctx) {
        var i = ctx.dataIndex;
        return kinds[i] === "total" ? billions(values[i]) : signedBillions(values[i]);
      }
    };
    makeChart("c-bridge", {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          data: bars.map(function (b) { return [b[0] / 1e9, b[1] / 1e9]; }),
          backgroundColor: kinds.map(function (k) { return k === "total" ? c.ink : k === "up" ? c.accent : c.drift; }),
          borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.9
        }]
      },
      options: opts
    });
    var change = r.revenue_usd - r.revenue_prior_usd;
    var cap = state.year + " revenue " + (change >= 0 ? "rose " : "fell ") + billions(Math.abs(change)) + " to " + billions(r.revenue_usd) +
      ". Backlog effect " + signedBillions(steps[0]) + ", conversion effect " + signedBillions(steps[1]) +
      ", interaction " + signedBillions(steps[2]) + ". " +
      (r.conversion_prior.toFixed(2) === r.conversion.toFixed(2)
        ? "Conversion held at " + r.conversion.toFixed(2) + " of starting backlog."
        : "Conversion went from " + r.conversion_prior.toFixed(2) + " to " + r.conversion.toFixed(2) + " of starting backlog.") +
      " The axis starts above zero.";
    $("bridge-cap").textContent = cap;
    $("c-bridge").setAttribute("aria-label", co.ticker + " revenue bridge for " + state.year + ". " + cap);
  }

  function renderWhatIf(co, c) {
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
      a[0].min = 0; a[0].max = a[1].length - 1; a[0].step = 1; a[0].value = a[1].indexOf(a[2]);
      $(a[3]).innerHTML = "";
      a[1].forEach(function (v) { var s = document.createElement("span"); s.textContent = signedPct(v, a[4]); $(a[3]).appendChild(s); });
    });
    shockIn.setAttribute("aria-valuetext", signedPct(state.shock) + " backlog");
    shiftIn.setAttribute("aria-valuetext", signedPct(state.shift, " percentage points") + " conversion");
    shockIn.oninput = function () { state.shock = shocks[+shockIn.value]; renderWhatIf(co, colors()); syncQuery(); };
    shiftIn.oninput = function () { state.shift = shifts[+shiftIn.value]; renderWhatIf(co, colors()); syncQuery(); };

    var base = cell(0, 0), val = cell(state.shock, state.shift), d = val - base;
    $("shock-out").textContent = signedPct(state.shock);
    $("shift-out").textContent = signedPct(state.shift, " pp");
    $("fwd").textContent = billions(val);
    $("fwd-delta").textContent = d === 0 ? "No change from today's backlog and conversion: " + billions(base)
      : signedBillions(d) + " (" + (d < 0 ? "−" : "+") + Math.abs(d / base * 100).toFixed(1) + "%) against " + billions(base) + " with no change";

    var all = co.sensitivity.map(function (r) { return r.forward_revenue_usd; });
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    var table = $("grid");
    Array.prototype.slice.call(table.querySelectorAll("thead, tbody")).forEach(function (n) { n.remove(); });
    var thead = document.createElement("thead"), hr = document.createElement("tr");
    var corner = document.createElement("th"); corner.textContent = "Shock"; hr.appendChild(corner);
    shifts.forEach(function (f) { var th = document.createElement("th"); th.scope = "col"; th.textContent = signedPct(f, " pp"); hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement("tbody");
    shocks.slice().reverse().forEach(function (s) {
      var tr = document.createElement("tr"), th = document.createElement("th");
      th.scope = "row"; th.textContent = signedPct(s); tr.appendChild(th);
      shifts.forEach(function (f) {
        var v = cell(s, f), td = document.createElement("td"), b = document.createElement("button");
        var share = mx > mn ? (v - mn) / (mx - mn) : 0.5;
        b.type = "button";
        b.textContent = billions(v);
        b.style.background = "color-mix(in srgb, " + c.accent + " " + Math.round(8 + share * 55) + "%, " + c.surface + ")";
        b.setAttribute("aria-label", "Backlog " + signedPct(s) + ", conversion " + signedPct(f, " percentage points") + ": " + billions(v));
        if (s === state.shock && f === state.shift) { b.className = "on"; b.setAttribute("aria-current", "true"); }
        b.addEventListener("click", function () { state.shock = s; state.shift = f; renderWhatIf(co, colors()); syncQuery(); });
        td.appendChild(b); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
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
    if (state.view !== "h1") q.set("view", state.view); else q.delete("view");
    if (state.shock) q.set("shock", state.shock); else q.delete("shock");
    if (state.shift) q.set("shift", state.shift); else q.delete("shift");
    var s = q.toString();
    history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + "#" + state.ticker);
  }

  function init(json) {
    data = json;
    tickers = Object.keys(data.companies);
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    readUrl();
    renderHeader();
    renderTabs();
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.view = b.getAttribute("data-view");
        renderForecast(data.companies[state.ticker], colors());
        syncQuery();
      });
    });
    $("year").addEventListener("change", function () {
      state.year = +$("year").value;
      renderBridge(data.companies[state.ticker], colors());
    });
    window.addEventListener("hashchange", function () {
      var h = location.hash.replace("#", "").toUpperCase();
      if (tickers.indexOf(h) >= 0 && h !== state.ticker) selectTicker(h, false);
    });
    var rerender = function () { renderHeader(); renderCompany(); };
    if (darkMode.addEventListener) { darkMode.addEventListener("change", rerender); reduceMotion.addEventListener("change", rerender); }
    selectTicker(state.ticker, false);
  }

  fetch("data.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function () { $("headline").textContent = "The data file did not load. Serve this folder over HTTP and reload."; });
})();
