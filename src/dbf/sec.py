"""Fetch SEC companyfacts once and record what was fetched."""

import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from dbf.config import COMPANIES, RAW

URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
MIN_INTERVAL = 0.25  # seconds between requests, under SEC's 5 a second


def read_user_agent(path: Path = Path.home() / ".sec_ua") -> str:
    ua = path.read_text().strip() if path.exists() else ""
    if not ua:
        raise SystemExit(f"{path} is empty: SEC needs a name and email in the User-Agent")
    return ua


def raw_path(cik: str, raw_dir: Path = RAW) -> Path:
    return raw_dir / f"CIK{cik}.json"


def _get(url: str, ua: str) -> bytes:
    refusals = 0
    while True:
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                refusals += 1
                if refusals >= 2:
                    raise SystemExit(f"SEC answered {e.code} twice in a row for {url}; stopping")
                time.sleep(5)
                continue
            raise


def fetch_all(raw_dir: Path = RAW) -> None:
    """Fetch each company's file only when it is missing."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    ua = None
    for ticker, (cik, _) in COMPANIES.items():
        path = raw_path(cik, raw_dir)
        if path.exists():
            continue
        ua = ua or read_user_agent()
        body = _get(URL.format(cik=cik), ua)
        json.loads(body)  # refuse to store anything that is not JSON
        path.write_bytes(body)
        print(f"fetched {ticker} {path.name} {len(body):,} bytes")
        time.sleep(MIN_INTERVAL)
    write_manifest(raw_dir)


def write_manifest(raw_dir: Path = RAW) -> None:
    manifest = {}
    for ticker, (cik, _) in COMPANIES.items():
        path = raw_path(cik, raw_dir)
        body = path.read_bytes()
        manifest[path.name] = {
            "ticker": ticker,
            "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body),
        }
    (raw_dir / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
