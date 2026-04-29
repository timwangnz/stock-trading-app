/**
 * Campaigns.jsx
 * Admin-only marketing campaign tool.
 *
 * Features:
 *  - Campaign list with status badges
 *  - Create / Edit modal with:
 *    • Natural-language audience builder (LLM → filter JSON → live preview)
 *    • Composer: Manual ({{token}}) or AI (prompt per user)
 *    • Send Now or Schedule toggle
 *  - Send history per campaign (expandable)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Megaphone, Plus, Trash2, Send, Eye, Clock, CheckCircle2,
  AlertCircle, Loader2, ChevronDown, ChevronUp, X, RefreshCw,
  Users, Wand2, Mail, Calendar, Sparkles, RotateCcw,
} from 'lucide-react'
import { useAuth } from '../../common/context/AuthContext'
import clsx from 'clsx'

// ── API helpers ────────────────────────────────────────────────────

const authHeader = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

async function apiFetch(path, token, opts = {}) {
  const res = await fetch(path, { headers: authHeader(token), ...opts })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

// ── Status meta ────────────────────────────────────────────────────

const STATUS_META = {
  draft:     { label: 'Draft',    color: 'text-muted    bg-surface-hover border-border',        icon: null          },
  sending:   { label: 'Sending…', color: 'text-blue-400 bg-blue-400/10   border-blue-400/20',   icon: Loader2       },
  sent:      { label: 'Sent',     color: 'text-gain     bg-gain/10        border-gain/20',       icon: CheckCircle2  },
  scheduled: { label: 'Sched.',   color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20', icon: Clock        },
  failed:    { label: 'Failed',   color: 'text-loss     bg-loss/10        border-loss/20',       icon: AlertCircle   },
}

function StatusBadge({ status }) {
  const { label, color, icon: Icon } = STATUS_META[status] ?? STATUS_META.draft
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium', color)}>
      {Icon && <Icon size={11} className={status === 'sending' ? 'animate-spin' : ''} />}
      {label}
    </span>
  )
}

function fmt(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

// ── CampaignModal ──────────────────────────────────────────────────

const BLANK = {
  title: '', subject: '', compose_mode: 'manual',
  body_template: '', ai_prompt: '', audience_desc: '', audience_filter: null,
  scheduled_at: '',
}

function CampaignModal({ campaign, token, onClose, onSaved }) {
  const [form,      setForm]      = useState(() => campaign ? { ...campaign, scheduled_at: campaign.scheduled_at ? campaign.scheduled_at.slice(0, 16) : '' } : { ...BLANK })
  const [step,      setStep]      = useState('audience') // 'audience' | 'compose' | 'confirm'
  const [audience,  setAudience]  = useState(null)       // { count, users, filter }
  const [nlInput,   setNlInput]   = useState(campaign?.audience_desc ?? '')
  const [parsing,   setParsing]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [preview,   setPreview]   = useState(null)       // { subject, body, recipient }
  const [previewing,setPreviewing]= useState(false)
  const [err,       setErr]       = useState(null)

  const isEdit = !!campaign?.id

  // If editing, pre-load audience count
  useEffect(() => {
    if (isEdit && campaign.audience_filter) {
      apiFetch(`/api/admin/campaigns/${campaign.id}/preview`, token, { method: 'POST' })
        .then(d => setAudience({ count: d.count, users: d.users, filter: campaign.audience_filter }))
        .catch(() => {})
    }
  }, []) // eslint-disable-line

  const parseAudience = async () => {
    if (!nlInput.trim()) return
    setParsing(true); setErr(null)
    try {
      const d = await apiFetch('/api/admin/campaigns/parse-audience', token, {
        method: 'POST',
        body: JSON.stringify({ description: nlInput }),
      })
      setAudience({ count: d.count, users: d.users, filter: d.filter })
      setForm(f => ({ ...f, audience_desc: nlInput, audience_filter: d.filter }))
    } catch (e) { setErr(e.message) }
    finally { setParsing(false) }
  }

  const save = async () => {
    if (!form.title.trim()) { setErr('Title is required'); return }
    setSaving(true); setErr(null)
    try {
      const body = {
        title:           form.title,
        subject:         form.subject,
        compose_mode:    form.compose_mode,
        body_template:   form.body_template,
        ai_prompt:       form.ai_prompt,
        audience_desc:   form.audience_desc,
        audience_filter: audience?.filter ?? form.audience_filter ?? null,
        scheduled_at:    form.scheduled_at || null,
      }
      let saved
      if (isEdit) {
        saved = await apiFetch(`/api/admin/campaigns/${campaign.id}`, token, {
          method: 'PATCH', body: JSON.stringify(body),
        })
      } else {
        saved = await apiFetch('/api/admin/campaigns', token, {
          method: 'POST', body: JSON.stringify(body),
        })
      }
      onSaved(saved)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const previewEmail = async () => {
    setPreviewing(true); setErr(null); setPreview(null)
    try {
      // Save first so server has latest state
      await save()
      const d = await apiFetch(`/api/admin/campaigns/${campaign?.id ?? 'new'}/preview-email`, token, { method: 'POST' })
      setPreview(d)
    } catch (e) { setErr(e.message) }
    finally { setPreviewing(false) }
  }

  const field = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-accent-blue" />
            <h2 className="text-primary font-semibold">{isEdit ? 'Edit Campaign' : 'New Campaign'}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary transition-colors"><X size={18} /></button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          {[['audience', Users, 'Audience'], ['compose', Mail, 'Compose'], ['confirm', Send, 'Send']].map(([s, Icon, label]) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 py-3 text-sm transition-colors border-b-2',
                step === s
                  ? 'border-accent-blue text-accent-blue font-medium'
                  : 'border-transparent text-muted hover:text-primary'
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Step: Audience ── */}
          {step === 'audience' && (
            <>
              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium">Campaign Title *</label>
                <input
                  value={form.title}
                  onChange={field('title')}
                  placeholder="e.g. Q2 Re-engagement — High Value"
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted/50 focus:outline-none focus:border-accent-blue"
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium flex items-center gap-1.5">
                  <Sparkles size={12} className="text-purple-400" />
                  Describe your audience in plain English
                </label>
                <div className="flex gap-2">
                  <textarea
                    rows={3}
                    value={nlInput}
                    onChange={e => setNlInput(e.target.value)}
                    placeholder='e.g. "Users who joined more than 30 days ago, made at least 5 trades, and have a portfolio over $10k"'
                    className="flex-1 bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted/50 focus:outline-none focus:border-accent-blue resize-none"
                  />
                </div>
                <button
                  onClick={parseAudience}
                  disabled={parsing || !nlInput.trim()}
                  className="mt-2 flex items-center gap-2 px-4 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg text-sm hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {parsing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  {parsing ? 'Building…' : 'Build Audience'}
                </button>
              </div>

              {audience && (
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-medium text-primary flex items-center gap-2">
                      <Users size={14} className="text-accent-blue" />
                      {audience.count} matching {audience.count === 1 ? 'user' : 'users'}
                    </span>
                    {audience.filter && (
                      <span className="text-xs text-muted font-mono">
                        {audience.filter.conditions?.length ?? 0} condition{(audience.filter.conditions?.length ?? 0) !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {audience.users?.length > 0 && (
                    <div className="max-h-48 overflow-y-auto divide-y divide-border">
                      {audience.users.slice(0, 15).map(u => (
                        <div key={u.id} className="flex items-center justify-between px-4 py-2.5">
                          <div>
                            <p className="text-sm text-primary">{u.name}</p>
                            <p className="text-xs text-muted">{u.email}</p>
                          </div>
                          <span className="text-xs text-gain font-mono">{fmt(u.portfolio_value)}</span>
                        </div>
                      ))}
                      {audience.count > 15 && (
                        <p className="px-4 py-2 text-xs text-muted text-center">
                          + {audience.count - 15} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Step: Compose ── */}
          {step === 'compose' && (
            <>
              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium">Subject Line</label>
                <input
                  value={form.subject}
                  onChange={field('subject')}
                  placeholder="Your subject — {{name}}, {{portfolio_value}}, etc."
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted/50 focus:outline-none focus:border-accent-blue"
                />
              </div>

              {/* Mode toggle */}
              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium">Compose Mode</label>
                <div className="flex bg-surface border border-border rounded-lg overflow-hidden w-fit">
                  {['manual', 'ai'].map(m => (
                    <button
                      key={m}
                      onClick={() => setForm(f => ({ ...f, compose_mode: m }))}
                      className={clsx(
                        'px-4 py-2 text-sm transition-colors',
                        form.compose_mode === m
                          ? 'bg-accent-blue text-white font-medium'
                          : 'text-muted hover:text-primary'
                      )}
                    >
                      {m === 'manual' ? '✏️ Manual' : '✨ AI'}
                    </button>
                  ))}
                </div>
              </div>

              {form.compose_mode === 'manual' ? (
                <>
                  <div>
                    <label className="block text-xs text-muted mb-1.5 font-medium">Email Body</label>
                    <textarea
                      rows={10}
                      value={form.body_template}
                      onChange={field('body_template')}
                      placeholder={"Hi {{name}},\n\nYour portfolio is currently worth {{portfolio_value}}...\n\nBest,\nThe TradeBuddy Team"}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted/50 focus:outline-none focus:border-accent-blue resize-none font-mono"
                    />
                  </div>
                  <div className="bg-surface-hover rounded-lg px-4 py-3">
                    <p className="text-xs text-muted font-medium mb-2">Available tokens</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['{{name}}','{{email}}','{{portfolio_value}}','{{cash}}','{{top_holding}}','{{trade_count}}','{{date}}'].map(t => (
                        <code key={t} className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-accent-blue">{t}</code>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-muted mb-1.5 font-medium">AI Prompt</label>
                    <textarea
                      rows={7}
                      value={form.ai_prompt}
                      onChange={field('ai_prompt')}
                      placeholder={"Write a re-engagement email for {{name}} whose portfolio is worth {{portfolio_value}} with their largest position in {{top_holding}}. Keep it under 150 words, friendly and encouraging."}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted/50 focus:outline-none focus:border-accent-blue resize-none"
                    />
                  </div>
                  <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg px-4 py-3">
                    <p className="text-xs text-purple-400 font-medium mb-1">AI mode — one LLM call per recipient</p>
                    <p className="text-xs text-muted">Tokens in the prompt are substituted before sending to the LLM. Each user gets a unique, personalised email.</p>
                  </div>

                  {isEdit && (
                    <button
                      onClick={previewEmail}
                      disabled={previewing}
                      className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-sm text-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    >
                      {previewing ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                      Preview first recipient's email
                    </button>
                  )}

                  {preview && (
                    <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
                      <p className="text-xs text-muted">Preview for <strong className="text-primary">{preview.recipient?.name}</strong></p>
                      <p className="text-xs text-muted">Subject: <span className="text-primary">{preview.subject}</span></p>
                      <div className="bg-surface-hover rounded-lg p-3 text-sm text-primary whitespace-pre-wrap leading-relaxed">
                        {preview.body}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Step: Send ── */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-primary">Campaign Summary</h3>
                <div className="space-y-1.5 text-sm">
                  <Row label="Title"    value={form.title || '—'} />
                  <Row label="Subject"  value={form.subject || '—'} />
                  <Row label="Mode"     value={form.compose_mode === 'ai' ? '✨ AI (per-user)' : '✏️ Manual'} />
                  <Row label="Audience" value={audience ? `${audience.count} recipients` : 'Not set'} />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium">Schedule (optional — leave blank to send now)</label>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-muted flex-shrink-0" />
                  <input
                    type="datetime-local"
                    value={form.scheduled_at}
                    onChange={field('scheduled_at')}
                    className="bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-primary focus:outline-none focus:border-accent-blue"
                  />
                  {form.scheduled_at && (
                    <button onClick={() => setForm(f => ({ ...f, scheduled_at: '' }))} className="text-muted hover:text-primary">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {!audience && (
                <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-3 py-2.5">
                  <AlertCircle size={14} /> No audience defined — go back to the Audience step.
                </div>
              )}
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 text-sm text-loss bg-loss/10 border border-loss/20 rounded-lg px-3 py-2.5">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between flex-shrink-0">
          <button onClick={onClose} className="text-sm text-muted hover:text-primary transition-colors">Cancel</button>
          <div className="flex items-center gap-2">
            {step !== 'audience' && (
              <button
                onClick={() => setStep(s => s === 'confirm' ? 'compose' : 'audience')}
                className="px-4 py-2 text-sm text-muted hover:text-primary border border-border rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            {step !== 'confirm' ? (
              <button
                onClick={() => setStep(s => s === 'audience' ? 'compose' : 'confirm')}
                className="px-4 py-2 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 transition-colors"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                {isEdit ? 'Save Changes' : 'Save Draft'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted flex-shrink-0 w-20">{label}</span>
      <span className="text-primary text-right">{value}</span>
    </div>
  )
}

// ── SendHistory ────────────────────────────────────────────────────

function SendHistory({ campaignId, token }) {
  const [rows,    setRows]    = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await apiFetch(`/api/admin/campaigns/${campaignId}/sends`, token)
      setRows(data)
    } catch { setRows([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [campaignId]) // eslint-disable-line

  if (loading) return <div className="py-4 flex justify-center"><Loader2 size={16} className="animate-spin text-muted" /></div>
  if (!rows?.length) return <p className="py-3 text-sm text-muted text-center">No send records yet.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted border-b border-border">
            <th className="text-left py-2 pr-4 font-medium">Recipient</th>
            <th className="text-left py-2 pr-4 font-medium">Email</th>
            <th className="text-left py-2 pr-4 font-medium">Status</th>
            <th className="text-left py-2 font-medium">Sent At</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(r => (
            <tr key={r.id}>
              <td className="py-2 pr-4 text-primary">{r.name}</td>
              <td className="py-2 pr-4 text-muted">{r.email}</td>
              <td className="py-2 pr-4">
                <StatusBadge status={r.status} />
                {r.error && <p className="text-loss text-xs mt-0.5 max-w-xs truncate" title={r.error}>{r.error}</p>}
              </td>
              <td className="py-2 text-muted">
                {r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── CampaignRow ────────────────────────────────────────────────────

function CampaignRow({ c, token, onEdit, onDeleted, onSent }) {
  const [expanded, setExpanded] = useState(false)
  const [sending,  setSending]  = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err,      setErr]      = useState(null)

  const send = async () => {
    if (!confirm(`Send "${c.title}" to ${c.recipient_count ?? '?'} recipients now?`)) return
    setSending(true); setErr(null)
    try {
      const result = await apiFetch(`/api/admin/campaigns/${c.id}/send`, token, { method: 'POST' })
      onSent(c.id, result)
    } catch (e) { setErr(e.message) }
    finally { setSending(false) }
  }

  const del = async () => {
    if (!confirm(`Delete draft "${c.title}"?`)) return
    setDeleting(true)
    try {
      await apiFetch(`/api/admin/campaigns/${c.id}`, token, { method: 'DELETE' })
      onDeleted(c.id)
    } catch (e) { setErr(e.message) }
    finally { setDeleting(false) }
  }

  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-muted hover:text-primary transition-colors flex-shrink-0"
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-primary font-medium text-sm truncate">{c.title}</span>
            <StatusBadge status={c.status} />
            {c.compose_mode === 'ai' && (
              <span className="text-xs text-purple-400 bg-purple-400/10 border border-purple-400/20 px-1.5 py-0.5 rounded-full">AI</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted">
            {c.subject && <span className="truncate max-w-xs">{c.subject}</span>}
            {c.recipient_count != null && <span className="flex-shrink-0">{c.recipient_count} sent</span>}
            {c.sent_at && <span className="flex-shrink-0">{new Date(c.sent_at).toLocaleDateString()}</span>}
            {c.scheduled_at && !c.sent_at && (
              <span className="flex-shrink-0 flex items-center gap-1 text-yellow-400">
                <Clock size={10} /> {new Date(c.scheduled_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {c.status === 'draft' && (
            <>
              <button
                onClick={() => onEdit(c)}
                className="p-1.5 text-muted hover:text-primary transition-colors rounded-lg hover:bg-surface-hover"
                title="Edit"
              >
                <Wand2 size={14} />
              </button>
              <button
                onClick={send}
                disabled={sending}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                Send
              </button>
              <button
                onClick={del}
                disabled={deleting}
                className="p-1.5 text-muted hover:text-loss transition-colors rounded-lg hover:bg-loss/10"
                title="Delete draft"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </>
          )}
          {c.status === 'sent' && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted border border-border rounded-lg hover:bg-surface-hover transition-colors"
            >
              <Eye size={11} /> History
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="px-4 pb-3 text-xs text-loss">{err}</div>
      )}

      {expanded && (
        <div className="border-t border-border px-4 py-4">
          <SendHistory campaignId={c.id} token={token} />
        </div>
      )}
    </div>
  )
}

// ── Campaigns (main page) ─────────────────────────────────────────

export default function Campaigns() {
  const { token, isAdmin }        = useAuth()
  const [campaigns, setCampaigns] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modalCamp, setModalCamp] = useState(null) // null = closed, {} = new, {...} = edit

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/api/admin/campaigns', token)
      setCampaigns(data)
    } catch { setCampaigns([]) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  if (!isAdmin) return (
    <div className="flex items-center justify-center h-full text-muted text-sm">
      Admin access required.
    </div>
  )

  const handleSaved = (saved) => {
    setCampaigns(cs => {
      const idx = cs.findIndex(c => c.id === saved.id)
      if (idx >= 0) { const n = [...cs]; n[idx] = saved; return n }
      return [saved, ...cs]
    })
    setModalCamp(null)
  }

  const handleDeleted = (id) => setCampaigns(cs => cs.filter(c => c.id !== id))

  const handleSent = (id, result) => {
    setCampaigns(cs => cs.map(c => c.id === id
      ? { ...c, status: 'sent', sent_at: new Date().toISOString(), recipient_count: result.sent }
      : c
    ))
  }

  const drafts    = campaigns.filter(c => c.status === 'draft')
  const scheduled = campaigns.filter(c => c.status === 'scheduled')
  const sent      = campaigns.filter(c => c.status === 'sent')
  const other     = campaigns.filter(c => !['draft','scheduled','sent'].includes(c.status))

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone size={22} className="text-accent-blue" />
          <div>
            <h1 className="text-xl font-semibold text-primary">Campaigns</h1>
            <p className="text-sm text-muted mt-0.5">Segment users and send personalised emails</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-muted hover:text-primary transition-colors rounded-lg hover:bg-surface-hover">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setModalCamp({})}
            className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white text-sm rounded-lg hover:bg-accent-blue/90 transition-colors"
          >
            <Plus size={15} /> New Campaign
          </button>
        </div>
      </div>

      {loading && campaigns.length === 0 && (
        <div className="py-16 flex justify-center">
          <Loader2 size={24} className="animate-spin text-muted" />
        </div>
      )}

      {!loading && campaigns.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 text-center">
          <Megaphone size={36} className="text-muted/30" />
          <p className="text-muted">No campaigns yet.</p>
          <button
            onClick={() => setModalCamp({})}
            className="text-sm text-accent-blue hover:underline"
          >
            Create your first campaign →
          </button>
        </div>
      )}

      {/* Drafts */}
      {drafts.length > 0 && (
        <Section title="Drafts" count={drafts.length}>
          {drafts.map(c => (
            <CampaignRow
              key={c.id} c={c} token={token}
              onEdit={setModalCamp}
              onDeleted={handleDeleted}
              onSent={handleSent}
            />
          ))}
        </Section>
      )}

      {/* Scheduled */}
      {scheduled.length > 0 && (
        <Section title="Scheduled" count={scheduled.length}>
          {scheduled.map(c => (
            <CampaignRow
              key={c.id} c={c} token={token}
              onEdit={setModalCamp}
              onDeleted={handleDeleted}
              onSent={handleSent}
            />
          ))}
        </Section>
      )}

      {/* Sent */}
      {sent.length > 0 && (
        <Section title="Sent" count={sent.length}>
          {sent.map(c => (
            <CampaignRow
              key={c.id} c={c} token={token}
              onEdit={() => {}}
              onDeleted={handleDeleted}
              onSent={handleSent}
            />
          ))}
        </Section>
      )}

      {/* Other (sending/failed) */}
      {other.length > 0 && (
        <Section title="Other" count={other.length}>
          {other.map(c => (
            <CampaignRow
              key={c.id} c={c} token={token}
              onEdit={setModalCamp}
              onDeleted={handleDeleted}
              onSent={handleSent}
            />
          ))}
        </Section>
      )}

      {/* Modal */}
      {modalCamp !== null && (
        <CampaignModal
          campaign={modalCamp?.id ? modalCamp : null}
          token={token}
          onClose={() => setModalCamp(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

function Section({ title, count, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">{title}</h2>
        <span className="text-xs text-muted bg-surface-hover border border-border rounded-full px-1.5 py-0.5">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
