/**
 * server/market.js
 * Proxy routes for Polygon.io market data.
 *
 * All Polygon API calls are made here on the server — the API key
 * never leaves the backend and is never visible in the browser.
 *
 * Mounted at /api/market in server/index.js.
 *
 * Routes:
 *   GET /api/market/snapshots?symbols=AAPL,MSFT
 *   GET /api/market/aggregates/:symbol?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /api/market/ticker/:symbol
 *   GET /api/market/search?q=apple&limit=8
 *   GET /api/market/prev-close/:symbol
 */

import { Router } from 'express'

const router  = Router()
const BASE    = 'https://api.polygon.io'

// ── Input validators ──────────────────────────────────────────────
const SYMBOL_RE = /^[A-Z0-9.]{1,10}$/
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/

function validSymbol(s) { return SYMBOL_RE.test((s ?? '').toUpperCase()) }
function validDate(d)   { return DATE_RE.test(d ?? '') }

// ── Polygon fetch helper ─────────────────────────────────────────
async function polyFetch(path) {
  const key = process.env.POLYGON_API_KEY
  if (!key) throw new Error('POLYGON_API_KEY is not set on the server')

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
router.get('/snapshots', async (req, res) => {
  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'symbols query param required' })

  // Validate each symbol
  const syms = symbols.split(',').map(s => s.trim().toUpperCase())
  if (syms.some(s => !validSymbol(s))) {
    return res.status(400).json({ error: 'Invalid symbol format' })
  }

  try {
    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${syms.join(',')}`
    )
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

  if (!validSymbol(symbol))     return res.status(400).json({ error: 'Invalid symbol' })
  if (!validDate(from) || !validDate(to)) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' })

  try {
    const data = await polyFetch(
      `/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=500`
    )
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

  try {
    const data = await polyFetch(`/v3/reference/tickers/${symbol}`)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── Ticker search ─────────────────────────────────────────────────
// GET /api/market/search?q=apple&limit=8
router.get('/search', async (req, res) => {
  const { q } = req.query
  if (!q) return res.json([])

  const limit = Math.min(parseInt(req.query.limit ?? '8'), 20)

  try {
    const data = await polyFetch(
      `/v3/reference/tickers?search=${encodeURIComponent(q)}&market=stocks&active=true&limit=${limit}`
    )
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── Previous close ────────────────────────────────────────────────
// GET /api/market/prev-close/:symbol
router.get('/prev-close/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  if (!validSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  try {
    const data = await polyFetch(
      `/v2/aggs/ticker/${symbol}/prev?adjusted=true`
    )
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
