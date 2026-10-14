"""Backtest, bridge and sensitivity from data/processed/quarterly.csv.

Every series is a list aligned to the ticker's quarters, index 0 = START and
index L = 2026Q2. A missing value is None, and anything built from it is None.
"""

import csv
import json
from pathlib import Path

from dbf.config import AS_OF, PROCESSED, RESULTS, TICKERS

MODELS = ["backlog", "naive", "naive_drift"]
HORIZONS = ["H1", "H4"]
SHOCKS = [-10, -5, 0, 5, 10]
SHIFTS = [-3, -1.5, 0, 1.5, 3]


def load_quarterly(path: Path = PROCESSED / "quarterly.csv") -> dict[str, dict]:
    out: dict[str, dict] = {}
    with path.open() as fh:
        for row in csv.DictReader(fh):
            s = out.setdefault(row["ticker"], {"quarters": [], "B": [], "R": []})
            s["quarters"].append(row["quarter"])
            s["B"].append(int(row["backlog_usd"]) if row["backlog_usd"] else None)
            s["R"].append(int(row["revenue_usd"]) if row["revenue_usd"] else None)
    return out


def _get(x: list, i: int):
    return x[i] if 0 <= i < len(x) else None


def _sum(vals):
    return None if any(v is None for v in vals) else sum(vals)


def _div(a, b):
    return None if a is None or b is None or b == 0 else a / b


def _mean(vals):
    return None if any(v is None for v in vals) else sum(vals) / len(vals)


def conv1(B, R, t):
    """c(t) = R(t+1) / B(t)"""
    return _div(_get(R, t + 1), _get(B, t)) if t + 1 < len(R) else None


def conv4(B, R, t):
    """r(t) = [R(t+1) + ... + R(t+4)] / B(t)"""
    if t < 0 or t + 4 >= len(R):
        return None
    return _div(_sum(R[t + 1:t + 5]), _get(B, t))


def ttm(R, t):
    return _sum(R[t - 3:t + 1]) if t >= 3 else None


def bookings(B, R, t):
    if t < 1 or B[t] is None or B[t - 1] is None or R[t] is None:
        return None
    return B[t] - B[t - 1] + R[t]


def book_to_bill(B, R, t):
    return _div(bookings(B, R, t), _get(R, t))


def _mul(a, b):
    return None if a is None or b is None else a * b


def forecast(B, R, t, horizon, model):
    """The forecast made at origin t. Reads nothing after index t."""
    if horizon == "H1":
        if model == "backlog":
            return _mul(_get(B, t), _mean([conv1(B, R, t - 4), conv1(B, R, t - 8)]))
        if model == "naive":
            return _get(R, t - 3)
        return _mul(_get(R, t - 3), _div(ttm(R, t), ttm(R, t - 4)))
    if model == "backlog":
        return _mul(_get(B, t), _mean([conv4(B, R, t - k) for k in (4, 5, 6, 7)]))
    if model == "naive":
        return ttm(R, t)
    T = ttm(R, t)
    return _div(_mul(T, T), ttm(R, t - 4))


def actual(R, t, horizon):
    return _get(R, t + 1) if horizon == "H1" else _sum(R[t + 1:t + 5])


def origins(n, horizon):
    L = n - 1
    return range(8, L) if horizon == "H1" else range(8, L - 3)


def backtest_rows(ticker, s) -> list[dict]:
    B, R, Q = s["B"], s["R"], s["quarters"]
    rows = []
    for h in HORIZONS:
        step = 1 if h == "H1" else 4
        for t in origins(len(Q), h):
            a = actual(R, t, h)
            for m in MODELS:
                f = forecast(B, R, t, h, m)
                if f is None or a is None:
                    continue
                rows.append({
                    "ticker": ticker, "horizon": h, "origin": Q[t], "target": Q[t + step],
                    "model": m, "forecast_usd": f, "actual_usd": a,
                    "ape_pct": abs(a - f) / a * 100,
                })
    return rows


def bridge_rows(ticker, s) -> list[dict]:
    B, R, Q = s["B"], s["R"], s["quarters"]
    idx = {q: i for i, q in enumerate(Q)}
    years = sorted({int(q[:4]) for q in Q})
    rows = []

    def rev(y):
        qs = [idx.get(f"{y}Q{k}") for k in range(1, 5)]
        return None if None in qs else _sum([R[i] for i in qs])

    def bs(y):
        i = idx.get(f"{y - 1}Q4")
        return None if i is None else B[i]

    for y in years:
        if f"{y - 2}Q4" not in idx or f"{y}Q4" not in idx:
            continue
        r0, r1, b0, b1 = rev(y - 1), rev(y), bs(y - 1), bs(y)
        if None in (r0, r1, b0, b1):
            continue
        c0, c1 = r0 / b0, r1 / b1
        be = (b1 - b0) * c0
        ce = b0 * (c1 - c0)
        ie = (b1 - b0) * (c1 - c0)
        rows.append({
            "ticker": ticker, "year": y,
            "revenue_prior_usd": r0, "revenue_usd": r1,
            "backlog_start_prior_usd": b0, "backlog_start_usd": b1,
            "conversion_prior": c0, "conversion": c1,
            "backlog_effect_usd": be, "conversion_effect_usd": ce, "interaction_usd": ie,
            "residual_usd": (r1 - r0) - be - ce - ie,
        })
    return rows


def sensitivity_rows(ticker, s) -> list[dict]:
    B, R = s["B"], s["R"]
    L = len(B) - 1
    base = _mean([conv4(B, R, L - k) for k in (4, 5, 6, 7)])
    rows = []
    for shock in SHOCKS:
        for shift in SHIFTS:
            v = None if base is None or B[L] is None else B[L] * (1 + shock / 100) * (base + shift / 100)
            rows.append({"ticker": ticker, "backlog_shock_pct": shock,
                         "conversion_shift_pp": shift, "forward_revenue_usd": v})
    return rows


def _mean_or_null(vals):
    return sum(vals) / len(vals) if vals else None


def metrics(rows: list[dict]) -> dict:
    groups = ["ALL"] + TICKERS
    out = {"as_of": AS_OF, "n": {}, "mape": {}, "bias": {}, "win_rate_vs_naive": {}}
    for h in HORIZONS:
        hr = [r for r in rows if r["horizon"] == h]
        out["n"][h] = sum(1 for r in hr if r["model"] == "backlog")
        out["mape"][h], out["bias"][h] = {}, {}
        for m in MODELS:
            out["mape"][h][m], out["bias"][h][m] = {}, {}
            for g in groups:
                sel = [r for r in hr if r["model"] == m and g in ("ALL", r["ticker"])]
                out["mape"][h][m][g] = _mean_or_null([r["ape_pct"] for r in sel])
                out["bias"][h][m][g] = _mean_or_null(
                    [(r["forecast_usd"] - r["actual_usd"]) / r["actual_usd"] * 100 for r in sel])
        ape = {(r["ticker"], r["origin"], r["model"]): r["ape_pct"] for r in hr}
        out["win_rate_vs_naive"][h] = {}
        for g in groups:
            pairs = [(ape[(tk, o, "backlog")], ape[(tk, o, "naive")])
                     for (tk, o, m) in ape
                     if m == "backlog" and g in ("ALL", tk) and (tk, o, "naive") in ape]
            out["win_rate_vs_naive"][h][g] = (
                sum(1 for b, n in pairs if b < n) / len(pairs) * 100 if pairs else None)
    return out


def _write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=columns, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r[k] is None else r[k]) for k in columns})


def run(results: Path = RESULTS) -> None:
    data = load_quarterly()
    bt, br, se = [], [], []
    for ticker in TICKERS:
        bt += backtest_rows(ticker, data[ticker])
        br += bridge_rows(ticker, data[ticker])
        se += sensitivity_rows(ticker, data[ticker])
    results.mkdir(parents=True, exist_ok=True)
    _write_csv(results / "backtest.csv", bt, list(bt[0]))
    _write_csv(results / "bridge.csv", br, list(br[0]))
    _write_csv(results / "sensitivity.csv", se, list(se[0]))
    m = metrics(bt)
    (results / "metrics.json").write_text(json.dumps(m, indent=2) + "\n")
    print(f"backtest {len(bt)} rows, bridge {len(br)}, sensitivity {len(se)}; n {m['n']}")
    for h in HORIZONS:
        print(h, {k: round(v["ALL"], 2) for k, v in m["mape"][h].items()},
              "win", round(m["win_rate_vs_naive"][h]["ALL"], 1))
