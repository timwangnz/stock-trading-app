# Platform Vision — AI-Native Vertical SaaS Framework

*April 2026 · Internal · Evolving document*

---

## The Insight

TradeBuddy was built as a stock trading app. But look past the trading domain and what
exists is something more valuable: a **complete infrastructure for AI-native business
applications** — multi-provider LLM routing, encrypted credential storage, MCP tool
integration, role-based auth, scheduled agents, audit logging, email, and an admin
configuration layer.

That infrastructure has no opinion about trading. It just happens to be pointed at
a trading use case right now.

Meridian proved this. Adding a second product — a multi-platform ecommerce analytics
platform — required writing connectors and UI pages, but zero new infrastructure.
Auth, encryption, the LLM adapter, the agent loop, the prompt scheduler, the MCP
layer: all of it transferred directly.

The conclusion: **we are not building products. We are building the platform that
powers a family of products.**

---

## What the Platform Is

A framework for building AI-native vertical SaaS applications that:

- Deploy independently (each product is its own app)
- Share a common infrastructure layer (auth, LLM, storage, agents)
- Are configured, not forked (a new product is a new configuration, not a new codebase)
- Get smarter over time (the agent architecture — classifier, loop, memory, context
  packs — is domain-agnostic and improves every product simultaneously)

Each product answers four questions. Everything else is already solved.

```
┌─────────────────────────────────────────────────────────────────┐
│                        PLATFORM CORE                            │
│                                                                 │
│  Auth & RBAC · Encrypted storage · LLM adapter (4 providers)   │
│  Agent loop · MCP client · Prompt scheduler · Admin settings    │
│  Audit log · Email · Cache · Error logging                      │
└────────────────────────┬────────────────────────────────────────┘
                         │  shared by all products
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   TradeBuddy        Meridian          CRM (next)
   (trading)       (ecommerce)        (sales)
         │               │               │
   Connectors:     Connectors:      Connectors:
   Polygon,        SP-API,          HubSpot,
   Polygon news    Shopify,         Gmail,
                   eBay             Calendar
         │               │               │
   Agent tools:    Agent tools:     Agent tools:
   buy/sell,       sync/report,     log call,
   price alerts    reorder alert    create deal
         │               │               │
   UI pages:       UI pages:        UI pages:
   Dashboard,      Dashboard,       Pipeline,
   Portfolio,      Orders,          Contacts,
   Agent chat      Inventory        Agent chat
```

---

## The Four Questions

Every new product answers these. Nothing else is unique to a product.

**1. What data does it connect to?**
The connector layer. OAuth flows, token management, API adapters, data normalization.
Each platform (Amazon, Shopify, Polygon, HubSpot) is a connector module. Connectors
implement a shared interface; the platform handles auth, encryption, and scheduling.

**2. What does the agent know and do?**
The system prompt + tool set. The agent loop, classifier, memory system, and MCP
integration are domain-agnostic. A new product writes a system prompt describing its
domain and registers tools the agent can call. The loop handles the rest.

**3. What does the user see?**
The frontend module. Pages, components, and sidebar navigation specific to the product.
Built on shared UI primitives, auth context, and API client — no new design system.

**4. What does it need stored?**
The DB tables. Added idempotently alongside shared tables. The common pool, migrations
pattern, and type parsing are already in place.

---

## Current Products

### TradeBuddy — Simulated Stock Trading Platform
*Status: Live*

A stock trading simulator used in educational settings (classrooms, self-directed
learners). Features a trading agent that executes simulated trades, researches stocks,
and answers portfolio questions using live Polygon data.

**Domain:** Financial markets education
**Connectors:** Polygon.io (prices, news, financials)
**Agent tools:** `execute_buy`, `execute_sell`, `get_stock_snapshot`, `get_stock_news`, `get_general_market_news`
**Key features:** Classroom management, leaderboards, teacher roles, AI portfolio autopilot, prompt manager

---

### Meridian — Multi-Channel Ecommerce Analytics
*Status: POC planned*

A unified analytics platform for merchants selling across Amazon, Shopify, eBay, and
TikTok Shop. Connects every layer of the business — supply chain, multi-platform sales,
and marketing attribution — into a single dashboard with AI-driven recommendations.

**Domain:** Ecommerce merchant intelligence
**Connectors:** Amazon SP-API, Shopify Admin API, eBay Sell API, TikTok Shop API (phased)
**Agent tools:** `sync_platform`, `get_revenue_summary`, `get_inventory_alerts`, `get_attribution_report`
**Key differentiator:** Factory-to-customer visibility + true cross-platform attribution in one product — no competitor combines both for SMB merchants

See `meridian-amazon.md` for full product detail.

---

### CRM — AI-Native Sales Intelligence
*Status: Concept*

A sales CRM where the agent understands the pipeline, logs calls, drafts follow-ups,
and surfaces which deals need attention — without the manual data entry that kills
adoption in conventional CRMs.

**Domain:** B2B sales and relationship management
**Connectors:** Gmail, Google Calendar, HubSpot (import), LinkedIn
**Agent tools:** `log_interaction`, `create_deal`, `schedule_followup`, `draft_email`, `summarize_pipeline`
**Key differentiator:** Agent that proactively manages the pipeline rather than passively recording it

---

## The Agent Layer Is the Moat

Each product has connectors and UI pages — those are table stakes. The durable
advantage is the agent architecture, and it compounds across products.

### What the agent framework already provides

```
AgentCore (domain-agnostic)
  ├── classifyIntent.js   ← LLM classifier, returns structured JSON
  ├── agentLoop.js        ← tool-use loop, max iterations, streaming
  └── tools/
        ├── trading/      ← Polygon, portfolio, market news
        ├── meridian/     ← platform sync, inventory, attribution
        └── crm/          ← contacts, deals, calendar, email

AgentChat (domain-agnostic frontend)
  ├── AgentChat.jsx       ← chat panel, streaming, message history
  ├── SkillsBadge.jsx     ← "Used: Tavily Search" in responses
  └── useAgent.js         ← hook connecting to /api/agent
```

A new product wires in its system prompt, context builder, and tool set. The loop,
classifier, streaming, MCP integration, and chat UI come free.

### The memory system compounds

As described in `agent-redesign.md` and `context-architecture.md`, the agent builds
memory across four layers: platform defaults, expert context packs, personal notes,
and learned behaviour. This system is product-agnostic — every new product inherits
it immediately. An agent that learns a Meridian merchant's reorder preferences today
uses the same memory infrastructure that learns a TradeBuddy student's risk tolerance.

### Skills (MCP) transfer

A web search skill (Tavily, Brave) installed by a TradeBuddy user is available to
the Meridian agent and the CRM agent on day one. The MCP client, server registry,
and skill discovery UI are shared. Skills compound in value the more products use them.

---

## Deployment Model

### Single-product deployment (default)

```bash
PRODUCT=tradebuddy   # TradeBuddy only
PRODUCT=meridian     # Meridian only
PRODUCT=crm          # CRM only
```

One codebase, one Docker image, one env var. Each product deploys independently to
its own domain (`app.tradebuddy.io`, `app.meridian.io`, `app.crm.io`).

### Multi-product deployment (future)

```bash
PRODUCT=all          # All products under one login
```

A single organisation runs multiple products. Users see only the products their role
grants access to. Useful for operators who use both TradeBuddy (for teaching) and
Meridian (for their own ecommerce business).

### Per-product branding

Stored in `app_settings`, read via `ConfigContext.jsx` on load:

| Setting | TradeBuddy | Meridian | CRM |
|---|---|---|---|
| `app_name` | TradeBuddy | Meridian | (TBD) |
| `accent_color` | #0e7490 | #0d9488 | (TBD) |
| `app_logo_url` | — | — | — |

---

## What Makes a Good Product for This Platform

Not every vertical is a fit. The products that compound best on this platform share
a profile:

**Data-rich but fragmented.** The merchant has their data spread across 6–9 disconnected
tools. The student has their learning across markets, news, and a portfolio. The
salesperson has their pipeline across email, calls, CRM, and calendar. The platform's
value is unification.

**Agent-suitable workflows.** The user's questions are natural language. The answers
require fetching live data, reasoning over it, and sometimes taking action. A static
dashboard is not enough — the agent is the differentiator.

**Recurring, high-frequency use.** The user returns daily. The agent gets smarter.
The memory system accrues value. A one-time use case doesn't benefit from the memory
and learning layers.

**Clear role hierarchy.** Teacher/student, admin/user, manager/rep. The RBAC system
is already built. Products that have a natural authority structure get it for free.

**Good candidates beyond current roadmap:**
- **Property management** — landlords, tenants, maintenance requests, rent tracking
- **Healthcare practice** — patient follow-ups, appointment scheduling, billing summaries
- **Creator/agency** — brand deal tracking, content calendar, audience analytics
- **Supply chain** — freight tracking, supplier communication, PO management (partial overlap with Meridian)

---

## The Compounding Flywheel

```
New product added
      │
      ▼
Connectors built for that domain
      │
      ▼
Agent tools and system prompt configured
      │
      ▼
Users interact with the agent daily
      │
      ▼
Memory system learns user preferences
      │
      ▼
Expert context packs published for the domain
      │
      ▼
Platform infrastructure improves (benefits all products)
      │
      └──────────────────────────────────────────┐
                                                 ▼
                                      Next product added
                                      (faster, cheaper,
                                       better agent from day 1)
```

Each product makes the platform more valuable. The agent loop, memory system, MCP
layer, and context architecture are built once and benefit every product that follows.
The marginal cost of adding a new product decreases as the platform matures.

---

## Principles

**Configure, don't fork.** A new product is a new configuration of the platform, not
a copy of the codebase. If building a new product requires forking, the abstraction
is wrong.

**The agent is the product.** Dashboards and tables are commodity. The agent that
understands the user's domain, learns their preferences, and proactively surfaces
what matters — that is the differentiator in every vertical.

**Infrastructure is a one-time cost.** Auth, encryption, LLM routing, MCP integration,
scheduling — solve these once, amortise across every product. New products should
spend 100% of their build effort on domain logic.

**Deploy independently, share intelligence.** Products are separate deployments, but
the agent framework, memory system, and skills layer improve centrally. A better
classifier benefits TradeBuddy and Meridian and CRM simultaneously.

**Compounding over addition.** Each new product is not just another product — it is
evidence that the platform works, a source of new agent learnings, and a magnet for
a new user segment. The value is multiplicative, not additive.

---

## Open Questions

- [ ] Platform name — what do we call the framework itself, distinct from the individual products?
- [ ] Licensing model — open-source the platform, monetise the hosted products? Or keep closed?
- [ ] Which product is the best third after TradeBuddy and Meridian? CRM feels natural given the `agent-redesign.md` reference, but worth validating.
- [ ] Multi-product orgs — when does it make sense to build the `PRODUCT=all` mode properly, with per-user product entitlements?
- [ ] Context pack marketplace — expert-published packs (`context-architecture.md`) could become a cross-product content layer. A trading expert's pack and an ecommerce expert's pack live in the same catalog.
- [ ] Agent identity — does each product have its own named agent (TradeBuddy Agent, Meridian Agent) or does the platform have a single agent identity that adapts to context?

---

*Connected docs: `agent-redesign.md` · `context-architecture.md` · `mcp-discovery.md` · `meridian-amazon.md`*
