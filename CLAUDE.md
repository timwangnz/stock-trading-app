# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
# Local dev (two terminals)
npm run dev        # Vite frontend on http://localhost:5173
npm run server     # Express API on http://localhost:3001

# Database (first-time or after schema changes)
npm run db:setup   # runs server/setup-db.js — idempotent, safe to re-run

# Build & lint
npm run build      # Vite production build → dist/
npm run lint       # ESLint (max-warnings 0)

# Docker (self-hosted install — run install.sh first, not compose directly)
docker compose up -d
docker compose logs -f app
```

There are no automated tests in this project.

---

## Architecture Overview

TradeBuddy is a **simulated stock trading platform** built as a single-repo monolith: a React SPA (Vite) + an Express API server sharing the same `package.json`. In production, Express serves the built React app from `/dist` and handles all `/api/*` routes. In development, Vite proxies `/api/*` to `localhost:3001`.

### Request flow

```
Browser → Vite dev server (5173)
              └─ /api/* proxy ──→ Express (3001) → PostgreSQL
```

JWT Bearer token auth. The token is stored in `localStorage`, sent as `Authorization: Bearer <token>` on every API request via `src/services/apiService.js`.

### Frontend navigation

There is **no React Router**. Navigation is managed entirely through `AppContext` (`src/context/AppContext.jsx`). The active page is a string key in global state, and `App.jsx` renders the corresponding component from the `PAGES` map. To add a page: create `src/pages/Foo.jsx`, import it in `App.jsx`, add it to `PAGES`, and add a nav item to `Sidebar.jsx`.

### Auth & RBAC

- `server/auth.js` — JWT sign/verify, Google OAuth token verification
- `server/rbac.js` — role hierarchy: `readonly < user < student < premium < teacher < admin`
- Frontend mirrors the same hierarchy in `src/context/AuthContext.jsx` (role helper functions are duplicated intentionally for offline use)
- `useAuth()` exposes: `user`, `token`, `isAdmin`, `isTeacher`, `isStudent`, `role`, `viewMode`
- Server-side: chain `authMiddleware` → `requireRole('admin')` or `requirePermission(PERMISSIONS.TRADE)`
- Teachers have a `viewMode` toggle (`teacher` / `trading`) stored in localStorage

### Database

All tables are defined in `server/setup-db.js` (idempotent `CREATE TABLE IF NOT EXISTS`). Run `npm run db:setup` after adding tables. The pool is a singleton in `server/db.js`. `NUMERIC` columns are auto-parsed to JS floats via `pg` type overrides.

Key tables and their purpose:

| Table | Purpose |
|---|---|
| `users` | Auth + role. Google ID is the primary key (text). |
| `user_balances` | Cash per user (separate from portfolio). |
| `portfolio` | Manual holdings: symbol, shares, avg_cost per user. |
| `transactions` | Trade history (buy/sell side, price, shares). Timestamp column is `executed_at` (not `created_at`). |
| `portfolio_snapshots` | Daily total value snapshots for history charts. |
| `dashboard_symbols` | Per-user watchlist shown on the dashboard. |
| `user_llm_settings` | Provider/model/encrypted API key per user. |
| `saved_prompts` | Prompt Manager templates with schedule + context config. |
| `agent_context` | Named context entries injected into the trading agent system prompt. |
| `agent_portfolio_settings` | AI Portfolio autopilot config (frequency, bias, universe). |
| `agent_holdings` / `agent_transactions` / `agent_runs` | AI Portfolio separate ledger (never touches the main portfolio). |
| `mcp_servers` | User-configured MCP server endpoints. |
| `classes` / `class_members` / `class_invites` | Classroom feature. |
| `trading_ideas` / `idea_reactions` | Social trading ideas feed. |
| `campaigns` / `campaign_sends` | Marketing campaign tool (admin only). |
| `audit_log` | Fire-and-forget action log via `server/audit.js`. |

### LLM layer (`server/llm.js`)

Unified `callLLM(cfg, params)` adapter supporting Anthropic, OpenAI, Google Gemini, and Ollama. All tool definitions use **Anthropic format** (`input_schema`); the adapter converts them to each provider's native format. Returns `{ text, toolName, toolInput }`.

LLM API keys are stored encrypted in `user_llm_settings.api_key_enc`. Encryption/decryption uses `server/crypto.js` with `LLM_ENCRYPTION_KEY` from env. Retrieve a user's LLM config with this pattern (used throughout `index.js`):

```js
const { rows: [row] } = await pool.query(
  'SELECT provider, model, api_key_enc FROM user_llm_settings WHERE user_id = $1', [userId]
)
const apiKey = row?.api_key_enc ? decrypt(row.api_key_enc) : null
const llmConfig = { provider: row.provider, model: row.model, apiKey }
```

### Trading agent (`server/agent.js`)

`runTradingAgent()` is the main entry point (called by `POST /api/agent`). Flow:

1. Extract ticker symbols from the user message (NLP + name→ticker map)
2. Fetch live Polygon.io quotes + news for those tickers
3. Inject portfolio snapshot + market context into the system prompt
4. Only pass trade tools (`execute_buy`, `execute_sell`, `remove_stock`) to the LLM if the message matches `isTradeCommand` regex — prevents accidental trades on portfolio questions
5. **Two-stage trade gate**: LLM must self-report `confidence ≥ 0.95` (stage 1) AND `validateTrade()` must clear funds/shares/price checks (stage 2). Below threshold → return `pendingTrade` for user confirmation
6. Live price from Polygon always overrides any user-stated price

`validateTrade()` and `executeTrade()` are exported and also used by `POST /api/agent/confirm-trade` for the human-in-the-loop confirmation flow.

### Prompt Manager (`server/promptRunner.js`)

`runPromptTemplate(template, userId)` resolves `@tokens` (data fetchers: `@portfolio`, `@watchlist`, `@market`, `@AAPL`, `@email`) and `{{builtins}}` (`{{date}}`, `{{user}}`, `{{portfolio_value}}`, etc.), optionally calls MCP tools, then calls `callLLM`. The `@email` token adds a `send_email` tool that the LLM can invoke to deliver results via Resend.

Prompts are scheduled by `server/scheduler.js` which runs every minute and checks `saved_prompts.schedule` (a weekday/time config stored as JSONB).

### AI Portfolio (`server/agentPortfolio.js`)

Separate from the main portfolio — has its own holdings, transactions, and cash. The LLM picks allocations from a fixed stock universe based on a user-written "bias" text. Runs on a user-configured frequency (daily/weekly/monthly) via `setInterval` in `index.js`. Never touches the main `portfolio` table.

### Campaigns (`server/campaigns.js`)

Admin-only email campaign tool. `resolveAudience(filter)` runs a single SQL query joining users/portfolio/balances/transactions to produce a user snapshot. `executeCampaign()` loops the audience and either does manual `{{token}}` substitution (`resolveTokens`) or one LLM call per user (`generateAIBody`), then sends via Resend. `parseAudienceDescription()` translates natural language to the audience filter JSONB via the LLM.

### Styling

Tailwind with custom color tokens. **All color values live as CSS variables in `src/index.css`** — Tailwind classes reference these variables. Dark mode is `[data-theme="dark"]` on `<html>` (set by `ThemeContext`). For recharts (which can't use CSS variables), real hex values are in `src/theme.js` under `THEMES`.

Standard token classes: `bg-surface`, `bg-surface-card`, `bg-surface-hover`, `text-primary`, `text-secondary`, `text-muted`, `text-faint`, `border-border`, `text-accent-blue`, `text-gain`, `text-loss`.

### Key patterns

**Adding a server module**: create `server/foo.js`, import and call it in `server/index.js`. All routes live in `index.js` — there is no Express Router separation (except `classRouter`, `leaderboardRouter`, `groupRouter` from `classes.js` and `ideasRouter` from `ideas.js`).

**Feature specs**: complex features have a companion markdown spec (e.g. `marketing.md`). Read these first when picking up an in-progress feature.

**Polygon market data**: `server/market.js` handles all Polygon API calls with an in-memory TTL cache (`server/cache.js`). The frontend also calls Polygon directly via `src/services/polygonApi.js` for chart data.

**MCP servers**: users can register external MCP servers (stored in `mcp_servers`). `server/mcp.js` manages sessions, calls tools, and exposes them to both the trading agent and the Prompt Manager via `@mcp:server_name:tool_name` tokens.

---

## Environment variables

See `.env.example`. Required for full functionality:
- `DATABASE_URL` (or `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`)
- `JWT_SECRET`
- `LLM_ENCRYPTION_KEY` — must be exactly 32 hex chars (`openssl rand -hex 32`)
- `POLYGON_API_KEY` — free tier at polygon.io
- `RESEND_API_KEY` — for email features (optional in dev)
- `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — for Google Sign-In (optional)
