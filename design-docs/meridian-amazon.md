# Meridian — Product Discovery Notes
*Saved: April 2026 · Confidential*

---

## 1. The Core Idea

Build a **unified SaaS platform for multi-channel ecommerce merchants** that connects every layer of their business — from factory to customer — into a single source of truth.

Merchants sign up, connect their selling platforms and ad accounts via OAuth, and receive a unified dashboard covering supply chain, cross-platform sales, and marketing effectiveness.

---

## 2. How the Amazon Merchant Connector Works

### Auth Flow (Amazon SP-API)
- Register app in Amazon Seller Central → get `LWA_CLIENT_ID` + `LWA_CLIENT_SECRET`
- Redirect merchant to Amazon OAuth consent URL
- On callback, exchange `spapi_oauth_code` for `access_token` + `refresh_token`
- Store `refresh_token` encrypted in DB — this is the permanent merchant credential
- Refresh access token at runtime (1-hour expiry) using the stored refresh token

### Key SP-API Endpoints for Data
| Data | Endpoint |
|---|---|
| Orders | `GET /orders/v0/orders` |
| Sales & Traffic | `GET_SALES_AND_TRAFFIC_REPORT` |
| Inventory | `GET /fba/inventory/v1/summaries` |
| Financials | `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE` |
| Listings | `GET /catalog/2022-04-01/items` |

### Compliance Notes
- Must agree to Amazon's SP-API Data Protection Policy
- Tokens must be encrypted at rest
- Requires Amazon app review before going live
- Some report types require restricted data tokens (PII)

---

## 3. Multi-Platform Architecture

### Supported Platforms (Priority Order)
1. Amazon (SP-API, OAuth 2.0)
2. Shopify (Admin REST/GraphQL, OAuth 2.0)
3. eBay (Sell APIs, OAuth 2.0)
4. Walmart Marketplace (Seller API, Basic Auth + signatures)
5. TikTok Shop (Shop API, OAuth 2.0)
6. Etsy (Open API v3, OAuth 2.0)
7. WooCommerce (REST API, OAuth or API Key)
8. Meta Shops (Graph API, OAuth 2.0)

### Connector Pattern (Abstraction Layer)
Each platform implements a shared `PlatformConnector` interface:
- `get_auth_url(merchant_id)` — OAuth redirect URL
- `exchange_code(code, merchant_id)` — token exchange
- `get_orders(credentials, since)` → `list[NormalizedOrder]`
- `get_inventory(credentials)` → `list[NormalizedInventory]`
- `get_revenue(credentials, period)` → `NormalizedRevenue`

### Normalized Data Models
All platform data is flattened into common schemas:
- `NormalizedOrder` — order_id, platform, merchant_id, amount, currency, status, items, created_at, shipping_country
- `NormalizedInventory` — sku, platform, merchant_id, quantity_available, quantity_reserved
- `NormalizedRevenue` — gross_revenue, refunds, platform_fees, net_revenue, period

### Database Design
```sql
merchants (id, email, name, created_at)
platform_credentials (merchant_id, platform, credentials JSONB encrypted, status, last_synced_at)
orders (merchant_id, platform, platform_order_id, amount, currency, status, created_at, raw JSONB)
```

### Recommended Tech Stack
- **Backend:** FastAPI or Node/Express
- **Queue:** Celery + Redis or BullMQ (scheduled syncs per merchant)
- **Database:** PostgreSQL (normalized data + encrypted credentials)
- **Warehouse:** Snowflake/BigQuery for large data volumes
- **Secrets:** Vault or AWS KMS for token encryption
- **Frontend:** Next.js (merchant portal + dashboards)

---

## 4. Three Core Pain Points Identified

### Pain Point 1 — Invisible Supply Chain
Merchants manage factory comms over email, POs in spreadsheets, freight in separate portals. No unified view of production status, lead times, landed costs, or reorder triggers. A 3-week factory delay can cause stockouts with zero early warning.

### Pain Point 2 — Fragmented Multi-Platform Sales Data
Each platform (Amazon, Shopify, eBay) provides isolated analytics with different definitions, time zones, and taxonomies. Merchants cannot answer: which SKU is most profitable across all channels after fees?

### Pain Point 3 — Broken Marketing Attribution
- Every ad platform overclaims credit for the same conversions
- Example: $44K ad spend → Meta claims $32K, Google claims $28K, TikTok claims $14.5K = $74.5K total claimed vs $62K actual Shopify revenue
- iOS14+ and deprecation of 3rd-party cookies have reduced mobile signal fidelity by 60–80%
- 20–30% of conversions now go untracked even on a single platform
- Cross-platform halo effects (e.g. TikTok ad → Amazon search) are completely invisible

---

## 5. Competitive Landscape

| Platform | Multi-Platform | Supply Chain | Marketing Attribution | SMB Pricing |
|---|---|---|---|---|
| Triple Whale | Partial | No | Partial | Yes |
| DataHawk | Yes | No | Limited | No |
| Northbeam | Partial | No | Strong | No |
| Prescient AI | Yes | No | Strong | No |
| TradeBeyond | Yes | Yes | No | No |
| Improvado | Yes | No | Partial | No |
| **MERIDIAN** | **Yes** | **Yes** | **Yes** | **Yes** |

**Key insight:** No existing product combines all four dimensions for the SMB/mid-market segment. TradeBeyond is the closest on supply chain but is enterprise-only with no attribution layer.

---

## 6. Market Opportunity

- Global ecommerce analytics market: **$28.64B by 2026** (14.5% CAGR)
- ~10M multi-channel merchants globally, growing 18% YoY
- Average annual SaaS spend per mid-market merchant: $8K–$40K across 6–9 disconnected tools
- **Primary target:** 500K+ English-speaking merchants doing $100K–$10M/yr across 2+ platforms

---

## 7. Product Pillars

1. **Supply Chain Intelligence** — PO tracking from factory → freight → customs → warehouse. Landed cost calculator. Reorder alerts based on real sell-through velocity.
2. **Multi-Platform Sales Analytics** — Normalised revenue, orders, inventory, and P&L across all selling channels. Cross-platform SKU performance. Unified financial reconciliation.
3. **Marketing Attribution** — Server-side tracking + incrementality testing + MMM. True cross-channel ROAS per SKU per platform. Halo effect quantification. Budget reallocation recommendations.
4. **AI-Driven Insights** — Proactive recommendations: "Restock Widget-X on eBay — converts 3x better than Amazon, stock runs out in 11 days." Actionable, not decorative.

---

## 8. Business Model

| Tier | Price | Target |
|---|---|---|
| Starter | $149/mo | 2 platforms, 1 ad account, basic analytics |
| Growth | $399/mo | 5 platforms, 3 ad accounts, full attribution + supply chain |
| Scale | $899/mo | Unlimited platforms, incrementality testing, custom reports |
| Enterprise | Custom | White-labelling for agencies, SLA, data warehouse export |

**Revenue milestones:**
- 1,000 Growth subscribers → $399K MRR / $4.8M ARR
- 5,000 subscribers (blended) → ~$18M ARR

---

## 9. Product Roadmap

| Phase | Timeline | Focus |
|---|---|---|
| Phase 1 — Foundation | Months 1–4 | Amazon + Shopify connectors, unified dashboard, 20-merchant beta |
| Phase 2 — Attribution | Months 5–8 | Meta/Google/TikTok Ads APIs, server-side attribution, 200 paying merchants |
| Phase 3 — Supply Chain | Months 9–14 | PO tracking, supplier portal, freight integration, landed cost calculator |
| Phase 4 — AI & Scale | Months 15–24 | AI recommendation engine, incrementality testing, agency tier, international |

---

## 10. Go-to-Market Strategy

1. **Community-Led Growth** — Freemium "data health audit" tool targeting Amazon/Shopify seller communities (Reddit, Facebook Groups, Helium10 forums)
2. **Agency Partnerships** — Ecommerce agencies managing 50–200 accounts → high-value distribution channel with strong retention
3. **Content & SEO** — Target high-intent keywords: "Amazon Shopify unified analytics", "cross-platform ROAS", "multi-channel attribution"

---

## 11. Co-Founder Needs

| Role | Key Skills |
|---|---|
| Technical Co-Founder | Data pipelines, API integrations, scalable SaaS backends (Python/Node, PostgreSQL). Ideally experience with Amazon SP-API, Shopify, or Meta APIs. |
| Product Co-Founder | Former merchant or ecommerce operator. Product roadmap ownership, merchant interviews, intuitive dashboard design. |
| Go-to-Market Co-Founder | B2B SaaS growth from 0 → 500 customers. Network in Amazon/Shopify ecosystem or ecommerce agencies. |

---

## 12. Why Now

- **Platform proliferation** — TikTok Shop crossed $1B US GMV in 2024; merchants now manage 3–5 channels simultaneously
- **Privacy changes** — iOS14+ and cookie deprecation have broken legacy attribution tools; market actively replacing them
- **AI readiness** — Merchants expect recommendations, not charts
- **Supply chain awareness** — Post-pandemic disruptions have made factory-to-customer visibility urgent

---

## 13. Deliverables Created

- `Meridian_Cofounder_Proposal.pdf` — Full co-founder proposal document (cover, problem, solution, market, competitive analysis, business model, roadmap, co-founder profiles)

---

## 14. Open Questions / Next Steps

- [ ] Validate pain points with 10+ real merchants through interviews
- [ ] Define equity split framework for co-founders
- [ ] Prototype Amazon + Shopify OAuth connector (Phase 1)
- [ ] Identify 20 beta merchants for closed launch
- [ ] Explore pre-seed funding timeline and target investors
- [ ] Decide on product name (current proposal: **Meridian**)
- [ ] Assess TikTok Shop API as early differentiator (underserved by competitors)

---

## 15. Shared Infrastructure with TradeBuddy

Meridian and TradeBuddy share a single codebase and deployment image. A `PRODUCT` env var controls which modules load at runtime.

### Shared common modules (`server/common/`)

| Module | How Meridian uses it |
|---|---|
| `db.js` | Same PostgreSQL pool — Meridian adds its own tables to the existing DB |
| `crypto.js` | `encrypt()`/`decrypt()` stores Amazon `refresh_token` exactly as LLM API keys are stored |
| `auth.js` | `authMiddleware` protects Meridian routes; `signJwt` issues merchant sessions |
| `appSettings.js` | Stores `AMAZON_LWA_CLIENT_ID` and `AMAZON_LWA_CLIENT_SECRET` as admin settings — encrypted, cached, env fallback included |
| `llm.js` | `callLLM()` powers AI insights — all providers already supported |
| `audit.js` | Logs merchant connect/sync/disconnect events |
| `email.js` | Sync completion and low-inventory alert emails |

Frontend `src/common/` is also shared:
- `apiService.js` — Meridian appends new functions; no changes to existing ones
- `AuthContext.jsx`, `ThemeContext.jsx`, `ConfigContext.jsx` — reused as-is

### Deployment mode

A single env var controls what the app loads:

```
PRODUCT=tradebuddy   # loads only TradeBuddy routes and pages
PRODUCT=meridian     # loads only Meridian routes and pages
PRODUCT=all          # loads everything (default for dev)
```

**Backend (`server/index.js`)** — routes mounted conditionally:

```js
const PRODUCT = process.env.PRODUCT || 'all'
const loadTradebuddy = PRODUCT === 'tradebuddy' || PRODUCT === 'all'
const loadMeridian   = PRODUCT === 'meridian'   || PRODUCT === 'all'

if (loadTradebuddy) {
  app.use('/api', marketRouter)
  app.use('/api', financialsRouter)
  // ... rest of TradeBuddy routes
}
if (loadMeridian) {
  app.use('/api/meridian', authMiddleware, meridianRouter)
}
```

**Database (`setup-db.js`)** — tables created conditionally. Shared tables (`users`, `app_settings`, `audit_log` etc.) always created regardless of product.

**Frontend (`App.jsx`)** — pages and sidebar nav rendered conditionally via `VITE_PRODUCT` (baked in at build time):

```js
const PRODUCT = import.meta.env.VITE_PRODUCT || 'all'

const PAGES = {
  // Shared — always included
  login: Login,
  settings: Settings,

  // TradeBuddy only
  ...(PRODUCT !== 'meridian' && {
    dashboard: Dashboard,
    portfolio: Portfolio,
    agent: Agent,
  }),

  // Meridian only
  ...(PRODUCT !== 'tradebuddy' && {
    meridian_dashboard: MeridianDashboard,
    meridian_connect: MeridianConnect,
  }),
}
```

### Branding config

Product name, logo, and accent color are stored in `app_settings` and read via `ConfigContext.jsx` on load — no hardcoded strings in components:

| Setting key | TradeBuddy | Meridian |
|---|---|---|
| `app_name` | TradeBuddy | Meridian |
| `app_logo_url` | — | — |
| `accent_color` | #0e7490 | #0d9488 |

### Project structure

```
server/
  common/          ← shared, untouched
  tradebuddy/      ← TradeBuddy-specific modules
  meridian/        ← Meridian-specific modules (new)
    amazon/
      oauth.js         ← LWA OAuth flow, token exchange
      tokenManager.js  ← refresh token storage using crypto.js
      orders.js        ← getOrders() → NormalizedOrder[]
      inventory.js     ← getInventory() → NormalizedInventory[]
      reports.js       ← getSalesReport() → NormalizedRevenue
    normalizer.js      ← shared normalization schemas
    sync.js            ← orchestrates fetch → normalize → upsert
    routes.js          ← Express routes mounted in index.js

src/
  common/          ← shared contexts and apiService.js
  tradebuddy/      ← TradeBuddy pages, components, hooks
  meridian/        ← Meridian pages and components (new)
    pages/
      Connect.jsx
      Dashboard.jsx
    components/
      MetricCard.jsx
      SkuTable.jsx
      InventoryAlerts.jsx
```

### Docker / deployment

Same image, different env vars:

```bash
# TradeBuddy deployment
docker run -e PRODUCT=tradebuddy -e VITE_PRODUCT=tradebuddy ...

# Meridian deployment
docker run -e PRODUCT=meridian -e VITE_PRODUCT=meridian ...

# Combined (dev / both products)
docker run -e PRODUCT=all ...
```

On Railway/Render: set `PRODUCT` in the environment variables panel — no new image or code change needed.

> Note: `VITE_PRODUCT` must be set at **build time** (Vite bakes env vars into the bundle). For simplicity in the POC, build with `VITE_PRODUCT=all` and let the backend `PRODUCT` var drive which routes are active. The unused frontend sections render based on what the API responds with.

---

## 16. POC Plan — Amazon Connector

**Goal:** Prove that a merchant can connect their Amazon account in under 10 minutes and immediately see normalized orders, revenue, and inventory in a single dashboard.

### POC scope

**In:**
- Amazon SP-API OAuth flow (connect → token storage → refresh)
- Data fetch: orders, FBA inventory, sales & traffic report
- Normalized data models stored in PostgreSQL
- Simple dashboard: revenue, order count, top SKUs, inventory alerts
- Single-merchant (no multi-tenancy complexity for POC)
- Reuse of all `server/common/` modules — no new auth, crypto, or DB plumbing

**Out:**
- Shopify or any other platform connector
- Supply chain, attribution, AI insights
- Agency/multi-merchant management
- Production secret management (Vault/KMS) — env vars sufficient for POC

### Estimate: ~7 days

| Phase | Days | Output |
|---|---|---|
| DB tables + admin settings | 1 | Meridian tables added to existing DB; Amazon credentials in `app_settings` |
| Amazon OAuth flow | 2–3 | Merchant can connect via SP-API; refresh token stored encrypted |
| Data fetch & normalization | 4–6 | Orders, inventory, revenue fetched and normalized |
| Frontend dashboard | 7–8 | Connect page + dashboard showing real merchant data |
| Validation | 9–10 | Numbers verified against Seller Central |

### UX flow (5 screens)

1. **Channels** — merchant picks a platform to connect; Shopify/eBay/TikTok shown as "Coming soon"
2. **Amazon OAuth** — permission summary, redirect to Seller Central, read-only access explanation
3. **First sync** — step-by-step progress (orders → inventory → report); async report handled gracefully
4. **Dashboard** — KPIs (revenue, orders, active SKUs, alerts) + top SKUs table + inventory alert list + recent orders
5. **Settings** — token status, sync frequency toggle, disconnect (removes token, keeps history)

---

*This document captures the product discovery conversation from April 2026. Update as the product evolves.*