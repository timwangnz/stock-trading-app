# Vantage — Vibe Trading App

A full-stack vibe trading application for learning markets without real money. Users manage a simulated portfolio, track a watchlist, view live price charts, interact with an AI trading agent, and build expert prompt templates with live data injection — all powered by their own LLM API key.

---

## What You Get

- **Portfolio** — buy, sell, and track stocks with simulated money
- **Live market data** — charts and price snapshots via Polygon.io
- **AI trading agent** — conversational agent powered by the user's own Anthropic, OpenAI, or Google Gemini key; supports MCP tool servers
- **Prompt Manager** — expert prompt builder with `@token` syntax for injecting live data; stateless, re-runnable, MCP-capable (see below)
- **Agent Context** — per-user instructions, ticker notes, and MCP rules auto-injected into the trading agent on every conversation
- **Classroom & Groups** — teachers can create classes, invite students, and monitor leaderboards
- **Ideas board** — share and react to trading ideas within a class or group
- **Google Sign-In + email/password** authentication with password reset
- **Admin panel** — manage user roles and disable accounts
- **Role-based access** — admin, teacher, premium, student, user, and read-only tiers

---

## Architecture

```
Browser (React + Vite)
        │
        ▼
Express API server (Node 22)
  ├── Auth (JWT + Google OAuth)
  ├── Portfolio & Watchlist & Transactions
  ├── Market data proxy (Polygon.io)
  ├── AI Trading Agent (Anthropic / OpenAI / Gemini / Ollama)
  │     └── MCP tool servers (user-configured, Streamable HTTP)
  ├── Prompt Manager
  │     ├── Token resolver  (@portfolio, @AAPL, @AAPL:financials, …)
  │     ├── Built-in vars   ({{date}}, {{user}}, {{market_status}}, …)
  │     └── Stateless LLM run + MCP capability grants
  ├── Agent Context (auto-injected per-user instructions)
  ├── Classes, Groups, Leaderboard, Ideas
  └── Customer Profile & Audit Log
        │
        ▼
PostgreSQL database
```

The Express server serves both the React frontend (as compiled static files) and the REST API under `/api/*`. A single process, a single port.

---

## Office Network Setup

### Prerequisites

Install these on the machine that will run Vantage (or the server it runs on):

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org) | 22 LTS | Includes npm |
| [PostgreSQL](https://www.postgresql.org/download/) | 14 or later | Can use a shared office DB server |
| Git | Any | To clone the repo |

You will also need accounts and API keys from:

| Service | Purpose | Cost | Link |
|---------|---------|------|------|
| [Polygon.io](https://polygon.io) | Live market data | Free tier available | polygon.io |
| LLM provider | AI trading agent (per user) | Pay-as-you-go | Anthropic / OpenAI / Google |
| [Resend](https://resend.com) | Password reset emails | Free tier (100/day) | resend.com |
| Google Cloud | Google Sign-In (optional) | Free | console.cloud.google.com |

> **Note:** Each user brings their own LLM API key. Vantage does not use a shared API key for the trading agent — users enter theirs in the app settings.

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/timwangnz/stock-trading-app.git tradebuddy
cd tradebuddy
npm install
```

---

### Step 2 — Create the PostgreSQL Database

Connect to your PostgreSQL server (local or shared office server) and run:

```sql
CREATE DATABASE tradebuddy;
CREATE USER tradebuddy_user WITH PASSWORD 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE tradebuddy TO tradebuddy_user;
```

You can use `psql`, pgAdmin, or any PostgreSQL client your office already has.

---

### Step 3 — Configure Environment Variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set each value:

```bash
# ── Database ────────────────────────────────────────────────────
DB_HOST=localhost          # or your office DB server IP
DB_PORT=5432
DB_USER=tradebuddy_user
DB_PASSWORD=choose-a-strong-password
DB_NAME=tradebuddy

# ── Server ──────────────────────────────────────────────────────
API_PORT=3001              # port the Express server listens on
APP_URL=http://YOUR-SERVER-IP:3001   # or your domain name

# ── Security ────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<64-char hex string>
SNAPSHOT_SECRET=<64-char hex string>

# AES-256 key for encrypting user LLM API keys at rest
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
LLM_ENCRYPTION_KEY=<64-char hex string>

# ── Polygon.io (market data) ────────────────────────────────────
POLYGON_API_KEY=<your polygon key>

# ── Email (password reset) ──────────────────────────────────────
RESEND_API_KEY=<your resend key>
EMAIL_FROM=Vantage <noreply@yourdomain.com>

# ── Google Sign-In (optional) ───────────────────────────────────
GOOGLE_CLIENT_ID=<your google client id>
VITE_GOOGLE_CLIENT_ID=<same value>
GOOGLE_CLIENT_SECRET=<your google client secret>
```

To generate the three secret keys in one go:

```bash
node -e "
  const { randomBytes } = require('crypto');
  console.log('JWT_SECRET=' + randomBytes(32).toString('hex'));
  console.log('SNAPSHOT_SECRET=' + randomBytes(32).toString('hex'));
  console.log('LLM_ENCRYPTION_KEY=' + randomBytes(32).toString('hex'));
"
```

---

### Step 4 — Initialise the Database Schema

This creates all tables. It is safe to run again — it uses `IF NOT EXISTS` guards.

```bash
npm run db:setup
```

You should see output like:

```
🔧 Setting up Vantage database (PostgreSQL)…
✅ users
✅ portfolio
✅ watchlist
✅ audit_log
✅ user_llm_settings
✅ password_reset_tokens
🎉 All tables ready.
```

---

### Step 5 — Build the Frontend

```bash
npm run build
```

This compiles the React app into the `dist/` folder. The Express server serves these files automatically.

> **Important:** If you change `VITE_GOOGLE_CLIENT_ID` or any other `VITE_` variable, you must re-run `npm run build` because these values are baked into the frontend bundle at build time.

---

### Step 6 — Start the Server

```bash
npm run server
```

The app will be available at `http://YOUR-SERVER-IP:3001`.

For development with hot-reload on both frontend and backend, open two terminals:

```bash
# Terminal 1 — backend
npm run server

# Terminal 2 — frontend dev server (proxies /api to port 3001)
npm run dev
```

---

### Step 7 — Create the First Admin Account

Sign up through the app UI using email and password. Then promote that account to admin directly in the database:

```bash
psql -U tradebuddy_user -d tradebuddy -c \
  "UPDATE users SET role = 'admin' WHERE email = 'your@email.com';"
```

From that point you can manage other users (promote, demote, disable) from the **Admin** panel inside the app.

---

## Running as a Background Service (Linux / Office Server)

To keep Vantage running after you close the terminal, create a systemd service.

Create `/etc/systemd/system/tradebuddy.service`:

```ini
[Unit]
Description=Vantage Vibe Trading App
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/tradebuddy
EnvironmentFile=/opt/tradebuddy/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable tradebuddy
sudo systemctl start tradebuddy
sudo systemctl status tradebuddy
```

---

## Running with Docker (Recommended for Office Networks)

If your office already has Docker, this is the easiest deployment path.

**Build the image:**

```bash
docker build \
  --build-arg VITE_GOOGLE_CLIENT_ID=your-google-client-id \
  -t tradebuddy .
```

**Run the container:**

```bash
docker run -d \
  --name tradebuddy \
  --restart unless-stopped \
  -p 3001:8080 \
  --env-file .env \
  tradebuddy
```

The app will be accessible at `http://YOUR-SERVER-IP:3001`.

---

## Google Sign-In Setup (Optional)

If you want users to sign in with their Google/Gmail accounts:

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Click **Create Credentials** → **OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Add your server's address to **Authorised JavaScript origins**:
   ```
   http://YOUR-SERVER-IP:3001
   https://yourdomain.com   ← if using a domain
   ```
5. Copy the **Client ID** and **Client Secret** into `.env`
6. Re-run `npm run build` (the client ID is baked into the frontend)

> Google OAuth changes can take up to 5 minutes to propagate. If sign-in fails immediately after setup, wait a few minutes and try again.

Email/password sign-up always works without Google OAuth configured.

---

## User Guide (for office users)

Once signed in, each user needs to configure their own AI provider before using the Trading Agent:

1. Click the **sparkle icon** (✨) in the top-right to open the Trading Agent panel
2. Click the **gear icon** (⚙️) to open AI settings
3. Choose a provider: **Anthropic**, **OpenAI**, or **Google Gemini**
4. Select a model
5. Enter your personal API key from the provider's dashboard
6. Click **Save Settings**

Where to get API keys:
- Anthropic: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Google: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

API keys are encrypted with AES-256-GCM before being stored. They are never shared and are only used to call the provider on the user's behalf.

---

## Prompt Manager

The Prompt Manager (sidebar → **Wand icon**) lets expert users build stateless, re-runnable prompt templates that pull in live data at run time — no conversation history, no hidden system prompt.

### Token Syntax

Write a template in plain text using two token families:

**`{{variable}}` — built-in variables, resolved server-side**

| Token | Resolves to |
|-------|-------------|
| `{{date}}` | Today's date — `YYYY-MM-DD` |
| `{{time}}` | Current time in ET — `HH:MM ET` |
| `{{day}}` | Day of the week |
| `{{user}}` | Logged-in user's display name |
| `{{market_status}}` | `Open` or `Closed` |

**`@token` — live data injections and MCP capability grants**

| Token | Resolves to |
|-------|-------------|
| `@portfolio` | Current holdings and cash balance |
| `@watchlist` | Watchlist symbols |
| `@market` | Live price snapshot for all portfolio + watchlist symbols |
| `@AAPL` | Live quote for a specific ticker |
| `@AAPL:financials` | Annual financial statements (income, balance sheet, cash flow) |
| `@AAPL:financials:quarterly` | Quarterly financial statements |
| `@mcp:server_name:tool_name` | MCP capability grant — makes the tool available to the LLM |

### Example Template

```
You are a portfolio analyst. Today is {{date}} ({{day}}).
Market: {{market_status}}

## Holdings
@portfolio

## Watchlist
@watchlist

## Live Prices
@market

## Financials
@AAPL:financials @TSLA:financials

## Tools available
@mcp:brave:web_search

## Tasks
1. Identify my top 3 concentration risks
2. Flag watchlist stocks that look attractive relative to my holdings
3. Compare AAPL and TSLA on revenue growth and margins
4. Search for any recent news that might affect my positions
```

### How It Works

1. **Parse** — the server extracts all `{{}}` and `@` tokens from the template
2. **Validate on save** — unknown tokens or unavailable MCP servers are flagged before saving
3. **Resolve at run time** — data tokens (`@portfolio`, `@AAPL`, etc.) are fetched in parallel and substituted into the prompt text; built-ins (`{{date}}` etc.) are resolved immediately
4. **MCP grants** — `@mcp:server:tool` tokens make that tool available to the LLM; the model decides when and how to call it based on the resolved context
5. **Single stateless LLM call** — the fully resolved prompt is sent as a one-shot request with no conversation history; the model may call MCP tools and receive their results in follow-up turns (capped at 5)

### Autocomplete

In the prompt editor, type `@` or `{{` to get an inline autocomplete dropdown. MCP server and tool names are populated from your connected servers. Clicking any token in the reference panel on the right inserts it at the cursor.

### Agent Context (separate from Prompt Manager)

The **Agent Context** tab manages per-user context entries that are automatically injected into the **Trading Agent** (the chat panel) on every conversation — not into Prompt Manager templates. Three types:

- **Instructions** — global rules the agent follows (e.g. "Always consider tax implications")
- **Ticker Notes** — research notes tied to a specific stock
- **MCP Rules** — instructions for when and how the agent should use its tools

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | Yes | PostgreSQL port (default: 5432) |
| `DB_USER` | Yes | PostgreSQL username |
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `DB_NAME` | Yes | Database name |
| `DATABASE_URL` | Alt | Full connection string (overrides above — for Railway/Neon) |
| `API_PORT` | No | Express port, default 3001 |
| `APP_URL` | Yes | Full public URL (used in reset email links) |
| `JWT_SECRET` | Yes | 64-char hex string for signing JWTs |
| `LLM_ENCRYPTION_KEY` | Yes | 64-char hex string for encrypting user API keys |
| `SNAPSHOT_SECRET` | Yes | Secret for the internal snapshot endpoint |
| `POLYGON_API_KEY` | Yes | Polygon.io key for market data |
| `RESEND_API_KEY` | Yes | Resend key for password reset emails |
| `EMAIL_FROM` | Yes | Sender address, e.g. `Vantage <noreply@yourdomain.com>` |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth client secret |
| `VITE_GOOGLE_CLIENT_ID` | Optional | Same as above — baked into the frontend at build time |
| `NODE_ENV` | No | Set to `production` in production |

---

## Upgrading

When you pull a new version of Vantage:

```bash
git pull
npm install           # install any new dependencies
npm run db:setup      # apply any new tables and column migrations (safe to re-run)
npm run build         # rebuild the frontend
sudo systemctl restart tradebuddy   # or docker restart tradebuddy
```

`npm run db:setup` uses `IF NOT EXISTS` guards and `ADD COLUMN IF NOT EXISTS` migrations throughout, so it is always safe to re-run against an existing database. New tables added in recent versions include `agent_context`, `saved_prompts`, `mcp_servers`, `groups`, and `customer_profiles`.

---

## Health Check

Verify the server is running:

```bash
curl http://localhost:3001/api/health
# → {"status":"ok"}
```

---

## Troubleshooting

**"Cannot connect to database"**
Check that PostgreSQL is running and the credentials in `.env` are correct. Test with:
```bash
psql -h $DB_HOST -U $DB_USER -d $DB_NAME
```

**"No API key configured" in the Trading Agent**
Each user must add their own API key in the agent settings panel (⚙️). Vantage does not provide a shared key.

**Market data not loading**
Verify `POLYGON_API_KEY` is set correctly. The free Polygon tier has a 15-minute data delay and rate limits — this is expected.

**Password reset emails not arriving**
Check that `RESEND_API_KEY` and `EMAIL_FROM` are set. On Resend's free tier, you can only send from `@resend.dev` addresses unless you verify a custom domain.

**Google Sign-In says "origin not allowed"**
The server's URL must be listed in Google Cloud Console → Credentials → Authorised JavaScript origins. After adding it, wait up to 5 minutes for changes to take effect.
