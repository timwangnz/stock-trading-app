# Deploying Vantage to Google Cloud Run

## Architecture

```
Browser → Cloud Run (Express + React build)
               ↓
          Cloud SQL (PostgreSQL 15)
```

A single Cloud Run service serves both the React frontend (as static files) and the Express API. Cloud Run connects to Cloud SQL via a private Unix socket — no public database port needed.

> **Free database option**: For zero-cost hosting during development, use [Neon](https://neon.tech) (free PostgreSQL with 0.5 GB storage and serverless auto-scaling). Just set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` to your Neon connection details — no socket path needed.

---

## Prerequisites

- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- A Google Cloud project with billing enabled

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

---

## One-time Setup

### 1 — Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

### 2 — Create Cloud SQL (PostgreSQL) instance

```bash
gcloud sql instances create tradebuddy-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1

# Create the database
gcloud sql databases create tradebuddy --instance=tradebuddy-db

# Create a user
gcloud sql users create tradebuddy \
  --instance=tradebuddy-db \
  --password=CHOOSE_A_STRONG_PASSWORD
```

### 3 — Run the DB setup script locally against Cloud SQL

Connect via the Cloud SQL Auth Proxy first:

```bash
# Download the proxy (macOS)
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.10.0/cloud-sql-proxy.darwin.amd64
chmod +x cloud-sql-proxy

# Start the proxy (leave this running in a separate terminal)
./cloud-sql-proxy YOUR_PROJECT:us-central1:tradebuddy-db

# In another terminal, run the schema setup
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=tradebuddy DB_PASSWORD=YOUR_PW DB_NAME=tradebuddy \
  node server/setup-db.js
```

### 4 — Store secrets in Secret Manager

```bash
# JWT signing secret (generate a strong random string)
echo -n "$(openssl rand -hex 32)" | \
  gcloud secrets create JWT_SECRET --data-file=-

# DB password
echo -n "YOUR_DB_PASSWORD" | \
  gcloud secrets create DB_PASSWORD --data-file=-

# Anthropic API key
echo -n "YOUR_ANTHROPIC_API_KEY" | \
  gcloud secrets create ANTHROPIC_API_KEY --data-file=-

# Polygon.io API key
echo -n "YOUR_POLYGON_API_KEY" | \
  gcloud secrets create POLYGON_API_KEY --data-file=-
```

### 5 — Grant Cloud Run access to secrets

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

---

## Deploy

### Option A — Manual deploy (one command)

```bash
./deploy.sh
```

### Option B — Automated CI/CD via Cloud Build

Connect your GitHub repo to Cloud Build and it will auto-deploy on every push to `main`:

```bash
# Link repo in the Cloud Console:
# Cloud Build → Triggers → Connect Repository → GitHub
# Then create a trigger pointing to cloudbuild.yaml
```

---

## Environment Variables Reference

| Variable            | Where set          | Description                               |
|---------------------|--------------------|-------------------------------------------|
| `NODE_ENV`          | Cloud Run env      | Set to `production`                       |
| `PORT`              | Auto (Cloud Run)   | Injected automatically by Cloud Run       |
| `JWT_SECRET`        | Secret Manager     | JWT signing key                           |
| `DB_USER`           | Cloud Run env      | PostgreSQL user (`tradebuddy`)            |
| `DB_NAME`           | Cloud Run env      | Database name (`tradebuddy`)              |
| `DB_PASSWORD`       | Secret Manager     | PostgreSQL password                       |
| `DB_SOCKET_PATH`    | Cloud Run env      | `/cloudsql/PROJECT:REGION:INSTANCE`       |
| `ANTHROPIC_API_KEY` | Secret Manager     | Claude API key for Trading Agent          |
| `POLYGON_API_KEY`   | Secret Manager     | Polygon.io key (server-side only)         |
| `VITE_GOOGLE_CLIENT_ID` | Build arg      | Google OAuth client ID                    |

---

## Neon (Free PostgreSQL Alternative)

[Neon](https://neon.tech) offers a free PostgreSQL tier (0.5 GB, scales to zero). To use it instead of Cloud SQL:

1. Create a project at neon.tech — copy the connection string.
2. Set these env vars in Cloud Run (no `DB_SOCKET_PATH` needed):
   ```
   DB_HOST=ep-xxx.us-east-2.aws.neon.tech
   DB_PORT=5432
   DB_USER=your_neon_user
   DB_PASSWORD=your_neon_password
   DB_NAME=tradebuddy
   ```
3. Neon connections require SSL — add `?sslmode=require` or set `ssl: true` in `db.js` if you see SSL errors.

---

## Verify the deployment

```bash
# Check service status
gcloud run services describe tradebuddy --region=us-central1

# Tail live logs
gcloud run services logs tail tradebuddy --region=us-central1

# Hit the health endpoint
curl https://YOUR_CLOUD_RUN_URL/api/health
```

---

## Cost estimate

| Service                | Free tier             | Typical cost           |
|------------------------|-----------------------|------------------------|
| Cloud Run              | 2M req/month free     | ~$0 at low traffic     |
| Cloud SQL PostgreSQL   | No free tier          | ~$7–10 / month         |
| **Neon PostgreSQL**    | **0.5 GB free**       | **$0 (free tier)**     |
| Artifact Registry      | 0.5 GB free           | ~$0 for one image      |
| Secret Manager         | 6 secrets free        | ~$0                    |

**Cloud SQL total: ~$7–10/month**. To save money, stop the instance when not in use:
```bash
gcloud sql instances patch tradebuddy-db --activation-policy=NEVER
```

**Neon total: $0/month** on the free tier (auto-pauses after 5 min inactivity).
