"""python -m dbf <stage> --as-of <date>"""

import argparse

from dbf.config import AS_OF

STAGES = ["data", "model", "workbook", "charts", "report", "site"]


def main() -> None:
    p = argparse.ArgumentParser(prog="dbf")
    p.add_argument("stage", choices=STAGES)
    p.add_argument("--as-of", required=True)
    args = p.parse_args()
    if args.as_of != AS_OF:
        raise SystemExit(f"--as-of must be {AS_OF}, the preregistered date")

    if args.stage == "data":
        from dbf import extract, sec
        sec.fetch_all()
        extract.write_quarterly(args.as_of)
    elif args.stage == "model":
        from dbf import model
        model.run()
    elif args.stage == "workbook":
        from dbf import workbook
        workbook.build()
    elif args.stage == "charts":
        from dbf import charts
        charts.build()
    elif args.stage == "report":
        from dbf import report
        report.build()
    elif args.stage == "site":
        from dbf import site_data
        site_data.build()


if __name__ == "__main__":
    main()
