/**
 * PromptManager.jsx
 *
 * Tab 1 · Prompts      — saved, re-runnable prompt templates with @token syntax
 * Tab 2 · Agent Context — per-user instructions/notes injected into the trading agent
 *
 * Token syntax (reference panel):
 *   {{date}}  {{time}}  {{day}}  {{user}}  {{market_status}}
 *   @portfolio  @watchlist  @market
 *   @AAPL  @AAPL:financials  @AAPL:financials:quarterly
 *   @mcp:server_name:tool_name
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Wand2, Plus, Trash2, Edit2, X, ToggleLeft, ToggleRight,
  Loader2, AlertCircle, CheckCircle2, Play, Copy,
  Lightbulb, Tag, Plug, ChevronRight, ChevronDown,
  Info, BookOpen, Terminal, Clock, Mail, KeyRound,
} from 'lucide-react'
import { useKeys } from '../../common/context/KeysContext'
import { useApp, ACTIONS } from '../context/AppContext'
import FinancialsPanel from '../components/FinancialsPanel'
import {
  fetchAgentContext, createAgentContext, updateAgentContext, deleteAgentContext,
  fetchSavedPrompts, createSavedPrompt, updateSavedPrompt, deleteSavedPrompt,
  runSavedPrompt, runPromptTemplate, validatePromptTemplate,
  fetchMCPServersWithTools,
} from '../../common/services/apiService'
import clsx from 'clsx'

// ── Token reference data ──────────────────────────────────────────

const BUILTIN_TOKENS = [
  { token: '{{date}}',          desc: "Today's date (YYYY-MM-DD)" },
  { token: '{{time}}',          desc: 'Current time in ET' },
  { token: '{{day}}',           desc: 'Day of the week' },
  { token: '{{user}}',          desc: 'Your display name' },
  { token: '{{user_email}}',    desc: 'Your email address' },
  { token: '{{market_status}}', desc: '"Open" or "Closed"' },
]

const DATA_TOKENS = [
  { token: '@portfolio',                   desc: 'Your current holdings + cash' },
  { token: '@watchlist',                   desc: 'Your watchlist symbols' },
  { token: '@market',                      desc: 'Live snapshot — all portfolio + watchlist symbols' },
  { token: '@TICKER',                      desc: 'Live quote for a specific ticker (e.g. @AAPL)' },
  { token: '@TICKER:financials',           desc: 'Annual financial statements for a ticker' },
  { token: '@TICKER:financials:quarterly', desc: 'Quarterly financial statements' },
]

const ACTION_TOKENS = [
  { token: '@email', desc: 'Send results to your email via Resend' },
]

// ── Token regex (mirrors server/promptRunner.js) ──────────────────
const TOKEN_RE = /\{\{(\w+)\}\}|@mcp:([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+)|@([A-Z]{1,5}):financials(?::(quarterly|annual))?|@(portfolio|watchlist|market)\b|@([A-Z]{1,5})\b/g

function extractTokens(template) {
  const tokens = []
  const seen   = new Set()
  for (const m of template.matchAll(TOKEN_RE)) {
    const raw = m[0]
    if (seen.has(raw)) continue
    seen.add(raw)
    if (m[1])      tokens.push({ raw, type: 'builtin' })
    else if (m[2]) tokens.push({ raw, type: 'mcp' })
    else if (m[4]) tokens.push({ raw, type: 'financials' })
    else if (m[6]) tokens.push({ raw, type: 'keyword' })
    else if (m[7]) tokens.push({ raw, type: 'ticker' })
  }
  return tokens
}

// ── Agent Context constants ───────────────────────────────────────

const ENTRY_TYPES = [
  {
    id: 'instruction', label: 'Instructions', icon: Lightbulb,
    color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20',
    description: 'Global rules the agent follows when reasoning and trading',
    placeholder: 'e.g. Prefer dividend stocks with yield > 2%.',
    hint: "Appended to the agent's system prompt on every message.",
  },
  {
    id: 'ticker_note', label: 'Ticker Notes', icon: Tag,
    color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20',
    description: 'Research notes attached to specific stocks',
    placeholder: 'e.g. Strong cash generation, watch for buyback announcements.',
    hint: 'Injected into system prompt when the relevant ticker is discussed.',
  },
  {
    id: 'mcp_rule', label: 'MCP Rules', icon: Plug,
    color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20',
    description: 'Rules for when and how to call external MCP tools',
    placeholder: 'e.g. Always search for recent news before making a sector recommendation.',
    hint: 'Tells the agent how to use its MCP tools.',
  },
]

// ── Autocomplete logic ────────────────────────────────────────────

function getAutocompleteItems(text, caretPos, mcpServers) {
  const before = text.slice(0, caretPos)

  // {{ trigger
  const braceMatch = before.match(/\{\{(\w*)$/)
  if (braceMatch) {
    const partial = braceMatch[1].toLowerCase()
    return {
      type: 'builtin',
      items: BUILTIN_TOKENS.filter(t => t.token.slice(2).startsWith(partial)),
      prefix: braceMatch[0],
    }
  }

  // @ trigger
  const atMatch = before.match(/@([\w:.-]*)$/)
  if (!atMatch) return null

  const partial = atMatch[1].toLowerCase()

  // @mcp: → server picker
  if (partial.startsWith('mcp:')) {
    const afterMcp  = partial.slice(4)
    const colonIdx  = afterMcp.indexOf(':')

    if (colonIdx === -1) {
      // Typing server name
      const serverPartial = afterMcp
      return {
        type:   'mcp_server',
        items:  mcpServers.filter(s =>
          s.name.toLowerCase().startsWith(serverPartial)
        ).map(s => ({ token: `@mcp:${s.name}:`, desc: `${s.tools?.length ?? 0} tool(s)` })),
        prefix: atMatch[0],
      }
    } else {
      // Typing tool name
      const serverName = afterMcp.slice(0, colonIdx)
      const toolPartial = afterMcp.slice(colonIdx + 1)
      const server = mcpServers.find(s => s.name.toLowerCase() === serverName.toLowerCase())
      const tools  = server?.tools ?? []
      return {
        type:  'mcp_tool',
        items: tools
          .filter(t => t.toLowerCase().startsWith(toolPartial))
          .map(t => ({ token: `@mcp:${server.name}:${t}`, desc: 'MCP tool' })),
        prefix: atMatch[0],
      }
    }
  }

  // @TICKER:financials
  const tickerFinMatch = partial.match(/^([A-Z]{1,5}):?$/)
  if (partial.match(/^[A-Z]{2,}/)) {
    return {
      type:  'ticker_ext',
      items: [
        { token: `@${partial.toUpperCase()}`,                         desc: 'Live quote' },
        { token: `@${partial.toUpperCase()}:financials`,              desc: 'Annual financials' },
        { token: `@${partial.toUpperCase()}:financials:quarterly`,    desc: 'Quarterly financials' },
      ],
      prefix: atMatch[0],
    }
  }

  // General @ suggestions
  return {
    type:  'general',
    items: [
      ...DATA_TOKENS.filter(t => t.token.startsWith(`@${partial}`)),
      ...ACTION_TOKENS.filter(t => t.token.startsWith(`@${partial}`)),
      { token: '@mcp:', desc: 'MCP tool — pick server + tool' },
    ],
    prefix: atMatch[0],
  }
}

// ── PromptEditor ──────────────────────────────────────────────────

function PromptEditor({ value, onChange, placeholder, rows = 18 }) {
  const taRef      = useRef(null)
  const [ac, setAc] = useState(null)   // autocomplete state
  const [acIdx, setAcIdx] = useState(0)
  const [mcpServers, setMcpServers] = useState([])

  useEffect(() => {
    fetchMCPServersWithTools().then(setMcpServers).catch(() => {})
  }, [])

  function handleKeyDown(e) {
    if (!ac || !ac.items.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx(i => (i + 1) % ac.items.length) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIdx(i => (i - 1 + ac.items.length) % ac.items.length) }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertToken(ac.items[acIdx].token)
    }
    if (e.key === 'Escape') setAc(null)
  }

  function handleInput(e) {
    onChange(e.target.value)
    const pos  = e.target.selectionStart
    const text = e.target.value
    const suggestions = getAutocompleteItems(text, pos, mcpServers)
    setAc(suggestions && suggestions.items.length ? suggestions : null)
    setAcIdx(0)
  }

  function insertToken(token) {
    if (!taRef.current) return
    const ta    = taRef.current
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const text  = ta.value
    const before = text.slice(0, start)
    const after  = text.slice(end)
    // Remove the partial trigger that's already typed
    const triggerLen = ac?.prefix?.length ?? 0
    const newText = before.slice(0, before.length - triggerLen) + token + ' ' + after
    onChange(newText)
    setAc(null)
    // Restore caret
    setTimeout(() => {
      const newPos = before.length - triggerLen + token.length + 1
      ta.setSelectionRange(newPos, newPos)
      ta.focus()
    }, 0)
  }

  // Insert at cursor (called from info panel clicks)
  function insertAtCursor(token) {
    if (!taRef.current) return
    const ta    = taRef.current
    const start = ta.selectionStart ?? ta.value.length
    const end   = ta.selectionEnd   ?? ta.value.length
    const newText = ta.value.slice(0, start) + token + ta.value.slice(end)
    onChange(newText)
    setTimeout(() => {
      const newPos = start + token.length
      ta.setSelectionRange(newPos, newPos)
      ta.focus()
    }, 0)
  }

  // Expose insertAtCursor via ref
  useEffect(() => {
    if (taRef.current) taRef.current._insertToken = insertToken
  })

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setAc(null), 150)}
        rows={rows}
        placeholder={placeholder}
        spellCheck={false}
        className={clsx(
          'w-full resize-none rounded-xl border border-border bg-surface px-4 py-3',
          'text-sm text-primary font-mono leading-relaxed',
          'focus:outline-none focus:ring-1 focus:ring-accent-blue/50 focus:border-accent-blue/50',
          'placeholder:text-muted/40'
        )}
      />

      {/* Autocomplete dropdown */}
      {ac && ac.items.length > 0 && (
        <div className="absolute z-50 left-4 bg-surface-card border border-border rounded-lg shadow-lg overflow-hidden"
             style={{ top: '100%', marginTop: 2, minWidth: 260, maxHeight: 220, overflowY: 'auto' }}>
          {ac.items.map((item, i) => (
            <button
              key={item.token}
              onMouseDown={e => { e.preventDefault(); insertToken(item.token) }}
              className={clsx(
                'w-full text-left px-3 py-2 flex items-center gap-3 text-sm transition-colors',
                i === acIdx ? 'bg-accent-blue/15 text-accent-blue' : 'text-primary hover:bg-surface-hover'
              )}
            >
              <span className="font-mono text-xs text-accent-blue/80 truncate">{item.token}</span>
              <span className="text-muted text-xs ml-auto shrink-0">{item.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── TokenBadge ────────────────────────────────────────────────────

function TokenBadge({ token }) {
  const colors = {
    builtin:    'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
    keyword:    'bg-blue-400/10 text-blue-400 border-blue-400/20',
    ticker:     'bg-green-400/10 text-green-400 border-green-400/20',
    financials: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
    mcp:        'bg-orange-400/10 text-orange-400 border-orange-400/20',
  }
  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border',
      colors[token.type] ?? 'bg-muted/10 text-muted border-border'
    )}>
      {token.raw}
    </span>
  )
}

// ── InfoPanel ─────────────────────────────────────────────────────

function InfoPanel({ open, onToggle, editorRef, mcpServers }) {
  const [mcpExpanded, setMcpExpanded] = useState(true)

  function insert(token) {
    // Try to call insertAtCursor on the active textarea
    const ta = editorRef?.current
    if (ta?._insertToken) {
      ta._insertToken(token)
    } else if (ta) {
      const start = ta.selectionStart ?? ta.value.length
      const ev    = { target: { value: ta.value.slice(0, start) + token + ' ' + ta.value.slice(start) } }
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  return (
    <div className={clsx(
      'border-l border-border bg-surface-card transition-all duration-200 overflow-hidden shrink-0',
      open ? 'w-64' : 'w-10'
    )}>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        title={open ? 'Close reference panel' : 'Open token reference'}
        className="w-full flex items-center justify-center gap-2 px-3 py-3 text-muted hover:text-primary border-b border-border transition-colors"
      >
        <Info size={15} />
        {open && <span className="text-xs font-medium flex-1 text-left">Token Reference</span>}
        {open && <ChevronRight size={13} />}
      </button>

      {open && (
        <div className="p-3 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>

          {/* Built-ins */}
          <section>
            <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-2">Built-ins</p>
            <div className="space-y-1">
              {BUILTIN_TOKENS.map(t => (
                <button
                  key={t.token}
                  onClick={() => insert(t.token)}
                  title={`Insert ${t.token}`}
                  className="w-full text-left group rounded-md px-2 py-1.5 hover:bg-surface-hover transition-colors"
                >
                  <code className="text-[11px] text-yellow-400 group-hover:text-yellow-300">{t.token}</code>
                  <p className="text-[10px] text-muted mt-0.5 leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Data tokens */}
          <section>
            <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-2">Data</p>
            <div className="space-y-1">
              {DATA_TOKENS.map(t => (
                <button
                  key={t.token}
                  onClick={() => insert(t.token)}
                  title={`Insert ${t.token}`}
                  className="w-full text-left group rounded-md px-2 py-1.5 hover:bg-surface-hover transition-colors"
                >
                  <code className="text-[11px] text-blue-400 group-hover:text-blue-300">{t.token}</code>
                  <p className="text-[10px] text-muted mt-0.5 leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Action tokens */}
          <section>
            <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-2">Actions</p>
            <div className="space-y-1">
              {ACTION_TOKENS.map(t => (
                <button
                  key={t.token}
                  onClick={() => insert(t.token)}
                  title={`Insert ${t.token}`}
                  className="w-full text-left group rounded-md px-2 py-1.5 hover:bg-surface-hover transition-colors"
                >
                  <code className="text-[11px] text-green-400 group-hover:text-green-300">{t.token}</code>
                  <p className="text-[10px] text-muted mt-0.5 leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* MCP tools */}
          {mcpServers.length > 0 && (
            <section>
              <button
                onClick={() => setMcpExpanded(v => !v)}
                className="w-full flex items-center gap-1 text-[10px] text-muted uppercase tracking-wider font-semibold mb-2"
              >
                {mcpExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                MCP Tools
              </button>
              {mcpExpanded && (
                <div className="space-y-2">
                  {mcpServers.map(server => (
                    <div key={server.id}>
                      <p className="text-[10px] text-orange-400/70 font-mono px-2 mb-1">{server.name}</p>
                      <div className="space-y-0.5">
                        {(server.tools ?? []).map(tool => {
                          const token = `@mcp:${server.name}:${tool}`
                          return (
                            <button
                              key={tool}
                              onClick={() => insert(token)}
                              className="w-full text-left group rounded-md px-2 py-1 hover:bg-surface-hover transition-colors"
                            >
                              <code className="text-[11px] text-orange-400 group-hover:text-orange-300 break-all">{token}</code>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <p className="text-[10px] text-muted/50 leading-relaxed border-t border-border pt-3">
            Click any token to insert it at the cursor. Type <code className="text-yellow-400/70">{'{{'}</code> or <code className="text-blue-400/70">@</code> in the editor for autocomplete.
          </p>
        </div>
      )}
    </div>
  )
}

// ── PromptCard ────────────────────────────────────────────────────

function PromptCard({ prompt, onEdit, onDelete, onRun, running }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const tokens = extractTokens(prompt.message)
  const unique = [...new Map(tokens.map(t => [t.type, t])).values()]

  async function handleDelete() {
    setDeleting(true)
    try {
      await onDelete(prompt.id)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="bg-surface-card border border-border rounded-xl p-4 hover:border-accent-blue/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-primary truncate">{prompt.title}</h3>
          {prompt.description && (
            <p className="text-xs text-muted mt-0.5 line-clamp-1">{prompt.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {confirming ? (
            <>
              <span className="text-xs text-muted mr-1">Delete?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 rounded-lg bg-loss/15 text-loss hover:bg-loss/25 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={11} className="animate-spin" /> : 'Yes'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="px-2 py-1 rounded-lg text-muted hover:text-primary hover:bg-surface-hover text-xs transition-colors"
              >
                No
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onRun(prompt)}
                disabled={running}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 disabled:opacity-50 text-xs font-medium transition-colors"
              >
                {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Run
              </button>
              <button onClick={() => onEdit(prompt)} className="p-1.5 text-muted hover:text-primary rounded-lg hover:bg-surface-hover transition-colors">
                <Edit2 size={13} />
              </button>
              <button onClick={() => setConfirming(true)} className="p-1.5 text-muted hover:text-loss rounded-lg hover:bg-loss/10 transition-colors">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Token badges */}
      {unique.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {unique.map(t => <TokenBadge key={t.type} token={t} />)}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted">
        <span>{tokens.length} token{tokens.length !== 1 ? 's' : ''}</span>
        {prompt.run_count > 0 && <span>· {prompt.run_count} run{prompt.run_count !== 1 ? 's' : ''}</span>}
        {prompt.schedule?.enabled && (
          <span className="flex items-center gap-1 text-accent-blue">
            <Clock size={10} />
            {prompt.schedule.time} · {(prompt.schedule.days ?? []).join(' ')}
          </span>
        )}
        <span className="ml-auto">{new Date(prompt.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

// ── PromptModal ───────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney',
]

function defaultSchedule() {
  return { enabled: false, time: '08:30', timezone: 'America/New_York', days: ['Mon','Tue','Wed','Thu','Fri'] }
}

function PromptModal({ prompt, onClose, onSave }) {
  const [title,       setTitle]       = useState(prompt?.title       ?? '')
  const [description, setDescription] = useState(prompt?.description ?? '')
  const [message,     setMessage]     = useState(prompt?.message     ?? SAMPLE_PROMPT)
  const [schedule,    setSchedule]    = useState(() => prompt?.schedule ?? defaultSchedule())
  const [saving,      setSaving]      = useState(false)
  const [validating,  setValidating]  = useState(false)
  const [errors,      setErrors]      = useState([])
  const [mcpServers,  setMcpServers]  = useState([])
  const [infoPanelOpen, setInfoPanelOpen] = useState(true)
  const [showSchedule,  setShowSchedule]  = useState(!!(prompt?.schedule?.enabled))
  const editorRef = useRef(null)

  useEffect(() => {
    fetchMCPServersWithTools().then(setMcpServers).catch(() => {})
  }, [])

  const hasEmailToken = message.includes('@email')

  function toggleDay(day) {
    setSchedule(s => ({
      ...s,
      days: s.days.includes(day) ? s.days.filter(d => d !== day) : [...s.days, day],
    }))
  }

  async function handleSave() {
    if (!title.trim())   return setErrors(['Title is required'])
    if (!message.trim()) return setErrors(['Prompt template is required'])
    if (schedule.enabled && !hasEmailToken) {
      return setErrors(['Scheduled prompts need @email to deliver results — add @email to your template'])
    }

    setValidating(true)
    try {
      const { errors: tokenErrors } = await validatePromptTemplate(message)
      if (tokenErrors.length) { setErrors(tokenErrors); return }
    } catch { /* server error — allow save anyway */ }
    finally { setValidating(false) }

    setSaving(true)
    try {
      await onSave({ title: title.trim(), description: description.trim(), message: message.trim(), schedule })
      onClose()
    } catch (err) {
      setErrors([err.message])
    } finally {
      setSaving(false)
    }
  }

  const tokens = extractTokens(message)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface-card border border-border rounded-2xl flex flex-col overflow-hidden"
           style={{ width: '90vw', maxWidth: 1000, height: '88vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-accent-blue" />
            <h2 className="text-sm font-semibold text-primary">
              {prompt ? 'Edit Prompt' : 'New Prompt'}
            </h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* Main form */}
          <div className="flex-1 flex flex-col overflow-hidden p-5 gap-4">

            {/* Title + description */}
            <div className="grid grid-cols-2 gap-3 shrink-0">
              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium">Title</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Portfolio Risk Analysis"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue/50 focus:border-accent-blue/50"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium">Description <span className="text-muted/50">(optional)</span></label>
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Identify concentration risk across holdings"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue/50 focus:border-accent-blue/50"
                />
              </div>
            </div>

            {/* Token count bar */}
            {tokens.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <span className="text-[11px] text-muted">Tokens:</span>
                {tokens.map(t => <TokenBadge key={t.raw} token={t} />)}
              </div>
            )}

            {/* Errors */}
            {errors.length > 0 && (
              <div className="shrink-0 flex items-start gap-2 bg-loss/10 border border-loss/20 rounded-lg px-3 py-2.5">
                <AlertCircle size={14} className="text-loss shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {errors.map((e, i) => <p key={i} className="text-xs text-loss">{e}</p>)}
                </div>
                <button onClick={() => setErrors([])} className="ml-auto text-loss/50 hover:text-loss"><X size={12} /></button>
              </div>
            )}

            {/* Editor */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <label className="block text-xs text-muted mb-1.5 font-medium shrink-0">
                Prompt Template
                <span className="ml-2 text-muted/50 font-normal">— type <code className="text-yellow-400/70">{'{{'}</code> for built-ins, <code className="text-blue-400/70">@</code> for data tokens</span>
              </label>
              <div className="flex-1 overflow-hidden">
                <PromptEditor
                  value={message}
                  onChange={v => { setMessage(v); setErrors([]) }}
                  placeholder={SAMPLE_PROMPT}
                  rows={16}
                />
              </div>
            </div>
          </div>

          {/* Info panel */}
          <InfoPanel
            open={infoPanelOpen}
            onToggle={() => setInfoPanelOpen(v => !v)}
            editorRef={editorRef}
            mcpServers={mcpServers}
          />
        </div>

        {/* Schedule section */}
        <div className="px-5 py-3 border-t border-border shrink-0 bg-surface">
          <button
            onClick={() => setShowSchedule(v => !v)}
            className="flex items-center gap-2 text-xs text-muted hover:text-primary transition-colors"
          >
            <Clock size={13} className={schedule.enabled ? 'text-accent-blue' : ''} />
            <span className={schedule.enabled ? 'text-accent-blue font-medium' : ''}>
              {schedule.enabled
                ? `Scheduled — ${schedule.time} · ${schedule.days.join(' ')} · ${schedule.timezone}`
                : 'Set schedule (optional)'}
            </span>
            {showSchedule ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          {showSchedule && (
            <div className="mt-3 space-y-3">
              {/* Enable toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSchedule(s => ({ ...s, enabled: !s.enabled }))}
                  className="flex items-center gap-2 text-xs"
                >
                  {schedule.enabled
                    ? <ToggleRight size={18} className="text-accent-blue" />
                    : <ToggleLeft size={18} className="text-muted" />}
                  <span className={schedule.enabled ? 'text-accent-blue font-medium' : 'text-muted'}>
                    {schedule.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </button>
                {schedule.enabled && !hasEmailToken && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-400">
                    <AlertCircle size={11} /> Add <code className="font-mono">@email</code> to receive results
                  </span>
                )}
                {schedule.enabled && hasEmailToken && (
                  <span className="flex items-center gap-1 text-[11px] text-gain">
                    <Mail size={11} /> Results will be emailed to you
                  </span>
                )}
              </div>

              {schedule.enabled && (
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Time */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted">Time</label>
                    <input
                      type="time"
                      value={schedule.time}
                      onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))}
                      className="rounded-lg border border-border bg-surface-card px-2 py-1.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
                    />
                  </div>

                  {/* Timezone */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted">Timezone</label>
                    <select
                      value={schedule.timezone}
                      onChange={e => setSchedule(s => ({ ...s, timezone: e.target.value }))}
                      className="rounded-lg border border-border bg-surface-card px-2 py-1.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
                    >
                      {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                  </div>

                  {/* Days */}
                  <div className="flex items-center gap-1">
                    {DAYS_OF_WEEK.map(day => (
                      <button
                        key={day}
                        onClick={() => toggleDay(day)}
                        className={clsx(
                          'px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                          schedule.days.includes(day)
                            ? 'bg-accent-blue/20 text-accent-blue'
                            : 'text-muted hover:bg-surface-hover'
                        )}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-primary rounded-lg hover:bg-surface-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || validating}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 disabled:opacity-60 transition-colors font-medium"
          >
            {(saving || validating) && <Loader2 size={13} className="animate-spin" />}
            {validating ? 'Validating…' : saving ? 'Saving…' : 'Save Prompt'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RunResultModal ────────────────────────────────────────────────

function RunResultModal({ result, onClose }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(result.text ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface-card border border-border rounded-2xl flex flex-col overflow-hidden"
           style={{ width: '90vw', maxWidth: 760, maxHeight: '88vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-primary truncate">
              {result.prompt_title ?? 'Prompt Result'}
            </h2>
            <div className="flex items-center gap-3 mt-1">
              {result.tokensResolved?.length > 0 && (
                <span className="text-[11px] text-muted">
                  {result.tokensResolved.length} token{result.tokensResolved.length !== 1 ? 's' : ''} resolved
                </span>
              )}
              {result.toolCallsMade?.length > 0 && (
                <span className="text-[11px] text-orange-400">
                  {result.toolCallsMade.length} MCP call{result.toolCallsMade.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-primary border border-border rounded-lg hover:bg-surface-hover transition-colors">
              {copied ? <CheckCircle2 size={12} className="text-gain" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={onClose} className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Result */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result.text ? (
            <div className="prose prose-sm prose-invert max-w-none text-sm text-primary leading-relaxed whitespace-pre-wrap font-sans">
              {result.text}
            </div>
          ) : (
            <p className="text-muted text-sm italic">No response returned.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Agent Context components ──────────────────────────────────────

function EntryCard({ entry, onEdit, onDelete, onToggle }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const meta = ENTRY_TYPES.find(t => t.id === entry.type) ?? ENTRY_TYPES[0]
  const Icon = meta.icon

  async function handleDelete() {
    setDeleting(true)
    try {
      await onDelete(entry.id)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className={clsx(
      'rounded-xl border p-4 transition-all',
      entry.enabled ? `${meta.bg} ${meta.border}` : 'bg-surface-card border-border opacity-60'
    )}>
      <div className="flex items-start gap-3">
        <div className={clsx('p-1.5 rounded-lg shrink-0', meta.bg)}>
          <Icon size={14} className={meta.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {entry.ticker && (
              <span className={clsx('text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded', meta.bg, meta.color)}>
                {entry.ticker}
              </span>
            )}
            <h3 className="text-sm font-medium text-primary truncate">{entry.title}</h3>
          </div>
          <p className="text-xs text-muted leading-relaxed line-clamp-2">{entry.content}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {confirming ? (
            <>
              <span className="text-xs text-muted mr-1">Delete?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 rounded-lg bg-loss/15 text-loss hover:bg-loss/25 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={11} className="animate-spin" /> : 'Yes'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="px-2 py-1 rounded-lg text-muted hover:text-primary hover:bg-surface-hover text-xs transition-colors"
              >
                No
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onToggle(entry)} className="text-muted hover:text-primary p-1 rounded hover:bg-black/10 transition-colors">
                {entry.enabled ? <ToggleRight size={16} className={meta.color} /> : <ToggleLeft size={16} />}
              </button>
              <button onClick={() => onEdit(entry)} className="text-muted hover:text-primary p-1 rounded hover:bg-black/10 transition-colors">
                <Edit2 size={13} />
              </button>
              <button onClick={() => setConfirming(true)} className="text-muted hover:text-loss p-1 rounded hover:bg-loss/10 transition-colors">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function EntryModal({ entry, onClose, onSave }) {
  const [type,    setType]    = useState(entry?.type    ?? 'instruction')
  const [ticker,  setTicker]  = useState(entry?.ticker  ?? '')
  const [title,   setTitle]   = useState(entry?.title   ?? '')
  const [content, setContent] = useState(entry?.content ?? '')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  const meta = ENTRY_TYPES.find(t => t.id === type)

  async function handleSave() {
    if (!title.trim())   return setError('Title is required')
    if (!content.trim()) return setError('Content is required')
    setSaving(true)
    try {
      await onSave({ type, ticker: type === 'ticker_note' ? ticker.trim().toUpperCase() || null : null, title: title.trim(), content: content.trim() })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-primary">{entry ? 'Edit Entry' : 'New Context Entry'}</h2>
          <button onClick={onClose} className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Type picker */}
          <div>
            <label className="block text-xs text-muted mb-2 font-medium">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {ENTRY_TYPES.map(t => {
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    className={clsx(
                      'flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-center transition-all',
                      type === t.id ? `${t.bg} ${t.border} ${t.color}` : 'border-border text-muted hover:bg-surface-hover'
                    )}
                  >
                    <Icon size={16} />
                    <span className="text-xs font-medium leading-tight">{t.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-muted mt-2">{meta.hint}</p>
          </div>

          {type === 'ticker_note' && (
            <div>
              <label className="block text-xs text-muted mb-1.5 font-medium">Ticker <span className="text-muted/50">(optional)</span></label>
              <input
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="AAPL"
                maxLength={5}
                className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-muted mb-1.5 font-medium">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={meta.description}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5 font-medium">Content</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={meta.placeholder}
              rows={4}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
            />
          </div>

          {error && (
            <p className="text-xs text-loss flex items-center gap-1.5">
              <AlertCircle size={12} />{error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-primary rounded-lg hover:bg-surface-hover transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 disabled:opacity-60 transition-colors font-medium"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sample prompt ─────────────────────────────────────────────────

const SAMPLE_PROMPT = `You are a portfolio analyst. Today is {{date}} ({{day}}).
Market: {{market_status}}

## Holdings
@portfolio

## Watchlist
@watchlist

## Live Prices
@market

## Tasks
1. Identify my top 3 concentration risks
2. Flag watchlist stocks that look attractive relative to my current holdings
3. Summarize any macro considerations for today
`

// ── Main Page ─────────────────────────────────────────────────────

export default function PromptManager() {
  const { llmConfigured } = useKeys()
  const { dispatch }      = useApp()
  const [activeTab, setActiveTab] = useState('prompts')

  // Prompts state
  const [prompts,     setPrompts]     = useState([])
  const [promptsLoad, setPromptsLoad] = useState(true)
  const [editingPrompt, setEditingPrompt] = useState(null)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [runningId,   setRunningId]   = useState(null)
  const [runResult,   setRunResult]   = useState(null)
  const [promptSearch, setPromptSearch] = useState('')

  // Agent context state
  const [entries,     setEntries]     = useState([])
  const [entriesLoad, setEntriesLoad] = useState(true)
  const [editingEntry, setEditingEntry] = useState(null)
  const [showEntryModal, setShowEntryModal] = useState(false)
  const [filterType,  setFilterType]  = useState('all')

  // ── Load data ─────────────────────────────────────────────────

  useEffect(() => {
    fetchSavedPrompts()
      .then(setPrompts)
      .catch(() => {})
      .finally(() => setPromptsLoad(false))
  }, [])

  useEffect(() => {
    fetchAgentContext()
      .then(setEntries)
      .catch(() => {})
      .finally(() => setEntriesLoad(false))
  }, [])

  // ── Prompts handlers ──────────────────────────────────────────

  async function handleSavePrompt(data) {
    if (editingPrompt) {
      const updated = await updateSavedPrompt(editingPrompt.id, data)
      setPrompts(ps => ps.map(p => p.id === updated.id ? updated : p))
    } else {
      const created = await createSavedPrompt(data)
      setPrompts(ps => [created, ...ps])
    }
    setEditingPrompt(null)
  }

  async function handleDeletePrompt(id) {
    await deleteSavedPrompt(id)
    setPrompts(ps => ps.filter(p => p.id !== id))
  }

  async function handleRunPrompt(prompt) {
    setRunningId(prompt.id)
    try {
      const result = await runSavedPrompt(prompt.id)
      setRunResult({ ...result, prompt_title: prompt.title })
    } catch (err) {
      setRunResult({ text: `Error: ${err.message}`, prompt_title: prompt.title })
    } finally {
      setRunningId(null)
      setPrompts(ps => ps.map(p => p.id === prompt.id ? { ...p, run_count: (p.run_count ?? 0) + 1 } : p))
    }
  }

  // ── Agent context handlers ────────────────────────────────────

  async function handleSaveEntry(data) {
    if (editingEntry) {
      const updated = await updateAgentContext(editingEntry.id, data)
      setEntries(es => es.map(e => e.id === updated.id ? updated : e))
    } else {
      const created = await createAgentContext(data)
      setEntries(es => [created, ...es])
    }
    setEditingEntry(null)
  }

  async function handleDeleteEntry(id) {
    await deleteAgentContext(id)
    setEntries(es => es.filter(e => e.id !== id))
  }

  async function handleToggleEntry(entry) {
    const updated = await updateAgentContext(entry.id, { enabled: !entry.enabled })
    setEntries(es => es.map(e => e.id === updated.id ? updated : e))
  }

  // ── Filtered lists ────────────────────────────────────────────

  const filteredPrompts = prompts.filter(p =>
    !promptSearch || p.title.toLowerCase().includes(promptSearch.toLowerCase()) ||
    p.description?.toLowerCase().includes(promptSearch.toLowerCase())
  )

  const filteredEntries = entries.filter(e =>
    filterType === 'all' || e.type === filterType
  )

  const enabledCount = entries.filter(e => e.enabled).length

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* LLM not-configured notice */}
      {!llmConfigured && (
        <div className="flex items-center gap-2 px-6 py-2.5 bg-yellow-400/8 border-b border-yellow-400/20 text-yellow-400 text-xs shrink-0">
          <KeyRound size={12} className="shrink-0" />
          No AI provider configured — prompts will fail to run.{' '}
          <button
            onClick={() => dispatch({ type: ACTIONS.NAVIGATE, payload: 'settings' })}
            className="underline hover:no-underline"
          >
            Set up in My Keys →
          </button>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-accent-blue/10">
            <Wand2 size={18} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-primary">Prompt Manager</h1>
            <p className="text-xs text-muted mt-0.5">Build and run stateless prompts with live data tokens</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-surface rounded-xl p-1 border border-border">
          {[
            { id: 'prompts', label: 'Prompts',       icon: Terminal },
            { id: 'context', label: 'Agent Context', icon: BookOpen },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                activeTab === id
                  ? 'bg-accent-blue text-white shadow-sm'
                  : 'text-muted hover:text-primary hover:bg-surface-hover'
              )}
            >
              <Icon size={14} />
              {label}
              {id === 'context' && enabledCount > 0 && (
                <span className="ml-0.5 bg-white/20 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {enabledCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Prompts tab ─────────────────────────────────────────── */}
      {activeTab === 'prompts' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-5">
            <input
              value={promptSearch}
              onChange={e => setPromptSearch(e.target.value)}
              placeholder="Search prompts…"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
            />
            <button
              onClick={() => { setEditingPrompt(null); setShowPromptModal(true) }}
              className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 text-sm font-medium transition-colors shrink-0"
            >
              <Plus size={14} />
              New Prompt
            </button>
          </div>

          {/* List */}
          {promptsLoad ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          ) : filteredPrompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Wand2 size={32} className="text-muted/30 mb-3" />
              <p className="text-muted text-sm">
                {promptSearch ? 'No prompts match your search' : 'No saved prompts yet'}
              </p>
              {!promptSearch && (
                <button
                  onClick={() => { setEditingPrompt(null); setShowPromptModal(true) }}
                  className="mt-3 text-accent-blue text-sm hover:underline"
                >
                  Create your first prompt
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredPrompts.map(prompt => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  onEdit={p => { setEditingPrompt(p); setShowPromptModal(true) }}
                  onDelete={handleDeletePrompt}
                  onRun={handleRunPrompt}
                  running={runningId === prompt.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Agent Context tab ────────────────────────────────────── */}
      {activeTab === 'context' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-1 bg-surface rounded-xl p-1 border border-border">
              {[{ id: 'all', label: 'All' }, ...ENTRY_TYPES.map(t => ({ id: t.id, label: t.label }))].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilterType(f.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    filterType === f.id
                      ? 'bg-surface-card text-primary shadow-sm border border-border'
                      : 'text-muted hover:text-primary'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setEditingEntry(null); setShowEntryModal(true) }}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 text-sm font-medium transition-colors"
            >
              <Plus size={14} />
              Add Entry
            </button>
          </div>

          {/* Info banner */}
          <div className="flex items-start gap-2.5 bg-accent-blue/5 border border-accent-blue/15 rounded-xl px-4 py-3 mb-5 text-xs text-accent-blue/80">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>
              Enabled entries are automatically injected into the <strong>Trading Agent</strong> system prompt on every conversation.
              They are separate from Prompt Manager templates.
            </span>
          </div>

          {/* List */}
          {entriesLoad ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen size={32} className="text-muted/30 mb-3" />
              <p className="text-muted text-sm">No context entries yet</p>
              <button
                onClick={() => { setEditingEntry(null); setShowEntryModal(true) }}
                className="mt-3 text-accent-blue text-sm hover:underline"
              >
                Add your first entry
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map(entry => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={e => { setEditingEntry(e); setShowEntryModal(true) }}
                  onDelete={handleDeleteEntry}
                  onToggle={handleToggleEntry}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────── */}

      {showPromptModal && (
        <PromptModal
          prompt={editingPrompt}
          onClose={() => { setShowPromptModal(false); setEditingPrompt(null) }}
          onSave={handleSavePrompt}
        />
      )}

      {showEntryModal && (
        <EntryModal
          entry={editingEntry}
          onClose={() => { setShowEntryModal(false); setEditingEntry(null) }}
          onSave={handleSaveEntry}
        />
      )}

      {runResult && (
        <RunResultModal
          result={runResult}
          onClose={() => setRunResult(null)}
        />
      )}
    </div>
  )
}
