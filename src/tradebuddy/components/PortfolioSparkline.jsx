/**
 * PortfolioSparkline.jsx
 * Compact sidebar widget showing portfolio value history as a sparkline.
 *
 * - Fetches the last 30 days of DB snapshots
 * - Falls back gracefully if no snapshots exist yet
 * - Clicking the card navigates to the History page
 */

import { useState, useEffect } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useApp, ACTIONS } from '../context/AppContext'
import { getPortfolioSnapshots } from '../../common/services/apiService'
import clsx from 'clsx'

// ── Helpers ────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function today() {
  return new Date().toISOString().split('T')[0]
}

const fmt = (n) =>
  n == null
    ? '—'
    : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const fmtPct = (n) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`

// ── Tiny custom tooltip ────────────────────────────────────────
function SparkTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-surface-card border border-border rounded-lg px-2.5 py-1.5 shadow-lg text-[10px]">
      <p className="text-muted">{d?.date}</p>
      <p className="text-primary font-semibold">{fmt(d?.value)}</p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function PortfolioSparkline() {
  const { state, dispatch } = useApp()
  const dbReady = state.dbReady ?? false

  const [points,  setPoints]  = useState([])   // [{ date, value }]
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!dbReady) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const snaps = await getPortfolioSnapshots(daysAgo(30), today())
        if (!cancelled && snaps?.length) {
          setPoints(snaps.map(s => ({ date: s.date, value: Number(s.total_value) })))
        }
      } catch (_) {
        // silently skip — widget is non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [dbReady])

  // ── Derived stats ────────────────────────────────────────────
  const current  = points.length ? points[points.length - 1].value : null
  const start    = points.length ? points[0].value : null
  const change   = current != null && start != null ? current - start : null
  const changePct = start != null && start > 0 ? (change / start) * 100 : null
  const isUp     = change != null && change > 0
  const isDown   = change != null && change < 0

  // Chart colour based on trend
  const strokeColor = isUp
    ? 'rgb(var(--gain))'
    : isDown
    ? 'rgb(var(--loss))'
    : 'rgb(var(--accent-blue))'

  const gradId = isUp ? 'sparkGain' : isDown ? 'sparkLoss' : 'sparkNeutral'
  const gradColor = strokeColor

  const handleClick = () => {
    dispatch({ type: ACTIONS.NAVIGATE, payload: 'history' })
  }

  // Don't show widget at all until we have data or it's done loading
  if (!loading && points.length === 0) {
    return (
      <div className="mx-3 mb-3 px-3 py-3 rounded-xl border border-border bg-surface-hover">
        <p className="text-[10px] text-muted leading-snug text-center">
          No snapshot data yet.<br />
          <button
            onClick={handleClick}
            className="text-accent-blue hover:underline"
          >
            Visit History
          </button>
          {' '}to record one.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mx-3 mb-3 px-3 py-3 rounded-xl border border-border bg-surface-hover animate-pulse">
        <div className="h-2 bg-border rounded w-2/3 mb-2" />
        <div className="h-10 bg-border rounded" />
      </div>
    )
  }

  return (
    <button
      onClick={handleClick}
      title="View full history"
      className="mx-3 mb-3 px-3 pt-2.5 pb-1 rounded-xl border border-border bg-surface-hover hover:bg-surface-card hover:border-accent-blue/30 transition-colors w-[calc(100%-1.5rem)] text-left group"
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-[10px] text-muted font-medium uppercase tracking-wide">
            Portfolio · 30d
          </p>
          <p className="text-sm font-semibold text-primary mt-0.5 tabular-nums">
            {fmt(current)}
          </p>
        </div>

        {/* Change badge */}
        <div className={clsx(
          'flex items-center gap-0.5 text-[10px] font-semibold mt-0.5 px-1.5 py-0.5 rounded-full',
          isUp   && 'text-gain  bg-gain/10',
          isDown && 'text-loss  bg-loss/10',
          !isUp && !isDown && 'text-muted bg-border/30',
        )}>
          {isUp   && <TrendingUp  size={9} />}
          {isDown && <TrendingDown size={9} />}
          {!isUp && !isDown && <Minus size={9} />}
          {changePct != null ? fmtPct(changePct) : '—'}
        </div>
      </div>

      {/* Sparkline */}
      <ResponsiveContainer width="100%" height={52}>
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={gradColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={gradColor} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <Tooltip content={<SparkTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: strokeColor }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Footer hint */}
      <p className="text-[9px] text-muted/50 text-right mt-0.5 group-hover:text-muted transition-colors">
        click to expand →
      </p>
    </button>
  )
}
