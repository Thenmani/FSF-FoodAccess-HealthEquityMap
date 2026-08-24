"""Single source of truth for the app's two scores + shared lookups.

Everything that computes a need score, an FSF impact score, normalizes a county
name, or needs the ZIP→population table imports it from here so the map, the
trend chart, and the stored DB values can never drift apart.
"""
from __future__ import annotations

import pandas as pd

# ── ZIP → population (2020 ACS approx) ─────────────────────────────────────────
# Used only to turn "individuals served" into a population-reach fraction.
ZIP_POPULATION: dict[str, int] = {
    "33054": 28000, "33055": 32000, "33056": 34000, "33127": 19000, "33128": 15000,
    "33130": 21000, "33132": 14000, "33135": 24000, "33136": 18000, "33142": 27000,
    "33147": 31000, "33150": 22000, "33161": 29000, "33162": 31000, "33169": 38000,
    "33125": 22000, "33126": 31000, "33133": 18000, "33134": 20000, "33138": 19000,
    "33149": 12000, "33155": 29000, "33165": 33000, "33166": 28000, "33174": 26000,
    "33175": 35000, "33177": 38000, "33178": 41000, "33179": 32000, "33180": 28000,
    "33311": 35000, "33312": 42000, "33313": 39000, "33314": 28000, "33315": 18000,
    "33316": 12000, "33317": 44000, "33319": 37000, "33322": 46000, "33324": 41000,
    "33325": 38000, "33328": 43000, "33060": 38000, "33062": 29000, "33063": 44000,
    "33064": 36000, "33065": 42000, "33068": 38000, "33069": 31000, "33071": 40000,
    "33073": 35000, "33076": 28000, "33309": 32000, "33334": 29000, "33351": 36000,
    "33388": 18000, "33441": 31000, "33442": 28000, "33444": 22000, "33445": 24000,
    "33409": 28000, "33430": 18000, "33435": 24000, "33460": 21000, "33461": 32000,
    "33462": 27000, "33463": 35000, "33467": 41000, "33472": 29000, "33484": 31000,
    "33401": 28000, "33403": 18000, "33404": 22000, "33405": 19000, "33406": 31000,
    "33407": 24000, "33408": 21000, "33410": 38000, "33411": 42000, "33412": 19000,
    "33413": 36000, "33414": 31000, "33415": 38000, "33417": 29000, "33418": 44000,
    "33426": 24000, "33428": 31000, "33431": 28000, "33432": 32000, "33433": 36000,
    "33040": 24000, "33050": 11000, "33001": 8000, "33036": 9000, "33037": 14000,
    "33042": 7000, "33043": 6000, "33044": 5000, "33045": 4000, "33051": 6000,
    "33070": 6000,
}
DEFAULT_ZIP_POP = 25000


def zip_population(zip_code: str) -> int:
    return ZIP_POPULATION.get(normalize_zip(zip_code), DEFAULT_ZIP_POP)


def normalize_zip(zip_code) -> str:
    """Coerce whatever pandas/JSON handed us into a 5-digit ZIP string.

    Handles floats read from CSV (33054.0), ints, and short/blank values.
    """
    s = str(zip_code).strip()
    if s.endswith(".0"):          # pandas read the column as float
        s = s[:-2]
    return s.zfill(5)[:5]


# ── County normalization (canonical Title Case) ────────────────────────────────
# One definition, includes Monroe. FIPS county prefix → canonical name.
COUNTY_BY_FIPS: dict[str, str] = {
    "12086": "Miami-Dade",
    "12011": "Broward",
    "12099": "Palm Beach",
    "12087": "Monroe",
}


def normalize_county(name: str | None) -> str:
    """Fuzzy county-name → canonical Title Case, or "" if unrecognized."""
    if not name:
        return ""
    n = str(name).lower().strip()
    if "miami" in n or "dade" in n:
        return "Miami-Dade"
    if "broward" in n:
        return "Broward"
    if "palm" in n:
        return "Palm Beach"
    if "monroe" in n:
        return "Monroe"
    return ""


def county_from_geoid(geoid: str) -> str:
    """11-digit tract GEOID → canonical county name (via 5-char FIPS prefix)."""
    return COUNTY_BY_FIPS.get(str(geoid)[:5], "")


# ── FSF impact score (0-100) ───────────────────────────────────────────────────
# Population reach (60%): benchmark = 5% of population served per period → 60.
# Meals per capita (40%): benchmark = 5 meals/person/period            → 40.
IMPACT_REACH_BENCHMARK = 0.05
IMPACT_MEALS_BENCHMARK = 5.0


def impact_score(individuals_served: float, meals_served: float, population: float) -> float:
    """The one FSF impact-score formula. Callers pass already-aggregated inputs
    (either a single ZIP row or a county rollup)."""
    pop = max(float(population or 0), 1.0)
    ind = float(individuals_served or 0)
    meals = float(meals_served or 0)
    pop_pct = min((ind / pop) / IMPACT_REACH_BENCHMARK, 1.0) * 60
    meals_sc = min((meals / max(ind, 1.0)) / IMPACT_MEALS_BENCHMARK, 1.0) * 40
    return round(pop_pct + meals_sc, 1)


# ── ACS need score (0-100, percentile-rank / CDC SVI method) ───────────────────
# indicator column → (weight, invert, binary). invert=True means high value =
# less need. binary=True means the value is already a 0/1 flag (food_desert) and
# is used directly as its own normalized term rather than being percentile-ranked.
#
# Weights match the frontend DEFAULT_WEIGHTS so the stored baseline need_score
# agrees with the map's default view. food_desert IS included here (20%) — a
# tract's low-income/low-access status is part of its need, not just a display flag.
NEED_INDICATORS: dict[str, dict] = {
    "pct_below_poverty":       {"weight": 0.25, "invert": False, "binary": False},
    "pct_snap_enrollment":     {"weight": 0.15, "invert": False, "binary": False},
    "food_desert":             {"weight": 0.18, "invert": False, "binary": True},
    "pct_no_vehicle":          {"weight": 0.12, "invert": False, "binary": False},
    "median_income":           {"weight": 0.10, "invert": True,  "binary": False},
    "unemployment_rate":       {"weight": 0.10, "invert": False, "binary": False},
    "housing_cost_burden_pct": {"weight": 0.10, "invert": False, "binary": False},
}
MIN_INDICATORS_PRESENT = 3

# Institutional tracts (9800-9999: parks, airports, water, prisons) and very
# low population tracts produce unstable rates and aren't siting candidates.
INSTITUTIONAL_TRACT_MIN = 980000
MIN_TRACT_POP = 100


def eligible_tract_mask(df: pd.DataFrame, *, tract_col: str = "tract_id",
                        pop_col: str = "population") -> pd.Series:
    """Boolean mask of tracts that should participate in need scoring."""
    tract_code = df[tract_col].astype(str).str[-6:]
    code_num = pd.to_numeric(tract_code, errors="coerce")
    pop = pd.to_numeric(df[pop_col], errors="coerce")
    return (code_num < INSTITUTIONAL_TRACT_MIN) & (pop >= MIN_TRACT_POP)


def compute_need_scores(df: pd.DataFrame, *, tract_col: str = "tract_id",
                        pop_col: str = "population") -> pd.Series:
    """Return a need_score Series (0-100, NaN where untrustworthy/ineligible),
    aligned to df's index. Percentile-ranks each indicator over the ELIGIBLE
    tracts only, so institutional/low-pop tracts don't skew the distribution.
    """
    eligible = eligible_tract_mask(df, tract_col=tract_col, pop_col=pop_col)
    sub = df[eligible]

    norm = pd.DataFrame(index=sub.index)
    for col, cfg in NEED_INDICATORS.items():
        if col not in sub.columns:
            continue
        vals = pd.to_numeric(sub[col], errors="coerce")
        if cfg["binary"]:
            # Already a 0/1 flag — use directly as its normalized term.
            norm[col] = vals.clip(0, 1)
        else:
            ascending = not cfg["invert"]  # invert -> rank descending (low income = high need)
            norm[col] = vals.rank(pct=True, ascending=ascending)

    weights = pd.Series({c: NEED_INDICATORS[c]["weight"] for c in norm.columns})
    weighted = norm.mul(weights, axis=1).sum(axis=1)
    present_weight = norm.notna().mul(weights, axis=1).sum(axis=1)
    present_count = norm.notna().sum(axis=1)

    score = (weighted / present_weight) * 100
    score[present_count < MIN_INDICATORS_PRESENT] = pd.NA

    # Reindex to the full frame; ineligible tracts get NaN.
    return score.reindex(df.index)
