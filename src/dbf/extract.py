"""Turn companyfacts JSON into first-reported quarterly backlog and revenue."""

import csv
import json
from datetime import date, timedelta
from pathlib import Path

from dbf.config import (
    BACKLOG_TAG,
    COMPANIES,
    END_QUARTER,
    PROCESSED,
    RAW,
    REVENUE_TAGS,
    quarter_range,
)

COLUMNS = [
    "ticker", "quarter", "period_end", "backlog_usd", "backlog_accn", "backlog_filed",
    "revenue_usd", "revenue_method", "revenue_tag", "revenue_accn", "revenue_filed",
]


def fact_quarter(end: str) -> str:
    """Subtract 15 days from the end date and take that date's calendar quarter."""
    d = date.fromisoformat(end) - timedelta(days=15)
    return f"{d.year}Q{(d.month - 1) // 3 + 1}"


def days(f: dict) -> int:
    return (date.fromisoformat(f["end"]) - date.fromisoformat(f["start"])).days


def sort_key(f: dict):
    # filed, then accn, then the later end first, then tag rank, then val
    return (f["filed"], f["accn"], -date.fromisoformat(f["end"]).toordinal(), f["rank"], f["val"])


def first_reported(facts: list[dict]) -> dict | None:
    return min(facts, key=sort_key) if facts else None


def load_facts(company: dict, tag: str, rank: int, as_of: str) -> list[dict]:
    units = company.get("facts", {}).get("us-gaap", {}).get(tag, {}).get("units", {})
    out = []
    for f in units.get("USD", []):
        if f.get("form") in ("10-Q", "10-K") and f["filed"] <= as_of:
            out.append({**f, "tag": tag, "rank": rank})
    return out


def backlog_by_quarter(company: dict, as_of: str) -> dict[str, dict]:
    groups: dict[str, list[dict]] = {}
    for f in load_facts(company, BACKLOG_TAG, 0, as_of):
        if "start" not in f:
            groups.setdefault(fact_quarter(f["end"]), []).append(f)
    return {q: first_reported(fs) for q, fs in groups.items()}


def revenue_by_quarter(company: dict, as_of: str) -> dict[str, dict]:
    pool = []
    for tag, rank in REVENUE_TAGS.items():
        pool += [f for f in load_facts(company, tag, rank, as_of) if "start" in f]

    three = [f for f in pool if 80 <= days(f) <= 100]
    nine = [f for f in pool if 260 <= days(f) <= 290]
    full = [f for f in pool if 350 <= days(f) <= 380]

    def nine_month(**match) -> dict | None:
        return first_reported([f for f in nine if all(f[k] == v for k, v in match.items())])

    # A three-month fact larger than the nine months ending the day before it
    # starts is a misdated full year (LHX FY2025). Set it aside.
    kept, set_aside = [], []
    for f in three:
        day_before = (date.fromisoformat(f["start"]) - timedelta(days=1)).isoformat()
        nm = nine_month(end=day_before)
        if nm is not None and f["val"] > nm["val"]:
            set_aside.append((f, nm))
        else:
            kept.append(f)

    def by_quarter(facts):
        groups: dict[str, list] = {}
        for f in facts:
            groups.setdefault(fact_quarter(f["end"]), []).append(f)
        return groups

    kept_q = by_quarter(kept)
    full_q = by_quarter(full)
    aside_q: dict[str, list] = {}
    for f, nm in set_aside:
        aside_q.setdefault(fact_quarter(f["end"]), []).append(f)
    aside_nine = {id(f): nm for f, nm in set_aside}

    out = {}
    for q in set(kept_q) | set(full_q) | set(aside_q):
        if q in kept_q:
            f = first_reported(kept_q[q])
            out[q] = {"val": int(f["val"]), "method": "reported_3m", "src": f}
            continue
        if q in full_q:
            fy = first_reported(full_q[q])
            nm = nine_month(start=fy["start"])
            if nm is not None:
                out[q] = {"val": int(fy["val"] - nm["val"]), "method": "fy_minus_9m", "src": fy}
                continue
        if q in aside_q:
            f = first_reported(aside_q[q])
            nm = aside_nine[id(f)]
            out[q] = {"val": int(f["val"] - nm["val"]), "method": "fy_minus_9m", "src": f}
    return out


def extract_company(company: dict, ticker: str, start: str, as_of: str,
                    end: str = END_QUARTER) -> list[dict]:
    backlog = backlog_by_quarter(company, as_of)
    revenue = revenue_by_quarter(company, as_of)
    rows = []
    for q in quarter_range(start, end):
        b, r = backlog.get(q), revenue.get(q)
        rows.append({
            "ticker": ticker,
            "quarter": q,
            "period_end": b["end"] if b else "",
            "backlog_usd": int(b["val"]) if b else "",
            "backlog_accn": b["accn"] if b else "",
            "backlog_filed": b["filed"] if b else "",
            "revenue_usd": r["val"] if r else "",
            "revenue_method": r["method"] if r else "",
            "revenue_tag": r["src"]["tag"] if r else "",
            "revenue_accn": r["src"]["accn"] if r else "",
            "revenue_filed": r["src"]["filed"] if r else "",
        })
    return rows


def write_quarterly(as_of: str, raw_dir: Path = RAW, out_dir: Path = PROCESSED) -> Path:
    rows = []
    for ticker, (cik, start) in sorted(COMPANIES.items()):
        company = json.loads((raw_dir / f"CIK{cik}.json").read_text())
        rows += extract_company(company, ticker, start, as_of)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "quarterly.csv"
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    gaps = [(r["ticker"], r["quarter"]) for r in rows if r["backlog_usd"] == "" or r["revenue_usd"] == ""]
    print(f"wrote {path.relative_to(out_dir.parents[1])}: {len(rows)} rows, {len(gaps)} with a gap {gaps}")
    return path
