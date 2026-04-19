#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# TradeBuddy — install.sh
# One-command local installer for macOS (and Linux).
#
# Usage:
#   bash install.sh
#
# What it does:
#   1. Checks Docker is installed and running
#   2. Asks for your API keys interactively
#   3. Generates all secrets automatically
#   4. Writes .env
#   5. Builds and starts the app with docker compose
#   6. Opens http://localhost:3001 in your browser
# ─────────────────────────────────────────────────────────────────

set -e

# ── Colours ───────────────────────────────────────────────────────
BOLD="\033[1m"
BLUE="\033[1;34m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
DIM="\033[2m"
RESET="\033[0m"

# ── Helpers ───────────────────────────────────────────────────────
print_header() {
  echo ""
  echo -e "${BLUE}${BOLD}$1${RESET}"
  echo -e "${DIM}$(printf '─%.0s' {1..50})${RESET}"
}

print_step() {
  echo -e "${GREEN}✓${RESET} $1"
}

print_info() {
  echo -e "${DIM}  $1${RESET}"
}

print_warn() {
  echo -e "${YELLOW}⚠${RESET}  $1"
}

print_error() {
  echo -e "${RED}✗${RESET} $1"
}

ask() {
  local prompt="$1"
  local var="$2"
  local default="$3"
  local secret="$4"

  if [ -n "$default" ]; then
    echo -ne "${BOLD}$prompt${RESET} ${DIM}[${default}]${RESET}: "
  else
    echo -ne "${BOLD}$prompt${RESET}: "
  fi

  if [ "$secret" = "true" ]; then
    read -rs value
    echo ""
  else
    read -r value
  fi

  if [ -z "$value" ] && [ -n "$default" ]; then
    value="$default"
  fi

  eval "$var='$value'"
}

gen_secret() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null \
    || openssl rand -hex 32
}

# ── Banner ────────────────────────────────────────────────────────
clear
echo ""
echo -e "${BLUE}${BOLD}"
echo "  ████████╗██████╗  █████╗ ██████╗ ███████╗"
echo "     ██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝"
echo "     ██║   ██████╔╝███████║██║  ██║█████╗  "
echo "     ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝  "
echo "     ██║   ██║  ██║██║  ██║██████╔╝███████╗"
echo "     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝"
echo -e "${RESET}"
echo -e "  ${BOLD}Buddy${RESET} — Vibe Trading Platform"
echo -e "  ${DIM}Local installer · takes about 2 minutes${RESET}"
echo ""

# ── Step 1: Check Docker ──────────────────────────────────────────
print_header "Step 1 — Checking Docker"

if ! command -v docker &>/dev/null; then
  print_error "Docker is not installed."
  echo ""
  echo "  Please install Docker Desktop first:"
  echo -e "  ${BLUE}https://www.docker.com/products/docker-desktop/${RESET}"
  echo ""
  echo "  Then run this script again."
  exit 1
fi

if ! docker info &>/dev/null; then
  print_error "Docker is installed but not running."
  echo ""
  echo "  Please start Docker Desktop and try again."
  exit 1
fi

print_step "Docker is running ($(docker --version | cut -d' ' -f3 | tr -d ','))"

# ── Check for existing .env ───────────────────────────────────────
if [ -f .env ]; then
  echo ""
  print_warn ".env already exists."
  ask "  Overwrite it with fresh settings? (y/N)" OVERWRITE_ENV "N"
  if [[ ! "$OVERWRITE_ENV" =~ ^[Yy]$ ]]; then
    echo ""
    print_step "Keeping existing .env — skipping to build step."
    SKIP_ENV=true
  fi
fi

# ── Step 2: API Keys ──────────────────────────────────────────────
if [ "${SKIP_ENV}" != "true" ]; then

print_header "Step 2 — API Keys"

echo -e "  TradeBuddy needs a few API keys to work."
echo -e "  ${DIM}All keys are stored locally in .env — never sent anywhere.${RESET}"
echo ""

# Polygon.io
echo -e "  ${BOLD}Polygon.io${RESET} — live market data"
print_info "Get a free key at: https://polygon.io → sign up → API Keys"
echo ""
ask "  Polygon API key" POLYGON_API_KEY ""
echo ""

# Resend (optional)
echo -e "  ${BOLD}Resend${RESET} — password reset emails ${DIM}(optional — skip to disable email)${RESET}"
print_info "Get a free key at: https://resend.com → API Keys"
echo ""
ask "  Resend API key (press Enter to skip)" RESEND_API_KEY ""
ask "  From email address" EMAIL_FROM "TradeBuddy <onboarding@resend.dev>"
echo ""

# Google OAuth (optional)
echo -e "  ${BOLD}Google Sign-In${RESET} — Google OAuth ${DIM}(optional — skip to use email/password only)${RESET}"
print_info "Get credentials at: https://console.cloud.google.com → Credentials → OAuth 2.0"
echo ""
ask "  Google Client ID (press Enter to skip)" GOOGLE_CLIENT_ID ""
echo ""

# Admin account
echo -e "  ${BOLD}Admin account${RESET} — first user with full access"
print_info "You can sign in with this account to manage other users."
echo ""
ask "  Admin name" ADMIN_NAME "Admin"
ask "  Admin email" ADMIN_EMAIL ""
ask "  Admin password (min 8 characters)" ADMIN_PASSWORD "" "true"
echo ""

# ── Step 3: Generate secrets ──────────────────────────────────────
print_header "Step 3 — Generating secrets"

DB_PASSWORD=$(gen_secret)
JWT_SECRET=$(gen_secret)
SNAPSHOT_SECRET=$(gen_secret)
LLM_ENCRYPTION_KEY=$(gen_secret)

print_step "DB password generated"
print_step "JWT secret generated"
print_step "Snapshot secret generated"
print_step "LLM encryption key generated"

# ── Step 4: Write .env ────────────────────────────────────────────
print_header "Step 4 — Writing .env"

cat > .env <<EOF
# ── Generated by install.sh on $(date) ──

# Database (managed by Docker — do not change DB_HOST)
DB_HOST=db
DB_PORT=5432
DB_USER=tradebuddy
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=tradebuddy

# App
API_PORT=3001
APP_URL=http://localhost:3001
NODE_ENV=production

# Secrets (auto-generated — do not share)
JWT_SECRET=${JWT_SECRET}
SNAPSHOT_SECRET=${SNAPSHOT_SECRET}
LLM_ENCRYPTION_KEY=${LLM_ENCRYPTION_KEY}

# Market data
POLYGON_API_KEY=${POLYGON_API_KEY}

# Email (password reset)
RESEND_API_KEY=${RESEND_API_KEY:-re_placeholder}
EMAIL_FROM=${EMAIL_FROM}

# Google OAuth (optional)
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=

# Admin setup — removed automatically after first boot
SETUP_ADMIN_NAME=${ADMIN_NAME}
SETUP_ADMIN_EMAIL=${ADMIN_EMAIL}
SETUP_ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF

print_step ".env written"

fi # end SKIP_ENV

# ── Step 5: Build & start ─────────────────────────────────────────
print_header "Step 5 — Building & starting TradeBuddy"

echo -e "  ${DIM}This takes 2–3 minutes on first run (downloading and building).${RESET}"
echo -e "  ${DIM}Subsequent starts take about 5 seconds.${RESET}"
echo ""

docker compose pull
docker compose up -d

# Wait for the app to be ready
echo ""
echo -ne "  Waiting for app to be ready"
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/api/health &>/dev/null; then
    break
  fi
  echo -ne "."
  sleep 2
done
echo ""

if ! curl -sf http://localhost:3001/api/health &>/dev/null; then
  print_warn "App is taking longer than expected to start."
  print_info "Check logs with: docker compose logs -f app"
else
  print_step "App is ready!"

  # Scrub admin credentials from .env now that the container has used them
  sed -i.bak '/^SETUP_ADMIN_/d' .env && rm -f .env.bak
  print_step "Admin credentials removed from .env (stored securely in the database)"
fi

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  🎉 TradeBuddy is running!${RESET}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Open your browser:  ${BLUE}${BOLD}http://localhost:3001${RESET}"
echo ""
echo -e "  ${DIM}Useful commands:${RESET}"
echo -e "  ${DIM}  docker compose stop        ← stop TradeBuddy${RESET}"
echo -e "  ${DIM}  docker compose start       ← start again${RESET}"
echo -e "  ${DIM}  docker compose logs -f app ← view logs${RESET}"
echo ""

# Open browser (macOS)
if command -v open &>/dev/null; then
  sleep 1
  open http://localhost:3001
fi
