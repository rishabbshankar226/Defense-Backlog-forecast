/* Loading, empty and error states for each panel, and for the page.

   Every panel carries data-state="loading" in the HTML, so a skeleton of the right size is
   on screen before any script runs and nothing shifts when the data arrives. A panel's
   content stays in the layout under its message, so an empty or failed panel keeps its size. */

import { $, el } from "./dom.js";

const MESSAGES = {
  loading: "Loading…",
  empty: "No data for this selection.",
  error: "This panel could not be drawn."
};

/**
 * @param {string|Element} panel  the panel or its id
 * @param {"loading"|"empty"|"error"|"ready"} kind
 * @param {{msg?: string, action?: {label: string, run: Function}}} opts
 */
export function setPanelState(panel, kind, opts = {}) {
  const p = typeof panel === "string" ? $(panel) : panel;
  if (!p) return;
  p.dataset.state = kind;
  p.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
  let box = p.querySelector(":scope > .state");
  if (!box) {
    box = el("div", "state");
    p.appendChild(box);
  }
  box.textContent = "";
  box.removeAttribute("role");
  if (kind === "ready") return;
  box.setAttribute("role", kind === "error" ? "alert" : "status");
  box.appendChild(el("p", "state-msg", opts.msg || MESSAGES[kind]));
  if (opts.action) {
    const b = el("button", "btn", opts.action.label);
    b.type = "button";
    b.addEventListener("click", opts.action.run);
    box.appendChild(b);
  }
}

/** Run a panel's render. A throw marks that panel as failed instead of blanking the page. */
export function guard(panel, render, retry) {
  try {
    const result = render();
    if (result && result.empty) setPanelState(panel, "empty", { msg: result.empty, action: result.action });
    else setPanelState(panel, "ready");
  } catch (err) {
    if (window.console) console.error(err);
    setPanelState(panel, "error", {
      msg: "This panel could not be drawn: " + (err && err.message ? err.message : "unknown error") + ".",
      action: retry ? { label: "Try again", run: retry } : null
    });
  }
}

/** The page-level message, for a failed download or a failed start. */
export function pageState(kind, msg, retry) {
  const box = $("page-state");
  document.documentElement.dataset.load = kind;
  box.textContent = "";
  box.hidden = kind === "ready";
  if (kind === "ready") return;
  box.setAttribute("role", kind === "error" ? "alert" : "status");
  box.appendChild(el("p", "", msg));
  if (retry) {
    const b = el("button", "btn", "Try again");
    b.type = "button";
    b.addEventListener("click", retry);
    box.appendChild(b);
    b.focus();
  }
}
