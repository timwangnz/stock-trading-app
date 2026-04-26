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
import { callMCPTool } from './mcp.js'
import { getAppSetting } from './appSettings.js'

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
 * Fetch up to 3 recent news articles for a single ticker from Polygon.
 * Returns structured articles + a pre-formatted prompt string.
 */
async function fetchNewsForTicker(symbol, apiKey) {
  try {
    const res = await fetch(
      `https://api.polygon.io/v2/reference/news?ticker=${symbol}&limit=3&sort=published_utc&order=desc&apiKey=${apiKey}`
    )
    if (!res.ok) return null
    const data    = await res.json()
    const results = data.results ?? []
    if (results.length === 0) return null

    const articles = results.map(a => {
      const diff = Date.now() - new Date(a.published_utc).getTime()
      const h    = Math.floor(diff / 3_600_000)
      const age  = h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
      return {
        symbol,
        title:       a.title,
        description: a.description?.slice(0, 160) ?? null,
        url:         a.article_url ?? null,
        source:      a.publisher?.name ?? null,
        age,
      }
    })

    const promptBlock = `[${symbol} Recent News]\n` +
      articles.map(a => `  • [${a.age}] ${a.title}` + (a.description ? ` — ${a.description}…` : '')).join('\n')

    return { articles, promptBlock }
  } catch {
    return null
  }
}

/**
 * Fetch general market news from Polygon (no ticker filter).
 * Used when the user asks broad questions like "what's the latest?".
 */
async function fetchGeneralMarketNews(apiKey, limit = 5) {
  try {
    const res = await fetch(
      `https://api.polygon.io/v2/reference/news?limit=${limit}&sort=published_utc&order=desc&apiKey=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const data    = await res.json()
    const results = data.results ?? []
    if (results.length === 0) return null

    const lines = results.map(a => {
      const diff = Date.now() - new Date(a.published_utc).getTime()
      const h    = Math.floor(diff / 3_600_000)
      const age  = h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
      const tickers = (a.tickers ?? []).slice(0, 3).join(', ')
      return `  • [${age}]${tickers ? ` (${tickers})` : ''} ${a.title}` +
             (a.description ? ` — ${a.description.slice(0, 120)}…` : '')
    })

    return '[General Market News — latest from Polygon.io]\n' + lines.join('\n')
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
async function fetchLiveMarketContext(tickers, { generalNews = false } = {}) {
  const key = await getAppSetting('polygon_api_key', 'POLYGON_API_KEY')
  if (!key) return { contextBlock: null, priceBlock: null, tickersFetched: [], newsArticles: [] }

  // No specific tickers — just fetch general market news if requested
  if (tickers.length === 0) {
    if (!generalNews) return { contextBlock: null, priceBlock: null, tickersFetched: [], newsArticles: [] }
    const newsBlock = await fetchGeneralMarketNews(key)
    const contextBlock = newsBlock
      ? '📰 LATEST MARKET NEWS (from Polygon.io — published within the last 24h):\n\n' + newsBlock
      : null
    return { contextBlock, priceBlock: null, tickersFetched: [], newsArticles: [] }
  }

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
      return { contextBlock: null, priceBlock: null, tickersFetched: [], newsArticles: [] }
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

    if (snapshots.length === 0) return { contextBlock: null, priceBlock: null, tickersFetched: [], newsArticles: [] }

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
    const newsItems = newsResults
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean)

    const allArticles = newsItems.flatMap(n => n.articles)

    // ── Assemble context blocks ────────────────────────────────
    const priceBlock =
      '📈 LIVE MARKET DATA (Polygon.io — use these exact numbers in your answer):\n\n' +
      priceLines.join('\n\n') +
      '\n\nIMPORTANT: Always quote the exact prices above. Never use outdated or approximate values.'

    const newsBlock = newsItems.length > 0
      ? '\n\n📰 RECENT NEWS (use these headlines to inform your analysis):\n\n' +
        newsItems.map(n => n.promptBlock).join('\n\n')
      : ''

    // Full block = prices + news (used when no MCP tools are connected)
    const contextBlock = priceBlock + newsBlock

    return {
      contextBlock,
      priceBlock,   // prices only — used when MCP tools handle news
      tickersFetched: snapshots.map(s => s.symbol),
      newsArticles:   allArticles,
    }
  } catch {
    return { contextBlock: null, priceBlock: null, tickersFetched: [], newsArticles: [] }
  }
}

// ── Tool definitions (Anthropic format — llm.js converts for other providers) ──

// Confidence threshold: below this we surface a confirmation card instead of executing.
export const TRADE_CONFIDENCE_THRESHOLD = 0.95

const CONFIDENCE_FIELD = {
  type: 'number',
  description:
    'Your confidence (0.0–1.0) that this trade matches the user\'s exact intent. ' +
    'Use 0.99 for explicit, unambiguous commands with a clear quantity and ticker. ' +
    'Use 0.5–0.8 when the ticker, quantity, or intent is ambiguous.',
}

const TOOLS = [
  {
    name: 'execute_buy',
    description: 'Buy (or add to) a stock position in the portfolio. Do NOT fill in a price — the server always uses the live market price.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:     { type: 'string', description: 'Ticker symbol in uppercase, e.g. AAPL' },
        shares:     { type: 'number', description: 'Number of shares to buy (can be fractional)' },
        reasoning:  { type: 'string', description: 'One-sentence explanation shown to the user' },
        confidence: CONFIDENCE_FIELD,
      },
      required: ['symbol', 'shares', 'reasoning', 'confidence'],
    },
  },
  {
    name: 'execute_sell',
    description: 'Sell a specific number of shares of a stock.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:     { type: 'string', description: 'Ticker symbol in uppercase' },
        shares:     { type: 'number', description: 'Number of shares to sell' },
        reasoning:  { type: 'string', description: 'One-sentence explanation shown to the user' },
        confidence: CONFIDENCE_FIELD,
      },
      required: ['symbol', 'shares', 'reasoning', 'confidence'],
    },
  },
  {
    name: 'remove_holding',
    description: 'Remove an entire stock position (sell all shares) from the portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:     { type: 'string', description: 'Ticker symbol in uppercase' },
        reasoning:  { type: 'string', description: 'One-sentence explanation shown to the user' },
        confidence: CONFIDENCE_FIELD,
      },
      required: ['symbol', 'reasoning', 'confidence'],
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

export async function buyStock(userId, symbol, shares, price) {
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

export async function sellStock(userId, symbol, shares, price = 0) {
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

export async function removeStock(userId, symbol, price = 0) {
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
 * @param {Array}  opts.mcpServers  - rows from mcp_servers with tool definitions attached
 * @param {Array}  opts.userContext - enabled rows from agent_context (instructions, ticker notes, MCP rules)
 */

/**
 * Build the [User Knowledge Base] block injected into the system prompt.
 */
function buildUserContextBlock(userContext = []) {
  if (!userContext || userContext.length === 0) return ''

  const instructions = userContext.filter(e => e.type === 'instruction')
  const tickerNotes  = userContext.filter(e => e.type === 'ticker_note')
  const mcpRules     = userContext.filter(e => e.type === 'mcp_rule')

  const parts = []

  if (instructions.length > 0) {
    parts.push('AGENT INSTRUCTIONS (follow these rules when reasoning and trading):')
    instructions.forEach(e => parts.push(`• [${e.title}] ${e.content}`))
  }

  if (tickerNotes.length > 0) {
    parts.push('\nTICKER CONTEXT (user-defined notes on specific stocks):')
    tickerNotes.forEach(e => {
      const sym = e.ticker ? `${e.ticker} — ` : ''
      parts.push(`• ${sym}[${e.title}] ${e.content}`)
    })
  }

  if (mcpRules.length > 0) {
    parts.push('\nMCP / EXTERNAL DATA RULES (how to interpret external search results):')
    mcpRules.forEach(e => parts.push(`• [${e.title}] ${e.content}`))
  }

  return `\n\n[User Knowledge Base — auto-injected context]\n${parts.join('\n')}`
}

export async function runTradingAgent({ userId, message, portfolio, llmConfig = {}, mcpServers = [], userContext = [] }) {
  const portfolioText = portfolio.length === 0
    ? 'The portfolio is currently empty.'
    : portfolio
        .map(h =>
          `  • ${h.symbol}: ${h.shares} shares, avg cost $${Number(h.avgCost).toFixed(2)}` +
          (h.value ? `, current value $${Number(h.value).toFixed(2)}` : '')
        )
        .join('\n')

  // ── Step 1: extract tickers ──────────────────────────────────────
  const portfolioTickers = (portfolio ?? []).map(h => h.symbol).filter(Boolean)
  let   candidateTickers = extractTickers(message)

  // ── Step 2: detect intent ─────────────────────────────────────────
  const isTradeCommand   = /\b(buy\s+[\d.]+|sell\s+([\d.]+|half|all)|remove|close\s+(my\s+)?[A-Z]{1,5}|exit)\b/i.test(message)
  const isResearchQuery  = /\b(news|latest|update|analysis|analyst|forecast|outlook|report|earnings|recommend|should i|what.s happening|tell me about|how is|why (is|did|has)|what do you think|last (week|friday|monday|tuesday|wednesday|thursday|saturday|sunday|month|year|quarter)|yesterday|performance|how did|what did|what happened|happened|did .* open|is .* open|market open|market close|after.?hours|pre.?market|this week|today.s|this morning)\b/i.test(message)
  const isPortfolioQuery = /\b(portfolio|holdings?|positions?|my stock|mine)\b/i.test(message)
  const needsMCPSearch   = !isTradeCommand && isResearchQuery

  // When no tickers found, fall back to portfolio holdings for research/portfolio queries
  if (candidateTickers.length === 0 && (isPortfolioQuery || (isResearchQuery && portfolioTickers.length > 0))) {
    candidateTickers = portfolioTickers.slice(0, 5)
  }

  // Flag general market news when user asks broadly with no specific tickers
  const needsGeneralNews = !isTradeCommand && isResearchQuery && candidateTickers.length === 0

  // ── Step 3: collect MCP tool definitions ─────────────────────────
  const mcpToolDefs = mcpServers.flatMap(s => s._tools ?? [])

  // Find "search" tools — only used when the query warrants external lookup
  const searchTools = needsMCPSearch
    ? mcpToolDefs.filter(t =>
        /search|news|crawl|fetch|browse|retrieve|web/i.test(t.name + ' ' + (t.description ?? ''))
      )
    : []

  // ── Step 4: pre-fetch relevant context sources in parallel ────────
  const [marketCtx, ...mcpResults] = await Promise.allSettled([
    fetchLiveMarketContext(candidateTickers, { generalNews: needsGeneralNews }),
    ...searchTools.map(tool => {
      const query = candidateTickers.length > 0
        ? `${message} ${candidateTickers.join(' ')}`
        : message
      return callMCPTool(
        { url: tool._mcpServerUrl, auth_header: tool._mcpAuthHeader },
        tool._mcpToolName,
        { query }
      ).then(result => ({ toolName: tool.name, result }))
        .catch(err  => ({ toolName: tool.name, result: `Error: ${err.message}` }))
    }),
  ])

  const { contextBlock, tickersFetched, newsArticles } =
    marketCtx.status === 'fulfilled'
      ? marketCtx.value
      : { contextBlock: null, tickersFetched: [], newsArticles: [] }

  // Collect MCP results that succeeded
  const mcpContextParts = mcpResults
    .filter(r => r.status === 'fulfilled' && r.value?.result)
    .map(r => {
      const { toolName, result } = r.value
      console.log(`[agent] pre-fetched "${toolName}" → ${String(result).length} chars`)
      return `[${toolName} results]\n${result}`
    })

  const mcpToolsUsed = mcpResults
    .filter(r => r.status === 'fulfilled' && r.value?.result && !r.value.result.startsWith('Error:'))
    .map(r => r.value.toolName)

  // ── Step 5: assemble system prompt with all pre-fetched context ──
  const liveSection        = contextBlock ? `\n\n${contextBlock}` : ''
  const mcpSection         = mcpContextParts.length > 0
    ? `\n\n📡 EXTERNAL SEARCH RESULTS (use this information to answer the user):\n\n${mcpContextParts.join('\n\n')}`
    : ''
  const userContextSection = buildUserContextBlock(userContext)

  const systemPrompt = `You are a knowledgeable trading assistant for TradeBuddy.
Help the user with anything trading or markets related — market hours, news, analysis, general finance questions, and portfolio management.
You can execute trades and answer general knowledge questions.

IMPORTANT — live data rules:
- If live prices or news appear in this prompt (marked 📈 or 📰), they are REAL data fetched right now from Polygon.io. Use them confidently. Never say you "cannot access" or "don't have" real-time data when it is shown below.
- If no live data appears below AND the user asks about current prices/news, briefly acknowledge you don't have a live feed for that specific query and suggest they ask about a specific ticker (e.g. "What's the news on AAPL?") or connect a search MCP server.
- When MCP search results appear (marked 📡), use them to answer precisely.
Today is ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })} ET.

Current portfolio:
${portfolioText}
${liveSection}${mcpSection}${userContextSection}
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

  // ── Step 6: single LLM call with all context pre-loaded ──────────
  const llmCfg = {
    provider: llmConfig.provider || 'anthropic',
    model:    llmConfig.model    || 'claude-haiku-4-5-20251001',
    apiKey:   llmConfig.apiKey   || null,
  }

  // Only expose trade tools for explicit trade commands.
  // For questions/analysis, passing no tools forces a text-only response,
  // which prevents over-eager models (e.g. Gemini) from executing trades
  // when the user just asked a question.
  const turn1 = await callLLM(llmCfg, {
    systemPrompt,
    userMessage: message,
    tools: isTradeCommand ? TOOLS : undefined,
  })

  const { text, toolName, toolInput } = turn1

  if (!toolName) {
    return {
      response:    text ?? "I'm not sure how to help with that. Try \"buy 10 AAPL at 180\" or \"sell half my TSLA\".",
      trade:       null,
      tickersFetched,
      newsArticles,
      mcpToolUsed: mcpToolsUsed.length > 0 ? mcpToolsUsed[0] : null,
    }
  }

  const confidence = toolInput?.confidence ?? 1

  // ── Stage 2: server-side executability check ─────────────────────
  // Runs regardless of confidence — catches problems the LLM can't know about.
  const { livePrice, blocker } = await validateTrade(toolName, toolInput, userId)

  if (blocker) {
    // Trade is not executable — return a clear error, no confirmation card
    return { response: blocker, trade: null, pendingTrade: null, tickersFetched, newsArticles }
  }

  // ── Stage 1: intent clarity check ───────────────────────────────
  // Trade is executable but LLM wasn't confident — ask the user to confirm.
  if (confidence < TRADE_CONFIDENCE_THRESHOLD) {
    return {
      response:     null,
      pendingTrade: { toolName, ...toolInput, livePrice },
      trade:        null,
      tickersFetched,
      newsArticles,
    }
  }

  // Both stages pass — execute immediately with the pre-resolved live price.
  return executeTrade({ toolName, toolInput, userId, livePrice, contextBlock, tickersFetched, newsArticles })
}

// ── Live price resolver ───────────────────────────────────────────
/**
 * Resolve the current market price for a symbol.
 * First checks the pre-fetched contextBlock snapshot, then falls back to a
 * direct Polygon API call. Returns 0 if unavailable.
 */
export async function fetchLivePrice(symbol, contextBlock = null, tickersFetched = []) {
  const sym = symbol.toUpperCase()

  // 1. Try the already-fetched context block (fastest — no extra API call)
  if (tickersFetched.includes(sym) && contextBlock) {
    const m = contextBlock.match(new RegExp(`\\[${sym}\\][\\s\\S]*?Price:\\s+\\$([\\d.]+)`))
    if (m) return parseFloat(m[1])
  }

  // 2. Fall back to a fresh Polygon snapshot
  try {
    const key = await getAppSetting('polygon_api_key', 'POLYGON_API_KEY')
    if (!key) return 0
    const r = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${sym}&apiKey=${key}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!r.ok) return 0
    const d = await r.json()
    const t = d.tickers?.[0]
    return t?.day?.c || t?.lastTrade?.p || t?.prevDay?.c || 0
  } catch {
    return 0
  }
}

/**
 * Server-side executability check — runs independently of the LLM's confidence score.
 * Returns { livePrice, blocker } where blocker is a human-readable error string or null.
 *
 * Checks:
 *  1. Live price available (all buy/sell actions)
 *  2. Sufficient cash balance (buy)
 *  3. Sufficient share holdings (sell)
 *  4. Holding exists (remove)
 */
export async function validateTrade(toolName, toolInput, userId) {
  const symbol = toolInput.symbol?.toUpperCase()
  const shares = Number(toolInput.shares) || 0
  let livePrice = 0

  // ── 1. Live price ───────────────────────────────────────────────
  if (toolName === 'execute_buy' || toolName === 'execute_sell') {
    livePrice = await fetchLivePrice(symbol)
    if (!livePrice) {
      return {
        livePrice: 0,
        blocker: `No live price available for ${symbol} right now. The market may be closed or the ticker unrecognised. Try again later or specify a different symbol.`,
      }
    }
  }

  // ── 2. Sufficient funds (buy) ───────────────────────────────────
  if (toolName === 'execute_buy') {
    const cost = shares * livePrice
    const cash = await getCash(userId)
    if (cash < cost) {
      return {
        livePrice,
        blocker: `Insufficient funds — this trade costs $${cost.toFixed(2)} but you only have $${cash.toFixed(2)} cash.`,
      }
    }
  }

  // ── 3. Sufficient shares (sell) ─────────────────────────────────
  if (toolName === 'execute_sell') {
    const { rows: [holding] } = await pool.query(
      'SELECT shares FROM portfolio WHERE user_id=$1 AND symbol=$2',
      [userId, symbol]
    )
    if (!holding) {
      return { livePrice, blocker: `You don't hold any ${symbol} to sell.` }
    }
    if (shares > parseFloat(holding.shares)) {
      return {
        livePrice,
        blocker: `You only hold ${parseFloat(holding.shares).toFixed(4)} shares of ${symbol} — can't sell ${shares}.`,
      }
    }
  }

  // ── 4. Holding exists (remove) ──────────────────────────────────
  if (toolName === 'remove_holding') {
    const { rows: [holding] } = await pool.query(
      'SELECT id FROM portfolio WHERE user_id=$1 AND symbol=$2',
      [userId, symbol]
    )
    if (!holding) {
      return { livePrice: 0, blocker: `You don't hold any ${symbol} to remove.` }
    }
  }

  return { livePrice, blocker: null }
}

/**
 * Execute a confirmed trade (used by both the agent and the confirm-trade endpoint).
 * Always uses live market price — the LLM's stated price is only used as a fallback
 * when no live data is available.
 */
export async function executeTrade({ toolName, toolInput, userId, livePrice = 0, contextBlock = null, tickersFetched = [], newsArticles = [] }) {
  try {
    if (toolName === 'execute_buy') {
      const { symbol, shares, reasoning } = toolInput
      const sym = symbol.toUpperCase()

      // Use pre-resolved price, then try live fetch, no fallback to LLM guess
      const execPrice = livePrice || await fetchLivePrice(sym, contextBlock, tickersFetched)
      if (!execPrice) throw new Error(`No live price available for ${sym} — trade cannot be executed.`)

      const result = await buyStock(userId, sym, shares, execPrice)
      recordTransaction(userId, result.symbol, 'buy', shares, execPrice, 'agent')
      return {
        response: `Bought ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} at $${execPrice.toFixed(2)}. ${reasoning}`,
        trade:    { action: 'buy', ...result, price: execPrice },
        tickersFetched, newsArticles,
      }
    }
    if (toolName === 'execute_sell') {
      const { symbol, shares, reasoning } = toolInput
      const sym = symbol.toUpperCase()
      const execPrice = livePrice || await fetchLivePrice(sym, contextBlock, tickersFetched)
      const result = await sellStock(userId, sym, shares, execPrice)
      if (execPrice > 0) recordTransaction(userId, result.symbol, 'sell', shares, execPrice, 'agent')
      const msg = result.removed
        ? `Sold all ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} — position closed. ${reasoning}`
        : `Sold ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol}. ${result.shares} remaining. ${reasoning}`
      return { response: msg, trade: { action: result.removed ? 'remove' : 'sell', ...result }, tickersFetched, newsArticles }
    }
    if (toolName === 'remove_holding') {
      const { symbol, reasoning } = toolInput
      const result = await removeStock(userId, symbol)
      return {
        response: `Removed ${result.symbol} from your portfolio. ${reasoning}`,
        trade:    { action: 'remove', ...result },
        tickersFetched, newsArticles,
      }
    }
    return { response: 'Unknown action — no trade executed.', trade: null, tickersFetched, newsArticles }
  } catch (err) {
    return { response: err.message, trade: null, tickersFetched, newsArticles }
  }
}
