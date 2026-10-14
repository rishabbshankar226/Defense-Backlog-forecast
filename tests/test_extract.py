import json
from pathlib import Path

import pytest

from dbf.extract import extract_company, fact_quarter, first_reported

FIXTURE = Path(__file__).parent / "fixtures" / "companyfacts_tst.json"


@pytest.fixture(scope="module")
def rows():
    company = json.loads(FIXTURE.read_text())
    out = extract_company(company, "TST", "2024Q1", "2026-10-13", end="2026Q1")
    return {r["quarter"]: r for r in out}


@pytest.mark.parametrize("end, quarter", [
    ("2024-03-31", "2024Q1"),
    ("2025-04-04", "2025Q1"),   # 52/53-week quarter ending past the calendar quarter
    ("2025-01-03", "2024Q4"),   # LHX-style fiscal year end three days into January
    ("2024-04-14", "2024Q1"),
    ("2024-04-16", "2024Q2"),
])
def test_quarter_rule(end, quarter):
    assert fact_quarter(end) == quarter


def test_first_reported_order():
    base = {"end": "2024-03-31", "rank": 0}
    a = {**base, "filed": "2024-05-01", "accn": "X", "val": 5}
    b = {**base, "filed": "2024-04-01", "accn": "Z", "val": 9}
    c = {**base, "filed": "2024-04-01", "accn": "Y", "val": 9}
    assert first_reported([a, b, c]) is c
    later_end = {**c, "end": "2024-04-02"}
    assert first_reported([c, later_end]) is later_end
    tagged = {**c, "rank": 1, "val": 1}
    assert first_reported([tagged, c]) is c


def test_first_reported_ignores_restatement(rows):
    assert rows["2024Q1"]["revenue_usd"] == 100
    assert rows["2024Q1"]["backlog_usd"] == 1000
    assert rows["2024Q1"]["backlog_accn"] == "A1"


def test_tag_pooling(rows):
    assert rows["2024Q1"]["revenue_tag"] == "Revenues"
    assert rows["2024Q2"]["revenue_tag"] == "RevenueFromContractWithCustomerExcludingAssessedTax"
    assert rows["2024Q2"]["revenue_usd"] == 110
    assert rows["2024Q2"]["revenue_method"] == "reported_3m"


def test_q4_from_full_year_less_nine_months(rows):
    q4 = rows["2024Q4"]
    assert q4["revenue_usd"] == 470 - 330
    assert q4["revenue_method"] == "fy_minus_9m"
    assert (q4["revenue_accn"], q4["revenue_filed"]) == ("A4", "2025-02-01")


def test_misdated_full_year(rows):
    q4 = rows["2025Q4"]
    assert q4["revenue_usd"] == 580 - 420
    assert q4["revenue_method"] == "fy_minus_9m"
    assert (q4["revenue_tag"], q4["revenue_accn"]) == ("Revenues", "B4")


def test_as_of_and_form_filters(rows):
    assert rows["2026Q1"]["revenue_usd"] == ""
    assert rows["2025Q1"]["backlog_usd"] == 1300
    assert rows["2025Q1"]["period_end"] == "2025-04-04"
    assert rows["2024Q3"]["revenue_usd"] == 120


def test_row_span(rows):
    assert list(rows)[0] == "2024Q1" and list(rows)[-1] == "2026Q1"
    assert len(rows) == 9
