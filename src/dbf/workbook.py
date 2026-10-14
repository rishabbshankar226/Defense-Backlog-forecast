"""Build output/defense_backlog_model.xlsx with live formulas, in $M."""

import csv
import re
import zipfile
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

from dbf import model
from dbf.config import AS_OF, OUTPUT, PROCESSED, SOURCE_LINE, TICKERS

LABELS = [
    "Backlog (RPO)", "Revenue", "Implied bookings", "Book-to-bill", "Conversion 1Q",
    "Conversion 4Q", "H1 backlog forecast", "H1 seasonal naive", "H1 naive with drift",
    "H1 backlog APE %", "H1 seasonal naive APE %", "H1 naive with drift APE %",
    "H4 actual", "H4 backlog forecast", "H4 trailing 4Q", "H4 trailing 4Q with drift",
    "H4 backlog APE %", "H4 trailing 4Q APE %", "H4 trailing 4Q with drift APE %",
]
ROW = {label: i + 2 for i, label in enumerate(LABELS)}
BLUE = Font(color="FF0000FF")
BLACK = Font(color="FF000000")
BOLD = Font(bold=True)
FMT_USD, FMT_RATIO, FMT_PCT = "#,##0", "0.00", "0.0"
ROW_FMT = {
    **{l: FMT_USD for l in LABELS if "forecast" in l or "naive" in l or "trailing" in l or l in
       ("Backlog (RPO)", "Revenue", "Implied bookings", "H4 actual")},
    "Book-to-bill": FMT_RATIO, "Conversion 1Q": FMT_RATIO, "Conversion 4Q": FMT_RATIO,
    **{l: FMT_PCT for l in LABELS if l.endswith("APE %")},
}
H1_ROWS = {"backlog": "H1 backlog forecast", "naive": "H1 seasonal naive",
           "naive_drift": "H1 naive with drift"}
H4_ROWS = {"backlog": "H4 backlog forecast", "naive": "H4 trailing 4Q",
           "naive_drift": "H4 trailing 4Q with drift"}


def col(k: int) -> str:
    """Quarter index k (0 = START) -> its column letter; START sits in column B."""
    return get_column_letter(k + 2)


def ref(label: str, k: int) -> str:
    return f"{col(k)}{ROW[label]}"


def rng(label: str, k0: int, k1: int) -> str:
    return f"{col(k0)}{ROW[label]}:{col(k1)}{ROW[label]}"


def _put(ws, label, k, value):
    c = ws.cell(row=ROW[label], column=k + 2, value=value)
    c.font = BLACK
    c.number_format = ROW_FMT[label]


def ticker_sheet(wb, ticker, s):
    ws = wb.create_sheet(ticker)
    B, R, Q = s["B"], s["R"], s["quarters"]
    n, L = len(Q), len(Q) - 1
    ws["A1"] = "Quarter"
    ws["A1"].font = BOLD
    for k, q in enumerate(Q):
        c = ws.cell(row=1, column=k + 2, value=q)
        c.font = BOLD
        c.alignment = Alignment(horizontal="right")
    for label in LABELS:
        ws.cell(row=ROW[label], column=1, value=label)

    for k in range(n):
        for label, series in (("Backlog (RPO)", B), ("Revenue", R)):
            if series[k] is not None:
                c = ws.cell(row=ROW[label], column=k + 2, value=series[k] / 1e6)
                c.font = BLUE
                c.number_format = FMT_USD
        if k >= 1 and model.bookings(B, R, k) is not None:
            _put(ws, "Implied bookings", k,
                 f"={ref('Backlog (RPO)', k)}-{ref('Backlog (RPO)', k - 1)}+{ref('Revenue', k)}")
            _put(ws, "Book-to-bill", k, f"={ref('Implied bookings', k)}/{ref('Revenue', k)}")
        if k <= L - 1 and model.conv1(B, R, k) is not None:
            _put(ws, "Conversion 1Q", k, f"={ref('Revenue', k + 1)}/{ref('Backlog (RPO)', k)}")
        if k <= L - 4 and model.conv4(B, R, k) is not None:
            _put(ws, "Conversion 4Q", k,
                 f"=SUM({rng('Revenue', k + 1, k + 4)})/{ref('Backlog (RPO)', k)}")

    # H1: origin t, figures sit in the target column t + 1
    for t in model.origins(n, "H1"):
        j = t + 1
        formulas = {
            "backlog": f"={ref('Backlog (RPO)', t)}*AVERAGE({ref('Conversion 1Q', t - 4)},"
                       f"{ref('Conversion 1Q', t - 8)})",
            "naive": f"={ref('Revenue', t - 3)}",
            "naive_drift": f"={ref('Revenue', t - 3)}*SUM({rng('Revenue', t - 3, t)})"
                           f"/SUM({rng('Revenue', t - 7, t - 4)})",
        }
        for m, label in H1_ROWS.items():
            if model.forecast(B, R, t, "H1", m) is None or R[j] is None:
                continue
            _put(ws, label, j, formulas[m])
            _put(ws, label.replace("forecast", "APE %") if m == "backlog" else label + " APE %", j,
                 f"=ABS({ref('Revenue', j)}-{ref(label, j)})/{ref('Revenue', j)}*100")

    # H4: figures sit in the origin column t
    for t in model.origins(n, "H4"):
        if model.actual(R, t, "H4") is None:
            continue
        _put(ws, "H4 actual", t, f"=SUM({rng('Revenue', t + 1, t + 4)})")
        formulas = {
            "backlog": f"={ref('Backlog (RPO)', t)}*AVERAGE({rng('Conversion 4Q', t - 7, t - 4)})",
            "naive": f"=SUM({rng('Revenue', t - 3, t)})",
            "naive_drift": f"=SUM({rng('Revenue', t - 3, t)})^2/SUM({rng('Revenue', t - 7, t - 4)})",
        }
        for m, label in H4_ROWS.items():
            if model.forecast(B, R, t, "H4", m) is None:
                continue
            _put(ws, label, t, formulas[m])
            ape = label.replace("forecast", "APE %") if m == "backlog" else label + " APE %"
            _put(ws, ape, t, f"=ABS({ref('H4 actual', t)}-{ref(label, t)})/{ref('H4 actual', t)}*100")

    ws.freeze_panes = "B2"
    ws.column_dimensions["A"].width = 32
    for k in range(n):
        ws.column_dimensions[col(k)].width = 11
    return ws


def bridge_sheet(wb, data):
    ws = wb.create_sheet("Bridge")
    header = ["Ticker", "Year", "Revenue prior", "Revenue", "Backlog start prior", "Backlog start",
              "Conversion prior", "Conversion", "Backlog effect", "Conversion effect",
              "Interaction", "Residual"]
    ws.append(header)
    for c in ws[1]:
        c.font = BOLD
    r = 2
    for ticker in TICKERS:
        s = data[ticker]
        idx = {q: i for i, q in enumerate(s["quarters"])}
        for row in model.bridge_rows(ticker, s):
            y = row["year"]
            sh = f"{ticker}!"
            rev = lambda yr: f"SUM({sh}{rng('Revenue', idx[f'{yr}Q1'], idx[f'{yr}Q4'])})"
            ws.cell(row=r, column=1, value=ticker)
            ws.cell(row=r, column=2, value=y)
            cells = [
                f"={rev(y - 1)}", f"={rev(y)}",
                f"={sh}{ref('Backlog (RPO)', idx[f'{y - 2}Q4'])}",
                f"={sh}{ref('Backlog (RPO)', idx[f'{y - 1}Q4'])}",
                f"=C{r}/E{r}", f"=D{r}/F{r}",
                f"=(F{r}-E{r})*G{r}", f"=E{r}*(H{r}-G{r})", f"=(F{r}-E{r})*(H{r}-G{r})",
                f"=(D{r}-C{r})-(I{r}+J{r}+K{r})",
            ]
            for i, f in enumerate(cells):
                c = ws.cell(row=r, column=3 + i, value=f)
                c.font = BLACK
                c.number_format = FMT_RATIO if i in (4, 5) else FMT_USD
            r += 1
    ws.freeze_panes = "B2"
    for i, w in enumerate([8, 7, 14, 14, 18, 14, 16, 12, 15, 17, 13, 11]):
        ws.column_dimensions[get_column_letter(i + 1)].width = w


def sensitivity_sheet(wb, data):
    ws = wb.create_sheet("Sensitivity")
    ws.append(["Ticker", "Backlog shock %", "Conversion shift pp", "Forward revenue"])
    for c in ws[1]:
        c.font = BOLD
    r = 2
    for ticker in TICKERS:
        L = len(data[ticker]["quarters"]) - 1
        sh = f"{ticker}!"
        for row in model.sensitivity_rows(ticker, data[ticker]):
            ws.cell(row=r, column=1, value=ticker)
            ws.cell(row=r, column=2, value=row["backlog_shock_pct"]).number_format = FMT_PCT
            ws.cell(row=r, column=3, value=row["conversion_shift_pp"]).number_format = FMT_PCT
            c = ws.cell(row=r, column=4, value=(
                f"={sh}{ref('Backlog (RPO)', L)}*(1+B{r}/100)"
                f"*(AVERAGE({sh}{rng('Conversion 4Q', L - 7, L - 4)})+C{r}/100)"))
            c.font = BLACK
            c.number_format = FMT_USD
            r += 1
    ws.freeze_panes = "B2"
    for i, w in enumerate([8, 16, 20, 16]):
        ws.column_dimensions[get_column_letter(i + 1)].width = w


SUMMARY = [
    ("MAPE H1 backlog", "H1 backlog APE %"),
    ("MAPE H1 seasonal naive", "H1 seasonal naive APE %"),
    ("MAPE H1 naive with drift", "H1 naive with drift APE %"),
    ("MAPE H4 backlog", "H4 backlog APE %"),
    ("MAPE H4 trailing 4Q", "H4 trailing 4Q APE %"),
    ("MAPE H4 trailing 4Q with drift", "H4 trailing 4Q with drift APE %"),
]


def summary_sheet(wb, data):
    ws = wb.create_sheet("Summary")
    ws.append(["Metric", "ALL"] + TICKERS)
    for c in ws[1]:
        c.font = BOLD
    for r, (name, label) in enumerate(SUMMARY, start=2):
        ws.cell(row=r, column=1, value=name)
        ranges = {t: f"{t}!{rng(label, 0, len(data[t]['quarters']) - 1)}" for t in TICKERS}
        c = ws.cell(row=r, column=2, value=f"=AVERAGE({','.join(ranges.values())})")
        c.font, c.number_format = BLACK, FMT_PCT
        for i, t in enumerate(TICKERS):
            c = ws.cell(row=r, column=3 + i, value=f"=AVERAGE({ranges[t]})")
            c.font, c.number_format = BLACK, FMT_PCT
    ws.freeze_panes = "B2"
    ws.column_dimensions["A"].width = 32
    for i in range(len(TICKERS) + 1):
        ws.column_dimensions[get_column_letter(i + 2)].width = 10


def about_sheet(wb):
    ws = wb.active
    ws.title = "About"
    lines = [
        ("Defense backlog forecast", BOLD),
        ("Question: does backlog at quarter end forecast the next quarters' revenue better than last year's revenue does?", None),
        ("", None),
        ("Method", BOLD),
        ("1. Backlog is XBRL remaining performance obligations (RPO), first reported in each 10-Q or 10-K.", None),
        ("2. Revenue is the first-reported three-month figure; Q4 is the full year less nine months.", None),
        ("3. Backlog model: backlog times the average conversion rate seen one and two years earlier.", None),
        ("4. Baselines: same quarter last year (H1) or trailing four quarters (H4), each with and without drift.", None),
        ("5. Every forecast uses only figures known at its origin quarter; APE scores it against reported revenue.", None),
        ("", None),
        ("Colour key", BOLD),
        ("Blue figures are typed inputs from SEC filings. Black figures are formulas.", None),
        ("Dollars are in $M (USD / 1,000,000). Ratios have two decimals; percents one.", None),
        ("", None),
        (f"Source: {SOURCE_LINE}. https://data.sec.gov/api/xbrl/companyfacts/", None),
        ("Note: previewers such as Quick Look or GitHub show formula cells blank until Excel calculates them.", None),
        ("Built by Rishabb Shankar, https://rshankar.dev", None),
    ]
    for i, (text, font) in enumerate(lines, start=1):
        c = ws.cell(row=i, column=1, value=text or None)
        if font:
            c.font = font
    ws["A12"].font = Font(color="FF0000FF")
    ws.column_dimensions["A"].width = 110


def data_sheet(wb):
    ws = wb.create_sheet("Data")
    with (PROCESSED / "quarterly.csv").open() as fh:
        reader = csv.reader(fh)
        header = next(reader)
        ws.append(header)
        for row in reader:
            ws.append([int(v) if h in ("backlog_usd", "revenue_usd") and v else (v or None)
                       for h, v in zip(header, row)])
    for c in ws[1]:
        c.font = BOLD
    for r in ws.iter_rows(min_row=2):
        for c in (r[3], r[6]):
            c.number_format = FMT_USD
            c.font = BLUE
    ws.freeze_panes = "B2"
    for i, w in enumerate([8, 9, 12, 18, 22, 13, 18, 14, 50, 22, 13]):
        ws.column_dimensions[get_column_letter(i + 1)].width = w


def _freeze_timestamps(path: Path) -> None:
    """Pin document dates and zip entry times so a rebuild writes identical bytes."""
    stamp = f"{AS_OF}T00:00:00Z"
    year, month, day = (int(x) for x in AS_OF.split("-"))
    with zipfile.ZipFile(path) as z:
        entries = [(i.filename, z.read(i.filename)) for i in z.infolist()]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in entries:
            if name == "docProps/core.xml":
                body = re.sub(rb"(<dcterms:(created|modified)[^>]*>)[^<]*", lambda m: m.group(1) + stamp.encode(), body)
            info = zipfile.ZipInfo(name, date_time=(year, month, day, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, body)


def build() -> None:
    data = model.load_quarterly()
    wb = Workbook()
    about_sheet(wb)
    data_sheet(wb)
    for ticker in TICKERS:
        ticker_sheet(wb, ticker, data[ticker])
    bridge_sheet(wb, data)
    sensitivity_sheet(wb, data)
    summary_sheet(wb, data)
    wb.calculation.fullCalcOnLoad = True
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "defense_backlog_model.xlsx"
    wb.save(path)
    _freeze_timestamps(path)
    print(f"wrote {path.relative_to(OUTPUT.parent)}: {wb.sheetnames}")
