"""
Geocodes agencies.csv using the Census Geocoder (free, no key).
Output: frontend/public/agencies.geojson
"""

import csv
import json
import time
import requests
from pathlib import Path

INPUT = Path(__file__).parent.parent / "frontend/public/agencies.csv"
OUTPUT = Path(__file__).parent.parent / "frontend/public/agencies.geojson"

GEOCODE_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


def geocode(address: str) -> tuple[float, float] | None:
    try:
        r = requests.get(
            GEOCODE_URL,
            params={"address": address, "benchmark": "Public_AR_Current", "format": "json"},
            timeout=10,
        )
        r.raise_for_status()
        matches = r.json()["result"]["addressMatches"]
        if matches:
            c = matches[0]["coordinates"]
            return c["y"], c["x"]  # lat, lng
    except Exception as e:
        print(f"  Error: {e}")
    return None


def main():
    features = []
    failed = []

    with open(INPUT, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"Geocoding {len(rows)} agencies...")

    for i, row in enumerate(rows):
        name = row["Agency Name"].strip()
        address = row["Address"].strip()
        agency_type = row["Type"].strip()

        print(f"[{i+1}/{len(rows)}] {name}")
        result = geocode(address)

        if result:
            lat, lng = result
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lng, lat]},
                "properties": {
                    "name": name,
                    "address": address,
                    "type": agency_type,
                },
            })
        else:
            print(f"  FAILED: {address}")
            failed.append({"name": name, "address": address})

        time.sleep(0.3)  # be polite to the Census API

    geojson = {"type": "FeatureCollection", "features": features}
    OUTPUT.write_text(json.dumps(geojson, indent=2))
    print(f"\nWrote {len(features)} features to {OUTPUT}")

    if failed:
        print(f"\nFailed to geocode {len(failed)} agencies:")
        for f in failed:
            print(f"  - {f['name']}: {f['address']}")


if __name__ == "__main__":
    main()
