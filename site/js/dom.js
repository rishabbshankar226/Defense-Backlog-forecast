/* Small DOM helpers shared by every module. */

import { spoken } from "./format.js";

export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export const still = () => reduceMotion.matches;
export const onMotionChange = (fn) => reduceMotion.addEventListener && reduceMotion.addEventListener("change", fn);

/** Escape text for an HTML string. The table builds rows as one string, for speed. */
export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/* One polite live region for what a change did. Rapid changes (a slider drag, arrow
   presses) restart the wait, so only the settled state is spoken. Clearing it first makes
   a repeat of the same sentence speak again. */
let announceTimer = 0;
export function announce(text, wait = 400) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const box = $("announce");
    if (!box) return;
    box.textContent = "";
    setTimeout(() => { box.textContent = spoken(text); }, 30);
  }, wait);
}

/** Collapse a burst of calls (typing in the search box) into one, after `ms` of quiet. */
export function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* Colour tokens, read from CSS so the charts follow the theme. Series colours identify a
   line; fav and unfav are only ever used for a favourable or unfavourable variance. */
export function colors() {
  return {
    ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), surface: css("--surface"),
    line: css("--line"), grid: css("--grid"), axis: css("--axis"), cross: css("--crosshair"),
    wash: css("--wash"), track: css("--track"),
    backlog: css("--s-backlog"), naive: css("--s-naive"), drift: css("--s-drift"), ttm: css("--s-actual"),
    fav: css("--fav"), unfav: css("--unfav"), band: css("--band"), mono: css("--mono")
  };
}

export function fade(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
}
