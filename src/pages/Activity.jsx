/**
 * Activity.jsx
 * Two views:
 *  • My Activity  — personal audit trail (own actions)
 *  • Class        — all classmates' trading activity, grouped by class
 */

import { useState, useEffect, useCallback } from 'react'
import { Activity as ActivityIcon, RefreshCw, Filter, LogIn, TrendingUp,
         TrendingDown, Eye, Star, ShieldAlert, Clock, Users } from 'lucide-react'
import { fetchMyClasses, fetchClassActivity } from '../services/apiService'
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

async function apiFetch(path) {
  const token = localStorage.getItem('tradebuddy_token')
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Shared UI pieces ─────────────────────────────────────────────
function ActionBadge({ action }) {
  const meta = ACTION_META[action] ?? { label: action, color: 'text-muted bg-surface-hover border-border' }
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap', meta.color)}>
      {meta.label}
    </span>
  )
}

function SkeletonFeed() {
  return (
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
  )
}

// ── Personal activity timeline ───────────────────────────────────
function TimelineEntry({ entry, showDate, isLast, showUser = false }) {
  const [hover, setHover] = useState(false)
  const meta    = ACTION_META[entry.action] ?? { Icon: Clock, color: 'text-muted bg-surface-hover border-border' }
  const details = formatDetails(entry.action, entry.details)

  return (
    <div className="flex gap-3 group">
      <div className="flex flex-col items-center">
        <div className={clsx(
          'w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
          meta.color, 'border-current'
        )}>
          <meta.Icon size={12} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border/50 mt-1" />}
      </div>

      <div className="flex-1 pb-5 min-w-0"
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
            {/* Student info when in class view */}
            {showUser && entry.user_name && (
              <div className="flex items-center gap-1.5 mb-1.5">
                {entry.avatar_url
                  ? <img src={entry.avatar_url} className="w-5 h-5 rounded-full object-cover" referrerPolicy="no-referrer" alt="" />
                  : <div className="w-5 h-5 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-[10px] font-bold">
                      {(entry.user_name)[0].toUpperCase()}
                    </div>
                }
                <span className="text-secondary text-xs font-medium">{entry.user_name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <ActionBadge action={entry.action} />
              {details && <span className="text-secondary text-xs">{details}</span>}
            </div>
            {entry.ip && hover && !showUser && (
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

// ── My Activity tab ──────────────────────────────────────────────
const PAGE_SIZE = 50

function MyActivityTab() {
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [offset,   setOffset]   = useState(0)
  const [hasMore,  setHasMore]  = useState(true)
  const [filter,   setFilter]   = useState('all')
  const [error,    setError]    = useState(null)

  const load = useCallback(async (reset = false) => {
    setLoading(true); setError(null)
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

  useEffect(() => { load(true) }, []) // eslint-disable-line

  const filtered = filter === 'all'
    ? entries
    : entries.filter(e => ACTION_GROUPS[filter]?.includes(e.action))

  const withDateSep = filtered.map((e, i) => {
    const prev = filtered[i - 1]
    const thisDay = new Date(e.created_at).toDateString()
    const prevDay = prev ? new Date(prev.created_at).toDateString() : null
    return { ...e, showDate: thisDay !== prevDay }
  })

  return (
    <div className="space-y-6">
      {entries.length > 0 && <SummaryStrip entries={entries} />}

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter size={12} className="text-faint mr-1" />
        {['all', ...Object.keys(ACTION_GROUPS)].map(g => (
          <button key={g} onClick={() => setFilter(g)}
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

      {error && (
        <div className="text-loss/80 bg-loss/10 border border-loss/20 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-16 text-muted">
          <ActivityIcon size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No activity yet</p>
        </div>
      )}

      {withDateSep.length > 0 && (
        <div className="pt-2">
          {withDateSep.map((e, i) => (
            <TimelineEntry key={e.id} entry={e} showDate={e.showDate} isLast={i === withDateSep.length - 1} />
          ))}
        </div>
      )}

      {loading && entries.length > 0 && (
        <div className="text-center py-4"><RefreshCw size={16} className="animate-spin text-accent-blue mx-auto" /></div>
      )}
      {loading && entries.length === 0 && <SkeletonFeed />}

      {hasMore && !loading && (
        <div className="text-center">
          <button onClick={() => load(false)}
            className="text-xs text-accent-blue/70 hover:text-accent-blue border border-accent-blue/20 hover:border-accent-blue/40 px-4 py-2 rounded-lg transition-colors">
            Load more
          </button>
        </div>
      )}

      {!hasMore && entries.length > 0 && (
        <p className="text-center text-faint text-xs py-2">All {entries.length} events loaded</p>
      )}
    </div>
  )
}

// ── Class Activity tab ───────────────────────────────────────────
function ClassActivityTab() {
  const [classes,  setClasses]  = useState([])
  const [classId,  setClassId]  = useState(null)
  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [clsLoading, setClsLoading] = useState(true)
  const [hasMore,  setHasMore]  = useState(true)
  const [offset,   setOffset]   = useState(0)
  const [error,    setError]    = useState(null)
  const [groupBy,  setGroupBy]  = useState('time') // 'time' | 'student'

  // Load classes the user belongs to (or teaches)
  useEffect(() => {
    fetchMyClasses()
      .then(cls => {
        setClasses(cls)
        if (cls.length) setClassId(cls[0].class_id ?? cls[0].id)
      })
      .catch(() => {})
      .finally(() => setClsLoading(false))
  }, [])

  const load = useCallback(async (reset = false) => {
    if (!classId) return
    setLoading(true); setError(null)
    try {
      const off  = reset ? 0 : offset
      const data = await fetchClassActivity(classId, { limit: 100, offset: off })
      setEntries(prev => reset ? data : [...prev, ...data])
      setOffset(off + data.length)
      setHasMore(data.length === 100)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [classId, offset])

  useEffect(() => {
    if (classId) { setEntries([]); setOffset(0); setHasMore(true); load(true) }
  }, [classId]) // eslint-disable-line

  if (clsLoading) return <SkeletonFeed />

  if (!classId) return (
    <div className="text-center py-16 space-y-2">
      <Users size={40} className="text-muted mx-auto" />
      <p className="text-primary font-medium">You're not in a class yet</p>
      <p className="text-muted text-sm">Join a class to see classmates' activity.</p>
    </div>
  )

  // Group by student
  const byStudent = entries.reduce((acc, e) => {
    const key = e.user_id
    if (!acc[key]) acc[key] = { user_name: e.user_name, avatar_url: e.avatar_url, entries: [] }
    acc[key].entries.push(e)
    return acc
  }, {})

  // Add date separators for time view
  const withDateSep = entries.map((e, i) => {
    const prev    = entries[i - 1]
    const thisDay = new Date(e.created_at).toDateString()
    const prevDay = prev ? new Date(prev.created_at).toDateString() : null
    return { ...e, showDate: thisDay !== prevDay }
  })

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {classes.length > 1 && (
          <select
            value={classId ?? ''}
            onChange={e => setClassId(Number(e.target.value))}
            className="bg-surface-hover border border-border rounded-lg px-3 py-1.5 text-primary text-sm focus:outline-none focus:border-accent-blue">
            {classes.map(c => (
              <option key={c.class_id ?? c.id} value={c.class_id ?? c.id}>{c.name}</option>
            ))}
          </select>
        )}

        {/* Group-by toggle */}
        <div className="flex gap-1 bg-surface-hover border border-border rounded-lg p-1 ml-auto">
          <button onClick={() => setGroupBy('time')}
            className={clsx('px-3 py-1 rounded-md text-xs font-medium transition-colors',
              groupBy === 'time' ? 'bg-surface-card text-primary shadow-sm' : 'text-muted hover:text-primary')}>
            Timeline
          </button>
          <button onClick={() => setGroupBy('student')}
            className={clsx('px-3 py-1 rounded-md text-xs font-medium transition-colors',
              groupBy === 'student' ? 'bg-surface-card text-primary shadow-sm' : 'text-muted hover:text-primary')}>
            By Student
          </button>
        </div>
      </div>

      {error && (
        <div className="text-loss/80 bg-loss/10 border border-loss/20 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {loading && entries.length === 0 && <SkeletonFeed />}

      {!loading && entries.length === 0 && !error && (
        <div className="text-center py-16 text-muted">
          <ActivityIcon size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No trading activity in this class yet</p>
        </div>
      )}

      {/* Timeline view */}
      {groupBy === 'time' && withDateSep.length > 0 && (
        <div className="pt-2">
          {withDateSep.map((e, i) => (
            <TimelineEntry key={e.id} entry={e} showDate={e.showDate}
              isLast={i === withDateSep.length - 1} showUser />
          ))}
        </div>
      )}

      {/* By-student view */}
      {groupBy === 'student' && Object.keys(byStudent).length > 0 && (
        <div className="space-y-4">
          {Object.entries(byStudent).map(([uid, student]) => (
            <div key={uid} className="bg-surface-card border border-border rounded-xl overflow-hidden">
              {/* Student header */}
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-surface/50">
                {student.avatar_url
                  ? <img src={student.avatar_url} className="w-7 h-7 rounded-full object-cover" referrerPolicy="no-referrer" alt="" />
                  : <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-xs font-bold">
                      {(student.user_name || '?')[0].toUpperCase()}
                    </div>
                }
                <span className="text-primary text-sm font-medium">{student.user_name}</span>
                <span className="text-muted text-xs ml-auto">{student.entries.length} actions</span>
              </div>
              {/* Student's entries */}
              <div className="px-4 pt-3">
                {student.entries.map((e, i) => (
                  <TimelineEntry key={e.id} entry={e} showDate={false}
                    isLast={i === student.entries.length - 1} showUser={false} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && entries.length > 0 && (
        <div className="text-center">
          <button onClick={() => load(false)}
            className="text-xs text-accent-blue/70 hover:text-accent-blue border border-accent-blue/20 hover:border-accent-blue/40 px-4 py-2 rounded-lg transition-colors">
            Load more
          </button>
        </div>
      )}
      {loading && entries.length > 0 && (
        <div className="text-center py-4"><RefreshCw size={16} className="animate-spin text-accent-blue mx-auto" /></div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────
export default function Activity() {
  const [tab, setTab] = useState('personal')

  const TABS = [
    { key: 'personal', label: 'My Activity', Icon: ActivityIcon },
    { key: 'class',    label: 'Class',        Icon: Users        },
  ]

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-primary font-semibold text-xl">Activity</h1>
          <p className="text-muted text-sm mt-0.5">
            {tab === 'personal' ? 'Your personal audit trail' : 'Trading activity across your class'}
          </p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 bg-surface-hover border border-border rounded-lg p-1 w-fit">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === key ? 'bg-surface-card text-primary shadow-sm' : 'text-muted hover:text-primary'
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'personal' && <MyActivityTab />}
      {tab === 'class'    && <ClassActivityTab />}
    </div>
  )
}
