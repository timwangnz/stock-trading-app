/**
 * Classroom.jsx
 * Teacher view: create and manage classes, send student invites,
 * see members and their portfolio values.
 */

import { useState, useEffect } from 'react'
import {
  GraduationCap, Plus, Mail, Users, Settings, ChevronRight,
  Copy, Check, Loader2, AlertCircle, Globe, Lock,
} from 'lucide-react'
import {
  createClass, fetchManagedClasses, fetchClassDetail, sendInvites, updateClass,
} from '../services/apiService'
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

// ── Members view ──────────────────────────────────────────────────
function MembersView({ cls, onBack }) {
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetchClassDetail(cls.id)
      .then(setDetail)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [cls.id])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted hover:text-primary text-sm flex items-center gap-1">
          ← Back
        </button>
        <h2 className="text-primary font-semibold">{cls.name} — Members</h2>
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted" /></div>}
      {error   && <p className="text-loss text-sm">{error}</p>}

      {detail && (
        <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted text-xs">
                <th className="text-left px-4 py-3">Student</th>
                <th className="text-right px-4 py-3">Base Value</th>
                <th className="text-right px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.members?.length === 0 && (
                <tr><td colSpan={3} className="text-center text-muted py-6 text-sm">No members yet — send some invites!</td></tr>
              )}
              {detail.members?.map(m => (
                <tr key={m.id} className="hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-3 text-primary font-medium">{m.name || m.email}</td>
                  <td className="px-4 py-3 text-right text-secondary">{fmt(m.base_value)}</td>
                  <td className="px-4 py-3 text-right text-muted text-xs">
                    {new Date(m.joined_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function Classroom() {
  const [classes,     setClasses]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showCreate,  setShowCreate]  = useState(false)
  const [inviteFor,   setInviteFor]   = useState(null)
  const [selectedCls, setSelectedCls] = useState(null)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    fetchManagedClasses()
      .then(setClasses)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleCreated = (cls) => {
    setClasses(prev => [{ ...cls, member_count: 0 }, ...prev])
    setShowCreate(false)
  }

  if (selectedCls) return (
    <div className="p-6 max-w-4xl mx-auto">
      <MembersView cls={selectedCls} onBack={() => setSelectedCls(null)} />
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
