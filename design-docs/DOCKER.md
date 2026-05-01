# TradeBuddy — Docker Guide

## Background

TradeBuddy ships as a single Docker image (`anpwang/tradebuddy`) that contains both the React frontend and the Express API server.

**How it works:**

The Dockerfile uses a two-stage build:

- **Stage 1 (builder)** — Node 22 Alpine installs all dependencies and runs `npm run build` (Vite) to produce the React bundle.
- **Stage 2 (production)** — A fresh Node 22 Alpine image installs only production dependencies, copies the server source and the compiled `dist/` from Stage 1, and sets the entrypoint to `docker-entrypoint.sh`.

At container startup, `docker-entrypoint.sh`:
1. Runs `server/setup-db.js` (idempotent schema migration — safe to re-run on every restart)
2. Checks if the DB is empty and auto-restores from backup if one is available at `/backups/`
3. Runs `server/create-admin.js` to create the initial admin account from `SETUP_ADMIN_*` env vars
4. Starts `server/index.js`

The app is served on port `8080` inside the container. `docker-compose.yml` maps that to `3001` on the host.

**API keys (Polygon, Google OAuth, Resend) are not baked into the image.** The admin configures them inside the app after first boot via **My Keys → App Settings**. They are stored encrypted in the database.

---

## Build & Push to Docker Hub

### Prerequisites

- Docker Desktop installed and running
- Logged in to Docker Hub: `docker login`
- Docker Hub repo: `anpwang/tradebuddy`

### Build & Push

Use `buildx` to build for both Intel (amd64) and Apple Silicon (arm64) in one shot.
The `--push` flag uploads directly to Docker Hub — required for multi-platform builds.

First-time setup (once per machine):
```bash
docker buildx create --use --name multibuilder
```

Build and push:
```bash
cd stock-trading-app

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t anpwang/tradebuddy:latest \
  --push \
  .
```

To also tag a versioned release:
```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t anpwang/tradebuddy:latest \
  -t anpwang/tradebuddy:1.2.0 \
  --push \
  .
```

After pushing, `docker pull anpwang/tradebuddy:latest` on any machine automatically gets the right image for its architecture.

---

## Install on a Brand New Machine

### Prerequisites

The target machine needs only:
- **Docker Desktop** (Mac / Windows) or **Docker Engine + Docker Compose** (Linux)
- Internet access to pull the image from Docker Hub

### Windows note

The Docker image itself runs fine on Windows — Docker Desktop uses WSL2 to run Linux containers, and `node:22-alpine` is just Linux. However:

- **`install.sh` and `backup.sh`** are bash scripts and won't run in PowerShell or CMD. Run them from the **WSL2 terminal** (which Docker Desktop installs anyway) or Git Bash.
- **The backup cron job** that `install.sh` sets up uses `crontab`, which doesn't exist on Windows. If you want scheduled backups on a Windows machine, skip that step and set up a **Windows Task Scheduler** task pointing to `bash backup.sh` instead.
- **Option B (manual install)** below works natively from PowerShell — `docker compose` commands run fine without WSL2.

### Option A — One-command install (recommended)

Create a folder for TradeBuddy, open a terminal in it, and run:

```bash
curl -fsSL https://raw.githubusercontent.com/timwangnz/stock-trading-app/main/install.sh -o install.sh && bash install.sh
```

The script downloads `docker-compose.yml` and `backup.sh` automatically — no GitHub account or source code needed.

The script will:
1. Download companion files if not already present
2. Verify Docker is running
3. Prompt for the initial admin account name/email/password
4. Auto-generate all secrets (DB password, JWT secret, etc.)
5. Write `.env`
6. Pull the image and start the stack (`docker compose up -d`)
7. Wait until the app is healthy, then scrub admin credentials from `.env`
8. Schedule a daily midnight backup cron job to `~/Documents/TradeBuddy-Backups/`
9. Open `http://localhost:3001` in the browser

After install, sign in as admin and go to **My Keys → App Settings** to add your API keys.

### Option B — Manual install

1. **Copy files** to the target machine:
   ```
   docker-compose.yml
   backup.sh
   ```

2. **Create `.env`** in the same directory:
   ```
   DB_PASSWORD=<generate with: openssl rand -hex 32>
   JWT_SECRET=<generate with: openssl rand -hex 32>
   SNAPSHOT_SECRET=<generate with: openssl rand -hex 32>
   LLM_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
   SETUP_ADMIN_NAME=Admin
   SETUP_ADMIN_EMAIL=<your email>
   SETUP_ADMIN_PASSWORD=<your password>
   ```

3. **Pull and start:**
   ```bash
   docker compose pull
   docker compose up -d
   ```

4. **Verify** the app is running:
   ```bash
   curl http://localhost:3001/api/health
   docker compose logs -f app
   ```

5. **Remove admin credentials** from `.env` once the first boot has completed:
   ```bash
   sed -i '' '/^SETUP_ADMIN_/d' .env   # macOS
   sed -i '/^SETUP_ADMIN_/d' .env       # Linux
   ```

6. **Sign in as admin** and go to **My Keys → App Settings** to add:
   - Polygon API key (live market data)
   - Google Client ID + Secret (Google sign-in, optional)
   - Resend API key (email delivery, optional)

---

## Day-to-day commands

```bash
docker compose up -d          # start
docker compose stop           # stop (keeps data)
docker compose down           # stop + remove containers (keeps DB volume)
docker compose down -v        # ⚠ stop + remove everything including DB data
docker compose logs -f app    # tail app logs
docker compose pull           # pull latest image
docker compose up -d          # restart with new image after pull
bash backup.sh                # manual backup to ~/Documents/TradeBuddy-Backups/
```

## Upgrading to a new image

```bash
docker compose pull
docker compose up -d
```

The entrypoint re-runs schema migrations on every start, so upgrades that add new DB tables are handled automatically.

---

## Backups

The `backup.sh` script dumps the Postgres database to `~/Documents/TradeBuddy-Backups/backup-YYYY-MM-DD.sql` and keeps the last 7 days. If iCloud Drive is enabled on that folder, backups sync automatically off-machine.

The container mounts `~/Documents/TradeBuddy-Backups` as `/backups` (read-only). On startup, if the DB is empty (e.g. after a disk failure wiped the Docker volume), the entrypoint automatically restores from the most recent backup in that folder.

This auto-restore only runs on the local Docker install. On cloud deployments (where `DATABASE_URL` is set, e.g. Railway), the restore step is skipped entirely.
