/**
 * CustomerProfile.jsx
 * -------------------
 * A full-featured customer profile page, wired into Vantage.
 *
 * React concepts demonstrated:
 *  1. useState   — edit mode, tags, collapsible sections, loading/saving state
 *  2. useEffect  — fetch profile from backend on mount
 *  3. Conditional rendering — display vs. edit views, loading skeleton
 *  4. Controlled inputs — form fields tied to state
 *  5. Array methods — map/filter for lists
 *  6. Event handlers & component decomposition
 *  7. async/await — calling the API and handling errors
 */

import { useState, useEffect } from 'react'
import { fetchCustomerProfile, saveCustomerProfile, fetchUserActivity } from '../../common/services/apiService'
import { useAuth } from '../../common/context/AuthContext'
import {
  Mail, Phone, MapPin, Star, ShoppingBag, DollarSign,
  Clock, Edit2, Check, X, Plus, Award, TrendingUp,
  ChevronDown, ChevronUp, MessageSquare, User,
} from 'lucide-react'
import clsx from 'clsx'

// ─── Default / fallback values ────────────────────────────────────────────────

const EMPTY_CUSTOMER = {
  title:       '',
  company:     '',
  phone:       '',
  location:    '',
  loyaltyTier: 'Bronze',
  notes:       '',
  honorific:   '',
  nickname:    '',
  dob:         '',
  gender:      '',
  address:     '',
  firstName:   '',
  middleName:  '',
  lastName:    '',
}

// Build a display name from profile name parts, falling back to auth name
function buildFullName({ honorific, firstName, middleName, lastName, nickname }, authName) {
  const parts = [firstName, middleName, lastName].filter(Boolean)
  if (parts.length === 0) return authName || ''
  return [honorific, ...parts].filter(Boolean).join(' ')
}

const HONORIFICS = ['', 'Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Prof.', 'Mx.', 'Rev.']

const EMPTY_TAGS = []

const STATS = {
  totalOrders:   34,
  lifetimeValue: 8420,
  avgOrderValue: 247,
  loyaltyPoints: 2150,
  lastPurchase:  'Apr 14, 2026',
}

// ─── Audit log → activity item mapper ───────────────────────────────────────
// Maps each action key from the audit_log table to a human-readable label
// and the right lucide icon. The `details` JSONB blob provides extra context.

function formatActivity(row) {
  const d = row.details || {}
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const date = fmt.format(new Date(row.created_at))

  const map = {
    buy:               { type: 'trade',    Icon: TrendingUp,    text: () => `Bought ${d.shares ?? ''} shares of ${d.symbol ?? ''} @ $${d.price ?? ''}` },
    sell:              { type: 'trade',    Icon: DollarSign,    text: () => `Sold ${d.shares ?? ''} shares of ${d.symbol ?? ''} @ $${d.price ?? ''}` },
    agent_buy:         { type: 'trade',    Icon: TrendingUp,    text: () => `AI agent bought ${d.shares ?? ''} ${d.symbol ?? ''}` },
    agent_sell:        { type: 'trade',    Icon: DollarSign,    text: () => `AI agent sold ${d.shares ?? ''} ${d.symbol ?? ''}` },
    add_cash:          { type: 'cash',     Icon: DollarSign,    text: () => `Added $${Number(d.amount ?? 0).toLocaleString()} cash` },
    add_holding:       { type: 'trade',    Icon: ShoppingBag,   text: () => `Added holding: ${d.symbol ?? ''}` },
    remove_holding:    { type: 'trade',    Icon: ShoppingBag,   text: () => `Removed holding: ${d.symbol ?? ''}` },
    add_watchlist:     { type: 'watch',    Icon: Star,          text: () => `Added ${d.symbol ?? ''} to watchlist` },
    remove_watchlist:  { type: 'watch',    Icon: Star,          text: () => `Removed ${d.symbol ?? ''} from watchlist` },
    dashboard_pin:     { type: 'watch',    Icon: Star,          text: () => `Pinned ${d.symbol ?? ''} to dashboard` },
    dashboard_unpin:   { type: 'watch',    Icon: Star,          text: () => `Unpinned ${d.symbol ?? ''} from dashboard` },
    login:             { type: 'auth',     Icon: User,          text: () => 'Signed in' },
    signup:            { type: 'auth',     Icon: User,          text: () => 'Created account' },
    snapshot_all:      { type: 'system',   Icon: Clock,         text: () => 'Portfolio snapshot taken' },
    role_changed:      { type: 'system',   Icon: Award,         text: () => `Role updated` },
  }

  const entry = map[row.action]
  if (entry) {
    return { date, type: entry.type, Icon: entry.Icon, text: entry.text() }
  }
  // Fallback for unknown actions
  return { date, type: 'system', Icon: Clock, text: row.action.replace(/_/g, ' ') }
}

const ACTIVITY_DOT_BY_TYPE = {
  trade:   'bg-accent-blue/10   text-accent-blue',
  cash:    'bg-gain/10          text-gain',
  watch:   'bg-yellow-400/10    text-yellow-400',
  auth:    'bg-accent-purple/10 text-accent-purple',
  system:  'bg-surface-hover    text-muted',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const TIER_STYLES = {
  Bronze:   'bg-amber-100   text-amber-800   border-amber-300   dark:bg-amber-900/30  dark:text-amber-300  dark:border-amber-700',
  Silver:   'bg-slate-100   text-slate-600   border-slate-300   dark:bg-slate-700/40  dark:text-slate-300  dark:border-slate-600',
  Gold:     'bg-yellow-100  text-yellow-800  border-yellow-300  dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700',
  Platinum: 'bg-violet-100  text-violet-800  border-violet-300  dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-600',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Avatar({ name, size = 80 }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 shadow-lg"
      style={{
        width: size, height: size,
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        fontSize: size * 0.35,
        letterSpacing: '0.03em',
      }}
    >
      {getInitials(name)}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, colorClass = 'text-accent-blue', bgClass = 'bg-accent-blue/10' }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl p-4 flex flex-col gap-1.5 flex-1 min-w-[130px]">
      <div className="flex items-center gap-2">
        <div className={clsx('rounded-lg p-1.5 flex', bgClass)}>
          <Icon size={14} className={colorClass} />
        </div>
        <span className="text-xs text-muted font-medium">{label}</span>
      </div>
      <div className="text-xl font-bold text-primary">{value}</div>
    </div>
  )
}

function EditableField({ label, value, editing, onChange, type = 'text' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted font-semibold uppercase tracking-widest">{label}</span>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="border border-accent-blue/60 rounded-lg px-2.5 py-1.5 text-sm text-primary bg-surface-hover outline-none w-full focus:ring-2 focus:ring-accent-blue/30"
        />
      ) : (
        <span className="text-sm text-secondary font-medium">{value}</span>
      )}
    </div>
  )
}

function TagBadge({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 bg-accent-blue/10 text-accent-blue border border-accent-blue/20 rounded-full px-3 py-0.5 text-xs font-medium">
      {label}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-loss transition-colors flex items-center">
          <X size={11} />
        </button>
      )}
    </span>
  )
}

function Section({ title, children, collapsible = false }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
      <div
        onClick={collapsible ? () => setOpen(o => !o) : undefined}
        className={clsx(
          'flex justify-between items-center px-5 py-3.5 border-b border-border',
          collapsible && 'cursor-pointer hover:bg-surface-hover transition-colors select-none',
          !open && 'border-b-0',
        )}
      >
        <span className="font-semibold text-sm text-primary">{title}</span>
        {collapsible && (open
          ? <ChevronUp size={15} className="text-muted" />
          : <ChevronDown size={15} className="text-muted" />
        )}
      </div>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomerProfile() {
  const { user } = useAuth()
  const [customer, setCustomer]   = useState(EMPTY_CUSTOMER)
  const [draft, setDraft]         = useState(EMPTY_CUSTOMER)
  const [editing, setEditing]     = useState(false)
  const [tags, setTags]           = useState(EMPTY_TAGS)
  const [newTag, setNewTag]       = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState(null)
  const [savedOk, setSavedOk]         = useState(false)
  const [activity, setActivity]       = useState([])
  const [activityLoading, setActivityLoading] = useState(true)

  // ── Load profile + activity from backend on mount
  useEffect(() => {
    fetchCustomerProfile()
      .then(data => {
        const profile = {
          title:       data.title       ?? '',
          company:     data.company     ?? '',
          phone:       data.phone       ?? '',
          location:    data.location    ?? '',
          loyaltyTier: data.loyaltyTier ?? 'Bronze',
          notes:       data.notes       ?? '',
          honorific:   data.honorific   ?? '',
          nickname:    data.nickname    ?? '',
          dob:         data.dob         ?? '',
          gender:      data.gender      ?? '',
          address:     data.address     ?? '',
          firstName:   data.firstName   ?? '',
          middleName:  data.middleName  ?? '',
          lastName:    data.lastName    ?? '',
        }
        setCustomer(profile)
        setDraft(profile)
        setTags(Array.isArray(data.tags) ? data.tags : [])
      })
      .catch(err => console.error('Failed to load profile:', err.message))
      .finally(() => setLoading(false))

    fetchUserActivity(20)
      .then(rows => setActivity(rows.map(formatActivity)))
      .catch(err => console.error('Failed to load activity:', err.message))
      .finally(() => setActivityLoading(false))
  }, [])

  // ── Edit handlers
  const startEdit  = () => { setDraft({ ...customer }); setEditing(true); setSaveError(null); setSavedOk(false) }
  const cancelEdit = () => { setDraft({ ...customer }); setEditing(false); setSaveError(null) }

  const saveEdit = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await saveCustomerProfile({ ...draft, tags })
      setCustomer({ ...draft })
      setEditing(false)
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 3000)
    } catch (err) {
      setSaveError('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const updateDraft = field => value => setDraft(prev => ({ ...prev, [field]: value }))

  // ── Tag handlers
  const removeTag = tag => setTags(prev => prev.filter(t => t !== tag))
  const addTag    = () => {
    const trimmed = newTag.trim()
    if (trimmed && !tags.includes(trimmed)) setTags(prev => [...prev, trimmed])
    setNewTag(''); setAddingTag(false)
  }

  const tierClass = TIER_STYLES[customer.loyaltyTier] ?? TIER_STYLES.Bronze

  // ── Loading skeleton
  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex flex-col gap-5">
        <div className="flex items-center gap-2 mb-1">
          <User size={18} className="text-muted" />
          <h1 className="text-lg font-bold text-primary">Customer Profile</h1>
        </div>
        <div className="bg-surface-card border border-border rounded-xl p-6 flex gap-5 items-start animate-pulse">
          <div className="w-20 h-20 rounded-full bg-surface-hover flex-shrink-0" />
          <div className="flex-1 flex flex-col gap-3">
            <div className="h-6 w-48 bg-surface-hover rounded-lg" />
            <div className="h-4 w-64 bg-surface-hover rounded" />
            <div className="h-5 w-32 bg-surface-hover rounded-full" />
          </div>
        </div>
        <p className="text-sm text-muted text-center">Loading your profile…</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto flex flex-col gap-5">

      {/* ── Page title ── */}
      <div className="flex items-center gap-2 mb-1">
        <User size={18} className="text-muted" />
        <h1 className="text-lg font-bold text-primary">Customer Profile</h1>
      </div>

      {/* ── Save feedback ── */}
      {savedOk && (
        <div className="px-4 py-2.5 rounded-xl bg-gain/10 border border-gain/30 text-gain text-sm flex items-center gap-2">
          <Check size={15} /> Profile saved successfully.
        </div>
      )}
      {saveError && (
        <div className="px-4 py-2.5 rounded-xl bg-loss/10 border border-loss/30 text-loss text-sm">
          {saveError}
        </div>
      )}

      {/* ── Header Card ──────────────────────────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-xl p-6 flex gap-5 flex-wrap items-start">
        {/* Avatar uses the auth user's name — always available */}
        <Avatar name={user?.name || 'User'} size={84} />

        <div className="flex-1 min-w-[180px]">
          {/* Full name: built from profile name parts if set, else falls back to auth name */}
          <h2 className="text-2xl font-extrabold text-primary mb-1">
            {buildFullName(editing ? draft : customer, user?.name)}
            {(editing ? draft.nickname : customer.nickname) && (
              <span className="text-lg font-normal text-muted ml-2">
                "{editing ? draft.nickname : customer.nickname}"
              </span>
            )}
          </h2>
          <p className="text-sm text-muted mb-3">
            {(editing ? draft.title : customer.title) || 'No title set'} · {(editing ? draft.company : customer.company) || 'No company set'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border', tierClass)}>
              <Award size={11} /> {customer.loyaltyTier} Member
            </span>
            {user?.id && <span className="text-xs text-faint">ID: {user.id.slice(0, 12)}…</span>}
          </div>
        </div>

        {/* Edit / Save / Cancel */}
        <div className="flex gap-2 self-start flex-shrink-0">
          {editing ? (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-1.5 bg-gain text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {saving
                  ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Check size={13} />
                }
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="flex items-center gap-1.5 bg-loss text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                <X size={13} /> Cancel
              </button>
            </>
          ) : (
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 bg-accent-blue text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
            >
              <Edit2 size={13} /> Edit
            </button>
          )}
        </div>
      </div>

      {/* ── Stats Row ────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <StatCard icon={ShoppingBag}  label="Total Orders"   value={STATS.totalOrders}                           colorClass="text-accent-blue"   bgClass="bg-accent-blue/10"   />
        <StatCard icon={DollarSign}   label="Lifetime Value" value={`$${STATS.lifetimeValue.toLocaleString()}`}  colorClass="text-gain"          bgClass="bg-gain/10"          />
        <StatCard icon={TrendingUp}   label="Avg Order"      value={`$${STATS.avgOrderValue}`}                   colorClass="text-yellow-400"    bgClass="bg-yellow-400/10"    />
        <StatCard icon={Star}         label="Loyalty Pts"    value={STATS.loyaltyPoints.toLocaleString()}        colorClass="text-accent-purple" bgClass="bg-accent-purple/10" />
        <StatCard icon={Clock}        label="Last Purchase"  value={STATS.lastPurchase}                          colorClass="text-muted"         bgClass="bg-surface-hover"    />
      </div>

      {/* ── Two-column layout ────────────────────────────────────────── */}
      <div className="flex gap-5 flex-wrap items-start">

        {/* Left column */}
        <div className="flex flex-col gap-5 flex-1 min-w-[260px]">

          {/* Contact Info */}
          <Section title="Contact Information">
            <div className="flex flex-col gap-4">
              {/* Email is from the auth user — display only, not editable here */}
              <div className="flex items-start gap-3">
                <Mail size={15} className="text-accent-blue mt-0.5 flex-shrink-0" />
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted font-semibold uppercase tracking-widest">Email</span>
                  <span className="text-sm text-secondary font-medium">{user?.email}</span>
                </div>
              </div>
              {/* Phone and Location are editable profile fields */}
              {[
                { icon: Phone,  label: 'Phone',    field: 'phone',    type: 'tel'  },
                { icon: MapPin, label: 'Location', field: 'location', type: 'text' },
              ].map(({ icon: Icon, label, field, type }) => (
                <div key={field} className="flex items-start gap-3">
                  <Icon size={15} className="text-accent-blue mt-0.5 flex-shrink-0" />
                  <EditableField
                    label={label}
                    value={editing ? draft[field] : customer[field]}
                    editing={editing}
                    onChange={updateDraft(field)}
                    type={type}
                  />
                </div>
              ))}
            </div>
          </Section>

          {/* Personal Details */}
          <Section title="Personal Details">
            <div className="flex flex-col gap-4">

              {/* Name fields — displayed in a row */}
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-[120px]">
                  <EditableField
                    label="First Name"
                    value={editing ? draft.firstName : customer.firstName}
                    editing={editing}
                    onChange={updateDraft('firstName')}
                  />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <EditableField
                    label="Middle Name"
                    value={editing ? draft.middleName : customer.middleName}
                    editing={editing}
                    onChange={updateDraft('middleName')}
                  />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <EditableField
                    label="Last Name"
                    value={editing ? draft.lastName : customer.lastName}
                    editing={editing}
                    onChange={updateDraft('lastName')}
                  />
                </div>
              </div>

              {/* Honorific — dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted font-semibold uppercase tracking-widest">Title (Honorific)</span>
                {editing ? (
                  <select
                    value={draft.honorific}
                    onChange={e => updateDraft('honorific')(e.target.value)}
                    className="border border-accent-blue/60 rounded-lg px-2.5 py-1.5 text-sm text-primary bg-surface-hover outline-none focus:ring-2 focus:ring-accent-blue/30"
                  >
                    {HONORIFICS.map(h => (
                      <option key={h} value={h}>{h || '— None —'}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-secondary font-medium">{customer.honorific || <span className="text-muted italic">Not set</span>}</span>
                )}
              </div>

              {/* Nickname */}
              <EditableField
                label="Nickname"
                value={editing ? draft.nickname : customer.nickname}
                editing={editing}
                onChange={updateDraft('nickname')}
              />

              {/* Date of Birth */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted font-semibold uppercase tracking-widest">Date of Birth</span>
                {editing ? (
                  <input
                    type="date"
                    value={draft.dob || ''}
                    onChange={e => updateDraft('dob')(e.target.value)}
                    className="border border-accent-blue/60 rounded-lg px-2.5 py-1.5 text-sm text-primary bg-surface-hover outline-none focus:ring-2 focus:ring-accent-blue/30"
                  />
                ) : (
                  <span className="text-sm text-secondary font-medium">
                    {customer.dob
                      ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(customer.dob + 'T00:00:00'))
                      : <span className="text-muted italic">Not set</span>
                    }
                  </span>
                )}
              </div>

              {/* Gender */}
              <EditableField
                label="Gender"
                value={editing ? draft.gender : customer.gender}
                editing={editing}
                onChange={updateDraft('gender')}
              />

              {/* Address */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted font-semibold uppercase tracking-widest">Address</span>
                {editing ? (
                  <textarea
                    value={draft.address || ''}
                    onChange={e => updateDraft('address')(e.target.value)}
                    rows={3}
                    placeholder="Street, city, state, zip…"
                    className="border border-accent-blue/60 rounded-lg px-2.5 py-1.5 text-sm text-primary bg-surface-hover outline-none resize-y focus:ring-2 focus:ring-accent-blue/30"
                  />
                ) : (
                  <span className="text-sm text-secondary font-medium whitespace-pre-line">
                    {customer.address || <span className="text-muted italic">Not set</span>}
                  </span>
                )}
              </div>

            </div>
          </Section>

          {/* Tags */}
          <Section title="Tags">
            <div className="flex flex-wrap gap-2 items-center">
              {tags.map(tag => (
                <TagBadge key={tag} label={tag} onRemove={() => removeTag(tag)} />
              ))}

              {addingTag ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') setAddingTag(false) }}
                    placeholder="New tag…"
                    className="border border-accent-blue/60 rounded-full px-3 py-0.5 text-xs bg-surface-hover text-primary outline-none w-24 focus:ring-1 focus:ring-accent-blue/40"
                  />
                  <button onClick={addTag}         className="w-5 h-5 rounded-full bg-gain  flex items-center justify-center text-white"><Check size={10} /></button>
                  <button onClick={() => setAddingTag(false)} className="w-5 h-5 rounded-full bg-surface-hover flex items-center justify-center text-muted"><X size={10} /></button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingTag(true)}
                  className="inline-flex items-center gap-1 border border-dashed border-border text-muted rounded-full px-3 py-0.5 text-xs hover:border-accent-blue/40 hover:text-accent-blue transition-colors"
                >
                  <Plus size={11} /> Add tag
                </button>
              )}
            </div>
          </Section>

          {/* Notes */}
          <Section title="Internal Notes">
            {editing ? (
              <textarea
                value={draft.notes}
                onChange={e => updateDraft('notes')(e.target.value)}
                rows={4}
                className="w-full border border-accent-blue/60 rounded-lg px-3 py-2 text-sm text-primary bg-surface-hover outline-none resize-y focus:ring-2 focus:ring-accent-blue/30"
              />
            ) : (
              <p className="text-sm text-secondary leading-relaxed">
                {customer.notes || <span className="text-muted italic">No notes yet.</span>}
              </p>
            )}
          </Section>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-5 flex-1 min-w-[260px]">

          {/* Activity Feed — live from audit_log */}
          <Section title="Recent Activity" collapsible>
            {activityLoading ? (
              <div className="flex flex-col gap-3 animate-pulse">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-full bg-surface-hover flex-shrink-0" />
                    <div className="flex flex-col gap-1.5 flex-1">
                      <div className="h-3.5 bg-surface-hover rounded w-3/4" />
                      <div className="h-3 bg-surface-hover rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted italic">No activity recorded yet.</p>
            ) : (
              <div className="flex flex-col">
                {activity.map((item, idx) => {
                  const dotClass = ACTIVITY_DOT_BY_TYPE[item.type] ?? 'bg-surface-hover text-muted'
                  const isLast   = idx === activity.length - 1
                  return (
                    <div key={idx} className="flex gap-3 relative">
                      {!isLast && (
                        <div className="absolute left-[14px] top-8 w-0.5 h-full bg-border" />
                      )}
                      <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10', dotClass)}>
                        <item.Icon size={13} />
                      </div>
                      <div className={clsx('pb-5 flex-1', isLast && 'pb-0')}>
                        <p className="text-sm text-secondary font-medium leading-snug capitalize">{item.text}</p>
                        <p className="text-xs text-muted mt-0.5">{item.date}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

        </div>
      </div>
    </div>
  )
}
