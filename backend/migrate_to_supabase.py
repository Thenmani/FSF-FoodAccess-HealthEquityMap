"""One-time migration: copy ACS records from local SQLite → Supabase."""
import os, sqlite3
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, ACSRecord, UploadBatch

load_dotenv()

SQLITE_PATH = os.path.join(os.path.dirname(__file__), "fsf_data.db")
SUPABASE_URL = os.getenv("DATABASE_URL")

if not SUPABASE_URL or SUPABASE_URL.startswith("sqlite"):
    raise SystemExit("DATABASE_URL not set to Supabase in .env")

print("Reading from SQLite...")
src = sqlite3.connect(SQLITE_PATH)
src.row_factory = sqlite3.Row
batches = [dict(r) for r in src.execute("SELECT * FROM upload_batches").fetchall()]
records = [dict(r) for r in src.execute("SELECT * FROM acs_records").fetchall()]
src.close()
print(f"  {len(batches)} batches, {len(records)} ACS records")

print("Connecting to Supabase...")
engine = create_engine(SUPABASE_URL)
Base.metadata.create_all(bind=engine)
Session = sessionmaker(bind=engine)
db = Session()

try:
    existing = db.query(ACSRecord).count()
    if existing > 0:
        print(f"Supabase already has {existing} ACS records — skipping.")
    else:
        for b in batches:
            db.merge(UploadBatch(
                id=b["id"], filename=b["filename"], uploaded_by=b["uploaded_by"],
                uploaded_at=b["uploaded_at"], row_count=b["row_count"],
                status=b["status"], acs_year=b["acs_year"],
            ))
        db.commit()
        print(f"  Inserted {len(batches)} batches")

        chunk = 500
        for i in range(0, len(records), chunk):
            for r in records[i:i+chunk]:
                db.add(ACSRecord(
                    id=r["id"], tract_id=r["tract_id"], neighborhood=r["neighborhood"],
                    county=r["county"], latitude=r["latitude"], longitude=r["longitude"],
                    need_score=r["need_score"], food_access_index=r["food_access_index"],
                    population=r["population"], median_income=r["median_income"],
                    pct_below_poverty=r["pct_below_poverty"], pct_snap_enrollment=r["pct_snap_enrollment"],
                    pct_no_vehicle=r["pct_no_vehicle"], pct_low_income=r["pct_low_income"],
                    food_desert=r["food_desert"], supermarket_dist_mi=r["supermarket_dist_mi"],
                    pct_children_under18=r["pct_children_under18"], pct_seniors_65plus=r["pct_seniors_65plus"],
                    unemployment_rate=r["unemployment_rate"], housing_cost_burden_pct=r["housing_cost_burden_pct"],
                    acs_year=r["acs_year"], upload_batch_id=r["upload_batch_id"],
                ))
            db.commit()
            print(f"  Inserted records {i+1}–{min(i+chunk, len(records))}")

        print(f"Done — {len(records)} ACS records migrated to Supabase.")
finally:
    db.close()
