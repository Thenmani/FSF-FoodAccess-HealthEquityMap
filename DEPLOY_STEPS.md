# Deployment steps — FSF Health Equity Platform on Google Cloud

Replace `YOUR_PROJECT_ID`, `YOUR_DB_PASSWORD`, and `YOUR_CENSUS_KEY` throughout.

## 0. One-time setup
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

gcloud services enable run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com
```

## 1. Create the Cloud SQL Postgres instance
```bash
gcloud sql instances create fsf-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-east1 \
  --root-password=YOUR_DB_PASSWORD

gcloud sql databases create fsf_data --instance=fsf-db
```

## 2. Store secrets in Secret Manager
```bash
echo -n "YOUR_CENSUS_KEY" | gcloud secrets create census-api-key --data-file=-

echo -n "postgresql://postgres:YOUR_DB_PASSWORD@/fsf_data?host=/cloudsql/YOUR_PROJECT_ID:us-east1:fsf-db" \
  | gcloud secrets create database-url --data-file=-
```

## 3. Deploy the backend to Cloud Run
Run this from inside your `backend/` folder (where the Dockerfile lives):
```bash
gcloud run deploy fsf-backend \
  --source . \
  --region=us-east1 \
  --allow-unauthenticated \
  --add-cloudsql-instances=YOUR_PROJECT_ID:us-east1:fsf-db \
  --set-secrets=DATABASE_URL=database-url:latest,CENSUS_API_KEY=census-api-key:latest
```
This prints a service URL like `https://fsf-backend-xxxxx-ue.a.run.app` — copy it, you'll need it next.

## 4. Point the frontend at the backend
In your frontend code, wherever the API base URL is defined (likely an `.env` or a constant like `API_BASE_URL`), set it to the Cloud Run URL from step 3. Then build:
```bash
cd frontend
npm run build
```

## 5. Deploy the frontend to Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # select your GCP project, public dir = dist, single-page app = yes
firebase deploy --only hosting
```

## 6. Update backend CORS
In `main.py`, make sure CORS middleware allows your Firebase Hosting domain
(e.g. `https://YOUR_PROJECT_ID.web.app`), then redeploy the backend (step 3 again).

## 7. Verify
- Visit the Firebase Hosting URL
- Confirm the map loads and an ACS year fetch succeeds (this exercises the full path: frontend → Cloud Run → Cloud SQL)
