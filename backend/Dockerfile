# --- FSF Health Equity backend: FastAPI on Cloud Run ---
FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffering stdout (cleaner Cloud Run logs)
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first so Docker can cache this layer between builds
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend source
COPY . .

# Cloud Run injects $PORT (defaults to 8080) — always bind to it, never hardcode
ENV PORT=8080
EXPOSE 8080

CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
