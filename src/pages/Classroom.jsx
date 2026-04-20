/**
 * Classroom.jsx
 * Teacher view: create and manage classes, send student invites,
 * see members and their portfolio values.
 */

import { useState, useEffect } from 'react'
import {
  GraduationCap, Plus, Mail, Users, ChevronRight,
  Loader2, AlertCircle, Globe, Lock, Clock, CheckCircle, XCircle,
  School, ExternalLink, TrendingUp, TrendingDown, Activity,
  Briefcase, BarChart2, ArrowLeft, Lightbulb,
} from 'lucide-react'
import {
  createClass, fetchManagedClasses, fetchClassDetail, fetchStudentDetail,
  fetchClassLeaderboard, sendInvites, applyForTeacher, fetchTeacherApplicationStatus,
} from '../services/apiService'
import { useAuth } from '../context/AuthContext'
import clsx from 'clsx'

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
  'North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
  'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
]

function fmt(n) {
  return n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Create Class modal ────────────────────────────────────────────
function CreateClassModal({ onClose, onCreated }) {
  const [form, setForm]   = useState({
    name: '', school_name: '', state: '', country: 'US',
    start_balance: '100000', ideas_public: false,
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.school_name || !form.state) {
      return setError('Please fill in all required fields')
    }
    setSaving(true); setError(null)
    try {
      const cls = await createClass({ ...form, start_balance: parseFloat(form.start_balance) })
      onCreated(cls)
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
          <GraduationCap size={20} className="text-accent-blue" /> Create a New Class
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-muted text-xs mb-1 block">Class Name *</label>
            <input className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              placeholder="Economics Period 3" value={form.name}
              onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="text-muted text-xs mb-1 block">School Name *</label>
            <input className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              placeholder="Lincoln High School" value={form.school_name}
              onChange={e => set('school_name', e.target.value)} />
          </div>
          <div>
            <label className="text-muted text-xs mb-1 block">State *</label>
            <select className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              value={form.state} onChange={e => set('state', e.target.value)}>
              <option value="">Select state…</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-muted text-xs mb-1 block">Starting Balance ($)</label>
            <input type="number" className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              value={form.start_balance} onChange={e => set('start_balance', e.target.value)} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div onClick={() => set('ideas_public', !form.ideas_public)}
              className={clsx('w-10 h-6 rounded-full transition-colors relative',
                form.ideas_public ? 'bg-accent-blue' : 'bg-surface-hover border border-border')}>
              <div className={clsx('absolute top-1 w-4 h-4 bg-white rounded-full transition-all',
                form.ideas_public ? 'left-5' : 'left-1')} />
            </div>
            <span className="text-sm text-secondary">Make trading ideas public (visible to other schools)</span>
          </label>

          {error && <p className="text-loss text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-border text-secondary text-sm hover:bg-surface-hover">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Create Class
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Invite modal ──────────────────────────────────────────────────
function InviteModal({ cls, onClose }) {
  const [emailsText, setEmailsText] = useState('')
  const [results,    setResults]    = useState(null)
  const [sending,    setSending]    = useState(false)
  const [error,      setError]      = useState(null)

  const handleSend = async () => {
    const emails = emailsText.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean)
    if (!emails.length) return setError('Enter at least one email address')
    setSending(true); setError(null)
    try {
      const res = await sendInvites(cls.id, emails)
      setResults(res.results)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-primary font-semibold text-lg flex items-center gap-2">
          <Mail size={18} className="text-accent-blue" /> Invite Students to {cls.name}
        </h2>

        {!results ? (
          <>
            <p className="text-muted text-sm">Enter student email addresses, one per line or separated by commas.</p>
            <textarea
              className="w-full h-32 bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue resize-none"
              placeholder="student1@school.edu&#10;student2@school.edu"
              value={emailsText} onChange={e => setEmailsText(e.target.value)}
            />
            {error && <p className="text-loss text-xs">{error}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border text-secondary text-sm hover:bg-surface-hover">Cancel</button>
              <button onClick={handleSend} disabled={sending}
                className="flex-1 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                Send Invites
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {results.map(r => (
                <div key={r.email} className="flex items-center justify-between text-sm">
                  <span className="text-secondary truncate">{r.email}</span>
                  <span className={clsx('text-xs font-medium ml-2 shrink-0',
                    r.status === 'sent'           ? 'text-gain'
                    : r.status === 'already_member' ? 'text-muted'
                    : 'text-loss')}>
                    {r.status === 'sent' ? '✓ Invited' : r.status === 'already_member' ? 'Already in class' : '✗ Email failed'}
                  </span>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="w-full px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90">Done</button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Class card ────────────────────────────────────────────────────
function ClassCard({ cls, onSelect, onInvite }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-primary font-semibold">{cls.name}</h3>
          <p className="text-muted text-sm">{cls.school_name} · {cls.state}</p>
        </div>
        <span className={clsx('flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0',
          cls.ideas_public
            ? 'text-gain border-gain/30 bg-gain/10'
            : 'text-muted border-border bg-surface-hover')}>
          {cls.ideas_public ? <Globe size={9} /> : <Lock size={9} />}
          {cls.ideas_public ? 'Public ideas' : 'Private'}
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-secondary">
          <Users size={13} className="text-muted" />
          {cls.member_count ?? 0} students
        </span>
        <span className="text-muted text-xs">Starting balance: {fmt(cls.start_balance)}</span>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={() => onInvite(cls)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-secondary text-xs hover:bg-surface-hover">
          <Mail size={12} /> Invite
        </button>
        <button onClick={() => onSelect(cls)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue/10 text-accent-blue text-xs hover:bg-accent-blue/20">
          <Users size={12} /> View Members <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Student drill-down panel ──────────────────────────────────────
function StudentPanel({ classId, student, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    fetchStudentDetail(classId, student.id)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [classId, student.id])

  const initials  = (student.name || student.email || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const retPct    = student.return_pct
  const retColor  = retPct == null ? 'text-muted' : retPct >= 0 ? 'text-gain' : 'text-loss'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          {student.avatar_url
            ? <img src={student.avatar_url} className="w-10 h-10 rounded-full" alt="" />
            : <div className="w-10 h-10 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-sm font-semibold">{initials}</div>
          }
          <div className="flex-1 min-w-0">
            <p className="text-primary font-semibold truncate">{student.name || student.email}</p>
            {student.name && <p className="text-muted text-xs truncate">{student.email}</p>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary text-xl leading-none px-1">×</button>
        </div>

        {/* Return % summary bar */}
        {(retPct != null || student.current_value != null) && (
          <div className="flex items-center gap-6 px-5 py-3 border-b border-border bg-surface-hover shrink-0">
            {retPct != null && (
              <div>
                <p className="text-muted text-xs">Return</p>
                <p className={clsx('font-bold text-lg', retColor)}>
                  {retPct >= 0 ? '+' : ''}{retPct.toFixed(2)}%
                </p>
              </div>
            )}
            {student.current_value != null && (
              <div>
                <p className="text-muted text-xs">Portfolio Value</p>
                <p className="text-primary font-semibold">{fmt(student.current_value)}</p>
              </div>
            )}
            {student.base_value != null && (
              <div>
                <p className="text-muted text-xs">Starting Value</p>
                <p className="text-secondary text-sm">{fmt(student.base_value)}</p>
              </div>
            )}
            <div className="ml-auto text-right">
              <p className="text-muted text-xs">Trades</p>
              <p className="text-secondary font-medium">{student.trade_count ?? 0}</p>
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted" /></div>}
          {error   && <p className="text-loss text-sm">{error}</p>}

          {data && (
            <>
              {/* Portfolio */}
              <div>
                <h3 className="text-muted text-xs font-medium uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Briefcase size={12} /> Portfolio ({data.holdings.length} holdings)
                </h3>
                {data.holdings.length === 0
                  ? <p className="text-muted text-sm">No holdings yet.</p>
                  : (
                    <div className="bg-surface-hover rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-muted text-xs">
                            <th className="text-left px-3 py-2">Symbol</th>
                            <th className="text-right px-3 py-2">Shares</th>
                            <th className="text-right px-3 py-2">Avg Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {data.holdings.map(h => (
                            <tr key={h.symbol}>
                              <td className="px-3 py-2 text-primary font-medium">{h.symbol}</td>
                              <td className="px-3 py-2 text-right text-secondary">{Number(h.shares).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-muted">{fmt(h.avg_cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                }
              </div>

              {/* Recent activity */}
              <div>
                <h3 className="text-muted text-xs font-medium uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Activity size={12} /> Recent Trades
                </h3>
                {data.activity.length === 0
                  ? <p className="text-muted text-sm">No trades yet.</p>
                  : (
                    <div className="space-y-2">
                      {data.activity.slice(0, 20).map(entry => {
                        const d = entry.details || {}
                        const isBuy = entry.action === 'buy'
                        const isSell = entry.action === 'sell' || entry.action === 'remove_holding'
                        return (
                          <div key={entry.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className={clsx(
                                'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase',
                                isBuy  && 'bg-gain/15 text-gain',
                                isSell && 'bg-loss/15 text-loss',
                              )}>
                                {entry.action === 'remove_holding' ? 'Close' : entry.action}
                              </span>
                              <span className="text-primary font-medium">{d.symbol || '—'}</span>
                              {d.shares && <span className="text-muted">{d.shares} sh</span>}
                            </div>
                            <span className="text-muted text-xs">
                              {new Date(entry.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )
                }
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Class dashboard (members view) ────────────────────────────────
function MembersView({ cls, onBack, onInvite }) {
  const [members,     setMembers]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [drillStudent, setDrillStudent] = useState(null)
  const [sortBy,      setSortBy]      = useState('return_pct') // return_pct | name | last_active | trade_count

  useEffect(() => {
    // Fetch engagement stats and leaderboard (return %) in parallel, then merge
    Promise.all([
      fetchClassDetail(cls.id),
      fetchClassLeaderboard(cls.id).catch(() => []),  // leaderboard may be empty
    ]).then(([detail, lb]) => {
      const lbMap = Object.fromEntries(lb.map(r => [r.user_id, r]))
      const merged = (detail.members ?? []).map(m => ({
        ...m,
        return_pct:    lbMap[m.id]?.return_pct    ?? null,
        current_value: lbMap[m.id]?.current_value ?? null,
        rank:          lbMap[m.id]?.rank          ?? null,
      }))
      setMembers(merged)
    }).catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [cls.id])

  const activeCount   = members.filter(m => m.trade_count > 0).length
  const dormantCount  = members.filter(m => m.trade_count === 0).length
  const totalIdeas    = members.reduce((s, m) => s + Number(m.idea_count), 0)

  function relativeTime(ts) {
    if (!ts) return 'Never'
    const diff = Date.now() - new Date(ts).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7)   return `${days}d ago`
    if (days < 30)  return `${Math.floor(days / 7)}w ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted hover:text-primary flex items-center gap-1 text-sm">
            <ArrowLeft size={15} /> Back
          </button>
          <div>
            <h2 className="text-primary font-semibold">{cls.name}</h2>
            <p className="text-muted text-xs">{cls.school_name} · {cls.state}</p>
          </div>
        </div>
        <button onClick={() => onInvite(cls)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-secondary text-xs hover:bg-surface-hover">
          <Mail size={12} /> Invite Students
        </button>
      </div>

      {loading && <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-muted" /></div>}
      {error   && <p className="text-loss text-sm">{error}</p>}

      {!loading && !error && (
        <>
          {/* Health summary cards */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Students',  value: members.length, icon: Users,       color: 'text-accent-blue' },
              { label: 'Active',    value: activeCount,    icon: TrendingUp,  color: 'text-gain' },
              { label: 'No trades', value: dormantCount,   icon: TrendingDown, color: dormantCount > 0 ? 'text-loss' : 'text-muted' },
              { label: 'Ideas',     value: totalIdeas,     icon: Lightbulb,   color: 'text-yellow-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-surface-card border border-border rounded-xl p-4 text-center">
                <Icon size={16} className={clsx('mx-auto mb-1', color)} />
                <p className="text-primary font-bold text-lg">{value}</p>
                <p className="text-muted text-xs">{label}</p>
              </div>
            ))}
          </div>

          {/* Members table */}
          {members.length === 0
            ? (
              <div className="text-center py-12 space-y-2">
                <Users size={32} className="text-muted mx-auto" />
                <p className="text-muted text-sm">No students yet — send some invites!</p>
              </div>
            ) : (
              <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted text-xs">
                      <th className="text-left px-4 py-3">Student</th>
                      {/* Sortable column headers */}
                      {[
                        { key: 'return_pct',   label: 'Return' },
                        { key: 'trade_count',  label: 'Trades' },
                        { key: 'idea_count',   label: 'Ideas' },
                        { key: 'last_active',  label: 'Last Active' },
                      ].map(col => (
                        <th key={col.key}
                          className="text-right px-4 py-3 cursor-pointer hover:text-primary select-none"
                          onClick={() => setSortBy(col.key)}>
                          {col.label}
                          {sortBy === col.key && <span className="ml-1 text-accent-blue">↓</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...members].sort((a, b) => {
                      if (sortBy === 'return_pct')  return (b.return_pct ?? -Infinity) - (a.return_pct ?? -Infinity)
                      if (sortBy === 'trade_count') return b.trade_count - a.trade_count
                      if (sortBy === 'idea_count')  return b.idea_count  - a.idea_count
                      if (sortBy === 'last_active') return (b.last_active ?? '') > (a.last_active ?? '') ? 1 : -1
                      return 0
                    }).map(m => {
                      const initials  = (m.name || m.email || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                      const isDormant = m.trade_count === 0
                      const retPct    = m.return_pct
                      const retColor  = retPct == null ? 'text-muted' : retPct >= 0 ? 'text-gain' : 'text-loss'
                      return (
                        <tr key={m.id} onClick={() => setDrillStudent(m)}
                          className="hover:bg-surface-hover transition-colors cursor-pointer">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              {m.avatar_url
                                ? <img src={m.avatar_url} className="w-7 h-7 rounded-full" alt="" />
                                : <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-[10px] font-semibold shrink-0">{initials}</div>
                              }
                              <div>
                                <p className="text-primary font-medium leading-tight">{m.name || m.email}</p>
                                {m.name && <p className="text-muted text-xs">{m.email}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={clsx('font-semibold', retColor)}>
                              {retPct == null ? '—' : `${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%`}
                            </span>
                            {m.current_value != null && (
                              <p className="text-muted text-xs">{fmt(m.current_value)}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={clsx('font-medium', isDormant ? 'text-loss' : 'text-secondary')}>
                              {m.trade_count}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-secondary">{m.idea_count}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={clsx('text-xs', isDormant ? 'text-loss/70' : 'text-muted')}>
                              {relativeTime(m.last_active)}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </>
      )}

      {drillStudent && (
        <StudentPanel
          classId={cls.id}
          student={drillStudent}
          onClose={() => setDrillStudent(null)}
        />
      )}
    </div>
  )
}

// ── Teacher application view (for non-teachers) ───────────────────
function TeacherApplicationView() {
  const [status,   setStatus]   = useState(null)   // null | pending | approved | rejected
  const [loading,  setLoading]  = useState(true)
  const [form,     setForm]     = useState({ school_name: '', school_website: '', state: '', title: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error,    setError]    = useState(null)
  const [rejectReason, setRejectReason] = useState(null)

  useEffect(() => {
    fetchTeacherApplicationStatus()
      .then(data => {
        setStatus(data?.status ?? null)
        setRejectReason(data?.reject_reason ?? null)
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.school_name || !form.state || !form.title) {
      return setError('School name, state, and your title are required')
    }
    setSubmitting(true); setError(null)
    try {
      await applyForTeacher(form)
      setStatus('pending')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-muted" /></div>
  )

  // Already approved — shouldn't normally see this, but handle gracefully
  if (status === 'approved') return (
    <div className="text-center py-16 space-y-2">
      <CheckCircle size={40} className="text-gain mx-auto" />
      <p className="text-primary font-medium">Your teacher account is active</p>
      <p className="text-muted text-sm">Refresh the page to access your classes.</p>
    </div>
  )

  // Pending
  if (status === 'pending') return (
    <div className="max-w-md mx-auto py-12 space-y-6 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent-blue/10">
        <Clock size={32} className="text-accent-blue" />
      </div>
      <div>
        <h2 className="text-primary font-semibold text-lg">Application under review</h2>
        <p className="text-muted text-sm mt-2 leading-relaxed">
          We've received your request and will verify your school information.
          You'll get an email once it's approved — usually within 1 business day.
        </p>
      </div>
    </div>
  )

  // Rejected — allow re-apply
  if (status === 'rejected') return (
    <div className="max-w-md mx-auto py-8 space-y-5">
      <div className="flex items-start gap-3 p-4 rounded-xl bg-loss/10 border border-loss/20">
        <XCircle size={18} className="text-loss shrink-0 mt-0.5" />
        <div>
          <p className="text-loss text-sm font-medium">Previous application not approved</p>
          {rejectReason && <p className="text-loss/70 text-xs mt-1">{rejectReason}</p>}
          <p className="text-muted text-xs mt-2">
            You can submit a new application below with updated information.
          </p>
        </div>
      </div>
      <TeacherApplyForm form={form} set={set} error={error} submitting={submitting} onSubmit={handleSubmit} />
    </div>
  )

  // No application yet
  return (
    <div className="max-w-lg mx-auto py-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-400/10">
          <GraduationCap size={32} className="text-purple-400" />
        </div>
        <h2 className="text-primary font-semibold text-xl">Become a Teacher</h2>
        <p className="text-muted text-sm leading-relaxed max-w-sm mx-auto">
          Create classes, invite students, and run stock trading competitions
          for your economics class. Free for educators.
        </p>
      </div>
      <TeacherApplyForm form={form} set={set} error={error} submitting={submitting} onSubmit={handleSubmit} />
    </div>
  )
}

function TeacherApplyForm({ form, set, error, submitting, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="bg-surface-card border border-border rounded-xl p-6 space-y-4">
      <h3 className="text-primary font-medium text-sm flex items-center gap-2">
        <School size={15} className="text-purple-400" /> School Information
      </h3>

      <div>
        <label className="text-muted text-xs mb-1 block">Your Title / Role *</label>
        <input
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
          placeholder="Economics Teacher, Department Head…"
          value={form.title} onChange={e => set('title', e.target.value)} />
      </div>

      <div>
        <label className="text-muted text-xs mb-1 block">School Name *</label>
        <input
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
          placeholder="Lincoln High School"
          value={form.school_name} onChange={e => set('school_name', e.target.value)} />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-muted text-xs mb-1 block">State *</label>
          <select
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
            value={form.state} onChange={e => set('state', e.target.value)}>
            <option value="">Select…</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-muted text-xs mb-1 block">School Website</label>
          <div className="relative">
            <input
              className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue pr-8"
              placeholder="https://school.edu"
              value={form.school_website} onChange={e => set('school_website', e.target.value)} />
            <ExternalLink size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
        </div>
      </div>

      <p className="text-muted text-xs leading-relaxed">
        We verify each application to ensure TradeBuddy remains a trusted tool for educators.
        Providing your school's website helps us verify faster.
      </p>

      {error && <p className="text-loss text-xs">{error}</p>}

      <button type="submit" disabled={submitting}
        className="w-full py-2.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
        {submitting ? <Loader2 size={14} className="animate-spin" /> : <GraduationCap size={14} />}
        Submit Application
      </button>
    </form>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function Classroom() {
  const { role } = useAuth()
  const isTeacher = role === 'teacher' || role === 'admin'

  const [classes,     setClasses]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showCreate,  setShowCreate]  = useState(false)
  const [inviteFor,   setInviteFor]   = useState(null)
  const [selectedCls, setSelectedCls] = useState(null)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    if (!isTeacher) { setLoading(false); return }
    fetchManagedClasses()
      .then(setClasses)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [isTeacher])

  const handleCreated = (cls) => {
    setClasses(prev => [{ ...cls, member_count: 0 }, ...prev])
    setShowCreate(false)
  }

  // Non-teachers see the application flow
  if (!isTeacher) return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-primary font-semibold text-xl flex items-center gap-2">
          <GraduationCap size={22} className="text-purple-400" /> My Classes
        </h1>
        <p className="text-muted text-sm mt-1">
          Apply for a teacher account to create classes and run trading competitions.
        </p>
      </div>
      <TeacherApplicationView />
    </div>
  )

  if (selectedCls) return (
    <div className="p-6 max-w-4xl mx-auto">
      <MembersView
        cls={selectedCls}
        onBack={() => setSelectedCls(null)}
        onInvite={setInviteFor}
      />
      {inviteFor && <InviteModal cls={inviteFor} onClose={() => setInviteFor(null)} />}
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-primary font-semibold text-xl flex items-center gap-2">
            <GraduationCap size={22} className="text-accent-blue" /> My Classes
          </h1>
          <p className="text-muted text-sm mt-1">Create classes, invite students, and manage your roster.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90">
          <Plus size={16} /> New Class
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-loss text-sm bg-loss/10 border border-loss/20 rounded-xl px-4 py-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted" /></div>}

      {!loading && classes.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <GraduationCap size={40} className="text-muted mx-auto" />
          <p className="text-primary font-medium">No classes yet</p>
          <p className="text-muted text-sm">Create your first class to get started.</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90">
            Create Class
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {classes.map(cls => (
          <ClassCard key={cls.id} cls={cls}
            onSelect={setSelectedCls}
            onInvite={setInviteFor} />
        ))}
      </div>

      {showCreate && <CreateClassModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {inviteFor  && <InviteModal cls={inviteFor} onClose={() => setInviteFor(null)} />}
    </div>
  )
}
