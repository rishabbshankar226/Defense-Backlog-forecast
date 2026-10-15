/* Loading, empty and error states for panels and the page. Panels ship as
   data-state="loading", so a right-sized skeleton is up before any JS runs. Content stays in
   the layout under the message, so empty and failed panels keep their size. */

import { $, el } from "./dom.js";

const MESSAGES = {
  loading: "Loading…",
  empty: "No data for this selection.",
  error: "This panel could not be drawn."
};

/**
 * @param {string|Element} panel  the panel or its id
 * @param {"loading"|"empty"|"error"|"ready"} kind
 * @param {{msg?: string, action?: {label: string, run: Function}, quiet?: boolean}} opts
 *   quiet: an error the page already announces, so the panel's message is not an alert too
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
  // A quiet error is one the page already reports; the panel only says what it will show.
  box.toggleAttribute("data-quiet", !!opts.quiet);
  if (kind === "ready") return;
  box.setAttribute("role", kind === "error" && !opts.quiet ? "alert" : "status");
  // The message sits under the panel's heading, however many lines that heading wraps to.
  const head = p.querySelector(":scope > .p-head");
  box.style.top = head ? head.offsetTop + head.offsetHeight + 8 + "px" : "";
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
    // The reader gets a plain message; the detail goes to the console.
    if (window.console) console.error("Panel " + (typeof panel === "string" ? panel : panel.id) + " failed:", err);
    setPanelState(panel, "error", {
      msg: "This panel could not be drawn. The rest of the page is unaffected.",
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
