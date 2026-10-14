"""Fixed study settings from docs/PREREGISTRATION.md."""

from pathlib import Path

AS_OF = "2026-10-13"
END_QUARTER = "2026Q2"

# ticker -> (CIK, START)
COMPANIES = {
    "HII": ("0001501585", "2018Q1"),
    "LHX": ("0000202058", "2020Q1"),
    "LMT": ("0000936468", "2018Q1"),
    "NOC": ("0001133421", "2018Q3"),
    "RTX": ("0000101829", "2020Q2"),
}
TICKERS = list(COMPANIES)

BACKLOG_TAG = "RevenueRemainingPerformanceObligation"
REVENUE_TAGS = {"Revenues": 0, "RevenueFromContractWithCustomerExcludingAssessedTax": 1}

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
RESULTS = ROOT / "results"
OUTPUT = ROOT / "output"
SITE = ROOT / "site"
SOURCE_LINE = "SEC EDGAR XBRL, first reported, as of 2026-10-13"


def q_index(q: str) -> int:
    """'2024Q3' -> an integer that steps by one per quarter."""
    return int(q[:4]) * 4 + int(q[5]) - 1


def q_label(i: int) -> str:
    return f"{i // 4}Q{i % 4 + 1}"


def quarter_range(start: str, end: str = END_QUARTER) -> list[str]:
    return [q_label(i) for i in range(q_index(start), q_index(end) + 1)]
