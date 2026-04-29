/**
 * server/campaigns.js
 * Marketing campaign engine.
 *
 * Core functions:
 *   resolveAudience(filter)              — run segment query, return users + portfolio snapshot
 *   resolveTokens(template, user)        — manual-mode {{token}} substitution
 *   generateAIBody(prompt, user, cfg)    — AI-mode: one LLM call per user
 *   parseAudienceDescription(desc, cfg)  — NL → filter JSON via LLM
 *   executeCampaign(campaignId, cfg)     — main send loop
 */

import pool           from '../common/db.js'
import { callLLM }   from '../common/llm.js'
import { Resend }    from 'resend'
import { getAppSetting } from '../common/appSettings.js'

// Resend client is initialised lazily on first send so the key can be
// configured in the app after first boot rather than requiring it in .env.
async function getResend() {
  const key = await getAppSetting('resend_api_key', 'RESEND_API_KEY')
  if (!key) return null
  return new Resend(key)
}
async function getFrom() {
  return await getAppSetting('email_from', 'EMAIL_FROM') || 'TradeBuddy <onboarding@resend.dev>'
}

// ── Audience filter schema ────────────────────────────────────────
//
// Stored as JSONB on the campaigns row:
// {
//   "logic": "AND",
//   "conditions": [
//     { "field": "portfolio_value",  "op": "gte", "value": 50000 },
//     { "field": "trade_count",      "op": "gte", "value": 10    },
//     { "field": "role",             "op": "in",  "value": ["user","premium"] },
//     { "field": "account_age_days", "op": "gte", "value": 30    }
//   ]
// }
//
// Supported fields: portfolio_value, cash_balance, trade_count,
//                   account_age_days, last_trade_days, role

const ALLOWED_FIELDS = new Set([
  'portfolio_value', 'cash_balance', 'trade_count',
  'account_age_days', 'last_trade_days', 'role',
])
const ALLOWED_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin'])

// ── resolveAudience ───────────────────────────────────────────────

/**
 * Run the audience segment query.
 * Returns an array of user objects with portfolio snapshot:
 * { id, name, email, role, portfolio_value, cash_balance,
 *   trade_count, account_age_days, last_trade_days, top_holding }
 */
export async function resolveAudience(filter) {
  // Build the WHERE clauses from the filter conditions
  const conditions = filter?.conditions ?? []
  const clauses    = []
  const params     = []

  for (const cond of conditions) {
    const { field, op, value } = cond
    if (!ALLOWED_FIELDS.has(field)) continue
    if (!ALLOWED_OPS.has(op))       continue

    // Map logical field names to the subquery aliases used below
    const colMap = {
      portfolio_value:  'audience.portfolio_value',
      cash_balance:     'audience.cash_balance',
      trade_count:      'audience.trade_count',
      account_age_days: 'audience.account_age_days',
      last_trade_days:  'audience.last_trade_days',
      role:             'audience.role',
    }
    const col = colMap[field]

    if (op === 'in' || op === 'nin') {
      const arr = Array.isArray(value) ? value : [value]
      params.push(arr)
      const idx = params.length
      clauses.push(`${col} ${op === 'in' ? '= ANY' : '<> ALL'}($${idx})`)
    } else {
      params.push(value)
      const idx    = params.length
      const sqlOp  = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]
      clauses.push(`${col} ${sqlOp} $${idx}`)
    }
  }

  const logic     = (filter?.logic ?? 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const whereStr  = clauses.length
    ? `WHERE ${clauses.join(` ${logic} `)}`
    : ''

  // Single query: users + aggregated portfolio stats + top holding
  const sql = `
    WITH portfolio_stats AS (
      SELECT
        p.user_id,
        COALESCE(SUM(p.shares * p.avg_cost), 0)::numeric AS portfolio_value,
        MAX(CASE WHEN p.shares = (
          SELECT MAX(p2.shares) FROM portfolio p2 WHERE p2.user_id = p.user_id
        ) THEN p.symbol END) AS top_holding
      FROM portfolio p
      GROUP BY p.user_id
    ),
    trade_stats AS (
      SELECT
        user_id,
        COUNT(*)::int                           AS trade_count,
        MAX(executed_at)                        AS last_trade_at
      FROM transactions
      GROUP BY user_id
    ),
    audience AS (
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        COALESCE(ps.portfolio_value, 0)                           AS portfolio_value,
        COALESCE(ub.cash, 0)                                      AS cash_balance,
        COALESCE(ts.trade_count, 0)                               AS trade_count,
        EXTRACT(DAY FROM NOW() - u.created_at)::int               AS account_age_days,
        COALESCE(EXTRACT(DAY FROM NOW() - ts.last_trade_at)::int, 9999) AS last_trade_days,
        ps.top_holding
      FROM users u
      LEFT JOIN portfolio_stats ps ON ps.user_id = u.id
      LEFT JOIN user_balances  ub  ON ub.user_id = u.id
      LEFT JOIN trade_stats    ts  ON ts.user_id = u.id
      WHERE u.is_disabled = false
        AND u.role <> 'readonly'
    )
    SELECT * FROM audience ${whereStr}
    ORDER BY portfolio_value DESC
  `

  const { rows } = await pool.query(sql, params)
  return rows
}

// ── resolveTokens ─────────────────────────────────────────────────

/**
 * Replace {{tokens}} in a manual-mode body template with per-user values.
 * user comes from resolveAudience().
 */
export function resolveTokens(template, user) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const fmt = (n) => n != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
    : '—'

  return template
    .replace(/\{\{name\}\}/gi,            user.name  ?? user.email)
    .replace(/\{\{email\}\}/gi,           user.email ?? '')
    .replace(/\{\{portfolio_value\}\}/gi, fmt(user.portfolio_value))
    .replace(/\{\{cash\}\}/gi,            fmt(user.cash_balance))
    .replace(/\{\{top_holding\}\}/gi,     user.top_holding ?? 'none')
    .replace(/\{\{trade_count\}\}/gi,     String(user.trade_count ?? 0))
    .replace(/\{\{date\}\}/gi,            today)
}

// ── generateAIBody ────────────────────────────────────────────────

/**
 * AI mode: call the LLM once per user to generate a unique email body.
 * The ai_prompt may also contain {{tokens}} which are substituted first,
 * then the whole enriched prompt is sent to the LLM.
 */
export async function generateAIBody(aiPrompt, user, llmConfig) {
  const enrichedPrompt = resolveTokens(aiPrompt, user)

  const systemPrompt = `You are an email copywriter for TradeBuddy, a stock trading platform.
Write a personalized marketing email body based on the given prompt.
The email should be friendly, professional, and concise (under 200 words).
Return ONLY the email body text — no subject line, no "Dear X," salutation, no sign-off.
Use plain text only; no markdown.`

  const { text } = await callLLM(llmConfig, {
    systemPrompt,
    userMessage: enrichedPrompt,
    tools: undefined,
  })

  return text ?? ''
}

// ── parseAudienceDescription ──────────────────────────────────────

const FILTER_SCHEMA_DESCRIPTION = `
The audience filter JSON must match this exact schema:
{
  "logic": "AND" | "OR",
  "conditions": [
    { "field": "<field>", "op": "<op>", "value": <value> }
  ]
}

Allowed fields: portfolio_value, cash_balance, trade_count, account_age_days, last_trade_days, role
Allowed ops: eq, neq, gt, gte, lt, lte, in, nin
For "role": value must be a string array, e.g. ["user","premium"]
For numeric fields: value is a number.

Examples:
- "users with portfolio over 50k" → { "field": "portfolio_value", "op": "gte", "value": 50000 }
- "made at least 5 trades"        → { "field": "trade_count",     "op": "gte", "value": 5 }
- "joined more than 30 days ago"  → { "field": "account_age_days","op": "gte", "value": 30 }
- "haven't traded in 14 days"     → { "field": "last_trade_days", "op": "gte", "value": 14 }
- "regular users only"            → { "field": "role",            "op": "in",  "value": ["user"] }
`

/**
 * Translate a plain-English audience description into a filter JSON object.
 * Returns { filter, explanation } — the filter to store + human-readable summary.
 */
export async function parseAudienceDescription(description, llmConfig) {
  const systemPrompt = `You are a data analyst. Convert a plain-English audience description into a JSON filter object.
${FILTER_SCHEMA_DESCRIPTION}
Return ONLY valid JSON — no explanation, no markdown fences.`

  const userMessage = `Convert this audience description to filter JSON:\n"${description}"`

  const { text } = await callLLM(llmConfig, {
    systemPrompt,
    userMessage,
    tools: undefined,
  })

  // Parse the JSON the LLM returned
  let filter
  try {
    const raw   = text ?? ''
    const start = raw.indexOf('{')
    const end   = raw.lastIndexOf('}')
    filter      = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new Error(`LLM returned invalid JSON for audience filter: ${text?.slice(0, 200)}`)
  }

  // Validate and strip unknown fields/ops
  filter.logic      = ['AND', 'OR'].includes((filter.logic ?? '').toUpperCase())
    ? filter.logic.toUpperCase() : 'AND'
  filter.conditions = (filter.conditions ?? []).filter(
    c => ALLOWED_FIELDS.has(c.field) && ALLOWED_OPS.has(c.op)
  )

  return filter
}

// ── sendCampaignEmail ─────────────────────────────────────────────

async function sendCampaignEmail({ to, subject, body }) {
  // Wrap plain-text body in a simple HTML shell
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
      <div style="color:#374151;font-size:15px;line-height:1.7;white-space:pre-wrap">${body
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      }</div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
      <p style="color:#9ca3af;font-size:12px">
        You're receiving this because you have a TradeBuddy account.<br/>
        This is a simulated trading platform — not real financial advice.
      </p>
    </div>
  `

  const client = await getResend()
  if (!client) {
    console.warn('[campaigns] Resend not configured — skipping email to', to)
    return
  }
  const from = await getFrom()
  await client.emails.send({ from, to, subject, html })
}

// ── executeCampaign ───────────────────────────────────────────────

/**
 * Main send loop.
 * @param {number|string} campaignId
 * @param {object}        llmConfig   — { provider, model, apiKey } for AI mode
 */
export async function executeCampaign(campaignId, llmConfig) {
  // 1. Load the campaign
  const { rows: [campaign] } = await pool.query(
    'SELECT * FROM campaigns WHERE id = $1', [campaignId]
  )
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
  if (campaign.status === 'sent') throw new Error('Campaign already sent')

  // 2. Mark as sending
  await pool.query(
    "UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1",
    [campaignId]
  )

  // 3. Resolve audience
  const filter = campaign.audience_filter ?? { conditions: [] }
  const users  = await resolveAudience(filter)

  if (users.length === 0) {
    await pool.query(
      "UPDATE campaigns SET status = 'sent', sent_at = NOW(), recipient_count = 0, updated_at = NOW() WHERE id = $1",
      [campaignId]
    )
    return { sent: 0, failed: 0 }
  }

  // 4. Send to each recipient
  let sent = 0, failed = 0

  for (const user of users) {
    try {
      // Compose body: manual token substitution or AI generation
      let body
      if (campaign.compose_mode === 'ai') {
        body = await generateAIBody(campaign.ai_prompt, user, llmConfig)
      } else {
        body = resolveTokens(campaign.body_template ?? '', user)
      }

      await sendCampaignEmail({
        to:      user.email,
        subject: resolveTokens(campaign.subject ?? 'Message from TradeBuddy', user),
        body,
      })

      await pool.query(
        `INSERT INTO campaign_sends (campaign_id, user_id, status, sent_at)
         VALUES ($1, $2, 'sent', NOW())
         ON CONFLICT (campaign_id, user_id) DO UPDATE SET status = 'sent', sent_at = NOW(), error = NULL`,
        [campaignId, user.id]
      )
      sent++

    } catch (err) {
      console.error(`[campaigns] Failed to send to user ${user.id}:`, err.message)
      await pool.query(
        `INSERT INTO campaign_sends (campaign_id, user_id, status, error)
         VALUES ($1, $2, 'failed', $3)
         ON CONFLICT (campaign_id, user_id) DO UPDATE SET status = 'failed', error = $3`,
        [campaignId, user.id, err.message?.slice(0, 500)]
      )
      failed++
    }
  }

  // 5. Mark campaign as sent
  await pool.query(
    `UPDATE campaigns
     SET status = 'sent', sent_at = NOW(), recipient_count = $2, updated_at = NOW()
     WHERE id = $1`,
    [campaignId, sent]
  )

  return { sent, failed, total: users.length }
}
