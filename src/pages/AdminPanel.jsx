/**
 * AdminPanel.jsx
 * Admin-only: manage users & roles, view permission matrix.
 *
 * Tabs:
 *  • Users       — filter by role, change roles via popover picker, disable/enable
 *  • Permissions — read-only matrix showing what each role can do
 *
 * Access is also guarded server-side on every /api/admin/* route.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Shield, ChevronDown, ChevronUp, RefreshCw,
  UserX, UserCheck, Check, X, Users, Lock, ClipboardList,
  GraduationCap, Globe, Loader2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import clsx from 'clsx'

// ── Constants ────────────────────────────────────────────────────

const ROLES = ['admin', 'teacher', 'premium', 'user', 'readonly']

const ROLE_META = {
  admin: {
    color:       'text-orange-400',
    bg:          'bg-orange-400/10',
    border:      'border-orange-400/20',
    badge:       'text-orange-400 bg-orange-400/10 border-orange-400/20',
    description: 'Full access + admin panel',
  },
  teacher: {
    color:       'text-purple-400',
    bg:          'bg-purple-400/10',
    border:      'border-purple-400/20',
    badge:       'text-purple-400 bg-purple-400/10 border-purple-400/20',
    description: 'Create classes & invite students',
  },
  premium: {
    color:       'text-yellow-400',
    bg:          'bg-yellow-400/10',
    border:      'border-yellow-400/20',
    badge:       'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
    description: 'Full portfolio & watchlist access',
  },
  user: {
    color:       'text-blue-400',
    bg:          'bg-blue-400/10',
    border:      'border-blue-400/20',
    badge:       'text-blue-400 bg-blue-400/10 border-blue-400/20',
    description: 'Edit portfolio & watchlist',
  },
  readonly: {
    color:       'text-muted',
    bg:          'bg-surface-hover',
    border:      'border-border',
    badge:       'text-muted bg-surface-hover border-border',
    description: 'View only — no edits',
  },
}

// Permission matrix rows
const PERMISSION_ROWS = [
  { label: 'View portfolio & watchlist',    roles: ['readonly', 'user', 'premium', 'teacher', 'admin'] },
  { label: 'Edit portfolio (buy / sell)',   roles: ['user', 'premium', 'teacher', 'admin'] },
  { label: 'Manage watchlist',             roles: ['user', 'premium', 'teacher', 'admin'] },
  { label: 'Create & manage classes',      roles: ['teacher', 'admin'] },
  { label: 'Send student invites',         roles: ['teacher', 'admin'] },
  { label: 'View class rosters',           roles: ['teacher', 'admin'] },
  { label: "View any user's data",         roles: ['admin'] },
  { label: 'Change user roles',            roles: ['admin'] },
  { label: 'Disable / enable accounts',   roles: ['admin'] },
]

// ── Shared fetch helper ──────────────────────────────────────────

async function adminFetch(path, options = {}) {
  const token = localStorage.getItem('tradebuddy_token')
  const res   = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Role Picker Popover ──────────────────────────────────────────

function RolePicker({ currentRole, userId, isSelf, onSave, onClose }) {
  const [selected, setSelected] = useState(currentRole)
  const [saving,   setSaving]   = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleSave = async () => {
    if (selected === currentRole) { onClose(); return }
    setSaving(true)
    try {
      await onSave(userId, selected)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={ref}
      className="absolute top-full mt-1 right-0 z-50 w-60 bg-surface-card border border-border rounded-xl shadow-2xl p-2 space-y-1"
    >
      <p className="text-muted text-xs px-2 pt-1 pb-0.5">Assign role</p>

      {ROLES.map(role => {
        const meta       = ROLE_META[role]
        const isSelected = selected === role
        const isCurrent  = currentRole === role
        // Admins can't demote themselves
        const disabled   = isSelf && role !== 'admin'

        return (
          <button
            key={role}
            disabled={disabled}
            onClick={() => setSelected(role)}
            className={clsx(
              'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors',
              isSelected
                ? `${meta.bg} border ${meta.border}`
                : 'hover:bg-surface-hover',
              disabled && 'opacity-30 cursor-not-allowed',
            )}
          >
            <div className="min-w-0">
              <span className={clsx('text-xs font-semibold', meta.color)}>
                {role}
              </span>
              {isCurrent && (
                <span className="ml-1.5 text-muted text-xs font-normal">current</span>
              )}
              <p className="text-muted text-xs mt-0.5 truncate">{meta.description}</p>
            </div>
            {isSelected && <Check size={13} className={clsx('shrink-0', meta.color)} />}
          </button>
        )
      })}

      <div className="pt-1 border-t border-border flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 text-xs py-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || selected === currentRole}
          className="flex-1 text-xs py-1.5 rounded-lg bg-accent-blue/80 hover:bg-accent-blue text-white disabled:opacity-40 transition-colors font-medium"
        >
          {saving ? 'Saving…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}

// ── Users Tab ────────────────────────────────────────────────────

function UsersTab({ users, loading, me, busy, onRoleChange, onToggleDisable, onExpand, expandedId, expandedData }) {
  const [filter,     setFilter]     = useState('all')
  const [pickerOpen, setPickerOpen] = useState(null)   // userId of open picker

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter)
  const counts   = ROLES.reduce(
    (acc, r) => ({ ...acc, [r]: users.filter(u => u.role === r).length }),
    {}
  )

  return (
    <div className="space-y-4">

      {/* Role filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={clsx(
            'text-xs px-3 py-1 rounded-full border transition-colors',
            filter === 'all'
              ? 'text-primary border-border bg-surface-hover'
              : 'text-muted border-border hover:text-primary hover:border-border'
          )}
        >
          All ({users.length})
        </button>
        {ROLES.map(r => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            className={clsx(
              'text-xs px-3 py-1 rounded-full border transition-colors',
              filter === r
                ? `${ROLE_META[r].color} ${ROLE_META[r].border} ${ROLE_META[r].bg}`
                : 'text-muted border-border hover:text-primary hover:border-border'
            )}
          >
            {r} ({counts[r] ?? 0})
          </button>
        ))}
      </div>

      {/* User list */}
      {loading ? (
        <div className="text-muted text-sm text-center py-12">Loading users…</div>
      ) : filtered.length === 0 ? (
        <div className="text-faint text-sm text-center py-12">
          No users with role "{filter}"
        </div>
      ) : (
        <div className="bg-surface-card border border-border rounded-xl overflow-visible">
          {filtered.map((u, idx) => (
            <div key={u.id} className={clsx(idx > 0 && 'border-t border-border')}>

              {/* Row */}
              <div className={clsx(
                'grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-5 py-3 items-center',
                'hover:bg-surface-hover transition-colors',
                u.is_disabled && 'opacity-50'
              )}>

                {/* Avatar */}
                <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                  {u.avatar
                    ? <img
                        src={u.avatar}
                        alt={u.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    : <div className="w-full h-full bg-accent-blue/30 flex items-center justify-center text-primary text-xs font-bold">
                        {u.name?.[0] ?? '?'}
                      </div>
                  }
                </div>

                {/* Name + email */}
                <button className="text-left min-w-0" onClick={() => onExpand(u.id)}>
                  <p className="text-primary text-sm font-medium truncate flex items-center gap-2">
                    {u.name}
                    {u.id === me?.id && (
                      <span className="text-faint text-xs font-normal">(you)</span>
                    )}
                    {u.is_disabled && (
                      <span className="text-orange-400/70 text-xs font-normal">● disabled</span>
                    )}
                  </p>
                  <p className="text-muted text-xs truncate">{u.email}</p>
                </button>

                {/* Role badge → opens picker */}
                <div className="relative">
                  <button
                    disabled={busy[u.id]}
                    onClick={() => setPickerOpen(pickerOpen === u.id ? null : u.id)}
                    className={clsx(
                      'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium transition-all',
                      ROLE_META[u.role].badge,
                      'hover:opacity-80 active:scale-95',
                      busy[u.id] && 'opacity-40 cursor-wait',
                    )}
                  >
                    {u.role}
                    <ChevronDown size={10} />
                  </button>

                  {pickerOpen === u.id && (
                    <RolePicker
                      currentRole={u.role}
                      userId={u.id}
                      isSelf={u.id === me?.id}
                      onSave={async (id, role) => {
                        await onRoleChange(id, role)
                        setPickerOpen(null)
                      }}
                      onClose={() => setPickerOpen(null)}
                    />
                  )}
                </div>

                {/* Disable / Enable */}
                <button
                  disabled={busy[u.id] || u.id === me?.id}
                  onClick={() => onToggleDisable(u.id, u.is_disabled)}
                  title={u.is_disabled ? 'Enable account' : 'Disable account'}
                  className={clsx(
                    'p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                    u.is_disabled
                      ? 'text-green-400 hover:bg-green-400/10'
                      : 'text-orange-400/50 hover:text-orange-400 hover:bg-orange-400/10'
                  )}
                >
                  {u.is_disabled ? <UserCheck size={15} /> : <UserX size={15} />}
                </button>

                {/* Expand */}
                <button
                  onClick={() => onExpand(u.id)}
                  className="text-faint hover:text-primary transition-colors"
                >
                  {expandedId === u.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </div>

              {/* Expanded: portfolio + watchlist */}
              {expandedId === u.id && (
                <div className="px-5 pb-4 pt-1 bg-surface/50 border-t border-border grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-muted text-xs font-medium mb-2 uppercase tracking-wider">
                      Portfolio
                    </p>
                    {!expandedData[u.id] ? (
                      <p className="text-faint text-xs">Loading…</p>
                    ) : expandedData[u.id].portfolio.length === 0 ? (
                      <p className="text-faint text-xs">No holdings</p>
                    ) : (
                      <div className="space-y-1">
                        {expandedData[u.id].portfolio.map(h => (
                          <div key={h.symbol} className="flex justify-between text-xs">
                            <span className="text-accent-blue font-mono font-semibold">
                              {h.symbol}
                            </span>
                            <span className="text-muted">
                              {h.shares} shares @ ${h.avgCost}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-muted text-xs font-medium mb-2 uppercase tracking-wider">
                      Watchlist
                    </p>
                    {!expandedData[u.id] ? (
                      <p className="text-faint text-xs">Loading…</p>
                    ) : expandedData[u.id].watchlist.length === 0 ? (
                      <p className="text-faint text-xs">Empty</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {expandedData[u.id].watchlist.map(s => (
                          <span
                            key={s}
                            className="text-xs text-accent-blue font-mono bg-accent-blue/10 px-2 py-0.5 rounded"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Permissions Tab ──────────────────────────────────────────────

function PermissionsTab() {
  return (
    <div className="space-y-5">
      <p className="text-muted text-sm">
        Read-only reference showing what each role can do. Use the Users tab to change roles.
      </p>

      {/* Role summary cards */}
      <div className="grid grid-cols-5 gap-3">
        {ROLES.map(role => {
          const meta = ROLE_META[role]
          return (
            <div key={role} className={clsx('rounded-xl border p-4', meta.bg, meta.border)}>
              <span className={clsx('text-sm font-semibold', meta.color)}>{role}</span>
              <p className="text-muted text-xs mt-1 leading-relaxed">{meta.description}</p>
            </div>
          )
        })}
      </div>

      {/* Matrix */}
      <div className="bg-surface-card border border-border rounded-xl overflow-hidden">

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_repeat(5,_80px)] px-5 py-3 border-b border-border bg-surface/50">
          <span className="text-muted text-xs font-medium uppercase tracking-wider">
            Permission
          </span>
          {ROLES.map(r => (
            <span
              key={r}
              className={clsx('text-xs font-semibold text-center', ROLE_META[r].color)}
            >
              {r}
            </span>
          ))}
        </div>

        {/* Rows */}
        {PERMISSION_ROWS.map((perm, idx) => (
          <div
            key={perm.label}
            className={clsx(
              'grid grid-cols-[1fr_repeat(5,_80px)] px-5 py-3 items-center transition-colors',
              'hover:bg-surface-hover',
              idx % 2 === 1 && 'bg-surface/50',
            )}
          >
            <span className="text-secondary text-sm">{perm.label}</span>
            {ROLES.map(r => (
              <div key={r} className="flex justify-center">
                {perm.roles.includes(r)
                  ? <Check size={15} className="text-green-400" />
                  : <X    size={15} className="text-faint" />
                }
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Role hierarchy note */}
      <div className="flex items-center gap-2 text-muted text-xs">
        <Shield size={11} />
        Role hierarchy (highest → lowest): admin → teacher → premium → user → readonly
      </div>
    </div>
  )
}

// ── Classes Tab ──────────────────────────────────────────────────

function TeacherApplicationsSection() {
  const [applications, setApplications] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [filter,       setFilter]       = useState('pending')
  const [busy,         setBusy]         = useState({})
  const [rejectModal,  setRejectModal]  = useState(null)  // { id, name }
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch(`/admin/teacher-verifications?status=${filter}`)
      setApplications(data)
    } catch (_) {}
    finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  const handleApprove = async (id) => {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await adminFetch(`/admin/teacher-verifications/${id}/approve`, { method: 'PUT' })
      setApplications(prev => prev.filter(a => a.id !== id))
    } catch (err) {
      alert('Failed: ' + err.message)
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const handleReject = async () => {
    const { id } = rejectModal
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await adminFetch(`/admin/teacher-verifications/${id}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ reason: rejectReason }),
      })
      setApplications(prev => prev.filter(a => a.id !== id))
      setRejectModal(null); setRejectReason('')
    } catch (err) {
      alert('Failed: ' + err.message)
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const FILTER_TABS = [
    { key: 'pending',  label: 'Pending'  },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all',      label: 'All'      },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-primary font-medium text-sm flex items-center gap-2">
          <GraduationCap size={15} className="text-purple-400" />
          Teacher Applications
          {filter === 'pending' && applications.length > 0 && (
            <span className="bg-purple-400 text-white text-xs rounded-full px-1.5 py-0.5 font-semibold">
              {applications.length}
            </span>
          )}
        </h3>
        <div className="flex gap-1">
          {FILTER_TABS.map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={clsx('text-xs px-2.5 py-1 rounded-md transition-colors',
                filter === t.key ? 'bg-surface-card text-primary border border-border' : 'text-muted hover:text-primary')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-muted" /></div>
      ) : applications.length === 0 ? (
        <p className="text-muted text-xs text-center py-6">No {filter} applications.</p>
      ) : (
        <div className="bg-surface-card border border-border rounded-xl divide-y divide-border">
          {applications.map(a => (
            <div key={a.id} className="px-4 py-3 flex items-start gap-3">
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-0.5">
                {a.avatar_url
                  ? <img src={a.avatar_url} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" />
                  : <div className="w-full h-full bg-purple-400/20 flex items-center justify-center text-purple-400 text-xs font-bold">
                      {(a.user_name || '?')[0].toUpperCase()}
                    </div>
                }
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-primary text-sm font-medium">{a.user_name}</p>
                  <p className="text-muted text-xs">{a.user_email}</p>
                  <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full border font-medium',
                    a.status === 'pending'  && 'text-accent-blue border-accent-blue/30 bg-accent-blue/10',
                    a.status === 'approved' && 'text-gain border-gain/30 bg-gain/10',
                    a.status === 'rejected' && 'text-loss border-loss/30 bg-loss/10',
                  )}>{a.status}</span>
                </div>
                <p className="text-secondary text-xs mt-0.5">
                  {a.title} · {a.school_name} · {a.state}
                </p>
                {a.school_website && (
                  <a href={a.school_website} target="_blank" rel="noopener noreferrer"
                    className="text-accent-blue text-xs hover:underline mt-0.5 inline-block">
                    {a.school_website}
                  </a>
                )}
                {a.reject_reason && (
                  <p className="text-loss/70 text-xs mt-0.5">Reason: {a.reject_reason}</p>
                )}
                <p className="text-muted text-xs mt-0.5">
                  Applied {new Date(a.created_at).toLocaleDateString()}
                  {a.reviewed_at && ` · Reviewed ${new Date(a.reviewed_at).toLocaleDateString()} by ${a.reviewer_name}`}
                </p>
              </div>

              {/* Actions (pending only) */}
              {a.status === 'pending' && (
                <div className="flex gap-1.5 shrink-0">
                  <button
                    disabled={busy[a.id]}
                    onClick={() => handleApprove(a.id)}
                    className="px-2.5 py-1 rounded-lg bg-gain/10 text-gain border border-gain/30 text-xs font-medium hover:bg-gain/20 disabled:opacity-40 transition-colors flex items-center gap-1">
                    <Check size={11} /> Approve
                  </button>
                  <button
                    disabled={busy[a.id]}
                    onClick={() => { setRejectModal({ id: a.id, name: a.user_name }); setRejectReason('') }}
                    className="px-2.5 py-1 rounded-lg bg-loss/10 text-loss border border-loss/30 text-xs font-medium hover:bg-loss/20 disabled:opacity-40 transition-colors flex items-center gap-1">
                    <X size={11} /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-primary font-semibold text-sm">Reject {rejectModal.name}'s application</h3>
            <div>
              <label className="text-muted text-xs mb-1 block">Reason (optional — sent to applicant)</label>
              <textarea
                className="w-full h-24 bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue resize-none"
                placeholder="e.g. We couldn't find this school in our database…"
                value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setRejectModal(null)}
                className="flex-1 px-3 py-2 rounded-lg border border-border text-secondary text-sm hover:bg-surface-hover">
                Cancel
              </button>
              <button onClick={handleReject}
                className="flex-1 px-3 py-2 rounded-lg bg-loss/80 hover:bg-loss text-white text-sm font-medium">
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ClassesTab() {
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await adminFetch('/admin/classes')
      setClasses(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (error) return (
    <div className="text-loss text-sm bg-loss/10 border border-loss/20 rounded-xl px-4 py-3">{error}</div>
  )

  return (
    <div className="space-y-8">

      {/* Teacher Applications queue */}
      <TeacherApplicationsSection />

      <hr className="border-border" />

      {/* All classes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-primary font-medium text-sm">All Classes</h3>
          <button onClick={load}
            className="flex items-center gap-1.5 text-muted hover:text-primary text-xs transition-colors">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-muted" /></div>
        ) : classes.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <GraduationCap size={32} className="text-muted mx-auto" />
            <p className="text-muted text-sm">No classes created yet.</p>
          </div>
        ) : (
          <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted text-xs">
                  <th className="text-left px-4 py-3">Class</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Teacher</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">School</th>
                  <th className="text-center px-4 py-3">Students</th>
                  <th className="text-center px-4 py-3">Ideas</th>
                  <th className="text-center px-4 py-3">Visibility</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {classes.map(cls => (
                  <tr key={cls.id} className="hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-primary font-medium">{cls.name}</p>
                      <p className="text-muted text-xs">{cls.state}</p>
                    </td>
                    <td className="px-4 py-3 text-secondary hidden md:table-cell">
                      <p>{cls.teacher_name || '—'}</p>
                      <p className="text-muted text-xs">{cls.teacher_email}</p>
                    </td>
                    <td className="px-4 py-3 text-secondary text-xs hidden lg:table-cell">
                      {cls.school_name}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-primary font-medium">{cls.member_count ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-secondary">{cls.idea_count ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {cls.ideas_public
                        ? <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gain/10 text-gain border border-gain/30">
                            <Globe size={8} /> Public
                          </span>
                        : <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-hover text-muted border border-border">
                            <Lock size={8} /> Private
                          </span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right text-muted text-xs hidden sm:table-cell">
                      {new Date(cls.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Audit Tab ────────────────────────────────────────────────────

const ACTION_META = {
  login:            { label: 'Login',              color: 'text-accent-blue  bg-accent-blue/10  border-accent-blue/20'  },
  logout:           { label: 'Logout',             color: 'text-muted     bg-surface-hover          border-border'        },
  signup:           { label: 'Signed Up',          color: 'text-green-400    bg-green-400/10     border-green-400/20'    },
  buy:              { label: 'Buy',                color: 'text-gain         bg-gain/10          border-gain/20'         },
  add_holding:      { label: 'Add Holding',        color: 'text-gain         bg-gain/10          border-gain/20'         },
  sell:             { label: 'Sell',               color: 'text-loss         bg-loss/10          border-loss/20'         },
  remove_holding:   { label: 'Remove Holding',     color: 'text-muted     bg-surface-hover          border-border'        },
  add_watchlist:    { label: 'Watch +',            color: 'text-yellow-400   bg-yellow-400/10    border-yellow-400/20'   },
  remove_watchlist: { label: 'Watch −',            color: 'text-muted     bg-surface-hover          border-border'        },
  agent_buy:        { label: 'Agent Buy',          color: 'text-gain         bg-gain/10          border-gain/20'         },
  agent_sell:       { label: 'Agent Sell',         color: 'text-loss         bg-loss/10          border-loss/20'         },
  agent_remove:     { label: 'Agent Remove',       color: 'text-muted     bg-surface-hover          border-border'        },
  role_changed:     { label: 'Role Changed',       color: 'text-orange-400   bg-orange-400/10    border-orange-400/20'   },
  account_disabled: { label: 'Account Disabled',  color: 'text-loss         bg-loss/10          border-loss/20'         },
  account_enabled:  { label: 'Account Enabled',   color: 'text-gain         bg-gain/10          border-gain/20'         },
}

function ActionBadge({ action }) {
  const meta = ACTION_META[action] ?? { label: action, color: 'text-muted bg-surface-hover border-border' }
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap', meta.color)}>
      {meta.label}
    </span>
  )
}

function formatDetails(action, details) {
  if (!details) return null
  try {
    const d = typeof details === 'string' ? JSON.parse(details) : details
    if (action === 'login' || action === 'signup') return `via ${d.method}`
    if (action === 'buy' || action === 'add_holding') return `${d.symbol} · ${d.shares} shares @ $${Number(d.avgCost).toFixed(2)}`
    if (action === 'sell') return `${d.symbol} · ${d.shares} shares`
    if (action === 'remove_holding') return d.symbol
    if (action === 'add_watchlist' || action === 'remove_watchlist') return d.symbol
    if (action.startsWith('agent_')) return d.command ?? `${d.symbol ?? ''}`
    if (action === 'role_changed') return `${d.from} → ${d.to}`
    if (action === 'account_disabled' || action === 'account_enabled') return `user ${d.targetUserId?.slice(0,8)}…`
    return JSON.stringify(d)
  } catch { return String(details) }
}

function AuditTab({ users }) {
  const [entries,   setEntries]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: 200 })
      if (filterUser)   params.set('userId', filterUser)
      if (filterAction) params.set('action', filterAction)
      const data = await adminFetch(`/admin/audit?${params}`)
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }, [filterUser, filterAction])

  useEffect(() => { load() }, [load])

  const allActions = Object.keys(ACTION_META)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterUser}
          onChange={e => setFilterUser(e.target.value)}
          className="text-xs bg-surface-hover border border-border text-secondary rounded-lg px-3 py-1.5 outline-none"
        >
          <option value="">All users</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
          ))}
        </select>

        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="text-xs bg-surface-hover border border-border text-secondary rounded-lg px-3 py-1.5 outline-none"
        >
          <option value="">All actions</option>
          {allActions.map(a => (
            <option key={a} value={a}>{ACTION_META[a].label}</option>
          ))}
        </select>

        <button onClick={load}
          className="flex items-center gap-1.5 text-muted hover:text-primary text-xs transition-colors ml-auto">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-muted text-sm text-center py-12">Loading audit log…</div>
      ) : entries.length === 0 ? (
        <div className="text-faint text-sm text-center py-12">No entries found</div>
      ) : (
        <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Details</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id}
                  className={clsx('border-t border-border hover:bg-surface-hover transition-colors',
                    i % 2 === 1 && 'bg-surface/50')}>
                  <td className="px-4 py-2.5 text-muted whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString([], {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td className="px-4 py-2.5 min-w-0">
                    <p className="text-secondary truncate max-w-[140px]">{e.user_name ?? '—'}</p>
                    <p className="text-muted truncate max-w-[140px]">{e.user_email ?? e.user_id}</p>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <ActionBadge action={e.action} />
                  </td>
                  <td className="px-4 py-2.5 text-muted max-w-[200px] truncate">
                    {formatDetails(e.action, e.details) ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-faint hidden lg:table-cell font-mono">
                    {e.ip ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border text-faint text-xs">
            Showing {entries.length} most recent entries
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main AdminPanel ──────────────────────────────────────────────

const TABS = [
  { key: 'users',       label: 'Users',       Icon: Users         },
  { key: 'classes',     label: 'Classes',     Icon: GraduationCap },
  { key: 'permissions', label: 'Permissions', Icon: Lock          },
  { key: 'audit',       label: 'Audit Log',   Icon: ClipboardList },
]

export default function AdminPanel() {
  const { user: me }     = useAuth()
  const [activeTab,      setActiveTab]      = useState('users')
  const [users,          setUsers]          = useState([])
  const [loading,        setLoading]        = useState(true)
  const [expandedId,     setExpandedId]     = useState(null)
  const [expandedData,   setExpandedData]   = useState({})
  const [busy,           setBusy]           = useState({})

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch('/admin/users')
      setUsers(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const toggleExpand = async (userId) => {
    if (expandedId === userId) { setExpandedId(null); return }
    setExpandedId(userId)
    if (!expandedData[userId]) {
      try {
        const [portfolio, watchlist] = await Promise.all([
          adminFetch(`/admin/users/${userId}/portfolio`),
          adminFetch(`/admin/users/${userId}/watchlist`),
        ])
        setExpandedData(prev => ({ ...prev, [userId]: { portfolio, watchlist } }))
      } catch {
        setExpandedData(prev => ({ ...prev, [userId]: { portfolio: [], watchlist: [] } }))
      }
    }
  }

  const handleRoleChange = async (userId, newRole) => {
    setBusy(b => ({ ...b, [userId]: true }))
    try {
      await adminFetch(`/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      })
      setUsers(u => u.map(x => x.id === userId ? { ...x, role: newRole } : x))
    } catch (err) {
      alert('Failed to update role: ' + err.message)
    } finally {
      setBusy(b => ({ ...b, [userId]: false }))
    }
  }

  const handleToggleDisable = async (userId, currentlyDisabled) => {
    setBusy(b => ({ ...b, [userId]: true }))
    try {
      await adminFetch(`/admin/users/${userId}/disable`, {
        method: 'PUT',
        body: JSON.stringify({ disabled: !currentlyDisabled }),
      })
      setUsers(u => u.map(x => x.id === userId ? { ...x, is_disabled: !currentlyDisabled } : x))
    } catch (err) {
      alert('Failed to update account: ' + err.message)
    } finally {
      setBusy(b => ({ ...b, [userId]: false }))
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-orange-400" />
          <h2 className="text-primary font-semibold">Admin Panel</h2>
          {!loading && (
            <span className="text-muted text-sm">— {users.length} users</span>
          )}
        </div>
        <button
          onClick={loadUsers}
          className="flex items-center gap-1.5 text-muted hover:text-primary text-xs transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 bg-surface-hover rounded-lg p-1 w-fit">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === key
                ? 'bg-surface-card text-primary shadow-sm'
                : 'text-muted hover:text-primary'
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'users' && (
        <UsersTab
          users={users}
          loading={loading}
          me={me}
          busy={busy}
          onRoleChange={handleRoleChange}
          onToggleDisable={handleToggleDisable}
          onExpand={toggleExpand}
          expandedId={expandedId}
          expandedData={expandedData}
        />
      )}

      {activeTab === 'classes'     && <ClassesTab />}
      {activeTab === 'permissions' && <PermissionsTab />}
      {activeTab === 'audit'       && <AuditTab users={users} />}
    </div>
  )
}
