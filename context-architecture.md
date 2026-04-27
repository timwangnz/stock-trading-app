# Context Architecture — Agent Knowledge Layer

## Core principle

Without fine-tuning, the agent's intelligence is entirely a function of what's in its
context window at call time. There is no other lever. Every improvement to the agent
is ultimately an improvement to context — what goes in, how it's structured, and how
it stays current.

**Better context = better agent. That's it.**

---

## The four context layers

Each layer adds a different dimension of intelligence. They stack — later layers
personalize without replacing earlier ones.

```
┌─────────────────────────────────────────────────┐
│  Layer 4: Learned context                       │  most personal
│  Inferred from behavior, outcomes, patterns     │
├─────────────────────────────────────────────────┤
│  Layer 3: Personal context                      │
│  User-written rules, notes, preferences         │
├─────────────────────────────────────────────────┤
│  Layer 2: Expert context packs                  │
│  Published by teachers, analysts, experts       │
├─────────────────────────────────────────────────┤
│  Layer 1: Platform defaults                     │  least personal
│  Built-in instructions, live market data        │
└─────────────────────────────────────────────────┘
```

### Layer 1 — Platform defaults (always present)

Built-in context the agent always has:
- System prompt (trading agent role, tool use rules)
- Current portfolio state (holdings, cash, P&L)
- Live market data for relevant tickers (Polygon)
- Today's date and market status

No user action required. The baseline every agent call starts from.

### Layer 2 — Expert context packs (installable)

Curated context bundles published by experts — teachers, experienced traders,
analysts. Users browse and install packs the way they install skills.

Examples:
- "Beginner Value Investing" — Buffett-style screening rules, red flags to avoid
- "Technical Analysis Basics" — support/resistance, moving averages, when to use them
- "Dividend Income Strategy" — yield thresholds, payout ratios, sector allocation
- "Risk Management Rules" — position sizing, stop losses, concentration limits

A pack is a named, versioned collection of `agent_context` entries. Installing a pack
adds its entries to the user's context. User can enable/disable individual entries.

### Layer 3 — Personal context (user-written)

What exists today in the Knowledge Base — user-written instructions, ticker notes,
and MCP rules injected into every agent call.

- "I prefer dividend stocks with yield > 3%"
- "Never suggest crypto"
- "AAPL — I bought this for the long term, don't suggest selling unless something fundamental changes"

High signal, zero noise. The user knows exactly what's here.

### Layer 4 — Learned context (agent-inferred)

Context the agent builds automatically from observing behavior, patterns, and outcomes.
Never saved without user awareness. Always inspectable and deletable.

Sub-types:
- **Behavioral** — "You hold long-term, rarely sell, focus on tech"
- **Outcome** — "Your NVDA positions have averaged +18% — agent notes this as a strong signal for you"
- **Episodic** — "Last week you asked about TSLA earnings — results came in, down 8%"
- **Preference** — "You prefer brief answers, rarely ask follow-up questions"

---

## What goes into the context window (assembled at call time)

```
[Platform defaults]
  Role + rules
  Portfolio: AAPL 10 shares @ $172, cash $45,230
  Live data: AAPL $189.40 ▲2.1% today

[Expert packs — installed]
  • [Value Investing] Always check P/E vs sector average before buying
  • [Risk Management] No single position > 20% of portfolio

[Personal context]
  • I prefer dividend stocks with yield > 3%
  • Never suggest crypto

[Learned context]
  • You tend to hold long-term (inferred from behavior)
  • NVDA suggestions have averaged +18% for you (outcome)
  • Last session: discussed TSLA earnings miss (episodic)

[Live skills output — this call only]
  • Tavily search results for "AAPL news today"
  • Polygon snapshot for AAPL, MSFT
```

---

## Expert context packs

### What a pack contains

```json
{
  "id": "value-investing-basics",
  "name": "Beginner Value Investing",
  "author": "Dr. Tim",
  "version": "1.2",
  "description": "Buffett-style rules for evaluating stocks before buying",
  "category": "strategy",
  "entries": [
    {
      "type": "instruction",
      "title": "Check P/E ratio",
      "content": "Always compare the stock's P/E ratio to its sector average. Flag if > 2x sector."
    },
    {
      "type": "instruction",
      "title": "Avoid debt traps",
      "content": "Check debt-to-equity. Be cautious if D/E > 2 for non-financial companies."
    }
  ]
}
```

### Pack lifecycle

```
Expert authors pack → publishes to platform → users discover & install
                                                        ↓
                                          Agent uses entries in every call
                                                        ↓
                                    Outcomes tracked per pack (aggregate)
                                                        ↓
                              Expert sees "users with this pack +12% avg"
                                                        ↓
                                         Expert refines pack (v1.3)
                                                        ↓
                                    Installed users get update notification
```

### The feedback loop

Outcome data aggregated across users who have a pack installed creates a signal
the expert can use to refine their context. No user data is shared — only aggregate
performance stats. Expert improves the pack → everyone benefits.

This is as close as we get to "training" without fine-tuning.

---

## Learned context — detail

### How the agent learns

After each conversation, a lightweight summarizer call extracts:
1. Any strong preference signals ("user explicitly rejected small-cap suggestion")
2. Behavioral patterns ("user asked for brief explanation — prefers concise")
3. Relevant episodes to remember ("discussed NVDA earnings, user decided to hold")

These are proposed as memory candidates — not auto-saved. User sees them and approves.

### Memory approval flow

```
End of conversation:

  Agent noticed:
  ┌─────────────────────────────────────────────────────┐
  │ 💡 Remember: you prefer to hold through volatility  │
  │    rather than selling on dips                      │
  │                          [Save to memory]  [Ignore] │
  └─────────────────────────────────────────────────────┘
```

In a later phase, auto-save with notification ("Agent saved 2 things it learned today")
and easy undo.

### Outcome tracking

When the agent recommends a trade (buy/sell) and the user acts on it:
1. Record: symbol, price, recommendation, timestamp
2. 30-day job: look up current price, calculate outcome
3. Inject summary into future conversations: "Your last 5 NVDA buys averaged +14%"

This changes how the agent reasons — it's no longer stateless between sessions.

### Episodic memory

After each conversation, save a short LLM-generated summary (2-3 sentences, not raw
transcript). Inject the last 5 episodes into context:

```
[Recent conversations]
• 3 days ago: Discussed TSLA Q1 earnings miss, decided to hold
• 1 week ago: Bought 5 shares NVDA at $820 following strong guidance
• 2 weeks ago: Asked about dividend reinvestment strategy
```

Cost: ~200 tokens per episode × 5 = 1,000 tokens added to context. Manageable.

---

## Data model

### `context_packs` table — expert-authored bundles

```sql
CREATE TABLE context_packs (
  id          VARCHAR(100) PRIMARY KEY,   -- slug: 'value-investing-basics'
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  category    VARCHAR(50),               -- 'strategy', 'risk', 'sector', 'beginner'
  author_id   VARCHAR(50)  REFERENCES users(id),
  version     VARCHAR(20)  DEFAULT '1.0',
  is_published BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
)
```

### `context_pack_entries` table — entries within a pack

```sql
CREATE TABLE context_pack_entries (
  id       SERIAL       PRIMARY KEY,
  pack_id  VARCHAR(100) NOT NULL REFERENCES context_packs(id) ON DELETE CASCADE,
  type     VARCHAR(20)  NOT NULL,   -- 'instruction', 'ticker_note', 'mcp_rule'
  title    VARCHAR(100) NOT NULL,
  content  TEXT         NOT NULL,
  ticker   VARCHAR(10),             -- for ticker_note type
  sort_order INT        DEFAULT 0
)
```

### `user_context_packs` table — which packs a user has installed

```sql
CREATE TABLE user_context_packs (
  user_id    VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id    VARCHAR(100) NOT NULL REFERENCES context_packs(id) ON DELETE CASCADE,
  enabled    BOOLEAN      NOT NULL DEFAULT true,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, pack_id)
)
```

### `agent_context` — extend existing table

```sql
ALTER TABLE agent_context ADD COLUMN source VARCHAR(20) DEFAULT 'user';
-- 'user'    — manually written by user
-- 'agent'   — inferred by agent, approved by user
-- 'outcome' — derived from trade results
ALTER TABLE agent_context ADD COLUMN pack_id VARCHAR(100) REFERENCES context_packs(id);
-- non-null when this entry came from an installed pack
```

### `agent_episodes` — summarized conversation log

```sql
CREATE TABLE agent_episodes (
  id         SERIAL       PRIMARY KEY,
  user_id    VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary    TEXT         NOT NULL,
  tickers    TEXT[],
  intent     VARCHAR(30),            -- 'trade', 'research', 'general'
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
)
```

### `agent_outcomes` — trade recommendation tracking

```sql
CREATE TABLE agent_outcomes (
  id                      SERIAL       PRIMARY KEY,
  user_id                 VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol                  VARCHAR(10)  NOT NULL,
  recommended_action      VARCHAR(10),              -- 'buy', 'sell', 'hold'
  price_at_recommendation NUMERIC,
  user_acted              BOOLEAN      DEFAULT false,
  outcome_30d             NUMERIC,                  -- % price change after 30 days
  recommended_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
)
```

---

## UI — My Context page

Replaces / extends the current Knowledge Base with a unified view of all four layers.

```
My Context

[Installed Packs]  [My Notes]  [Learned]  [Outcomes]
```

**Installed Packs tab**
- List of installed packs with enable/disable toggle
- "Browse packs" button → discovery catalog (same pattern as Skills)
- Per-pack entry list, user can disable individual entries

**My Notes tab**
- Current Knowledge Base UI (instructions, ticker notes, rules)
- Source badge: user-written vs agent-learned

**Learned tab**
- What the agent has inferred about the user
- Each entry: [Keep] [Edit] [Delete]
- Pending approvals appear here

**Outcomes tab**
- Track record: agent's trade suggestions vs actual results
- Last 90 days, per symbol
- Aggregate: "Agent suggestions averaged +X% vs market"

---

## Context pack discovery

Same pattern as Skills discovery (`mcp-discovery.md`):

- **From [School]** — packs published by the teacher/admin
- **Community** — packs published by other experts on the platform
- **Browse** — catalog with category filter

Teachers publish class-specific packs ("Econ 101 Trading Rules") that students
install in one click. The agent immediately becomes aware of the curriculum.

---

## Connection to other docs

- **`agent-redesign.md`** — the loop that consumes this context. Classifier uses layer
  metadata to route queries. Research loop uses skills. All layers assembled before
  first LLM call.
- **`mcp-discovery.md`** — Skills discovery is the parallel system for *what the agent
  can do*. Context architecture is *what the agent knows*. Together they define agent
  capability.

---

## Implementation plan

### Phase C1 — Context pack authoring + install (foundation)
- [ ] `context_packs` + `context_pack_entries` + `user_context_packs` tables
- [ ] Expert can create and publish a pack (admin/teacher role)
- [ ] Users can browse and install packs
- [ ] Installed pack entries injected into agent context alongside personal entries
- [ ] My Context page with Installed Packs tab

### Phase C2 — Outcome tracking
- [ ] `agent_outcomes` table
- [ ] Record recommendation when agent suggests a trade
- [ ] Daily job: fill in 30-day outcomes
- [ ] Outcomes tab in My Context page
- [ ] Inject outcome summary into agent context ("your last 5 NVDA buys averaged +14%")

### Phase C3 — Episodic memory
- [ ] `agent_episodes` table
- [ ] Post-conversation summarizer call → save episode
- [ ] Inject last 5 episodes into system prompt
- [ ] Episodes visible in My Context → Learned tab

### Phase C4 — Implicit memory with approval
- [ ] Post-conversation: propose memory candidates to user
- [ ] Approval UI in My Context → Learned tab
- [ ] Approved entries saved with `source='agent'`
- [ ] Agent references learned context naturally in responses

### Phase C5 — Feedback loop to experts
- [ ] Aggregate outcome stats per installed pack
- [ ] Expert sees performance dashboard for their packs
- [ ] Pack versioning — users notified of updates
- [ ] Expert can iterate packs based on outcome data

---

## Open questions

- **Context window budget**: how many tokens per layer? Need limits so context doesn't crowd out live data.
- **Pack conflicts**: two packs give contradictory instructions — last-installed wins, or explicit priority?
- **Privacy**: outcome data aggregated for expert feedback — confirm no individual data shared.
- **Pack monetization**: future — experts charge for premium packs? Out of scope for now, but worth keeping the data model flexible.
- **Auto-save threshold**: in Phase C4, how many observations before agent is confident enough to propose a memory entry?
