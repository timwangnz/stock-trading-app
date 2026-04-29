/**
 * marketContext.js
 * Intent detection + Polygon data fetcher for the Trading Agent.
 *
 * Before a message is sent to the LLM, we:
 *   1. Extract any ticker symbols mentioned in the text
 *   2. Detect what kind of data the user wants (price, details, news…)
 *   3. Fetch that data from the backend → Polygon
 *   4. Return a formatted "Live Market Data" block to inject into the prompt
 *
 * The LLM then answers using real numbers instead of guessing.
 */

import { getSnapshots, getTickerDetails, searchTickers } from './polygonApi'

// ── Well-known company name → ticker mappings ────────────────────
// Extend this list as needed. Lower-cased for matching.
const NAME_TO_TICKER = {
  'apple':      'AAPL',
  'microsoft':  'MSFT',
  'google':     'GOOGL',
  'alphabet':   'GOOGL',
  'amazon':     'AMZN',
  'tesla':      'TSLA',
  'meta':       'META',
  'facebook':   'META',
  'nvidia':     'NVDA',
  'netflix':    'NFLX',
  'uber':       'UBER',
  'airbnb':     'ABNB',
  'coinbase':   'COIN',
  'palantir':   'PLTR',
  'shopify':    'SHOP',
  'spotify':    'SPOT',
  'twitter':    'X',
  'intel':      'INTC',
  'amd':        'AMD',
  'qualcomm':   'QCOM',
  'disney':     'DIS',
  'walmart':    'WMT',
  'visa':       'V',
  'mastercard': 'MA',
  'paypal':     'PYPL',
  'salesforce': 'CRM',
  'oracle':     'ORCL',
  'ibm':        'IBM',
  'boeing':     'BA',
}

// Keywords that suggest the user wants live market data
const PRICE_KEYWORDS = [
  'price', 'quote', 'trading', 'trading at', 'worth', 'value',
  'how much', 'current', 'today', 'stock', 'share', 'cost',
  'buy', 'sell', 'market cap', 'high', 'low', 'open', 'close',
  'up', 'down', 'gain', 'loss', 'change', 'performance',
  'doing', 'perform', 'tell me about', 'about', 'look up',
  'check', 'holdings', 'portfolio', 'position',
]

// Keywords that suggest detailed company info is needed
const DETAIL_KEYWORDS = [
  'what is', 'tell me about', 'describe', 'overview', 'summary',
  'sector', 'industry', 'market cap', 'company', 'business',
]

/**
 * Extract ticker symbols from a message.
 * Looks for:
 *  - $AAPL  style
 *  - plain 1-5 letter uppercase tickers (AAPL, MSFT, GOOGL…)
 *  - known company names (apple → AAPL)
 *
 * Returns an array of uppercase ticker strings, deduplicated.
 */
export function extractTickers(text) {
  const tickers = new Set()
  const lower   = text.toLowerCase()

  // $TICKER pattern
  const dollarMatches = text.matchAll(/\$([A-Z]{1,5})\b/g)
  for (const m of dollarMatches) tickers.add(m[1])

  // Plain UPPERCASE 1-5 letter words that look like tickers
  // Exclude common English words that happen to be all-caps
  const STOP = new Set([
    'A','I','OK','MY','IN','AT','ON','IF','OR','BY','TO','OF','AN',
    'AS','UP','IS','IT','DO','SO','GO','NO','US','ME','HE','WE',
    'AI','CEO','CFO','COO','ETF','IPO','GDP','USD','EUR','THE',
    'AND','FOR','ALL','BUY','SELL','THIS','THAT','WHAT','WITH',
  ])
  const upperMatches = text.matchAll(/\b([A-Z]{2,5})\b/g)
  for (const m of upperMatches) {
    if (!STOP.has(m[1])) tickers.add(m[1])
  }

  // Company name → ticker
  for (const [name, ticker] of Object.entries(NAME_TO_TICKER)) {
    if (lower.includes(name)) tickers.add(ticker)
  }

  return [...tickers]
}

/**
 * Detect whether the message is asking for market data at all.
 * Returns true if at least one price/detail keyword appears.
 */
export function wantsMarketData(text) {
  const lower = text.toLowerCase()
  return PRICE_KEYWORDS.some(kw => lower.includes(kw)) ||
         DETAIL_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * Detect whether the message specifically wants company details
 * (description, sector, market cap) rather than just price.
 */
function wantsDetails(text) {
  const lower = text.toLowerCase()
  return DETAIL_KEYWORDS.some(kw => lower.includes(kw)) ||
         lower.includes('market cap') || lower.includes('sector')
}

/**
 * Format a snapshot object into a readable string for the LLM.
 */
function formatSnapshot(s) {
  const dir    = s.change >= 0 ? '▲' : '▼'
  const chgPct = Math.abs(s.changePct).toFixed(2)
  const chg    = Math.abs(s.change).toFixed(2)

  return [
    `  Ticker:       ${s.symbol}`,
    `  Price:        $${Number(s.price).toFixed(2)}`,
    `  Change:       ${dir} $${chg} (${chgPct}%) today`,
    `  Open:         $${Number(s.open).toFixed(2)}`,
    `  Day High:     $${Number(s.high).toFixed(2)}`,
    `  Day Low:      $${Number(s.low).toFixed(2)}`,
    `  Prev Close:   $${Number(s.prevClose).toFixed(2)}`,
    `  Volume:       ${Number(s.volume).toLocaleString()}`,
  ].join('\n')
}

/**
 * Format ticker details into a readable string.
 */
function formatDetails(d) {
  const cap = d.marketCap
    ? `$${(d.marketCap / 1e9).toFixed(1)}B`
    : 'N/A'

  return [
    `  Company:      ${d.name ?? d.symbol}`,
    `  Sector:       ${d.sector ?? 'N/A'}`,
    `  Market Cap:   ${cap}`,
    d.description ? `  About:        ${d.description.slice(0, 200)}…` : null,
  ].filter(Boolean).join('\n')
}

/**
 * Main entry point.
 *
 * Given a user message and the portfolio, returns:
 *   { contextBlock: string | null, tickersFetched: string[] }
 *
 * contextBlock is ready to be appended to the LLM system prompt.
 * It is null if no market data was needed or found.
 */
export async function buildMarketContext(message, portfolio = []) {
  // Always include portfolio tickers so the agent can answer
  // "how are my holdings doing?" without explicit ticker names.
  const portfolioTickers = (portfolio ?? []).map(h => h.symbol).filter(Boolean)

  let tickers = extractTickers(message)

  // If no tickers found in the message but user is clearly asking about
  // their portfolio performance, fall back to portfolio tickers.
  const looksLikePortfolioQuery = /\b(portfolio|holdings?|positions?|my stock|mine)\b/i.test(message)
  if (tickers.length === 0 && looksLikePortfolioQuery) {
    tickers = portfolioTickers
  }

  // Deduplicate and cap at 5 to avoid hammering the API
  tickers = [...new Set([...tickers])].slice(0, 5)

  // Bail out if: no tickers found AND no market-data intent detected
  // (portfolio queries are always considered market-data intent)
  if (tickers.length === 0) return { contextBlock: null, tickersFetched: [] }
  if (!wantsMarketData(message) && !looksLikePortfolioQuery) {
    return { contextBlock: null, tickersFetched: [] }
  }

  const sections  = []
  const fetched   = []
  const needsInfo = wantsDetails(message)

  // ── Fetch snapshots (price data) ─────────────────────────────
  try {
    const snapshots = await getSnapshots(tickers)
    if (snapshots.length > 0) {
      fetched.push(...snapshots.map(s => s.symbol))
      sections.push(
        '📈 LIVE MARKET DATA (from Polygon.io, use these exact numbers in your answer):\n' +
        snapshots.map(s => `\n[${s.symbol}]\n${formatSnapshot(s)}`).join('\n')
      )
    }
  } catch (err) {
    sections.push(`⚠ Could not fetch price data: ${err.message}`)
  }

  // ── Optionally fetch company details ─────────────────────────
  if (needsInfo && tickers.length <= 2) {
    for (const ticker of tickers) {
      try {
        const details = await getTickerDetails(ticker)
        if (details?.name) {
          sections.push(`\n[${ticker} Company Info]\n${formatDetails(details)}`)
        }
      } catch {
        // non-fatal — price data is more important
      }
    }
  }

  if (sections.length === 0) return { contextBlock: null, tickersFetched: [] }

  return {
    contextBlock:  sections.join('\n\n'),
    tickersFetched: fetched,
  }
}
