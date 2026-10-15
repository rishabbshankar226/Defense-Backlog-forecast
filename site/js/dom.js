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

/* One polite live region. Rapid changes restart the timer so only the settled state is
   read; clearing it first lets a repeated sentence be read again. */
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

/* Colour tokens from CSS so the charts follow the theme. fav/unfav are only for variances. */
export function colors() {
  return {
    ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), surface: css("--surface"),
    line: css("--line"), grid: css("--grid"), axis: css("--axis"), cross: css("--crosshair"),
    wash: css("--wash"), track: css("--track"),
    backlog: css("--s-backlog"), naive: css("--s-naive"), drift: css("--s-drift"), ttm: css("--s-actual"),
    fav: css("--fav"), unfav: css("--unfav"), band: css("--band"), total: css("--s-total")
  };
}

export function fade(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
}
