/**
 * server/tradebuddy/classifyIntent.js
 *
 * Fast LLM-based intent classifier that runs before the main agent call.
 * Replaces the brittle regex heuristics in the original agent.js.
 *
 * Returns a structured classification the agent uses to:
 *   - decide which data to pre-fetch (prices, news, general market)
 *   - route to the correct execution path (trade / research / portfolio / general)
 *   - extract tickers without a hardcoded company-name map
 *
 * Falls back to regex classification if the LLM call fails — so the agent
 * degrades gracefully even when the user's LLM key is misconfigured.
 */

import { callLLM } from '../common/llm.js'

// ── Classifier system prompt ──────────────────────────────────────────────────

const CLASSIFIER_PROMPT = `You are an intent classifier for a stock trading assistant called Vantage.
Analyse the user message and return ONLY a valid JSON object — no explanation, no markdown, no extra text.

Intent types:
- "trade_command"    — explicit buy, sell, remove, close, or exit a position with clear intent
- "research_query"   — news, price check, analysis, earnings, "what's happening", "should I buy/sell"
- "portfolio_query"  — questions about the user's own holdings, performance, P&L, gains/losses
- "general_question" — market concepts, how the app works, anything not needing live data

Return this exact JSON structure:
{
  "intent": "research_query",
  "tickers": ["AAPL", "NVDA"],
  "needs_live_prices": true,
  "needs_news": true,
  "needs_general_market": false,
  "trade": null
}

For trade_command, populate the trade field:
{
  "intent": "trade_command",
  "tickers": ["TSLA"],
  "needs_live_prices": true,
  "needs_news": false,
  "needs_general_market": false,
  "trade": {
    "action": "buy" | "sell" | "remove",
    "symbol": "TSLA",
    "quantity": "10" | "half" | "all"
  }
}

Ticker extraction rules:
- Return uppercase symbols only (e.g. "AAPL", "TSLA", "NVDA")
- Recognise $TICKER notation, plain UPPERCASE words, and company names:
  Apple→AAPL, Microsoft→MSFT, Google/Alphabet→GOOGL, Amazon→AMZN,
  Tesla→TSLA, Meta/Facebook→META, Nvidia→NVDA, Netflix→NFLX,
  Uber→UBER, Airbnb→ABNB, Coinbase→COIN, Palantir→PLTR,
  Shopify→SHOP, Spotify→SPOT, Intel→INTC, AMD→AMD,
  Disney→DIS, Walmart→WMT, Visa→V, Mastercard→MA,
  PayPal→PYPL, Salesforce→CRM, Oracle→ORCL, Boeing→BA,
  JPMorgan→JPM, Goldman→GS, Bank of America→BAC,
  ExxonMobil→XOM, Chevron→CVX, Pfizer→PFE, Johnson→JNJ
- SPY, QQQ, VTI, IWM are valid tickers (ETFs)
- If the user refers to "my holdings", "my positions", or "my portfolio" with no specific
  ticker, return tickers:[] — the caller will substitute portfolio holdings automatically

Data need rules:
- needs_general_market: true ONLY when user asks broadly with no specific tickers
  ("what's the latest?", "how's the market today?", "any market news?")
- needs_live_prices: true for any trade, price check, or "how is X doing?" question
- needs_news: true for news, analysis, earnings, sentiment, or "should I" questions
- For portfolio_query: needs_live_prices=true, needs_news=true, tickers=[]`

// ── Classifier main export ────────────────────────────────────────────────────

/**
 * Classify the user's message into a structured intent object.
 *
 * @param {string}   message          — raw user message
 * @param {string[]} portfolioTickers — symbols currently held (for context only)
 * @param {object}   llmConfig        — { provider, model, apiKey }
 * @returns {Promise<Classification>}
 *
 * @typedef {object} Classification
 * @property {'trade_command'|'research_query'|'portfolio_query'|'general_question'} intent
 * @property {string[]} tickers              — extracted ticker symbols
 * @property {boolean}  needs_live_prices
 * @property {boolean}  needs_news
 * @property {boolean}  needs_general_market
 * @property {object|null} trade             — { action, symbol, quantity } or null
 */
export async function classifyIntent(message, portfolioTickers = [], llmConfig = {}) {
  const cfg = cheapModel(llmConfig)

  const portfolioHint = portfolioTickers.length > 0
    ? `\nUser's current holdings: ${portfolioTickers.join(', ')}`
    : ''

  try {
    const result = await callLLM(cfg, {
      systemPrompt: CLASSIFIER_PROMPT,
      userMessage:  message + portfolioHint,
      tools:        [],  // text-only response
    })

    const classification = parseClassification(result.text)
    if (classification) {
      console.log(`[classify] "${message.slice(0, 60)}" → ${classification.intent} tickers=[${classification.tickers}]`)
      return classification
    }
    throw new Error('Could not parse classifier JSON')

  } catch (err) {
    console.warn(`[classify] LLM failed (${err.message}), falling back to regex`)
    return regexFallback(message, portfolioTickers)
  }
}

// ── JSON parser ───────────────────────────────────────────────────────────────

function parseClassification(text) {
  if (!text) return null

  // Extract JSON object from the response (handle fenced blocks or bare JSON)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw    = fenced ? fenced[1] : text
  const start  = raw.indexOf('{')
  const end    = raw.lastIndexOf('}')
  if (start === -1 || end === -1) return null

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))

    const validIntents = ['trade_command', 'research_query', 'portfolio_query', 'general_question']
    if (!validIntents.includes(parsed.intent)) return null

    return {
      intent:               parsed.intent,
      tickers:              Array.isArray(parsed.tickers) ? parsed.tickers.map(t => String(t).toUpperCase()) : [],
      needs_live_prices:    !!parsed.needs_live_prices,
      needs_news:           !!parsed.needs_news,
      needs_general_market: !!parsed.needs_general_market,
      trade:                parsed.trade ?? null,
    }
  } catch {
    return null
  }
}

// ── Cheap model selector ──────────────────────────────────────────────────────

/**
 * Pick the cheapest/fastest model for the user's configured provider.
 * The classifier doesn't need capability — it needs speed and low cost.
 */
function cheapModel(llmConfig) {
  const { provider = 'anthropic', apiKey } = llmConfig
  const models = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai:    'gpt-4o-mini',
    google:    'gemini-2.5-flash-lite',
    ollama:    llmConfig.model || 'gemma3',
  }
  return { provider, model: models[provider] ?? models.anthropic, apiKey }
}

// ── Regex fallback ────────────────────────────────────────────────────────────

/**
 * Preserve the original regex heuristics as a reliable fallback.
 * Used when the LLM call fails (network error, bad key, etc.).
 * These are intentionally kept simple — correctness matters more than coverage.
 */
function regexFallback(message, portfolioTickers) {
  const isTradeCommand = /\b(buy\s+[\d.]+|sell\s+([\d.]+|half|all)|remove|close\s+(my\s+)?[A-Z]{1,5}|exit)\b/i.test(message)
  const isPortfolioQuery = /\b(portfolio|holdings?|positions?|my stock|my shares|mine)\b/i.test(message)
  const isResearchQuery = /\b(news|latest|update|analysis|analyst|forecast|outlook|report|earnings|recommend|should i|what.s happening|tell me about|how is|why (is|did|has)|what do you think|today|this week|this morning|yesterday|market)\b/i.test(message)

  // Best-effort ticker extraction from regex path
  const tickers = extractTickersRegex(message)
  const hasTickers = tickers.length > 0

  if (isTradeCommand) return {
    intent: 'trade_command',
    tickers,
    needs_live_prices:    true,
    needs_news:           false,
    needs_general_market: false,
    trade: null,
  }

  if (isPortfolioQuery) return {
    intent: 'portfolio_query',
    tickers: [],  // caller uses portfolio holdings
    needs_live_prices:    true,
    needs_news:           true,
    needs_general_market: false,
    trade: null,
  }

  if (isResearchQuery) return {
    intent: 'research_query',
    tickers,
    needs_live_prices:    true,
    needs_news:           true,
    needs_general_market: !hasTickers,
    trade: null,
  }

  return {
    intent: 'general_question',
    tickers: [],
    needs_live_prices:    false,
    needs_news:           false,
    needs_general_market: false,
    trade: null,
  }
}

// ── Minimal regex ticker extractor (fallback only) ────────────────────────────

const TICKER_STOP = new Set([
  'A','I','OK','MY','IN','AT','ON','IF','OR','BY','TO','OF','AN',
  'AS','UP','IS','IT','DO','SO','GO','NO','US','ME','HE','WE',
  'AI','CEO','CFO','COO','ETF','IPO','GDP','USD','EUR','THE',
  'AND','FOR','ALL','BUY','SELL','THIS','THAT','WHAT','WITH',
])

const NAME_TO_TICKER = {
  apple:'AAPL', microsoft:'MSFT', google:'GOOGL', alphabet:'GOOGL',
  amazon:'AMZN', tesla:'TSLA', meta:'META', facebook:'META',
  nvidia:'NVDA', netflix:'NFLX', uber:'UBER', airbnb:'ABNB',
  coinbase:'COIN', palantir:'PLTR', shopify:'SHOP', spotify:'SPOT',
  intel:'INTC', amd:'AMD', qualcomm:'QCOM', disney:'DIS',
  walmart:'WMT', visa:'V', mastercard:'MA', paypal:'PYPL',
  salesforce:'CRM', oracle:'ORCL', ibm:'IBM', boeing:'BA',
}

function extractTickersRegex(text) {
  const tickers = new Set()
  const lower   = text.toLowerCase()
  for (const m of text.matchAll(/\$([A-Z]{1,5})\b/g))   tickers.add(m[1])
  for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g))   { if (!TICKER_STOP.has(m[1])) tickers.add(m[1]) }
  for (const [name, sym] of Object.entries(NAME_TO_TICKER)) { if (lower.includes(name)) tickers.add(sym) }
  return [...tickers]
}
