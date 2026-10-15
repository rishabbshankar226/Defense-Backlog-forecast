/* Number formatting. Every figure goes through here, so units, scale and signs are never
   written by hand.

   - Dollars carry their scale: "$230.4B", "$230,400M".
   - Negatives use a real minus sign (U+2212).
   - null/undefined prints "n/a", never 0. */

const MINUS = "−";
const NA = "n/a";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

const nf = {};
function grouped(dp) {
  if (!nf[dp]) nf[dp] = new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return nf[dp];
}

function sign(v) { return v < 0 ? MINUS : v > 0 ? "+" : ""; }

/** US dollars in billions: usdB(230.4e9) -> "$230.4B". */
export function usdB(v, dp = 1) {
  return v == null ? NA : (v < 0 ? MINUS : "") + "$" + grouped(dp).format(Math.abs(v) / 1e9) + "B";
}

/** US dollars in millions with thousands separators: usdM(230.4e9) -> "$230,400M". */
export function usdM(v, dp = 0) {
  return v == null ? NA : (v < 0 ? MINUS : "") + "$" + grouped(dp).format(Math.abs(v) / 1e6) + "M";
}

/** Signed dollars, billions: "+$1.4B", "−$0.5B". */
export function signedB(v, dp = 1) {
  return v == null ? NA : sign(v) + "$" + grouped(dp).format(Math.abs(v) / 1e9) + "B";
}

/** Signed dollars, millions: "+$1,408M". */
export function signedM(v, dp = 0) {
  return v == null ? NA : sign(v) + "$" + grouped(dp).format(Math.abs(v) / 1e6) + "M";
}

/** Exact dollars and cents from an integer number of cents: "$6,187,448,275.86". */
export function usdCents(c) {
  if (c == null) return NA;
  const abs = Math.abs(c);
  return (c < 0 ? MINUS : "") + "$" + grouped(0).format(Math.floor(abs / 100)) + "." + String(abs % 100).padStart(2, "0");
}

/** Dollars to integer cents. Every reconciliation sum is done in these. */
export function cents(v) { return v == null ? null : Math.round(v * 100); }

/** A value as it prints at `dp` decimals, back as a number: shown(0.004, 2) -> 0. */
export function shown(v, dp = 1) { return v == null ? null : Number(grouped(dp).format(v).replace(/,/g, "")); }

export function pct(v, dp = 1) { return v == null ? NA : grouped(dp).format(v) + "%"; }
export function signedPct(v, dp = 1) { return v == null ? NA : sign(v) + grouped(dp).format(Math.abs(v)) + "%"; }

/** Percentage points: "+3.6 pp". */
export function pp(v, dp = 1) { return v == null ? NA : sign(v) + grouped(dp).format(Math.abs(v)) + " pp"; }

/** A multiple: "3.1×". */
export function times(v, dp = 1) { return v == null ? NA : grouped(dp).format(v) + "×"; }
export function signedTimes(v, dp = 1) { return v == null ? NA : sign(v) + grouped(dp).format(Math.abs(v)) + "×"; }

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** A small count as a word, as prose reads it: inWords(5) -> "five". */
export function inWords(n) { return WORDS[n] || String(n); }

/** A raw scenario setting, which is already a round number: "+5%", "−1.5 pp". */
export function setting(v, unit = "%") { return sign(v) + Math.abs(v) + unit; }

export function longDate(iso) {
  const [y, m, d] = iso.split("-");
  return +d + " " + MONTHS[+m - 1] + " " + y;
}

/** The same text as a screen reader should say it: "$12.3 billion", "1.5 percentage points". */
export function spoken(text) {
  return String(text)
    .replace(/\$([\d.,]+)B\b/g, "$$$1 billion")
    .replace(/\$([\d.,]+)M\b/g, "$$$1 million")
    .replace(/(\d)\s?pp\b/g, "$1 percentage points")
    .replace(/(\d)×/g, "$1 times");
}
