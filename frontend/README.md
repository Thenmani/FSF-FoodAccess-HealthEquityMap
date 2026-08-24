# Feeding South Florida — Health Equity Intelligence Platform

A full-stack web application that provides data-driven food access intelligence for Feeding South Florida (FSF), enabling program managers to visualize community need, track food distribution accomplishments, and identify coverage gaps across three South Florida counties.

---
# Contributors — Health Equity Intelligence Platform
1. Nathalie
2. Thenmani

---

## Overview

The FSF Intelligence Platform helps program managers answer two critical questions:

1. **Where is food insecurity highest?** — via the Need Score heat map powered by US Census ACS data
2. **Where is FSF already serving?** — via the Impact Score heat map powered by FSF's own distribution data

Together, these two layers reveal coverage gaps — high-need areas where FSF has low impact scores — enabling data-driven resource allocation decisions.

---

## Platform Tools

| Tool | Status | Description |
|---|---|---|
| **Health Equity Intelligence** | ✅ Active | Interactive heat map with need score + impact score layers |
| **Catering Menu Intelligence** 
| **Dynamic Pricing Engine** 

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, React Router, Vite |
| Map Engine | MapLibre GL JS (open-source, no API key required) |
| Base Map Tiles | OpenStreetMap (free, no usage limits) |
| Charts | Chart.js 4.4 |
| Backend | FastAPI (Python) |
| Database | SQLite via SQLAlchemy |
| CSV Processing | Pandas |
| Server | Uvicorn |
| Census Data | US Census Bureau ACS API |
---

## Project Structure

```
FSF-food-access-mgmt/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx              # Landing page with 3 tool tiles
│   │   │   ├── HealthMap.jsx         # Interactive heat map (main feature)
│   │   │   └── TrendChart.jsx        # Year-over-year trend chart modal
│   │   ├── App.jsx                   # React Router setup
│   │   └── main.jsx                  # React entry point
│   ├── public/
│   │   └── tracts_2022.geojson       # Census tract boundary polygons
│   └── package.json
│
├── backend/
│   ├── main.py                       # FastAPI routes and business logic
│   ├── database.py                   # SQLAlchemy models and DB config
│   ├── fetch_acs.py                  # Census API data fetcher
│   ├── fsf_data.db                   # SQLite database (auto-created)
│   ├── .env                          # API keys (not committed to git)
│   └── venv/                         # Python virtual environment
│
└── data/
    ├── fsf_distribution_2021.csv     # FSF synthetic distribution data
    ├── fsf_distribution_2022.csv
    ├── fsf_distribution_2023.csv
    ├── fsf_distribution_2024.csv
    └── fsf_distribution_2025.csv
```

---

## Requirements

### System
- Node.js v18 or higher
- Python 3.9 or higher
- npm 8 or higher

### Backend Python Dependencies
```
fastapi
uvicorn
sqlalchemy
pandas
python-multipart
python-dotenv
requests
numpy
```

### Frontend Dependencies
```
react
react-dom
react-router-dom
maplibre-gl
vite
```

## API Endpoints

### ACS Need Score
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/acs/fetch?acs_year=2024` | Fetch ACS data from Census Bureau API |
| `GET` | `/api/acs/fetch-status?acs_year=2024` | Poll fetch progress |
| `GET` | `/api/acs/tracts?acs_year=2024` | Get tract data for map |
| `GET` | `/api/acs/available-years` | List loaded ACS years |
| `GET` | `/api/acs/upload-history` | ACS batch history |
| `DELETE` | `/api/acs/upload-history/{id}` | Delete an ACS batch |

### FSF Impact Score
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/fsf/upload?dist_year=2024` | Upload FSF distribution CSV |
| `GET` | `/api/fsf/distributions?dist_year=2024` | Get distributions for map |
| `GET` | `/api/fsf/available-years` | List uploaded FSF years |
| `GET` | `/api/fsf/upload-history` | FSF batch history |
| `DELETE` | `/api/fsf/upload-history/{id}` | Delete an FSF batch |
| `PATCH` | `/api/fsf/upload-history/{id}/activate` | Set a batch as active |

---

## Feature 1 — Need Score Heat Map

### What it shows
Community food insecurity levels across census tracts in Miami-Dade, Broward, and Palm Beach counties, derived from US Census Bureau demographic data.

### How it works
1. User selects an ACS year from the dropdown (2021–2024)
2. Backend triggers `fetch_acs.py` to pull data from Census Bureau API
3. Data is stored in SQLite tagged by year — subsequent loads use cached data
4. Frontend joins Census tract data with GeoJSON boundaries by `GEOID`
5. Each tract is colored based on its Need Score

### ACS Year Selector
| Release | Covers | Available |
|---|---|---|
| ACS 5-Year 2024 | 2020–2024 | ✅ Latest (Jan 2026) |
| ACS 5-Year 2023 | 2019–2023 | ✅ Yes |
| ACS 5-Year 2022 | 2018–2022 | ✅ Yes |
| ACS 5-Year 2021 | 2017–2021 | ✅ Yes |

### Tract Detail Sidebar
Clicking any tract shows:
- Need score (0–100)
- Population
- Poverty rate vs national average
- SNAP enrollment rate
- No vehicle rate
- Unemployment rate
- Housing cost burden
- Food desert status (USDA 2019)
- Distance to nearest supermarket
- Median household income

---

## Feature 2 — Impact Score Heat Map with Year-over-Year Trend Chart

### What it shows
FSF's food distribution coverage relative to population need, by county, for each year data is uploaded.

### How it works
1. User selects Impact score layer
2. FSF Year dropdown shows only years with uploaded data (empty by default)
3. User uploads a distribution CSV for a specific year
4. Backend calculates county-level impact scores
5. Map recolors to show distribution coverage
6. Selecting a different year from the dropdown instantly switches the map view

### Required CSV Columns
| Column | Type | Description |
|---|---|---|
| `zip_code` | String | 5-digit ZIP where food was distributed |
| `county` | String | Miami-Dade, Broward, or Palm Beach |
| `households_served` | Integer | Households served per ZIP per month |
| `individuals_served` | Integer | Individuals served per ZIP per month |
| `meals_served` | Integer | Total meals served per ZIP per month |
| `month` | String | Optional — month name for breakdown |

### Upload History
- All uploaded files shown in a table with year, rows, and status
- Select multiple files with checkboxes and delete with a single button
- Uploading a new CSV for the same year replaces the existing data

---

## Need Score Calculation

The Need Score is a composite index (0–100) calculated from ACS 5-year census data.

### Formula

```
Need Score = (poverty_rate    × 30)
           + (snap_rate       × 20)
           + (no_vehicle_rate × 15)
           + (low_income_rate × 15)
           + (food_desert     × 20)
```

All rates are expressed as proportions (0–1). The food desert flag (0 or 1) from USDA adds 20 points when a tract qualifies.

---

## Impact Score Calculation

The Impact Score (0–100) measures how effectively FSF is serving each county relative to its population.

### Formula

```
Impact Score = Population Impact Score + Meals Per Capita Score 
```

**Population Reach (60 points max)**
```
pop_pct = min((avg_individuals_per_ZIP / avg_ZIP_population) / 0.05, 1.0) × 60
```
- Benchmark: serving **5% of ZIP population** per month = 60 points

**Meals Per Capita (40 points max)**
```
meals_sc = min((avg_meals_per_ZIP / avg_individuals_per_ZIP) / 5.0, 1.0) × 40
```
- Benchmark: **5 meals per person** per month = 40 points

---
## Year-over-Year Trend Chart

Available when **2 or more years** of FSF distribution data have been uploaded. Accessed via the **📈 Trend chart** button in the control bar.

### Features
- Line chart with one line per county (Miami-Dade, Broward, Palm Beach)
- 4 metric toggles: Impact score, Total meals, Individuals served, Households served
- Summary stat cards: total meals, individuals served, avg score, meal growth %
- County score cards showing latest score and change since earliest year
- Scores recalculated from aggregated totals for accuracy

### County Colors in Trend Chart
| County | Color |
|---|---|
| Miami-Dade | 🔴 Red `#E24B4A` |
| Broward | 🔵 Blue `#185FA5` |
| Palm Beach | 🟡 Yellow `#D4A017` |

---
## Data Sources

### Need Score Data

| Source | Description | URL | Cost |
|---|---|---|---|
| **US Census Bureau ACS 5-Year** | Poverty, SNAP, income, vehicles, unemployment, housing burden | api.census.gov | Free |

### Impact Score Data

| Source | Description | How to obtain |
|---|---|---|
| **Synthetic CSV (current)** | Simulated realistic data for 2021–2025 | Provided in `/data` folder |

---



