/* Implied book-to-bill under the backlog chart, quarter for quarter. A bar runs up from
   1.0× when backlog grew in the quarter (favourable, green) and down when it shrank
   (unfavourable, red); the direction carries the meaning as well as the colour. */

import { fade } from "../dom.js";
import { times, usdM } from "../format.js";
import { quartersFor } from "../model.js";
import { baseOptions, linked, upsert, describe } from "./base.js";

export function renderBtb(model, st, c, period) {
  const rows = quartersFor(model, st.ticker, period);
  if (!rows.length) return { empty: "No quarters in this period." };
  const v = rows.map((r) => r.btb);
  const fills = v.map((x) => (x == null ? c.track : fade(x >= 1 ? c.fav : c.unfav, 0.85)));
  const opts = linked(baseOptions(c, "Book-to-bill (×)", "", (x) => times(x)));
  opts.scales.x.ticks.display = false;
  opts.scales.y.ticks.maxTicksLimit = 3;
  opts.scales.y.suggestedMin = 0.5;
  opts.scales.y.suggestedMax = 1.5;
  upsert("c-btb", {
    type: "bar",
    data: {
      labels: rows.map((r) => r.quarter),
      datasets: [{
        data: v.map((x) => (x == null ? null : [1, x])),
        backgroundColor: fills, hoverBackgroundColor: fills,
        borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.9
      }]
    },
    options: opts
  }, {
    $colors: c,
    $crosshair: true,
    $baseline: 1,
    $tip: (pts) => {
      const r = rows[pts[0].dataIndex];
      if (r.btb == null) return null;
      return {
        title: r.quarter,
        rows: [
          { color: fills[pts[0].dataIndex], label: "Implied book-to-bill", value: times(r.btb, 2), extra: r.btb >= 1 ? "▲ backlog grew" : "▼ backlog shrank" },
          { color: c.muted, label: "Implied bookings (derived)", value: usdM(r.bookings), extra: "" },
          { color: c.muted, label: "Revenue, quarter (GAAP)", value: usdM(r.revenue), extra: "" }
        ]
      };
    }
  });
  const shown = v.filter((x) => x != null), up = shown.filter((x) => x >= 1).length, last = rows[rows.length - 1];
  describe("c-btb", `${st.ticker} implied book-to-bill by quarter: at or above 1.0 in ${up} of ${shown.length} quarters` +
    (last.btb == null ? "." : `, and ${times(last.btb, 2)} at ${last.quarter}.`));
  return null;
}
