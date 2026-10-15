/* Entry point: load data.json, build the model, mount the page. Any load failure (network,
   HTTP, bad JSON, a throw on start) ends in the page-level error with a retry. After that
   each panel renders in its own guard, so one broken panel doesn't take the page down. */

import { $, colors, still, onMotionChange } from "./dom.js";
import { buildModel } from "./model.js";
import * as store from "./state.js";
import { guard, pageState, setPanelState } from "./ui-state.js";
import { watchInfo } from "./help.js";
import { initFilters, syncFilters, watchTheme, watchKeys } from "./filters.js";
import { renderHeadline, renderPoolKpis, renderCompanyKpis, renderScorecard } from "./kpis.js";
import { renderTable, watchTable } from "./table.js";
import { watchCharts, charts } from "./charts/base.js";
import { renderBacklog } from "./charts/backlog.js";
import { renderBtb } from "./charts/btb.js";
import { renderForecast, watchReplay } from "./charts/forecast.js";
import { renderBridge } from "./charts/bridge.js";
import { renderWhatIf, gridKeys, watchPeek } from "./charts/whatif.js";

const PANELS = ["kpis", "p-score", "kpis-company", "p-backlog", "p-fc", "p-bridge", "p-whatif", "p-table"];
let model = null;

/* Which parts of the page redraw for which state changes. */
const GLOBAL = ["ticker", "view", "from", "to"];
const PARTS = [
  { panel: "kpis", keys: ["view", "from", "to"], draw: (st, p) => renderPoolKpis(model, st, p) },
  { panel: "p-score", keys: GLOBAL, draw: (st, p) => renderScorecard(model, st, p) },
  { panel: "kpis-company", keys: GLOBAL, draw: (st, p) => renderCompanyKpis(model, st, p) },
  { panel: "p-backlog", keys: ["ticker", "from", "to"], draw: (st, p, c) => {
    const a = renderBacklog(model, st, c, p);
    return a || renderBtb(model, st, c, p);
  } },
  { panel: "p-fc", keys: GLOBAL, draw: (st, p, c) => renderForecast(model, st, c, p) },
  { panel: "p-bridge", keys: ["ticker", "from", "to", "year"], draw: (st, p, c) => renderBridge(model, st, c, p) },
  { panel: "p-whatif", keys: ["ticker", "shock", "shift"], draw: (st, p, c, keys) =>
    renderWhatIf(model, st, c, keys && (keys.has("shock") || keys.has("shift"))) },
  { panel: "p-table", keys: [...GLOBAL, "tab", "scope", "query", "model", "sort", "limit"], draw: (st) => renderTable(model, st) }
];

function draw(st, keys) {
  const p = store.period(), c = colors();
  syncFilters(st, keys);
  // An empty panel under a narrowed period offers Show all years. The button goes on redraw,
  // so focus moves to the panel heading.
  const narrowed = st.from !== st.bounds.minYear || st.to !== st.bounds.maxYear;
  const widen = (panel) => ({ label: "Show all years", run: () => {
    store.set({ from: st.bounds.minYear, to: st.bounds.maxYear });
    store.flush();
    const h = $(panel).querySelector("h2[tabindex], h3[tabindex]");
    if (h) h.focus();
  } });
  PARTS.forEach((part) => {
    if (keys && !part.keys.some((k) => keys.has(k))) return;
    guard(part.panel, () => {
      const r = part.draw(st, p, c, keys);
      if (r && r.empty && !r.action && narrowed) r.action = widen(part.panel);
      return r;
    }, () => draw(store.get(), null));
  });
}

function start(json) {
  model = buildModel(json);
  store.readUrl(model.tickers, model.minYear, model.maxYear);
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;

  renderHeadline(model);
  initFilters(model);
  watchInfo();
  watchTable(model);
  watchReplay();
  watchCharts();
  watchKeys(model);
  watchPeek();
  $("grid").addEventListener("keydown", gridKeys);
  $("reset").addEventListener("click", () => store.set({ shock: 0, shift: 0 }));
  // The hash holds the company, so the skip link moves focus without touching it.
  document.querySelector(".skip").addEventListener("click", (e) => {
    e.preventDefault();
    $("summary").scrollIntoView({ block: "start" });
    $("summary").focus({ preventScroll: true });
  });
  // Nothing focusable should hide under the sticky header (WCAG 2.4.11). Its height changes as
  // the filters wrap, so scroll-padding tracks it, and anything still under it gets scrolled clear.
  const header = document.querySelector(".top");
  if (window.ResizeObserver) {
    new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", header.offsetHeight + "px")).observe(header);
  }
  document.addEventListener("focusin", (e) => {
    const head = document.querySelector(".top"), t = e.target;
    if (!t.getBoundingClientRect || head.contains(t) || getComputedStyle(head).position !== "sticky") return;
    const below = head.getBoundingClientRect().bottom, top = t.getBoundingClientRect().top;
    if (top < below) window.scrollBy(0, top - below - 8);
  });
  window.addEventListener("hashchange", () => {
    const h = location.hash.replace("#", "").toUpperCase();
    if (model.tickers.includes(h)) store.set({ ticker: h });
  });

  // Colours and motion are read at draw time, so a theme or motion change redraws everything.
  const redraw = () => draw(store.get(), null);
  watchTheme(redraw);
  onMotionChange(() => { $("play").hidden = still(); redraw(); });

  store.subscribe(draw);
  draw(store.get(), null);
  pageState("ready");
  document.documentElement.classList.add("ready");
}

function load() {
  pageState("loading", "Loading the data…");
  PANELS.forEach((id) => setPanelState(id, "loading"));
  fetch("data.json")
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(start)
    .catch((err) => {
      if (window.console) console.error(err);
      const msg = "The data did not load (" + (err && err.message ? err.message : "unknown error") + "). Nothing on this page is shown from stale data.";
      PANELS.forEach((id) => setPanelState(id, "error", { msg: "Shown once the data loads.", quiet: true }));
      pageState("error", msg, () => { if (model) location.reload(); else load(); });
      document.documentElement.classList.add("ready");
    });
}

// for poking at from the console
window.dbf = { charts, get model() { return model; } };
load();
