/**
 * Portfolio.jsx — now uses live prices via useLivePrices hook.
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, PlusCircle, TrendingUp, DollarSign, RefreshCw, ShoppingCart, MinusCircle, Lock, ChevronRight, ChevronDown, Pencil, BadgeDollarSign, ChevronsUpDown, ChevronUp } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import { useApp, ACTIONS } from '../context/AppContext'
import { useAuth } from '../../common/context/AuthContext'
import { STOCKS } from '../data/mockData'
import { useLivePrices } from '../hooks/useLivePrices'
import { buyAtMarket, sellAtMarket, addCash, upsertHolding, fetchPortfolio, fetchCash, getPortfolioSnapshots, triggerSnapshot, fetchTransactions } from '../../common/services/apiService'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'
import StockTreemap from '../components/StockTreemap'
import StockSearch from '../components/StockSearch'
import { useTheme } from '../../common/context/ThemeContext'
import clsx from 'clsx'

// StockSearchInput is now the shared StockSearch component (see components/StockSearch.jsx)

const fmt$ = (n) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Portfolio performance chart ───────────────────────────────────

const CHART_RANGES = [
  { label: '1W',  days: 7   },
  { label: '1M',  days: 30  },
  { label: '3M',  days: 90  },
  { label: '6M',  days: 180 },
  { label: '1Y',  days: 365 },
  { label: 'All', days: 3650 },
]

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-muted mb-0.5">{label}</p>
      <p className="text-primary font-semibold">
        ${parseFloat(payload[0].value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  )
}

function PortfolioChart({ currentValue }) {
  const { chart: chartTheme } = useTheme()
  const [range,   setRange]   = useState('1M')
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const days = CHART_RANGES.find(r => r.label === range)?.days ?? 30
    const from = new Date()
    from.setDate(from.getDate() - days)
    const fromStr = from.toISOString().split('T')[0]
    const toStr   = new Date().toISOString().split('T')[0]

    setLoading(true)
    getPortfolioSnapshots(fromStr, toStr)
      .then(rows => setData(rows.map(r => ({ date: r.date, value: parseFloat(r.total_value) }))))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [range])

  // Append today's live value if it's newer/different than the last snapshot
  const chartData = useMemo(() => {
    if (!currentValue || !data.length) return data
    const today = new Date().toISOString().split('T')[0]
    const last  = data[data.length - 1]
    if (last?.date === today) {
      // Replace today's snapshot with the live value (more accurate)
      return [...data.slice(0, -1), { date: today, value: currentValue }]
    }
    return [...data, { date: today, value: currentValue }]
  }, [data, currentValue])

  const startValue = chartData[0]?.value ?? 0
  const endValue   = chartData[chartData.length - 1]?.value ?? 0
  const returnAmt  = endValue - startValue
  const returnPct  = startValue > 0 ? (returnAmt / startValue) * 100 : 0
  const lineColor  = returnAmt >= 0 ? '#22c55e' : '#ef4444'
  const isUp       = returnAmt >= 0

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <p className="text-muted text-xs mb-1">Portfolio Performance</p>
          {chartData.length > 1 && (
            <p className={clsx('text-sm font-medium', isUp ? 'text-gain' : 'text-loss')}>
              {isUp ? '+' : ''}{returnPct.toFixed(2)}%
              <span className="text-muted font-normal ml-1.5">
                ({isUp ? '+' : ''}${returnAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) · {range}
              </span>
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {CHART_RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
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

      {loading ? (
        <div className="h-[200px] flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
        </div>
      ) : chartData.length < 2 ? (
        <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-muted text-sm">
          <p>Not enough history yet.</p>
          <p className="text-xs text-faint">Performance data builds up as you log in each day.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: chartTheme.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
              tickFormatter={d => {
                const date = new Date(d)
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              }}
            />
            <YAxis
              tick={{ fill: chartTheme.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={startValue} stroke={chartTheme.reference} strokeDasharray="4 4" strokeOpacity={0.6} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}


function AddHoldingForm({ onAdd, onCancel, canManualPrice }) {
  const [symbol,    setSymbol]    = useState('')
  const [shares,    setShares]    = useState('')
  const [avgCost,   setAvgCost]   = useState('')
  const [livePrice, setLivePrice] = useState(null)
  const [fetching,  setFetching]  = useState(false)

  // When symbol is confirmed and user can't set manual price, fetch live price
  useEffect(() => {
    if (!symbol || canManualPrice) { setLivePrice(null); return }
    setFetching(true)
    fetch(`/api/market/snapshots?symbols=${symbol}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('tradebuddy_token')}` }
    })
      .then(r => r.json())
      .then(data => {
        const ticker = data.tickers?.[0]
        const price  = ticker?.day?.c || ticker?.prevDay?.c || ticker?.lastTrade?.p
        setLivePrice(price ?? null)
      })
      .catch(() => setLivePrice(null))
      .finally(() => setFetching(false))
  }, [symbol, canManualPrice])

  const handleSubmit = (e) => {
    e.preventDefault()
    const s  = symbol.toUpperCase().trim()
    const sh = parseFloat(shares)
    if (!s || isNaN(sh) || sh <= 0) return

    if (canManualPrice) {
      const ac = parseFloat(avgCost)
      if (isNaN(ac) || ac <= 0) return
      onAdd({ symbol: s, shares: sh, avgCost: ac })
    } else {
      // Market price buy — pass shares only, server fetches price
      onAdd({ symbol: s, shares: sh, marketBuy: true })
    }
  }

  const submitDisabled = !symbol || !shares ||
    (canManualPrice ? !avgCost : (!livePrice && !fetching))

  return (
    <form onSubmit={handleSubmit} className="bg-surface-card border border-border rounded-xl p-4 space-y-3">
      <h3 className="text-primary text-sm font-semibold">
        {canManualPrice ? 'Add Holding' : 'Buy at Market Price'}
      </h3>
      <div className={clsx('grid gap-2', canManualPrice ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
        <StockSearch value={symbol} onChange={setSymbol} placeholder="Search any stock…" />
        <input
          type="number" min="0.001" step="any" placeholder="Shares"
          value={shares} onChange={e => setShares(e.target.value)}
          className="bg-surface-hover text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border"
          required
        />
        {canManualPrice ? (
          <input
            type="number" min="0.01" step="any" placeholder="Avg cost ($)"
            value={avgCost} onChange={e => setAvgCost(e.target.value)}
            className="bg-surface-hover text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border"
            required
          />
        ) : (
          symbol && (
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-hover border border-border rounded-lg text-sm">
              <Lock size={12} className="text-muted shrink-0" />
              {fetching
                ? <span className="text-muted text-xs">Fetching price…</span>
                : livePrice
                  ? <span className="text-primary">${livePrice.toFixed(2)} <span className="text-muted text-xs">market price</span></span>
                  : <span className="text-muted text-xs">Price unavailable</span>
              }
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitDisabled}
          className="bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {canManualPrice ? 'Add to Portfolio' : 'Buy Now'}
        </button>
        <button type="button" onClick={onCancel} className="text-muted hover:text-primary text-sm px-3 py-2 transition-colors">Cancel</button>
        {!symbol && <span className="text-muted text-xs ml-1">← Select a stock first</span>}
      </div>
    </form>
  )
}

/**
 * TradePanel
 * Inline buy/sell form that appears beneath a holdings row.
 *
 * - Buy: uses current live price as default, recalculates weighted avg cost
 * - Sell: validates you can't sell more than you hold; removing all = full exit
 *
 * @param {'buy'|'sell'} mode
 * @param {object} holding  - the enriched holding object (has .shares, .price, .symbol)
 * @param {function} onClose
 */
function TradePanel({ mode, holding, onClose, onBuy, onSell, prefillShares }) {
  const [qty,        setQty]        = useState(prefillShares != null ? String(prefillShares) : '')
  const [error,      setError]      = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isBuy        = mode === 'buy'
  const shares       = parseFloat(qty)
  const totalShares  = parseFloat(holding.shares)   // pg returns NUMERIC as string — always parse
  const marketPrice  = holding.price

  // Live preview calculations
  const totalCash  = !isNaN(shares) && marketPrice > 0 ? shares * marketPrice : null
  const sellPct    = !isNaN(shares) && totalShares > 0
    ? Math.min(100, (shares / totalShares) * 100).toFixed(1) : null
  const newAvgCost = isBuy && !isNaN(shares) && marketPrice > 0 && shares > 0
    ? ((holding.avgCost * totalShares) + (marketPrice * shares)) / (totalShares + shares)
    : null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (isNaN(shares) || shares <= 0) { setError('Enter a valid number of shares.'); return }
    setSubmitting(true)
    try {
      if (isBuy) {
        if (marketPrice <= 0) { setError('Live price unavailable — try again shortly.'); setSubmitting(false); return }
        await onBuy({ symbol: holding.symbol, shares })
      } else {
        if (shares > totalShares) {
          setError(`You only hold ${totalShares} shares — can't sell more than that.`)
          setSubmitting(false)
          return
        }
        await onSell({ symbol: holding.symbol, shares })
      }
      // Parent's onBuy/onSell handler is responsible for closing the panel (setActivePanel(null))
    } catch (err) {
      setError(err.message || 'Trade failed. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <tr className="bg-surface-hover/50 border-t border-border">
      <td colSpan={9} className="px-5 py-4">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start gap-4 flex-wrap">

            {/* Mode label */}
            <div className={clsx(
              'flex items-center gap-1.5 text-sm font-semibold shrink-0 mt-2',
              isBuy ? 'text-gain' : 'text-loss'
            )}>
              {isBuy ? <ShoppingCart size={14} /> : <MinusCircle size={14} />}
              {isBuy ? 'Buy More' : 'Sell'} {holding.symbol}
            </div>

            {/* Shares input */}
            <div className="flex flex-col gap-1">
              <label className="text-muted text-xs">Shares</label>
              <input
                type="number" min="0.001" step="any"
                placeholder={isBuy ? 'How many to buy' : `Max ${totalShares}`}
                value={qty} onChange={e => setQty(e.target.value)}
                autoFocus
                className="bg-surface-card text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border w-40 focus:border-accent-blue/50 transition-colors"
              />
            </div>

            {/* Price — always locked to live market price */}
            <div className="flex flex-col gap-1">
              <label className="text-muted text-xs">Price per share ($)</label>
              <div className="flex items-center gap-1.5 px-3 py-2 bg-surface-card border border-border rounded-lg w-36 text-sm text-primary">
                <Lock size={11} className="text-muted shrink-0" />
                {marketPrice > 0 ? `$${marketPrice.toFixed(2)}` : <span className="text-muted text-xs">Unavailable</span>}
              </div>
            </div>

            {/* Live preview */}
            {qty && !isNaN(shares) && shares > 0 && (
              <div className="flex flex-col gap-1 mt-2 text-xs text-muted min-w-0">
                {totalCash !== null && (
                  <p>
                    {isBuy ? 'Total cost' : 'Proceeds'}:{' '}
                    <span className="text-primary font-medium">
                      ${totalCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </p>
                )}
                {isBuy && newAvgCost !== null && (
                  <p>New avg cost: <span className="text-primary font-medium">${newAvgCost.toFixed(2)}</span></p>
                )}
                {!isBuy && sellPct !== null && (
                  <p>
                    Selling <span className="text-primary font-medium">{sellPct}%</span> of position
                    {shares >= totalShares && <span className="text-loss ml-1">(full exit)</span>}
                  </p>
                )}
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-2 mt-auto ml-auto shrink-0">
              {error && <p className="text-loss text-xs max-w-xs">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className={clsx(
                  'text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  isBuy ? 'bg-gain hover:bg-gain/80' : 'bg-loss hover:bg-loss/80'
                )}
              >
                {submitting ? (isBuy ? 'Buying…' : 'Selling…') : (isBuy ? 'Confirm Buy' : 'Confirm Sell')}
              </button>
              <button type="button" onClick={onClose} disabled={submitting}
                className="text-muted hover:text-primary text-sm px-3 py-2 transition-colors disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  )
}

// ── EditPanel (teacher/admin only) ────────────────────────────────
// Inline row for correcting shares and avg cost on an existing holding.
function EditPanel({ holding, onClose, onSave }) {
  const [shares,  setShares]  = useState(String(holding.shares))
  const [avgCost, setAvgCost] = useState(holding.avgCost.toFixed(2))
  const [error,   setError]   = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    const s = parseFloat(shares)
    const c = parseFloat(avgCost)
    if (isNaN(s) || s <= 0) { setError('Enter valid shares.'); return }
    if (isNaN(c) || c <= 0) { setError('Enter valid avg cost.'); return }
    onSave({ symbol: holding.symbol, shares: s, avgCost: c })
  }

  return (
    <tr className="bg-surface-hover/50 border-t border-border">
      <td colSpan={9} className="px-5 py-4">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-accent-blue shrink-0 mt-2">
              <Pencil size={13} />
              Edit {holding.symbol}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-muted text-xs">Shares</label>
              <input
                type="number" min="0.001" step="any" autoFocus
                value={shares} onChange={e => setShares(e.target.value)}
                className="bg-surface-card text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border w-40 focus:border-accent-blue/50 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-muted text-xs">Avg Cost ($)</label>
              <input
                type="number" min="0.01" step="any"
                value={avgCost} onChange={e => setAvgCost(e.target.value)}
                className="bg-surface-card text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border w-36 focus:border-accent-blue/50 transition-colors"
              />
            </div>
            <div className="flex items-center gap-2 mt-auto ml-auto shrink-0">
              {error && <p className="text-loss text-xs">{error}</p>}
              <button type="submit"
                className="bg-accent-blue hover:bg-accent-blue/80 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Save Changes
              </button>
              <button type="button" onClick={onClose}
                className="text-muted hover:text-primary text-sm px-3 py-2 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  )
}

export default function Portfolio() {
  const { state, dispatch } = useApp()
  const { canTrade, isReadonly, isAdmin, isTeacher, isStudent } = useAuth()
  const canManualPrice = isAdmin || isTeacher   // only admin/teacher can set arbitrary prices
  const canManage = canTrade && !isStudent       // all non-students: edit/delete/add cash
  const [showAddForm, setShowAddForm] = useState(false)
  const [tradeError,  setTradeError]  = useState(null)
  const [cash,        setCash]        = useState(null)
  // Add cash form (teacher/admin only)
  const [showAddCash,   setShowAddCash]   = useState(false)
  const [addCashAmount, setAddCashAmount] = useState('')
  const [addCashError,  setAddCashError]  = useState('')
  const [addCashLoading, setAddCashLoading] = useState(false)
  // Sort state for the holdings table
  const [sortKey, setSortKey] = useState('value')
  const [sortDir, setSortDir] = useState('desc')

  const cycleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // activePanel: { symbol, mode: 'buy'|'sell'|'edit', prefillShares?: number } or null
  const [activePanel,      setActivePanel]      = useState(null)
  // expandedSymbols: Set of symbols whose lot rows are visible
  const [expandedSymbols,  setExpandedSymbols]  = useState(new Set())
  // transactions: all buy txns fetched once, grouped by symbol
  const [lotsBySymbol,     setLotsBySymbol]     = useState({})

  // Load cash balance on mount + trigger today's snapshot so the chart is current
  useEffect(() => {
    fetchCash().then(({ cash: c }) => setCash(c)).catch(() => {})
    triggerSnapshot().catch(() => {})  // fire-and-forget; chart re-fetches independently
    // Fetch all buy transactions for lot display
    fetchTransactions({ limit: 500 })
      .then(rows => {
        const bySymbol = {}
        for (const t of rows) {
          if (t.side !== 'buy') continue
          if (!bySymbol[t.symbol]) bySymbol[t.symbol] = []
          bySymbol[t.symbol].push(t)
        }
        setLotsBySymbol(bySymbol)
      })
      .catch(() => {})
  }, [])

  const toggleExpand = useCallback((symbol) => {
    setExpandedSymbols(prev => {
      const next = new Set(prev)
      next.has(symbol) ? next.delete(symbol) : next.add(symbol)
      return next
    })
  }, [])

  // Reload portfolio + cash + lots from server after a market trade.
  // Uses RELOAD_PORTFOLIO (not LOAD_DATA) so watchlist is never touched.
  const reloadPortfolio = async () => {
    const [fresh, { cash: newCash }, txns] = await Promise.all([
      fetchPortfolio(),
      fetchCash(),
      fetchTransactions({ limit: 500 }),
    ])
    dispatch({ type: ACTIONS.RELOAD_PORTFOLIO, payload: fresh })
    setCash(newCash)
    const bySymbol = {}
    for (const t of txns) {
      if (t.side !== 'buy') continue
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = []
      bySymbol[t.symbol].push(t)
    }
    setLotsBySymbol(bySymbol)
  }

  // Fetch live prices for all held symbols
  const symbols = state.portfolio.map(h => h.symbol)
  const { prices, loading, error, refetch } = useLivePrices(symbols)


  // Enrich holdings with live price data
  const holdings = useMemo(() => {
    return state.portfolio.map((holding, i) => {
      const live      = prices.get(holding.symbol)
      const price     = live?.price     ?? 0
      const changePct = live?.changePct ?? 0   // today's % price change
      const value     = price * holding.shares
      const cost      = holding.avgCost * holding.shares
      const gain      = value - cost
      const gainPct   = cost > 0 ? (gain / cost) * 100 : 0
      const meta      = STOCKS.find(s => s.symbol === holding.symbol) ?? {}
      return { ...holding, ...meta, price, changePct, value, cost, gain, gainPct, colorIndex: i }
    })
  }, [state.portfolio, prices])

  const sortedHoldings = useMemo(() => {
    const sorted = [...holdings].sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'symbol':   av = a.symbol;    bv = b.symbol;    break
        case 'shares':   av = a.shares;    bv = b.shares;    break
        case 'avgCost':  av = a.avgCost;   bv = b.avgCost;   break
        case 'price':    av = a.price;     bv = b.price;     break
        case 'changePct':av = a.changePct; bv = b.changePct; break
        case 'gain':     av = a.gain;      bv = b.gain;      break
        case 'gainPct':  av = a.gainPct;   bv = b.gainPct;   break
        default:         av = a.value;     bv = b.value;     break
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return sorted
  }, [holdings, sortKey, sortDir])

  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0)
  const totalValue    = holdingsValue + (cash ?? 0)
  const totalCost     = holdings.reduce((s, h) => s + h.cost,  0)
  const totalGain     = holdingsValue - totalCost
  const totalGainPct  = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

  // Today's P/L — derived from each holding's daily price % change
  const todayPL = holdings.reduce((s, h) => {
    const prevValue = h.changePct !== 0 ? h.value / (1 + h.changePct / 100) : h.value
    return s + (h.value - prevValue)
  }, 0)
  const prevHoldingsValue = holdingsValue - todayPL
  const todayPLPct = prevHoldingsValue > 0 ? (todayPL / prevHoldingsValue) * 100 : 0

  if (loading) return <LoadingSpinner message="Fetching live prices…" />
  if (error)   return <ErrorMessage error={error} />

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* ── Summary cards ────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <DollarSign size={14} className="text-muted" />
              <p className="text-muted text-xs">Total Value</p>
            </div>
            <button onClick={refetch} className="text-faint hover:text-muted transition-colors" title="Refresh prices">
              <RefreshCw size={11} />
            </button>
          </div>
          <p className="text-primary font-bold text-2xl">
            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-muted text-xs mt-0.5">cash + holdings</p>
        </div>

        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <DollarSign size={14} className="text-accent-blue" />
              <p className="text-muted text-xs">Cash Available</p>
            </div>
            {canManage && (
              <button
                onClick={() => { setShowAddCash(v => !v); setAddCashAmount(''); setAddCashError('') }}
                title="Add or deduct cash"
                className="text-faint hover:text-accent-blue transition-colors"
              >
                <BadgeDollarSign size={14} />
              </button>
            )}
          </div>
          <p className="text-accent-blue font-bold text-2xl">
            ${(cash ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          {showAddCash ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                setAddCashError('')
                const amt = parseFloat(addCashAmount)
                if (isNaN(amt) || amt === 0) { setAddCashError('Enter a non-zero amount.'); return }
                setAddCashLoading(true)
                try {
                  const { cash: newCash } = await addCash(amt)
                  setCash(newCash)
                  setShowAddCash(false)
                  setAddCashAmount('')
                } catch (err) {
                  setAddCashError(err.message)
                } finally {
                  setAddCashLoading(false)
                }
              }}
              className="mt-2 flex items-center gap-1.5"
            >
              <input
                type="number" step="any" autoFocus
                placeholder="e.g. 500 or -100"
                value={addCashAmount}
                onChange={e => setAddCashAmount(e.target.value)}
                className="bg-surface-hover text-primary text-xs rounded px-2 py-1 outline-none border border-border w-28 focus:border-accent-blue/50"
              />
              <button
                type="submit"
                disabled={addCashLoading}
                className="bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-40 text-white text-xs font-medium px-2 py-1 rounded transition-colors"
              >
                {addCashLoading ? '…' : 'Apply'}
              </button>
              <button type="button" onClick={() => setShowAddCash(false)} className="text-muted hover:text-primary text-xs transition-colors">✕</button>
              {addCashError && <p className="text-loss text-[10px]">{addCashError}</p>}
            </form>
          ) : (
            <p className="text-muted text-xs mt-0.5">buying power</p>
          )}
        </div>

        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-muted" />
            <p className="text-muted text-xs">Total Return</p>
          </div>
          <p className={clsx('font-bold text-2xl', totalGain >= 0 ? 'text-gain' : 'text-loss')}>
            {totalGain >= 0 ? '+' : ''}${totalGain.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className={clsx('text-xs mt-0.5', totalGainPct >= 0 ? 'text-gain' : 'text-loss')}>
            {totalGainPct >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}% unrealized
          </p>
        </div>

        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-muted" />
            <p className="text-muted text-xs">Today's P&L</p>
          </div>
          <p className={clsx('font-bold text-2xl', todayPL >= 0 ? 'text-gain' : 'text-loss')}>
            {todayPL >= 0 ? '+' : ''}${todayPL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className={clsx('text-xs mt-0.5', todayPLPct >= 0 ? 'text-gain' : 'text-loss')}>
            {todayPLPct >= 0 ? '+' : ''}{todayPLPct.toFixed(2)}% today
          </p>
        </div>
      </div>

      {/* ── Performance chart ───────────────────────── */}
      <PortfolioChart currentValue={totalValue} />

      {/* ── Allocation heatmap ───────────────────────── */}
      {holdings.length > 0 && totalValue > 0 && (
        <StockTreemap
          data={holdings.map(h => ({
            name:      h.symbol,
            symbol:    h.symbol,
            size:      h.value,
            changePct: h.changePct,
            price:     h.price,
            tooltipLines: [
              `Value: $${h.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              `Allocation: ${((h.value / totalValue) * 100).toFixed(1)}%`,
              `Return: ${h.gainPct >= 0 ? '+' : ''}${h.gainPct.toFixed(2)}%`,
            ],
          }))}
          height={200}
          clampRange={[-5, 5]}
          onCellClick={(sym) => dispatch({ type: ACTIONS.VIEW_STOCK, payload: sym })}
          title="Portfolio Allocation"
          subtitle="Size = position value · Color = today's price change %"
        />
      )}

      {/* ── Holdings table ───────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-primary text-sm font-semibold">Holdings ({holdings.length})</h2>
          {canTrade ? (
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="flex items-center gap-1.5 text-accent-blue hover:text-accent-blue/80 text-xs font-medium transition-colors"
            >
              <PlusCircle size={14} /> Add Holding
            </button>
          ) : (
            <span className="text-faint text-xs italic">view only</span>
          )}
        </div>

        {showAddForm && (
          <div className="p-4 border-b border-border">
            <AddHoldingForm
              canManualPrice={canManage}
              onAdd={async h => {
                setTradeError(null)
                try {
                  if (h.marketBuy) {
                    await buyAtMarket(h.symbol, h.shares)
                    await reloadPortfolio()
                  } else {
                    dispatch({ type: ACTIONS.ADD_TO_PORTFOLIO, payload: h })
                  }
                  setShowAddForm(false)
                } catch (err) {
                  setTradeError(err.message)
                }
              }}
              onCancel={() => setShowAddForm(false)}
            />
            {tradeError && <p className="text-loss text-xs mt-2">{tradeError}</p>}
          </div>
        )}

        {holdings.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted text-sm">No holdings yet. Click "Add Holding" to get started.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-muted text-xs border-b border-border">
                <th className="w-6 px-2 py-3"></th>
                {[
                  { key: 'symbol',    label: 'Symbol',        align: 'left'  },
                  { key: 'shares',    label: 'Shares',        align: 'right' },
                  { key: 'avgCost',   label: 'Avg Cost',      align: 'right' },
                  { key: 'price',     label: 'Current (Live)',align: 'right' },
                  { key: 'changePct', label: 'Today',         align: 'right' },
                  { key: 'value',     label: 'Value',         align: 'right' },
                  { key: 'gain',      label: 'Gain / Loss',   align: 'right' },
                ].map(({ key, label, align }) => {
                  const active = sortKey === key
                  return (
                    <th
                      key={key}
                      onClick={() => cycleSort(key)}
                      className={clsx(
                        'px-5 py-3 font-medium cursor-pointer select-none hover:text-primary transition-colors',
                        align === 'left' ? 'text-left px-3' : 'text-right',
                        active && 'text-primary'
                      )}
                    >
                      <span className="inline-flex items-center gap-1 justify-end w-full">
                        {align === 'left' && active && (
                          sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                        )}
                        {label}
                        {align !== 'left' && (
                          active
                            ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
                            : <ChevronsUpDown size={11} className="opacity-30" />
                        )}
                      </span>
                    </th>
                  )
                })}
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map(h => {
                const panelOpen  = activePanel?.symbol === h.symbol
                const panelMode  = activePanel?.mode
                const isExpanded = expandedSymbols.has(h.symbol)
                const lots       = lotsBySymbol[h.symbol] ?? []
                const hasLots    = lots.length > 0

                const togglePanel = (mode, prefillShares) => {
                  const already = panelOpen && panelMode === mode &&
                    activePanel?.prefillShares === prefillShares
                  setActivePanel(already ? null : { symbol: h.symbol, mode, prefillShares })
                }
                const toggleEdit = () => {
                  const already = panelOpen && panelMode === 'edit'
                  setActivePanel(already ? null : { symbol: h.symbol, mode: 'edit' })
                }

                return (
                  <>
                    <tr
                      key={h.symbol}
                      className={clsx(
                        'border-t border-border transition-colors',
                        panelOpen || isExpanded ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                      )}
                    >
                      {/* Expand chevron */}
                      <td className="w-6 pl-3 pr-0 py-3">
                        {hasLots ? (
                          <button
                            onClick={() => toggleExpand(h.symbol)}
                            title={isExpanded ? 'Collapse buy lots' : 'Show buy lots'}
                            className="text-muted hover:text-primary transition-colors"
                          >
                            {isExpanded
                              ? <ChevronDown size={14} />
                              : <ChevronRight size={14} />}
                          </button>
                        ) : (
                          <span className="w-3.5 inline-block" />
                        )}
                      </td>

                      {/* Symbol */}
                      <td className="px-3 py-3">
                        <button onClick={() => dispatch({ type: ACTIONS.VIEW_STOCK, payload: h.symbol })} className="text-left">
                          <p className="text-primary font-mono font-semibold">{h.symbol}</p>
                          <p className="text-muted text-xs">{h.name}</p>
                        </button>
                      </td>
                      <td className="text-right px-5 py-3 text-secondary">{h.shares}</td>
                      <td className="text-right px-5 py-3 text-secondary">${fmt$(h.avgCost)}</td>
                      <td className="text-right px-5 py-3 text-primary">${fmt$(h.price)}</td>
                      <td className="text-right px-5 py-3">
                        {(() => {
                          const dayPL = h.changePct !== 0 ? h.value - h.value / (1 + h.changePct / 100) : 0
                          return (
                            <>
                              <p className={clsx('font-medium text-sm', h.changePct >= 0 ? 'text-gain' : 'text-loss')}>
                                {h.changePct >= 0 ? '+' : ''}${fmt$(dayPL)}
                              </p>
                              <p className={clsx('text-xs', h.changePct >= 0 ? 'text-gain' : 'text-loss')}>
                                {h.changePct >= 0 ? '+' : ''}{h.changePct.toFixed(2)}%
                              </p>
                            </>
                          )
                        })()}
                      </td>
                      <td className="text-right px-5 py-3 text-primary font-medium">
                        ${fmt$(h.value)}
                      </td>
                      <td className="text-right px-5 py-3">
                        <p className={clsx('font-medium', h.gain >= 0 ? 'text-gain' : 'text-loss')}>
                          {h.gain >= 0 ? '+' : ''}${fmt$(h.gain)}
                        </p>
                        <p className={clsx('text-xs', h.gainPct >= 0 ? 'text-gain' : 'text-loss')}>
                          {h.gainPct >= 0 ? '+' : ''}{h.gainPct.toFixed(2)}%
                        </p>
                      </td>

                      {/* Actions: Buy / Sell / Remove — hidden for readonly */}
                      <td className="px-4 py-3">
                        {canTrade ? (
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              onClick={() => togglePanel('buy')}
                              title="Buy more"
                              className={clsx(
                                'px-2 py-1 rounded text-xs font-medium border transition-colors',
                                panelOpen && panelMode === 'buy'
                                  ? 'bg-gain/20 border-gain/40 text-gain'
                                  : 'border-border text-muted hover:border-gain/40 hover:text-gain'
                              )}
                            >
                              Buy
                            </button>
                            <button
                              onClick={() => togglePanel('sell')}
                              title="Sell shares"
                              className={clsx(
                                'px-2 py-1 rounded text-xs font-medium border transition-colors',
                                panelOpen && panelMode === 'sell'
                                  ? 'bg-loss/20 border-loss/40 text-loss'
                                  : 'border-border text-muted hover:border-loss/40 hover:text-loss'
                              )}
                            >
                              Sell
                            </button>
                            {/* Edit + Trash for all non-students */}
                            {canManage && (
                              <>
                                <button
                                  onClick={toggleEdit}
                                  title="Edit shares / avg cost"
                                  className={clsx(
                                    'p-1 rounded transition-colors ml-1',
                                    panelOpen && panelMode === 'edit'
                                      ? 'text-accent-blue'
                                      : 'text-faint hover:text-accent-blue'
                                  )}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => dispatch({ type: ACTIONS.REMOVE_FROM_PORTFOLIO, payload: h.symbol })}
                                  title="Remove holding"
                                  className="text-faint hover:text-loss transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-faint text-xs italic text-right block">view only</span>
                        )}
                      </td>
                    </tr>

                    {/* ── Buy lot sub-rows (expanded) ────────────────────── */}
                    {isExpanded && lots.map((lot, idx) => {
                      const lotShares   = parseFloat(lot.shares)
                      const lotPrice    = parseFloat(lot.price)
                      const lotValue    = lotShares * h.price          // at live price
                      const lotCost     = parseFloat(lot.total)
                      const lotGain     = lotValue - lotCost
                      const lotGainPct  = lotCost > 0 ? (lotGain / lotCost) * 100 : 0
                      const dt          = new Date(lot.executed_at)
                      const dateLabel   = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                      const isLotPanel  = panelOpen && panelMode === 'sell' &&
                        activePanel?.prefillShares === lotShares && activePanel?.lotIdx === idx

                      return (
                        <tr
                          key={`lot-${lot.id}`}
                          className="border-t border-border/50 bg-surface-hover/60"
                        >
                          {/* indent spacer */}
                          <td className="pl-3 pr-0 py-2" />
                          {/* lot info */}
                          <td className="px-3 py-2" colSpan={1}>
                            <p className="text-muted text-[11px]">Lot #{idx + 1}</p>
                            <p className="text-faint text-[10px]">{dateLabel}{lot.source === 'agent' ? ' · AI' : ''}</p>
                          </td>
                          <td className="text-right px-5 py-2 text-secondary text-xs font-mono">
                            {lotShares.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                          </td>
                          <td className="text-right px-5 py-2 text-secondary text-xs font-mono">
                            ${lotPrice.toFixed(2)}
                          </td>
                          {/* current price — same as parent row */}
                          <td className="text-right px-5 py-2 text-muted text-xs">—</td>
                          {/* today — inherited from parent */}
                          <td className="text-right px-5 py-2 text-muted text-xs">—</td>
                          <td className="text-right px-5 py-2 text-xs text-secondary font-mono">
                            ${lotValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="text-right px-5 py-2">
                            <p className={clsx('text-xs font-medium', lotGain >= 0 ? 'text-gain' : 'text-loss')}>
                              {lotGain >= 0 ? '+' : ''}${lotGain.toFixed(2)}
                            </p>
                            <p className={clsx('text-[10px]', lotGainPct >= 0 ? 'text-gain' : 'text-loss')}>
                              {lotGainPct >= 0 ? '+' : ''}{lotGainPct.toFixed(2)}%
                            </p>
                          </td>
                          <td className="px-4 py-2 text-right">
                            {canTrade && (
                              <button
                                onClick={() => {
                                  setActivePanel({
                                    symbol: h.symbol,
                                    mode: 'sell',
                                    prefillShares: lotShares,
                                    lotIdx: idx,
                                  })
                                }}
                                className={clsx(
                                  'px-2 py-1 rounded text-xs font-medium border transition-colors',
                                  isLotPanel
                                    ? 'bg-loss/20 border-loss/40 text-loss'
                                    : 'border-border text-muted hover:border-loss/40 hover:text-loss'
                                )}
                              >
                                Sell lot
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}

                    {/* Inline edit panel (teacher/admin only) */}
                    {panelOpen && panelMode === 'edit' && (
                      <EditPanel
                        key={`edit-${h.symbol}`}
                        holding={h}
                        onClose={() => setActivePanel(null)}
                        onSave={async ({ symbol, shares, avgCost }) => {
                          setTradeError(null)
                          try {
                            await upsertHolding(symbol, shares, avgCost)
                            await reloadPortfolio()
                            setActivePanel(null)
                          } catch (err) { setTradeError(err.message) }
                        }}
                      />
                    )}

                    {/* Inline trade panel — renders as a full-width row beneath */}
                    {panelOpen && (panelMode === 'buy' || panelMode === 'sell') && (
                      <TradePanel
                        key={`panel-${h.symbol}-${activePanel?.lotIdx ?? 'main'}`}
                        mode={panelMode}
                        holding={h}
                        prefillShares={activePanel?.prefillShares}
                        onClose={() => setActivePanel(null)}
                        onBuy={async (payload) => {
                          // Always trade at live market price for all roles
                          await buyAtMarket(payload.symbol, payload.shares)
                          await reloadPortfolio()
                          setActivePanel(null)
                        }}
                        onSell={async (payload) => {
                          // Always trade at live market price for all roles
                          await sellAtMarket(payload.symbol, payload.shares)
                          await reloadPortfolio()
                          // Collapse lot rows so updated state is clean
                          setExpandedSymbols(prev => {
                            const next = new Set(prev)
                            next.delete(payload.symbol)
                            return next
                          })
                          setActivePanel(null)
                        }}
                      />
                    )}
                  </>
                )
              })}

              {/* ── Cash row ── always shown at bottom of table */}
              {cash !== null && (
                <tr className="border-t border-border bg-accent-blue/5">
                  <td className="px-2 py-3" />
                  <td className="px-3 py-3">
                    <p className="text-accent-blue font-mono font-semibold">CASH</p>
                    <p className="text-muted text-xs">Buying power</p>
                  </td>
                  <td className="text-right px-5 py-3 text-muted text-xs">—</td>
                  <td className="text-right px-5 py-3 text-muted text-xs">—</td>
                  <td className="text-right px-5 py-3 text-muted text-xs">—</td>
                  <td className="text-right px-5 py-3 text-muted text-xs">—</td>
                  <td className="text-right px-5 py-3 text-accent-blue font-medium">
                    ${cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="text-right px-5 py-3 text-muted text-xs">—</td>
                  <td className="px-4 py-3"></td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

    </div>
  )
}
