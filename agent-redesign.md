# Agent Architecture Redesign — Hybrid Agentic Loop

## Problem

The current `agent.js` uses regex heuristics to classify user intent and route to the right behavior. This is brittle and misses natural language variations.

### What's breaking today

| User says | What happens | Should happen |
|---|---|---|
| "what's the latest?" | No tickers extracted, no data fetched, LLM says it can't browse news | Fetch general market news or portfolio news |
| "any news on my holdings?" | `isPortfolioQuery` regex misses it | Fetch news for all held tickers |
| "how's the market today?" | Treated as unknown, no data | Fetch market overview |
| "should I buy more NVDA?" | `isTradeCommand` regex misses it (no explicit quantity) | Research query, fetch NVDA price + news |
| "close out my losing positions" | May miss multi-stock intent | Understand and confirm before acting |

### Root cause

Three regex patterns make all the decisions:
```js
const isTradeCommand  = /\b(buy\s+[\d.]+|sell\s+([\d.]+|half|all)|...)\b/i.test(message)
const isResearchQuery = /\b(news|latest|update|analysis|...)\b/i.test(message)
const isPortfolioQuery = /\b(portfolio|holdings?|positions?|...)\b/i.test(message)
```

Regex can never fully capture the open-ended nature of natural language. Every edge case requires adding more patterns.

The ticker extractor has the same problem — a hardcoded company name map and uppercase-word heuristic that misses "how is Apple doing?" if "Apple" is mixed case.

---

## Proposed Solution — Hybrid Agentic Loop

Replace regex routing with a **fast LLM classifier call** that runs before the main agent call. The classifier understands intent and extracts structured data from any phrasing.

### Architecture overview

```
User message
     │
     ▼
┌─────────────────────────────────┐
│  Step 1: LLM Classifier (fast)  │  ← small/cheap model, single call
│  - Intent classification        │
│  - Ticker extraction            │
│  - Data needs assessment        │
└─────────────────────────────────┘
     │
     ├── trade_command    → Step 2A: Single LLM call + trade tools
     ├── research_query   → Step 2B: Agentic loop (LLM drives tool calls)
     ├── portfolio_query  → Step 2C: Fetch portfolio data → single LLM call
     └── general_question → Step 2D: Single LLM call, no tools
```

### Step 1 — Classifier

A single LLM call (Haiku / GPT-4o-mini, ~100ms) that returns structured JSON:

```json
{
  "intent": "research_query",
  "tickers": ["AAPL", "NVDA"],
  "needs_live_prices": true,
  "needs_news": true,
  "needs_general_market": false,
  "trade": null
}
```

For trade commands it also extracts the trade parameters:
```json
{
  "intent": "trade_command",
  "tickers": ["TSLA"],
  "needs_live_prices": true,
  "needs_news": false,
  "needs_general_market": false,
  "trade": {
    "action": "sell",
    "symbol": "TSLA",
    "quantity": "half",
    "confidence": 0.97
  }
}
```

Intent types:
- `trade_command` — explicit buy/sell/remove with clear intent
- `research_query` — news, analysis, price check, "what's happening with X"
- `portfolio_query` — questions about the user's own holdings
- `general_question` — market hours, finance concepts, app how-to

### Step 2A — Trade command (single call)

Same as today but with extracted tickers and trade params from the classifier. No change in UX.

### Step 2B — Research query (agentic loop)

The LLM is given tools and decides what to fetch:
- `get_stock_snapshot(symbols[])` — live price + change data from Polygon
- `get_stock_news(symbols[])` — latest headlines from Polygon
- `get_general_market_news()` — broad market news feed
- `search_web(query)` — MCP search tool if connected (Tavily etc.)

The LLM calls whichever tools it needs, gets results, then answers. Max 3 iterations to prevent loops.

### Step 2C — Portfolio query

Pre-fetch the user's holdings + prices, inject into context, single LLM call. Fast path — no loop needed.

### Step 2D — General question

Single LLM call with no tools. Fastest path, for things like "what is a P/E ratio?".

---

## Data fetching improvements

Current data fetching is also tied to the regex path. Redesign:

- All Polygon calls moved to explicit tool functions the LLM invokes
- `fetchGeneralMarketNews()` — new, for broad market questions
- Results streamed into context as they arrive (or batched if < 1s)
- MCP search tools treated as first-class tools alongside Polygon tools

---

## Implementation plan

### Phase 1 — Classifier (prerequisite for everything)
- [ ] Write `classifyIntent(message, portfolio)` — LLM call returning structured JSON
- [ ] Define the JSON schema (intent, tickers, needs_*, trade)
- [ ] Unit test with 20+ real user messages
- [ ] Wire into `runTradingAgent()` replacing the regex block
- [ ] Keep regex as fallback if classifier LLM call fails

### Phase 2 — Tool functions
- [ ] Extract all Polygon calls into named tool functions: `getStockSnapshot`, `getStockNews`, `getGeneralMarketNews`
- [ ] Wrap MCP tools with the same interface
- [ ] All tools return a standard `{ data, promptBlock }` shape

### Phase 3 — Agentic loop for research queries
- [ ] Implement `runResearchLoop(message, tools, llmConfig)` 
- [ ] Give LLM tool definitions + initial context
- [ ] Execute tool calls, feed results back, repeat up to `maxIterations`
- [ ] Stop when LLM returns a text response (no tool call)
- [ ] Max 3 iterations guard

### Phase 4 — Route all intents
- [ ] `trade_command` → existing single-call path (now with classifier-extracted params)
- [ ] `research_query` → new agentic loop
- [ ] `portfolio_query` → pre-fetch holdings → single call
- [ ] `general_question` → single call, no tools

### Phase 5 — Clean up
- [ ] Remove all regex heuristics (`isTradeCommand`, `isResearchQuery`, `isPortfolioQuery`, `extractTickers`, `TICKER_STOP`, `NAME_TO_TICKER`)
- [ ] Remove the regex stopgap patches made on 2026-04-26
- [ ] Update system prompt — remove instructions that were compensating for regex gaps
- [ ] Refactor into the portable AgentCore + AgentChat architecture (see below)

---

## Portable agent architecture

The agent should be a reusable framework, not a TradeBuddy-specific application.
TradeBuddy and the future CRM are both *configurations* of the same core — they
plug in different system prompts, context builders, and tool sets, but share the
same loop, classifier, and chat UI.

### Two layers

```
AgentCore  (backend — domain-agnostic)
  ├── agentLoop.js        ← classifier + tool-use loop, max iterations, streaming
  ├── classifyIntent.js   ← LLM classifier, returns structured JSON
  └── tools/
        ├── trading/      ← Polygon, portfolio, market news  (TradeBuddy)
        └── crm/          ← contacts, deals, calendar, email  (CRM)

AgentChat  (frontend — domain-agnostic)
  ├── AgentChat.jsx       ← chat panel, message history, streaming display
  ├── SkillsBadge.jsx     ← "Used: Tavily" badge in responses
  ├── SkillsToolbar.jsx   ← per-conversation skill toggle
  └── useAgent.js         ← hook connecting to /api/agent
```

### What's domain-agnostic vs domain-specific

| Domain-agnostic (shared) | Domain-specific (configured per project) |
|---|---|
| Classifier + routing logic | System prompt |
| Tool-use loop (iterate, feed results) | Context builder (portfolio / contacts) |
| Streaming / response assembly | Tool definitions (Polygon / calendar) |
| Chat UI, badges, toolbar | Agent name + persona |
| Skill loading (MCP merge) | Intent types relevant to the domain |

### The interface

`agentLoop` takes a configuration object — TradeBuddy and CRM each provide their own:

```js
// TradeBuddy
const result = await agentLoop({
  message,
  systemPrompt: TRADING_SYSTEM_PROMPT,
  buildContext: buildTradingContext,   // portfolio, live prices
  tools: tradingTools,                 // getStockSnapshot, getStockNews, ...
  skills,                              // user's enabled MCP servers
  llmConfig,
  userId,
})

// CRM (future)
const result = await agentLoop({
  message,
  systemPrompt: CRM_SYSTEM_PROMPT,
  buildContext: buildCRMContext,       // contacts, open deals, recent activity
  tools: crmTools,                     // lookupContact, createTask, sendEmail, ...
  skills,
  llmConfig,
  userId,
})
```

The loop doesn't know what a stock or a contact is. It only knows: classify intent,
build context, call tools, iterate, return response.

### AgentChat on the frontend

The chat UI is a drop-in component:

```jsx
// TradeBuddy
<AgentChat
  apiEndpoint="/api/agent"
  getToken={() => localStorage.getItem('tradebuddy_token')}
  agentName="TradeBuddy"
  placeholder="Ask about your portfolio..."
/>

// CRM (future)
<AgentChat
  apiEndpoint="/api/crm-agent"
  getToken={() => localStorage.getItem('crm_token')}
  agentName="Sales Advisor"
  placeholder="Ask about your pipeline..."
/>
```

`AgentChat` handles streaming, message history, skill badges, and the per-conversation
toolbar. It knows nothing about trading or CRM — only how to talk to `/api/agent`.

### Why design it this way now

The CRM branches from TradeBuddy. If the agent is already a framework at branch time,
the CRM gets a working agent loop for free — just swap the config. If it's still
TradeBuddy-specific, the branch requires a messy refactor before CRM work can start.

The redesign (Phases 1–4) is the right moment to get this shape right. The marginal
cost of a clean interface is low now; retrofitting later is expensive.

---

## Skill learning

For the agent to truly learn a new skill it needs all four layers:

| Layer | What it means | Status |
|---|---|---|
| **Access** | Agent can call the tool (MCP connected) | ✅ Done |
| **Awareness** | Agent knows the tool exists and what it does (description in prompt) | ✅ Done |
| **Judgment** | Agent knows *when* to use it (classifier routes correctly) | 🔲 Needs classifier |
| **Composition** | Agent chains multiple skills together (agentic loop) | 🔲 Needs loop |

Once the classifier exists, adding a new skill genuinely teaches the agent something new with zero code changes — just connect the MCP server and write a good description.

---

## Agent memory

The long-term vision: the agent learns from every interaction, building a picture of the user's preferences, behavior, and outcomes over time. Phased from explicit (user-driven) to fully implicit (agent-driven).

### Memory types

**Explicit memory** — user-driven (exists today)
The `agent_context` table lets users manually save instructions that get injected into every agent call. "I prefer dividend stocks." "Never suggest crypto." Deliberate, inspectable, editable.

**Implicit memory — learned from behavior**
The agent automatically infers and saves preferences from patterns in the conversation.
- User always asks about tech → surface tech news proactively
- User ignores small-cap suggestions → deprioritize them
- User prefers brief answers → agent calibrates response length
- Saved as structured entries in `agent_context` with `source='agent'` flag

**Outcome memory — learning from results**
Connect agent recommendations to what actually happened.
- Agent suggested buying NVDA at $180, user did it, now $220 → positive signal
- Agent suggested selling TSLA, user ignored it, stock dropped → note the miss
- Builds a track record the agent can reason about: "my last 3 TSLA suggestions lost money"
- Requires linking `agent_runs` → `transactions` → `portfolio_snapshots`

**Episodic memory — conversation history**
Agent can reference past conversations, not just the current session.
- "Last week you asked about TSLA earnings — results came in, here's what happened"
- "You've asked about AAPL 6 times this month — want to set a price alert?"
- Stored as summarized conversation logs, not raw transcripts (cost + privacy)

---

### Data model additions

**`agent_context` — extend existing table**
Add `source` column to distinguish user-written vs agent-inferred memories:
```sql
ALTER TABLE agent_context ADD COLUMN source VARCHAR(20) DEFAULT 'user';
-- 'user'   — manually written by user (current behavior)
-- 'agent'  — automatically inferred by agent from behavior
-- 'outcome' — derived from trade results
```

**`agent_episodes` — summarized conversation log**
```sql
CREATE TABLE agent_episodes (
  id         SERIAL       PRIMARY KEY,
  user_id    VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary    TEXT         NOT NULL,   -- LLM-generated summary of the conversation
  tickers    TEXT[],                  -- stocks discussed
  outcome    VARCHAR(20),             -- 'trade_executed', 'research', 'general'
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
)
```

**`agent_outcomes` — trade recommendation tracking**
```sql
CREATE TABLE agent_outcomes (
  id             SERIAL       PRIMARY KEY,
  user_id        VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol         VARCHAR(10)  NOT NULL,
  recommended_at TIMESTAMPTZ  NOT NULL,
  recommended_action VARCHAR(10),     -- 'buy', 'sell', 'hold'
  price_at_recommendation NUMERIC,
  user_acted     BOOLEAN      DEFAULT false,
  outcome_30d    NUMERIC,             -- price change 30 days later
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
)
```

---

### Memory in the agent loop

Memory is injected into the system prompt alongside the existing `agent_context`:

```
[User Memory]
• Prefers dividend stocks (explicit)
• Tends to hold long-term, rarely sells (inferred from behavior)
• Has asked about NVDA 8 times this month (episodic)
• Last NVDA suggestion (+22% in 30 days) (outcome)
```

The classifier also uses memory — "user always wants tech news" can shift intent routing before the main call even runs.

---

### User control — Memory page

Users must be able to see, edit, and delete what the agent has learned. Trust requires transparency.

```
My Agent Memory

Explicit (you wrote these)
  • I prefer dividend stocks          [Edit] [Delete]
  • Never suggest crypto              [Edit] [Delete]

Learned (agent inferred)
  • You tend to hold long-term        [Keep] [Delete]
  • You focus on tech stocks          [Keep] [Delete]

Trade outcomes (last 90 days)
  • NVDA buy suggestion → +22%  ✓
  • TSLA sell suggestion → ignored, -8%  ✗
```

---

### Privacy and safety

- Agent-inferred memories are **never saved automatically** in Phase 1 — shown to user for approval first
- Raw conversation transcripts are never stored — only LLM-generated summaries
- Users can wipe all memory with one action
- Outcome tracking only covers agent-suggested trades, not all portfolio activity
- Memory is scoped to the user — never shared or used for platform-wide training

---

## Implementation plan — Memory phases

### Phase M1 — Outcome tracking
- [ ] Add `agent_outcomes` table
- [ ] When agent suggests a buy/sell, record it in `agent_outcomes`
- [ ] Daily job: fill in `outcome_30d` for records that are 30 days old
- [ ] Show trade record in agent sidebar ("my last 5 suggestions")

### Phase M2 — Episodic memory
- [ ] After each conversation, run a summarizer LLM call → save to `agent_episodes`
- [ ] Inject recent episodes (last 5) into system prompt
- [ ] "Last week you asked about X" references

### Phase M3 — Implicit memory (with user approval)
- [ ] Add `source` column to `agent_context`
- [ ] After conversations, classifier proposes memory entries to save
- [ ] User sees "Agent wants to remember: you prefer long-term holds" → approve/reject
- [ ] Approved entries injected into every future conversation

### Phase M4 — Fully autonomous learning
- [ ] Agent saves implicit memories without approval (user can still delete)
- [ ] Outcome memory feeds back into recommendations ("my TSLA suggestions have underperformed")
- [ ] Memory influences classifier routing, not just system prompt

---

## Open questions

- **Classifier model**: use the user's configured LLM (cheaper model tier) or always use a fixed fast model?
- **Classifier latency**: adds ~100–200ms before the main call — acceptable? Could run in parallel with portfolio fetch.
- **Streaming**: does the agentic loop need to stream partial results to the UI, or is batch fine?
- **Loop depth**: 3 iterations enough? Research queries are usually resolved in 1-2 tool calls.
- **Fallback**: if classifier fails (API down, bad JSON), fall back to current regex or refuse gracefully?

---

## Notes

- The regex stopgap (`needsGeneralNews`, expanded `isPortfolioQuery`) added 2026-04-26 should be **reverted** when Phase 1 ships
- This pattern applies directly to the CRM agent — build it reusably from day one
- Related roadmap item: *Agent Architecture — Hybrid Agentic Loop* in ROADMAP.md
- For what gets injected into the context window at each step, see `context-architecture.md`
