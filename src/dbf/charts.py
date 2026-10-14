"""Three PNG charts in output/charts/: 16 x 9 inches, saved at 200 dpi (3200 x 1800) so they stay sharp on high-density screens."""

import csv
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from dbf import model  # noqa: E402
from dbf.config import OUTPUT, RESULTS, SOURCE_LINE, TICKERS  # noqa: E402

INK = "#1c1c1c"
ACCENT = "#b4451f"
NAIVE = "#8a8a8a"
DRIFT = "#6b6b6b"
GRID = "#e4e2dd"
PAPER = "#fbfaf7"
COLORS = {"backlog": ACCENT, "naive": NAIVE, "naive_drift": DRIFT}
NAMES = {
    "H1": {"backlog": "Backlog model", "naive": "Seasonal naive", "naive_drift": "Seasonal naive with drift"},
    "H4": {"backlog": "Backlog model", "naive": "Trailing 4Q", "naive_drift": "Trailing 4Q with drift"},
}

PHRASE = {"naive": "trailing 4Q revenue", "naive_drift": "trailing 4Q with drift"}

# Figures are laid out at 100 dpi (1600 x 900) and saved at twice that, so every element
# keeps its place and size while the file has four times the pixels.
SAVE_DPI = 200

plt.rcParams.update({
    "font.size": 14, "axes.edgecolor": "#8a8a8a", "axes.labelcolor": INK, "text.color": INK,
    "xtick.color": INK, "ytick.color": INK, "axes.spines.top": False, "axes.spines.right": False,
    "figure.facecolor": PAPER, "axes.facecolor": PAPER, "savefig.facecolor": PAPER,
})


def _fig():
    return plt.figure(figsize=(16, 9), dpi=100)


def _source(fig):
    fig.text(0.01, 0.012, f"Source: {SOURCE_LINE}. Rishabb Shankar, rshankar.dev",
             fontsize=11, color="#555555")


def _save(fig, name):
    path = OUTPUT / "charts" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=SAVE_DPI)
    plt.close(fig)
    print(f"wrote {path.relative_to(OUTPUT.parent)}")


def headline(metrics: dict) -> str:
    h4 = metrics["mape"]["H4"]
    best = min(h4, key=lambda m: h4[m]["ALL"])
    if best == "backlog":
        return f"Over four quarters, backlog wins: pooled MAPE {h4['backlog']['ALL']:.1f}%"
    return (f"Over four quarters, {PHRASE[best]} beats backlog: "
            f"MAPE {h4[best]['ALL']:.1f}% vs {h4['backlog']['ALL']:.1f}%")


def mape_chart(metrics):
    fig = _fig()
    ax = fig.add_axes([0.07, 0.2, 0.9, 0.63])
    width = 0.26
    for i, h in enumerate(["H1", "H4"]):
        for j, m in enumerate(model.MODELS):
            v = metrics["mape"][h][m]["ALL"]
            x = i + (j - 1) * width
            ax.bar(x, v, width * 0.92, color=COLORS[m])
            ax.text(x, v + 0.15, f"{v:.1f}%", ha="center", va="bottom", fontsize=15)
            ax.text(x, -0.35, NAMES[h][m].replace(" with ", "\nwith "), ha="center", va="top", fontsize=12)
    ax.set_xticks([0, 1])
    ax.set_xticklabels([f"Next quarter (H1), n = {metrics['n']['H1']}",
                        f"Next four quarters (H4), n = {metrics['n']['H4']}"], fontsize=15)
    ax.tick_params(axis="x", pad=58, length=0)
    ax.set_ylabel("Mean absolute percentage error (%)")
    top = max(metrics["mape"][h][m]["ALL"] for h in ("H1", "H4") for m in model.MODELS)
    ax.set_ylim(0, top * 1.18)
    ax.yaxis.grid(True, color=GRID)
    ax.set_axisbelow(True)
    fig.text(0.07, 0.93, headline(metrics), fontsize=24, weight="bold")
    fig.text(0.07, 0.885, "Five U.S. defense primes, pooled across companies; lower is better. "
             "n counts backlog-model forecasts.", fontsize=14, color="#444444")
    _source(fig)
    _save(fig, "backtest_mape.png")


def backlog_chart(data):
    fig, axes = plt.subplots(2, 3, figsize=(16, 9), dpi=100)
    fig.subplots_adjust(left=0.06, right=0.98, top=0.82, bottom=0.1, hspace=0.42, wspace=0.22)
    for ax, ticker in zip(axes.flat, TICKERS):
        s = data[ticker]
        Q, B, R = s["quarters"], s["B"], s["R"]
        x = list(range(len(Q)))
        ax.plot(x, [b / 1e9 if b is not None else None for b in B], color=ACCENT, lw=2.4)
        ttm = [model.ttm(R, t) for t in x]
        ax.plot(x, [v / 1e9 if v is not None else None for v in ttm], color=INK, lw=2.4)
        ax.set_title(ticker, loc="left", weight="bold")
        ticks = [i for i, q in enumerate(Q) if q.endswith("Q1") and int(q[:4]) % 2 == 0]
        ax.set_xticks(ticks)
        ax.set_xticklabels([Q[i][:4] for i in ticks], fontsize=12)
        ax.set_ylabel("$B")
        ax.set_ylim(bottom=0)
        ax.yaxis.grid(True, color=GRID)
        ax.set_axisbelow(True)
    leg = axes.flat[5]
    leg.axis("off")
    leg.plot([], [], color=ACCENT, lw=3, label="Backlog (RPO) at quarter end")
    leg.plot([], [], color=INK, lw=3, label="Revenue, trailing four quarters")
    leg.legend(loc="center left", frameon=False, fontsize=15)
    fig.text(0.06, 0.93, "Backlog and trailing revenue, $B, by quarter", fontsize=22, weight="bold")
    fig.text(0.06, 0.895, "Gaps are quarters whose filings tag no backlog for the quarter's own end "
             "(LHX, first three quarters of 2020 and 2021).", fontsize=14, color="#444444")
    _source(fig)
    _save(fig, "backlog_vs_revenue.png")


def bridge_chart(year=2025):
    with (RESULTS / "bridge.csv").open() as fh:
        rows = {r["ticker"]: r for r in csv.DictReader(fh) if int(r["year"]) == year}
    fig, axes = plt.subplots(2, 3, figsize=(16, 9), dpi=100)
    fig.subplots_adjust(left=0.05, right=0.99, top=0.84, bottom=0.11, wspace=0.2, hspace=0.45)
    labels = [f"{year - 1}\nrevenue", "Backlog\neffect", "Conversion\neffect", "Inter-\naction",
              f"{year}\nrevenue"]
    for ax, ticker in zip(axes.flat, TICKERS):
        r = {k: float(v) / 1e9 for k, v in rows[ticker].items() if k not in ("ticker", "year")}
        steps = [r["backlog_effect_usd"], r["conversion_effect_usd"], r["interaction_usd"]]
        level = r["revenue_prior_usd"]
        lo = min(r["revenue_prior_usd"], r["revenue_usd"])
        ax.bar(0, r["revenue_prior_usd"], color=INK, width=0.7)
        for i, d in enumerate(steps, start=1):
            ax.bar(i, d, bottom=level, color=ACCENT if d >= 0 else DRIFT, width=0.7)
            ax.text(i, max(level, level + d) + 0.004 * level, f"{d:+.2f}", ha="center",
                    va="bottom", fontsize=11)
            level += d
            lo = min(lo, level)
        ax.bar(4, r["revenue_usd"], color=INK, width=0.7)
        for i, v in ((0, r["revenue_prior_usd"]), (4, r["revenue_usd"])):
            ax.text(i, v + 0.004 * v, f"{v:.1f}", ha="center", va="bottom", fontsize=11)
        hi = max(r["revenue_prior_usd"], r["revenue_usd"], level) + max(abs(d) for d in steps)
        span = hi - lo
        ax.set_ylim(lo - 0.6 * span, hi + 0.25 * span)
        ax.set_xticks(range(5))
        ax.set_xticklabels(labels, fontsize=11)
        ax.set_title(ticker, loc="left", weight="bold")
        ax.set_ylabel("$B")
        ax.yaxis.grid(True, color=GRID)
        ax.set_axisbelow(True)
    key = axes.flat[5]
    key.axis("off")
    key.text(0.02, 0.95, "How to read it\n\n"
             "Backlog effect: the change in starting\nbacklog at last year's conversion rate.\n\n"
             "Conversion effect: the change in the\nconversion rate on last year's backlog.\n\n"
             "Interaction: both changes together.\n\n"
             "Orange adds revenue, grey subtracts.\nAxes start above zero.",
             fontsize=13, va="top", color="#333333", linespacing=1.3)
    fig.text(0.05, 0.93, f"What moved {year} revenue, $B", fontsize=22, weight="bold")
    fig.text(0.05, 0.895, "Revenue change split into backlog, conversion rate and interaction; "
             "the residual is under $1.", fontsize=14, color="#444444")
    _source(fig)
    _save(fig, f"bridge_{year}.png")


def build() -> None:
    metrics = json.loads((RESULTS / "metrics.json").read_text())
    mape_chart(metrics)
    backlog_chart(model.load_quarterly())
    bridge_chart(2025)
