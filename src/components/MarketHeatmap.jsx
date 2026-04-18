/**
 * MarketHeatmap.jsx
 * Dashboard market heatmap.
 *
 * Fetches + caches ticker details (market cap) for all dashboard symbols,
 * then delegates rendering to StockTreemap.
 *
 * SIZE  → market cap (from Polygon ticker details, cached 24 h)
 * COLOR → today's % price change
 */

import { useState, useEffect, useMemo } from 'react'
import { useApp, ACTIONS } from '../context/AppContext'
import { getTickerDetails } from '../services/polygonApi'
import StockTreemap from './StockTreemap'

// ── Ticker details cache ──────────────────────────────────────
const TICKER_CACHE = new Map()          // symbol → { payload, fetchedAt }
const TICKER_TTL   = 24 * 60 * 60 * 1000

function getCached(symbol) {
  const entry = TICKER_CACHE.get(symbol)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > TICKER_TTL) { TICKER_CACHE.delete(symbol); return null }
  return entry.payload
}

function setCached(symbol, payload) {
  TICKER_CACHE.set(symbol, { payload, fetchedAt: Date.now() })
}

async function fetchTickerDetails(symbols) {
  const missing = symbols.filter(s => getCached(s) === null)
  if (missing.length) {
    const results = await Promise.allSettled(missing.map(s => getTickerDetails(s)))
    results.forEach((r, i) => {
      setCached(missing[i], r.status === 'fulfilled' ? (r.value ?? null) : null)
    })
  }
  const map = new Map()
  for (const sym of symbols) {
    const p = getCached(sym)
    if (p) map.set(sym, p)
  }
  return map
}

// ── Component ─────────────────────────────────────────────────
export default function MarketHeatmap({ stocks }) {
  const { dispatch } = useApp()
  const [tickerMap,  setTickerMap]  = useState(new Map())
  const [capsLoaded, setCapsLoaded] = useState(false)

  const symbolKey = stocks.map(s => s.symbol).sort().join(',')

  useEffect(() => {
    if (!stocks?.length) return
    let cancelled = false

    const symbols   = stocks.map(s => s.symbol)
    const allCached = symbols.every(s => getCached(s) !== null)
    if (!allCached) setCapsLoaded(false)

    fetchTickerDetails(symbols).then(map => {
      if (!cancelled) { setTickerMap(map); setCapsLoaded(true) }
    })
    return () => { cancelled = true }
  }, [symbolKey])  // eslint-disable-line

  const data = useMemo(() => {
    if (!stocks?.length) return []
    return stocks.map(s => {
      const details = tickerMap.get(s.symbol)
      const cap = details?.marketCap ?? null

      return {
        name:        s.symbol,
        symbol:      s.symbol,
        size:        cap ?? 1,
        changePct:   s.changePct,
        price:       s.price,
        companyName: details?.name ?? null,
        tooltipLines: cap ? [formatCap(cap)] : [],
      }
    })
  }, [stocks, tickerMap])

  return (
    <StockTreemap
      data={data}
      height={220}
      clampRange={[-5, 5]}
      onCellClick={(sym) => dispatch({ type: ACTIONS.VIEW_STOCK, payload: sym })}
      title="Market Heatmap"
      subtitle={capsLoaded
        ? "Size = market cap · Color = today's % change"
        : 'Loading market caps…'}
    />
  )
}

function formatCap(n) {
  if (!n) return ''
  if (n >= 1e12) return `Mkt cap: $${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `Mkt cap: $${(n / 1e9).toFixed(2)}B`
  return `Mkt cap: $${(n / 1e6).toFixed(2)}M`
}
