/**
 * polygonApi.js
 * Client-side wrapper for market data.
 *
 * All requests go to our own Express backend (/api/market/*).
 * The Polygon.io API key lives ONLY on the server — it is never
 * bundled into the browser JS or visible in DevTools.
 */

// In dev, Vite proxies /api → http://localhost:3001 (see vite.config.js).
// In production, /api is served by the same Express process — same origin.
const BASE      = '/api/market'
const TOKEN_KEY = 'tradebuddy_token'

async function apiFetch(path) {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Market API ${res.status}: ${body}`)
  }
  return res.json()
}

// ── Snapshots (current price + today's change) ────────────────────
export async function getSnapshots(symbols) {
  const data = await apiFetch(`/snapshots?symbols=${symbols.join(',')}`)
  return (data.tickers ?? []).map(t => ({
    symbol:    t.ticker,
    // When market is open day.c has today's live/closing price.
    // When closed (after-hours, weekend, holiday) fall back to prevDay data.
    ...(() => {
      const marketOpen = t.day?.c > 0
      const price      = marketOpen ? t.day.c : (t.lastTrade?.p || t.prevDay?.c || 0)
      const change     = marketOpen
        ? parseFloat((t.todaysChange     ?? 0).toFixed(2))
        : parseFloat(((t.prevDay?.c || 0) - (t.prevDay?.o || 0)).toFixed(2))
      const changePct  = marketOpen
        ? parseFloat((t.todaysChangePerc ?? 0).toFixed(2))
        : t.prevDay?.o > 0
          ? parseFloat((((t.prevDay.c - t.prevDay.o) / t.prevDay.o) * 100).toFixed(2))
          : 0
      return { price, change, changePct, marketOpen }
    })(),
    volume:    t.day?.v    || 0,
    high:      t.day?.h    || 0,
    low:       t.day?.l    || 0,
    open:      t.day?.o    || 0,
    prevClose: t.prevDay?.c || 0,
  }))
}

// ── Aggregates (OHLCV bars for charts) ────────────────────────────
export async function getAggregates(symbol, from, to) {
  const data = await apiFetch(
    `/aggregates/${symbol}?from=${from}&to=${to}`
  )
  return (data.results ?? []).map(bar => ({
    date:   new Date(bar.t).toISOString().split('T')[0],
    open:   bar.o,
    high:   bar.h,
    low:    bar.l,
    close:  bar.c,
    volume: bar.v,
  }))
}

// ── Ticker details ─────────────────────────────────────────────────
export async function getTickerDetails(symbol) {
  const data = await apiFetch(`/ticker/${symbol}`)
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

// ── Ticker search ──────────────────────────────────────────────────
export async function searchTickers(query, limit = 8) {
  if (!query?.trim()) return []
  const data = await apiFetch(
    `/search?q=${encodeURIComponent(query)}&limit=${limit}`
  )
  return (data.results ?? []).map(t => ({
    symbol: t.ticker,
    name:   t.name,
    market: t.market,
    type:   t.type,
  }))
}

// ── Previous close ─────────────────────────────────────────────────
export async function getPrevClose(symbol) {
  const data = await apiFetch(`/prev-close/${symbol}`)
  return data.results?.[0] ?? null
}

// ── Date helpers ───────────────────────────────────────────────────
export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

export function today() {
  return new Date().toISOString().split('T')[0]
}

// ── News ──────────────────────────────────────────────────────────
export async function getNews(symbol, limit = 5) {
  const data = await apiFetch(`/news/${symbol.toUpperCase()}?limit=${limit}`)
  return data.articles ?? []
}
