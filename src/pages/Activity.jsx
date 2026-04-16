/**
 * Activity.jsx
 * Personal activity feed — available to every logged-in user.
 *
 * Fetches the current user's own audit entries from GET /api/audit
 * and displays them as a filterable timeline with action badges,
 * a summary row, and infinite-scroll style "load more".
 */

import { useState, useEffect, useCallback } from 'react'
import { Activity as ActivityIcon, RefreshCw, Filter, LogIn, TrendingUp,
         TrendingDown, Eye, Star, ShieldAlert, Clock } from 'lucide-react'
import clsx from 'clsx'

// ── Action metadata ──────────────────────────────────────────────
const ACTION_META = {
  login:            { label: 'Login',           color: 'text-accent-blue bg-accent-blue/10 border-accent-blue/20',  Icon: LogIn        },
  logout:           { label: 'Logout',          color: 'text-muted bg-surface-hover border-border',                 Icon: LogIn        },
  signup:           { label: 'Signed Up',       color: 'text-green-400 bg-green-400/10 border-green-400/20',        Icon: LogIn        },
  buy:              { label: 'Buy',             color: 'text-gain bg-gain/10 border-gain/20',                       Icon: TrendingUp   },
  add_holding:      { label: 'Add Holding',     color: 'text-gain bg-gain/10 border-gain/20',                       Icon: TrendingUp   },
  sell:             { label: 'Sell',            color: 'text-loss bg-loss/10 border-loss/20',                       Icon: TrendingDown },
  remove_holding:   { label: 'Remove Holding',  color: 'text-muted bg-surface-hover border-border',                 Icon: TrendingDown },
  add_watchlist:    { label: 'Watch +',         color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',     Icon: Star         },
  remove_watchlist: { label: 'Watch −',         color: 'text-muted bg-surface-hover border-border',                 Icon: Star         },
  agent_buy:        { label: 'Agent Buy',       color: 'text-gain bg-gain/10 border-gain/20',                       Icon: TrendingUp   },
  agent_sell:       { label: 'Agent Sell',      color: 'text-loss bg-loss/10 border-loss/20',                       Icon: TrendingDown },
  agent_remove:     { label: 'Agent Remove',    color: 'text-muted bg-surface-hover border-border',                 Icon: TrendingDown },
  role_changed:     { label: 'Role Changed',    color: 'text-orange-400 bg-orange-400/10 border-orange-400/20',     Icon: ShieldAlert  },
  account_disabled: { label: 'Acct Disabled',  color: 'text-loss bg-loss/10 border-loss/20',                       Icon: ShieldAlert  },
  account_enabled:  { label: 'Acct Enabled',   color: 'text-gain bg-gain/10 border-gain/20',                       Icon: ShieldAlert  },
}

const ACTION_GROUPS = {
  'Trades':    ['buy', 'sell', 'add_holding', 'remove_holding', 'agent_buy', 'agent_sell', 'agent_remove'],
  'Watchlist': ['add_watchlist', 'remove_watchlist'],
  'Auth':      ['login', 'logout', 'signup'],
  'Admin':     ['role_changed', 'account_disabled', 'account_enabled'],
}

// ── Helpers ──────────────────────────────────────────────────────
function formatDetails(action, details) {
  if (!details) return null
  try {
    const d = typeof details === 'string' ? JSON.parse(details) : details
    if (action === 'login'  || action === 'signup') return `via ${d.method}`
    if (action === 'buy'    || action === 'add_holding')
      return `${d.symbol} · ${d.shares} shares @ $${Number(d.avgCost ?? 0).toFixed(2)}`
    if (action === 'sell')             return `${d.symbol} · ${d.shares} shares`
    if (action === 'remove_holding')   return d.symbol
    if (action === 'add_watchlist' || action === 'remove_watchlist') return d.symbol
    if (action.startsWith('agent_'))   return d.command ?? `${d.symbol ?? ''}`
    if (action === 'role_changed')     return `role changed: ${d.from} → ${d.to}`
    return null
  } catch { return null }
}

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  <  1) return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  <  7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fullTime(dateStr) {
  return new Date(dateStr).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Auth fetch helper ────────────────────────────────────────────
async function apiFetch(path) {
  const token = localStorage.getItem('tradebuddy_token')
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Action badge ─────────────────────────────────────────────────
function ActionBadge({ action }) {
  const meta = ACTION_META[action] ?? { label: action, color: 'text-muted bg-surface-hover border-border' }
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap', meta.color)}>
      {meta.label}
    </span>
  )
}

// ── Summary strip ────────────────────────────────────────────────
function SummaryStrip({ entries }) {
  const trades   = entries.filter(e => ['buy','sell','add_holding','agent_buy','agent_sell'].includes(e.action)).length
  const logins   = entries.filter(e => e.action === 'login').length
  const watchOps = entries.filter(e => e.action === 'add_watchlist').length
  const agentOps = entries.filter(e => e.action.startsWith('agent_')).length

  const stats = [
    { label: 'Total Events',   value: entries.length, icon: <ActivityIcon size={14} className="text-accent-blue" /> },
    { label: 'Trades',         value: trades,          icon: <TrendingUp   size={14} className="text-gain" />        },
    { label: 'Logins',         value: logins,          icon: <LogIn        size={14} className="text-accent-blue" /> },
    { label: 'Watchlist Adds', value: watchOps,        icon: <Star         size={14} className="text-yellow-400" />  },
    { label: 'Agent Actions',  value: agentOps,        icon: <Eye          size={14} className="text-accent-purple" /> },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map(s => (
        <div key={s.label} className="bg-surface-card border border-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">{s.icon}
            <span className="text-muted text-xs">{s.label}</span>
          </div>
          <p className="text-primary font-semibold text-lg">{s.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Timeline entry ───────────────────────────────────────────────
function TimelineEntry({ entry, showDate, isLast }) {
  const [hover, setHover] = useState(false)
  const meta    = ACTION_META[entry.action] ?? { Icon: Clock, color: 'text-muted bg-surface-hover border-border' }
  const details = formatDetails(entry.action, entry.details)

  return (
    <div className="flex gap-3 group">
      {/* Vertical line + dot */}
      <div className="flex flex-col items-center">
        <div className={clsx(
          'w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
          meta.color,
          'border-current'
        )}>
          <meta.Icon size={12} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border/50 mt-1" />}
      </div>

      {/* Content */}
      <div
        className={clsx(
          'flex-1 pb-5 min-w-0 rounded-xl transition-colors cursor-default',
        )}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {showDate && (
          <p className="text-faint text-xs mb-2 uppercase tracking-wider font-medium">
            {new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ActionBadge action={entry.action} />
              {details && (
                <span className="text-secondary text-xs">{details}</span>
              )}
            </div>
            {entry.ip && hover && (
              <p className="text-faint text-xs mt-1 font-mono">IP: {entry.ip}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-muted text-xs whitespace-nowrap" title={fullTime(entry.created_at)}>
              {relativeTime(entry.created_at)}
            </p>
            <p className="text-faint text-xs mt-0.5 hidden sm:block">
              {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────
const PAGE_SIZE = 50

export default function Activity() {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [offset,   setOffset]   = useState(0)
  const [hasMore,  setHasMore]  = useState(true)
  const [filter,   setFilter]   = useState('all')   // 'all' | group key
  const [error,    setError]    = useState(null)

  const load = useCallback(async (reset = false) => {
    setLoading(true)
    setError(null)
    try {
      const off  = reset ? 0 : offset
      const data = await apiFetch(`/audit?limit=${PAGE_SIZE}&offset=${off}`)
      setEntries(prev => reset ? data : [...prev, ...data])
      setOffset(off + data.length)
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [offset])

  useEffect(() => { load(true) }, [])   // eslint-disable-line

  const handleRefresh = () => {
    setOffset(0)
    setHasMore(true)
    load(true)
  }

  // Filter entries by group
  const filtered = filter === 'all'
    ? entries
    : entries.filter(e => ACTION_GROUPS[filter]?.includes(e.action))

  // Group consecutive entries by calendar date for date separators
  const withDateSep = filtered.map((e, i) => {
    const prev = filtered[i - 1]
    const thisDay = new Date(e.created_at).toDateString()
    const prevDay = prev ? new Date(prev.created_at).toDateString() : null
    return { ...e, showDate: thisDay !== prevDay }
  })

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-primary font-semibold text-xl">My Activity</h1>
          <p className="text-muted text-sm mt-0.5">Your personal audit trail</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-muted hover:text-primary text-xs transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      {entries.length > 0 && <SummaryStrip entries={entries} />}

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter size={12} className="text-faint mr-1" />
        {['all', ...Object.keys(ACTION_GROUPS)].map(g => (
          <button
            key={g}
            onClick={() => setFilter(g)}
            className={clsx(
              'text-xs px-3 py-1 rounded-full border transition-colors capitalize',
              filter === g
                ? 'text-primary border-border bg-surface-hover'
                : 'text-muted border-border/50 hover:text-primary hover:border-border'
            )}
          >
            {g === 'all' ? `All (${entries.length})` : g}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="text-loss/80 bg-loss/10 border border-loss/20 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-16 text-muted">
          <ActivityIcon size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No activity yet</p>
        </div>
      )}

      {/* Timeline */}
      {withDateSep.length > 0 && (
        <div className="pt-2">
          {withDateSep.map((e, i) => (
            <TimelineEntry
              key={e.id}
              entry={e}
              showDate={e.showDate}
              isLast={i === withDateSep.length - 1}
            />
          ))}
        </div>
      )}

      {/* Load more / loading indicator */}
      {loading && entries.length > 0 && (
        <div className="text-center py-4">
          <RefreshCw size={16} className="animate-spin text-accent-blue mx-auto" />
        </div>
      )}
      {loading && entries.length === 0 && (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-7 h-7 rounded-full bg-surface-hover shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 bg-surface-hover rounded w-1/3" />
                <div className="h-2 bg-surface-hover rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="text-center">
          <button
            onClick={() => load(false)}
            className="text-xs text-accent-blue/70 hover:text-accent-blue border border-accent-blue/20 hover:border-accent-blue/40 px-4 py-2 rounded-lg transition-colors"
          >
            Load more
          </button>
        </div>
      )}

      {!hasMore && entries.length > 0 && (
        <p className="text-center text-faint text-xs py-2">
          All {entries.length} events loaded
        </p>
      )}
    </div>
  )
}
