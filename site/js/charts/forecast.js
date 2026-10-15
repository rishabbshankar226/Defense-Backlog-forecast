/* Forecasts vs actual revenue for the selected company and horizon, plus the replay. */

import { $, el, still } from "../dom.js";
import { usdB, signedM, pct, signedPct } from "../format.js";
import { COMPANY, MODELS, NAMES, HORIZON, APE_NOTE } from "../copy.js";
import { forecastsFor } from "../model.js";
import { baseOptions, linked, lineSet, upsert, renderLegend, describe, charts } from "./base.js";

const REPLAY_STEP_MS = 280;
const toB = (v) => (v == null ? null : v / 1e9);

/** One company's forecasts for a horizon, one entry per origin, from the forecast rows. */
function block(model, t, view, period) {
  const rows = forecastsFor(model, view, period).filter((r) => r.ticker === t);
  const byOrigin = new Map();
  rows.forEach((r) => {
    let b = byOrigin.get(r.origin);
    if (!b) byOrigin.set(r.origin, b = { origin: r.origin, target: r.target, actual: r.actual, rows: {} });
    b.rows[r.model] = r;
  });
  return [...byOrigin.values()].sort((a, b) => (a.origin < b.origin ? -1 : 1));
}

export function renderForecast(model, st, c, period) {
  stopReplay();
  const t = st.ticker, v = st.view, list = block(model, t, v, period);
  if (!list.length) {
    return { empty: `No forecasts (${HORIZON[v].toLowerCase()}) for ${COMPANY[t]} with a target in ${period.from}–${period.to}.` };
  }
  const val = (k, i) => (list[i].rows[k] ? list[i].rows[k].forecast : null);
  const apeOf = (k, i) => (list[i].rows[k] ? list[i].rows[k].ape : null);

  let worst = -1;
  list.forEach((b, i) => { const a = apeOf("backlog", i); if (a != null && (worst < 0 || a > apeOf("backlog", worst))) worst = i; });

  const actualSet = lineSet(c, "Actual (GAAP)", list.map((b) => toB(b.actual)), c.ttm, 2.5, "actual");
  const datasets = [actualSet];
  MODELS.forEach((m) => {
    const color = m === "backlog" ? c.backlog : m === "naive" ? c.naive : c.drift;
    datasets.push(lineSet(c, NAMES[v][m], list.map((b, i) => toB(val(m, i))), color, m === "backlog" ? 2 : 1.5, m,
      m === "naive_drift" ? [6, 4] : []));
  });
  const worstMark = { index: worst, ds: 1, ref: 0, label: worst >= 0 ? "Largest miss " + pct(apeOf("backlog", worst)) : "",
    short: worst >= 0 ? pct(apeOf("backlog", worst)) : "" };

  const ch = upsert("c-fc", {
    type: "line",
    data: { labels: list.map((b) => b.target), datasets },
    options: linked(baseOptions(c, "US$B · GAAP vs model",
      v === "h1" ? "Quarter forecast" : "Last of the four quarters forecast"))
  }, {
    $colors: c, $crosshair: true, $ends: true, $band: true, $upto: null, $miss: worstMark, $worst: worstMark,
    // Cells at table precision. Backlog model variance: green if it beat the baseline, red if not.
    $tip: (pts) => {
      const i = pts[0].dataIndex, b = list[i], bk = b.rows.backlog, nv = b.rows.naive;
      const tone = bk && bk.beatsNaive != null ? (bk.beatsNaive ? "fav" : "unfav") : null;
      return {
        title: b.target + " (forecast made at " + b.origin + ")",
        cols: ["", "US$B", "Variance $", "Variance %"],
        note: bk && nv ? [NAMES[v].backlog + ":", `missed by ${pct(bk.ape, 2)}, ${bk.ape < nv.ape ? "less" : "more"} than the ${NAMES[v].naive} baseline at ${pct(nv.ape, 2)}.`] : APE_NOTE,
        rows: pts.map((p) => {
          const k = p.dataset.key, color = p.dataset.$color, dash = p.dataset.borderDash.length > 0;
          if (k === "actual") return { color, label: "Actual (GAAP)", value: usdB(b.actual) };
          const r = b.rows[k];
          const label = p.dataset.label;
          if (!r) return { color, dash, label, value: "no forecast" };
          const t = k === "backlog" ? tone : null;
          return { color, dash, label, value: usdB(r.forecast), extra: signedM(r.error, 1), extraTone: t,
            change: signedPct(r.error / r.actual * 100, 2), tone: t };
        })
      };
    }
  });
  renderLegend("lg-fc", ch, "fc", v, { actual: "GAAP", backlog: "Model", naive: "Model", naive_drift: "Model" });
  setupReplay(list, v, c);

  const skipped = list.filter((b) => !b.rows.backlog).length;
  const when = worst < 0 ? "" : v === "h1" ? list[worst].target : "the four quarters to " + list[worst].target;
  let cap = worst >= 0 ? `Largest backlog-model miss: ${when}, ${pct(apeOf("backlog", worst))} off ` +
    `(forecast ${usdB(val("backlog", worst))}, actual ${usdB(list[worst].actual)}).` : "No backlog-model forecasts in this period.";
  if (skipped) cap += ` The backlog model skips ${skipped} origin${skipped > 1 ? "s" : ""} that need a quarter with no tagged backlog.`;
  $("miss").textContent = cap;
  $("fc-note").textContent = v === "h1"
    ? "US$ billions. Each point forecasts one quarter with only what was known then."
    : "US$ billions. Each point forecasts four quarters with only what was known then.";
  describe("c-fc", `${t} ${HORIZON[v].toLowerCase()} forecasts against actual revenue. ${cap}`);
  return null;
}

/* ---------- replay ---------- */

// Replay: a head walks the quarters in the order the forecasts were made, hides what's after
// it, and updates each model's running average miss.
const replay = { at: null, raf: 0, playing: false, n: 0, k: -1, rows: null, list: null };
const PLAY = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>';

function setupReplay(list, view, c) {
  replay.list = list;
  replay.n = list.length;
  replay.k = null;
  const box = $("replay-out");
  box.textContent = "";
  replay.title = el("div", "ro-title");
  box.appendChild(replay.title);
  replay.rows = {};
  MODELS.forEach((m) => {
    const row = el("div", "ro-row"), sw = el("span", "ro-sw");
    sw.style.setProperty("--c", m === "backlog" ? c.backlog : m === "naive" ? c.naive : c.drift);
    if (m === "naive_drift") sw.classList.add("dash");
    row.appendChild(sw);
    row.appendChild(el("span", "ro-name", NAMES[view][m]));
    const val = el("span", "ro-val");
    row.appendChild(val);
    box.appendChild(row);
    replay.rows[m] = { row, val };
  });
  const scrub = $("scrub");
  scrub.min = 0;
  scrub.max = Math.max(0, replay.n - 1);
  scrub.step = 1;
  $("play").hidden = still();
  setHead(null);
  syncPlay();
}

function setHead(u) {
  const ch = charts["c-fc"];
  if (!ch || !replay.n) return;
  replay.at = u;
  const k = u == null ? replay.n - 1 : Math.floor(u + 1e-6), b = replay.list[k];
  ch.$upto = u;
  ch.$headLabel = u == null ? "" : b.target;
  ch.$miss = u == null ? ch.$worst : { index: k, ds: 1, ref: 0, label: b.rows.backlog ? pct(b.rows.backlog.ape) : "" };
  ch.draw();
  const scrub = $("scrub");
  scrub.value = k;
  scrub.setAttribute("aria-valuetext", u == null ? "All forecasts" : "Forecasts up to " + b.target);
  const key = u == null ? -1 : k;
  if (key !== replay.k) { replay.k = key; writeReplay(k, u == null); }
}

function writeReplay(k, all) {
  replay.title.textContent = all ? "Average miss (MAPE), every forecast shown" : "Average miss (MAPE), forecasts up to " + replay.list[k].target;
  const means = {};
  let best = null;
  MODELS.forEach((m) => {
    let sum = 0, n = 0;
    for (let i = 0; i <= k; i++) { const r = replay.list[i].rows[m]; if (r) { sum += r.ape; n++; } }
    means[m] = n ? sum / n : null;
    if (means[m] != null && (best == null || means[m] < means[best])) best = m;
  });
  MODELS.forEach((m) => {
    const r = replay.rows[m];
    r.val.textContent = means[m] == null ? "not yet" : pct(means[m]);
    r.row.classList.toggle("best", m === best);
  });
}

function syncPlay() {
  // Same name throughout; aria-pressed says whether it's playing.
  const b = $("play");
  b.innerHTML = replay.playing ? PAUSE : PLAY;
  b.appendChild(el("span", "", "Replay"));
  b.setAttribute("aria-pressed", replay.playing ? "true" : "false");
}

export function play() {
  if (replay.playing) { pause(); return; }
  if (still() || replay.n < 2) return;
  const from = replay.at == null || replay.at >= replay.n - 1 ? 0 : replay.at;
  let t0 = null;
  replay.playing = true;
  $("replay-out").setAttribute("aria-busy", "true");
  syncPlay();
  const frame = (now) => {
    if (t0 == null) t0 = now;
    const u = Math.min(replay.n - 1, from + (now - t0) / REPLAY_STEP_MS);
    setHead(u);
    if (u < replay.n - 1) { replay.raf = requestAnimationFrame(frame); return; }
    replay.playing = false;
    $("replay-out").removeAttribute("aria-busy");
    setHead(null);
    syncPlay();
  };
  replay.raf = requestAnimationFrame(frame);
}

function pause() {
  cancelAnimationFrame(replay.raf);
  replay.playing = false;
  $("replay-out").removeAttribute("aria-busy");
  if (replay.at != null) setHead(Math.floor(replay.at + 1e-6));
  syncPlay();
}

// Reset the button too, so it can't say Pause over a stopped replay (an empty period
// skips setupReplay).
function stopReplay() {
  cancelAnimationFrame(replay.raf);
  replay.playing = false;
  replay.at = null;
  $("replay-out").removeAttribute("aria-busy");
  syncPlay();
}

export function watchReplay() {
  $("play").addEventListener("click", play);
  $("scrub").addEventListener("input", () => {
    if (replay.playing) { cancelAnimationFrame(replay.raf); replay.playing = false; $("replay-out").removeAttribute("aria-busy"); }
    const k = +$("scrub").value;
    setHead(k >= replay.n - 1 ? null : k);
    syncPlay();
  });
}
