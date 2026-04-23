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
    // Fallback chain: today's close → last trade → prev day close → 0
    // lastTrade.p is the most reliable during after-hours / weekends when day.c = 0
    price:     t.day?.c    || t.lastTrade?.p || t.prevDay?.c || 0,
    change:    t.day?.c    ? parseFloat((t.todaysChange     ?? 0).toFixed(2)) : 0,
    changePct: t.day?.c    ? parseFloat((t.todaysChangePerc ?? 0).toFixed(2)) : 0,
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
