import os
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fsf_data.db")

if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
elif DATABASE_URL.startswith("postgres"):
    # Normalize: plain `postgresql://` or `postgres://` → `postgresql+psycopg://`
    # (psycopg3 is installed; psycopg2 is not)
    for old, new in [
        ("postgresql+psycopg2://", "postgresql+psycopg://"),
        ("postgresql://",          "postgresql+psycopg://"),
        ("postgres://",            "postgresql+psycopg://"),
    ]:
        if DATABASE_URL.startswith(old):
            DATABASE_URL = DATABASE_URL.replace(old, new, 1)
            break
    # Supabase requires SSL; add sslmode if absent
    if "sslmode" not in DATABASE_URL:
        sep = "&" if "?" in DATABASE_URL else "?"
        DATABASE_URL = DATABASE_URL + sep + "sslmode=require"
    # Disable psycopg3 server-side prepared statements: Supabase's transaction
    # pooler (PgBouncer) reuses backend connections, so a prepared statement
    # created on one can collide on another → intermittent
    # "DuplicatePreparedStatement" errors during bulk inserts.
    engine = create_engine(
        DATABASE_URL, pool_pre_ping=True, pool_recycle=300,
        connect_args={"prepare_threshold": None},
    )
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


from sqlalchemy import Index


# ── ACS Need Score Records ─────────────────────────────────────────────────────
class ACSRecord(Base):
    __tablename__ = "acs_records"
    id                      = Column(Integer, primary_key=True, index=True)
    tract_id                = Column(String, index=True)
    neighborhood            = Column(String)
    county                  = Column(String)
    latitude                = Column(Float)
    longitude               = Column(Float)
    need_score              = Column(Float)
    food_access_index       = Column(Float)
    population              = Column(Integer)
    median_income           = Column(Float)
    pct_below_poverty       = Column(Float)
    pct_snap_enrollment     = Column(Float)
    pct_no_vehicle          = Column(Float)
    pct_low_income          = Column(Float)
    food_desert             = Column(Integer)
    supermarket_dist_mi     = Column(Float)
    pct_children_under18    = Column(Float)
    pct_seniors_65plus      = Column(Float)
    unemployment_rate       = Column(Float)
    housing_cost_burden_pct = Column(Float)
    acs_year                = Column(Integer)
    upload_batch_id         = Column(Integer, index=True)

    # Read endpoints filter on upload_batch_id; keep the tract lookup composite.
    __table_args__ = (
        Index("ix_acs_batch_tract", "upload_batch_id", "tract_id"),
    )


# ── ACS Upload Batches ─────────────────────────────────────────────────────────
class UploadBatch(Base):
    __tablename__ = "upload_batches"
    id          = Column(Integer, primary_key=True, index=True)
    filename    = Column(String)
    uploaded_by = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    row_count   = Column(Integer)
    status      = Column(String)   # "active" | "archived"
    acs_year    = Column(Integer)

    # Every batch query filters on (status, acs_year).
    __table_args__ = (
        Index("ix_acs_batch_status_year", "status", "acs_year"),
    )


# ── ACS fetch job status (DB-backed so it survives restarts & multi-worker) ────
class AcsFetchJob(Base):
    __tablename__ = "acs_fetch_jobs"
    acs_year   = Column(Integer, primary_key=True)   # one job row per year
    status     = Column(String)                      # fetching | done | error
    message    = Column(String)
    tracts     = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)


# ── FSF Distribution Records (Accomplishment Score) ────────────────────────────
class FSFDistribution(Base):
    __tablename__ = "fsf_distributions"
    id                  = Column(Integer, primary_key=True, index=True)
    zip_code            = Column(String, index=True)
    county              = Column(String)
    households_served   = Column(Integer)
    individuals_served  = Column(Integer)
    meals_served        = Column(Float)
    month               = Column(String)
    dist_year           = Column(Integer)
    impact_score        = Column(Float)
    upload_batch_id     = Column(Integer, index=True)


# ── FSF Distribution Upload Batches ───────────────────────────────────────────
class FSFUploadBatch(Base):
    __tablename__ = "fsf_upload_batches"
    id          = Column(Integer, primary_key=True, index=True)
    filename    = Column(String)
    uploaded_by = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    row_count   = Column(Integer)
    dist_year   = Column(Integer)
    status      = Column(String)   # "active" | "archived"

    __table_args__ = (
        Index("ix_fsf_batch_status_year", "status", "dist_year"),
    )
