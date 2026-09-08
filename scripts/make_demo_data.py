#!/usr/bin/env python3
"""Generate a synthetic workbook so the dashboard runs without the real data.

The real extract is licensed vendor material and lives in the private `Data`
repository; it is never committed here. This produces a workbook with the same
sheet layout and the same series names, filled with random walks, so anyone can
clone this repository and see a working dashboard.

The output is NOT market data. Its filename contains "demo", which the build
script detects and the dashboard shows as a banner.

    python scripts/make_demo_data.py
    python scripts/build_data.py --workbook data/demo_bb.xlsx
"""

from __future__ import annotations

import argparse
import datetime as dt
import random
from pathlib import Path

import openpyxl

# (category, notation, ticker, field, start_level, daily_vol, floor)
TEMPLATE: list[tuple[str, str, str, str, float, float, float | None]] = []

for country, code in [("미국", "USGG"), ("한국", "GVSK"), ("유로", "GTDEM"), ("일본", "GTJPY")]:
    for tenor, level in [("3m", 3.2), ("6m", 3.3), ("1y", 3.4), ("2y", 3.6), ("3y", 3.7),
                         ("5y", 3.9), ("7y", 4.1), ("10y", 4.3), ("20y", 4.6), ("30y", 4.7)]:
        offset = {"미국": 0.9, "한국": 0.2, "유로": -0.4, "일본": -2.2}[country]
        TEMPLATE.append(("RATE", f"{country}_{tenor}", f"{code}{tenor.upper()} INDEX",
                         "PX_LAST", max(0.05, level + offset), 0.035, None))

for country in ["미국", "한국", "일본", "유로"]:
    for tenor in ["1y1y", "2y1y", "5y5y", "10y3m"]:
        TEMPLATE.append(("IRS", f"{country}_IRS_{tenor}", f"G0000 {tenor.upper()} BLC2 Curncy",
                         "PX_LAST", 3.5, 0.04, None))

for name, ticker, level, vol in [("달러원", "USDKRW CURNCY", 1350.0, 6.0),
                                 ("달러엔", "USDJPY CURNCY", 150.0, 0.8),
                                 ("유로달러", "EURUSD CURNCY", 1.08, 0.006),
                                 ("달러지수", "DXY CURNCY", 103.0, 0.45)]:
    TEMPLATE.append(("FX", name, ticker, "PX_LAST", level, vol, 0.0))

for rating, level in [("AAA", 3.9), ("AA_plus", 4.0), ("AA0", 4.1), ("AA_minus", 4.2),
                      ("A_plus", 4.6), ("A0", 4.9), ("BBB_plus", 7.5)]:
    label = rating.replace("_plus", "+").replace("_minus", "-")
    TEMPLATE.append(("CREDIT", f"한국_크레딧_일반회사채_{label}_3y", f"KCP1{rating} KCMP Index",
                     "PX_LAST", level, 0.02, 0.1))

for country, level in [("한국", 30.0), ("일본", 22.0), ("중국", 60.0), ("독일", 10.0)]:
    TEMPLATE.append(("Credit", f"{country}_CDS_5년물", f"{country} CDS USD SR 5Y D14 Curncy",
                     "PX_LAST", level, 0.9, 1.0))

for name, ticker, level, vol, field in [
    ("미국_S&P500_PR", "SPX INDEX", 5200.0, 48.0, "PX_LAST"),
    ("한국_KOSPI_PR", "KOSPI INDEX", 2700.0, 26.0, "PX_LAST"),
    ("미국_S&P500_TR", "SPX INDEX", 11000.0, 100.0, "TOT_RETURN_INDEX_GROSS_DVDS"),
    ("미국_변동성지수_VIX", "VIX INDEX", 16.0, 1.1, "PX_LAST"),
]:
    TEMPLATE.append(("Equity", name, ticker, field, level, vol, 0.5))

TEMPLATE.append(("Commodity", "WTI유가", "CL1 COMDTY", "PX_LAST", 78.0, 1.5, 1.0))
TEMPLATE.append(("Inflation", "미국_BEI_10y", "USGGBE10 Index", "PX_LAST", 2.3, 0.015, 0.0))
TEMPLATE.append(("Macro", "미국_실업률", "USURTOT index", "PX_LAST", 4.0, 0.0, 0.0))
TEMPLATE.append(("Macro", "한국_core_CPI_yoy", "SKCIYOY index", "PX_LAST", 2.2, 0.0, 0.0))


def business_days(start: dt.date, end: dt.date) -> list[dt.date]:
    days, cursor = [], start
    while cursor <= end:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor += dt.timedelta(days=1)
    return days


def main(argv: list[str] | None = None) -> int:
    repo = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=repo / "data/demo_bb.xlsx")
    parser.add_argument("--years", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260908)
    args = parser.parse_args(argv)

    rng = random.Random(args.seed)
    end = dt.date.today()
    days = business_days(end - dt.timedelta(days=365 * args.years), end)

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "D"

    sheet.cell(row=3, column=1, value="Start Date")
    sheet.cell(row=3, column=2, value=dt.datetime.combine(days[0], dt.time()))
    sheet.cell(row=4, column=1, value="End Date")
    sheet.cell(row=4, column=2, value=dt.datetime.combine(days[-1], dt.time()))
    sheet.cell(row=6, column=1, value="카테고리")
    sheet.cell(row=7, column=1, value="Notation")
    sheet.cell(row=8, column=1, value="Dates")
    sheet.cell(row=9, column=1, value="Dates")

    for offset, (category, notation, ticker, field, *_rest) in enumerate(TEMPLATE):
        column = 2 + offset
        sheet.cell(row=6, column=column, value=category)
        sheet.cell(row=7, column=column, value=notation)
        sheet.cell(row=8, column=column, value=ticker)
        sheet.cell(row=9, column=column, value=field)

    # Row 10 reproduces the real workbook's undateable row, so the build script's
    # handling of it is exercised by the demo too.
    sheet.cell(row=10, column=1, value="#NAME?")
    for offset in range(len(TEMPLATE)):
        sheet.cell(row=10, column=2 + offset, value="#NAME?")

    for offset, (category, _notation, _ticker, _field, level, vol, floor) in enumerate(TEMPLATE):
        column = 2 + offset
        value = level
        # A late start for one series, so coverage statistics have something to show.
        starts_at = len(days) // 3 if offset % 17 == 5 else 0
        # Macro series only move on a monthly-ish cadence, like the real ones.
        stepped = category == "Macro"
        for index, day in enumerate(days):
            row = ROW_FIRST_DATA + index
            if index < starts_at or rng.random() < 0.004:
                sheet.cell(row=row, column=column, value="#N/A N/A")
                continue
            if stepped:
                if index % 21 == 0:
                    value = max(0.0, value + rng.gauss(0, 0.08))
            else:
                value += rng.gauss(0, vol) + (level - value) * 0.002  # mild mean reversion
                if floor is not None:
                    value = max(floor, value)
            sheet.cell(row=row, column=column, value=round(value, 4))

    for index, day in enumerate(days):
        sheet.cell(row=ROW_FIRST_DATA + index, column=1, value=dt.datetime.combine(day, dt.time()))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(args.out)
    print(f"wrote {args.out}: {len(TEMPLATE)} synthetic series x {len(days)} business days "
          f"({days[0]} .. {days[-1]})")
    print("This is randomly generated data, not market data.")
    return 0


ROW_FIRST_DATA = 11

if __name__ == "__main__":
    raise SystemExit(main())
