"""Rewrite the README's ## Results from results/metrics.json. Running it twice changes nothing."""

import json
import re

from dbf.config import RESULTS, ROOT, TICKERS

NAMES = {
    "H1": {"backlog": "Backlog model", "naive": "Seasonal naive", "naive_drift": "Seasonal naive with drift"},
    "H4": {"backlog": "Backlog model", "naive": "Trailing 4Q", "naive_drift": "Trailing 4Q with drift"},
}


PHRASE = {"backlog": "backlog model", "naive": "trailing 4Q baseline",
          "naive_drift": "trailing 4Q with drift baseline"}


def _pct(v, places=2):
    return "n/a" if v is None else f"{v:.{places}f}%"


def results_section(m: dict) -> str:
    h4 = m["mape"]["H4"]
    order = sorted(h4, key=lambda k: h4[k]["ALL"])
    best, others = order[0], order[1:]
    lines = []
    lead = (f"Over the next four quarters (H4), the {PHRASE[best]} had the lowest pooled MAPE at "
            f"{_pct(h4[best]['ALL'])}, against "
            + " and ".join(f"{_pct(h4[k]['ALL'])} for the {PHRASE[k]}" for k in others) + ".")
    verdict = ("Backlog at quarter end forecast revenue better than last year's revenue did."
               if best == "backlog" else
               "Backlog at quarter end did not forecast revenue better than last year's revenue did.")
    lines += [lead + " " + verdict, ""]

    lines += ["MAPE by horizon, model and company (lower is better):", ""]
    lines += ["| Horizon | Model | ALL | " + " | ".join(TICKERS) + " |",
              "|---|---|---:|" + "---:|" * len(TICKERS)]
    for h in ("H1", "H4"):
        for k in ("backlog", "naive", "naive_drift"):
            row = m["mape"][h][k]
            lines.append(f"| {h} | {NAMES[h][k]} | {_pct(row['ALL'])} | "
                         + " | ".join(_pct(row[t]) for t in TICKERS) + " |")
    lines.append("")

    w = m["win_rate_vs_naive"]
    b = m["bias"]
    lines += [
        "The backlog model's error was smaller than the naive baseline's (seasonal naive at H1, "
        f"trailing 4Q at H4) at {_pct(w['H1']['ALL'], 1)} of H1 origins and "
        f"{_pct(w['H4']['ALL'], 1)} of H4 origins. "
        f"Its mean signed error was {_pct(b['H1']['backlog']['ALL'])} at H1 and "
        f"{_pct(b['H4']['backlog']['ALL'])} at H4, where a positive value means it forecast too high.",
        "",
        "| Win rate vs naive | ALL | " + " | ".join(TICKERS) + " |",
        "|---|---:|" + "---:|" * len(TICKERS),
    ]
    for h in ("H1", "H4"):
        lines.append(f"| {h} | {_pct(w[h]['ALL'], 1)} | "
                     + " | ".join(_pct(w[h][t], 1) for t in TICKERS) + " |")
    lines += [
        "",
        f"The backtest scores {m['n']['H1']} backlog-model forecasts at H1 and {m['n']['H4']} at H4. "
        "The naive models score more, because they need no backlog and LHX has quarters without it.",
        "",
    ]
    return "\n".join(lines)


def build(readme=ROOT / "README.md") -> None:
    m = json.loads((RESULTS / "metrics.json").read_text())
    text = readme.read_text()
    pattern = re.compile(r"(## Results\n\n).*?(?=## Method\n)", re.S)
    if not pattern.search(text):
        raise SystemExit("README.md needs a '## Results' section followed by '## Method'")
    new = pattern.sub(lambda mt: mt.group(1) + results_section(m) + "\n", text, count=1)
    if new != text:
        readme.write_text(new)
    print("README ## Results", "updated" if new != text else "unchanged")
