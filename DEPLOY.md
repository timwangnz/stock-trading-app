# Deploying TradeBuddy to Google Cloud Run

## Architecture

```
Browser → Cloud Run (Express + React build)
               ↓
          Cloud SQL (MySQL)
```

A single Cloud Run service serves both the React frontend (as static files) and the Express API. Cloud Run connects to Cloud SQL via a private Unix socket — no public database port needed.

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

### 2 — Create Cloud SQL (MySQL) instance

```bash
gcloud sql instances create tradebuddy-db \
  --database-version=MYSQL_8_0 \
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
DB_HOST=127.0.0.1 DB_USER=tradebuddy DB_PASSWORD=YOUR_PW DB_NAME=tradebuddy \
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

# Polygon.io API key (used by the frontend at build time — set as build arg)
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

| Variable          | Where set         | Description                              |
|-------------------|-------------------|------------------------------------------|
| `NODE_ENV`        | Cloud Run env     | Set to `production`                      |
| `PORT`            | Auto (Cloud Run)  | Injected automatically by Cloud Run      |
| `JWT_SECRET`      | Secret Manager    | JWT signing key                          |
| `DB_USER`         | Cloud Run env     | MySQL user (`tradebuddy`)                |
| `DB_NAME`         | Cloud Run env     | Database name (`tradebuddy`)             |
| `DB_PASSWORD`     | Secret Manager    | MySQL password                           |
| `DB_SOCKET_PATH`  | Cloud Run env     | `/cloudsql/PROJECT:REGION:INSTANCE`      |
| `ANTHROPIC_API_KEY` | Secret Manager  | Claude API key for Trading Agent         |
| `VITE_API_URL`    | Build arg         | Set to empty string (same origin in prod)|
| `VITE_GOOGLE_CLIENT_ID` | Build arg   | Google OAuth client ID                   |

---

## Frontend Environment Variables

The Vite frontend reads `VITE_*` variables **at build time**. For production, set them in the Dockerfile as `ARG` / `ENV` or pass via `--build-arg` during `docker build`:

```bash
docker build \
  --build-arg VITE_GOOGLE_CLIENT_ID=your-client-id \
  --build-arg VITE_POLYGON_API_KEY=your-polygon-key \
  -t tradebuddy .
```

Or add them to `cloudbuild.yaml` under the build step's `--build-arg` flags.

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

## Cost estimate (light usage)

| Service         | Free tier         | Typical cost        |
|-----------------|-------------------|---------------------|
| Cloud Run       | 2M req/month free | ~$0 at low traffic  |
| Cloud SQL f1-micro | — (no free tier) | ~$7–10 / month    |
| Artifact Registry | 0.5 GB free      | ~$0 for one image   |
| Secret Manager  | 6 secrets free    | ~$0                 |

**Total: ~$7–10/month** for a always-on Cloud SQL instance.
To save money while learning, stop the SQL instance when not in use:
```bash
gcloud sql instances patch tradebuddy-db --activation-policy=NEVER
```
