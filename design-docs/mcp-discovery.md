# Skills — Discovery & Management

## Concept

**Skills** are capabilities the Trading Agent can use to answer questions and take actions.
Users browse, enable, and manage skills. Internally, skills are backed by MCP servers — but
users never need to know that.

| User sees | Under the hood |
|---|---|
| Skill | MCP server + its tools |
| Enable a skill | Add MCP server to user's account |
| Built-in skill | Polygon integration, portfolio tools (hardcoded) |
| Shared skill | Admin-configured MCP server, auth key managed by platform |
| Custom skill | User-added MCP server with their own API key |

### Skill categories

| Category | Examples |
|---|---|
| Market Data | Polygon (built-in), Financial Datasets, Alpha Vantage |
| Web Search | Tavily, Brave Search, Exa |
| Productivity | Notion, Google Calendar, Slack |
| Custom | Internal tools, private servers |

---

## Problem

Today the agent has built-in market data (Polygon) and can use MCP servers the user adds manually — but users have to know the server URL and auth format, which is a technical barrier. Teachers and students shouldn't need to know what an MCP endpoint is.

The goal: a Skills page where users discover and enable agent capabilities in one click, the same way you'd install an app.

---

## Solution — Two-layer Skills system

### Layer 1 — Shared skills (admin-published)

Admin configures skills at the platform level with their own API keys. Users see them and enable with one click — no URL, no key, no setup.

```
Admin configures:  Tavily Search  →  mcp.tavily.com  +  API key
                   Exa Search     →  mcp.exa.ai      +  API key

Student sees:      [ Tavily Search — Web Search ]   [Enable]
                   [ Exa Search   — Web Search ]   [Enable]
```

Auth is resolved server-side — the user never sees the key.

### Layer 2 — Skills catalog (browsable directory)

A curated directory of well-known skills. Users browse, click install, bring their own key if needed. Admin can extend the catalog with custom entries.

### Layer 3 — Public registry (stretch goal)

Sync from a public MCP registry so the catalog stays current automatically.

---

## Built-in skills

Some skills are always available — no install needed:

| Skill | What it does |
|---|---|
| 📈 Market Data | Live prices, charts, news (Polygon) — configured by admin in App Settings |
| 💼 Portfolio | User's holdings, cash, performance |
| 📚 Knowledge Base | User's saved context, instructions, ticker notes |

These appear in the Skills page as "Built-in" with a configured/not-configured status badge.

---

## Data model

### `skill_catalog` table
Platform-level directory of available skills. Managed by admin.

```sql
CREATE TABLE skill_catalog (
  id          SERIAL        PRIMARY KEY,
  name        VARCHAR(100)  NOT NULL,
  description TEXT,
  category    VARCHAR(50),          -- 'market_data', 'search', 'productivity', 'custom'
  icon        VARCHAR(10),          -- emoji
  url         VARCHAR(500)  NOT NULL,
  auth_type   VARCHAR(20),          -- 'bearer', 'header', 'none'
  auth_hint   TEXT,                 -- shown to user when adding with own key
  docs_url    VARCHAR(500),
  is_featured BOOLEAN       NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
)
```

### `mcp_servers.scope` column
```sql
ALTER TABLE mcp_servers ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'personal';
-- 'personal' — user's own, only they use it
-- 'shared'   — admin-configured, users enable access
```

### `skill_access` table
Tracks which users have enabled which shared skills.

```sql
CREATE TABLE skill_access (
  user_id    VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id  INT         NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, server_id)
)
```

---

## API routes

### Skill catalog (all authenticated users read, admin writes)
```
GET    /api/skills/catalog               — list catalog entries
POST   /api/admin/skills/catalog         — add entry
PUT    /api/admin/skills/catalog/:id     — update entry
DELETE /api/admin/skills/catalog/:id     — remove entry
```

### Shared skills (admin publishes, users enable)
```
GET  /api/skills/shared                  — list shared skills + user's enabled status
POST /api/skills/shared/:id/enable
POST /api/skills/shared/:id/disable
```

### Personal skills (existing MCP server routes, unchanged internally)
```
GET    /api/skills                       — user's personal skills
POST   /api/skills                       — add skill (with own key)
PATCH  /api/skills/:id                   — toggle / update
DELETE /api/skills/:id
GET    /api/skills/:id/test              — verify connection
```

### Agent integration (unchanged behavior, updated loading)
When the agent runs it loads:
1. Built-in skills (Polygon, portfolio — always available)
2. User's personal enabled skills
3. Shared skills the user has enabled (auth resolved server-side)

---

## UI — Skills page

Dedicated page in the sidebar nav (replaces the MCP tab in Settings).

### Three tabs

**My Skills** — what the agent is currently using
```
Built-in
  📈 Market Data      Configured ✓        [—]
  💼 Portfolio        Always on           [—]

Enabled
  🔍 Tavily Search    Shared by school    [Disable]
  🌐 Brave Search     Your key            [Disable] [Test]

```

**From [School Name]** — shared skills the admin has set up
```
  🔍 Tavily Search    Web Search    [Enabled ✓]
  📰 Exa Search       Web Search    [Enable]
```

**Discover** — catalog browse
```
  Category: [All ▾]    [Search skills…]

  🔍 Tavily Search      search      ★ Featured    [Add with my key]
     Real-time web search for research queries

  🌐 Brave Search       search                    [Add with my key]
     Privacy-focused web search

  📊 Financial Datasets  data                     [Add with my key]
     SEC filings, earnings, fundamentals
```

Clicking "Add with my key" pre-fills the add form with the URL and shows the auth hint.

### Admin — App Settings → Skills section

**Shared Skills** — skills admin has published to all users
- Add/remove shared skills
- See how many users have enabled each

**Skill Catalog** — manage the directory
- Add/edit/remove entries
- Mark as featured
- Seed defaults button

---

## Agent conversation — skill visibility

When the agent uses a skill, show it in the chat response:

```
[Used: 🔍 Tavily Search]
Based on the latest search results, NVDA reported...
```

Future: per-conversation skill toggle in the chat toolbar so users can turn skills on/off without leaving the conversation.

---

## Seed catalog (shipped with app)

| Skill | Category | Notes |
|---|---|---|
| Tavily Search | search | Needs Tavily API key |
| Brave Search | search | Needs Brave API key |
| Exa Search | search | Needs Exa API key |
| Fetch / Web Crawl | data | No key needed |

---

## Agent integration

Skills and the agent are the same system viewed from two angles:
- **Skills page** — user-facing interface to discover, enable, and manage capabilities
- **Agent loop** — the runtime that actually calls those capabilities on behalf of the user

The agent is a first-class MCP client. Every skill the user enables is immediately available to the agent — no separate wiring needed. The agent decides which skills to invoke; the user decides which skills exist.

### Agent as MCP client

The agent loader merges three skill sources at runtime:

```
Built-in skills           (always present — Polygon, portfolio)
  +
User's personal skills    (enabled personal MCP servers)
  +
Shared skills             (admin-published, user has enabled)
  ↓
Tool list injected into LLM context as function definitions
```

From the agent's perspective all three are identical — just tool names and descriptions. The loading layer handles auth, routing, and precedence.

### Classifier-driven skill selection

The LLM classifier (see `agent-redesign.md`) reads the tool list and decides what to fetch before the main call. A richer skill library doesn't just mean more tools — it means the classifier can route to better tools:

- "What's the latest on NVDA?" → classifier sees Tavily Search is enabled → routes to web search, not just Polygon news
- "Any SEC filings for AAPL?" → classifier sees Financial Datasets skill → routes there instead of returning nothing
- No Tavily installed? Classifier degrades gracefully to Polygon news only

Zero code changes required to add skill awareness — connect the MCP server, write a good tool description, and the classifier uses it automatically. **This is how the agent learns new skills** (from `agent-redesign.md`): Access → Awareness → Judgment → Composition.

### Skill visibility in chat

When the agent calls a skill, it surfaces this in the chat response:

```
┌─────────────────────────────────────────────────────────┐
│ [🔍 Tavily Search]  [📈 Market Data]                    │
│                                                         │
│ Based on the latest results, NVDA reported stronger...  │
└─────────────────────────────────────────────────────────┘
```

- Badges appear at the top of the agent response, not inline
- Each badge links to the skill's entry in My Skills for quick context
- If no skills were called (general question path), no badges shown
- Collapsed by default on mobile

### Per-conversation skill toggle

A toolbar above the chat input lets users tune which skills are active for the current conversation:

```
[🔍 Tavily ✓]  [📊 Financial Datasets ✓]  [📈 Market Data ✓]  [+]
```

- Toggles apply only to the current conversation — doesn't change the user's global skill settings
- Useful for "research mode" (web search on) vs "quick question" (web search off, faster)
- `[+]` opens a compact skill picker showing all enabled skills
- State stored in conversation metadata, not in the skills table

### Skills page ↔ agent feedback loop

When the agent uses a skill, that's a signal worth surfacing back to the user:

```
My Skills → Tavily Search
  Used 23 times this month
  Last used: research query on NVDA earnings
  Suggested by: agent (used automatically in 18 of 23 conversations)
```

Later: per-skill success rate ("responses using this skill rated higher").

---

## Implementation plan

### Phase 1 — Shared skills (highest value)
- [ ] Add `scope` column to `mcp_servers`
- [ ] Add `skill_access` table
- [ ] `GET /api/skills/shared` + enable/disable routes
- [ ] Update agent loader — merge personal + shared skills
- [ ] Admin: create shared skills via App Settings
- [ ] UI: "From [School]" tab in Skills page

### Phase 2 — Skills page + catalog
- [ ] Add `skill_catalog` table with seed data
- [ ] Catalog API routes
- [ ] New **Skills** page in sidebar (replace MCP tab in Settings)
- [ ] Three-tab layout: My Skills / From School / Discover
- [ ] Clicking catalog entry pre-fills add form

### Phase 3 — Admin catalog management
- [ ] Catalog management in App Settings
- [ ] Featured flag, usage stats per shared skill
- [ ] Seed defaults button

### Phase 4 — Agent visibility + controls
- [ ] Show "Used: [Skill]" badge(s) at top of agent responses
- [ ] Per-conversation skill toggle toolbar above chat input
- [ ] Conversation metadata stores per-conversation skill overrides
- [ ] Badge links to skill entry in My Skills page
- [ ] Usage counter on skill card ("used N times this month")

### Phase 5 — Public registry (stretch)
- [ ] Periodic sync from public MCP registry
- [ ] Admin promotes registry entries to shared

---

## Open questions

- **Name**: "Skills" vs "Tools" vs "Integrations" — which resonates best with teachers/students?
- **Shared skill auth**: confirm auth header is never sent to browser — resolved server-side only
- **Personal key + shared conflict**: if user adds same URL personally, personal wins
- **Scope of sharing**: all users vs per-class/per-role — start with all, add filtering later
- **Built-in skill config**: Market Data skill shows "not configured" if Polygon key missing — link to App Settings
