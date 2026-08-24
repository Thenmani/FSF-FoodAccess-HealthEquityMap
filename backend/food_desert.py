"""USDA food-desert (LILA) flags per 2020 census tract.

RUNTIME loads the committed `food_desert_flags.json` (GEOID → 0/1). The raw USDA
Excel + tract crosswalk live under `geo/`, which is gitignored and NOT present on
Render — so the flag map is generated offline and committed. Regenerate with:

    python food_desert.py --build            # rebuild food_desert_flags.json from geo/
    python food_desert.py --sink=db           # push flags into ACSRecord.food_desert (Supabase)

The LILA flag is a static per-tract attribute, so every ACS year/batch shares it.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache

FLAGS_PATH = os.path.join(os.path.dirname(__file__), "food_desert_flags.json")

# Only these Florida counties are in scope (FIPS prefixes).
IN_SCOPE_FIPS = {"12086", "12011", "12099", "12087"}


@lru_cache(maxsize=1)
def load_flags() -> dict[str, int]:
    """GEOID (11-digit str) → 0/1. Empty dict (never raises) if the file is
    missing, so a fetch degrades gracefully instead of 500-ing."""
    try:
        with open(FLAGS_PATH) as f:
            raw = json.load(f)
        return {str(k).zfill(11): int(v) for k, v in raw.items()}
    except (FileNotFoundError, ValueError):
        return {}


def flag_for(geoid: str, default: int = 0) -> int:
    return load_flags().get(str(geoid).zfill(11), default)


# ── Offline build / DB sink (needs geo/ assets, run locally only) ──────────────
def build_flag_map() -> dict[str, int]:
    """Rebuild the flag map from the USDA Excel + Census 2020↔2010 crosswalk.
    Picks the 2010 source tract contributing the most land to each 2020 tract."""
    import pandas as pd

    geo = os.path.join(os.path.dirname(__file__), "geo")
    usda = pd.read_excel(
        os.path.join(geo, "FoodAccessResearchAtlasData2019.xlsx"),
        sheet_name="Food Access Research Atlas",
        usecols=["CensusTract", "LILATracts_1And10"],
    )
    usda["GEOID_2010"] = usda["CensusTract"].astype(str).str.zfill(11)
    usda = usda.rename(columns={"LILATracts_1And10": "food_desert"})[["GEOID_2010", "food_desert"]]

    xw = pd.read_csv(os.path.join(geo, "tab20_tract20_tract10_st12.txt"), sep="|", dtype=str)
    xw = xw[["GEOID_TRACT_20", "GEOID_TRACT_10", "AREALAND_PART"]].copy()
    xw["AREALAND_PART"] = pd.to_numeric(xw["AREALAND_PART"], errors="coerce").fillna(0)
    xw = xw.sort_values("AREALAND_PART", ascending=False)
    dominant = xw.drop_duplicates(subset="GEOID_TRACT_20", keep="first")

    dominant = dominant.merge(usda, left_on="GEOID_TRACT_10", right_on="GEOID_2010", how="left")
    fb = dominant[["GEOID_TRACT_20", "food_desert"]].dropna()
    flags = {
        str(r.GEOID_TRACT_20).zfill(11): int(r.food_desert)
        for r in fb.itertuples()
        if str(r.GEOID_TRACT_20)[:5] in IN_SCOPE_FIPS
    }
    return flags


def _write_flags(flags: dict[str, int]) -> None:
    with open(FLAGS_PATH, "w") as f:
        json.dump(flags, f)
    n = sum(1 for v in flags.values() if v == 1)
    print(f"Wrote {len(flags)} flags ({n} food deserts) → {FLAGS_PATH}")


def _sink_db(flags: dict[str, int]) -> None:
    """Push flags into ACSRecord.food_desert across all batches (Supabase)."""
    from sqlalchemy import text, bindparam
    from database import engine

    desert_ids = [g for g, v in flags.items() if v == 1]
    with engine.begin() as conn:
        conn.execute(text("UPDATE acs_records SET food_desert = 0"))
        if desert_ids:
            stmt = text("UPDATE acs_records SET food_desert = 1 WHERE tract_id IN :ids") \
                .bindparams(bindparam("ids", expanding=True))
            for i in range(0, len(desert_ids), 1000):
                conn.execute(stmt, {"ids": desert_ids[i:i + 1000]})
    print(f"Flagged {len(desert_ids)} tracts in acs_records.")


if __name__ == "__main__":
    import sys

    args = sys.argv[1:]
    if "--build" in args:
        _write_flags(build_flag_map())
    if any(a == "--sink=db" for a in args):
        _sink_db(load_flags.__wrapped__())  # bypass cache
