/**
 * polygonApi.js
 * Thin wrapper around the Polygon.io REST API.
 *
 * Your API key is read from the VITE_POLYGON_API_KEY environment variable
 * defined in the .env file at the project root. Never hard-code it here!
 *
 * Polygon.io docs: https://polygon.io/docs/stocks
 */

const API_KEY = import.meta.env.VITE_POLYGON_API_KEY
const BASE    = 'https://api.polygon.io'

// Helper: throw a useful error if the key is missing
function requireKey() {
  if (!API_KEY) {
    throw new Error(
      'Missing VITE_POLYGON_API_KEY. Create a .env file in the project root with:\n' +
      'VITE_POLYGON_API_KEY=your_key_here'
    )
  }
}

// Helper: fetch + parse, throws on non-2xx
async function apiFetch(path) {
  requireKey()
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}apiKey=${API_KEY}`
  const res  = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Polygon ${res.status}: ${body}`)
  }
  return res.json()
}

// ── Snapshots (current price + today's change) ────────────────
/**
 * Fetch current-day snapshot for one or more tickers.
 * Returns an array of enriched stock objects ready for the UI.
 *
 * Polygon endpoint:
 *   GET /v2/snapshot/locale/us/markets/stocks/tickers?tickers=AAPL,MSFT,...
 */
export async function getSnapshots(symbols) {
  const tickers = symbols.join(',')
  const data    = await apiFetch(
    `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}`
  )

  // Normalize Polygon's response shape into the same shape the app uses
  return (data.tickers ?? []).map(t => ({
    symbol:    t.ticker,
    price:     t.day?.c   ?? t.prevDay?.c ?? 0,
    change:    parseFloat((t.todaysChange    ?? 0).toFixed(2)),
    changePct: parseFloat((t.todaysChangePerc ?? 0).toFixed(2)),
    volume:    t.day?.v   ?? 0,
    high:      t.day?.h   ?? 0,
    low:       t.day?.l   ?? 0,
    open:      t.day?.o   ?? 0,
    prevClose: t.prevDay?.c ?? 0,
  }))
}

// ── Aggregates (OHLCV bars for charts) ───────────────────────
/**
 * Fetch daily OHLCV bars for a single ticker between two dates.
 *
 * @param {string} symbol  - e.g. 'AAPL'
 * @param {string} from    - 'YYYY-MM-DD'
 * @param {string} to      - 'YYYY-MM-DD'
 *
 * Polygon endpoint:
 *   GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}
 */
export async function getAggregates(symbol, from, to) {
  const data = await apiFetch(
    `/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=500`
  )

  // Polygon uses Unix ms timestamps — convert to 'YYYY-MM-DD' strings
  return (data.results ?? []).map(bar => ({
    date:   new Date(bar.t).toISOString().split('T')[0],
    open:   bar.o,
    high:   bar.h,
    low:    bar.l,
    close:  bar.c,
    volume: bar.v,
  }))
}

// ── Ticker details ────────────────────────────────────────────
/**
 * Fetch reference info (company name, sector, etc.) for a ticker.
 *
 * Polygon endpoint:
 *   GET /v3/reference/tickers/{ticker}
 */
export async function getTickerDetails(symbol) {
  const data = await apiFetch(`/v3/reference/tickers/${symbol}`)
  const r    = data.results ?? {}
  return {
    symbol:      r.ticker,
    name:        r.name,
    sector:      r.sic_description ?? 'N/A',
    marketCap:   r.market_cap,
    description: r.description,
    homepageUrl: r.homepage_url,
  }
}

// ── Ticker search ─────────────────────────────────────────────
/**
 * Search for tickers by symbol or company name.
 * Powers the autocomplete in the "Add Holding" form.
 *
 * @param {string} query  - e.g. "apple" or "AAPL"
 * @param {number} limit  - max results to return (default 8)
 *
 * Polygon endpoint:
 *   GET /v3/reference/tickers?search=<query>&market=stocks&active=true
 */
export async function searchTickers(query, limit = 8) {
  if (!query || query.trim().length === 0) return []
  const data = await apiFetch(
    `/v3/reference/tickers?search=${encodeURIComponent(query)}&market=stocks&active=true&limit=${limit}`
  )
  return (data.results ?? []).map(t => ({
    symbol: t.ticker,
    name:   t.name,
    market: t.market,
    type:   t.type,    // 'CS' = common stock, 'ETF', etc.
  }))
}

// ── Previous close ────────────────────────────────────────────
/**
 * Get the previous trading day's close for a single ticker.
 * Useful as a fallback when intraday snapshot isn't available (e.g. weekends).
 */
export async function getPrevClose(symbol) {
  const data = await apiFetch(`/v2/aggs/ticker/${symbol}/prev?adjusted=true`)
  return data.results?.[0] ?? null
}

// ── Date helpers ──────────────────────────────────────────────
/** Returns a 'YYYY-MM-DD' string for N days ago */
export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

/** Returns today's date as 'YYYY-MM-DD' */
export function today() {
  return new Date().toISOString().split('T')[0]
}
