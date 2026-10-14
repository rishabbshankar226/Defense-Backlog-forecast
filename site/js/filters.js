/* The global filters, top right: company, horizon and period. Each one drives the KPIs,
   every chart and the table below. Also the theme switch and the keyboard shortcuts. */

import { $, el, css, announce } from "./dom.js";
import { COMPANY, HORIZON } from "./copy.js";
import * as store from "./state.js";
import { play } from "./charts/forecast.js";

/* A radio group of buttons: one tab stop, arrow keys move and choose. */
function radioGroup(box, items, key) {
  box.setAttribute("role", "radiogroup");
  box.textContent = "";
  items.forEach(([value, text, name]) => {
    const b = el("button", "", text);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = value;
    if (name) b.setAttribute("aria-label", name);
    b.addEventListener("click", () => store.set({ [key]: value }));
    box.appendChild(b);
  });
  box.addEventListener("keydown", (e) => {
    const list = items.map((x) => x[0]), i = list.indexOf(store.get()[key]);
    let j;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % list.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + list.length) % list.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = list.length - 1;
    else return;
    e.preventDefault();
    store.set({ [key]: list[j] });
    store.flush();
    box.querySelector(`[data-value="${list[j]}"]`).focus();
  });
}

function syncGroup(box, value) {
  box.querySelectorAll("[role=radio]").forEach((b) => {
    const on = b.dataset.value === value;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  });
}

export function initFilters(model) {
  radioGroup($("f-company"), model.tickers.map((t) => [t, t, `${COMPANY[t]} (${t})`]), "ticker");
  radioGroup($("f-view"), [["h1", "Next quarter"], ["h4", "Next 4 quarters"]], "view");
  const years = [];
  for (let y = model.minYear; y <= model.maxYear; y++) years.push(y);
  ["f-from", "f-to"].forEach((id) => {
    const sel = $(id);
    sel.textContent = "";
    years.forEach((y) => sel.appendChild(new Option(String(y), String(y))));
  });
  $("f-from").addEventListener("change", (e) => {
    const from = +e.target.value, st = store.get();
    store.set({ from, to: Math.max(from, st.to) });
  });
  $("f-to").addEventListener("change", (e) => {
    const to = +e.target.value, st = store.get();
    store.set({ to, from: Math.min(to, st.from) });
  });
  $("f-reset").addEventListener("click", () => {
    const st = store.get();
    if (active(st)) store.set({ ...st.defaults });
  });
}

/** How many global filters differ from the page's defaults. */
function active(st) {
  const d = st.defaults;
  return ["ticker", "view"].filter((k) => st[k] !== d[k]).length + (st.from !== d.from || st.to !== d.to ? 1 : 0);
}

export function syncFilters(st, keys) {
  syncGroup($("f-company"), st.ticker);
  syncGroup($("f-view"), st.view);
  $("f-from").value = String(st.from);
  $("f-to").value = String(st.to);
  const n = active(st), count = $("f-count");
  count.textContent = "";
  if (n) {
    count.appendChild(el("strong", "", String(n)));
    count.appendChild(document.createTextNode(n === 1 ? " filter changed" : " filters changed"));
  } else count.textContent = "Default view";
  $("f-reset").setAttribute("aria-disabled", n ? "false" : "true");
  $("hdr-period").textContent = st.from === st.to ? String(st.from) : st.from + "–" + st.to;
  $("f-name").textContent = COMPANY[st.ticker];
  // Each company panel names the company it shows, even when empty or failed.
  document.querySelectorAll("[data-co]").forEach((n) => { n.textContent = st.ticker; });
  document.title = `${COMPANY[st.ticker]} (${st.ticker}) · Does backlog predict revenue?`;
  if (keys && (keys.has("ticker") || keys.has("view") || keys.has("from") || keys.has("to"))) {
    announce(`Showing ${COMPANY[st.ticker]}, ${HORIZON[st.view].toLowerCase()}, ${st.from} to ${st.to}.`, 300);
  }
}

/* ---------- light and dark ---------- */

const SUN = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const MOON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const darkMode = window.matchMedia("(prefers-color-scheme: dark)");

function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : darkMode.matches;
}

function syncTheme() {
  const b = $("theme"), dark = isDark();
  b.innerHTML = dark ? SUN : MOON;
  b.setAttribute("aria-label", dark ? "Use the light theme" : "Use the dark theme");
  b.title = dark ? "Light theme" : "Dark theme";
  if (document.documentElement.hasAttribute("data-theme")) {
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", css("--bg")));
  }
}

export function watchTheme(redraw) {
  syncTheme();
  $("theme").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("dbf-theme", next); } catch (e) { /* this visit only */ }
    syncTheme();
    redraw();
  });
  if (darkMode.addEventListener) darkMode.addEventListener("change", () => { syncTheme(); redraw(); });
}

/* ---------- keyboard shortcuts ---------- */

// 1 to 5 pick a company, R plays the replay and ? lists them. They stand aside while a
// text field, slider, menu or dialog has focus, or a modifier is held. Single keys can be
// set off by speech input, so the list carries a switch that turns them off.
let keysOn = true;
try { keysOn = localStorage.getItem("dbf-keys") !== "off"; } catch (e) { /* on for this visit */ }

function syncKeys() {
  $("keys-switch").setAttribute("aria-checked", keysOn ? "true" : "false");
  $("keys-open").textContent = keysOn ? "Shortcuts" : "Shortcuts (off)";
  $("f-company").querySelectorAll("[role=radio]").forEach((b, i) => {
    if (keysOn && i < 9) b.setAttribute("aria-keyshortcuts", String(i + 1)); else b.removeAttribute("aria-keyshortcuts");
  });
  if (keysOn) $("play").setAttribute("aria-keyshortcuts", "R"); else $("play").removeAttribute("aria-keyshortcuts");
}

export function watchKeys(model) {
  const dlg = $("keys-dlg");
  let opener = null;
  const open = () => { opener = document.activeElement; dlg.showModal(); $("keys-switch").focus(); };
  dlg.addEventListener("close", () => { if (opener && opener.focus) opener.focus(); });
  dlg.addEventListener("click", (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
  $("keys-open").addEventListener("click", open);
  $("keys-close").addEventListener("click", () => dlg.close());
  $("keys-switch").addEventListener("click", () => {
    keysOn = !keysOn;
    try { localStorage.setItem("dbf-keys", keysOn ? "on" : "off"); } catch (e) { /* this visit only */ }
    syncKeys();
    announce(keysOn ? "Single-key shortcuts on." : "Single-key shortcuts off.", 0);
  });
  syncKeys();

  document.addEventListener("keydown", (e) => {
    if (!keysOn || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable) || dlg.open) return;
    if (e.key === "?") { e.preventDefault(); open(); return; }
    const n = /^[1-9]$/.test(e.key) ? +e.key : 0;
    // Draw a shortcut's change at once, not on the next frame, so a quick next key (R
    // straight after 2) acts on what is now on screen.
    if (n && n <= model.tickers.length) { store.set({ ticker: model.tickers[n - 1] }); store.flush(); return; }
    if (e.key === "r" || e.key === "R") {
      store.flush();
      const panel = $("p-fc"), r = panel.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) panel.scrollIntoView({ block: "start" });
      if (!$("play").hidden) { play(); return; }
      // Without motion: rewind to the first forecast and hand the scrubber the keyboard.
      const s = $("scrub");
      s.value = s.min;
      s.dispatchEvent(new Event("input"));
      s.focus();
    }
  });
}
