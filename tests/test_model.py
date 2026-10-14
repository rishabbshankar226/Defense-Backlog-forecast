import random

import pytest

from dbf.model import (
    actual, backtest_rows, bridge_rows, forecast, metrics, origins, sensitivity_rows,
)

# 13 quarters: index 0 is START, index 12 is L
B = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220]
R = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
Q = [f"{2020 + i // 4}Q{i % 4 + 1}" for i in range(13)]
S = {"quarters": Q, "B": B, "R": R}


def test_h1_by_hand():
    # origin 8: B(8)=180, c(4)=R5/B4=15/140, c(0)=R1/B0=11/100
    assert forecast(B, R, 8, "H1", "backlog") == pytest.approx(19.542857142857)
    assert forecast(B, R, 8, "H1", "naive") == 15                    # R(5)
    assert forecast(B, R, 8, "H1", "naive_drift") == pytest.approx(19.8)  # 15 * 66 / 50
    assert actual(R, 8, "H1") == 19


def test_h4_by_hand():
    # r(t-4..t-7) at t=8: r(4)=R5..R8/B4=66/140, r(3)=62/130, r(2)=58/120, r(1)=54/110
    mean_r = (66 / 140 + 62 / 130 + 58 / 120 + 54 / 110) / 4
    assert forecast(B, R, 8, "H4", "backlog") == pytest.approx(180 * mean_r)
    assert forecast(B, R, 8, "H4", "backlog") == pytest.approx(86.5167, abs=1e-4)
    assert forecast(B, R, 8, "H4", "naive") == 66
    assert forecast(B, R, 8, "H4", "naive_drift") == pytest.approx(87.12)
    assert actual(R, 8, "H4") == 82


def test_origin_windows():
    assert list(origins(13, "H1")) == [8, 9, 10, 11]
    assert list(origins(13, "H4")) == [8]
    rows = backtest_rows("TST", S)
    assert len(rows) == 3 * (4 + 1)
    h4 = [r for r in rows if r["horizon"] == "H4"]
    assert {(r["origin"], r["target"]) for r in h4} == {("2022Q1", "2023Q1")}


def test_no_forecast_reads_after_origin():
    rng = random.Random(7)
    b = [rng.randint(500, 900) for _ in range(20)]
    r = [rng.randint(50, 90) for _ in range(20)]
    for h in ("H1", "H4"):
        for t in origins(20, h):
            for m in ("backlog", "naive", "naive_drift"):
                before = forecast(b, r, t, h, m)
                b2 = b[:t + 1] + [10 ** 9] * (19 - t)
                r2 = r[:t + 1] + [10 ** 9] * (19 - t)
                assert forecast(b2, r2, t, h, m) == before


def test_blank_input_skips_forecast():
    b = list(B)
    b[0] = None
    assert forecast(b, R, 8, "H1", "backlog") is None
    assert forecast(b, R, 8, "H1", "naive") == 15


def test_bridge_residual_zero():
    q = [f"{2018 + i // 4}Q{i % 4 + 1}" for i in range(16)]
    b = [40_000_000_000 + 731_000_000 * i for i in range(16)]
    r = [9_000_000_000 + 123_456_789 * (i % 4) + 50_000_000 * i for i in range(16)]
    rows = bridge_rows("TST", {"quarters": q, "B": b, "R": r})
    assert [x["year"] for x in rows] == [2020, 2021]
    for x in rows:
        assert abs(x["residual_usd"]) < 1
        assert x["conversion"] == x["revenue_usd"] / x["backlog_start_usd"]


def test_sensitivity_grid():
    rows = sensitivity_rows("TST", S)
    assert len(rows) == 25
    base = (R[9] + R[10] + R[11] + R[12]) / B[8]  # r(L-4) with L = 12
    mean_r = sum((sum(R[t + 1:t + 5]) / B[t]) for t in (5, 6, 7, 8)) / 4
    centre = [x for x in rows if x["backlog_shock_pct"] == 0 and x["conversion_shift_pp"] == 0][0]
    assert centre["forward_revenue_usd"] == pytest.approx(220 * mean_r)
    assert base > 0
    top = [x for x in rows if x["backlog_shock_pct"] == 10 and x["conversion_shift_pp"] == 3][0]
    assert top["forward_revenue_usd"] == pytest.approx(220 * 1.1 * (mean_r + 0.03))


def test_metrics_shape():
    m = metrics(backtest_rows("HII", S))
    assert m["n"] == {"H1": 4, "H4": 1}
    assert m["mape"]["H1"]["backlog"]["LMT"] is None
    assert set(m["win_rate_vs_naive"]["H4"]) == {"ALL", "HII", "LHX", "LMT", "NOC", "RTX"}
