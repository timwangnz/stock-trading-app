/**
 * History.jsx
 * Daily portfolio history page.
 *
 * Data strategy (in priority order):
 *   1. DB snapshots  — accurate daily totals recorded by the server
 *   2. On-the-fly    — falls back to Polygon price × current shares
 *                      when snapshots are sparse (e.g. new account)
 *
 * SPY benchmark is always fetched live from Polygon and normalised to
 * the portfolio's starting value.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ComposedChart, BarChart,
  Area, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { BarChart2, Activity, RefreshCw, AlertCircle, Database, TrendingUp, ArrowUpCircle, ArrowDownCircle, Bot } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { getAggregates, daysAgo, today } from '../services/polygonApi'
import { getPortfolioSnapshots, triggerSnapshot, fetchTransactions } from '../../common/services/apiService'
import clsx from 'clsx'

// ── Date helpers ─────────────────────────────────────────────────
const FROM = daysAgo(365)
const TO   = today()

// ── Number formatters ────────────────────────────────────────────
const fmt  = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtK = (n) => n == null ? '—' : n >= 1000 ? `$${(n/1000).toFixed(1)}k` : `$${n.toFixed(0)}`
const fmtPct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`

// ── Stat card ────────────────────────────────────────────────────
function StatCard({ label, value, sub, positive, negative }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl px-5 py-4">
      <p className="text-muted text-xs mb-1">{label}</p>
      <p className={clsx(
        'text-xl font-semibold',
        positive && 'text-gain',
        negative && 'text-loss',
        !positive && !negative && 'text-primary',
      )}>{value}</p>
      {sub && <p className="text-muted text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Custom tooltip for portfolio value chart ─────────────────────
function ValueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-surface-card border border-border rounded-xl px-4 py-3 shadow-lg text-xs space-y-1.5">
      <p className="text-muted font-medium">{label}</p>
      <p className="text-primary">Portfolio: <span className="font-semibold text-accent-blue">{fmt(d?.portfolioValue)}</span></p>
      <p className="text-primary">S&P 500:   <span className="font-semibold text-accent-purple">{fmt(d?.spyValue)}</span></p>
      {d?.dailyPnL != null && (
        <p className={clsx('font-semibold', d.dailyPnL >= 0 ? 'text-gain' : 'text-loss')}>
          Daily P&L: {fmt(d.dailyPnL)} ({fmtPct(d.dailyPnLPct)})
        </p>
      )}
    </div>
  )
}

// ── Custom tooltip for P&L bar chart ────────────────────────────
function PnLTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div className="bg-surface-card border border-border rounded-xl px-4 py-3 shadow-lg text-xs">
      <p className="text-muted font-medium mb-1">{label}</p>
      <p className={clsx('font-semibold', val >= 0 ? 'text-gain' : 'text-loss')}>
        {fmt(val)}
      </p>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────
export default function History() {
  const { state }          = useApp()
  const portfolio          = state.portfolio ?? []
  const dbReady            = state.dbReady   ?? false   // true once auth + initial load done

  const [activeTab,   setActiveTab]   = useState('performance') // 'performance' | 'trades'

  const [data,        setData]        = useState([])
  const [loading,     setLoading]     = useState(false)
  const [snapshotting,setSnapshotting]= useState(false)
  const [error,       setError]       = useState(null)
  const [range,       setRange]       = useState('1Y')   // '1M' | '3M' | '6M' | '1Y'
  const [dataSource,  setDataSource]  = useState(null)   // 'snapshots' | 'estimated'

  // ── Trades tab state ──────────────────────────────────────────
  const [trades,       setTrades]       = useState([])
  const [tradesLoading,setTradesLoading]= useState(false)
  const [tradesError,  setTradesError]  = useState(null)

  // ── Fetch all historical data ──────────────────────────────────
  const fetchHistory = useCallback(async () => {
    // Wait until auth is confirmed (dbReady) — avoids 401 on first render
    if (!dbReady || !portfolio.length) return
    setLoading(true)
    setError(null)

    try {
      // ── Fetch SPY for benchmark (best-effort — chart can work without it) ──
      let spyBars = []
      let spyMap  = {}
      try {
        spyBars = await getAggregates('SPY', FROM, TO)
        for (const bar of spyBars) spyMap[bar.date] = bar.close
      } catch (_) { /* SPY unavailable — show portfolio-only chart */ }

      // ── Try DB snapshots first ──────────────────────────────────
      let snapshotMap = {}
      let usingSnapshots = false
      try {
        const snaps = await getPortfolioSnapshots(FROM, TO)
        if (snaps?.length >= 1) {
          for (const s of snaps) {
            // Normalise to "YYYY-MM-DD" string — pg may return DATE as a Date object
            const key = typeof s.date === 'string'
              ? s.date
              : new Date(s.date).toISOString().split('T')[0]
            snapshotMap[key] = Number(s.total_value)
          }
          usingSnapshots = true
        }
      } catch (_) { /* snapshots unavailable — fall through to estimate */ }

      // ── Fallback: estimate from current holdings × Polygon prices ─
      let priceMap = {}
      if (!usingSnapshots) {
        const symbols = [...new Set(portfolio.map(h => h.symbol))]
        const holdingBars = await Promise.all(symbols.map(sym => getAggregates(sym, FROM, TO)))
        symbols.forEach((sym, i) => {
          priceMap[sym] = {}
          for (const bar of holdingBars[i]) priceMap[sym][bar.date] = bar.close
        })
      }

      // ── Determine date axis ─────────────────────────────────────
      // Prefer SPY trading days (gives a clean market-day x-axis).
      // If SPY data is unavailable, fall back to snapshot dates or
      // the union of holding price dates so the chart still renders.
      let allDates
      if (spyBars.length > 0) {
        allDates = spyBars.map(b => b.date)
      } else if (usingSnapshots) {
        allDates = Object.keys(snapshotMap).sort()
      } else {
        const dateSet = new Set()
        for (const bars of Object.values(priceMap)) {
          for (const date of Object.keys(bars)) dateSet.add(date)
        }
        allDates = [...dateSet].sort()
      }

      if (allDates.length === 0) {
        setError('No market data available — check that your Polygon API key is configured.')
        return
      }

      // ── Build row array ────────────────────────────────────────
      const lastKnown = {}
      const rows = []
      const holdingSymbols = [...new Set(portfolio.map(h => h.symbol))]

      for (const date of allDates) {
        let portfolioValue

        if (usingSnapshots) {
          // Use stored snapshot if available, carry forward otherwise
          if (snapshotMap[date] != null) {
            portfolioValue = snapshotMap[date]
          } else if (rows.length > 0) {
            portfolioValue = rows[rows.length - 1].portfolioValue
          } else {
            portfolioValue = 0
          }
        } else {
          // On-the-fly: price × current shares
          for (const sym of holdingSymbols) {
            if (priceMap[sym]?.[date] != null) lastKnown[sym] = priceMap[sym][date]
          }
          portfolioValue = portfolio.reduce((sum, h) => {
            return sum + (h.shares ?? 0) * (lastKnown[h.symbol] ?? 0)
          }, 0)
        }

        rows.push({ date, portfolioValue, spyClose: spyMap[date] ?? null })
      }

      // ── Trim leading zeros (dates before the first snapshot / purchase) ──
      // Without this, the chart shows a flat $0 line for every day before
      // the user's first recorded portfolio value, which looks wrong.
      const firstRealIdx = rows.findIndex(r => r.portfolioValue > 0)
      const trimmedRows  = firstRealIdx >= 0 ? rows.slice(firstRealIdx) : []

      if (trimmedRows.length === 0) {
        setError('No portfolio value data found. Try clicking "Snapshot Now" to record today\'s value, or check that your holdings have historical price data.')
        return
      }

      // ── Normalise SPY to portfolio's starting value ────────────
      const startValue = trimmedRows[0]?.portfolioValue || 1
      const spyStart   = trimmedRows.find(r => r.spyClose != null)?.spyClose || 1

      const enriched = trimmedRows.map((r, i) => {
        const prev         = i > 0 ? trimmedRows[i - 1].portfolioValue : r.portfolioValue
        const dailyPnL     = r.portfolioValue - prev
        const dailyPnLPct  = prev > 0 ? (dailyPnL / prev) * 100 : 0
        const spyValue     = r.spyClose != null ? (r.spyClose / spyStart) * startValue : null

        return {
          ...r,
          spyValue,
          dailyPnL:    i === 0 ? 0 : dailyPnL,
          dailyPnLPct: i === 0 ? 0 : dailyPnLPct,
          label: new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        }
      })

      setData(enriched)
      setDataSource(usingSnapshots ? 'snapshots' : 'estimated')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [portfolio.length, dbReady])

  // ── Fetch trade log ────────────────────────────────────────────
  const fetchTrades = useCallback(async () => {
    if (!dbReady) return
    setTradesLoading(true)
    setTradesError(null)
    try {
      const rows = await fetchTransactions({ limit: 200 })
      setTrades(rows)
    } catch (err) {
      setTradesError(err.message)
    } finally {
      setTradesLoading(false)
    }
  }, [dbReady])

  useEffect(() => {
    if (activeTab === 'trades') fetchTrades()
  }, [activeTab, fetchTrades])

  // ── Take a manual snapshot ─────────────────────────────────────
  const handleSnapshot = async () => {
    setSnapshotting(true)
    try {
      await triggerSnapshot()
      await fetchHistory()   // refresh chart with new point
    } catch (err) {
      setError('Snapshot failed: ' + err.message)
    } finally {
      setSnapshotting(false)
    }
  }

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // ── Filter by selected range ──────────────────────────────────
  const filtered = useMemo(() => {
    if (!data.length) return []
    const days = { '1M': 22, '3M': 66, '6M': 130, '1Y': 999 }
    return data.slice(-days[range])
  }, [data, range])

  // ── Summary stats ─────────────────────────────────────────────
  const stats = useMemo(() => {
    if (filtered.length < 2) return null
    const first = filtered[0].portfolioValue
    const last  = filtered[filtered.length - 1].portfolioValue
    const spyFirst = filtered.find(r => r.spyValue != null)?.spyValue
    const spyLast  = [...filtered].reverse().find(r => r.spyValue != null)?.spyValue

    const totalReturn    = last - first
    const totalReturnPct = first > 0 ? (totalReturn / first) * 100 : 0

    const spyReturn    = spyFirst && spyLast ? spyLast - spyFirst : null
    const spyReturnPct = spyFirst && spyFirst > 0 ? ((spyLast - spyFirst) / spyFirst) * 100 : null

    const alpha = spyReturnPct != null ? totalReturnPct - spyReturnPct : null

    const positiveDays  = filtered.filter(r => r.dailyPnL > 0).length
    const negativeDays  = filtered.filter(r => r.dailyPnL < 0).length
    const bestDay       = filtered.reduce((best, r) => r.dailyPnL > best.dailyPnL ? r : best, filtered[0])
    const worstDay      = filtered.reduce((worst, r) => r.dailyPnL < worst.dailyPnL ? r : worst, filtered[0])

    return {
      currentValue: last,
      totalReturn, totalReturnPct,
      spyReturnPct, alpha,
      positiveDays, negativeDays,
      bestDay, worstDay,
    }
  }, [filtered])

  // ── Thin down X-axis labels to avoid crowding ─────────────────
  const tickInterval = range === '1M' ? 3 : range === '3M' ? 9 : range === '6M' ? 18 : 36

  // ── Render ────────────────────────────────────────────────────
  if (!portfolio.length) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 text-center">
        <BarChart2 size={40} className="text-muted" />
        <p className="text-primary font-medium">No portfolio holdings yet</p>
        <p className="text-muted text-sm">Add some stocks to your portfolio to see historical performance.</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-primary font-semibold text-xl">Portfolio History</h1>
          <p className="text-muted text-sm mt-1">
            {activeTab === 'performance'
              ? 'Daily performance vs S&P 500 benchmark'
              : 'All executed buy and sell trades'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tab switcher */}
          <div className="flex gap-1 bg-surface-hover border border-border rounded-lg p-1">
            {[
              { id: 'performance', label: 'Performance' },
              { id: 'trades',      label: 'Trades'      },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-accent-blue text-white'
                    : 'text-muted hover:text-primary'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'performance' && (<>
            {/* Range selector */}
            <div className="flex gap-1 bg-surface-hover border border-border rounded-lg p-1">
              {['1M','3M','6M','1Y'].map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={clsx(
                    'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                    range === r
                      ? 'bg-accent-blue/20 text-accent-blue'
                      : 'text-muted hover:text-primary'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            {/* Snapshot now */}
            <button
              onClick={handleSnapshot}
              disabled={snapshotting || loading}
              title="Save today's portfolio value to the database"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted hover:text-primary hover:bg-surface-hover text-xs transition-colors disabled:opacity-40"
            >
              <Database size={12} className={snapshotting ? 'animate-pulse' : ''} />
              {snapshotting ? 'Saving…' : 'Snapshot Now'}
            </button>
            {/* Refresh */}
            <button
              onClick={fetchHistory}
              disabled={loading}
              className="p-2 rounded-lg border border-border text-muted hover:text-primary hover:bg-surface-hover transition-colors disabled:opacity-40"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </>)}

          {activeTab === 'trades' && (
            <button
              onClick={fetchTrades}
              disabled={tradesLoading}
              className="p-2 rounded-lg border border-border text-muted hover:text-primary hover:bg-surface-hover transition-colors disabled:opacity-40"
            >
              <RefreshCw size={14} className={tradesLoading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>

      {/* Data source badge (performance tab only) */}
      {activeTab === 'performance' && dataSource && (
        <div className="flex">
          <span className={clsx(
            'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border',
            dataSource === 'snapshots'
              ? 'text-gain border-gain/30 bg-gain/10'
              : 'text-amber-400 border-amber-400/30 bg-amber-400/10'
          )}>
            {dataSource === 'snapshots'
              ? <><Database size={9} /> DB snapshots</>
              : <><TrendingUp size={9} /> Estimated</>
            }
          </span>
        </div>
      )}

      {/* ── PERFORMANCE TAB ─────────────────────────────────────────── */}
      {activeTab === 'performance' && (<>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 bg-loss/10 border border-loss/20 text-loss/80 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="h-72 bg-surface-card border border-border rounded-xl flex items-center justify-center gap-3">
          <RefreshCw size={18} className="text-accent-blue animate-spin" />
          <span className="text-muted text-sm">Fetching 1 year of data…</span>
        </div>
      )}

      {/* Stats row */}
      {!loading && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Current Value"
            value={fmt(stats.currentValue)}
          />
          <StatCard
            label={`Total Return (${range})`}
            value={fmtPct(stats.totalReturnPct)}
            sub={fmt(stats.totalReturn)}
            positive={stats.totalReturn >= 0}
            negative={stats.totalReturn < 0}
          />
          <StatCard
            label={`vs S&P 500 (${range})`}
            value={stats.alpha != null ? fmtPct(stats.alpha) : '—'}
            sub={stats.spyReturnPct != null ? `SPY: ${fmtPct(stats.spyReturnPct)}` : undefined}
            positive={stats.alpha != null && stats.alpha >= 0}
            negative={stats.alpha != null && stats.alpha < 0}
          />
          <StatCard
            label="Win / Loss Days"
            value={`${stats.positiveDays} / ${stats.negativeDays}`}
            sub={`Best: ${fmt(stats.bestDay?.dailyPnL)}`}
          />
        </div>
      )}

      {/* Portfolio value + SPY chart */}
      {!loading && filtered.length > 0 && (
        <div className="bg-surface-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-accent-blue" />
            <h2 className="text-primary text-sm font-semibold">Portfolio Value vs S&P 500</h2>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={filtered} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="rgb(var(--accent-blue))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="rgb(var(--accent-blue))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'rgb(var(--text-muted))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                interval={tickInterval}
              />
              <YAxis
                tickFormatter={fmtK}
                tick={{ fill: 'rgb(var(--text-muted))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                width={60}
              />
              <Tooltip content={<ValueTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                formatter={(value) => <span style={{ color: 'rgb(var(--text-muted))' }}>{value}</span>}
              />
              <Area
                type="monotone"
                dataKey="portfolioValue"
                name="Portfolio"
                stroke="rgb(var(--accent-blue))"
                strokeWidth={2}
                fill="url(#portfolioGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
              <Line
                type="monotone"
                dataKey="spyValue"
                name="S&P 500"
                stroke="rgb(var(--accent-purple))"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 3"
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily P&L bar chart */}
      {!loading && filtered.length > 0 && (
        <div className="bg-surface-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={14} className="text-accent-blue" />
            <h2 className="text-primary text-sm font-semibold">Daily P&L</h2>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={filtered} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'rgb(var(--text-muted))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                interval={tickInterval}
              />
              <YAxis
                tickFormatter={fmtK}
                tick={{ fill: 'rgb(var(--text-muted))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                width={60}
              />
              <Tooltip content={<PnLTooltip />} />
              <ReferenceLine y={0} stroke="rgb(var(--border))" strokeWidth={1.5} />
              <Bar
                dataKey="dailyPnL"
                name="Daily P&L"
                radius={[2, 2, 0, 0]}
                fill="rgb(var(--gain))"
                // colour each bar individually: green if positive, red if negative
                label={false}
                isAnimationActive={false}
                // recharts allows a function for fill via Cell, but the cleanest
                // approach here is a custom bar shape:
                shape={(props) => {
                  const { x, y, width, height, value } = props
                  const color = value >= 0
                    ? 'rgb(var(--gain))'
                    : 'rgb(var(--loss))'
                  // recharts passes negative heights as negative numbers
                  const rectY = value >= 0 ? y : y + height
                  const rectH = Math.abs(height)
                  return <rect x={x} y={rectY} width={width} height={Math.max(rectH, 1)} fill={color} rx={2} />
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-holding breakdown table */}
      {!loading && stats && portfolio.length > 0 && (
        <div className="bg-surface-card border border-border rounded-xl p-5">
          <h2 className="text-primary text-sm font-semibold mb-4">Holdings at a Glance</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs border-b border-border">
                <th className="text-left pb-2">Symbol</th>
                <th className="text-right pb-2">Shares</th>
                <th className="text-right pb-2">Avg Cost</th>
                <th className="text-right pb-2">Current Value</th>
                <th className="text-right pb-2">Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {portfolio.map(h => {
                const cost  = (h.shares ?? 0) * (h.avgCost ?? 0)
                const value = h.value ?? 0
                const ret   = value - cost
                const retPct = cost > 0 ? (ret / cost) * 100 : 0
                return (
                  <tr key={h.symbol} className="text-primary">
                    <td className="py-2.5 font-semibold text-accent-blue">{h.symbol}</td>
                    <td className="py-2.5 text-right text-secondary">{h.shares}</td>
                    <td className="py-2.5 text-right text-secondary">{fmt(h.avgCost)}</td>
                    <td className="py-2.5 text-right">{fmt(value)}</td>
                    <td className={clsx('py-2.5 text-right font-medium', ret >= 0 ? 'text-gain' : 'text-loss')}>
                      {fmtPct(retPct)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      </>)} {/* end performance tab */}

      {/* ── TRADES TAB ──────────────────────────────────────────────── */}
      {activeTab === 'trades' && (
        <div className="space-y-4">

          {tradesError && (
            <div className="flex items-center gap-3 bg-loss/10 border border-loss/20 text-loss/80 rounded-xl px-4 py-3 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              <span>{tradesError}</span>
            </div>
          )}

          {tradesLoading && (
            <div className="h-40 bg-surface-card border border-border rounded-xl flex items-center justify-center gap-3">
              <RefreshCw size={18} className="text-accent-blue animate-spin" />
              <span className="text-muted text-sm">Loading trades…</span>
            </div>
          )}

          {!tradesLoading && !tradesError && trades.length === 0 && (
            <div className="bg-surface-card border border-border rounded-xl p-10 flex flex-col items-center gap-3 text-center">
              <BarChart2 size={36} className="text-muted" />
              <p className="text-primary font-medium">No trades yet</p>
              <p className="text-muted text-sm">
                Trades you make via the Portfolio page or the AI Agent will appear here.
              </p>
            </div>
          )}

          {!tradesLoading && trades.length > 0 && (
            <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
              {/* Summary bar */}
              <div className="flex items-center gap-6 px-5 py-3 border-b border-border bg-surface-hover/40">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <ArrowUpCircle size={13} className="text-gain" />
                  <span className="font-medium text-primary">
                    {trades.filter(t => t.side === 'buy').length}
                  </span>
                  buys
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <ArrowDownCircle size={13} className="text-loss" />
                  <span className="font-medium text-primary">
                    {trades.filter(t => t.side === 'sell').length}
                  </span>
                  sells
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <Bot size={13} className="text-accent-purple" />
                  <span className="font-medium text-primary">
                    {trades.filter(t => t.source === 'agent').length}
                  </span>
                  via AI agent
                </div>
                <div className="ml-auto text-xs text-muted">
                  Showing last {trades.length} trades
                </div>
              </div>

              {/* Trade rows */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted text-xs border-b border-border">
                      <th className="text-left px-5 py-2.5">Date &amp; Time</th>
                      <th className="text-left px-3 py-2.5">Symbol</th>
                      <th className="text-left px-3 py-2.5">Side</th>
                      <th className="text-right px-3 py-2.5">Shares</th>
                      <th className="text-right px-3 py-2.5">Price</th>
                      <th className="text-right px-5 py-2.5">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {trades.map(t => {
                      const dt = new Date(t.executed_at)
                      const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                      const isBuy = t.side === 'buy'
                      return (
                        <tr key={t.id} className="hover:bg-surface-hover/40 transition-colors">
                          <td className="px-5 py-3">
                            <p className="text-primary text-xs">{dateStr}</p>
                            <p className="text-muted text-[10px]">{timeStr}</p>
                          </td>
                          <td className="px-3 py-3">
                            <span className="font-semibold text-accent-blue font-mono">{t.symbol}</span>
                            {t.source === 'agent' && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded bg-accent-purple/15 text-accent-purple">
                                <Bot size={8} /> AI
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className={clsx(
                              'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
                              isBuy
                                ? 'bg-gain/15 text-gain'
                                : 'bg-loss/15 text-loss'
                            )}>
                              {isBuy
                                ? <ArrowUpCircle size={11} />
                                : <ArrowDownCircle size={11} />}
                              {isBuy ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-secondary font-mono text-xs">
                            {parseFloat(t.shares).toLocaleString('en-US', { maximumFractionDigits: 6 })}
                          </td>
                          <td className="px-3 py-3 text-right text-secondary text-xs font-mono">
                            ${parseFloat(t.price).toFixed(2)}
                          </td>
                          <td className={clsx(
                            'px-5 py-3 text-right font-semibold text-xs font-mono',
                            isBuy ? 'text-loss' : 'text-gain'
                          )}>
                            {isBuy ? '−' : '+'}{fmt(parseFloat(t.total))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
