import pandas as pd
from database import SessionLocal, engine, Base, ACSRecord, UploadBatch
from datetime import datetime

Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Check if already seeded
existing = db.query(UploadBatch).filter(UploadBatch.status == "active").first()
if existing:
    print("Database already has active data. Skipping seed.")
    db.close()
    exit()

print("Seeding database from acs_with_index.csv...")

df = pd.read_csv("acs_with_index.csv")

# Create upload batch
batch = UploadBatch(
    filename="acs_with_index.csv",
    uploaded_by="system",
    uploaded_at=datetime.utcnow(),
    row_count=len(df),
    status="active"
)
db.add(batch)
db.commit()
db.refresh(batch)

# Insert rows
for _, row in df.iterrows():
    record = ACSRecord(
        tract_id=str(row.get("GEOID", "")),
        county=str(row.get("county_name", "")),
        food_access_index=float(row.get("need_score", 0)),
        population=int(row.get("total_pop", 0)) if pd.notna(row.get("total_pop")) else 0,
        median_income=float(row.get("median_income", 0)) if pd.notna(row.get("median_income")) else 0,
        upload_batch_id=batch.id
    )
    db.add(record)

db.commit()
db.close()

print(f"Done! {len(df)} rows seeded successfully.")