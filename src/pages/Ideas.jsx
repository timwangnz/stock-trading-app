/**
 * Ideas.jsx
 * Trading ideas feed — students post structured trade calls (BUY/SELL),
 * classmates can like them, and the app tracks whether each call hit or missed.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Lightbulb, TrendingUp, TrendingDown, Heart, Trash2,
  Plus, Loader2, AlertCircle, Clock, CheckCircle, XCircle,
} from 'lucide-react'
import {
  fetchMyClasses, fetchIdeas, postIdea, toggleIdeaLike, deleteIdea,
} from '../services/apiService'
import { useApp } from '../context/AppContext'
import clsx from 'clsx'

const TIMEFRAMES = [
  { days: 7,  label: '1 week'   },
  { days: 14, label: '2 weeks'  },
  { days: 30, label: '1 month'  },
  { days: 90, label: '3 months' },
]

const fmt    = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPct = (n) => {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`
}

function OutcomeBadge({ outcome, direction, entryPrice, targetPrice }) {
  const pct = entryPrice > 0
    ? ((targetPrice - entryPrice) / entryPrice) * 100 * (direction === 'SELL' ? -1 : 1)
    : 0

  if (outcome === 'hit') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gain/10 text-gain border border-gain/30">
      <CheckCircle size={9} /> Hit {fmtPct(pct)}
    </span>
  )
  if (outcome === 'missed') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-loss/10 text-loss border border-loss/30">
      <XCircle size={9} /> Missed
    </span>
  )
  if (outcome === 'expired') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-hover text-muted border border-border">
      <Clock size={9} /> Expired
    </span>
  )
  // pending
  const daysLeft = Math.max(0, Math.ceil((new Date(Date.now()) - new Date()) / 864e5))
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue border border-accent-blue/30">
      <Clock size={9} /> Pending
    </span>
  )
}

// ── Post idea form ────────────────────────────────────────────────
function PostIdeaForm({ classId, onPosted }) {
  const [form, setForm]   = useState({ symbol: '', direction: 'BUY', target_price: '', timeframe_days: 30, rationale: '' })
  const [posting, setPosting] = useState(false)
  const [error,   setError]   = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.symbol || !form.target_price) return setError('Symbol and target price are required')
    setPosting(true); setError(null)
    try {
      const idea = await postIdea({ class_id: classId, ...form, symbol: form.symbol.toUpperCase() })
      onPosted(idea)
      setForm({ symbol: '', direction: 'BUY', target_price: '', timeframe_days: 30, rationale: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-4">
      <h2 className="text-primary font-semibold text-sm flex items-center gap-2">
        <Plus size={15} className="text-accent-blue" /> Post a Trade Call
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          {/* Direction toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button type="button"
              onClick={() => set('direction', 'BUY')}
              className={clsx('px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-1.5',
                form.direction === 'BUY' ? 'bg-gain text-white' : 'text-muted hover:bg-surface-hover')}>
              <TrendingUp size={14} /> BUY
            </button>
            <button type="button"
              onClick={() => set('direction', 'SELL')}
              className={clsx('px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-1.5',
                form.direction === 'SELL' ? 'bg-loss text-white' : 'text-muted hover:bg-surface-hover')}>
              <TrendingDown size={14} /> SELL
            </button>
          </div>
          {/* Ticker */}
          <input
            className="flex-1 bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm font-mono uppercase focus:outline-none focus:border-accent-blue"
            placeholder="AAPL" maxLength={10}
            value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())}
          />
        </div>

        <div className="flex gap-2">
          {/* Target price */}
          <div className="flex-1">
            <label className="text-muted text-xs mb-1 block">Target Price ($)</label>
            <input type="number" step="0.01" min="0"
              className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              placeholder="150.00"
              value={form.target_price} onChange={e => set('target_price', e.target.value)}
            />
          </div>
          {/* Timeframe */}
          <div className="flex-1">
            <label className="text-muted text-xs mb-1 block">Timeframe</label>
            <select
              className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue"
              value={form.timeframe_days} onChange={e => set('timeframe_days', Number(e.target.value))}>
              {TIMEFRAMES.map(t => <option key={t.days} value={t.days}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {/* Rationale */}
        <textarea
          className="w-full h-20 bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue resize-none"
          placeholder="Why do you think this will move? (optional)"
          value={form.rationale} onChange={e => set('rationale', e.target.value)}
        />

        {error && <p className="text-loss text-xs">{error}</p>}

        <button type="submit" disabled={posting}
          className="w-full py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
          {posting ? <Loader2 size={14} className="animate-spin" /> : <Lightbulb size={14} />}
          Post Call
        </button>
      </form>
    </div>
  )
}

// ── Idea card ─────────────────────────────────────────────────────
function IdeaCard({ idea, currentUserId, onLike, onDelete }) {
  const isBuy    = idea.direction === 'BUY'
  const isPending = idea.outcome === 'pending'
  const isOwner  = idea.user_id === currentUserId

  const targetPct = idea.entry_price > 0
    ? ((idea.target_price - idea.entry_price) / idea.entry_price) * 100
    : 0
  const adjustedPct = isBuy ? targetPct : -targetPct

  return (
    <div className="bg-surface-card border border-border rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {idea.author_avatar
            ? <img src={idea.author_avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
            : <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-xs font-bold">
                {(idea.author_name || '?')[0].toUpperCase()}
              </div>
          }
          <div>
            <p className="text-primary text-sm font-medium">{idea.author_name || 'Student'}</p>
            <p className="text-muted text-xs">{new Date(idea.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <OutcomeBadge
          outcome={idea.outcome}
          direction={idea.direction}
          entryPrice={parseFloat(idea.entry_price)}
          targetPrice={parseFloat(idea.target_price)}
        />
      </div>

      {/* Trade call */}
      <div className="flex items-center gap-3">
        <span className={clsx('flex items-center gap-1 text-sm font-bold px-3 py-1 rounded-lg',
          isBuy ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss')}>
          {isBuy ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {idea.direction}
        </span>
        <span className="text-primary font-bold text-lg font-mono">{idea.symbol}</span>
        <div className="text-sm text-secondary">
          <span className="text-muted">entry </span>{fmt(idea.entry_price)}
          <span className="text-muted mx-1">→</span>
          <span className={adjustedPct >= 0 ? 'text-gain font-medium' : 'text-loss font-medium'}>
            {fmt(idea.target_price)}
          </span>
          <span className={clsx('ml-1 text-xs', adjustedPct >= 0 ? 'text-gain' : 'text-loss')}>
            ({fmtPct(adjustedPct)})
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted">
        <Clock size={10} />
        {TIMEFRAMES.find(t => t.days === idea.timeframe_days)?.label ?? `${idea.timeframe_days}d`} call
        {idea.resolved_price && (
          <span className="ml-1">· resolved at {fmt(idea.resolved_price)}</span>
        )}
      </div>

      {/* Rationale */}
      {idea.rationale && (
        <p className="text-secondary text-sm leading-relaxed border-l-2 border-border pl-3">
          {idea.rationale}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <button onClick={() => onLike(idea.id)}
          className={clsx('flex items-center gap-1.5 text-xs transition-colors',
            idea.liked_by_me ? 'text-loss' : 'text-muted hover:text-loss')}>
          <Heart size={13} fill={idea.liked_by_me ? 'currentColor' : 'none'} />
          {idea.likes > 0 ? idea.likes : ''} {idea.likes === 1 ? 'like' : idea.likes > 1 ? 'likes' : 'Like'}
        </button>
        {isOwner && isPending && (
          <button onClick={() => onDelete(idea.id)}
            className="text-muted hover:text-loss text-xs flex items-center gap-1">
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function Ideas() {
  const { state }   = useApp()
  const currentUser = state.user

  const [classes,  setClasses]  = useState([])
  const [classId,  setClassId]  = useState(null)
  const [ideas,    setIdeas]    = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    fetchMyClasses()
      .then(cls => {
        setClasses(cls)
        if (cls.length) setClassId(cls[0].class_id ?? cls[0].id)
      })
      .catch(() => {})
  }, [])

  const loadIdeas = useCallback(async () => {
    if (!classId) return
    setLoading(true); setError(null)
    try {
      setIdeas(await fetchIdeas(classId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => { loadIdeas() }, [loadIdeas])

  const handlePosted = (idea) => setIdeas(prev => [idea, ...prev])

  const handleLike = async (ideaId) => {
    try {
      const res = await toggleIdeaLike(ideaId)
      setIdeas(prev => prev.map(i => i.id === ideaId
        ? { ...i, liked_by_me: res.liked, likes: res.liked ? i.likes + 1 : i.likes - 1 }
        : i))
    } catch (_) {}
  }

  const handleDelete = async (ideaId) => {
    try {
      await deleteIdea(ideaId)
      setIdeas(prev => prev.filter(i => i.id !== ideaId))
    } catch (_) {}
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-primary font-semibold text-xl flex items-center gap-2">
            <Lightbulb size={22} className="text-yellow-400" /> Trading Ideas
          </h1>
          <p className="text-muted text-sm mt-1">Post your trade calls and see how they play out</p>
        </div>
        {classes.length > 1 && (
          <select
            value={classId ?? ''}
            onChange={e => setClassId(Number(e.target.value))}
            className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue">
            {classes.map(c => (
              <option key={c.class_id ?? c.id} value={c.class_id ?? c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {!classId && !loading && (
        <div className="text-center py-16 space-y-2">
          <Lightbulb size={40} className="text-muted mx-auto" />
          <p className="text-primary font-medium">You're not in a class yet</p>
          <p className="text-muted text-sm">Ask your teacher for an invite link to join a class and start sharing ideas.</p>
        </div>
      )}

      {classId && (
        <>
          <PostIdeaForm classId={classId} onPosted={handlePosted} />

          {error && (
            <div className="flex items-center gap-2 text-loss text-sm bg-loss/10 border border-loss/20 rounded-xl px-4 py-3">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted" /></div>}

          {!loading && ideas.length === 0 && (
            <div className="text-center py-12 text-muted text-sm">
              No ideas yet — be the first to post a trade call!
            </div>
          )}

          <div className="space-y-4">
            {ideas.map(idea => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                currentUserId={currentUser?.id}
                onLike={handleLike}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
