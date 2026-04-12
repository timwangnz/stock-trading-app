#!/usr/bin/env bash
# deploy.sh — One-command manual deploy to Google Cloud Run
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Prerequisites: gcloud CLI installed and authenticated
#   gcloud auth login
#   gcloud config set project YOUR_PROJECT_ID

set -euo pipefail

# ── Config — edit these ────────────────────────────────────────────
PROJECT_ID=$(gcloud config get-value project)
SERVICE="tradebuddy"
REGION="us-central1"
REPO="tradebuddy"
DB_INSTANCE="${PROJECT_ID}:${REGION}:tradebuddy-db"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

echo "🚀 Deploying TradeBuddy to Cloud Run"
echo "   Project : ${PROJECT_ID}"
echo "   Service : ${SERVICE}"
echo "   Region  : ${REGION}"
echo ""

# ── 1. Ensure Artifact Registry repo exists ────────────────────────
echo "📦 Creating Artifact Registry repo (if needed)..."
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --quiet 2>/dev/null || true

# ── 2. Configure Docker auth ───────────────────────────────────────
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── 3. Build & push image ──────────────────────────────────────────
echo "🔨 Building Docker image..."
docker build -t "${IMAGE}:latest" .

echo "⬆️  Pushing image..."
docker push "${IMAGE}:latest"

# ── 4. Deploy to Cloud Run ─────────────────────────────────────────
echo "☁️  Deploying to Cloud Run..."
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}:latest" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --set-secrets="JWT_SECRET=JWT_SECRET:latest,DB_PASSWORD=DB_PASSWORD:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest" \
  --set-env-vars="NODE_ENV=production,DB_USER=tradebuddy,DB_NAME=tradebuddy" \
  --add-cloudsql-instances="${DB_INSTANCE}" \
  --set-env-vars="DB_SOCKET_PATH=/cloudsql/${DB_INSTANCE}"

echo ""
echo "✅ Deployed! Your app URL:"
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --format="value(status.url)"
