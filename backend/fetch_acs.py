import os
import requests
import pandas as pd
from dotenv import load_dotenv

load_dotenv()  # reads backend/.env
API_KEY = os.getenv("CENSUS_API_KEY")

# ACS 5-year detailed tables, 2022 (latest reliable tract-level release)
YEAR = 2022
BASE_URL = f"https://api.census.gov/data/{YEAR}/acs/acs5"

STATE = "12"  # Florida
COUNTIES = {
    "086": "Miami-Dade",
    "011": "Broward",
    "099": "Palm Beach",
    "087": "Monroe",
}

# The 10 "30 percent or more" lines of B25106 (5 owner + 5 renter income
# brackets) — households spending 30%+ of income on housing. Summed for the
# cost-burden rate. Denominator is B25106_001E (all households).
HOUSING_BURDEN_CODES = [
    "B25106_006E", "B25106_010E", "B25106_014E", "B25106_018E", "B25106_022E",  # owner
    "B25106_028E", "B25106_032E", "B25106_036E", "B25106_040E", "B25106_044E",  # renter
]

# Raw ACS variable codes -> readable names
VARIABLES = {
    "B17001_002E": "poverty_below",     # income below poverty level
    "B17001_001E": "poverty_total",     # total pop assessed for poverty
    "B19013_001E": "median_income",     # median household income
    "B22010_002E": "snap_yes",          # households receiving SNAP
    "B22010_001E": "snap_total",        # total households
    "B25044_003E": "owner_no_veh",      # owner-occ households, no vehicle
    "B25044_010E": "renter_no_veh",     # renter-occ households, no vehicle
    "B25044_001E": "veh_total",         # total occupied households
    "B01003_001E": "total_pop",         # total population
    "B23025_003E": "labor_force",       # civilian labor force
    "B23025_005E": "unemployed",        # unemployed (civilian labor force)
    "B25106_001E": "housing_total",     # all households (cost-burden denominator)
    **{code: f"hb_{i}" for i, code in enumerate(HOUSING_BURDEN_CODES)},
}

def fetch_county(county_fips):
    params = {
        "get": "NAME," + ",".join(VARIABLES.keys()),
        "for": "tract:*",
        "in": f"state:{STATE} county:{county_fips}",
        "key": API_KEY,
    }
    resp = requests.get(BASE_URL, params=params)
    resp.raise_for_status()
    rows = resp.json()
    return pd.DataFrame(rows[1:], columns=rows[0])

def main():
    if not API_KEY:
        raise SystemExit("No CENSUS_API_KEY found — check backend/.env")

    frames = [fetch_county(fips) for fips in COUNTIES]
    df = pd.concat(frames, ignore_index=True)

    df = df.rename(columns=VARIABLES)

    # Convert all indicator columns from strings to numbers
    for col in VARIABLES.values():
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # ACS uses large negative codes (e.g. -666666666) as "missing / not estimable"
    # sentinels. Treat any negative value as missing so it doesn't corrupt the data.
    import numpy as np
    for col in VARIABLES.values():
        df.loc[df[col] < 0, col] = np.nan
        
    # Stable tract GEOID = state + county + tract
    df["GEOID"] = df["state"] + df["county"] + df["tract"]

    # Add a readable county name from the FIPS code
    df["county_name"] = df["county"].map(COUNTIES)

    # --- Convert raw counts into rates (percentages) ---
    # Guard against divide-by-zero by leaving NaN where the denominator is 0
    df["poverty_rate"] = df["poverty_below"] / df["poverty_total"] * 100
    df["snap_rate"] = df["snap_yes"] / df["snap_total"] * 100
    df["no_vehicle_rate"] = (
        (df["owner_no_veh"] + df["renter_no_veh"]) / df["veh_total"] * 100
    )

    # Keep the columns we actually care about downstream
    keep = [
        "GEOID", "NAME", "county_name", "total_pop",
        "poverty_rate", "median_income", "snap_rate", "no_vehicle_rate",
    ]
    out = df[keep]

    out.to_csv("acs_raw.csv", index=False)

    print(f"Pulled {len(out)} tracts across {len(COUNTIES)} counties")
    print(out[["county_name", "poverty_rate", "snap_rate", "no_vehicle_rate", "median_income"]].describe().round(1))
    print("\nSaved to acs_raw.csv")
    print("\nSample rows:")
    print(out.head())

def fetch_acs_data(year: int, api_key: str) -> pd.DataFrame:
    """Entry point called by main.py — supports dynamic year and api_key."""
    import numpy as np

    base_url = f"https://api.census.gov/data/{year}/acs/acs5"
    frames = []
    for fips, county_name in COUNTIES.items():
        params = {
            "get": "NAME," + ",".join(VARIABLES.keys()),
            "for": "tract:*",
            "in": f"state:{STATE} county:{fips}",
            "key": api_key,
        }
        resp = requests.get(base_url, params=params)
        resp.raise_for_status()
        rows = resp.json()
        frame = pd.DataFrame(rows[1:], columns=rows[0])
        frame["county_label"] = county_name
        frames.append(frame)

    df = pd.concat(frames, ignore_index=True)
    df = df.rename(columns=VARIABLES)

    for col in VARIABLES.values():
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df.loc[df[col] < 0, col] = np.nan

    df["tract_id"]          = df["state"] + df["county"] + df["tract"]
    df["pct_below_poverty"] = df["poverty_below"] / df["poverty_total"] * 100
    df["pct_snap_enrollment"] = df["snap_yes"] / df["snap_total"] * 100
    df["pct_no_vehicle"]    = (df["owner_no_veh"] + df["renter_no_veh"]) / df["veh_total"] * 100
    df["unemployment_rate"] = df["unemployed"] / df["labor_force"] * 100
    hb_cols = [f"hb_{i}" for i in range(len(HOUSING_BURDEN_CODES))]
    df["housing_cost_burden_pct"] = df[hb_cols].sum(axis=1) / df["housing_total"] * 100

    # Divide-by-zero (empty tracts) → inf; treat as missing.
    for col in ["pct_below_poverty", "pct_snap_enrollment", "pct_no_vehicle",
                "unemployment_rate", "housing_cost_burden_pct"]:
        df.loc[~np.isfinite(df[col]), col] = np.nan

    # Columns expected downstream that ACS5 doesn't supply — default to 0.
    # NOTE: need_score is intentionally NOT set here — it is computed by
    # scoring.compute_need_scores() in main.py after the food_desert flag is
    # attached, so the stored score is real (not a placeholder 0).
    for col in ["pct_low_income", "pct_children_under18", "pct_seniors_65plus"]:
        df[col] = 0.0

    return df[[
        "tract_id", "county_label", "total_pop", "median_income",
        "pct_below_poverty", "pct_snap_enrollment", "pct_no_vehicle",
        "pct_low_income", "pct_children_under18",
        "pct_seniors_65plus", "unemployment_rate", "housing_cost_burden_pct",
    ]].rename(columns={"county_label": "county", "total_pop": "population"})


if __name__ == "__main__":
    main()