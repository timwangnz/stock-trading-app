/**
 * TradingAgent.jsx
 * Natural-language trading assistant — supports two backends:
 *
 *  1. LOCAL MODE  (default) — streams responses from a local Ollama model
 *                             (e.g. gemma3) via http://localhost:11434.
 *                             Portfolio data is injected into the system prompt
 *                             so the model knows your holdings.
 *
 *  2. CLOUD MODE  (fallback) — posts to POST /api/agent/trade, which calls
 *                              Claude with tool_use and can execute real vibe
 *                              trades in MySQL.
 *
 * Users can toggle between modes with the 🖥 / ☁ button in the header.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Send, TrendingUp, TrendingDown, Trash2, Sparkles,
         ChevronDown, ChevronUp, Cpu, Cloud, Newspaper, ExternalLink, Zap } from 'lucide-react'
import clsx from 'clsx'
import { streamOllamaChat, isOllamaAvailable } from '../services/ollama'
import { buildMarketContext } from '../services/marketContext'

const OLLAMA_MODEL = 'gemma3'   // change to 'gemma:2b', 'mistral', etc. if needed

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

// ── Build Ollama system prompt from portfolio + optional live data ─
function buildSystemPrompt(portfolio, liveDataBlock = null) {
  const holdings = portfolio?.length
    ? portfolio.map(h =>
        `  • ${h.symbol}: ${h.shares} shares @ avg $${Number(h.avgCost ?? 0).toFixed(2)}, current value $${Number(h.value ?? 0).toFixed(2)}`
      ).join('\n')
    : '  (no holdings yet)'

  const liveSection = liveDataBlock
    ? `\n\n${liveDataBlock}\n\nIMPORTANT: Use the live market data above when answering. Quote exact prices and changes.`
    : ''

  return `You are a helpful AI trading assistant for a vibe-trading app called TradeBuddy.
The user's current portfolio is:
${holdings}
${liveSection}
Guidelines:
- Answer questions about the portfolio using the data above.
- When live market data is provided, always use those exact numbers in your response.
- You can discuss trading strategies, market concepts, and general financial education.
- If asked to execute a trade (buy/sell), explain that in local mode you can only give advice —
  they can switch to Cloud mode (☁ button) to execute real vibe trades.
- Keep responses concise and friendly. Use bullet points for lists.
- This is vibe trading only. Always remind users this is not financial advice.`
}

// ── Main component ───────────────────────────────────────────────
export default function TradingAgent({ portfolio, onTradeExecuted, embedded = false }) {
  const [open,      setOpen]      = useState(false)
  const [input,     setInput]     = useState('')
  const [useOllama, setUseOllama] = useState(true)   // true = local Gemma, false = cloud Claude
  const [ollamaOk,  setOllamaOk]  = useState(null)   // null=checking, true/false
  const [messages,  setMessages]  = useState([
    {
      id:   'welcome',
      role: 'agent',
      text: "Hi! I'm your trading assistant powered by Gemma (local). Ask me about your portfolio or any trading questions.",
      trade: null,
    },
  ])
  const [loading,  setLoading]  = useState(false)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)
  const abortRef   = useRef(null)

  // Check Ollama availability on mount
  useEffect(() => {
    isOllamaAvailable().then(ok => {
      setOllamaOk(ok)
      if (!ok) {
        setUseOllama(false)
        setMessages(prev => [{
          ...prev[0],
          text: "Hi! Ollama isn't running locally, so I'm using Cloud mode (Claude). You can start Ollama anytime and switch back.",
        }])
      }
    })
  }, [])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  // Build conversation history for Ollama (all prior messages)
  const buildOllamaMessages = useCallback((history, newUserMsg, liveDataBlock = null) => {
    const systemPrompt = buildSystemPrompt(portfolio, liveDataBlock)
    const chatHistory  = history
      .filter(m => m.id !== 'welcome' && !m.error)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))

    return [
      { role: 'system',    content: systemPrompt },
      ...chatHistory,
      { role: 'user',      content: newUserMsg },
    ]
  }, [portfolio])

  const send = async (text) => {
    const msg = text ?? input.trim()
    if (!msg || loading) return

    setInput('')
    const userMsg = { id: Date.now(), role: 'user', text: msg, trade: null }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    // ── LOCAL MODE: Ollama / Gemma ──────────────────────────────
    if (useOllama) {
      // 1. Fetch live market data if the message seems to need it
      let liveDataBlock = null
      let tickersFetched = []
      try {
        const result = await buildMarketContext(msg, portfolio)
        liveDataBlock  = result.contextBlock
        tickersFetched = result.tickersFetched
      } catch {
        // non-fatal — proceed without live data
      }

      // 2. Add a placeholder bubble (streams into it)
      const agentId = Date.now() + 1
      setMessages(prev => [...prev, {
        id:    agentId,
        role:  'agent',
        text:  '',
        trade: null,
        // show a small badge if we fetched real data
        fetchedTickers: tickersFetched,
      }])

      abortRef.current = new AbortController()

      await streamOllamaChat({
        model:    OLLAMA_MODEL,
        messages: buildOllamaMessages(messages, msg, liveDataBlock),
        signal:   abortRef.current.signal,
        onToken: (chunk) => {
          setMessages(prev => prev.map(m =>
            m.id === agentId ? { ...m, text: m.text + chunk } : m
          ))
        },
        onError: (err) => {
          setMessages(prev => prev.map(m =>
            m.id === agentId
              ? { ...m, text: `Ollama error: ${err.message}. Is Ollama running with "${OLLAMA_MODEL}" pulled?`, error: true }
              : m
          ))
        },
      })

      setLoading(false)
      return
    }

    // ── CLOUD MODE: backend → Claude ────────────────────────────
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

  // Toggle between local Ollama and cloud Claude
  const toggleMode = () => {
    if (loading) { abortRef.current?.abort(); setLoading(false) }
    const next = !useOllama
    setUseOllama(next)
    setMessages([{
      id:   'welcome',
      role: 'agent',
      text: next
        ? "Switched to 🖥 Local mode (Gemma via Ollama). Ask me anything about your portfolio!"
        : "Switched to ☁ Cloud mode (Claude). I can execute vibe trades too!",
      trade: null,
    }])
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // ── Mode badge (shown in message list header) ───────────────────
  const ModeBadge = () => (
    <button
      onClick={toggleMode}
      title={useOllama ? 'Using local Gemma — click to switch to Cloud (Claude)' : 'Using Cloud (Claude) — click to switch to local Gemma'}
      className={clsx(
        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors',
        useOllama
          ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20 hover:bg-emerald-400/20'
          : 'text-accent-blue bg-accent-blue/10 border-accent-blue/20 hover:bg-accent-blue/20',
        ollamaOk === false && useOllama === false ? 'opacity-50 cursor-default' : 'cursor-pointer'
      )}
    >
      {useOllama ? <Cpu size={10} /> : <Cloud size={10} />}
      {useOllama ? `Local · ${OLLAMA_MODEL}` : 'Cloud · Claude'}
    </button>
  )

  // In embedded mode the panel provides its own header/close button.
  // We render just the inner content, filling the available height.
  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        {/* Mode toggle bar */}
        <div className="px-4 pt-2 pb-1 flex items-center gap-2">
          <ModeBadge />
          {ollamaOk === false && (
            <span className="text-xs text-faint">Ollama not detected</span>
          )}
        </div>

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
          <p className="text-faint text-xs mt-1.5 px-1">
            {useOllama ? `Gemma (local) · vibe trading only · not financial advice` : `Claude (cloud) · vibe trading only · not financial advice`}
          </p>
        </div>
      </div>
    )
  }

  // ── Standalone card mode (legacy, kept for backward compat) ─────
  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden">

      {/* Header / toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent-blue" />
          <span className="text-primary text-sm font-semibold">Trading Agent</span>
          <span className="text-muted text-xs">
            — {useOllama ? `local Gemma` : `Claude`}
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
      </button>

      {open && (
        <div className="border-t border-border">

          {/* Mode toggle bar */}
          <div className="px-4 pt-2 pb-1 flex items-center gap-2 border-b border-border/50">
            <ModeBadge />
            {ollamaOk === false && (
              <span className="text-xs text-faint">Ollama not detected on localhost:11434</span>
            )}
          </div>

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
            <p className="text-faint text-xs mt-1.5 px-1">
              {useOllama ? `Gemma (local) · vibe trading only · not financial advice` : `Claude (cloud) · vibe trading only · not financial advice`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
