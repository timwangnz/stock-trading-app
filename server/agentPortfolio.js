/**
 * server/agentPortfolio.js
 * Autopilot portfolio rebalancing engine.
 *
 * Each cycle:
 *  1. Load current agent holdings + cash + settings
 *  2. Fetch live prices + recent news for holdings & candidate universe
 *  3. Call the LLM with the user's bias text → get target allocation as JSON
 *  4. Execute buy/sell trades to match the target
 *  5. Log the run to agent_runs + agent_transactions
 *  6. Schedule next run
 */

import pool       from './db.js'
import { callLLM } from './llm.js'

// ── Candidate stock universe the agent can pick from ─────────────
// A broad cross-sector watchlist. The LLM selects a subset based on bias.
const UNIVERSE = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','AVGO','JPM','V',
  'MA','UNH','HD','LLY','JNJ','PG','ABBV','KO','PEP','MRK',
  'COST','WMT','BAC','NFLX','CRM','AMD','INTC','ORCL','QCOM','TXN',
  'DIS','UBER','ABNB','PLTR','COIN','SHOP','SPOT','PYPL','SQ','RBLX',
]

// ── Next-run timestamp helpers ────────────────────────────────────
export function calcNextRun(frequency, from = new Date()) {
  const d = new Date(from)
  if (frequency === 'daily')   d.setDate(d.getDate() + 1)
  if (frequency === 'weekly')  d.setDate(d.getDate() + 7)
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1)
  // Normalise to 09:30 ET (14:30 UTC) — near market open
  d.setUTCHours(14, 30, 0, 0)
  return d
}

// ── Polygon helpers (direct — no Express layer needed) ────────────

async function polyFetch(path) {
  const key = process.env.POLYGON_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://api.polygon.io${path}${path.includes('?') ? '&' : '?'}apiKey=${key}`)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

async function getLivePrices(symbols) {
  if (!symbols.length) return {}
  const data = await polyFetch(
    `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbols.join(',')}`
  )
  const map = {}
  for (const t of data?.tickers ?? []) {
    map[t.ticker] = t.day?.c || t.lastTrade?.p || t.prevDay?.c || 0
  }
  return map
}

async function getNewsHeadlines(symbols) {
  // Fetch news for up to 5 symbols (to stay within prompt size)
  const sample  = symbols.slice(0, 5)
  const blocks  = []
  await Promise.all(sample.map(async sym => {
    const data = await polyFetch(
      `/v2/reference/news?ticker=${sym}&limit=2&sort=published_utc&order=desc`
    )
    const articles = data?.results ?? []
    if (articles.length) {
      blocks.push(`[${sym}] ` + articles.map(a => a.title).join(' | '))
    }
  }))
  return blocks.join('\n')
}

// ── LLM rebalancing decision ──────────────────────────────────────

const REBALANCE_TOOL = {
  name: 'rebalance_portfolio',
  description: 'Return the target portfolio allocation for this rebalance cycle.',
  input_schema: {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        description: 'One entry per stock to hold after rebalancing. Only include stocks you want in the portfolio.',
        items: {
          type: 'object',
          properties: {
            symbol:         { type: 'string', description: 'Uppercase ticker, e.g. AAPL' },
            targetPct:      { type: 'number', description: 'Target % of total portfolio value (0-100). All entries must sum to ≤ 95 (leave ≥ 5% as cash buffer).' },
            estimatedPrice: { type: 'number', description: 'Your best estimate of the current share price in USD. Used as fallback if live price is unavailable.' },
            reasoning:      { type: 'string', description: 'One sentence why this position is included at this size' },
          },
          required: ['symbol', 'targetPct', 'estimatedPrice', 'reasoning'],
        },
      },
      summary: {
        type: 'string',
        description: '2-3 sentence overview of the rebalancing rationale and portfolio strategy this cycle',
      },
    },
    required: ['decisions', 'summary'],
  },
}

async function getLLMDecisions({ settings, holdings, prices, newsBlock, totalValue, llmConfig }) {
  const holdingLines = holdings.length
    ? holdings.map(h => {
        const price = prices[h.symbol] ?? 0
        const value = h.shares * price
        const pct   = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : '0.0'
        return `  ${h.symbol}: ${h.shares} shares @ $${price.toFixed(2)} = $${value.toFixed(2)} (${pct}%)`
      }).join('\n')
    : '  (no positions yet)'

  const universeLines = Object.entries(prices)
    .filter(([sym]) => !holdings.find(h => h.symbol === sym))
    .map(([sym, p]) => `  ${sym}: $${p.toFixed(2)}`)
    .join('\n')

  const systemPrompt = `You are an autonomous portfolio manager for a simulated trading app called TradeBuddy.
Your job is to rebalance a virtual portfolio each ${settings.frequency} cycle.

USER'S INVESTMENT BIAS / STRATEGY:
"${settings.bias}"

Follow this bias closely when deciding what to hold and in what proportions.

CURRENT PORTFOLIO (total value: $${totalValue.toFixed(2)}, cash: $${parseFloat(settings.cash).toFixed(2)}):
${holdingLines}

AVAILABLE STOCKS AND LIVE PRICES:
${universeLines || '  (use holdings above)'}

RECENT NEWS:
${newsBlock || '  (no news available)'}

RULES:
- Return exactly ${settings.num_stocks ?? 10} stock positions that best match the user's bias (no more, no less unless cash is truly insufficient for more)
- targetPct values must sum to ≤ 95 (always keep ≥ 5% cash buffer)
- For estimatedPrice: use the live price if shown above, otherwise use your best knowledge of the current share price
- You MUST include estimatedPrice for every decision — it is required for trade execution
- Explain each position in one sentence
- Write a 2–3 sentence summary of your strategy this cycle
- This is vibe (simulated) trading only — not real financial advice`

  const { toolInput } = await callLLM(
    {
      provider: llmConfig.provider || 'anthropic',
      model:    llmConfig.model    || 'claude-haiku-4-5-20251001',
      apiKey:   llmConfig.apiKey   || null,
    },
    { systemPrompt, userMessage: 'Please rebalance the portfolio now.', tools: [REBALANCE_TOOL] }
  )

  return toolInput   // { decisions: [...], summary: '...' }
}

// ── Trade execution ───────────────────────────────────────────────

async function executeAgentTrades({ userId, runId, holdings, prices, decisions, settings, client }) {
  const cash      = parseFloat(settings.cash)
  let   available = cash
  const tradesLog = []

  // Build a map of current holdings
  const currentMap = {}
  for (const h of holdings) currentMap[h.symbol] = { shares: parseFloat(h.shares), avgCost: parseFloat(h.avg_cost) }

  // Build target map from LLM decisions
  // Use live price if available, fall back to LLM's own estimate
  const totalValue = holdings.reduce((s, h) => {
    const p = prices[h.symbol] || h.avg_cost
    return s + p * parseFloat(h.shares)
  }, 0) + cash
  const targetMap  = {}
  for (const d of decisions) {
    const price = prices[d.symbol] || d.estimatedPrice   // ← fallback to LLM estimate
    if (!price) continue
    const targetValue = totalValue * (d.targetPct / 100)
    targetMap[d.symbol] = { targetShares: targetValue / price, price, reasoning: d.reasoning }
  }

  // ── SELLS first (frees cash for buys) ────────────────────────
  for (const [sym, current] of Object.entries(currentMap)) {
    const target = targetMap[sym]
    const price  = prices[sym] || target?.price || 0
    if (!target || target.targetShares < current.shares * 0.01) {
      // Sell entire position
      const proceeds = current.shares * price
      available += proceeds
      await client.query(
        'DELETE FROM agent_holdings WHERE user_id = $1 AND symbol = $2',
        [userId, sym]
      )
      await client.query(
        `INSERT INTO agent_transactions (user_id,run_id,symbol,side,shares,price,total,reasoning)
         VALUES ($1,$2,$3,'sell',$4,$5,$6,$7)`,
        [userId, runId, sym, current.shares, price, proceeds.toFixed(2),
         target ? 'Reducing below threshold' : 'Not in target allocation']
      )
      tradesLog.push({ action: 'sell', symbol: sym, shares: current.shares, price })
      delete currentMap[sym]
    } else if (target.targetShares < current.shares - 0.001) {
      // Partial sell
      const diff     = current.shares - target.targetShares
      const proceeds = diff * price
      available += proceeds
      const remaining = target.targetShares
      await client.query(
        'UPDATE agent_holdings SET shares=$1, updated_at=NOW() WHERE user_id=$2 AND symbol=$3',
        [remaining, userId, sym]
      )
      await client.query(
        `INSERT INTO agent_transactions (user_id,run_id,symbol,side,shares,price,total,reasoning)
         VALUES ($1,$2,$3,'sell',$4,$5,$6,$7)`,
        [userId, runId, sym, diff, price, proceeds.toFixed(2), target.reasoning]
      )
      tradesLog.push({ action: 'sell', symbol: sym, shares: diff, price })
      currentMap[sym].shares = remaining
    }
  }

  // ── BUYS ─────────────────────────────────────────────────────
  for (const [sym, target] of Object.entries(targetMap)) {
    const price   = prices[sym] || target.price   // fall back to LLM estimate stored in targetMap
    if (!price) continue
    const current = currentMap[sym]?.shares ?? 0
    const needed  = target.targetShares - current
    if (needed < 0.001) continue

    const cost = needed * price
    if (cost > available) {
      // Buy as many as we can afford
      const affordable = Math.floor((available / price) * 1000) / 1000
      if (affordable < 0.001) continue
      const actualCost = affordable * price
      available -= actualCost
      await upsertHolding(client, userId, sym, affordable, price, current, currentMap[sym]?.avgCost ?? price)
      await client.query(
        `INSERT INTO agent_transactions (user_id,run_id,symbol,side,shares,price,total,reasoning)
         VALUES ($1,$2,$3,'buy',$4,$5,$6,$7)`,
        [userId, runId, sym, affordable, price, actualCost.toFixed(2), target.reasoning]
      )
      tradesLog.push({ action: 'buy', symbol: sym, shares: affordable, price })
    } else {
      available -= cost
      await upsertHolding(client, userId, sym, needed, price, current, currentMap[sym]?.avgCost ?? price)
      await client.query(
        `INSERT INTO agent_transactions (user_id,run_id,symbol,side,shares,price,total,reasoning)
         VALUES ($1,$2,$3,'buy',$4,$5,$6,$7)`,
        [userId, runId, sym, needed, price, cost.toFixed(2), target.reasoning]
      )
      tradesLog.push({ action: 'buy', symbol: sym, shares: needed, price })
    }
  }

  // Update cash balance
  await client.query(
    'UPDATE agent_portfolio_settings SET cash=$1, updated_at=NOW() WHERE user_id=$2',
    [available.toFixed(2), userId]
  )

  return tradesLog
}

async function upsertHolding(client, userId, symbol, addShares, price, existingShares, existingAvg) {
  const newShares  = existingShares + addShares
  const newAvgCost = existingShares > 0
    ? ((existingShares * existingAvg) + (addShares * price)) / newShares
    : price
  await client.query(
    `INSERT INTO agent_holdings (user_id, symbol, shares, avg_cost)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, symbol)
     DO UPDATE SET shares=$3, avg_cost=$4, updated_at=NOW()`,
    [userId, symbol, newShares, newAvgCost]
  )
}

// ── Main rebalance entry point ────────────────────────────────────

/**
 * Run a full rebalance cycle for one user.
 * @param {string} userId
 * @param {object} llmConfig  - { provider, model, apiKey }
 * @returns {{ summary, tradesCount, portfolioValue, error? }}
 */
export async function runRebalance(userId, llmConfig = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Load settings
    const { rows: [settings] } = await client.query(
      'SELECT * FROM agent_portfolio_settings WHERE user_id=$1', [userId]
    )
    if (!settings) throw new Error('No agent portfolio configured')
    if (settings.status === 'paused') return { summary: 'Portfolio is paused.', tradesCount: 0, portfolioValue: 0 }

    // Load current holdings
    const { rows: holdings } = await client.query(
      'SELECT symbol, shares, avg_cost FROM agent_holdings WHERE user_id=$1', [userId]
    )

    // Build symbol list: holdings + a sample from universe
    const heldSymbols   = holdings.map(h => h.symbol)
    const extra         = UNIVERSE.filter(s => !heldSymbols.includes(s)).slice(0, 20)
    const allSymbols    = [...new Set([...heldSymbols, ...extra])]

    // Fetch live prices + news in parallel
    const [prices, newsBlock] = await Promise.all([
      getLivePrices(allSymbols),
      getNewsHeadlines(heldSymbols.length ? heldSymbols : UNIVERSE.slice(0, 5)),
    ])

    // Total portfolio value
    const holdingsValue = holdings.reduce((s, h) => s + (prices[h.symbol] ?? 0) * parseFloat(h.shares), 0)
    const totalValue    = holdingsValue + parseFloat(settings.cash)

    // Get LLM target allocation
    const llmResult = await getLLMDecisions({
      settings, holdings, prices, newsBlock, totalValue, llmConfig,
    })
    if (!llmResult?.decisions?.length) throw new Error('LLM returned no decisions')

    // Enrich decisions with price source so the UI can flag estimated prices
    const enrichedDecisions = llmResult.decisions.map(d => ({
      ...d,
      priceSource: prices[d.symbol] ? 'live' : 'estimated',
    }))

    // Create the run record (need the id for transaction foreign keys)
    const { rows: [run] } = await client.query(
      `INSERT INTO agent_runs (user_id, status, summary, decisions, trades_count, portfolio_value)
       VALUES ($1,'success',$2,$3,0,$4) RETURNING id`,
      [userId, llmResult.summary, JSON.stringify(enrichedDecisions), totalValue.toFixed(2)]
    )

    // Execute trades
    const tradesLog = await executeAgentTrades({
      userId, runId: run.id, holdings, prices,
      decisions: llmResult.decisions, settings, client,
    })

    // Update run with actual trade count
    await client.query(
      'UPDATE agent_runs SET trades_count=$1 WHERE id=$2',
      [tradesLog.length, run.id]
    )

    // Schedule next run
    const nextRun = calcNextRun(settings.frequency)
    await client.query(
      `UPDATE agent_portfolio_settings
         SET last_run_at=NOW(), next_run_at=$1, updated_at=NOW()
       WHERE user_id=$2`,
      [nextRun, userId]
    )

    await client.query('COMMIT')
    return { summary: llmResult.summary, tradesCount: tradesLog.length, portfolioValue: totalValue, runId: run.id }

  } catch (err) {
    await client.query('ROLLBACK')
    // Log failed run
    try {
      await pool.query(
        `INSERT INTO agent_runs (user_id, status, summary) VALUES ($1,'error',$2)`,
        [userId, err.message]
      )
    } catch { /* swallow */ }
    throw err
  } finally {
    client.release()
  }
}

// ── Portfolio state reader ────────────────────────────────────────

export async function getAgentPortfolioState(userId) {
  const [settingsRes, holdingsRes, runsRes] = await Promise.all([
    pool.query('SELECT * FROM agent_portfolio_settings WHERE user_id=$1', [userId]),
    pool.query('SELECT * FROM agent_holdings WHERE user_id=$1 ORDER BY symbol', [userId]),
    pool.query(
      'SELECT * FROM agent_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]
    ),
  ])

  const settings = settingsRes.rows[0] ?? null
  const holdings = holdingsRes.rows
  const runs     = runsRes.rows

  if (!settings) return { configured: false }

  // Fetch live prices for holdings
  const symbols = holdings.map(h => h.symbol)
  const prices  = symbols.length ? await getLivePrices(symbols) : {}

  const enriched = holdings.map(h => {
    const price = prices[h.symbol] ?? 0
    const value = parseFloat(h.shares) * price
    const gain  = value - parseFloat(h.shares) * parseFloat(h.avg_cost)
    return { ...h, price, value, gain }
  })

  const holdingsValue  = enriched.reduce((s, h) => s + h.value, 0)
  const totalValue     = holdingsValue + parseFloat(settings.cash)
  const startingCash   = parseFloat(settings.starting_cash)
  const totalReturn    = totalValue - startingCash
  const totalReturnPct = startingCash > 0 ? (totalReturn / startingCash) * 100 : 0

  return {
    configured: true,
    settings,
    holdings:  enriched,
    runs,
    summary: { totalValue, holdingsValue, cash: parseFloat(settings.cash), totalReturn, totalReturnPct },
  }
}

// ── Scheduler: find overdue portfolios and rebalance ─────────────

export async function runScheduledRebalances(getLLMConfigForUser) {
  try {
    const { rows } = await pool.query(
      `SELECT aps.user_id, uls.provider, uls.model, uls.api_key_enc
         FROM agent_portfolio_settings aps
         LEFT JOIN user_llm_settings uls ON uls.user_id = aps.user_id
        WHERE aps.status = 'active'
          AND aps.next_run_at IS NOT NULL
          AND aps.next_run_at <= NOW()`
    )
    for (const row of rows) {
      try {
        const llmConfig = await getLLMConfigForUser(row)
        await runRebalance(row.user_id, llmConfig)
        console.log(`[agent-scheduler] Rebalanced portfolio for user ${row.user_id}`)
      } catch (err) {
        console.warn(`[agent-scheduler] Failed for user ${row.user_id}:`, err.message)
      }
    }
  } catch (err) {
    console.warn('[agent-scheduler] Query failed:', err.message)
  }
}
