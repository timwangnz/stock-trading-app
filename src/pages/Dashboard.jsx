/**
 * Dashboard.jsx
 * Market overview — now fetches LIVE data from Polygon.io.
 *
 * Key React concepts demonstrated here:
 *  - useEffect for side effects (data fetching)
 *  - useState for loading / error / data states
 *  - Async/await inside useEffect
 */

import { useState, useEffect, useMemo } from 'react'
import { ArrowUpRight, ArrowDownRight, Activity, RefreshCw, Briefcase, ChevronRight } from 'lucide-react'
import { getSnapshots } from '../services/polygonApi'
import { STOCKS } from '../data/mockData'
import { useApp, ACTIONS } from '../context/AppContext'
import { useLivePrices } from '../hooks/useLivePrices'
import StockCard from '../components/StockCard'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'
import clsx from 'clsx'

const SYMBOLS = STOCKS.map(s => s.symbol)

function StatBadge({ label, value, trend }) {
  const isUp = trend === 'up'
  return (
    <div className="bg-surface-card border border-border rounded-xl px-5 py-4 flex-1 min-w-0">
      <p className="text-muted text-xs mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-primary font-semibold text-lg">{value}</span>
        {trend && (isUp
          ? <ArrowUpRight size={16} className="text-gain" />
          : <ArrowDownRight size={16} className="text-loss" />
        )}
      </div>
    </div>
  )
}

/**
 * PortfolioSummary
 * A compact snapshot of the user's portfolio shown at the top of the dashboard.
 * Uses the useLivePrices hook to fetch current prices for held symbols.
 */
function PortfolioSummary({ onNavigate }) {
  const { state } = useApp()
  const portfolio  = state.portfolio

  // Fetch live prices only for the symbols the user actually holds
  const symbols = portfolio.map(h => h.symbol)
  const { prices, loading } = useLivePrices(symbols)

  // Compute totals
  const holdings = useMemo(() => {
    return portfolio.map(h => {
      const live    = prices.get(h.symbol)
      const price   = live?.price     ?? 0
      const change  = live?.change    ?? 0   // today's $ change per share
      const value   = price * h.shares
      const cost    = h.avgCost * h.shares
      const gain    = value - cost
      const dayGain = change * h.shares      // today's $ gain for this holding
      return { ...h, price, value, cost, gain, dayGain }
    })
  }, [portfolio, prices])

  const totalValue   = holdings.reduce((s, h) => s + h.value,   0)
  const totalCost    = holdings.reduce((s, h) => s + h.cost,    0)
  const totalGain    = totalValue - totalCost
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0
  const todayGain    = holdings.reduce((s, h) => s + h.dayGain, 0)

  // Top 4 holdings by current value
  const topHoldings = [...holdings].sort((a, b) => b.value - a.value).slice(0, 4)

  if (portfolio.length === 0) return null

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Briefcase size={15} className="text-accent-purple" />
          <h2 className="text-primary text-sm font-semibold">My Portfolio</h2>
        </div>
        <button
          onClick={() => onNavigate('portfolio')}
          className="flex items-center gap-1 text-muted hover:text-accent-blue text-xs transition-colors"
        >
          View all <ChevronRight size={13} />
        </button>
      </div>

      {loading ? (
        <p className="text-muted text-xs py-2">Loading prices…</p>
      ) : (
        <div className="flex gap-6 items-start">

          {/* ── Left: key numbers ─────────────────── */}
          <div className="space-y-3 min-w-0">
            {/* Total value */}
            <div>
              <p className="text-muted text-xs mb-0.5">Total Value</p>
              <p className="text-primary font-bold text-2xl">
                ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            {/* Two-column stats */}
            <div className="flex gap-6">
              <div>
                <p className="text-muted text-xs mb-0.5">Total Return</p>
                <p className={clsx('font-semibold text-sm', totalGain >= 0 ? 'text-gain' : 'text-loss')}>
                  {totalGain >= 0 ? '+' : ''}${Math.abs(totalGain).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-xs ml-1 opacity-80">({totalGainPct >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}%)</span>
                </p>
              </div>
              <div>
                <p className="text-muted text-xs mb-0.5">Today's Change</p>
                <p className={clsx('font-semibold text-sm', todayGain >= 0 ? 'text-gain' : 'text-loss')}>
                  {todayGain >= 0 ? '+' : ''}${Math.abs(todayGain).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>

          {/* ── Divider ───────────────────────────── */}
          <div className="w-px self-stretch bg-surface-hover mx-2 shrink-0" />

          {/* ── Right: top holdings ───────────────── */}
          <div className="flex-1 min-w-0">
            <p className="text-muted text-xs mb-2">Top Holdings</p>
            <div className="space-y-2">
              {topHoldings.map(h => {
                const allocationPct = totalValue > 0 ? (h.value / totalValue) * 100 : 0
                return (
                  <div key={h.symbol} className="flex items-center gap-3">
                    {/* Symbol + allocation bar */}
                    <span className="text-primary font-mono text-xs w-12 shrink-0">{h.symbol}</span>
                    <div className="flex-1 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-purple/60 rounded-full"
                        style={{ width: `${allocationPct}%` }}
                      />
                    </div>
                    <span className="text-muted text-xs w-10 text-right shrink-0">
                      {allocationPct.toFixed(0)}%
                    </span>
                    {/* Today's gain for this holding */}
                    <span className={clsx('text-xs w-16 text-right shrink-0', h.dayGain >= 0 ? 'text-gain' : 'text-loss')}>
                      {h.dayGain >= 0 ? '+' : ''}${Math.abs(h.dayGain).toFixed(2)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { state, dispatch } = useApp()

  // ── State ──────────────────────────────────────────────────
  const [stocks,    setStocks]    = useState([])   // enriched stock objects
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  // ── Fetch data ────────────────────────────────────────────
  // This function fetches snapshots and merges in the static name/sector info
  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const snapshots = await getSnapshots(SYMBOLS)

      // Merge live price data with our static stock metadata (name, sector)
      const enriched = snapshots.map(snap => {
        const meta = STOCKS.find(s => s.symbol === snap.symbol) ?? {}
        return { ...meta, ...snap }
      })

      setStocks(enriched)
      setLastFetch(new Date())
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  // useEffect runs fetchData when the component first mounts.
  // The empty [] dependency array means "run once on mount".
  useEffect(() => { fetchData() }, [])

  // ── Derived data ──────────────────────────────────────────
  const gainers = stocks.filter(s => s.change > 0).length
  const losers  = stocks.filter(s => s.change < 0).length

  const topGainers = useMemo(() =>
    [...stocks].filter(s => s.change > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 3),
    [stocks]
  )
  const topLosers = useMemo(() =>
    [...stocks].filter(s => s.change < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 3),
    [stocks]
  )

  // ── Render ────────────────────────────────────────────────
  if (loading) return <LoadingSpinner message="Fetching live market data…" />
  if (error)   return <ErrorMessage error={error} />

  return (
    <div className="p-6 space-y-6">

      {/* ── Portfolio summary (hidden if portfolio is empty) ── */}
      <PortfolioSummary onNavigate={(page) => dispatch({ type: ACTIONS.NAVIGATE, payload: page })} />

      {/* ── Summary strip ───────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-accent-blue" />
            <h2 className="text-muted text-sm font-medium">Live Market</h2>
          </div>
          <div className="flex items-center gap-3">
            {lastFetch && (
              <span className="text-muted text-xs">
                Updated {lastFetch.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 text-muted hover:text-primary text-xs transition-colors"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <StatBadge label="Tracking" value={`${stocks.length} stocks`} />
          <StatBadge label="Advancing" value={gainers} trend="up" />
          <StatBadge label="Declining" value={losers}  trend="down" />
          <StatBadge
            label="Avg Change"
            value={`${stocks.length ? (stocks.reduce((s, x) => s + x.changePct, 0) / stocks.length).toFixed(2) : '0.00'}%`}
            trend={stocks.reduce((s, x) => s + x.changePct, 0) >= 0 ? 'up' : 'down'}
          />
        </div>
      </div>

      {/* ── Top movers ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-card border border-border rounded-xl p-4">
          <h3 className="text-gain text-sm font-semibold mb-3 flex items-center gap-1.5">
            <ArrowUpRight size={15} /> Top Gainers
          </h3>
          <div className="space-y-2">
            {topGainers.map(s => (
              <div key={s.symbol} className="flex justify-between items-center">
                <button
                  onClick={() => dispatch({ type: ACTIONS.VIEW_STOCK, payload: s.symbol })}
                  className="text-primary font-mono text-sm hover:text-accent-blue transition-colors"
                >
                  {s.symbol}
                </button>
                <span className="text-gain text-sm font-medium">+{s.changePct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-card border border-border rounded-xl p-4">
          <h3 className="text-loss text-sm font-semibold mb-3 flex items-center gap-1.5">
            <ArrowDownRight size={15} /> Top Losers
          </h3>
          <div className="space-y-2">
            {topLosers.map(s => (
              <div key={s.symbol} className="flex justify-between items-center">
                <button
                  onClick={() => dispatch({ type: ACTIONS.VIEW_STOCK, payload: s.symbol })}
                  className="text-primary font-mono text-sm hover:text-accent-blue transition-colors"
                >
                  {s.symbol}
                </button>
                <span className="text-loss text-sm font-medium">{s.changePct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── All stocks grid ──────────────────────────── */}
      <div>
        <h2 className="text-muted text-sm font-medium mb-3">All Stocks</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {stocks.map(stock => (
            <StockCard key={stock.symbol} stockInfo={stock} />
          ))}
        </div>
      </div>
    </div>
  )
}
