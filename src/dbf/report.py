"""Rewrite the README's ## Results from results/. Running it twice changes nothing."""

import csv
import json
import re

from dbf.config import RESULTS, ROOT, TICKERS

MODELS = ["backlog", "naive", "naive_drift"]
NAMES = {
    "H1": {"backlog": "Backlog model", "naive": "Seasonal naive", "naive_drift": "Seasonal naive with drift"},
    "H4": {"backlog": "Backlog model", "naive": "Trailing 4Q", "naive_drift": "Trailing 4Q with drift"},
}
HORIZON = {"H1": "Next quarter (H1)", "H4": "Next four quarters (H4)"}
PHRASE = {"backlog": "the backlog model", "naive": "trailing four-quarter revenue",
          "naive_drift": "trailing revenue with drift"}


def _pct(v, places=1):
    return "n/a" if v is None else f"{v:.{places}f}%"


def matched_ranking(backtest_rows, horizon) -> tuple[list[str], int, list[str]]:
    """Model order by MAPE on the origins where the backlog model has a forecast."""
    rows = [r for r in backtest_rows if r["horizon"] == horizon]
    keep = {(r["ticker"], r["origin"]) for r in rows if r["model"] == "backlog"}
    mape = {}
    for m in MODELS:
        apes = [float(r["ape_pct"]) for r in rows if r["model"] == m and (r["ticker"], r["origin"]) in keep]
        mape[m] = sum(apes) / len(apes)
    extra = [r["ticker"] for r in rows if r["model"] == "naive" and (r["ticker"], r["origin"]) not in keep]
    return sorted(MODELS, key=mape.get), len(extra), sorted(set(extra))


def results_section(m: dict, backtest_rows: list[dict]) -> str:
    h4 = m["mape"]["H4"]
    order = sorted(MODELS, key=lambda k: h4[k]["ALL"])
    best = order[0]
    lines = []
    if best == "backlog":
        lead = "Backlog beat simple trailing revenue."
    else:
        lead = "Backlog did not beat simple trailing revenue."
    lead += (" Over the next four quarters, the backlog model missed actual revenue by "
             f"{_pct(h4['backlog']['ALL'])} on average, against "
             + " and ".join(f"{_pct(h4[k]['ALL'])} for {PHRASE[k]}" for k in MODELS if k != "backlog") + ".")
    winners = [t for t in TICKERS if h4["backlog"][t] is not None
               and all(h4["backlog"][t] < h4[k][t] for k in ("naive", "naive_drift"))]
    if winners and best != "backlog":
        detail = [f"{_pct(h4['backlog'][t])} for backlog against {_pct(h4['naive'][t])} for trailing "
                  f"four-quarter revenue" for t in winners]
        if len(winners) == 1:
            lead += f" {winners[0]} was the exception, at {detail[0]}."
        else:
            lead += " The exceptions were " + "; ".join(f"{t}, at {d}" for t, d in zip(winners, detail)) + "."
    ranking, extra, where = matched_ranking(backtest_rows, "H4")
    same = ranking == order
    if extra:
        lead += (f" The baselines also score {extra} {' and '.join(where)} origins where backlog is missing; on the "
                 f"origins all three models share, the ranking is {'the same' if same else 'different'}.")
    lines += [lead, ""]

    lines += ["MAPE by horizon, model and company (lower is better):", ""]
    lines += ["| Horizon | Model | ALL | " + " | ".join(TICKERS) + " |",
              "|---|---|---:|" + "---:|" * len(TICKERS)]
    for h in ("H1", "H4"):
        for k in MODELS:
            row = m["mape"][h][k]
            lines.append(f"| {HORIZON[h]} | {NAMES[h][k]} | {_pct(row['ALL'])} | "
                         + " | ".join(_pct(row[t]) for t in TICKERS) + " |")
    lines.append("")

    w = m["win_rate_vs_naive"]
    b = m["bias"]
    lines += [
        "The backlog model's error was smaller than the naive baseline's (seasonal naive at H1, "
        f"trailing 4Q at H4) at {_pct(w['H1']['ALL'])} of H1 origins and "
        f"{_pct(w['H4']['ALL'])} of H4 origins. "
        f"Its mean signed error was {_pct(b['H1']['backlog']['ALL'])} at H1 and "
        f"{_pct(b['H4']['backlog']['ALL'])} at H4, where a positive value means it forecast too high.",
        "",
        "| Win rate vs naive | ALL | " + " | ".join(TICKERS) + " |",
        "|---|---:|" + "---:|" * len(TICKERS),
    ]
    for h in ("H1", "H4"):
        lines.append(f"| {HORIZON[h]} | {_pct(w[h]['ALL'])} | "
                     + " | ".join(_pct(w[h][t]) for t in TICKERS) + " |")
    lines += [
        "",
        f"The backtest scores {m['n']['H1']} backlog-model forecasts at H1 and {m['n']['H4']} at H4. "
        "The naive models score more, because they need no backlog and LHX has quarters without it.",
        "",
    ]
    return "\n".join(lines)


def build(readme=ROOT / "README.md") -> None:
    m = json.loads((RESULTS / "metrics.json").read_text())
    with (RESULTS / "backtest.csv").open() as fh:
        backtest_rows = list(csv.DictReader(fh))
    text = readme.read_text()
    pattern = re.compile(r"(## Results\n\n).*?(?=## Method\n)", re.S)
    if not pattern.search(text):
        raise SystemExit("README.md needs a '## Results' section followed by '## Method'")
    new = pattern.sub(lambda mt: mt.group(1) + results_section(m, backtest_rows) + "\n", text, count=1)
    if new != text:
        readme.write_text(new)
    print("README ## Results", "updated" if new != text else "unchanged")
