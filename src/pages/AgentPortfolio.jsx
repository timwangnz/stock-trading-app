/**
 * AgentPortfolio.jsx
 * Autopilot portfolio page.
 *
 * States:
 *  - Not configured → Setup wizard (starting cash, bias, frequency)
 *  - Configured     → Dashboard (holdings, P&L, next run, decisions log)
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Bot, Play, Pause, RotateCcw, Settings, TrendingUp, TrendingDown,
  Clock, Zap, ChevronDown, ChevronUp, AlertCircle, CheckCircle2,
  BarChart3, Sparkles, RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'

const API = (path, opts = {}) => {
  const token = localStorage.getItem('tradebuddy_token')
  return fetch(`/api/agent-portfolio${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  }).then(async r => {
    const data = await r.json()
    if (!r.ok) throw new Error(data.error ?? 'Request failed')
    return data
  })
}

// ── Helpers ──────────────────────────────────────────────────────
function fmt$(n) { return Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }) }
function fmtPct(n) { return `${n >= 0 ? '+' : ''}${Number(n ?? 0).toFixed(2)}%` }
function relTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1)  return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function countdown(iso) {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'due now'
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(h / 24)
  if (d >= 1) return `${d}d ${h % 24}h`
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

// ── Setup Wizard ─────────────────────────────────────────────────
function SetupWizard({ onSetup }) {
  const [cash,      setCash]      = useState('10000')
  const [bias,      setBias]      = useState('')
  const [frequency, setFrequency] = useState('weekly')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await API('/setup', {
        method: 'POST',
        body: JSON.stringify({ startingCash: parseFloat(cash), bias, frequency }),
      })
      onSetup()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const BIAS_EXAMPLES = [
    'Aggressive growth — concentrate on AI, semiconductors, and high-momentum tech',
    'Passive and diversified — broad market exposure, low turnover, index-like',
    'Balanced — 60% growth stocks, 40% defensive blue chips',
    'Conservative — dividend payers, low volatility, capital preservation',
  ]

  return (
    <div className="max-w-lg mx-auto mt-12 px-4">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-accent-blue/20 flex items-center justify-center mx-auto mb-4">
          <Bot size={28} className="text-accent-blue" />
        </div>
        <h1 className="text-primary text-2xl font-bold mb-2">Set Up Your AI Portfolio</h1>
        <p className="text-muted text-sm leading-relaxed">
          An AI agent will manage a virtual portfolio on your behalf — buying, selling, and rebalancing automatically based on your strategy.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface-card border border-border rounded-2xl p-6 space-y-6">
        {/* Starting Cash */}
        <div>
          <label className="block text-primary text-sm font-medium mb-1.5">Starting Cash</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
            <input
              type="number" min="100" step="100"
              value={cash} onChange={e => setCash(e.target.value)}
              required
              className="w-full bg-surface-hover border border-border rounded-xl pl-7 pr-4 py-2.5 text-primary text-sm outline-none focus:border-accent-blue/50 transition-colors"
            />
          </div>
          <p className="text-faint text-xs mt-1">Virtual money only — this does not affect your real portfolio.</p>
        </div>

        {/* Investment Bias */}
        <div>
          <label className="block text-primary text-sm font-medium mb-1.5">Investment Strategy / Bias</label>
          <textarea
            value={bias} onChange={e => setBias(e.target.value)}
            placeholder="Describe how the agent should invest…"
            rows={3} required
            className="w-full bg-surface-hover border border-border rounded-xl px-4 py-2.5 text-primary text-sm outline-none focus:border-accent-blue/50 transition-colors resize-none"
          />
          <p className="text-faint text-xs mt-1 mb-2">Examples:</p>
          <div className="space-y-1.5">
            {BIAS_EXAMPLES.map(ex => (
              <button
                key={ex} type="button"
                onClick={() => setBias(ex)}
                className="w-full text-left text-xs text-muted hover:text-accent-blue bg-surface-hover hover:bg-accent-blue/5 border border-border hover:border-accent-blue/30 rounded-lg px-3 py-2 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Rebalance Frequency */}
        <div>
          <label className="block text-primary text-sm font-medium mb-2">Rebalance Frequency</label>
          <div className="grid grid-cols-3 gap-2">
            {['daily','weekly','monthly'].map(f => (
              <button
                key={f} type="button"
                onClick={() => setFrequency(f)}
                className={clsx(
                  'py-2.5 rounded-xl border text-sm font-medium capitalize transition-colors',
                  frequency === f
                    ? 'border-accent-blue/50 bg-accent-blue/10 text-accent-blue'
                    : 'border-border bg-surface-hover text-muted hover:text-primary'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-loss text-sm bg-loss/10 border border-loss/20 rounded-xl px-4 py-3">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        <button
          type="submit" disabled={loading || !bias.trim()}
          className="w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <><RefreshCw size={14} className="animate-spin" /> Launching…</> : <><Zap size={14} /> Launch Agent</>}
        </button>
      </form>
    </div>
  )
}

// ── Run History Card ──────────────────────────────────────────────
function RunCard({ run }) {
  const [open, setOpen] = useState(false)
  const decisions = run.decisions ?? []
  const hasEstimates = decisions.some(d => d.priceSource === 'estimated')

  return (
    <div className="bg-surface-hover rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-card/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {run.status === 'success'
            ? <CheckCircle2 size={14} className="text-gain shrink-0" />
            : <AlertCircle  size={14} className="text-loss shrink-0" />}
          <div className="text-left">
            <p className="text-primary text-xs font-medium flex items-center gap-1.5">
              {run.status === 'success' ? `${run.trades_count} trade${run.trades_count !== 1 ? 's' : ''}` : 'Error'}
              {run.portfolio_value > 0 && ` · ${fmt$(run.portfolio_value)}`}
              {hasEstimates && (
                <span className="text-yellow-500/80 font-normal">· ~est. prices</span>
              )}
            </p>
            <p className="text-faint text-xs">{relTime(run.created_at)}</p>
          </div>
        </div>
        {open ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          {run.summary && (
            <p className="text-secondary text-xs leading-relaxed">{run.summary}</p>
          )}

          {/* Estimated-price notice */}
          {hasEstimates && (
            <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-3 py-2">
              <AlertCircle size={12} className="text-yellow-500/70 shrink-0 mt-0.5" />
              <p className="text-yellow-500/70 text-xs leading-relaxed">
                No live market data was available. Prices marked <span className="font-semibold">~est.</span> are the AI's best estimates from training knowledge and may not reflect actual market prices.
              </p>
            </div>
          )}

          {decisions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-faint text-xs font-medium uppercase tracking-wide">Decisions</p>
              {decisions.map((d, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-accent-blue font-mono font-semibold shrink-0 w-12">{d.symbol}</span>
                  <span className="text-muted flex-1">{d.targetPct}%
                    {d.estimatedPrice && (
                      <span className={clsx(
                        'ml-1 text-xs font-mono',
                        d.priceSource === 'estimated' ? 'text-yellow-500/70' : 'text-faint'
                      )}>
                        {d.priceSource === 'estimated' ? `~$${d.estimatedPrice}` : `$${d.estimatedPrice}`}
                        {d.priceSource === 'estimated' && <span className="ml-0.5 text-yellow-500/60">est.</span>}
                      </span>
                    )}
                    {' '}— {d.reasoning}
                  </span>
                </div>
              ))}
            </div>
          )}

          {run.transactions?.length > 0 && (
            <div className="space-y-1">
              <p className="text-faint text-xs font-medium uppercase tracking-wide">Trades</p>
              {run.transactions.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={clsx('font-medium', t.side === 'buy' ? 'text-gain' : 'text-loss')}>
                    {t.side.toUpperCase()}
                  </span>
                  <span className="text-primary font-mono">{t.symbol}</span>
                  <span className="text-muted">{Number(t.shares).toFixed(3)} @ {fmt$(t.price)}</span>
                  <span className="text-faint ml-auto">{fmt$(t.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Settings Panel ────────────────────────────────────────────────
function SettingsPanel({ settings, onSaved, onReset }) {
  const [bias,      setBias]      = useState(settings.bias)
  const [frequency, setFrequency] = useState(settings.frequency)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)
  const [resetting, setResetting] = useState(false)

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      await API('/settings', { method: 'PATCH', body: JSON.stringify({ bias, frequency }) })
      onSaved()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const handleReset = async () => {
    if (!window.confirm('Reset the agent portfolio? All holdings and history will be deleted.')) return
    setResetting(true)
    try { await API('', { method: 'DELETE' }); onReset() }
    catch (err) { setError(err.message) }
    finally { setResetting(false) }
  }

  const handleTogglePause = async () => {
    const next = settings.status === 'active' ? 'paused' : 'active'
    try { await API('/settings', { method: 'PATCH', body: JSON.stringify({ status: next }) }); onSaved() }
    catch (err) { setError(err.message) }
  }

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 space-y-5">
      <h3 className="text-primary text-sm font-semibold flex items-center gap-2">
        <Settings size={14} className="text-accent-blue" /> Agent Settings
      </h3>

      <div>
        <label className="block text-muted text-xs mb-1.5">Investment Strategy / Bias</label>
        <textarea
          value={bias} onChange={e => setBias(e.target.value)}
          rows={3}
          className="w-full bg-surface-hover border border-border rounded-xl px-3 py-2.5 text-primary text-sm outline-none focus:border-accent-blue/50 transition-colors resize-none"
        />
      </div>

      <div>
        <label className="block text-muted text-xs mb-1.5">Rebalance Frequency</label>
        <div className="grid grid-cols-3 gap-2">
          {['daily','weekly','monthly'].map(f => (
            <button key={f} onClick={() => setFrequency(f)}
              className={clsx(
                'py-2 rounded-lg border text-xs font-medium capitalize transition-colors',
                frequency === f ? 'border-accent-blue/50 bg-accent-blue/10 text-accent-blue' : 'border-border bg-surface-hover text-muted hover:text-primary'
              )}>{f}</button>
          ))}
        </div>
      </div>

      {error && <p className="text-loss text-xs">{error}</p>}

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={handleTogglePause}
          className="px-3 py-2 rounded-lg border border-border text-muted hover:text-primary hover:bg-surface-hover transition-colors text-sm">
          {settings.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button onClick={handleReset} disabled={resetting}
          className="px-3 py-2 rounded-lg border border-loss/30 text-loss hover:bg-loss/10 transition-colors text-sm">
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────
function Dashboard({ state, onRefresh }) {
  const { settings, holdings, runs, summary } = state
  const [running,     setRunning]     = useState(false)
  const [runError,    setRunError]    = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [history,     setHistory]     = useState(runs ?? [])

  useEffect(() => { setHistory(runs ?? []) }, [runs])

  const handleRunNow = async () => {
    setRunning(true); setRunError(null)
    try {
      await API('/run', { method: 'POST' })
      await onRefresh()
    } catch (err) { setRunError(err.message) }
    finally { setRunning(false) }
  }

  const gain      = summary.totalReturn ?? 0
  const gainPct   = summary.totalReturnPct ?? 0
  const isPaused  = settings.status === 'paused'

  return (
    <div className="p-6 space-y-5 max-w-4xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={clsx(
            'w-9 h-9 rounded-xl flex items-center justify-center',
            isPaused ? 'bg-faint/20' : 'bg-accent-blue/20'
          )}>
            <Bot size={18} className={isPaused ? 'text-muted' : 'text-accent-blue'} />
          </div>
          <div>
            <h1 className="text-primary font-bold text-lg">AI Portfolio</h1>
            <p className="text-faint text-xs capitalize">
              {isPaused ? '⏸ Paused' : `⚡ Active · rebalances ${settings.frequency}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings(v => !v)}
            className={clsx('p-2 rounded-lg border transition-colors text-sm',
              showSettings ? 'border-accent-blue/40 text-accent-blue bg-accent-blue/10' : 'border-border text-muted hover:text-primary hover:bg-surface-hover'
            )}>
            <Settings size={15} />
          </button>
          <button onClick={handleRunNow} disabled={running || isPaused}
            className="flex items-center gap-1.5 bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {running
              ? <><RefreshCw size={13} className="animate-spin" /> Running…</>
              : <><Zap size={13} /> Run Now</>}
          </button>
        </div>
      </div>

      {runError && (
        <div className="flex items-center gap-2 text-loss text-sm bg-loss/10 border border-loss/20 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="shrink-0" /> {runError}
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSaved={() => { setShowSettings(false); onRefresh() }}
          onReset={onRefresh}
        />
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Value',    value: fmt$(summary.totalValue),    sub: null },
          { label: 'Cash',           value: fmt$(summary.cash),          sub: `${((summary.cash / summary.totalValue) * 100).toFixed(1)}% of portfolio` },
          { label: 'Total Return',   value: fmt$(gain),                  sub: fmtPct(gainPct), color: gain >= 0 ? 'text-gain' : 'text-loss' },
          { label: 'Next Rebalance', value: countdown(settings.next_run_at), sub: isPaused ? 'paused' : settings.frequency },
        ].map(card => (
          <div key={card.label} className="bg-surface-card border border-border rounded-xl px-4 py-3">
            <p className="text-muted text-xs mb-1">{card.label}</p>
            <p className={clsx('text-primary font-semibold text-base', card.color)}>{card.value}</p>
            {card.sub && <p className={clsx('text-xs mt-0.5', card.color ?? 'text-faint')}>{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Holdings */}
      <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <BarChart3 size={14} className="text-accent-blue" />
          <p className="text-primary text-sm font-medium">Holdings</p>
        </div>
        {holdings.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-muted text-sm">No positions yet — run a rebalance to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {holdings.map(h => {
              const pct = summary.totalValue > 0 ? (h.value / summary.totalValue) * 100 : 0
              return (
                <div key={h.symbol} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-24 shrink-0">
                    <p className="text-primary text-sm font-mono font-semibold">{h.symbol}</p>
                    <p className="text-faint text-xs">{Number(h.shares).toFixed(3)} shares</p>
                  </div>
                  {/* Weight bar */}
                  <div className="flex-1 hidden sm:block">
                    <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
                      <div className="h-full bg-accent-blue/50 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-primary text-sm font-medium">{fmt$(h.value)}</p>
                    <p className="text-faint text-xs">{pct.toFixed(1)}%</p>
                  </div>
                  <div className="text-right shrink-0 w-20">
                    <p className={clsx('text-xs font-medium', h.gain >= 0 ? 'text-gain' : 'text-loss')}>
                      {h.gain >= 0 ? '+' : ''}{fmt$(h.gain)}
                    </p>
                    <p className="text-faint text-xs">@ {fmt$(h.price)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Bias display */}
      <div className="bg-surface-card border border-border rounded-xl px-5 py-4 flex items-start gap-3">
        <Sparkles size={14} className="text-accent-blue shrink-0 mt-0.5" />
        <div>
          <p className="text-faint text-xs mb-1">Active strategy</p>
          <p className="text-secondary text-sm leading-relaxed">"{settings.bias}"</p>
        </div>
      </div>

      {/* Run history */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-accent-blue" />
          <p className="text-primary text-sm font-medium">Rebalance History</p>
        </div>
        {history.length === 0 ? (
          <p className="text-muted text-sm">No rebalances yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map(run => <RunCard key={run.id} run={run} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────
export default function AgentPortfolio() {
  const [state,   setState]   = useState(null)   // null = loading
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await API('')
      setState(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="p-6">
      <div className="flex items-center gap-2 text-loss bg-loss/10 border border-loss/20 rounded-xl px-4 py-3 text-sm">
        <AlertCircle size={14} /> {error}
      </div>
    </div>
  )

  if (!state?.configured) return <SetupWizard onSetup={load} />

  return <Dashboard state={state} onRefresh={load} />
}
