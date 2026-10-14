/* One store for everything the reader can choose. Modules subscribe to it; a burst of
   changes in one frame is drawn once. The company lives in the hash and the rest in the
   query string: #LMT?view=h1&from=2021&to=2025&shock=-5&shift=1.5 */

const state = {
  ticker: null, view: "h4", from: null, to: null,  // global filters
  year: null,                                       // bridge year
  shock: 0, shift: 0,                               // what-if
  tab: "quarters", scope: "company", query: "", model: "all", sort: null, limit: 200  // table
};

const subs = [];
let pending = null, frame = 0;

export function get() { return state; }

/** Merge a change into the state and schedule one redraw for everything subscribed. */
export function set(patch) {
  let changed = false;
  Object.keys(patch).forEach((k) => {
    if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; (pending = pending || new Set()).add(k); }
  });
  if (!changed) return;
  syncUrl();
  if (!frame) frame = requestAnimationFrame(flush);
}

/** Draw now rather than on the next frame (a keyboard step that must show at once). */
export function flush() {
  cancelAnimationFrame(frame);
  frame = 0;
  if (!pending) return;
  const keys = pending;
  pending = null;
  subs.forEach((s) => { if (!s.keys || s.keys.some((k) => keys.has(k))) s.fn(state, keys); });
}

/** Call fn when any of `keys` changes (or on any change when keys is omitted). */
export function subscribe(fn, keys) { subs.push({ fn, keys }); }

export function readUrl(tickers, minYear, maxYear) {
  const h = location.hash.replace("#", "").toUpperCase();
  const q = new URLSearchParams(location.search);
  state.ticker = tickers.includes(h) ? h : tickers.includes("LMT") ? "LMT" : tickers[0];
  const view = (q.get("view") || "").toLowerCase();
  if (view === "h1" || view === "h4") state.view = view;
  const yr = (k, d) => { const v = parseInt(q.get(k), 10); return v >= minYear && v <= maxYear ? v : d; };
  state.from = yr("from", minYear);
  state.to = yr("to", maxYear);
  if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
  state.bounds = { minYear, maxYear };
  ["shock", "shift"].forEach((k) => { const v = parseFloat(q.get(k)); if (isFinite(v)) state[k] = v; });
}

function syncUrl() {
  if (!state.ticker || !state.bounds) return;
  const q = new URLSearchParams();
  if (state.view !== "h4") q.set("view", state.view);
  if (state.from !== state.bounds.minYear) q.set("from", state.from);
  if (state.to !== state.bounds.maxYear) q.set("to", state.to);
  if (state.shock) q.set("shock", state.shock);
  if (state.shift) q.set("shift", state.shift);
  const s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + "#" + state.ticker);
}

export const period = () => ({ from: state.from, to: state.to });
