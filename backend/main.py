import os
import io
import threading
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import pandas as pd
from dotenv import load_dotenv

from database import (
    SessionLocal, engine, Base,
    ACSRecord, UploadBatch, AcsFetchJob,
    FSFDistribution, FSFUploadBatch,
)
import scoring
import food_desert

load_dotenv()
Base.metadata.create_all(bind=engine)
app = FastAPI()

# ACS 5-year vintages before 2020 use 2010-vintage tract boundaries, which do
# not join the 2020-based tracts_2022.geojson the frontend renders. Restrict to
# years that share the 2020 boundary set.
MIN_ACS_YEAR = 2020
MAX_ACS_YEAR = 2025

app.add_middleware(
    CORSMiddleware,
    # Any localhost/127.0.0.1 port (local dev on any Vite port) + Vercel deploys.
    allow_origin_regex=r"https://.*\.vercel\.app|http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

def _set_fetch_job(db: Session, year: int, status: str, message: str = "", tracts: int = 0):
    """Upsert the DB-backed fetch-status row (survives restarts / multi-worker)."""
    job = db.query(AcsFetchJob).filter(AcsFetchJob.acs_year == year).first()
    if not job:
        job = AcsFetchJob(acs_year=year)
        db.add(job)
    job.status, job.message, job.tracts = status, message, tracts
    job.updated_at = datetime.utcnow()
    db.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def safe_float(row, key, default=0.0):
    try:
        return float(row.get(key, default) or default)
    except (ValueError, TypeError):
        return default


def _clean(v):
    """Return None for NaN/Inf so JSON serialization doesn't blow up."""
    import math
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def safe_int(row, key, default=0):
    try:
        return int(float(row.get(key, default) or default))
    except (ValueError, TypeError):
        return default


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


# ════════════════════════════════════════════════════════════════════════════════
#  ACS — AUTO FETCH FROM CENSUS API
# ════════════════════════════════════════════════════════════════════════════════

def _do_acs_fetch(year: int):
    db = SessionLocal()
    try:
        _set_fetch_job(db, year, "fetching", f"Fetching ACS {year} from Census Bureau...")

        api_key = os.getenv("CENSUS_API_KEY", "")
        from fetch_acs import fetch_acs_data
        df = fetch_acs_data(year=year, api_key=api_key)

        # Attach the static USDA food-desert flag, then compute a REAL need_score
        # (percentile-rank weighted avg incl. food_desert) — not a placeholder 0.
        flags = food_desert.load_flags()
        df["tract_id"] = df["tract_id"].astype(str)
        df["food_desert"] = df["tract_id"].map(lambda t: flags.get(t, 0)).astype(int)
        df["need_score"] = scoring.compute_need_scores(df)

        # Build all records up front, then bulk-insert in one round trip.
        mappings = []
        for row in df.to_dict("records"):
            ns = row.get("need_score")
            ns = None if ns is None or (isinstance(ns, float) and pd.isna(ns)) else float(ns)
            mappings.append(dict(
                tract_id                = str(row.get("tract_id", "")),
                neighborhood            = "",
                county                  = str(row.get("county", "")),
                need_score              = ns,
                food_access_index       = ns,
                population              = safe_int(row, "population"),
                median_income           = safe_float(row, "median_income"),
                pct_below_poverty       = safe_float(row, "pct_below_poverty"),
                pct_snap_enrollment     = safe_float(row, "pct_snap_enrollment"),
                pct_no_vehicle          = safe_float(row, "pct_no_vehicle"),
                pct_low_income          = safe_float(row, "pct_low_income"),
                food_desert             = int(row.get("food_desert", 0) or 0),
                pct_children_under18    = safe_float(row, "pct_children_under18"),
                pct_seniors_65plus      = safe_float(row, "pct_seniors_65plus"),
                unemployment_rate       = safe_float(row, "unemployment_rate"),
                housing_cost_burden_pct = safe_float(row, "housing_cost_burden_pct"),
                acs_year                = year,
            ))

        # Safe ordering: create + fully populate the new batch FIRST, commit,
        # THEN archive the prior active batch. A failure before this commit
        # leaves the previous active batch untouched (see except: rollback).
        batch = UploadBatch(
            filename=f"census_api_acs5_{year}.csv",
            uploaded_by="census_api",
            row_count=len(df),
            status="pending",
            acs_year=year,
        )
        db.add(batch)
        db.flush()  # assign batch.id without committing
        for m in mappings:
            m["upload_batch_id"] = batch.id
        db.bulk_insert_mappings(ACSRecord, mappings)
        db.commit()

        # New batch is safely written — now swap it in atomically.
        db.query(UploadBatch).filter(
            UploadBatch.status == "active",
            UploadBatch.acs_year == year,
            UploadBatch.id != batch.id,
        ).update({"status": "archived"})
        batch.status = "active"
        db.commit()

        _set_fetch_job(db, year, "done", f"ACS {year} loaded — {len(df)} tracts", len(df))
    except Exception as e:
        db.rollback()
        _set_fetch_job(db, year, "error", str(e))
    finally:
        db.close()


@app.post("/api/acs/fetch")
def trigger_acs_fetch(acs_year: int = Query(2024), force: bool = Query(False),
                      db: Session = Depends(get_db)):
    """Fetch ACS data for a year. If already loaded, returns cached — unless
    force=true, which re-pulls from the Census API to refresh stale columns
    (e.g. backfilling unemployment / housing after a schema change). The
    re-fetch is safe: _do_acs_fetch writes the new batch fully before archiving
    the old one, so the year is never left without data."""
    api_key = os.getenv("CENSUS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="CENSUS_API_KEY not set in backend/.env")

    if not (MIN_ACS_YEAR <= acs_year <= MAX_ACS_YEAR):
        raise HTTPException(
            status_code=400,
            detail=f"Year must be between {MIN_ACS_YEAR} and {MAX_ACS_YEAR} "
                   f"(earlier ACS vintages use 2010 tract boundaries that don't match the map)",
        )

    job = db.query(AcsFetchJob).filter(AcsFetchJob.acs_year == acs_year).first()
    if job and job.status == "fetching":
        return {"message": f"Already fetching ACS {acs_year}...", "cached": False}

    if not force:
        existing = db.query(UploadBatch).filter(
            UploadBatch.acs_year == acs_year,
            UploadBatch.status == "active",
        ).first()
        if existing:
            _set_fetch_job(db, acs_year, "done", f"ACS {acs_year} already loaded", existing.row_count or 0)
            return {"message": f"ACS {acs_year} already in database", "cached": True, "tracts": existing.row_count or 0}

    _set_fetch_job(db, acs_year, "fetching", "Starting...")
    t = threading.Thread(target=_do_acs_fetch, args=(acs_year,), daemon=True)
    t.start()
    verb = "Re-fetching" if force else "Fetching"
    return {"message": f"{verb} ACS {acs_year} in background...", "cached": False}


@app.get("/api/acs/fetch-status")
def get_acs_fetch_status(acs_year: int = Query(2024), db: Session = Depends(get_db)):
    job = db.query(AcsFetchJob).filter(AcsFetchJob.acs_year == acs_year).first()
    if job and job.status:
        return {"status": job.status, "message": job.message, "tracts": job.tracts or 0}

    # No job row yet — fall back to whether an active batch exists.
    existing = db.query(UploadBatch).filter(
        UploadBatch.acs_year == acs_year,
        UploadBatch.status == "active",
    ).first()
    if existing:
        return {"status": "done", "message": f"ACS {acs_year} loaded", "tracts": existing.row_count or 0}
    return {"status": "not_started", "message": f"ACS {acs_year} not yet fetched", "tracts": 0}


@app.get("/api/acs/tracts")
def get_acs_tracts(acs_year: int = Query(2024), db: Session = Depends(get_db)):
    batch = db.query(UploadBatch).filter(
        UploadBatch.status == "active",
        UploadBatch.acs_year == acs_year,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail=f"No ACS data loaded for year {acs_year}")

    records = db.query(ACSRecord).filter(ACSRecord.upload_batch_id == batch.id).all()
    return [
        {
            "tract_id":                r.tract_id,
            "neighborhood":            r.neighborhood,
            "county":                  r.county,
            "need_score":              _clean(r.need_score),
            "food_access_index":       _clean(r.food_access_index),
            "population":              r.population,
            "median_income":           _clean(r.median_income),
            "pct_below_poverty":       _clean(r.pct_below_poverty),
            "pct_snap_enrollment":     _clean(r.pct_snap_enrollment),
            "pct_no_vehicle":          _clean(r.pct_no_vehicle),
            "food_desert":             r.food_desert,
            "supermarket_dist_mi":     _clean(r.supermarket_dist_mi),
            "unemployment_rate":       _clean(r.unemployment_rate),
            "housing_cost_burden_pct": _clean(r.housing_cost_burden_pct),
            "acs_year":                r.acs_year,
        }
        for r in records
    ]


@app.get("/api/acs/available-years")
def get_acs_available_years(db: Session = Depends(get_db)):
    batches = db.query(UploadBatch).filter(UploadBatch.status == "active").all()
    return [{"year": b.acs_year, "tracts": b.row_count} for b in batches]


@app.get("/api/acs/upload-history")
def get_acs_history(db: Session = Depends(get_db)):
    batches = db.query(UploadBatch).order_by(UploadBatch.uploaded_at.desc()).all()
    return [
        {
            "id":          b.id,
            "filename":    b.filename,
            "uploaded_by": b.uploaded_by,
            "uploaded_at": str(b.uploaded_at),
            "row_count":   b.row_count,
            "acs_year":    b.acs_year,
            "status":      b.status,
        }
        for b in batches
    ]


@app.delete("/api/acs/upload-history/{batch_id}")
def delete_acs_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    db.query(ACSRecord).filter(ACSRecord.upload_batch_id == batch_id).delete()
    db.delete(batch)
    db.commit()
    return {"message": f"ACS batch {batch_id} deleted"}


# ════════════════════════════════════════════════════════════════════════════════
#  FSF ACCOMPLISHMENT SCORE
# ════════════════════════════════════════════════════════════════════════════════

@app.post("/api/fsf/upload")
async def upload_fsf_csv(
    file: UploadFile = File(...),
    dist_year: int = Query(...),
    uploaded_by: str = "manager",
    db: Session = Depends(get_db),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files accepted")

    contents = await file.read()
    try:
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    required = {"zip_code", "county", "households_served", "individuals_served", "meals_served"}
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(sorted(missing))}")

    # Build honest per-ZIP records. The per-row impact_score reflects that single
    # ZIP; the county rollup is derived on demand by /api/fsf/county-summary,
    # which is the ONE place the county score is computed.
    mappings = []
    for row in df.to_dict("records"):
        zip_code   = scoring.normalize_zip(row.get("zip_code", ""))
        ind_served = safe_int(row, "individuals_served")
        meals      = safe_int(row, "meals_served")
        zip_pop    = scoring.zip_population(zip_code)
        mappings.append(dict(
            zip_code            = zip_code,
            county              = str(row.get("county", "")),
            households_served   = safe_int(row, "households_served"),
            individuals_served  = ind_served,
            meals_served        = meals,
            month               = str(row.get("month", "")),
            dist_year           = dist_year,
            impact_score        = scoring.impact_score(ind_served, meals, zip_pop),
        ))

    try:
        # Safe ordering: fully write the new batch first, commit, THEN archive
        # the prior active batch. A failure mid-write rolls back and leaves the
        # existing active batch intact.
        batch = FSFUploadBatch(
            filename=file.filename,
            uploaded_by=uploaded_by,
            row_count=len(df),
            dist_year=dist_year,
            status="pending",
        )
        db.add(batch)
        db.flush()
        for m in mappings:
            m["upload_batch_id"] = batch.id
        db.bulk_insert_mappings(FSFDistribution, mappings)
        db.commit()

        db.query(FSFUploadBatch).filter(
            FSFUploadBatch.status == "active",
            FSFUploadBatch.dist_year == dist_year,
            FSFUploadBatch.id != batch.id,
        ).update({"status": "archived"})
        batch.status = "active"
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Upload failed, no data changed: {e}")

    return {"message": "Upload successful", "batch_id": batch.id, "rows_imported": len(df), "year": dist_year}


@app.get("/api/fsf/county-summary")
def get_fsf_county_summary(dist_year: int = Query(...), db: Session = Depends(get_db)):
    """Per-county rollup with impact_score computed ONCE, server-side. The map
    and trend chart consume this instead of re-deriving the score client-side.

    impact_score(sum_ind, sum_meals, sum_pop) is identical to the old
    average-based county formula, since the per-ZIP counts cancel.
    """
    batch = db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active",
        FSFUploadBatch.dist_year == dist_year,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail=f"No FSF data uploaded for {dist_year}")

    records = db.query(FSFDistribution).filter(FSFDistribution.upload_batch_id == batch.id).all()

    agg: dict[str, dict] = {}
    for r in records:
        county = scoring.normalize_county(r.county)
        if not county:
            continue
        a = agg.setdefault(county, {"households_served": 0, "individuals_served": 0,
                                    "meals_served": 0, "population": 0})
        a["households_served"]  += r.households_served or 0
        a["individuals_served"] += r.individuals_served or 0
        a["meals_served"]       += r.meals_served or 0
        a["population"]         += scoring.zip_population(r.zip_code)

    return [
        {
            "county":             county,
            "dist_year":          dist_year,
            "households_served":  a["households_served"],
            "individuals_served": a["individuals_served"],
            "meals_served":       a["meals_served"],
            "impact_score":       scoring.impact_score(
                a["individuals_served"], a["meals_served"], a["population"]),
        }
        for county, a in agg.items()
    ]


@app.get("/api/fsf/distributions")
def get_fsf_distributions(dist_year: int = Query(...), db: Session = Depends(get_db)):
    batch = db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active",
        FSFUploadBatch.dist_year == dist_year,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail=f"No FSF data uploaded for {dist_year}")

    records = db.query(FSFDistribution).filter(FSFDistribution.upload_batch_id == batch.id).all()
    return [
        {
            "zip_code":              r.zip_code,
            "county":                r.county,
            "households_served":     r.households_served,
            "individuals_served":    r.individuals_served,
            "meals_served":          r.meals_served,
            "month":                 r.month,
            "dist_year":             r.dist_year,
            "impact_score":  r.impact_score,
        }
        for r in records
    ]


@app.get("/api/fsf/available-years")
def get_fsf_available_years(db: Session = Depends(get_db)):
    """Return list of years that have uploaded FSF data."""
    batches = db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active"
    ).order_by(FSFUploadBatch.dist_year.desc()).all()
    return [{"year": b.dist_year, "rows": b.row_count, "filename": b.filename} for b in batches]


@app.get("/api/fsf/upload-history")
def get_fsf_history(db: Session = Depends(get_db)):
    batches = db.query(FSFUploadBatch).order_by(
        FSFUploadBatch.dist_year.desc(),
        FSFUploadBatch.uploaded_at.desc()
    ).all()
    return [
        {
            "id":          b.id,
            "filename":    b.filename,
            "uploaded_by": b.uploaded_by,
            "uploaded_at": str(b.uploaded_at),
            "row_count":   b.row_count,
            "dist_year":   b.dist_year,
            "status":      b.status,
        }
        for b in batches
    ]


@app.delete("/api/fsf/upload-history/{batch_id}")
def delete_fsf_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(FSFUploadBatch).filter(FSFUploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    db.query(FSFDistribution).filter(FSFDistribution.upload_batch_id == batch_id).delete()
    db.delete(batch)
    db.commit()
    return {"message": f"FSF batch {batch_id} deleted"}


@app.patch("/api/fsf/upload-history/{batch_id}/activate")
def activate_fsf_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(FSFUploadBatch).filter(FSFUploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    db.query(FSFUploadBatch).filter(
        FSFUploadBatch.status == "active",
        FSFUploadBatch.dist_year == batch.dist_year,
    ).update({"status": "archived"})
    batch.status = "active"
    db.commit()
    return {"message": f"FSF batch {batch_id} is now active"}


# ── Legacy endpoints ───────────────────────────────────────────────────────────
@app.get("/api/tracts")
def get_tracts_legacy(db: Session = Depends(get_db)):
    return get_acs_tracts(acs_year=2024, db=db)

@app.get("/api/upload-history")
def get_history_legacy(db: Session = Depends(get_db)):
    return get_acs_history(db=db)
