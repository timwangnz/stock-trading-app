/**
 * Groups.jsx
 * Peer-created study groups — open to any user.
 * Anyone can create a group or join one via a short code (e.g. BULL-7X3K).
 * Groups have their own leaderboard and activity feed.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Plus, Copy, Check, Loader2, AlertCircle,
  TrendingUp, TrendingDown, Trophy, Activity, ArrowLeft,
  LogIn,
} from 'lucide-react'
import {
  createGroup, fetchMyGroups, joinGroupByCode,
  fetchGroupLeaderboard, fetchGroupActivity,
} from '../services/apiService'
import { useApp } from '../context/AppContext'
import clsx from 'clsx'

// ── Helpers ──────────────────────────────────────────────────────
const fmtPct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`
const fmt    = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

function relativeTime(dateStr) {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  <  1) return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  <  7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDetails(action, details) {
  if (!details) return null
  try {
    const d = typeof details === 'string' ? JSON.parse(details) : details
    if (action === 'buy' || action === 'add_holding')
      return `${d.symbol} · ${d.shares} shares @ $${Number(d.avgCost ?? 0).toFixed(2)}`
    if (action === 'sell')           return `${d.symbol} · ${d.shares} shares`
    if (action === 'remove_holding') return d.symbol
    if (action === 'add_watchlist' || action === 'remove_watchlist') return d.symbol
    if (action.startsWith('agent_')) return d.command ?? d.symbol ?? ''
    return null
  } catch { return null }
}

const ACTION_COLOR = {
  buy:              'text-gain',
  add_holding:      'text-gain',
  agent_buy:        'text-gain',
  sell:             'text-loss',
  remove_holding:   'text-muted',
  agent_sell:       'text-loss',
  agent_remove:     'text-muted',
  add_watchlist:    'text-yellow-400',
  remove_watchlist: 'text-muted',
}
const ACTION_LABEL = {
  buy: 'Buy', add_holding: 'Add', agent_buy: 'Agent Buy',
  sell: 'Sell', remove_holding: 'Remove', agent_sell: 'Agent Sell', agent_remove: 'Agent Remove',
  add_watchlist: 'Watch +', remove_watchlist: 'Watch −',
}

// ── Copy-code button ─────────────────────────────────────────────
function CopyCode({ code }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 font-mono text-sm text-accent-blue bg-accent-blue/10 border border-accent-blue/20 hover:bg-accent-blue/20 px-3 py-1.5 rounded-lg transition-colors">
      <span className="font-bold tracking-wider">{code}</span>
      {copied ? <Check size={12} className="text-gain" /> : <Copy size={12} />}
    </button>
  )
}

// ── Create group modal ────────────────────────────────────────────
function CreateGroupModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', start_balance: '100000' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Group name is required')
    setSaving(true); setError(null)
    try {
      const group = await createGroup({ ...form, start_balance: parseFloat(form.start_balance) })
      onCreated(group)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-primary font-semibold text-lg flex items-center gap-2">
          <Users size={18} className="text-accent-blue" /> Create a Group
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-muted text-xs mb-1 block">Group Name *</label>
            <input className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              placeholder="e.g. YOLO Squad, Tech Bulls, Econ Study Group"
              value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="text-muted text-xs mb-1 block">Description (optional)</label>
            <input className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              placeholder="What's this group about?"
              value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label className="text-muted text-xs mb-1 block">Starting Balance ($)</label>
            <input type="number" className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              value={form.start_balance} onChange={e => set('start_balance', e.target.value)} />
          </div>
          {error && <p className="text-loss text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-border text-secondary text-sm hover:bg-surface-hover">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Create Group
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Join by code modal ────────────────────────────────────────────
function JoinGroupModal({ onClose, onJoined }) {
  const [code,    setCode]    = useState('')
  const [joining, setJoining] = useState(false)
  const [error,   setError]   = useState(null)

  const handleJoin = async () => {
    if (!code.trim()) return setError('Enter a group code')
    setJoining(true); setError(null)
    try {
      const result = await joinGroupByCode(code)
      onJoined(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-primary font-semibold text-lg flex items-center gap-2">
          <LogIn size={18} className="text-accent-blue" /> Join a Group
        </h2>
        <p className="text-muted text-sm">Enter the group code shared by your friend (e.g. BULL-7X3K).</p>
        <input
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm font-mono uppercase focus:outline-none focus:border-accent-blue tracking-widest"
          placeholder="BULL-7X3K"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
        />
        {error && <p className="text-loss text-xs">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-secondary text-sm hover:bg-surface-hover">Cancel</button>
          <button onClick={handleJoin} disabled={joining}
            className="flex-1 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
            {joining ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
            Join
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Group detail view ─────────────────────────────────────────────
function GroupDetail({ group, currentUserId, onBack }) {
  const [tab,      setTab]      = useState('leaderboard')
  const [rows,     setRows]     = useState([])
  const [activity, setActivity] = useState([])
  const [loading,  setLoading]  = useState(false)

  const loadLeaderboard = useCallback(async () => {
    setLoading(true)
    try { setRows(await fetchGroupLeaderboard(group.id)) }
    catch (_) {}
    finally { setLoading(false) }
  }, [group.id])

  const loadActivity = useCallback(async () => {
    setLoading(true)
    try { setActivity(await fetchGroupActivity(group.id)) }
    catch (_) {}
    finally { setLoading(false) }
  }, [group.id])

  useEffect(() => {
    if (tab === 'leaderboard') loadLeaderboard()
    else loadActivity()
  }, [tab, loadLeaderboard, loadActivity])

  const TABS = [
    { key: 'leaderboard', label: 'Leaderboard', Icon: Trophy    },
    { key: 'activity',    label: 'Activity',     Icon: Activity  },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="text-muted hover:text-primary transition-colors mt-0.5">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-primary font-semibold text-xl">{group.name}</h2>
            <CopyCode code={group.join_code} />
          </div>
          {group.description && <p className="text-muted text-sm mt-1">{group.description}</p>}
          <p className="text-muted text-xs mt-1">
            {group.member_count} member{group.member_count !== 1 ? 's' : ''} ·
            Created by {group.creator_name} ·
            Starting balance {fmt(group.start_balance)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-hover border border-border rounded-lg p-1 w-fit">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx('flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === key ? 'bg-surface-card text-primary shadow-sm' : 'text-muted hover:text-primary')}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted" /></div>}

      {/* Leaderboard */}
      {!loading && tab === 'leaderboard' && (
        rows.length === 0
          ? <p className="text-muted text-sm text-center py-8">No rankings yet — start trading!</p>
          : <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-xs">
                    <th className="text-center px-4 py-3 w-12">Rank</th>
                    <th className="text-left px-4 py-3">Member</th>
                    <th className="text-right px-4 py-3">Return</th>
                    <th className="text-right px-4 py-3 hidden sm:table-cell">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(r => {
                    const isMe = r.user_id === currentUserId
                    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : null
                    return (
                      <tr key={r.user_id} className={clsx('transition-colors',
                        isMe ? 'bg-accent-blue/5 border-l-2 border-l-accent-blue' : 'hover:bg-surface-hover')}>
                        <td className="px-4 py-3 text-center">
                          {medal
                            ? <span className="text-lg">{medal}</span>
                            : <span className="text-muted text-xs font-mono">{r.rank}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {r.avatar_url
                              ? <img src={r.avatar_url} className="w-6 h-6 rounded-full object-cover" referrerPolicy="no-referrer" alt="" />
                              : <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-[10px] font-bold">
                                  {(r.name || '?')[0].toUpperCase()}
                                </div>
                            }
                            <span className={clsx('font-medium', isMe ? 'text-accent-blue' : 'text-primary')}>
                              {r.name} {isMe && <span className="text-xs text-muted font-normal">(you)</span>}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={clsx('font-semibold', r.return_pct >= 0 ? 'text-gain' : 'text-loss')}>
                            {fmtPct(r.return_pct)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-secondary hidden sm:table-cell">
                          {fmt(r.current_value)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
      )}

      {/* Activity feed */}
      {!loading && tab === 'activity' && (
        activity.length === 0
          ? <p className="text-muted text-sm text-center py-8">No activity yet — make some trades!</p>
          : <div className="space-y-2">
              {activity.map(e => {
                const details = formatDetails(e.action, e.details)
                const color   = ACTION_COLOR[e.action] ?? 'text-muted'
                const label   = ACTION_LABEL[e.action] ?? e.action
                return (
                  <div key={e.id} className="flex items-center gap-3 bg-surface-card border border-border rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {e.avatar_url
                        ? <img src={e.avatar_url} className="w-6 h-6 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" alt="" />
                        : <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-[10px] font-bold shrink-0">
                            {(e.user_name || '?')[0].toUpperCase()}
                          </div>
                      }
                      <span className="text-secondary text-xs font-medium truncate">{e.user_name}</span>
                      <span className={clsx('text-xs font-semibold px-1.5 py-0.5 rounded', color)}>{label}</span>
                      {details && <span className="text-muted text-xs truncate">{details}</span>}
                    </div>
                    <span className="text-faint text-xs shrink-0">{relativeTime(e.created_at)}</span>
                  </div>
                )
              })}
            </div>
      )}
    </div>
  )
}

// ── Group card ────────────────────────────────────────────────────
function GroupCard({ group, onSelect }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-3 hover:border-accent-blue/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-primary font-semibold truncate">{group.name}</h3>
          {group.description && <p className="text-muted text-xs mt-0.5 truncate">{group.description}</p>}
        </div>
        <CopyCode code={group.join_code} />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="flex items-center gap-1"><Users size={11} /> {group.member_count} members</span>
        <span>Start: {fmt(group.start_balance)}</span>
        <span>By {group.creator_name}</span>
      </div>
      <button onClick={() => onSelect(group)}
        className="w-full py-1.5 rounded-lg bg-accent-blue/10 text-accent-blue text-xs font-medium hover:bg-accent-blue/20 transition-colors flex items-center justify-center gap-1.5">
        <Trophy size={12} /> View Leaderboard & Activity
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function Groups() {
  const { state } = useApp()
  const currentUser = state.user

  const [groups,      setGroups]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showCreate,  setShowCreate]  = useState(false)
  const [showJoin,    setShowJoin]    = useState(false)
  const [selected,    setSelected]    = useState(null)
  const [joinBanner,  setJoinBanner]  = useState(null)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    fetchMyGroups()
      .then(setGroups)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleCreated = (group) => {
    setGroups(prev => [group, ...prev])
    setShowCreate(false)
    setSelected(group)
  }

  const handleJoined = (result) => {
    setShowJoin(false)
    setJoinBanner(`🎉 You joined ${result.group_name}!`)
    // Refresh group list
    fetchMyGroups().then(setGroups).catch(() => {})
    setTimeout(() => setJoinBanner(null), 4000)
  }

  if (selected) return (
    <div className="p-6 max-w-4xl mx-auto">
      <GroupDetail group={selected} currentUserId={currentUser?.id} onBack={() => setSelected(null)} />
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-primary font-semibold text-xl flex items-center gap-2">
            <Users size={22} className="text-accent-blue" /> My Groups
          </h1>
          <p className="text-muted text-sm mt-1">Compete with friends — create a group or join one with a code.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowJoin(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-secondary text-sm hover:bg-surface-hover transition-colors">
            <LogIn size={15} /> Join
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90">
            <Plus size={15} /> Create Group
          </button>
        </div>
      </div>

      {/* Join banner */}
      {joinBanner && (
        <div className="px-4 py-3 rounded-xl bg-gain/10 border border-gain/30 text-gain text-sm flex items-center justify-between">
          <span>{joinBanner}</span>
          <button onClick={() => setJoinBanner(null)} className="ml-4 text-gain/60 hover:text-gain text-lg leading-none">×</button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-loss text-sm bg-loss/10 border border-loss/20 rounded-xl px-4 py-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted" /></div>}

      {!loading && groups.length === 0 && (
        <div className="text-center py-16 space-y-4">
          <Users size={44} className="text-muted mx-auto opacity-40" />
          <p className="text-primary font-medium">No groups yet</p>
          <p className="text-muted text-sm">Create a group to compete with friends, or join one with a code.</p>
          <div className="flex gap-3 justify-center pt-1">
            <button onClick={() => setShowJoin(true)}
              className="px-4 py-2 rounded-lg border border-border text-secondary text-sm hover:bg-surface-hover">
              Join with a code
            </button>
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90">
              Create a group
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map(g => (
          <GroupCard key={g.id} group={g} onSelect={setSelected} />
        ))}
      </div>

      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {showJoin   && <JoinGroupModal   onClose={() => setShowJoin(false)}   onJoined={handleJoined}  />}
    </div>
  )
}
