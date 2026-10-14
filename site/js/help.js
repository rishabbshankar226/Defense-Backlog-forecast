/* Definitions: one toggletip per term. The bubble is a single live region shared by every
   ⓘ button; filling it is announced, and the button keeps focus, so Escape or a second
   press closes it where you are. */

import { HELP } from "./copy.js";
import { $, el } from "./dom.js";

const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.25"/>' +
  '<path d="M8 7.2v4M8 4.7v.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
let open = null;

export function infoButton(key) {
  const b = el("button", "info");
  b.type = "button";
  b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-controls", "def");
  setHelp(b, key);
  return b;
}

export function setHelp(b, key) {
  if (!b.firstChild) b.innerHTML = ICON;
  b.dataset.help = key || "";
  b.hidden = !key;
  if (key) b.setAttribute("aria-label", HELP[key].ask);
  if (open === b) close();
}

function show(b) {
  if (open === b) { close(); return; }
  close();
  const def = $("def"), help = HELP[b.dataset.help];
  if (!help) return;
  open = b;
  b.setAttribute("aria-expanded", "true");
  help.terms.forEach(([term, text]) => {
    const row = el("p", "");
    row.appendChild(el("strong", "", term));
    row.appendChild(document.createTextNode(" " + text));
    def.appendChild(row);
  });
  place();
  def.classList.add("open");
}

// Keep the bubble beside its button as the page scrolls; close it once the button has gone.
function place() {
  if (!open) return;
  const def = $("def"), r = open.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) { close(); return; }
  const w = def.offsetWidth, h = def.offsetHeight, gap = 8;
  const x = Math.max(16, Math.min(r.left - 12, innerWidth - w - 16));
  const below = r.bottom + gap + h <= innerHeight - 8;
  def.style.left = Math.round(x) + "px";
  def.style.top = Math.round(below ? r.bottom + gap : r.top - gap - h) + "px";
}

function close() {
  if (!open) return;
  open.setAttribute("aria-expanded", "false");
  open = null;
  const def = $("def");
  def.classList.remove("open");
  def.textContent = "";
}

export function watchInfo() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest(".info") : null;
    if (b) { show(b); return; }
    if (open && !$("def").contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) { const b = open; close(); b.focus(); }
  });
  window.addEventListener("scroll", place, { passive: true });
  window.addEventListener("resize", place);
  document.querySelectorAll("button.info[data-help]").forEach((b) => setHelp(b, b.dataset.help));
}
