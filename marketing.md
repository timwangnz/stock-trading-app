# Marketing Campaign Feature — Implementation Plan

## Branch: `feature/marketing-campaigns`

### Overview
A campaign tool where admins build an audience from user/portfolio data, compose a personalized email, preview who will receive it, and send immediately or schedule it.

---

## 1. Database (`server/setup-db.js`)

Two new tables:

**`campaigns`** — the campaign definition
```
id, title, status (draft|scheduled|sent),
audience_filter JSONB,   -- segmentation conditions
subject, body_template,  -- email content with {{tokens}}
scheduled_at,            -- null = send immediately
sent_at, recipient_count,
created_by (user_id), created_at, updated_at
```

**`campaign_sends`** — one row per recipient per campaign
```
id, campaign_id, user_id,
status (sent|failed), error,
sent_at
```

---

## 2. Audience Filter Schema

Stored as JSONB, evaluated server-side:
```json
{
  "logic": "AND",
  "conditions": [
    { "field": "portfolio_value", "op": "gte", "value": 50000 },
    { "field": "trade_count",     "op": "gte", "value": 10 },
    { "field": "role",            "op": "in",  "value": ["user"] },
    { "field": "account_age_days","op": "gte", "value": 30 }
  ]
}
```

Supported fields: `portfolio_value`, `cash_balance`, `trade_count`, `account_age_days`, `last_trade_days`, `role`

---

## 3. Server (`server/campaigns.js`)

New module with:
- `resolveAudience(filter)` — runs the segment query, returns matching users with their portfolio snapshot
- `resolveTokens(template, user)` — substitutes `{{tokens}}` with per-user data (manual mode)
- `generateAIBody(prompt, user, llmConfig)` — calls `runPromptTemplate` per user with their portfolio data injected (AI mode)
- `executeCampaign(campaignId)` — loops audience, resolves body (manual or AI), sends via Resend, writes `campaign_sends` rows, updates campaign status

---

## 4. API Routes (admin-only)

```
GET    /api/admin/campaigns              -- list all campaigns
POST   /api/admin/campaigns              -- create draft
GET    /api/admin/campaigns/:id          -- get single campaign
PATCH  /api/admin/campaigns/:id          -- update draft
DELETE /api/admin/campaigns/:id          -- delete draft only

POST   /api/admin/campaigns/:id/preview        -- returns audience user list + count (no send)
POST   /api/admin/campaigns/:id/preview-email  -- AI mode only: generates email for first recipient
POST   /api/admin/campaigns/:id/send     -- execute immediately
GET    /api/admin/campaigns/:id/sends    -- send history per recipient
```

---

## 5. Frontend

**`src/pages/Campaigns.jsx`** (admin only, new nav item)
- Campaign list: title, status badge, recipient count, sent date
- New Campaign button

**Audience Builder** (inside modal)
- Add/remove condition rows: field → operator → value
- Live preview panel: "X users match" + scrollable user list (name, email, portfolio value)

**Composer — two modes**

*Manual mode* — admin writes the email body directly. `{{tokens}}` are substituted per recipient at send time. Fast, predictable, good for announcements.

Available tokens:
- `{{name}}` — recipient's display name
- `{{email}}` — recipient's email address
- `{{portfolio_value}}` — total portfolio value in USD
- `{{cash}}` — cash balance
- `{{top_holding}}` — their largest position by value
- `{{date}}` — today's date

*AI mode* — admin writes a prompt instead of the email body. The LLM generates a unique, personalised email per recipient using their real portfolio data. One LLM call per user in the audience.

Example AI prompt:
```
Write a re-engagement email for {{name}} whose portfolio is worth
{{portfolio_value}} with their largest position in {{top_holding}}.
Keep it under 150 words, friendly and encouraging tone.
```

The AI mode reuses `runPromptTemplate` from `promptRunner.js` — the only difference is it runs once per user in the segment rather than for the logged-in user. The `compose_mode` field on the campaign (`manual` | `ai`) determines which path executes.

DB addition — `campaigns` table gets:
```
compose_mode   TEXT    NOT NULL DEFAULT 'manual',  -- 'manual' | 'ai'
ai_prompt      TEXT,                               -- used when compose_mode = 'ai'
llm_config     JSONB                               -- provider/model snapshot at send time
```

UI additions:
- Mode toggle (Manual / AI) in the composer
- AI mode shows prompt textarea + token reference panel (reuse InfoPanel from Prompt Manager)
- "Preview AI output" button — runs the prompt against the first matching user and shows the generated email before sending
- Send Now vs Schedule toggle

**Send History** (expandable per campaign)
- Table of recipients: name, email, status (sent/failed), timestamp

---

## 6. Reused Infrastructure

| Need | Already have |
|---|---|
| Email delivery | `server/email.js` + Resend |
| Scheduled sends | `server/scheduler.js` pattern |
| Admin auth | `requireRole('admin')` RBAC |
| Token personalization | Prompt Manager `@token` concept |
| Admin UI shell | Existing Admin Users page |

---

## 7. Audience Builder — Natural Language

Instead of condition dropdowns, the admin describes the audience in plain English:

> "Users who joined more than 30 days ago, have made at least 5 trades, and have a portfolio worth over $50k"

The LLM translates this into the audience filter JSON, the server runs the query, and the matching user list appears immediately. The generated JSON is shown alongside so the admin can verify the interpretation.

**Why it works:** the field set is small and fixed, so hallucination risk is low. The LLM only needs to map natural language to a known schema.

**The full campaign flow becomes natural language end to end:**
```
describe audience  →  LLM generates filter JSON  →  preview matching users
describe email     →  LLM generates body per user →  preview one sample
confirm            →  send / schedule
```

---

## 8. Future Evolution — SQL MCP Server

The fixed filter JSON schema hits its ceiling as the data model grows. For complex segmentation (joins, aggregations, time windows), a **read-only SQL MCP server** is the right evolution:

```
"users who bought TSLA in the last 7 days but haven't logged in since"
          ↓  LLM generates SQL
    SELECT u.id, u.name, u.email FROM users u
    JOIN transactions t ON t.user_id = u.id
    WHERE t.symbol = 'TSLA'
      AND t.created_at >= NOW() - INTERVAL '7 days'
      AND u.last_login < NOW() - INTERVAL '7 days'
          ↓  MCP executes against Postgres (read-only)
    real results
```

This unlocks segments that are impossible with the filter JSON approach:
- "Students in class A underperforming the S&P by more than 10%"
- "Users who hold the same top 3 stocks as the highest-returning trader"
- "Accounts with no activity in 60 days but cash balance > $10k"

**Safety requirements:**
- Read-only connection (no INSERT / UPDATE / DELETE / DROP)
- Scoped to allowed tables only
- Query cost / row limit guards
- All queries logged for audit

This is the same pattern Stripe, Notion, and Linear use — exposing a query MCP endpoint so AI agents can answer arbitrary questions about their data without hardcoded API routes for every use case.

---

## 9. Build Order

1. DB migrations
2. `server/campaigns.js` — `resolveAudience` + `resolveTokens` + `executeCampaign`
3. API routes in `index.js`
4. Campaign list page + modal skeleton
5. Audience builder with live preview
6. Composer with token reference
7. Send / schedule + history view
