/**
 * server/market.js
 * Proxy routes for Polygon.io market data.
 *
 * All Polygon API calls are made here on the server — the API key
 * never leaves the backend and is never visible in the browser.
 *
 * Responses are cached in-memory (server/cache.js) to reduce Polygon
 * quota usage and improve response times:
 *   snapshots    →  60 s  (live prices, refresh once per minute)
 *   aggregates   →  60 min (historical bars rarely change)
 *   ticker       →  24 h  (company details are very stable)
 *   search       →   5 min (ticker list is stable)
 *   prev-close   →  60 min (set once per trading day)
 *
 * Mounted at /api/market in server/index.js.
 *
 * Routes:
 *   GET /api/market/snapshots?symbols=AAPL,MSFT
 *   GET /api/market/aggregates/:symbol?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /api/market/ticker/:symbol
 *   GET /api/market/search?q=apple&limit=8
 *   GET /api/market/prev-close/:symbol
 *   GET /api/market/news/:symbol?limit=5
 */

import { Router } from 'express'
import { cacheGet, cacheSet, TTL } from './cache.js'
import { getAppSetting } from './appSettings.js'

const router  = Router()
const BASE    = 'https://api.polygon.io'

// ── Input validators ──────────────────────────────────────────────
const SYMBOL_RE = /^[A-Z0-9.]{1,10}$/
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/

function validSymbol(s) { return SYMBOL_RE.test((s ?? '').toUpperCase()) }
function validDate(d)   { return DATE_RE.test(d ?? '') }

// ── Polygon fetch helper ─────────────────────────────────────────
async function polyFetch(path) {
  const key = await getAppSetting('polygon_api_key', 'POLYGON_API_KEY')
  if (!key) throw new Error('Polygon API key not configured — add it in Admin → App Settings')

  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}${path}${sep}apiKey=${key}`)

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Polygon ${res.status}: ${body}`)
  }
  return res.json()
}

// ── Snapshots ────────────────────────────────────────────────────
// GET /api/market/snapshots?symbols=AAPL,MSFT
//
// Cache key uses sorted symbols so AAPL,MSFT and MSFT,AAPL share the
// same cache entry and don't cause duplicate Polygon calls.
router.get('/snapshots', async (req, res) => {
  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'symbols query param required' })

  const syms = symbols.split(',').map(s => s.trim().toUpperCase()).sort()
  if (syms.some(s => !validSymbol(s))) {
    return res.status(400).json({ error: 'Invalid symbol format' })
  }

  const cacheKey = `snapshots:${syms.join(',')}`
  const cached   = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${syms.join(',')}`
    )
    cacheSet(cacheKey, data, TTL.SNAPSHOT)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── Aggregates (OHLCV bars for charts) ───────────────────────────
// GET /api/market/aggregates/:symbol?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/aggregates/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  const { from, to } = req.query

  if (!validSymbol(symbol))               return res.status(400).json({ error: 'Invalid symbol' })
  if (!validDate(from) || !validDate(to)) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' })

  const cacheKey = `aggs:${symbol}:${from}:${to}`
  const cached   = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    const data = await polyFetch(
      `/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=500`
    )
    cacheSet(cacheKey, data, TTL.AGGREGATES)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── Ticker details ────────────────────────────────────────────────
// GET /api/market/ticker/:symbol
router.get('/ticker/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  if (!validSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  const cacheKey = `ticker:${symbol}`
  const cached   = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    const data = await polyFetch(`/v3/reference/tickers/${symbol}`)
    cacheSet(cacheKey, data, TTL.TICKER)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── Ticker search ─────────────────────────────────────────────────
// GET /api/market/search?q=apple&limit=10
//
// We fetch 3× the requested limit from Polygon so we have enough candidates
// to sort by ticker relevance: exact match → prefix → contains → name match.
// This ensures "QQQ" appears before "CQQQ"/"DVQQ"/etc. when you type "QQQ".
router.get('/search', async (req, res) => {
  const { q } = req.query
  if (!q) return res.json([])

  const limit   = Math.min(parseInt(req.query.limit ?? '10'), 20)
  const polyLim = Math.min(limit * 3, 50)
  const upper   = q.trim().toUpperCase()

  const cacheKey = `search:${upper}:${limit}`
  const cached   = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  // Rank a ticker against the user's query (lower = better match)
  function tickerRank(ticker, u) {
    if (ticker === u)           return 0  // exact: QQQ → QQQ
    if (ticker.startsWith(u))   return 1  // prefix: QQQ → QQQM
    if (ticker.includes(u))     return 2  // contains: QQQ → CQQQ
    return 3                               // name match only
  }

  try {
    // Run text search + exact ticker lookup in parallel.
    const [searchData, exactData] = await Promise.allSettled([
      polyFetch(`/v3/reference/tickers?search=${encodeURIComponent(q)}&market=stocks&active=true&limit=${polyLim}`),
      polyFetch(`/v3/reference/tickers?ticker=${encodeURIComponent(upper)}&market=stocks&active=true&limit=1`),
    ])

    const searchResults = searchData.status === 'fulfilled' ? (searchData.value.results ?? []) : []
    const exactResults  = exactData.status  === 'fulfilled' ? (exactData.value.results  ?? []) : []

    const seen   = new Set()
    const merged = [...exactResults, ...searchResults].filter(t => {
      if (seen.has(t.ticker)) return false
      seen.add(t.ticker)
      return true
    })

    const result = { results: merged
      .sort((a, b) => tickerRank(a.ticker, upper) - tickerRank(b.ticker, upper))
      .slice(0, limit)
    }

    cacheSet(cacheKey, result, TTL.SEARCH)
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── Previous close ────────────────────────────────────────────────
// GET /api/market/prev-close/:symbol
router.get('/prev-close/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  if (!validSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  const cacheKey = `prevclose:${symbol}`
  const cached   = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    const data = await polyFetch(`/v2/aggs/ticker/${symbol}/prev?adjusted=true`)
    cacheSet(cacheKey, data, TTL.PREV_CLOSE)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── News ─────────────────────────────────────────────────────────
// GET /api/market/news/:symbol?limit=5
//
// Returns the most recent news articles for a ticker from Polygon.
// Cached for 10 minutes so rapid page switches don't hammer the quota.
router.get('/news/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  if (!validSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  const limit    = Math.min(parseInt(req.query.limit ?? '5', 10), 10)
  const cacheKey = `news:${symbol}:${limit}`
  const cached   = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    const data = await polyFetch(
      `/v2/reference/news?ticker=${symbol}&limit=${limit}&sort=published_utc&order=desc`
    )
    // Normalise to a compact shape so the frontend gets only what it needs
    const articles = (data.results ?? []).map(a => ({
      id:           a.id,
      title:        a.title,
      description:  a.description ?? null,
      url:          a.article_url,
      publishedAt:  a.published_utc,
      source:       a.publisher?.name ?? 'Unknown',
      imageUrl:     a.image_url ?? null,
      tickers:      a.tickers ?? [],
    }))
    const result = { articles }
    cacheSet(cacheKey, result, TTL.NEWS ?? 600_000)   // 10 min
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
