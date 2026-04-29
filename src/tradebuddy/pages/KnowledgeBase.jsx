/**
 * KnowledgeBase.jsx — Agent Context Builder + Prompt Library
 *
 * Tab 1 · Context  — instructions, ticker notes, MCP rules (auto-injected)
 * Tab 2 · Prompts  — saved, re-runnable prompts with configurable datasets
 * Tab 3 · Research — Polygon financial data panel
 *
 * Each saved prompt can bundle:
 *   • A message to the agent
 *   • A context snapshot (subset of the user's context entries)
 *   • Configured datasets resolved at run time:
 *       portfolio     — live holdings from DB
 *       watchlist     — user's watchlist
 *       market_snapshot — Polygon live prices for specified tickers
 *       financials    — Polygon statements (income / balance / cashflow) per ticker
 *       mcp_tool      — call a connected MCP server tool with a configured query
 *
 * Exported JSON is MCP-prompt compatible so any MCP client can replay it.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BookOpen, Plus, Trash2, Edit2, X, ToggleLeft, ToggleRight,
  Search, Loader2, BarChart2, Eye,
  Lightbulb, Tag, Plug, AlertCircle, CheckCircle2,
  Play, Copy, Download, Upload, Zap, RefreshCw, FileJson,
  Check, ChevronDown, ChevronUp, Database, TrendingUp,
  List, Wallet,
} from 'lucide-react'
import FinancialsPanel from '../components/FinancialsPanel'
import {
  fetchAgentContext, createAgentContext, updateAgentContext, deleteAgentContext,
  fetchSavedPrompts, createSavedPrompt, updateSavedPrompt, deleteSavedPrompt, runSavedPrompt,
  fetchMCPServersWithTools, fetchPortfolio,
} from '../../common/services/apiService'
import clsx from 'clsx'

// ── Constants ─────────────────────────────────────────────────────

const QUICK_TICKERS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','V','JNJ','XOM','SPY','QQQ',
]

const ENTRY_TYPES = [
  { id:'instruction', label:'Instructions', icon:Lightbulb, color:'text-blue-400',   bg:'bg-blue-400/10',   border:'border-blue-400/20',
    description:'Global rules the agent follows when reasoning and trading',
    placeholder:'e.g. Prefer dividend stocks with yield > 2%.',
    hint:"Appended to the agent's system prompt on every message." },
  { id:'ticker_note', label:'Ticker Notes',  icon:Tag,       color:'text-purple-400', bg:'bg-purple-400/10', border:'border-purple-400/20',
    description:'Research notes attached to specific stocks',
    placeholder:'e.g. Strong AI moat. Watch for margin compression.',
    hint:'Attach a ticker so the agent knows which stock this applies to.' },
  { id:'mcp_rule',   label:'MCP Rules',     icon:Plug,      color:'text-orange-400', bg:'bg-orange-400/10', border:'border-orange-400/20',
    description:'How the agent should interpret data from connected MCP servers',
    placeholder:'e.g. When Tavily returns earnings news, prioritize guidance over beat/miss.',
    hint:'Useful for steering the agent when you have specific MCP tools connected.' },
]

// Dataset type metadata for badges / UI labels
const DATASET_META = {
  portfolio:       { label:'Portfolio',        icon:Wallet,     color:'text-green-400',  bg:'bg-green-400/10',  border:'border-green-400/20' },
  watchlist:       { label:'Watchlist',        icon:List,       color:'text-cyan-400',   bg:'bg-cyan-400/10',   border:'border-cyan-400/20'  },
  market_snapshot: { label:'Market Snapshot',  icon:TrendingUp, color:'text-blue-400',   bg:'bg-blue-400/10',   border:'border-blue-400/20'  },
  financials:      { label:'Financials',       icon:BarChart2,  color:'text-purple-400', bg:'bg-purple-400/10', border:'border-purple-400/20'},
  mcp_tool:        { label:'MCP Tool',         icon:Plug,       color:'text-orange-400', bg:'bg-orange-400/10', border:'border-orange-400/20'},
}

const FINANCIAL_STATEMENTS = [
  { id:'income',   label:'Income Statement' },
  { id:'balance',  label:'Balance Sheet'    },
  { id:'cashflow', label:'Cash Flow'        },
]

const PROMPT_SCHEMA = 'tradebuddy-prompt/v1'

// ── Dataset helpers ───────────────────────────────────────────────

function buildDatasetsArray({ portfolio, watchlist, marketSnap, financialsList, mcpTools }) {
  const arr = []
  if (portfolio) arr.push({ type: 'portfolio' })
  if (watchlist) arr.push({ type: 'watchlist' })
  if (marketSnap.enabled && marketSnap.tickers.trim()) {
    arr.push({
      type: 'market_snapshot',
      tickers: marketSnap.tickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean),
    })
  }
  financialsList.forEach(f => {
    if (f.ticker.trim() && f.statements.length > 0)
      arr.push({ type: 'financials', ticker: f.ticker.trim().toUpperCase(), statements: f.statements })
  })
  mcpTools.forEach(t => {
    if (t.server_id && t.tool_name)
      arr.push({ type: 'mcp_tool', server_id: t.server_id, server_name: t.server_name, tool_name: t.tool_name, query: t.query })
  })
  return arr
}

function parseDatasetsArray(datasets = []) {
  const state = { portfolio: false, watchlist: false, marketSnap: { enabled: false, tickers: '' }, financialsList: [], mcpTools: [] }
  for (const ds of datasets) {
    if (ds.type === 'portfolio')       state.portfolio = true
    if (ds.type === 'watchlist')       state.watchlist = true
    if (ds.type === 'market_snapshot') state.marketSnap = { enabled: true, tickers: (ds.tickers ?? []).join(', ') }
    if (ds.type === 'financials')      state.financialsList.push({ ticker: ds.ticker ?? '', statements: ds.statements ?? ['income'] })
    if (ds.type === 'mcp_tool')        state.mcpTools.push({ server_id: ds.server_id, server_name: ds.server_name ?? '', tool_name: ds.tool_name ?? '', query: ds.query ?? '' })
  }
  return state
}

function typeMeta(type) { return ENTRY_TYPES.find(t => t.id === type) ?? ENTRY_TYPES[0] }

function useClipboard(ms = 1800) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(text => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), ms) })
  }, [ms])
  return { copied, copy }
}

function buildExportJson(prompt) {
  const ctx = Array.isArray(prompt.context_snap) ? prompt.context_snap : []
  const ds  = Array.isArray(prompt.datasets)     ? prompt.datasets     : []
  return {
    schema: PROMPT_SCHEMA,
    id: `prompt-${prompt.id}`,
    title: prompt.title,
    description: prompt.description || '',
    context: ctx,
    datasets: ds,
    mcp: {
      name: prompt.title.toLowerCase().replace(/\s+/g, '-'),
      description: prompt.description || prompt.title,
      arguments: [],
      messages: [{ role: 'user', content: { type: 'text', text: prompt.message } }],
    },
    exported_at: new Date().toISOString(),
  }
}

// ── EntryCard ─────────────────────────────────────────────────────

function EntryCard({ entry, onToggle, onEdit, onDelete, toggling }) {
  const [expanded, setExpanded] = useState(false)
  const meta = typeMeta(entry.type)
  return (
    <div className={clsx('bg-surface-card border rounded-xl transition-all', entry.enabled ? 'border-border' : 'border-border opacity-50')}>
      <div className="flex items-start gap-3 p-4">
        <div className={clsx('mt-0.5 p-1.5 rounded-lg shrink-0', meta.bg)}><meta.icon size={13} className={meta.color} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {entry.ticker && <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 bg-surface-hover border border-border rounded text-muted">{entry.ticker}</span>}
            <span className="text-sm font-medium text-primary">{entry.title}</span>
          </div>
          <p className={clsx('text-xs text-muted mt-1 leading-relaxed', !expanded && 'line-clamp-2')}>{entry.content}</p>
          {entry.content.length > 120 && (
            <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-1 text-[10px] text-muted hover:text-secondary mt-1 transition-colors">
              {expanded ? <><ChevronUp size={10}/> Less</> : <><ChevronDown size={10}/> More</>}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <button onClick={() => onToggle(entry)} disabled={toggling === entry.id} className="text-muted hover:text-primary transition-colors p-1">
            {toggling === entry.id ? <Loader2 size={15} className="animate-spin"/> : entry.enabled ? <ToggleRight size={18} className="text-accent-blue"/> : <ToggleLeft size={18}/>}
          </button>
          <button onClick={() => onEdit(entry)} className="text-muted hover:text-accent-blue transition-colors p-1"><Edit2 size={13}/></button>
          <button onClick={() => onDelete(entry)} className="text-muted hover:text-red-400 transition-colors p-1"><Trash2 size={13}/></button>
        </div>
      </div>
    </div>
  )
}

// ── EntryModal ────────────────────────────────────────────────────

function EntryModal({ entry, defaultType, onSave, onClose, saving }) {
  const [type,    setType]    = useState(entry?.type    ?? defaultType ?? 'instruction')
  const [ticker,  setTicker]  = useState(entry?.ticker  ?? '')
  const [title,   setTitle]   = useState(entry?.title   ?? '')
  const [content, setContent] = useState(entry?.content ?? '')
  const [error,   setError]   = useState('')
  const meta = typeMeta(type)
  const handleSave = () => {
    if (!title.trim())   return setError('Title is required.')
    if (!content.trim()) return setError('Content is required.')
    if (type === 'ticker_note' && !ticker.trim()) return setError('Ticker is required for Ticker Notes.')
    setError('')
    onSave({ type, ticker: ticker.trim().toUpperCase() || null, title: title.trim(), content: content.trim() })
  }
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-primary">{entry ? 'Edit context entry' : 'Add context entry'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-primary transition-colors"><X size={16}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!entry && (
            <div>
              <label className="text-xs text-muted mb-1.5 block">Type</label>
              <div className="grid grid-cols-3 gap-2">
                {ENTRY_TYPES.map(t => (
                  <button key={t.id} onClick={() => setType(t.id)}
                    className={clsx('flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all',
                      type === t.id ? `${t.bg} ${t.border} ${t.color}` : 'bg-surface-hover border-border text-muted hover:text-secondary')}>
                    <t.icon size={16}/>{t.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-2">{meta.hint}</p>
            </div>
          )}
          {type === 'ticker_note' && (
            <div>
              <label className="text-xs text-muted mb-1.5 block">Ticker *</label>
              <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="e.g. NVDA" maxLength={10}
                className="w-full px-3 py-2.5 bg-surface-hover border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all font-mono uppercase"/>
            </div>
          )}
          <div>
            <label className="text-xs text-muted mb-1.5 block">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={type === 'ticker_note' ? 'e.g. NVDA investment thesis' : type === 'mcp_rule' ? 'e.g. Tavily news rule' : 'e.g. Dividend preference'}
              className="w-full px-3 py-2.5 bg-surface-hover border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all"/>
          </div>
          <div>
            <label className="text-xs text-muted mb-1.5 block">Content *</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder={meta.placeholder} rows={5}
              className="w-full px-3 py-2.5 bg-surface-hover border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all resize-none"/>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-secondary hover:text-primary transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-accent-blue text-white rounded-xl text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-50 transition-colors">
            {saving && <Loader2 size={13} className="animate-spin"/>}
            {entry ? 'Save changes' : 'Add to context'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PromptPreview (context) ───────────────────────────────────────

function PromptPreview({ entries }) {
  const enabled = entries.filter(e => e.enabled)
  if (!enabled.length) return null
  const instructions = enabled.filter(e => e.type === 'instruction')
  const tickerNotes  = enabled.filter(e => e.type === 'ticker_note')
  const mcpRules     = enabled.filter(e => e.type === 'mcp_rule')
  const lines = ['[User Knowledge Base]']
  if (instructions.length) { lines.push('AGENT INSTRUCTIONS:'); instructions.forEach(e => lines.push(`• [${e.title}] ${e.content}`)) }
  if (tickerNotes.length)  { lines.push('\nTICKER CONTEXT:');    tickerNotes.forEach(e => lines.push(`• ${e.ticker ? `${e.ticker} — ` : ''}[${e.title}] ${e.content}`)) }
  if (mcpRules.length)     { lines.push('\nMCP RULES:');         mcpRules.forEach(e => lines.push(`• [${e.title}] ${e.content}`)) }
  return (
    <div className="bg-black/20 border border-border/40 rounded-xl p-4">
      <p className="text-[10px] text-muted mb-2 flex items-center gap-1.5"><Eye size={10}/> Injected into every agent message</p>
      <pre className="text-[11px] text-secondary font-mono leading-relaxed whitespace-pre-wrap">{lines.join('\n')}</pre>
    </div>
  )
}

// ── DatasetConfigurator ───────────────────────────────────────────

function DatasetConfigurator({ dsState, onChange, mcpServers, mcpLoading }) {
  const { portfolio, watchlist, marketSnap, financialsList, mcpTools } = dsState

  const set = (key, val) => onChange({ ...dsState, [key]: val })

  // Financials list helpers
  const addFinancials = () => set('financialsList', [...financialsList, { ticker: '', statements: ['income'] }])
  const removeFinancials = i => set('financialsList', financialsList.filter((_, j) => j !== i))
  const updateFinancials = (i, patch) => set('financialsList', financialsList.map((f, j) => j === i ? { ...f, ...patch } : f))
  const toggleStatement = (i, stmtId) => {
    const cur = financialsList[i].statements
    updateFinancials(i, { statements: cur.includes(stmtId) ? cur.filter(s => s !== stmtId) : [...cur, stmtId] })
  }

  // MCP tool list helpers
  const addMCPTool = () => set('mcpTools', [...mcpTools, { server_id: null, server_name: '', tool_name: '', query: '' }])
  const removeMCPTool = i => set('mcpTools', mcpTools.filter((_, j) => j !== i))
  const updateMCPTool = (i, patch) => set('mcpTools', mcpTools.map((t, j) => j === i ? { ...t, ...patch } : t))

  return (
    <div className="space-y-3">

      {/* Portfolio */}
      <DatasetRow
        meta={DATASET_META.portfolio}
        enabled={portfolio}
        onToggle={() => set('portfolio', !portfolio)}
        label="Portfolio holdings"
        description="Injects your live holdings and cash balance at run time"
      />

      {/* Watchlist */}
      <DatasetRow
        meta={DATASET_META.watchlist}
        enabled={watchlist}
        onToggle={() => set('watchlist', !watchlist)}
        label="Watchlist"
        description="Injects your current watchlist symbols"
      />

      {/* Market Snapshot */}
      <DatasetRow
        meta={DATASET_META.market_snapshot}
        enabled={marketSnap.enabled}
        onToggle={() => set('marketSnap', { ...marketSnap, enabled: !marketSnap.enabled })}
        label="Market snapshot"
        description="Fetch live prices from Polygon for specified tickers"
      >
        {marketSnap.enabled && (
          <input
            value={marketSnap.tickers}
            onChange={e => set('marketSnap', { ...marketSnap, tickers: e.target.value.toUpperCase() })}
            placeholder="AAPL, NVDA, MSFT…"
            className="mt-2 w-full px-3 py-2 bg-surface-card border border-border rounded-lg text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 transition-all font-mono"
          />
        )}
      </DatasetRow>

      {/* Financials */}
      <div className={clsx('border rounded-xl overflow-hidden transition-all', 'border-border')}>
        <div className="flex items-center gap-3 p-3 bg-surface-hover">
          <div className={clsx('p-1.5 rounded-lg shrink-0', DATASET_META.financials.bg)}>
            <BarChart2 size={13} className={DATASET_META.financials.color}/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-primary">Financial statements</p>
            <p className="text-[11px] text-muted">Polygon annual financials per ticker (income, balance, cashflow)</p>
          </div>
          <button onClick={addFinancials}
            className="flex items-center gap-1 text-[11px] text-accent-blue hover:text-accent-blue/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent-blue/10">
            <Plus size={11}/> Add ticker
          </button>
        </div>
        {financialsList.length > 0 && (
          <div className="divide-y divide-border">
            {financialsList.map((f, i) => (
              <div key={i} className="p-3 space-y-2 bg-surface-card">
                <div className="flex items-center gap-2">
                  <input value={f.ticker} onChange={e => updateFinancials(i, { ticker: e.target.value.toUpperCase() })}
                    placeholder="Ticker" maxLength={10}
                    className="w-28 px-2.5 py-1.5 bg-surface-hover border border-border rounded-lg text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 transition-all font-mono uppercase"/>
                  <div className="flex gap-2 flex-wrap flex-1">
                    {FINANCIAL_STATEMENTS.map(stmt => (
                      <label key={stmt.id} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={f.statements.includes(stmt.id)} onChange={() => toggleStatement(i, stmt.id)}
                          className="accent-blue-500 w-3 h-3"/>
                        <span className="text-[11px] text-muted">{stmt.label}</span>
                      </label>
                    ))}
                  </div>
                  <button onClick={() => removeFinancials(i)} className="text-muted hover:text-red-400 transition-colors p-1 shrink-0"><Trash2 size={12}/></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MCP Tools */}
      <div className={clsx('border rounded-xl overflow-hidden', 'border-border')}>
        <div className="flex items-center gap-3 p-3 bg-surface-hover">
          <div className={clsx('p-1.5 rounded-lg shrink-0', DATASET_META.mcp_tool.bg)}>
            <Plug size={13} className={DATASET_META.mcp_tool.color}/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-primary">MCP tool calls</p>
            <p className="text-[11px] text-muted">
              {mcpLoading ? 'Loading connected servers…' : mcpServers.length === 0 ? 'No MCP servers connected yet' : `${mcpServers.length} server${mcpServers.length !== 1 ? 's' : ''} available`}
            </p>
          </div>
          {mcpServers.length > 0 && (
            <button onClick={addMCPTool}
              className="flex items-center gap-1 text-[11px] text-accent-blue hover:text-accent-blue/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent-blue/10">
              <Plus size={11}/> Add tool
            </button>
          )}
        </div>
        {mcpTools.length > 0 && (
          <div className="divide-y divide-border">
            {mcpTools.map((t, i) => {
              const chosenServer = mcpServers.find(s => s.id === t.server_id)
              return (
                <div key={i} className="p-3 space-y-2 bg-surface-card">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      {/* Server picker */}
                      <select value={t.server_id ?? ''} onChange={e => {
                          const srv = mcpServers.find(s => String(s.id) === e.target.value)
                          updateMCPTool(i, { server_id: srv?.id ?? null, server_name: srv?.name ?? '', tool_name: '' })
                        }}
                        className="w-full px-2.5 py-1.5 bg-surface-hover border border-border rounded-lg text-xs text-primary focus:outline-none focus:border-accent-blue/50 transition-all">
                        <option value="">Select server…</option>
                        {mcpServers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {/* Tool picker */}
                      {chosenServer && (
                        <select value={t.tool_name} onChange={e => updateMCPTool(i, { tool_name: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-surface-hover border border-border rounded-lg text-xs text-primary focus:outline-none focus:border-accent-blue/50 transition-all">
                          <option value="">Select tool…</option>
                          {(chosenServer.tools ?? []).map(tn => <option key={tn} value={tn}>{tn}</option>)}
                        </select>
                      )}
                      {/* Query */}
                      {t.tool_name && (
                        <input value={t.query} onChange={e => updateMCPTool(i, { query: e.target.value })}
                          placeholder="Query / prompt for this tool…"
                          className="w-full px-2.5 py-1.5 bg-surface-hover border border-border rounded-lg text-xs text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 transition-all"/>
                      )}
                    </div>
                    <button onClick={() => removeMCPTool(i)} className="text-muted hover:text-red-400 transition-colors p-1 mt-0.5 shrink-0"><Trash2 size={12}/></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Reusable toggle row for simple datasets (portfolio, watchlist, market snapshot) */
function DatasetRow({ meta, enabled, onToggle, label, description, children }) {
  return (
    <div className={clsx('border rounded-xl overflow-hidden transition-all', enabled ? meta.border : 'border-border')}>
      <div className={clsx('flex items-center gap-3 p-3', enabled ? meta.bg : 'bg-surface-hover')}>
        <div className={clsx('p-1.5 rounded-lg shrink-0', enabled ? meta.bg : 'bg-surface-card')}>
          <meta.icon size={13} className={enabled ? meta.color : 'text-muted'}/>
        </div>
        <div className="flex-1 min-w-0">
          <p className={clsx('text-xs font-medium', enabled ? 'text-primary' : 'text-secondary')}>{label}</p>
          <p className="text-[11px] text-muted">{description}</p>
        </div>
        <button onClick={onToggle} className="shrink-0">
          {enabled ? <ToggleRight size={18} className="text-accent-blue"/> : <ToggleLeft size={18} className="text-muted"/>}
        </button>
      </div>
      {children && <div className="px-3 pb-3 bg-surface-card">{children}</div>}
    </div>
  )
}

// ── PromptCard ────────────────────────────────────────────────────

function PromptCard({ prompt, contextEntries, onEdit, onDelete, onRun, running }) {
  const { copied, copy } = useClipboard()
  const ctx = Array.isArray(prompt.context_snap) ? prompt.context_snap : []
  const ds  = Array.isArray(prompt.datasets)     ? prompt.datasets     : []

  // Deduplicated dataset type counts
  const dsCounts = ds.reduce((acc, d) => { acc[d.type] = (acc[d.type] || 0) + 1; return acc }, {})

  const handleDownload = () => {
    const json = JSON.stringify(buildExportJson(prompt), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), {
      href: url, download: `${prompt.title.toLowerCase().replace(/\s+/g, '-')}.prompt.json`,
    }).click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-surface-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-primary">{prompt.title}</span>
          {prompt.description && <p className="text-xs text-muted mt-0.5 leading-relaxed">{prompt.description}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onEdit(prompt)} className="p-1.5 text-muted hover:text-accent-blue transition-colors"><Edit2 size={13}/></button>
          <button onClick={() => onDelete(prompt)} className="p-1.5 text-muted hover:text-red-400 transition-colors"><Trash2 size={13}/></button>
        </div>
      </div>

      {/* Message preview */}
      <div className="bg-surface-hover border border-border rounded-lg px-3 py-2">
        <p className="text-[10px] text-muted mb-0.5">Message</p>
        <p className="text-xs text-secondary leading-relaxed line-clamp-2">{prompt.message}</p>
      </div>

      {/* Dataset badges */}
      {(ds.length > 0 || ctx.length > 0) && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {ctx.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-surface-hover border border-border rounded text-muted flex items-center gap-1">
              <Database size={9}/> {ctx.length} context
            </span>
          )}
          {Object.entries(dsCounts).map(([type, count]) => {
            const m = DATASET_META[type]
            if (!m) return null
            return (
              <span key={type} className={clsx('text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1', m.bg, m.border, m.color)}>
                <m.icon size={9}/>
                {count > 1 ? `${count}× ` : ''}{m.label}
              </span>
            )
          })}
        </div>
      )}

      {prompt.run_count > 0 && (
        <p className="text-[10px] text-muted flex items-center gap-1"><RefreshCw size={9}/> Run {prompt.run_count} time{prompt.run_count !== 1 ? 's' : ''}</p>
      )}

      <div className="flex gap-2 pt-1 border-t border-border flex-wrap">
        <button onClick={() => onRun(prompt)} disabled={running === prompt.id}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/90 disabled:opacity-50 transition-colors">
          {running === prompt.id ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>} Run
        </button>
        <button onClick={() => copy(JSON.stringify(buildExportJson(prompt), null, 2))}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover border border-border rounded-lg text-xs text-secondary hover:text-accent-blue hover:border-accent-blue/30 transition-colors">
          {copied ? <Check size={12} className="text-green-400"/> : <Copy size={12}/>}
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
        <button onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover border border-border rounded-lg text-xs text-secondary hover:text-accent-blue hover:border-accent-blue/30 transition-colors">
          <Download size={12}/> Export
        </button>
      </div>
    </div>
  )
}

// ── PromptModal ───────────────────────────────────────────────────

function PromptModal({ prompt, contextEntries, onSave, onClose, saving }) {
  const [title,       setTitle]       = useState(prompt?.title       ?? '')
  const [description, setDescription] = useState(prompt?.description ?? '')
  const [message,     setMessage]     = useState(prompt?.message     ?? '')
  const [selectedCtx, setSelectedCtx] = useState(() => {
    const snap = Array.isArray(prompt?.context_snap) ? prompt.context_snap : []
    return new Set(snap.map(e => `${e.type}::${e.title}`))
  })
  const [dsState,   setDsState]   = useState(() => parseDatasetsArray(prompt?.datasets ?? []))
  const [mcpServers, setMCPServers] = useState([])
  const [mcpLoading, setMCPLoading] = useState(true)
  const [error,      setError]      = useState('')
  const [activeSection, setActiveSection] = useState('message') // 'message' | 'context' | 'datasets'

  useEffect(() => {
    fetchMCPServersWithTools()
      .then(setMCPServers)
      .catch(() => {})
      .finally(() => setMCPLoading(false))
  }, [])

  const toggleCtxEntry = entry => {
    const key = `${entry.type}::${entry.title}`
    setSelectedCtx(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  const handleSave = () => {
    if (!title.trim())   return setError('Title is required.')
    if (!message.trim()) return setError('Message is required.')
    setError('')
    const context_snap = contextEntries
      .filter(e => selectedCtx.has(`${e.type}::${e.title}`))
      .map(({ type, ticker, title: t, content }) => ({ type, ticker, title: t, content }))
    const datasets = buildDatasetsArray(dsState)
    onSave({ title: title.trim(), description: description.trim() || null, message: message.trim(), context_snap, datasets })
  }

  const groupedCtx = ENTRY_TYPES.map(t => ({
    ...t, entries: contextEntries.filter(e => e.type === t.id),
  })).filter(g => g.entries.length > 0)

  const totalDatasets = buildDatasetsArray(dsState).length
  const totalCtx      = selectedCtx.size

  const SectionBtn = ({ id, label, count }) => (
    <button onClick={() => setActiveSection(id)}
      className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
        activeSection === id ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue' : 'bg-surface-hover border-border text-muted hover:text-secondary')}>
      {label}
      {count > 0 && <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-white/10">{count}</span>}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-primary">{prompt ? 'Edit prompt' : 'Save new prompt'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-primary transition-colors"><X size={16}/></button>
        </div>

        {/* Section tabs */}
        <div className="flex gap-2 px-5 pt-4 shrink-0">
          <SectionBtn id="message"  label="Message"  count={0} />
          <SectionBtn id="datasets" label="Datasets"  count={totalDatasets} />
          <SectionBtn id="context"  label="Context snapshot" count={totalCtx} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── MESSAGE section ── */}
          {activeSection === 'message' && <>
            <div>
              <label className="text-xs text-muted mb-1.5 block">Title *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Portfolio dividend analysis"
                className="w-full px-3 py-2.5 bg-surface-hover border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all"/>
            </div>
            <div>
              <label className="text-xs text-muted mb-1.5 block">Description <span className="text-muted/60">(optional)</span></label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this prompt do?"
                className="w-full px-3 py-2.5 bg-surface-hover border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all"/>
            </div>
            <div>
              <label className="text-xs text-muted mb-1.5 block">Message * — sent to the agent at run time</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={7}
                placeholder="e.g. Analyze my portfolio for dividend yield. Identify holdings with payout ratios under 60% and rank them by sustainability."
                className="w-full px-3 py-2.5 bg-surface-hover border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all resize-none"/>
            </div>
            {/* JSON preview */}
            {title.trim() && message.trim() && (
              <div className="bg-black/20 border border-border/40 rounded-xl p-3">
                <p className="text-[10px] text-muted mb-1.5 flex items-center gap-1.5"><FileJson size={10}/> MCP export preview</p>
                <pre className="text-[10px] text-secondary font-mono leading-relaxed overflow-x-auto max-h-24">
                  {JSON.stringify({ schema: PROMPT_SCHEMA, title: title.trim(), datasets: buildDatasetsArray(dsState).length, mcp: { name: title.trim().toLowerCase().replace(/\s+/g,'-') } }, null, 2)}
                </pre>
              </div>
            )}
          </>}

          {/* ── DATASETS section ── */}
          {activeSection === 'datasets' && (
            <DatasetConfigurator
              dsState={dsState}
              onChange={setDsState}
              mcpServers={mcpServers}
              mcpLoading={mcpLoading}
            />
          )}

          {/* ── CONTEXT SNAPSHOT section ── */}
          {activeSection === 'context' && (
            <div className="space-y-3">
              <p className="text-xs text-muted">Select context entries to bundle with this prompt. They override or extend the runner's own active context.</p>
              {groupedCtx.length === 0 ? (
                <p className="text-xs text-muted italic py-4 text-center">No context entries yet — add some in the Context tab first.</p>
              ) : groupedCtx.map(group => (
                <div key={group.id}>
                  <p className={clsx('text-[10px] font-medium mb-1.5 flex items-center gap-1', group.color)}>
                    <group.icon size={10}/> {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.entries.map(entry => {
                      const key = `${entry.type}::${entry.title}`
                      const sel = selectedCtx.has(key)
                      return (
                        <label key={entry.id} className={clsx(
                          'flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all text-xs',
                          sel ? `${group.bg} ${group.border}` : 'bg-surface-hover border-border hover:border-border/80'
                        )}>
                          <input type="checkbox" checked={sel} onChange={() => toggleCtxEntry(entry)} className="mt-0.5 accent-blue-500 shrink-0"/>
                          <div>
                            <span className={clsx('font-medium', sel ? group.color : 'text-secondary')}>
                              {entry.ticker ? `${entry.ticker} — ` : ''}{entry.title}
                            </span>
                            <p className="text-muted line-clamp-1 mt-0.5">{entry.content}</p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-border shrink-0">
          <div className="flex gap-3 text-[11px] text-muted">
            {totalDatasets > 0 && <span className="flex items-center gap-1"><Database size={11}/> {totalDatasets} dataset{totalDatasets!==1?'s':''}</span>}
            {totalCtx      > 0 && <span className="flex items-center gap-1"><Lightbulb size={11}/> {totalCtx} context entr{totalCtx!==1?'ies':'y'}</span>}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-secondary hover:text-primary transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-accent-blue text-white rounded-xl text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-50 transition-colors">
              {saving && <Loader2 size={13} className="animate-spin"/>}
              {prompt ? 'Save changes' : 'Save prompt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── RunResultModal ────────────────────────────────────────────────

function RunResultModal({ result, onClose }) {
  const { copied, copy } = useClipboard()
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface-card border border-border rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-primary">Agent Response</h2>
            {result.prompt_title && <p className="text-xs text-muted mt-0.5">via "{result.prompt_title}"</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-primary transition-colors"><X size={16}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="bg-surface-hover border border-border rounded-xl p-4">
            <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap">{result.response}</p>
          </div>
          {result.trade && (
            <div className="bg-green-400/5 border border-green-400/20 rounded-xl p-3 text-xs text-green-400">
              Trade executed: {result.trade.action} {result.trade.symbol}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border shrink-0">
          <button onClick={() => copy(result.response)}
            className="flex items-center gap-2 px-3 py-2 bg-surface-hover border border-border rounded-lg text-xs text-secondary hover:text-accent-blue transition-colors">
            {copied ? <Check size={12} className="text-green-400"/> : <Copy size={12}/>}
            {copied ? 'Copied' : 'Copy response'}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors">Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────

export default function KnowledgeBase() {
  // Context state
  const [entries,     setEntries]     = useState([])
  const [ctxLoading,  setCtxLoading]  = useState(true)
  const [ctxError,    setCtxError]    = useState(null)
  const [activeType,  setActiveType]  = useState('instruction')
  const [entryModal,  setEntryModal]  = useState(null)
  const [savingEntry, setSavingEntry] = useState(false)
  const [toggling,    setToggling]    = useState(null)
  const [showPreview, setShowPreview] = useState(false)

  // Prompt library state
  const [prompts,       setPrompts]       = useState([])
  const [promptLoading, setPromptLoading] = useState(true)
  const [promptModal,   setPromptModal]   = useState(null)
  const [savingPrompt,  setSavingPrompt]  = useState(false)
  const [runningPrompt, setRunningPrompt] = useState(null)
  const [runResult,     setRunResult]     = useState(null)
  const [portfolio,     setPortfolio]     = useState([])
  const importRef = useRef(null)

  // Financial tab state
  const [activeTab, setActiveTab] = useState('context')
  const [query,   setQuery]   = useState('')
  const [ticker,  setTicker]  = useState('')
  const [pending, setPending] = useState(false)
  const inputRef = useRef(null)

  // Toast
  const [toast, setToast] = useState(null)
  const showToast = useCallback((msg, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 2500)
  }, [])

  // Load
  useEffect(() => {
    fetchAgentContext().then(setEntries).catch(() => setCtxError('Could not load context entries.')).finally(() => setCtxLoading(false))
    fetchSavedPrompts().then(setPrompts).catch(() => {}).finally(() => setPromptLoading(false))
    fetchPortfolio().then(d => setPortfolio(d.holdings ?? [])).catch(() => {})
  }, [])

  useEffect(() => { if (activeTab === 'research') inputRef.current?.focus() }, [activeTab])

  // Context CRUD
  const handleSaveEntry = async (data) => {
    setSavingEntry(true)
    try {
      if (entryModal.mode === 'edit') {
        const u = await updateAgentContext(entryModal.entry.id, data)
        setEntries(prev => prev.map(e => e.id === u.id ? u : e))
        showToast('Entry updated')
      } else {
        const c = await createAgentContext(data)
        setEntries(prev => [...prev, c])
        showToast('Entry added — active immediately')
      }
      setEntryModal(null)
    } catch { showToast('Failed to save entry', false) }
    finally { setSavingEntry(false) }
  }

  const handleToggleEntry = async (entry) => {
    setToggling(entry.id)
    try {
      const u = await updateAgentContext(entry.id, { enabled: !entry.enabled })
      setEntries(prev => prev.map(e => e.id === u.id ? u : e))
    } catch { showToast('Failed to update', false) }
    finally { setToggling(null) }
  }

  const handleDeleteEntry = async (entry) => {
    if (!window.confirm(`Delete "${entry.title}"?`)) return
    try { await deleteAgentContext(entry.id); setEntries(prev => prev.filter(e => e.id !== entry.id)); showToast('Entry deleted') }
    catch { showToast('Failed to delete', false) }
  }

  // Prompt CRUD
  const handleSavePrompt = async (data) => {
    setSavingPrompt(true)
    try {
      if (promptModal.mode === 'edit') {
        const u = await updateSavedPrompt(promptModal.prompt.id, data)
        setPrompts(prev => prev.map(p => p.id === u.id ? u : p))
        showToast('Prompt updated')
      } else {
        const c = await createSavedPrompt(data)
        setPrompts(prev => [c, ...prev])
        showToast('Prompt saved')
      }
      setPromptModal(null)
    } catch { showToast('Failed to save prompt', false) }
    finally { setSavingPrompt(false) }
  }

  const handleDeletePrompt = async (prompt) => {
    if (!window.confirm(`Delete "${prompt.title}"?`)) return
    try { await deleteSavedPrompt(prompt.id); setPrompts(prev => prev.filter(p => p.id !== prompt.id)); showToast('Prompt deleted') }
    catch { showToast('Failed to delete', false) }
  }

  const handleRunPrompt = async (prompt) => {
    setRunningPrompt(prompt.id)
    try {
      const result = await runSavedPrompt(prompt.id, { portfolio })
      setPrompts(prev => prev.map(p => p.id === prompt.id ? { ...p, run_count: (p.run_count || 0) + 1 } : p))
      setRunResult(result)
    } catch (e) { showToast(e.message || 'Run failed', false) }
    finally { setRunningPrompt(null) }
  }

  const handleImportJson = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const p = JSON.parse(ev.target.result)
        const title   = p.title || p.mcp?.name || 'Imported prompt'
        const message = p.message ?? p.mcp?.messages?.find(m => m.role === 'user')?.content?.text ?? ''
        if (!message) { showToast('Could not find message in JSON', false); return }
        setPromptModal({ mode: 'create', prefill: { title, message, context_snap: p.context ?? [], datasets: p.datasets ?? [] } })
      } catch { showToast('Invalid JSON file', false) }
    }
    reader.readAsText(file); e.target.value = ''
  }

  // Financial tab
  const submit = sym => {
    const s = sym.trim().toUpperCase(); if (!s) return
    setQuery(s); setTicker(''); setPending(true)
    setTimeout(() => { setTicker(s); setPending(false) }, 0)
  }
  const handleSearch = e => { e.preventDefault(); submit(query) }

  const currentTypeMeta = typeMeta(activeType)
  const visibleEntries  = entries.filter(e => e.type === activeType)
  const enabledCount    = entries.filter(e => e.enabled).length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Toast */}
      {toast && (
        <div className={clsx('fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium border',
          toast.ok ? 'bg-surface-card border-green-500/30 text-green-400' : 'bg-surface-card border-red-500/30 text-red-400')}>
          {toast.ok ? <CheckCircle2 size={15}/> : <AlertCircle size={15}/>} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <BookOpen size={22} className="text-accent-blue"/>
          <div>
            <h1 className="text-xl font-semibold text-primary leading-tight">Agent Context Builder</h1>
            <p className="text-sm text-muted">
              {enabledCount > 0
                ? `${enabledCount} context entr${enabledCount===1?'y':'ies'} active · ${prompts.length} saved prompt${prompts.length!==1?'s':''}`
                : 'Build context and reusable prompts for your trading agent'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {activeTab === 'context' && entries.length > 0 && (
            <button onClick={() => setShowPreview(v => !v)}
              className={clsx('flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-all',
                showPreview ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue' : 'bg-surface-hover border-border text-muted hover:text-secondary')}>
              <Eye size={14}/> Preview
            </button>
          )}
          {activeTab === 'context' && (
            <button onClick={() => setEntryModal({ mode: 'create', defaultType: activeType })}
              className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-xl text-sm font-medium hover:bg-accent-blue/90 transition-colors">
              <Plus size={15}/> Add entry
            </button>
          )}
          {activeTab === 'prompts' && (
            <div className="flex gap-2">
              <button onClick={() => importRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-surface-hover border border-border rounded-xl text-sm text-muted hover:text-secondary transition-colors">
                <Upload size={14}/> Import
              </button>
              <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportJson}/>
              <button onClick={() => setPromptModal({ mode: 'create' })}
                className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-xl text-sm font-medium hover:bg-accent-blue/90 transition-colors">
                <Plus size={15}/> New prompt
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-surface-hover rounded-xl w-fit border border-border">
        {[
          { id:'context',  label:'Context',        icon:Lightbulb },
          { id:'prompts',  label:'Prompt Library',  icon:FileJson  },
          { id:'research', label:'Financial Data',  icon:BarChart2 },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab.id ? 'bg-surface-card text-primary shadow-sm border border-border' : 'text-muted hover:text-secondary')}>
            <tab.icon size={14}/>{tab.label}
            {tab.id === 'prompts' && prompts.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono bg-surface-card/50">{prompts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ CONTEXT TAB ═══ */}
      {activeTab === 'context' && (
        <div className="space-y-5">
          {showPreview && <PromptPreview entries={entries}/>}
          <div className="flex gap-2 flex-wrap">
            {ENTRY_TYPES.map(t => {
              const count = entries.filter(e => e.type === t.id).length
              return (
                <button key={t.id} onClick={() => setActiveType(t.id)}
                  className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all',
                    activeType === t.id ? `${t.bg} ${t.border} ${t.color}` : 'bg-surface-card border-border text-muted hover:text-secondary')}>
                  <t.icon size={14}/>{t.label}
                  {count > 0 && <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-mono', activeType === t.id ? 'bg-white/10' : 'bg-surface-hover')}>{count}</span>}
                </button>
              )
            })}
          </div>
          <div className={clsx('flex items-start gap-2.5 p-3 rounded-xl border', currentTypeMeta.bg, currentTypeMeta.border)}>
            <currentTypeMeta.icon size={14} className={clsx('mt-0.5 shrink-0', currentTypeMeta.color)}/>
            <div>
              <p className={clsx('text-xs font-medium', currentTypeMeta.color)}>{currentTypeMeta.label}</p>
              <p className="text-xs text-muted mt-0.5">{currentTypeMeta.description}. {currentTypeMeta.hint}</p>
            </div>
          </div>
          {ctxLoading ? <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-muted"/></div>
          : ctxError  ? <div className="flex items-center gap-2 text-sm text-red-400 py-6"><AlertCircle size={15}/>{ctxError}</div>
          : visibleEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className={clsx('w-14 h-14 rounded-2xl flex items-center justify-center mb-3', currentTypeMeta.bg)}>
                <currentTypeMeta.icon size={24} className={currentTypeMeta.color}/>
              </div>
              <p className="text-sm text-primary font-medium mb-1">No {currentTypeMeta.label.toLowerCase()} yet</p>
              <p className="text-xs text-muted mb-4 max-w-xs">{currentTypeMeta.description}</p>
              <button onClick={() => setEntryModal({ mode:'create', defaultType: activeType })} className="text-xs text-accent-blue hover:underline">+ Add your first entry</button>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleEntries.map(entry => (
                <EntryCard key={entry.id} entry={entry} toggling={toggling}
                  onToggle={handleToggleEntry}
                  onEdit={e => setEntryModal({ mode:'edit', entry: e })}
                  onDelete={handleDeleteEntry}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ PROMPTS TAB ═══ */}
      {activeTab === 'prompts' && (
        <div className="space-y-5">
          <div className="flex items-start gap-2.5 p-3 rounded-xl border bg-purple-400/5 border-purple-400/20">
            <FileJson size={14} className="mt-0.5 shrink-0 text-purple-400"/>
            <div>
              <p className="text-xs font-medium text-purple-400">Reusable Prompts</p>
              <p className="text-xs text-muted mt-0.5">Each prompt bundles a message, a context snapshot, and configurable datasets (portfolio, watchlist, live prices, financials, MCP tools) resolved fresh at run time. Export as MCP-compatible JSON to share.</p>
            </div>
          </div>
          {promptLoading ? <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-muted"/></div>
          : prompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-purple-400/10 flex items-center justify-center mb-3"><FileJson size={24} className="text-purple-400"/></div>
              <p className="text-sm text-primary font-medium mb-1">No saved prompts yet</p>
              <p className="text-xs text-muted mb-4 max-w-xs">Save a message with datasets and context, then share the JSON or re-run it any time.</p>
              <button onClick={() => setPromptModal({ mode:'create' })} className="text-xs text-accent-blue hover:underline">+ Save your first prompt</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {prompts.map(prompt => (
                <PromptCard key={prompt.id} prompt={prompt} contextEntries={entries}
                  onEdit={p => setPromptModal({ mode:'edit', prompt: p })}
                  onDelete={handleDeletePrompt}
                  onRun={handleRunPrompt}
                  running={runningPrompt}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ RESEARCH TAB ═══ */}
      {activeTab === 'research' && (
        <div className="space-y-5">
          <p className="text-xs text-muted">Research a company, then save notes as a Ticker Note or bundle them into a Prompt.</p>
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"/>
              <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value.toUpperCase())} placeholder="Enter ticker — AAPL, MSFT, NVDA…"
                className="w-full pl-10 pr-4 py-2.5 bg-surface-card border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all"/>
            </div>
            <button type="submit" disabled={!query.trim() || pending}
              className="px-5 py-2.5 bg-accent-blue text-white rounded-xl text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
              {pending ? <Loader2 size={15} className="animate-spin"/> : <Search size={15}/>} Search
            </button>
          </form>
          <div>
            <p className="text-xs text-muted mb-2">Quick access</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_TICKERS.map(t => (
                <button key={t} onClick={() => submit(t)}
                  className="px-3 py-1.5 bg-surface-card border border-border rounded-lg text-xs text-secondary hover:text-accent-blue hover:border-accent-blue/30 hover:bg-accent-blue/5 transition-colors font-mono font-medium">
                  {t}
                </button>
              ))}
            </div>
          </div>
          {ticker && !pending && (
            <>
              <FinancialsPanel ticker={ticker} showRag={true}/>
              <button onClick={() => { setActiveTab('context'); setActiveType('ticker_note'); setEntryModal({ mode:'create', defaultType:'ticker_note' }) }}
                className="flex items-center gap-2 px-4 py-2 bg-surface-hover border border-border rounded-xl text-sm text-secondary hover:text-accent-blue hover:border-accent-blue/30 transition-colors">
                <Plus size={14}/> Save notes on {ticker} to context
              </button>
            </>
          )}
          {!ticker && !pending && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-accent-blue/10 flex items-center justify-center mb-4"><BarChart2 size={28} className="text-accent-blue"/></div>
              <h2 className="text-base font-semibold text-primary mb-2">Search a public company</h2>
              <p className="text-sm text-muted max-w-xs">Load financial statements, then save your analysis as a Ticker Note or Prompt.</p>
            </div>
          )}
          {ticker && <p className="text-[11px] text-muted text-center pb-2">Data from Polygon.io · Cached daily · For research purposes only</p>}
        </div>
      )}

      {/* Modals */}
      {entryModal && (
        <EntryModal entry={entryModal.mode==='edit' ? entryModal.entry : null} defaultType={entryModal.defaultType}
          onSave={handleSaveEntry} onClose={() => setEntryModal(null)} saving={savingEntry}/>
      )}
      {promptModal && (
        <PromptModal
          prompt={promptModal.mode==='edit' ? promptModal.prompt : promptModal.prefill ?? null}
          contextEntries={entries}
          onSave={handleSavePrompt} onClose={() => setPromptModal(null)} saving={savingPrompt}/>
      )}
      {runResult && <RunResultModal result={runResult} onClose={() => setRunResult(null)}/>}
    </div>
  )
}
