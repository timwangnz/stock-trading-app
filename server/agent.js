/**
 * server/agent.js
 * Trading agent powered by the user's chosen LLM provider.
 * Supports Anthropic (Claude), OpenAI (GPT), and Google (Gemini).
 * Tool definitions are kept in Anthropic format; llm.js converts them.
 *
 * Live market data: before every LLM call we extract ticker symbols from
 * the user message, fetch current snapshots from Polygon.io, and inject
 * them into the system prompt — so the agent always answers with real prices.
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pool from './db.js'
import { callLLM } from './llm.js'

// Load the user guide once at startup so the agent can answer UI how-to questions
const __dir      = dirname(fileURLToPath(import.meta.url))
const USER_GUIDE = (() => {
  try {
    return readFileSync(join(__dir, '../TradeBuddy-User-Guide.md'), 'utf8')
  } catch {
    return '' // guide missing — agent still works without it
  }
})()

// ── Live market data helpers ─────────────────────────────────────

// Common English words that look like tickers — never treat these as symbols
const TICKER_STOP = new Set([
  'A','I','OK','MY','IN','AT','ON','IF','OR','BY','TO','OF','AN',
  'AS','UP','IS','IT','DO','SO','GO','NO','US','ME','HE','WE',
  'AI','CEO','CFO','COO','ETF','IPO','GDP','USD','EUR','THE',
  'AND','FOR','ALL','BUY','SELL','THIS','THAT','WHAT','WITH',
])

// Well-known company names → ticker (lower-cased keys)
const NAME_TO_TICKER = {
  apple: 'AAPL', microsoft: 'MSFT', google: 'GOOGL', alphabet: 'GOOGL',
  amazon: 'AMZN', tesla: 'TSLA', meta: 'META', facebook: 'META',
  nvidia: 'NVDA', netflix: 'NFLX', uber: 'UBER', airbnb: 'ABNB',
  coinbase: 'COIN', palantir: 'PLTR', shopify: 'SHOP', spotify: 'SPOT',
  intel: 'INTC', amd: 'AMD', qualcomm: 'QCOM', disney: 'DIS',
  walmart: 'WMT', visa: 'V', mastercard: 'MA', paypal: 'PYPL',
  salesforce: 'CRM', oracle: 'ORCL', ibm: 'IBM', boeing: 'BA',
}

/**
 * Extract stock ticker symbols from a free-text message.
 * Looks for $AAPL-style, plain UPPERCASE words, and known company names.
 */
function extractTickers(text) {
  const tickers = new Set()
  const lower   = text.toLowerCase()

  // $TICKER pattern
  for (const m of text.matchAll(/\$([A-Z]{1,5})\b/g)) tickers.add(m[1])

  // Plain UPPERCASE 2–5 letter words
  for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
    if (!TICKER_STOP.has(m[1])) tickers.add(m[1])
  }

  // Company name → ticker
  for (const [name, sym] of Object.entries(NAME_TO_TICKER)) {
    if (lower.includes(name)) tickers.add(sym)
  }

  return [...tickers]
}

/**
 * Fetch up to 3 recent news headlines for a single ticker from Polygon.
 * Returns a formatted string, or null on error / no results.
 */
async function fetchNewsForTicker(symbol, apiKey) {
  try {
    const res = await fetch(
      `https://api.polygon.io/v2/reference/news?ticker=${symbol}&limit=3&sort=published_utc&order=desc&apiKey=${apiKey}`
    )
    if (!res.ok) return null
    const data = await res.json()
    const articles = data.results ?? []
    if (articles.length === 0) return null

    const lines = articles.map(a => {
      const age = (() => {
        const diff = Date.now() - new Date(a.published_utc).getTime()
        const h    = Math.floor(diff / 3_600_000)
        if (h < 1)  return 'just now'
        if (h < 24) return `${h}h ago`
        return `${Math.floor(h / 24)}d ago`
      })()
      return `  • [${age}] ${a.title}` +
        (a.description ? ` — ${a.description.slice(0, 120)}${a.description.length > 120 ? '…' : ''}` : '')
    })

    return `[${symbol} Recent News]\n${lines.join('\n')}`
  } catch {
    return null
  }
}

/**
 * Fetch current price snapshots for a list of tickers directly from Polygon,
 * and (in parallel) the latest 3 news headlines for each ticker.
 * Returns a formatted context block ready to inject into the system prompt,
 * plus the list of tickers that were successfully fetched.
 * Returns null if POLYGON_API_KEY is unset or no tickers are provided.
 */
async function fetchLiveMarketContext(tickers) {
  const key = process.env.POLYGON_API_KEY
  if (!key || tickers.length === 0) return { contextBlock: null, tickersFetched: [] }

  const uniqueSyms = [...new Set(tickers)].slice(0, 5)
  const syms       = uniqueSyms.join(',')

  try {
    // Fetch price snapshots + news for all tickers in parallel
    const [snapshotRes, ...newsResults] = await Promise.allSettled([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${syms}&apiKey=${key}`),
      ...uniqueSyms.map(sym => fetchNewsForTicker(sym, key)),
    ])

    // ── Price data ────────────────────────────────────────────
    if (snapshotRes.status !== 'fulfilled' || !snapshotRes.value.ok) {
      return { contextBlock: null, tickersFetched: [] }
    }
    const data      = await snapshotRes.value.json()
    const snapshots = (data.tickers ?? []).map(t => ({
      symbol:    t.ticker,
      price:     t.day?.c    || t.lastTrade?.p || t.prevDay?.c || 0,
      change:    t.day?.c    ? parseFloat((t.todaysChange     ?? 0).toFixed(2)) : 0,
      changePct: t.day?.c    ? parseFloat((t.todaysChangePerc ?? 0).toFixed(2)) : 0,
      open:      t.day?.o    || 0,
      high:      t.day?.h    || 0,
      low:       t.day?.l    || 0,
      prevClose: t.prevDay?.c || 0,
      volume:    t.day?.v    || 0,
    }))

    if (snapshots.length === 0) return { contextBlock: null, tickersFetched: [] }

    const priceLines = snapshots.map(s => {
      const dir = s.change >= 0 ? '▲' : '▼'
      return [
        `[${s.symbol}]`,
        `  Price:      $${s.price.toFixed(2)}`,
        `  Change:     ${dir} $${Math.abs(s.change).toFixed(2)} (${Math.abs(s.changePct).toFixed(2)}%) today`,
        `  Open:       $${s.open.toFixed(2)}   High: $${s.high.toFixed(2)}   Low: $${s.low.toFixed(2)}`,
        `  Prev Close: $${s.prevClose.toFixed(2)}   Volume: ${s.volume.toLocaleString()}`,
      ].join('\n')
    })

    // ── News data ──────────────────────────────────────────────
    const newsBlocks = newsResults
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean)

    // ── Assemble context block ─────────────────────────────────
    let contextBlock =
      '📈 LIVE MARKET DATA (Polygon.io — use these exact numbers in your answer):\n\n' +
      priceLines.join('\n\n') +
      '\n\nIMPORTANT: Always quote the exact prices above. Never use outdated or approximate values.'

    if (newsBlocks.length > 0) {
      contextBlock +=
        '\n\n📰 RECENT NEWS (use these headlines to inform your analysis):\n\n' +
        newsBlocks.join('\n\n')
    }

    return { contextBlock, tickersFetched: snapshots.map(s => s.symbol) }
  } catch {
    return { contextBlock: null, tickersFetched: [] }
  }
}

// ── Tool definitions (Anthropic format — llm.js converts for other providers) ──

const TOOLS = [
  {
    name: 'execute_buy',
    description: 'Buy (or add to) a stock position in the portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:    { type: 'string', description: 'Ticker symbol in uppercase, e.g. AAPL' },
        shares:    { type: 'number', description: 'Number of shares to buy (can be fractional)' },
        price:     { type: 'number', description: 'Price per share in USD' },
        reasoning: { type: 'string', description: 'One-sentence explanation shown to the user' },
      },
      required: ['symbol', 'shares', 'price', 'reasoning'],
    },
  },
  {
    name: 'execute_sell',
    description: 'Sell a specific number of shares of a stock.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:    { type: 'string', description: 'Ticker symbol in uppercase' },
        shares:    { type: 'number', description: 'Number of shares to sell' },
        reasoning: { type: 'string', description: 'One-sentence explanation shown to the user' },
      },
      required: ['symbol', 'shares', 'reasoning'],
    },
  },
  {
    name: 'remove_holding',
    description: 'Remove an entire stock position (sell all shares) from the portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:    { type: 'string', description: 'Ticker symbol in uppercase' },
        reasoning: { type: 'string', description: 'One-sentence explanation shown to the user' },
      },
      required: ['symbol', 'reasoning'],
    },
  },
]

// ── Transaction recorder ──────────────────────────────────────────

async function recordTransaction(userId, symbol, side, shares, price, source = 'agent') {
  try {
    await pool.query(
      `INSERT INTO transactions (user_id, symbol, side, shares, price, total, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, symbol.toUpperCase(), side, shares, price,
       (parseFloat(shares) * parseFloat(price)).toFixed(2), source]
    )
  } catch (err) {
    console.warn('[transactions] Agent record failed:', err.message)
  }
}

// ── Cash helpers ─────────────────────────────────────────────────

const DEFAULT_CASH = 100_000

async function getCash(userId) {
  const { rows } = await pool.query(
    `INSERT INTO user_balances (user_id, cash) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING RETURNING cash`,
    [userId, DEFAULT_CASH]
  )
  if (rows.length) return parseFloat(rows[0].cash)
  const { rows: [r] } = await pool.query('SELECT cash FROM user_balances WHERE user_id = $1', [userId])
  return parseFloat(r.cash)
}

async function adjustCash(userId, delta) {
  const { rows: [r] } = await pool.query(
    'UPDATE user_balances SET cash = cash + $1, updated_at = NOW() WHERE user_id = $2 RETURNING cash',
    [delta, userId]
  )
  return parseFloat(r.cash)
}

// ── Trade execution helpers ──────────────────────────────────────

async function buyStock(userId, symbol, shares, price) {
  const sym  = symbol.toUpperCase()
  const cost = shares * price
  const cash = await getCash(userId)
  if (cash < cost) throw new Error(
    `Insufficient funds — need $${cost.toFixed(2)}, you have $${cash.toFixed(2)}.`
  )
  const { rows: [existing] } = await pool.query(
    'SELECT shares, avg_cost FROM portfolio WHERE user_id = $1 AND symbol = $2',
    [userId, sym]
  )
  let newShares, newAvgCost
  if (existing) {
    newShares  = parseFloat(existing.shares) + shares
    newAvgCost = ((parseFloat(existing.shares) * parseFloat(existing.avg_cost)) + (shares * price)) / newShares
  } else {
    newShares  = shares
    newAvgCost = price
  }
  await pool.query(
    `INSERT INTO portfolio (user_id, symbol, shares, avg_cost)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, symbol) DO UPDATE
       SET shares = EXCLUDED.shares, avg_cost = EXCLUDED.avg_cost`,
    [userId, sym, newShares, newAvgCost]
  )
  await adjustCash(userId, -cost)
  return { symbol: sym, shares: newShares, avgCost: newAvgCost }
}

async function sellStock(userId, symbol, shares, price = 0) {
  const sym = symbol.toUpperCase()
  const { rows: [existing] } = await pool.query(
    'SELECT shares, avg_cost FROM portfolio WHERE user_id = $1 AND symbol = $2',
    [userId, sym]
  )
  if (!existing) throw new Error(`You don't hold any ${sym} to sell.`)
  if (shares > parseFloat(existing.shares))
    throw new Error(`You only hold ${existing.shares} shares of ${sym} — can't sell ${shares}.`)
  const remaining = parseFloat((parseFloat(existing.shares) - shares).toFixed(6))
  if (remaining <= 0.000001) {
    await pool.query('DELETE FROM portfolio WHERE user_id = $1 AND symbol = $2', [userId, sym])
    await adjustCash(userId, shares * price)
    return { symbol: sym, removed: true }
  }
  await pool.query(
    'UPDATE portfolio SET shares = $1 WHERE user_id = $2 AND symbol = $3',
    [remaining, userId, sym]
  )
  await adjustCash(userId, shares * price)
  return { symbol: sym, shares: remaining, avgCost: existing.avg_cost }
}

async function removeStock(userId, symbol, price = 0) {
  const sym = symbol.toUpperCase()
  const { rows: [existing] } = await pool.query(
    'SELECT shares FROM portfolio WHERE user_id = $1 AND symbol = $2', [userId, sym]
  )
  await pool.query('DELETE FROM portfolio WHERE user_id = $1 AND symbol = $2', [userId, sym])
  if (existing && price > 0) await adjustCash(userId, parseFloat(existing.shares) * price)
  return { symbol: sym, removed: true }
}

// ── Main agent entry point ───────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.message
 * @param {Array}  opts.portfolio
 * @param {object} opts.llmConfig   - { provider, model, apiKey }
 */
export async function runTradingAgent({ userId, message, portfolio, llmConfig = {} }) {
  const portfolioText = portfolio.length === 0
    ? 'The portfolio is currently empty.'
    : portfolio
        .map(h =>
          `  • ${h.symbol}: ${h.shares} shares, avg cost $${Number(h.avgCost).toFixed(2)}` +
          (h.value ? `, current value $${Number(h.value).toFixed(2)}` : '')
        )
        .join('\n')

  // ── Fetch live market data before calling the LLM ────────────────
  // Extract tickers from: (1) explicit mentions in the message, and
  // (2) the user's portfolio holdings (for "how are my holdings doing?" queries)
  const portfolioTickers = (portfolio ?? []).map(h => h.symbol).filter(Boolean)
  let   candidateTickers = extractTickers(message)

  // If no tickers found but the message references the portfolio, use holdings
  const isPortfolioQuery = /\b(portfolio|holdings?|positions?|my stock|mine)\b/i.test(message)
  if (candidateTickers.length === 0 && isPortfolioQuery) {
    candidateTickers = portfolioTickers
  }

  const { contextBlock, tickersFetched } = await fetchLiveMarketContext(candidateTickers)

  // ── Build system prompt with optional live data section ──────────
  const liveSection = contextBlock
    ? `\n\n${contextBlock}`
    : ''

  const systemPrompt = `You are a concise vibe-trading assistant for TradeBuddy.
Help the user manage their simulated portfolio using the tools provided, and answer questions about how to use the app.

Current portfolio:
${portfolioText}
${liveSection}
Trade execution guidelines:
- Use execute_buy when the user wants to purchase shares
- Use execute_sell when the user wants to sell a specific number of shares
- Use remove_holding when the user says "remove", "close", "exit", or "sell all" a position
- "sell half" → calculate shares / 2 (round to 3 decimal places)
- If live market data is shown above, use it as the price for buy/sell actions
- If no price is given and no live data is available, make a reasonable estimate and note it
- Always use UPPERCASE ticker symbols
- For questions or analysis (no trade), respond conversationally with no tool call
- Keep text responses to 1-2 sentences

When the user asks how to do something in the app, answer using the guide below.
${USER_GUIDE ? `\n---\n${USER_GUIDE}` : ''}`

  const { text, toolName, toolInput } = await callLLM(
    {
      provider: llmConfig.provider || 'anthropic',
      model:    llmConfig.model    || 'claude-haiku-4-5-20251001',
      apiKey:   llmConfig.apiKey   || null,
    },
    { systemPrompt, userMessage: message, tools: TOOLS }
  )

  if (!toolName) {
    return {
      response: text ?? "I'm not sure how to help with that. Try \"buy 10 AAPL at 180\" or \"sell half my TSLA\".",
      trade:    null,
      tickersFetched,
    }
  }

  try {
    if (toolName === 'execute_buy') {
      const { symbol, shares, price, reasoning } = toolInput
      const result = await buyStock(userId, symbol, shares, price)
      recordTransaction(userId, result.symbol, 'buy', shares, price, 'agent')
      return {
        response: `Bought ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} at $${price.toFixed(2)}. ${reasoning}`,
        trade:    { action: 'buy', ...result, price },
        tickersFetched,
      }
    }
    if (toolName === 'execute_sell') {
      const { symbol, shares, reasoning } = toolInput
      // Re-use a price we already fetched, or fall back to a fresh Polygon call
      const sym = symbol.toUpperCase()
      let livePrice = 0
      const already = tickersFetched.includes(sym)
      if (already) {
        // Price was fetched as part of the live-data pre-fetch above —
        // parse it back out of contextBlock so we don't double-call Polygon
        const m = contextBlock?.match(new RegExp(`\\[${sym}\\][\\s\\S]*?Price:\\s+\\$([\\d.]+)`))
        livePrice = m ? parseFloat(m[1]) : 0
      }
      if (!livePrice) {
        // Fallback: direct Polygon call
        try {
          const key = process.env.POLYGON_API_KEY
          if (key) {
            const r = await fetch(
              `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${sym}&apiKey=${key}`
            )
            const d = await r.json()
            const t = d.tickers?.[0]
            livePrice = t?.day?.c || t?.lastTrade?.p || t?.prevDay?.c || 0
          }
        } catch { /* non-fatal */ }
      }
      const result = await sellStock(userId, symbol, shares, livePrice)
      if (livePrice > 0) recordTransaction(userId, result.symbol, 'sell', shares, livePrice, 'agent')
      const msg = result.removed
        ? `Sold all ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} — position closed. ${reasoning}`
        : `Sold ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol}. ${result.shares} remaining. ${reasoning}`
      return { response: msg, trade: { action: result.removed ? 'remove' : 'sell', ...result }, tickersFetched }
    }
    if (toolName === 'remove_holding') {
      const { symbol, reasoning } = toolInput
      const result = await removeStock(userId, symbol)
      return {
        response: `Removed ${result.symbol} from your portfolio. ${reasoning}`,
        trade:    { action: 'remove', ...result },
        tickersFetched,
      }
    }
    return { response: 'Unknown action — no trade executed.', trade: null, tickersFetched }
  } catch (err) {
    return { response: err.message, trade: null, tickersFetched }
  }
}
