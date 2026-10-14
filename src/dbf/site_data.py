"""Write site/data.json for the dashboard from data/processed and results/."""

import csv
import json

from dbf import model
from dbf.config import AS_OF, RESULTS, SITE, TICKERS


def _num(v: str):
    if v == "":
        return None
    f = float(v)
    return int(f) if f.is_integer() and "." not in v and "e" not in v.lower() else f


def _read(path):
    with path.open() as fh:
        return list(csv.DictReader(fh))


def company(ticker, s, backtest, bridge, sens) -> dict:
    B, R, Q = s["B"], s["R"], s["quarters"]
    out = {
        "ticker": ticker,
        "quarters": Q,
        "backlog_usd": B,
        "revenue_usd": R,
        "ttm_revenue_usd": [model.ttm(R, t) for t in range(len(Q))],
        "implied_bookings_usd": [model.bookings(B, R, t) for t in range(len(Q))],
        "book_to_bill": [model.book_to_bill(B, R, t) if t >= 1 else None for t in range(len(Q))],
    }
    for h in model.HORIZONS:
        rows = [r for r in backtest if r["ticker"] == ticker and r["horizon"] == h]
        origins = sorted({r["origin"] for r in rows}, key=Q.index)
        block = {k: [] for k in ("origin", "target", "actual_usd", *model.MODELS)}
        for o in origins:
            by_model = {r["model"]: r for r in rows if r["origin"] == o}
            first = next(iter(by_model.values()))
            block["origin"].append(o)
            block["target"].append(first["target"])
            block["actual_usd"].append(_num(first["actual_usd"]))
            for m in model.MODELS:
                block[m].append(_num(by_model[m]["forecast_usd"]) if m in by_model else None)
        out[h.lower()] = block
    out["bridge"] = [{k: (int(v) if k == "year" else _num(v)) for k, v in r.items() if k != "ticker"}
                     for r in bridge if r["ticker"] == ticker]
    out["sensitivity"] = [{k: _num(v) for k, v in r.items() if k != "ticker"}
                          for r in sens if r["ticker"] == ticker]
    return out


def build() -> None:
    data = model.load_quarterly()
    backtest = _read(RESULTS / "backtest.csv")
    bridge = _read(RESULTS / "bridge.csv")
    sens = _read(RESULTS / "sensitivity.csv")
    payload = {
        "as_of": AS_OF,
        "metrics": json.loads((RESULTS / "metrics.json").read_text()),
        "companies": {t: company(t, data[t], backtest, bridge, sens) for t in TICKERS},
    }
    SITE.mkdir(parents=True, exist_ok=True)
    path = SITE / "data.json"
    path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"wrote {path.relative_to(SITE.parent)}: {path.stat().st_size:,} bytes")
