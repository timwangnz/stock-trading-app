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
import { ArrowUpRight, ArrowDownRight, Activity, RefreshCw, Briefcase, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import StockTreemap from '../components/StockTreemap'
import { getSnapshots } from '../services/polygonApi'
import { useApp, ACTIONS } from '../context/AppContext'
import { useLivePrices } from '../hooks/useLivePrices'
import { useDashboardSymbols } from '../hooks/useDashboardSymbols'
import StockCard from '../components/StockCard'
import ManageStocksModal from '../components/ManageStocksModal'
import MarketHeatmap from '../components/MarketHeatmap'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'
import clsx from 'clsx'

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

function PortfolioBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  const isUp = d.returnPct >= 0
  return (
    <div className="bg-surface-card border border-border rounded-xl px-3 py-2 shadow-lg text-xs space-y-0.5 pointer-events-none">
      <p className="text-primary font-semibold font-mono">{d.symbol}</p>
      <p className="text-muted">
        Value: ${Number(d.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <p className={isUp ? 'text-gain font-semibold' : 'text-loss font-semibold'}>
        Return: {isUp ? '+' : ''}{d.returnPct.toFixed(2)}%
      </p>
    </div>
  )
}

/**
 * PortfolioSummary
 * A compact snapshot of the user's portfolio shown at the top of the dashboard.
 * Uses the useLivePrices hook to fetch current prices for held symbols.
 */
function PortfolioSummary({ onNavigate }) {
  const { state, dispatch } = useApp()
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

  // Bar chart data: sorted by value descending, coloured by total return
  const barData = useMemo(() =>
    [...holdings]
      .filter(h => h.value > 0)
      .sort((a, b) => b.value - a.value)
      .map(h => ({
        symbol:    h.symbol,
        value:     h.value,
        returnPct: h.cost > 0 ? (h.gain / h.cost) * 100 : 0,
      })),
    [holdings]
  )

  // Heatmap data: size = position value, colour = total return %
  const heatmapData = useMemo(() =>
    holdings
      .filter(h => h.value > 0)
      .map(h => ({
        name:      h.symbol,
        symbol:    h.symbol,
        size:      h.value,
        changePct: h.cost > 0 ? (h.gain / h.cost) * 100 : 0,
        price:     h.price,
        tooltipLines: [
          `Value: $${h.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `Cost:  $${h.cost.toLocaleString('en-US',  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        ],
      })),
    [holdings]
  )

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
          <div className="space-y-3 min-w-0 shrink-0">
            <div>
              <p className="text-muted text-xs mb-0.5">Total Value</p>
              <p className="text-primary font-bold text-2xl">
                ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
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

          {/* ── Right: holdings bar chart ─────────── */}
          <div className="flex-1 min-w-0">
            <p className="text-muted text-xs mb-2">Holdings by value</p>
            <ResponsiveContainer width="100%" height={Math.max(80, barData.length * 28)}>
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                onClick={(e) => {
                  if (e?.activePayload?.[0]?.payload?.symbol) {
                    dispatch({ type: ACTIONS.VIEW_STOCK, payload: e.activePayload[0].payload.symbol })
                  }
                }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="symbol"
                  width={40}
                  tick={{ fill: 'rgb(var(--text-muted))', fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
                  axisLine={false} tickLine={false}
                />
                <Tooltip content={<PortfolioBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]} cursor="pointer" barSize={16}>
                  {barData.map((entry) => (
                    <Cell
                      key={entry.symbol}
                      fill={entry.returnPct >= 0 ? 'rgb(var(--gain))' : 'rgb(var(--loss))'}
                      fillOpacity={0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { state, dispatch }               = useApp()
  const { symbols, addCustom, removeCustom } = useDashboardSymbols()

  // ── State ──────────────────────────────────────────────────
  const [stocks,      setStocks]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [lastFetch,   setLastFetch]   = useState(null)
  const [manageOpen,  setManageOpen]  = useState(false)

  const tickerList = symbols.map(s => s.symbol)

  // ── Fetch data ────────────────────────────────────────────
  const fetchData = async (tickers = tickerList) => {
    if (!tickers.length) { setStocks([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const snapshots = await getSnapshots(tickers)
      // Tag each snapshot with its source (portfolio/watchlist/custom)
      const enriched = snapshots.map(snap => {
        const meta = symbols.find(s => s.symbol === snap.symbol) ?? {}
        return { ...snap, source: meta.source }
      })
      setStocks(enriched)
      setLastFetch(new Date())
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  // Re-fetch whenever the symbol list changes (portfolio / watchlist / custom)
  useEffect(() => {
    if (state.dbReady) fetchData(symbols.map(s => s.symbol))
  }, [JSON.stringify(symbols), state.dbReady])   // eslint-disable-line

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
  if (loading && !stocks.length) return <LoadingSpinner message="Fetching live market data…" />
  if (error)                     return <ErrorMessage error={error} />

  return (
    <div className="p-6 space-y-6">

      {/* ── Portfolio summary (hidden if portfolio is empty) ── */}
      <PortfolioSummary onNavigate={(page) => dispatch({ type: ACTIONS.NAVIGATE, payload: page })} />

      {/* ── Market heatmap (shown once stocks are loaded) ── */}
      {stocks.length > 0 && <MarketHeatmap stocks={stocks} />}

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
              onClick={() => fetchData()}
              disabled={loading}
              className="flex items-center gap-1.5 text-muted hover:text-primary text-xs transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              onClick={() => setManageOpen(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted hover:text-primary hover:border-accent-blue/40 hover:bg-accent-blue/5 transition-colors"
            >
              <SlidersHorizontal size={12} /> Manage
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

        {symbols.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl py-14 text-center space-y-3">
            <SlidersHorizontal size={28} className="text-faint mx-auto" />
            <p className="text-secondary text-sm font-medium">No stocks on your dashboard yet</p>
            <p className="text-muted text-xs max-w-xs mx-auto">
              Add stocks to your portfolio or watchlist, or click <strong>Manage</strong> to add custom symbols.
            </p>
            <button
              onClick={() => setManageOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 border border-accent-blue/20 transition-colors"
            >
              <SlidersHorizontal size={12} /> Manage stocks
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {stocks.map(stock => (
              <StockCard key={stock.symbol} stockInfo={stock} />
            ))}
          </div>
        )}
      </div>

      {/* ── Manage stocks modal ──────────────────────── */}
      {manageOpen && (
        <ManageStocksModal
          symbols={symbols}
          onAddCustom={addCustom}
          onRemoveCustom={removeCustom}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  )
}
