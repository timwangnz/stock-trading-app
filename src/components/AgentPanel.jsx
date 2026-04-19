/**
 * AgentPanel.jsx
 * Fixed right-side drawer containing the Trading Agent.
 * Includes a settings panel for users to configure their LLM provider,
 * model, and personal API key.
 */

import { useEffect, useCallback, useState } from 'react'
import { X, Sparkles, Settings, Eye, EyeOff, CheckCircle2, ChevronDown } from 'lucide-react'
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

// ── Main panel ───────────────────────────────────────────────────
export default function AgentPanel({ open, onClose }) {
  const { state, dispatch }     = useApp()
  const [showSettings, setShowSettings] = useState(false)

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
          <LLMSettings onClose={() => setShowSettings(false)} />
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
