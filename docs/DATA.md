# Data contract

`scripts/build_data.py` writes the files below into `data/`. The dashboard reads
only these — it never touches the workbook directly.

Everything under `data/` is git-ignored. See the repository README for why.

## `data/index.json`

Loaded on startup (~260 KB for the full 254-series dataset). Carries everything
the overview and quality tabs need, so neither waits on the value files.

```jsonc
{
  "generated": "2026-09-08T07:30:00+00:00",
  "source": "data_bb.xlsx",
  "demo": false,                    // true when built from a synthetic workbook
  "dates": ["2001-12-03", ...],     // the shared date axis, ascending
  "categories": [
    { "key": "Rate", "label": "금리", "count": 86 }
  ],
  "series": [
    {
      "id": "미국_10y",              // unique; rating notches spelled out (AA_plus)
      "cat": "Rate",
      "notation": "미국_10y",
      "ticker": "USGG10YR INDEX",
      "field": "PX_LAST",
      "unit": "%",                  // % | bp | pt | idx | k | bn | ""
      "curve": { "country": "미국", "tenor": 10.0 },   // null unless a curve point
      "dupeOf": null,               // id of an identical earlier series, else null
      "summary": {
        "n": 6432,                  // populated observations
        "last": 0.0,                // illustrative only - see the note below
        "lastDate": "2026-07-28",
        "first": 0.0,
        "firstDate": "2001-12-03",
        "min": 0.0,
        "max": 0.0,
        "mode": "bp",               // how `changes` is expressed: bp | pct
        "changes": { "1d": 0.0, "1w": 0.0, "1m": 0.0,
                     "3m": 0.0, "ytd": 0.0, "1y": 0.0 },
        "spark": [0.0, 0.0, ...]    // 48 samples of roughly the last year
      }
    }
  ],
  "totals": {
    "series": 254, "dates": 6432, "observations": 1463722,
    "empty": ["미국_CDS_5년물"]
  },
  "diagnostics": {
    "staleTail": {
      "suspect": true,
      "lastDate": "2026-07-28", "previousDate": "2026-07-27",
      "identicalRate": 0.83, "baselineRate": 0.2174
    },
    "duplicates": [ { "id": "미국_국채_10년_일드", "of": "미국_10y" } ]
  }
}
```

### Index positions are shared

`summary` indices and every array in `data/series/` line up with `dates` by
position. A series that starts late is padded with leading `null`s rather than
being given a shorter array, so `values[i]` always corresponds to `dates[i]`.

## `data/series/<Category>.json`

Fetched the first time a series in that category is charted.

```jsonc
{ "미국_10y": [0.0, 0.0, null, ...] }   // one entry per date, null = missing
```

Numeric values above are placeholders. This repository is public and the source
workbook is licensed vendor material, so no real observation appears in it —
including in documentation. Build locally to see actual values.

Values are rounded to 6 decimal places. Missing observations are `null` — the
chart breaks the line rather than interpolating across the gap.

## Conventions worth knowing

**Changes are basis points or percent, never both.** `mode` is `"bp"` when the
series is itself a rate or spread (`unit` of `%` or `bp`) and `"pct"` otherwise.
The percent change of a percentage yield is not a meaningful quantity, so it is
never computed.

**Change windows are calendar-based, not row-based.** `1m` means "the last
observation on or before the same day one month ago", not "21 rows back". A
series with gaps therefore still reports an honest one-month change.

**`Macro` series are step-held.** They carry a value every business day but only
change on release. Daily statistics computed on them are not meaningful; the
dashboard tags them `발표시 갱신` in the overview.

**Duplicate series are kept, not dropped.** The vendor workbook repeats three
series exactly; `dupeOf` points at the first occurrence so the UI can mark them
instead of drawing the same line twice under two names.

## Rebuilding

```bash
python scripts/build_data.py --workbook ../Data/data/raw/data_bb.xlsx
```

The script prints a warning when it detects a stale final row or a series with
no observations. Both are surfaced in the dashboard as banners.
