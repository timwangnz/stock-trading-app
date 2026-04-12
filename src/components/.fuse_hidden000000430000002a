/**
 * TradingAgent.jsx
 * Natural-language trading assistant powered by Claude.
 *
 * Users type commands like:
 *   "buy 10 AAPL at 180"
 *   "sell half my Tesla"
 *   "what's my biggest position?"
 *   "remove MSFT"
 *
 * The component posts to POST /api/agent/trade, which calls Claude
 * with tool_use to parse intent and execute the trade in MySQL.
 * On success, onTradeExecuted() is called so Portfolio can reload.
 */

import { useState, useRef, useEffect } from 'react'
import { Bot, Send, TrendingUp, TrendingDown, Trash2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'

// ── Types ────────────────────────────────────────────────────────
// embedded={true}  → fills the parent panel, no collapsible header
// embedded={false} → standalone card with its own collapse toggle (Portfolio page)

// ── Trade badge ──────────────────────────────────────────────────
function TradeBadge({ trade }) {
  if (!trade) return null

  const config = {
    buy:    { label: `Bought ${trade.shares} × ${trade.symbol}`,   color: 'text-gain  bg-gain/10  border-gain/20',  Icon: TrendingUp  },
    sell:   { label: `Sold ${trade.shares ?? '?'} × ${trade.symbol}`, color: 'text-loss  bg-loss/10  border-loss/20',  Icon: TrendingDown },
    remove: { label: `Removed ${trade.symbol}`,                    color: 'text-slate-500 bg-slate-100 border-slate-200', Icon: Trash2       },
  }[trade.action] ?? null

  if (!config) return null
  const { label, color, Icon } = config

  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium mt-1', color)}>
      <Icon size={11} />
      {label}
      {trade.price && ` @ $${Number(trade.price).toFixed(2)}`}
    </span>
  )
}

// ── Typing indicator ─────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-accent-blue/60 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

// ── Suggestion chips ─────────────────────────────────────────────
const SUGGESTIONS = [
  'What is my biggest position?',
  'Buy 5 AAPL at 195',
  'Sell half my TSLA',
  'How is my portfolio doing?',
]

// ── Main component ───────────────────────────────────────────────
export default function TradingAgent({ portfolio, onTradeExecuted, embedded = false }) {
  const [open,     setOpen]     = useState(false)
  const [input,    setInput]    = useState('')
  const [messages, setMessages] = useState([
    {
      id:   'welcome',
      role: 'agent',
      text: "Hi! I'm your trading assistant. Tell me what you'd like to trade, or ask about your portfolio.",
      trade: null,
    },
  ])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const send = async (text) => {
    const msg = text ?? input.trim()
    if (!msg || loading) return

    setInput('')
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: msg, trade: null }])
    setLoading(true)

    try {
      const token = localStorage.getItem('tradebuddy_token')
      const res   = await fetch('/api/agent/trade', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({
          message:   msg,
          portfolio: portfolio.map(h => ({
            symbol:  h.symbol,
            shares:  h.shares,
            avgCost: h.avgCost,
            value:   h.value,
          })),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages(prev => [...prev, {
          id:    Date.now() + 1,
          role:  'agent',
          text:  data.error ?? 'Something went wrong. Please try again.',
          trade: null,
          error: true,
        }])
        return
      }

      setMessages(prev => [...prev, {
        id:    Date.now() + 1,
        role:  'agent',
        text:  data.response,
        trade: data.trade,
      }])

      // If a trade was executed, tell Portfolio to reload
      if (data.trade) onTradeExecuted?.()

    } catch {
      setMessages(prev => [...prev, {
        id:    Date.now() + 1,
        role:  'agent',
        text:  'Network error — is the server running?',
        trade: null,
        error: true,
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // In embedded mode the panel provides its own header/close button.
  // We render just the inner content, filling the available height.
  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map(m => (
            <div
              key={m.id}
              className={clsx('flex gap-2 max-w-[88%]', m.role === 'user' ? 'ml-auto flex-row-reverse' : '')}
            >
              {m.role === 'agent' && (
                <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={12} className="text-accent-blue" />
                </div>
              )}
              <div>
                <div className={clsx(
                  'text-sm px-3 py-2 rounded-xl leading-relaxed',
                  m.role === 'user'
                    ? 'bg-accent-blue/20 text-slate-900 rounded-tr-sm'
                    : m.error
                      ? 'bg-loss/10 text-loss/80 border border-loss/20 rounded-tl-sm'
                      : 'bg-surface-hover text-slate-700 rounded-tl-sm',
                )}>
                  {m.text}
                </div>
                {m.trade && <TradeBadge trade={m.trade} />}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
                <Bot size={12} className="text-accent-blue" />
              </div>
              <div className="bg-surface-hover rounded-xl rounded-tl-sm">
                <TypingDots />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestion chips */}
        {messages.length === 1 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} disabled={loading}
                className="text-xs text-accent-blue/70 border border-accent-blue/20 bg-accent-blue/5 hover:bg-accent-blue/10 px-2.5 py-1 rounded-full transition-colors disabled:opacity-40">
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-4 pb-4 pt-2 border-t border-slate-200 shrink-0">
          <div className="flex items-center gap-2 bg-surface-hover border border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-accent-blue/40 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='"buy 10 AAPL at 195" or "sell half TSLA"'
              disabled={loading}
              className="flex-1 bg-transparent text-slate-900 text-sm placeholder-slate-400 outline-none disabled:opacity-50"
            />
            <button onClick={() => send()} disabled={!input.trim() || loading}
              className="text-accent-blue disabled:text-slate-300 hover:text-accent-blue/70 transition-colors shrink-0">
              <Send size={15} />
            </button>
          </div>
          <p className="text-slate-300 text-xs mt-1.5 px-1">
            Paper trading only · Not financial advice
          </p>
        </div>
      </div>
    )
  }

  // ── Standalone card mode (legacy, kept for backward compat) ─────
  return (
    <div className="bg-surface-card border border-slate-200 rounded-xl overflow-hidden">

      {/* Header / toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent-blue" />
          <span className="text-slate-900 text-sm font-semibold">Trading Agent</span>
          <span className="text-slate-400 text-xs">— ask Claude to execute trades</span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-200">

          {/* Message list */}
          <div className="h-64 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map(m => (
              <div
                key={m.id}
                className={clsx('flex gap-2 max-w-[85%]', m.role === 'user' ? 'ml-auto flex-row-reverse' : '')}
              >
                {/* Avatar */}
                {m.role === 'agent' && (
                  <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={12} className="text-accent-blue" />
                  </div>
                )}

                {/* Bubble */}
                <div>
                  <div className={clsx(
                    'text-sm px-3 py-2 rounded-xl leading-relaxed',
                    m.role === 'user'
                      ? 'bg-accent-blue/20 text-slate-900 rounded-tr-sm'
                      : m.error
                        ? 'bg-loss/10 text-loss/80 border border-loss/20 rounded-tl-sm'
                        : 'bg-surface-hover text-slate-700 rounded-tl-sm',
                  )}>
                    {m.text}
                  </div>
                  {m.trade && <TradeBadge trade={m.trade} />}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
                  <Bot size={12} className="text-accent-blue" />
                </div>
                <div className="bg-surface-hover rounded-xl rounded-tl-sm">
                  <TypingDots />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips — only shown when there's just the welcome message */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={loading}
                  className="text-xs text-accent-blue/70 border border-accent-blue/20 bg-accent-blue/5 hover:bg-accent-blue/10 px-2.5 py-1 rounded-full transition-colors disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="px-4 pb-4 pt-1">
            <div className="flex items-center gap-2 bg-surface-hover border border-slate-200 rounded-xl px-3 py-2 focus-within:border-accent-blue/40 transition-colors">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='e.g. "buy 10 AAPL at 195" or "sell half my TSLA"'
                disabled={loading}
                className="flex-1 bg-transparent text-slate-900 text-sm placeholder-slate-400 outline-none disabled:opacity-50"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="text-accent-blue disabled:text-slate-300 hover:text-accent-blue/70 transition-colors shrink-0"
              >
                <Send size={15} />
              </button>
            </div>
            <p className="text-slate-300 text-xs mt-1.5 px-1">
              Powered by Claude · Trades are paper only · Not financial advice
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
