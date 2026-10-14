"""site/data.json reconciles with itself and with data/processed, to the cent.

The dashboard's charts and its granular table both read data.json, so these identities are
what lets a chart total be checked against the table rows beneath it.
"""

import csv
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "site" / "data.json").read_text())
COS = DATA["companies"]


def cents(v):
    return round(v * 100)


@pytest.fixture(scope="module")
def quarterly():
    with (ROOT / "data" / "processed" / "quarterly.csv").open() as fh:
        return {(r["ticker"], r["quarter"]): r for r in csv.DictReader(fh)}


@pytest.mark.parametrize("t", COS)
def test_audit_columns_match_processed_csv(t, quarterly):
    co = COS[t]
    for i, q in enumerate(co["quarters"]):
        row = quarterly[(t, q)]
        assert co["period_end"][i] == row["period_end"]
        assert co["revenue_method"][i] == (row["revenue_method"] or None)
        assert co["backlog_accn"][i] == (row["backlog_accn"] or None)
        assert co["revenue_accn"][i] == (row["revenue_accn"] or None)
        assert co["revenue_usd"][i] == (int(row["revenue_usd"]) if row["revenue_usd"] else None)


@pytest.mark.parametrize("t", COS)
def test_reported_dollars_are_whole_millions(t):
    co = COS[t]
    for v in co["revenue_usd"] + co["backlog_usd"]:
        assert v is None or v % 1_000_000 == 0


@pytest.mark.parametrize("t", COS)
def test_ttm_is_sum_of_four_quarters(t):
    co = COS[t]
    R = co["revenue_usd"]
    for i, v in enumerate(co["ttm_revenue_usd"]):
        if v is not None:
            assert v == sum(R[i - 3:i + 1])


@pytest.mark.parametrize("t", COS)
def test_bridge_ties_to_quarters_and_to_the_cent(t):
    co = COS[t]
    Q, R = co["quarters"], co["revenue_usd"]
    for b in co["bridge"]:
        for key, year in (("revenue_usd", b["year"]), ("revenue_prior_usd", b["year"] - 1)):
            assert b[key] == sum(R[Q.index(f"{year}Q{k}")] for k in range(1, 5))
        change = cents(b["revenue_usd"] - b["revenue_prior_usd"])
        be, ce = cents(b["backlog_effect_usd"]), cents(b["conversion_effect_usd"])
        # The dashboard shows the overlap as the plug; it may differ from its own rounding by a cent.
        assert abs((change - be - ce) - cents(b["interaction_usd"])) <= 1
        assert abs(b["residual_usd"]) < 0.01


@pytest.mark.parametrize("t", COS)
def test_forecast_actuals_are_table_revenue(t):
    co = COS[t]
    Q, R = co["quarters"], co["revenue_usd"]
    for target, actual in zip(co["h1"]["target"], co["h1"]["actual_usd"]):
        assert actual == R[Q.index(target)]
    for target, actual in zip(co["h4"]["target"], co["h4"]["actual_usd"]):
        j = Q.index(target)
        assert actual == sum(R[j - 3:j + 1])


def test_pooled_metrics_recompute_from_forecast_rows():
    m = DATA["metrics"]
    for h in ("H1", "H4"):
        apes = {}
        for t, co in COS.items():
            block = co[h.lower()]
            for i, o in enumerate(block["origin"]):
                a = block["actual_usd"][i]
                for model in ("backlog", "naive", "naive_drift"):
                    f = block[model][i]
                    if f is not None:
                        apes[(t, o, model)] = abs(f - a) / a * 100
        for model in ("backlog", "naive", "naive_drift"):
            vals = [v for (t, o, mm), v in apes.items() if mm == model]
            assert sum(vals) / len(vals) == pytest.approx(m["mape"][h][model]["ALL"], abs=1e-9)
        pairs = [(v, apes[(t, o, "naive")]) for (t, o, mm), v in apes.items()
                 if mm == "backlog" and (t, o, "naive") in apes]
        assert len(pairs) == m["n"][h]
        wins = sum(1 for b, n in pairs if b < n)
        assert wins / len(pairs) * 100 == pytest.approx(m["win_rate_vs_naive"][h]["ALL"], abs=1e-9)
