/**
 * StockDetail.jsx
 * Single stock view with LIVE data from Polygon.io:
 *  - Real current price + daily change (snapshot)
 *  - Real price history for the chart (aggregates)
 *  - Ticker details (company name, sector, description)
 *
 * When a user switches time ranges (1M / 3M / 6M / All), we re-fetch
 * from Polygon with the appropriate date range.
 */

import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import { Bell, ArrowLeft, ExternalLink, TrendingUp, TrendingDown, Users, Plus, X, CheckCircle, Newspaper } from 'lucide-react'
import FinancialsPanel from '../components/FinancialsPanel'
import { useApp, ACTIONS } from '../context/AppContext'
import { getSnapshots, getAggregates, getTickerDetails, getNews, daysAgo, today } from '../services/polygonApi'
import { fetchMyClasses, fetchRelatedStocks, buyAtMarket, sellAtMarket, fetchPortfolio } from '../../common/services/apiService'
import { STOCKS } from '../data/mockData'
import { useTheme } from '../../common/context/ThemeContext'
import { usePriceAlerts } from '../hooks/usePriceAlerts'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'
import clsx from 'clsx'

const RANGES = [
  { label: '1M', days: 30  },
  { label: '3M', days: 90  },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
]

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-surface-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-muted mb-1">{label}</p>
      <p className="text-primary font-semibold">${d.close.toFixed(2)}</p>
      <p className="text-muted">Vol: {(d.volume / 1_000_000).toFixed(1)}M</p>
    </div>
  )
}

// ── Class Related Stocks widget ──────────────────────────────────
function ClassRelatedStocks({ symbol }) {
  const { dispatch } = useApp()
  const [classes,  setClasses]  = useState([])
  const [classId,  setClassId]  = useState(null)
  const [related,  setRelated]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [empty,    setEmpty]    = useState(false)

  // Load classes once
  useEffect(() => {
    fetchMyClasses()
      .then(cls => {
        setClasses(cls)
        if (cls.length) setClassId(cls[0].class_id ?? cls[0].id)
        else setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Load related stocks when class or symbol changes
  useEffect(() => {
    if (!classId) return
    setLoading(true); setRelated([]); setEmpty(false)
    fetchRelatedStocks(classId, symbol)
      .then(data => {
        setRelated(data)
        setEmpty(data.length === 0)
      })
      .catch(() => setEmpty(true))
      .finally(() => setLoading(false))
  }, [classId, symbol])

  // Don't render at all if user has no class
  if (!loading && classes.length === 0) return null

  const navigateToStock = (sym) => {
    dispatch({ type: ACTIONS.VIEW_STOCK, payload: sym })
  }

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-accent-blue" />
          <p className="text-primary text-sm font-medium">
            Classmates who hold {symbol} also hold
          </p>
        </div>

        {classes.length > 1 && (
          <select
            value={classId ?? ''}
            onChange={e => setClassId(Number(e.target.value))}
            className="bg-surface-hover border border-border rounded-lg px-2.5 py-1 text-primary text-xs focus:outline-none focus:border-accent-blue">
            {classes.map(c => (
              <option key={c.class_id ?? c.id} value={c.class_id ?? c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="flex gap-2 flex-wrap">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 w-20 rounded-xl bg-surface-hover animate-pulse" />
          ))}
        </div>
      )}

      {!loading && empty && (
        <p className="text-muted text-sm">
          No classmates hold {symbol} yet — be the first!
        </p>
      )}

      {!loading && related.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {related.map(r => {
            // Build avatar stack (max 3)
            const avatars = (r.holders ?? []).slice(0, 3)
            return (
              <button
                key={r.symbol}
                onClick={() => navigateToStock(r.symbol)}
                className="group flex items-center gap-2 bg-surface-hover hover:bg-accent-blue/10 border border-border hover:border-accent-blue/30 rounded-xl px-3 py-2 transition-colors"
              >
                {/* Micro avatar stack */}
                <div className="flex -space-x-1.5">
                  {avatars.map((h, i) => (
                    h.avatar_url
                      ? <img key={i} src={h.avatar_url} referrerPolicy="no-referrer"
                          className="w-5 h-5 rounded-full border border-surface-card object-cover" alt="" />
                      : <div key={i} className="w-5 h-5 rounded-full border border-surface-card bg-accent-blue/20 flex items-center justify-center text-accent-blue text-[8px] font-bold">
                          {(h.name || '?')[0].toUpperCase()}
                        </div>
                  ))}
                </div>
                <span className="text-primary text-sm font-mono font-semibold group-hover:text-accent-blue transition-colors">
                  {r.symbol}
                </span>
                <span className="text-muted text-xs">
                  {r.holder_count} {r.holder_count === 1 ? 'holder' : 'holders'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function StockDetail() {
  const { state, dispatch } = useApp()
  const { chart: chartTheme } = useTheme()
  const symbol = state.selectedStock

  const [range,        setRange]        = useState('3M')
  const [activeForm,   setActiveForm]   = useState(null)   // null | 'buy' | 'sell'
  const [shares,       setShares]       = useState('')
  const [tradeLoading, setTradeLoading] = useState(false)
  const [tradeError,   setTradeError]   = useState(null)

  // Separate loading/error states for snapshot vs chart data
  const [snapshot,     setSnapshot]     = useState(null)
  const [details,      setDetails]      = useState(null)
  const [chartData,    setChartData]    = useState([])
  const [loadingSnap,  setLoadingSnap]  = useState(true)
  const [loadingChart, setLoadingChart] = useState(true)
  const [errorSnap,    setErrorSnap]    = useState(null)
  const [errorChart,   setErrorChart]   = useState(null)

  // News
  const [news,         setNews]         = useState([])
  const [loadingNews,  setLoadingNews]  = useState(true)

  // Price alerts
  const { alerts, addAlert, removeAlert, dismissAlert, checkPrice } = usePriceAlerts(symbol)
  const [newTarget,    setNewTarget]    = useState('')
  const [newDirection, setNewDirection] = useState('above')
  const [showAlertForm, setShowAlertForm] = useState(false)
  const [newlyFired,   setNewlyFired]   = useState([])   // banners for just-triggered alerts

  // ── Reset form state when symbol changes ─────────────────────
  useEffect(() => {
    setActiveForm(null)
    setShares('')
  }, [symbol])

  // ── Fetch snapshot + ticker details on mount (or symbol change) ──
  useEffect(() => {
    if (!symbol) return
    setLoadingSnap(true)
    setErrorSnap(null)

    // Run both requests in parallel with Promise.all
    Promise.all([
      getSnapshots([symbol]),
      getTickerDetails(symbol),
    ])
      .then(([snaps, det]) => {
        setSnapshot(snaps[0] ?? null)
        setDetails(det)
      })
      .catch(err => setErrorSnap(err))
      .finally(() => setLoadingSnap(false))
  }, [symbol])

  // ── Fetch chart data when symbol or range changes ────────────
  useEffect(() => {
    if (!symbol) return
    setLoadingChart(true)
    setErrorChart(null)

    const days = RANGES.find(r => r.label === range)?.days ?? 90
    const from = daysAgo(days)
    const to   = today()

    getAggregates(symbol, from, to)
      .then(bars => setChartData(bars))
      .catch(err => setErrorChart(err))
      .finally(() => setLoadingChart(false))
  }, [symbol, range])

  // ── Fetch news on symbol change ───────────────────────────────
  useEffect(() => {
    if (!symbol) return
    setLoadingNews(true)
    setNews([])
    getNews(symbol, 5)
      .then(articles => setNews(articles))
      .catch(() => setNews([]))
      .finally(() => setLoadingNews(false))
  }, [symbol])

  // ── Derived values ─────────────────────────────────────────
  // Fall back to static metadata if details haven't loaded yet
  const meta      = STOCKS.find(s => s.symbol === symbol) ?? {}
  const name      = details?.name    ?? meta.name    ?? symbol
  const sector    = details?.sector  ?? meta.sector  ?? '—'
  const price     = snapshot?.price     ?? 0
  const change    = snapshot?.change    ?? 0
  const changePct = snapshot?.changePct ?? 0
  const holding    = state.portfolio.find(h => h.symbol === symbol) ?? null
  const sharesHeld = holding?.shares ?? 0

  const firstPrice = chartData[0]?.close ?? 0
  const lastPrice  = chartData[chartData.length - 1]?.close ?? 0
  const chartColor = lastPrice >= firstPrice ? '#22c55e' : '#ef4444'

  const high52w = chartData.length ? Math.max(...chartData.map(d => d.high)) : 0
  const low52w  = chartData.length ? Math.min(...chartData.map(d => d.low))  : 0

  // Check price alerts whenever live price updates
  useEffect(() => {
    if (!price) return
    const fired = checkPrice(price)
    if (fired.length > 0) setNewlyFired(prev => [...prev, ...fired])
  }, [price]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Alert handlers ─────────────────────────────────────────
  const handleAddAlert = (e) => {
    e.preventDefault()
    const t = parseFloat(newTarget)
    if (isNaN(t) || t <= 0) return
    addAlert(t, newDirection)
    setNewTarget('')
    setShowAlertForm(false)
  }

  // ── Trade handlers ─────────────────────────────────────────
  const openForm = (form) => {
    setShares('')
    setTradeError(null)
    setActiveForm(prev => prev === form ? null : form)
  }

  // Reload portfolio state from server after a trade
  const reloadPortfolio = async () => {
    const fresh = await fetchPortfolio()
    dispatch({ type: ACTIONS.RELOAD_PORTFOLIO, payload: fresh })
  }

  const handleBuy = async (e) => {
    e.preventDefault()
    const sh = parseFloat(shares)
    if (isNaN(sh) || sh <= 0) return
    setTradeLoading(true)
    setTradeError(null)
    try {
      await buyAtMarket(symbol, sh)
      await reloadPortfolio()
      setShares('')
      setActiveForm(null)
    } catch (err) {
      setTradeError(err.message || 'Buy failed — please try again.')
    } finally {
      setTradeLoading(false)
    }
  }

  const handleSell = async (e) => {
    e.preventDefault()
    const sh = parseFloat(shares)
    if (isNaN(sh) || sh <= 0 || sh > sharesHeld) return
    setTradeLoading(true)
    setTradeError(null)
    try {
      await sellAtMarket(symbol, sh)
      await reloadPortfolio()
      setShares('')
      setActiveForm(null)
    } catch (err) {
      setTradeError(err.message || 'Sell failed — please try again.')
    } finally {
      setTradeLoading(false)
    }
  }

  if (errorSnap) return <ErrorMessage error={errorSnap} />

  return (
    <div className="p-6 space-y-5">

      {/* ── Back button ──────────────────────────────── */}
      <button
        onClick={() => dispatch({ type: ACTIONS.NAVIGATE, payload: 'dashboard' })}
        className="flex items-center gap-1.5 text-muted hover:text-primary text-sm transition-colors"
      >
        <ArrowLeft size={15} /> Back to Market
      </button>

      {/* ── Stock header ─────────────────────────────── */}
      {loadingSnap ? (
        <LoadingSpinner message="Loading stock info…" />
      ) : (
        <>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-baseline gap-3">
                <h2 className="text-primary font-bold text-3xl font-mono">{symbol}</h2>
                <span className="text-muted text-base">{name}</span>
                {details?.homepageUrl && (
                  <a
                    href={details.homepageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted hover:text-accent-blue transition-colors"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
              <div className="flex items-baseline gap-3 mt-2">
                <span className="text-primary font-semibold text-4xl">${price.toFixed(2)}</span>
                <span className={clsx('text-lg font-medium', change >= 0 ? 'text-gain' : 'text-loss')}>
                  {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
                </span>
              </div>
              <p className="text-muted text-xs mt-1">Sector: {sector}</p>
            </div>

            <div className="flex gap-2">
              {/* Price alert toggle button */}
              <button
                onClick={() => setShowAlertForm(v => !v)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
                  alerts.filter(a => !a.dismissed).length > 0
                    ? 'border-amber-400/40 text-amber-400 hover:bg-amber-400/10'
                    : showAlertForm
                      ? 'border-amber-400/40 text-amber-400 bg-amber-400/10'
                      : 'border-border text-muted hover:text-amber-400 hover:border-amber-400/40'
                )}
                title="Price alerts"
              >
                {alerts.filter(a => !a.dismissed).length > 0
                  ? <Bell size={14} className="fill-amber-400" />
                  : <Bell size={14} />
                }
                Alerts
                {alerts.filter(a => !a.triggered && !a.dismissed).length > 0 && (
                  <span className="ml-1 bg-amber-400 text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {alerts.filter(a => !a.triggered && !a.dismissed).length}
                  </span>
                )}
              </button>

              {/* Sell button — only active when user holds shares */}
              <button
                onClick={() => openForm('sell')}
                disabled={sharesHeld <= 0}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
                  activeForm === 'sell'
                    ? 'bg-loss/20 border-loss/40 text-loss'
                    : sharesHeld > 0
                      ? 'border-loss/30 text-loss hover:bg-loss/10 hover:border-loss/50'
                      : 'border-border text-faint cursor-not-allowed opacity-40'
                )}
                title={sharesHeld <= 0 ? "You don't hold any shares of this stock" : `Sell ${sharesHeld} shares`}
              >
                <TrendingDown size={14} /> Sell
              </button>

              {/* Buy button */}
              <button
                onClick={() => openForm('buy')}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeForm === 'buy'
                    ? 'bg-gain/20 border border-gain/40 text-gain'
                    : 'bg-accent-blue hover:bg-accent-blue/80 text-white'
                )}
              >
                <TrendingUp size={14} /> Buy
              </button>
            </div>
          </div>

          {/* Current position pill — shown when user holds shares */}
          {sharesHeld > 0 && (
            <div className="inline-flex items-center gap-2 bg-accent-blue/10 border border-accent-blue/20 text-accent-blue text-xs px-3 py-1.5 rounded-full">
              <TrendingUp size={11} />
              You hold <strong>{sharesHeld}</strong> share{sharesHeld !== 1 ? 's' : ''} · avg cost ${holding.avgCost.toFixed(2)} · value ${(sharesHeld * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}

          {/* Buy form */}
          {activeForm === 'buy' && (
            <form
              onSubmit={handleBuy}
              className="bg-surface-card border border-gain/20 rounded-xl p-4 flex items-center gap-3 flex-wrap"
            >
              <TrendingUp size={15} className="text-gain shrink-0" />
              <p className="text-muted text-sm shrink-0">
                Buy at <span className="text-primary font-medium">${price.toFixed(2)}</span>
              </p>
              <input
                type="number" min="0.001" step="any" placeholder="Shares"
                value={shares} onChange={e => setShares(e.target.value)}
                autoFocus disabled={tradeLoading}
                className="flex-1 bg-surface-hover text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border focus:border-gain/40 transition-colors"
                required
              />
              {shares && !isNaN(parseFloat(shares)) && parseFloat(shares) > 0 && (
                <p className="text-muted text-sm shrink-0">
                  = <span className="text-primary font-medium">${(parseFloat(shares) * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </p>
              )}
              {tradeError && <p className="text-loss text-xs w-full">{tradeError}</p>}
              <button type="submit" disabled={tradeLoading} className="bg-gain hover:bg-gain/80 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0">
                {tradeLoading ? 'Buying…' : 'Confirm Buy'}
              </button>
              <button type="button" onClick={() => setActiveForm(null)} disabled={tradeLoading} className="text-muted hover:text-primary text-sm shrink-0">✕</button>
            </form>
          )}

          {/* Sell form */}
          {activeForm === 'sell' && sharesHeld > 0 && (
            <form
              onSubmit={handleSell}
              className="bg-surface-card border border-loss/20 rounded-xl p-4 flex items-center gap-3 flex-wrap"
            >
              <TrendingDown size={15} className="text-loss shrink-0" />
              <p className="text-muted text-sm shrink-0">
                Sell at <span className="text-primary font-medium">${price.toFixed(2)}</span>
                <span className="text-faint ml-1">(max {sharesHeld})</span>
              </p>
              <input
                type="number" min="0.001" max={sharesHeld} step="any" placeholder="Shares"
                value={shares} onChange={e => setShares(e.target.value)}
                autoFocus disabled={tradeLoading}
                className="flex-1 bg-surface-hover text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border focus:border-loss/40 transition-colors"
                required
              />
              {shares && !isNaN(parseFloat(shares)) && parseFloat(shares) > 0 && (
                <p className="text-muted text-sm shrink-0">
                  = <span className="text-primary font-medium">${(parseFloat(shares) * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </p>
              )}
              {tradeError && <p className="text-loss text-xs w-full">{tradeError}</p>}
              <button
                type="submit"
                disabled={tradeLoading || parseFloat(shares) > sharesHeld}
                className="bg-loss hover:bg-loss/80 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0"
              >
                {tradeLoading ? 'Selling…' : 'Confirm Sell'}
              </button>
              <button type="button" onClick={() => setActiveForm(null)} disabled={tradeLoading} className="text-muted hover:text-primary text-sm shrink-0">✕</button>
            </form>
          )}

          {/* Key stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '52-Week High', value: high52w ? `$${high52w.toFixed(2)}` : '—' },
              { label: '52-Week Low',  value: low52w  ? `$${low52w.toFixed(2)}`  : '—' },
              { label: 'Volume',       value: snapshot?.volume ? `${(snapshot.volume / 1_000_000).toFixed(1)}M` : '—' },
              { label: 'Prev Close',   value: snapshot?.prevClose ? `$${snapshot.prevClose.toFixed(2)}` : '—' },
            ].map(stat => (
              <div key={stat.label} className="bg-surface-card border border-border rounded-xl px-4 py-3">
                <p className="text-muted text-xs mb-1">{stat.label}</p>
                <p className="text-primary font-medium text-sm">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Company description */}
          {details?.description && (
            <div className="bg-surface-card border border-border rounded-xl px-5 py-4">
              <p className="text-muted text-xs mb-2">About</p>
              <p className="text-muted text-sm leading-relaxed line-clamp-3">{details.description}</p>
            </div>
          )}

          {/* ── Triggered alert banners ───────────────── */}
          {newlyFired.map(a => (
            <div key={a.id} className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-3">
              <CheckCircle size={15} className="text-amber-400 shrink-0" />
              <p className="text-amber-300 text-sm flex-1">
                <strong>{symbol}</strong> hit your price alert — {a.direction === 'above' ? '≥' : '≤'} ${a.targetPrice.toFixed(2)}
                {price > 0 && <span className="text-amber-400/70 ml-1">(now ${price.toFixed(2)})</span>}
              </p>
              <button
                onClick={() => {
                  dismissAlert(a.id)
                  setNewlyFired(prev => prev.filter(f => f.id !== a.id))
                }}
                className="text-amber-400/60 hover:text-amber-400 transition-colors shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          {/* ── Price alerts panel ────────────────────── */}
          {showAlertForm && (
            <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell size={14} className="text-amber-400" />
                  <p className="text-primary text-sm font-medium">Price Alerts</p>
                </div>
                <button onClick={() => setShowAlertForm(false)} className="text-muted hover:text-primary transition-colors">
                  <X size={14} />
                </button>
              </div>

              {/* Add alert form */}
              <form onSubmit={handleAddAlert} className="flex items-center gap-2 flex-wrap">
                <span className="text-muted text-sm shrink-0">Alert me when {symbol} goes</span>
                <select
                  value={newDirection}
                  onChange={e => setNewDirection(e.target.value)}
                  className="bg-surface-hover border border-border rounded-lg px-2.5 py-1.5 text-primary text-sm focus:outline-none focus:border-amber-400/50"
                >
                  <option value="above">above</option>
                  <option value="below">below</option>
                </select>
                <div className="flex items-center gap-1 bg-surface-hover border border-border rounded-lg px-2.5 py-1.5 focus-within:border-amber-400/50 transition-colors">
                  <span className="text-muted text-sm">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    placeholder={price > 0 ? price.toFixed(2) : '0.00'}
                    value={newTarget}
                    onChange={e => setNewTarget(e.target.value)}
                    className="bg-transparent text-primary text-sm outline-none w-24"
                    autoFocus
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={!newTarget || isNaN(parseFloat(newTarget))}
                  className="flex items-center gap-1.5 bg-amber-400/20 hover:bg-amber-400/30 disabled:opacity-40 text-amber-400 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Plus size={13} /> Set Alert
                </button>
              </form>

              {/* Alert list */}
              {alerts.length > 0 ? (
                <div className="space-y-2">
                  {alerts.map(a => (
                    <div
                      key={a.id}
                      className={clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 border',
                        a.triggered
                          ? 'bg-amber-400/5 border-amber-400/20'
                          : 'bg-surface-hover border-border'
                      )}
                    >
                      {a.triggered
                        ? <CheckCircle size={13} className="text-amber-400 shrink-0" />
                        : <Bell size={13} className="text-muted shrink-0" />
                      }
                      <p className="text-sm flex-1">
                        <span className={a.triggered ? 'text-amber-400' : 'text-secondary'}>
                          {a.direction === 'above' ? '≥' : '≤'} ${a.targetPrice.toFixed(2)}
                        </span>
                        {a.triggered && <span className="text-amber-400/60 text-xs ml-2">● triggered</span>}
                        {!a.triggered && price > 0 && (
                          <span className="text-faint text-xs ml-2">
                            {a.direction === 'above'
                              ? `$${(a.targetPrice - price).toFixed(2)} away`
                              : `$${(price - a.targetPrice).toFixed(2)} away`}
                          </span>
                        )}
                      </p>
                      <button
                        onClick={() => removeAlert(a.id)}
                        className="text-faint hover:text-loss transition-colors shrink-0"
                        title="Remove alert"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted text-xs">No alerts set for {symbol} yet.</p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Price chart ───────────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-muted text-sm">Price History (Live)</p>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => setRange(r.label)}
                className={clsx(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  range === r.label
                    ? 'bg-accent-blue/20 text-accent-blue'
                    : 'text-muted hover:text-primary hover:bg-surface-hover'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loadingChart ? (
          <div className="h-[300px] flex items-center justify-center">
            <LoadingSpinner message="Loading chart…" />
          </div>
        ) : errorChart ? (
          <ErrorMessage error={errorChart} />
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted text-sm">
            No chart data available for this range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis
                dataKey="date"
                tick={{ fill: chartTheme.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={Math.floor(chartData.length / 6)}
                tickFormatter={d => {
                  const date = new Date(d)
                  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }}
              />
              <YAxis
                tick={{ fill: chartTheme.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={v => `$${v.toFixed(0)}`}
                domain={['auto', 'auto']}
              />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={firstPrice} stroke={chartTheme.reference} strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="close"
                stroke={chartColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: chartColor, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Financial statements ──────────────────────── */}
      {symbol && <FinancialsPanel ticker={symbol} />}

      {/* ── Recent News ──────────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Newspaper size={15} className="text-accent-blue" />
          <p className="text-primary text-sm font-medium">Recent News</p>
        </div>

        {loadingNews ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-1.5 animate-pulse">
                <div className="h-3 bg-surface-hover rounded w-3/4" />
                <div className="h-2.5 bg-surface-hover rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : news.length === 0 ? (
          <p className="text-muted text-sm">No recent news found for {symbol}.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {news.map((article, i) => {
              const age = (() => {
                const diff = Date.now() - new Date(article.publishedAt).getTime()
                const h    = Math.floor(diff / 3_600_000)
                if (h < 1)  return 'just now'
                if (h < 24) return `${h}h ago`
                return `${Math.floor(h / 24)}d ago`
              })()
              return (
                <a
                  key={article.id ?? i}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex gap-3 py-3 first:pt-0 last:pb-0 hover:opacity-80 transition-opacity"
                >
                  {/* Thumbnail */}
                  {article.imageUrl ? (
                    <img
                      src={article.imageUrl}
                      alt=""
                      className="w-16 h-12 rounded-lg object-cover shrink-0 bg-surface-hover"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-16 h-12 rounded-lg bg-surface-hover shrink-0 flex items-center justify-center">
                      <Newspaper size={16} className="text-muted" />
                    </div>
                  )}
                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-primary text-sm font-medium leading-snug line-clamp-2 group-hover:text-accent-blue transition-colors">
                      {article.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-muted text-xs truncate">{article.source}</span>
                      <span className="text-faint text-xs shrink-0">· {age}</span>
                    </div>
                  </div>
                  <ExternalLink size={12} className="text-faint shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Class related stocks ──────────────────────── */}
      <ClassRelatedStocks symbol={symbol} />

    </div>
  )
}
