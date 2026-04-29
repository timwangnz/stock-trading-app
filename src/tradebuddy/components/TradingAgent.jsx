/**
 * TradingAgent.jsx
 * Natural-language trading assistant — always routes through the server.
 * The server picks the right LLM (Anthropic, OpenAI, Gemini, or local Ollama)
 * based on the user's settings, and handles MCP tool calls.
 */

import { useState, useRef, useEffect } from 'react'
import { Bot, Send, TrendingUp, TrendingDown, Trash2, Sparkles,
         ChevronDown, ChevronUp, Newspaper, ExternalLink, Zap,
         CheckCircle2, XCircle, AlertTriangle, KeyRound } from 'lucide-react'
import clsx from 'clsx'
import { useKeys } from '../../common/context/KeysContext'
import { useApp, ACTIONS } from '../context/AppContext'

// ── Types ────────────────────────────────────────────────────────
// embedded={true}  → fills the parent panel, no collapsible header
// embedded={false} → standalone card with its own collapse toggle (Portfolio page)

// ── Lightweight Markdown renderer ───────────────────────────────
// Handles: headers, bold, italic, inline code, code blocks,
//          bullet lists, numbered lists, horizontal rules, blank lines.
// No external deps — pure React.

function renderInline(text, key) {
  // Split on bold (**), italic (*/_), and inline code (`)
  const parts = []
  const re    = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`([^`]+)`)/g
  let   last  = 0
  let   m

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))

    if (m[0].startsWith('**'))      parts.push(<strong key={m.index}>{m[2]}</strong>)
    else if (m[0].startsWith('*'))  parts.push(<em     key={m.index}>{m[3]}</em>)
    else if (m[0].startsWith('_'))  parts.push(<em     key={m.index}>{m[4]}</em>)
    else if (m[0].startsWith('`'))  parts.push(
      <code key={m.index} className="bg-black/20 text-accent-blue/90 text-xs px-1.5 py-0.5 rounded font-mono">
        {m[5]}
      </code>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span key={key}>{parts}</span>
}

function MarkdownMessage({ text }) {
  if (!text) return null

  const lines   = text.split('\n')
  const output  = []
  let   i       = 0

  while (i < lines.length) {
    const line = lines[i]

    // ── Fenced code block ───────────────────────────
    if (line.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      output.push(
        <pre key={i} className="bg-black/30 border border-border/40 rounded-lg p-3 my-2 overflow-x-auto">
          <code className="text-xs font-mono text-secondary leading-relaxed whitespace-pre">
            {codeLines.join('\n')}
          </code>
        </pre>
      )
      i++
      continue
    }

    // ── Horizontal rule ─────────────────────────────
    if (/^[-*_]{3,}$/.test(line.trim())) {
      output.push(<hr key={i} className="border-border/40 my-2" />)
      i++; continue
    }

    // ── Headers ─────────────────────────────────────
    const h3 = line.match(/^### (.+)/)
    const h2 = line.match(/^## (.+)/)
    const h1 = line.match(/^# (.+)/)
    if (h1) { output.push(<p key={i} className="font-bold text-primary text-sm mt-2 mb-1">{renderInline(h1[1])}</p>); i++; continue }
    if (h2) { output.push(<p key={i} className="font-semibold text-primary text-sm mt-2 mb-1">{renderInline(h2[1])}</p>); i++; continue }
    if (h3) { output.push(<p key={i} className="font-semibold text-secondary text-xs mt-1.5 mb-0.5">{renderInline(h3[1])}</p>); i++; continue }

    // ── Bullet list ─────────────────────────────────
    if (/^[-*•] /.test(line)) {
      const items = []
      while (i < lines.length && /^[-*•] /.test(lines[i])) {
        items.push(<li key={i} className="ml-1">{renderInline(lines[i].replace(/^[-*•] /, ''))}</li>)
        i++
      }
      output.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 text-sm">
          {items}
        </ul>
      )
      continue
    }

    // ── Numbered list ────────────────────────────────
    if (/^\d+\. /.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i} className="ml-1">{renderInline(lines[i].replace(/^\d+\. /, ''))}</li>)
        i++
      }
      output.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1 text-sm">
          {items}
        </ol>
      )
      continue
    }

    // ── Blank line → small spacer ────────────────────
    if (line.trim() === '') {
      output.push(<div key={i} className="h-1.5" />)
      i++; continue
    }

    // ── Normal paragraph ─────────────────────────────
    output.push(
      <p key={i} className="text-sm leading-relaxed">
        {renderInline(line)}
      </p>
    )
    i++
  }

  return <div className="space-y-0.5">{output}</div>
}

// ── Trade badge ──────────────────────────────────────────────────
function TradeBadge({ trade }) {
  if (!trade) return null

  const config = {
    buy:    { label: `Bought ${trade.shares} × ${trade.symbol}`,   color: 'text-gain  bg-gain/10  border-gain/20',  Icon: TrendingUp  },
    sell:   { label: `Sold ${trade.shares ?? '?'} × ${trade.symbol}`, color: 'text-loss  bg-loss/10  border-loss/20',  Icon: TrendingDown },
    remove: { label: `Removed ${trade.symbol}`,                    color: 'text-muted bg-surface-hover border-border', Icon: Trash2       },
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

// ── News panel ───────────────────────────────────────────────────
function NewsPanel({ articles }) {
  const [open, setOpen] = useState(false)
  if (!articles?.length) return null
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-faint hover:text-muted transition-colors"
      >
        <Newspaper size={11} />
        <span>{articles.length} headline{articles.length > 1 ? 's' : ''}</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 border-l-2 border-border/60 pl-3">
          {articles.map((a, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-start gap-1.5">
                <span className="text-faint text-xs shrink-0 font-mono w-10">{a.symbol}</span>
                <a
                  href={a.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-secondary hover:text-accent-blue leading-snug flex-1 flex items-start gap-1"
                >
                  {a.title}
                  {a.url && <ExternalLink size={9} className="shrink-0 mt-0.5 opacity-50" />}
                </a>
              </div>
              <p className="text-faint text-xs pl-11">{a.source} · {a.age}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── MCP tool used badge ───────────────────────────────────────────
function MCPBadge({ toolName }) {
  if (!toolName) return null
  const display = toolName.replace(/^mcp_[^_]+_/, '')
  return (
    <span className="inline-flex items-center gap-1 text-xs text-purple-400/70 mt-1">
      <Zap size={10} />
      MCP: {display}
    </span>
  )
}

// ── Pending trade confirmation card ──────────────────────────────
function PendingTradeCard({ pendingTrade, onConfirm, onCancel, confirming }) {
  const { toolName, symbol, shares, livePrice, reasoning } = pendingTrade

  const isBuy    = toolName === 'execute_buy'
  const isSell   = toolName === 'execute_sell'
  const isRemove = toolName === 'remove_holding'

  const actionLabel = isBuy ? 'Buy' : isSell ? 'Sell' : 'Remove'
  const total       = isBuy && livePrice && shares ? shares * livePrice : null

  return (
    <div className="mt-1 border border-amber-500/30 bg-amber-500/8 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium">
        <AlertTriangle size={12} />
        Confirm trade
      </div>

      <div className="space-y-0.5">
        <p className="text-primary text-sm font-semibold">
          {actionLabel} {!isRemove && shares !== undefined ? `${shares} ×` : ''} {symbol}
          {(isBuy || isSell) && livePrice ? ` @ $${Number(livePrice).toFixed(2)} (live)` : ''}
        </p>
        {total && (
          <p className="text-muted text-xs">
            Total: ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        )}
        {reasoning && (
          <p className="text-secondary text-xs leading-snug pt-0.5">{reasoning}</p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gain/15 border border-gain/30 text-gain text-xs font-medium hover:bg-gain/25 transition-colors disabled:opacity-50"
        >
          <CheckCircle2 size={12} />
          {confirming ? 'Executing…' : 'Confirm'}
        </button>
        <button
          onClick={onCancel}
          disabled={confirming}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover border border-border text-muted text-xs font-medium hover:text-primary transition-colors disabled:opacity-50"
        >
          <XCircle size={12} />
          Cancel
        </button>
      </div>
    </div>
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
  const { llmConfigured } = useKeys()
  const { dispatch }      = useApp()
  const [open,     setOpen]     = useState(false)
  const [input,    setInput]    = useState('')
  const [messages, setMessages] = useState([
    {
      id:   'welcome',
      role: 'agent',
      text: "Hi! I'm your trading assistant. Ask me about your portfolio or any trading questions.",
      trade: null,
    },
  ])
  const [loading,    setLoading]    = useState(false)
  const [confirming, setConfirming] = useState(null)  // message id being confirmed
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
    const userMsg = { id: Date.now(), role: 'user', text: msg, trade: null }
    setMessages(prev => [...prev, userMsg])
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
        id:             Date.now() + 1,
        role:           'agent',
        text:           data.response,
        trade:          data.trade,
        pendingTrade:   data.pendingTrade ?? null,
        fetchedTickers: data.tickersFetched ?? [],
        newsArticles:   data.newsArticles   ?? [],
        mcpToolUsed:    data.mcpToolUsed    ?? null,
      }])

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

  const confirmTrade = async (msgId, pendingTrade) => {
    setConfirming(msgId)
    try {
      const token = localStorage.getItem('tradebuddy_token')
      const res   = await fetch('/api/agent/confirm-trade', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ toolName: pendingTrade.toolName, toolInput: pendingTrade }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Trade failed')

      // Replace the pending message with the executed result
      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? { ...m, text: data.response, pendingTrade: null, trade: data.trade }
          : m
      ))
      if (data.trade) onTradeExecuted?.()
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? { ...m, text: err.message, pendingTrade: null, error: true }
          : m
      ))
    } finally {
      setConfirming(null)
    }
  }

  const cancelTrade = (msgId) => {
    setMessages(prev => prev.map(m =>
      m.id === msgId
        ? { ...m, text: 'Trade cancelled.', pendingTrade: null }
        : m
    ))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // In embedded mode the panel provides its own header/close button.
  // We render just the inner content, filling the available height.
  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        {/* LLM not-configured notice */}
        {!llmConfigured && (
          <div className="flex items-center gap-2 px-4 py-2 bg-yellow-400/8 border-b border-yellow-400/20 text-yellow-400 text-xs shrink-0">
            <KeyRound size={12} className="shrink-0" />
            No AI provider configured —{' '}
            <button
              onClick={() => dispatch({ type: ACTIONS.NAVIGATE, payload: 'settings' })}
              className="underline hover:no-underline"
            >
              Set up in My Keys →
            </button>
          </div>
        )}
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
                  'px-3 py-2 rounded-xl',
                  m.role === 'user'
                    ? 'bg-accent-blue/20 text-primary rounded-tr-sm text-sm leading-relaxed'
                    : m.error
                      ? 'bg-loss/10 text-loss/80 border border-loss/20 rounded-tl-sm text-sm leading-relaxed'
                      : 'bg-surface-hover text-secondary rounded-tl-sm',
                )}>
                  {m.role === 'agent' && !m.error
                    ? <MarkdownMessage text={m.text} />
                    : m.text}
                </div>
                {m.pendingTrade && (
                  <PendingTradeCard
                    pendingTrade={m.pendingTrade}
                    onConfirm={() => confirmTrade(m.id, m.pendingTrade)}
                    onCancel={() => cancelTrade(m.id)}
                    confirming={confirming === m.id}
                  />
                )}
                {m.trade && <TradeBadge trade={m.trade} />}
                {m.mcpToolUsed && <MCPBadge toolName={m.mcpToolUsed} />}
                {m.fetchedTickers?.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400/70 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 inline-block" />
                    Live: {m.fetchedTickers.join(', ')}
                  </span>
                )}
                <NewsPanel articles={m.newsArticles} />
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
        <div className="px-4 pb-4 pt-2 border-t border-border shrink-0">
          <div className="flex items-center gap-2 bg-surface-hover border border-border rounded-xl px-3 py-2.5 focus-within:border-accent-blue/40 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='"buy 10 AAPL at 195" or "sell half TSLA"'
              disabled={loading}
              className="flex-1 bg-transparent text-primary text-sm placeholder-muted outline-none disabled:opacity-50"
            />
            <button onClick={() => send()} disabled={!input.trim() || loading}
              className="text-accent-blue disabled:text-faint hover:text-accent-blue/70 transition-colors shrink-0">
              <Send size={15} />
            </button>
          </div>
          <p className="text-faint text-xs mt-1.5 px-1">Vibe trading only · not financial advice</p>
        </div>
      </div>
    )
  }

  // ── Standalone card mode ─────────────────────────────────────────
  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden">

      {/* LLM not-configured notice */}
      {!llmConfigured && (
        <div className="flex items-center gap-2 px-4 py-2 bg-yellow-400/8 border-b border-yellow-400/20 text-yellow-400 text-xs">
          <KeyRound size={12} className="shrink-0" />
          No AI provider configured —{' '}
          <button
            onClick={() => dispatch({ type: ACTIONS.NAVIGATE, payload: 'settings' })}
            className="underline hover:no-underline"
          >
            Set up in My Keys →
          </button>
        </div>
      )}

      {/* Header / toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent-blue" />
          <span className="text-primary text-sm font-semibold">Trading Agent</span>
        </div>
        {open ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
      </button>

      {open && (
        <div className="border-t border-border">

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
                    'px-3 py-2 rounded-xl',
                    m.role === 'user'
                      ? 'bg-accent-blue/20 text-primary rounded-tr-sm text-sm leading-relaxed'
                      : m.error
                        ? 'bg-loss/10 text-loss/80 border border-loss/20 rounded-tl-sm text-sm leading-relaxed'
                        : 'bg-surface-hover text-secondary rounded-tl-sm',
                  )}>
                    {m.role === 'agent' && !m.error
                      ? <MarkdownMessage text={m.text} />
                      : m.text}
                  </div>
                  {m.pendingTrade && (
                    <PendingTradeCard
                      pendingTrade={m.pendingTrade}
                      onConfirm={() => confirmTrade(m.id, m.pendingTrade)}
                      onCancel={() => cancelTrade(m.id)}
                      confirming={confirming === m.id}
                    />
                  )}
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
            <div className="flex items-center gap-2 bg-surface-hover border border-border rounded-xl px-3 py-2 focus-within:border-accent-blue/40 transition-colors">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='e.g. "buy 10 AAPL at 195" or "sell half my TSLA"'
                disabled={loading}
                className="flex-1 bg-transparent text-primary text-sm placeholder-muted outline-none disabled:opacity-50"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="text-accent-blue disabled:text-faint hover:text-accent-blue/70 transition-colors shrink-0"
              >
                <Send size={15} />
              </button>
            </div>
            <p className="text-faint text-xs mt-1.5 px-1">Vibe trading only · not financial advice</p>
          </div>
        </div>
      )}
    </div>
  )
}
