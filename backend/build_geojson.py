import geopandas as gpd
import pandas as pd

# 1. Load the Florida tract shapefile
tracts = gpd.read_file("geo/tl_2022_12_tract.shp")

# 2. Keep only our four counties (COUNTYFP codes)
COUNTIES = ["086", "011", "099", "087"]  # Miami-Dade, Broward, Palm Beach, Monroe
tracts = tracts[tracts["COUNTYFP"].isin(COUNTIES)]

# 3. Load the scored data
scores = pd.read_csv("acs_with_index.csv")

# Both sides need a matching key. The shapefile's GEOID is a string;
# make sure the CSV's GEOID is too.
scores["GEOID"] = scores["GEOID"].astype(str)
tracts["GEOID"] = tracts["GEOID"].astype(str)

# 4. Join scores onto geometry
merged = tracts.merge(scores, on="GEOID", how="left")

# 5. Keep only the columns the map needs (geometry + display fields)
keep = [
    "GEOID", "geometry", "county_name", "total_pop",
    "poverty_rate", "snap_rate", "no_vehicle_rate", "median_income",
    "food_desert", "need_score",
    "poverty_rate_norm", "snap_rate_norm", "no_vehicle_rate_norm",
    "median_income_norm", "food_desert_norm",
]
merged = merged[[c for c in keep if c in merged.columns]]

# 6. Reproject to WGS84 (lat/long) — what web maps expect
merged = merged.to_crs(epsg=4326)

# 7. Report and write
print(f"Geometry tracts: {len(tracts)}")
print(f"After join: {len(merged)}")
print(f"Tracts with a need_score: {merged['need_score'].notna().sum()}")
print(f"Tracts missing a score: {merged['need_score'].isna().sum()}")

merged.to_file("tracts_2022.geojson", driver="GeoJSON")
print("Saved to tracts_2022.geojson")