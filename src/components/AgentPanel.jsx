/**
 * AgentPanel.jsx
 * Fixed right-side drawer containing the Trading Agent.
 * Includes a settings panel for users to configure their LLM provider,
 * model, and personal API key.
 */

import { useEffect, useCallback, useState } from 'react'
import { X, Sparkles, Settings, Eye, EyeOff, CheckCircle2, ChevronDown,
         Plug, Plus, Trash2, RefreshCw, AlertCircle, ToggleLeft, ToggleRight } from 'lucide-react'
import { useApp, ACTIONS } from '../context/AppContext'
import { fetchPortfolio }  from '../services/apiService'
import { getLLMSettings, saveLLMSettings } from '../services/apiService'
import TradingAgent from './TradingAgent'

// ── LLM Settings panel ───────────────────────────────────────────
function LLMSettings({ onClose }) {
  const [providers, setProviders]   = useState({})
  const [provider, setProvider]     = useState('anthropic')
  const [model, setModel]           = useState('claude-haiku-4-5-20251001')
  const [apiKey, setApiKey]         = useState('')
  const [hasKey, setHasKey]         = useState(false)
  const [showKey, setShowKey]       = useState(false)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [error, setError]           = useState(null)

  useEffect(() => {
    getLLMSettings()
      .then(data => {
        setProviders(data.providers || {})
        setProvider(data.provider  || 'anthropic')
        setModel(data.model        || 'claude-haiku-4-5-20251001')
        setHasKey(data.hasApiKey   || false)
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  const models = providers[provider]?.models ?? []

  const handleProviderChange = (p) => {
    setProvider(p)
    // Auto-select first model for new provider
    const first = providers[p]?.models?.[0]?.id
    if (first) setModel(first)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveLLMSettings({ provider, model, apiKey })
      setHasKey(hasKey || !!apiKey)
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError('Failed to save — check your API key format.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <div>
        <h3 className="text-primary font-semibold text-sm mb-1">AI Provider</h3>
        <p className="text-muted text-xs leading-relaxed mb-3">
          Choose which AI service powers your trading agent. You need a personal API key from your chosen provider.
        </p>

        {/* Provider selector */}
        <div className="space-y-2">
          {Object.entries(providers).map(([key, info]) => (
            <button
              key={key}
              onClick={() => handleProviderChange(key)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                provider === key
                  ? 'border-accent-blue/50 bg-accent-blue/8 text-primary'
                  : 'border-border bg-surface-hover text-muted hover:text-primary'
              }`}
            >
              <span className="font-medium">{info.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Model selector */}
      <div>
        <h3 className="text-primary font-semibold text-sm mb-2">Model</h3>
        <div className="relative">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full appearance-none bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent-blue/50 transition-colors pr-8"
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </div>
      </div>

      {/* API Key */}
      <div>
        <h3 className="text-primary font-semibold text-sm mb-1">API Key</h3>
        <p className="text-muted text-xs mb-2">
          {hasKey ? 'A key is saved. Enter a new one to replace it.' : 'Enter your API key from the provider\'s dashboard.'}
        </p>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={hasKey ? '••••••••  (keep existing)' : 'sk-... or your API key'}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors pr-8"
          />
          <button type="button" onClick={() => setShowKey(v => !v)} tabIndex={-1}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <p className="text-muted text-xs mt-1.5 leading-relaxed">
          Keys are encrypted before being stored. They are only used to call your chosen provider on your behalf.
        </p>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          {saved ? <><CheckCircle2 size={14} /> Saved</> : saving ? 'Saving…' : 'Save Settings'}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-2 rounded-lg text-sm text-muted hover:text-primary hover:bg-surface-hover transition-colors border border-border"
        >
          Cancel
        </button>
      </div>

      <div className="bg-surface rounded-lg border border-border p-3 space-y-1.5">
        <p className="text-muted text-xs font-medium">Where to get API keys</p>
        {[
          { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
          { label: 'OpenAI',    url: 'https://platform.openai.com/api-keys'         },
          { label: 'Google',    url: 'https://aistudio.google.com/apikey'            },
        ].map(({ label, url }) => (
          <a key={label} href={url} target="_blank" rel="noreferrer"
            className="block text-accent-blue text-xs hover:underline">
            {label} →
          </a>
        ))}
      </div>
    </div>
  )
}

// ── MCP Settings panel ───────────────────────────────────────────
const MCP_API = (path, opts = {}) => {
  const token = localStorage.getItem('tradebuddy_token')
  return fetch(`/api/mcp-servers${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Request failed'); return d })
}

function MCPSettings() {
  const [servers,  setServers]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [name,     setName]     = useState('')
  const [url,      setUrl]      = useState('')
  const [authHdr,  setAuthHdr]  = useState('')
  const [adding,   setAdding]   = useState(false)
  const [testing,  setTesting]  = useState(null)  // server id being tested
  const [testRes,  setTestRes]  = useState({})    // { [id]: { ok, toolCount, error } }
  const [error,    setError]    = useState(null)

  const load = () => {
    setLoading(true)
    MCP_API('').then(setServers).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleAdd = async (e) => {
    e.preventDefault(); setError(null); setAdding(true)
    try {
      await MCP_API('', { method: 'POST', body: JSON.stringify({ name, url, authHeader: authHdr }) })
      setName(''); setUrl(''); setAuthHdr(''); load()
    } catch (err) { setError(err.message) }
    finally { setAdding(false) }
  }

  const handleDelete = async (id) => {
    await MCP_API(`/${id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  const handleToggle = async (server) => {
    await MCP_API(`/${server.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !server.enabled }) }).catch(() => {})
    load()
  }

  const handleTest = async (id) => {
    setTesting(id); setTestRes(prev => ({ ...prev, [id]: null }))
    const res = await MCP_API(`/${id}/test`).catch(err => ({ ok: false, error: err.message }))
    setTestRes(prev => ({ ...prev, [id]: res }))
    setTesting(null)
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <div>
        <h3 className="text-primary font-semibold text-sm mb-1">MCP Servers</h3>
        <p className="text-muted text-xs leading-relaxed">
          Connect external MCP servers to give the Trading Agent new tools — web search, custom data sources, and more.
          The agent will automatically discover and use their tools.
        </p>
      </div>

      {/* Server list */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
        </div>
      ) : servers.length === 0 ? (
        <p className="text-faint text-xs text-center py-4">No MCP servers added yet.</p>
      ) : (
        <div className="space-y-2">
          {servers.map(s => (
            <div key={s.id} className="bg-surface-hover border border-border rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-primary text-xs font-medium truncate">{s.name}</p>
                  <p className="text-faint text-xs truncate">{s.url}</p>
                  {s.auth_header && <p className="text-faint text-xs">Auth: {s.auth_header}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleToggle(s)} title={s.enabled ? 'Disable' : 'Enable'}
                    className={`p-1 rounded transition-colors ${s.enabled ? 'text-accent-blue' : 'text-muted'}`}>
                    {s.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                  </button>
                  <button onClick={() => handleTest(s.id)} title="Test connection"
                    className="p-1 rounded text-muted hover:text-primary transition-colors">
                    {testing === s.id
                      ? <RefreshCw size={13} className="animate-spin" />
                      : <Plug size={13} />}
                  </button>
                  <button onClick={() => handleDelete(s.id)} title="Remove"
                    className="p-1 rounded text-muted hover:text-loss transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {testRes[s.id] && (
                <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ${testRes[s.id].ok ? 'text-gain bg-gain/10' : 'text-loss bg-loss/10'}`}>
                  {testRes[s.id].ok
                    ? <><CheckCircle2 size={11} /> {testRes[s.id].toolCount} tool{testRes[s.id].toolCount !== 1 ? 's' : ''} available</>
                    : <><AlertCircle  size={11} /> {testRes[s.id].error}</>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleAdd} className="space-y-3 border-t border-border pt-4">
        <h4 className="text-primary text-xs font-semibold">Add Server</h4>
        <input value={name} onChange={e => setName(e.target.value)} required placeholder="Server name"
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors" />
        <input value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://your-mcp-server.com/mcp"
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors" />
        <input value={authHdr} onChange={e => setAuthHdr(e.target.value)} placeholder="Authorization: Bearer ... (optional)"
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors" />
        {error && <p className="text-loss text-xs">{error}</p>}
        <button type="submit" disabled={adding || !name.trim() || !url.trim()}
          className="w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5">
          {adding ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
          {adding ? 'Adding…' : 'Add Server'}
        </button>
      </form>

      <div className="bg-surface rounded-lg border border-border p-3 space-y-1">
        <p className="text-muted text-xs font-medium">Example MCP servers</p>
        {[
          { label: 'Tavily Search',  url: 'https://mcp.tavily.com/mcp' },
          { label: 'Brave Search',   url: 'https://api.search.brave.com/mcp' },
        ].map(({ label, url: u }) => (
          <button key={label} type="button"
            onClick={() => { setName(label); setUrl(u) }}
            className="block text-accent-blue text-xs hover:underline text-left w-full">
            {label} →
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────
export default function AgentPanel({ open, onClose }) {
  const { state, dispatch }     = useApp()
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab,  setSettingsTab]  = useState('llm')  // 'llm' | 'mcp'

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Reset settings view when panel closes
  useEffect(() => {
    if (!open) setShowSettings(false)
  }, [open])

  const handleTradeExecuted = useCallback(async () => {
    try {
      const fresh = await fetchPortfolio()
      dispatch({ type: ACTIONS.LOAD_DATA, payload: { portfolio: fresh, watchlist: state.watchlist } })
    } catch { /* swallow */ }
  }, [dispatch, state.watchlist])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`
          fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300
          ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        `}
      />

      {/* Drawer */}
      <aside
        className={`
          fixed top-0 right-0 h-screen w-1/2 z-50
          bg-surface-card border-l border-border
          flex flex-col shadow-2xl
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent-blue" />
            <span className="text-primary font-semibold text-sm">Trading Agent</span>
            {!showSettings && (
              <span className="text-muted text-xs">· AI-powered</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(v => !v)}
              className={`p-1.5 rounded-lg transition-colors ${
                showSettings
                  ? 'text-accent-blue bg-accent-blue/10'
                  : 'text-muted hover:text-primary hover:bg-surface-hover'
              }`}
              title="AI provider settings"
            >
              <Settings size={15} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
              title="Close panel (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        {showSettings ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-border px-4 pt-3 pb-0 gap-1 shrink-0">
              {[
                { id: 'llm', label: 'AI Provider', Icon: Settings },
                { id: 'mcp', label: 'MCP Servers', Icon: Plug     },
              ].map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setSettingsTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                    settingsTab === id
                      ? 'border-accent-blue text-accent-blue'
                      : 'border-transparent text-muted hover:text-primary'
                  }`}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
            {settingsTab === 'llm'
              ? <LLMSettings onClose={() => setShowSettings(false)} />
              : <MCPSettings />}
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <TradingAgent
              portfolio={state.portfolio}
              onTradeExecuted={handleTradeExecuted}
              embedded
            />
          </div>
        )}
      </aside>
    </>
  )
}
