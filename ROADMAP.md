# Project Roadmap

## Vision
Build an AI-first platform for small businesses, starting with a CRM.
Vantage is the learning vehicle and architectural foundation.

---

## Phase 1 — Vantage v1 (Current)

### Feature Completion
- [ ] Full role-based testing (admin, teacher, student, trader, readonly)
- [ ] Bug fixes from test sessions
- [ ] Rough edge cleanup across all pages

### Agent Architecture — Hybrid Agentic Loop
- [ ] Redesign `agent.js` around a proper tool-use loop
- [ ] Simple queries (trades, portfolio, general knowledge) → single LLM call, fast and cheap
- [ ] Research/data queries (news, historical, live prices) → agentic loop, LLM drives tool calls
- [ ] Routing layer — LLM or lightweight classifier decides which path to take
- [ ] Max iteration guard to prevent infinite loops
- [ ] Eliminate the `isResearchQuery` regex heuristic entirely
- [ ] Applies to CRM agent too — reusable pattern

### Open Source Prep — Intro (Personal)
- [ ] README (project story, screenshots/GIF, quick start guide)
- [ ] `.env.example` with all required keys documented
- [ ] MIT LICENSE
- [ ] Clean up hardcoded secrets, personal data, debug logs
- [ ] Hosted demo (Railway / Render / VPS)

### Open Source Prep — Full
- [ ] Rate limiting (especially LLM proxy endpoint)
- [ ] Input validation and sanitization
- [ ] API key encryption review
- [ ] DB migration strategy (replace setup-db.js with numbered migrations)
- [ ] Seed data / demo mode (run without real API keys)
- [ ] Test suite
- [ ] CI/CD (GitHub Actions)
- [ ] API documentation
- [ ] CONTRIBUTING.md, issue templates, PR template
- [ ] Dependency and license audit (Polygon TOS etc.)
- [ ] Resolve placeholder features (Polygon, Resend per-user keys)
- [ ] Flesh out readonly role

---

## Phase 2 — CRM (Next Project)

### Strategy
- Branch from Vantage — keep the architectural foundation
- Strip trading-specific features, replace with CRM-specific ones
- Target: small businesses, AI-first from day one (not bolted on)

### What Transfers from Vantage
| Vantage | CRM Equivalent |
|---|---|
| Auth system (email + Google, JWT, roles) | Same |
| Multi-role architecture | Owner, sales rep, support staff |
| LLM abstraction layer (multi-provider) | Same |
| MCP server integration | CRM integrations (email, calendar, Slack) |
| Campaign engine | Customer/prospect email campaigns |
| Prompt Manager | Sales workflow automation |
| Classroom | Customer onboarding, staff training |
| Admin panel | Business owner dashboard |
| Trading Agent | Relationship/sales advisor agent |

### What Gets Stripped
- Stock data, Polygon integration, price charts
- Portfolio, watchlist, AI portfolio (autopilot trader)
- Leaderboard (or repurposed for sales performance)

### What Gets Built
- Contacts & companies (core CRM entities)
- Deals / pipeline (kanban + list view)
- Activity timeline (calls, emails, meetings, notes)
- Support ticketing system (internal → customer-facing)
- Calendar integration
- Sales performance analytics

---

## Design Principles
- **AI-first** — the agent does things, not just answers questions
- **Design before code** — agree on design before touching any code
- **Phased** — ship clean phases, don't let perfect block good
- **Reusable foundation** — every pattern built should transfer forward
