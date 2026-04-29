/**
 * Settings.jsx — My Keys & Integrations
 *
 * A single place for all user-owned credentials:
 *   • AI Provider   — LLM provider + API key (powers agent, prompts, AI portfolio)
 *   • MCP Servers   — external tool servers for the Trading Agent
 *   • Market Data   — Polygon API key (server-managed now, per-user in future)
 *   • Email         — Resend API key (server-managed now, per-user in future)
 *   • App Settings  — admin-only: Polygon, Google OAuth, Resend, alert email
 */

import { useState, useEffect } from 'react'
import {
  KeyRound, Sparkles, Plug, BarChart2, Mail,
  Eye, EyeOff, CheckCircle2, AlertCircle, ChevronDown,
  Plus, Trash2, RefreshCw, ToggleLeft, ToggleRight, ExternalLink,
  Lock, Loader2, Server, Settings2, Save,
} from 'lucide-react'
import { getLLMSettings, saveLLMSettings } from '../../common/services/apiService'
import { useKeys } from '../../common/context/KeysContext'
import { useAuth } from '../../common/context/AuthContext'
import clsx from 'clsx'

// ── Shared helpers ────────────────────────────────────────────────

function StatusBadge({ configured }) {
  return configured
    ? <span className="flex items-center gap-1 text-xs text-gain"><CheckCircle2 size={11} /> Configured</span>
    : <span className="flex items-center gap-1 text-xs text-yellow-400"><AlertCircle size={11} /> Not set</span>
}

function Card({ icon: Icon, iconColor = 'text-accent-blue', title, status, children }) {
  return (
    <div className="bg-surface-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Icon size={17} className={iconColor} />
          <h2 className="text-primary font-semibold text-sm">{title}</h2>
        </div>
        {status}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function ServerManagedNote({ label }) {
  return (
    <div className="flex items-start gap-2 bg-surface-hover border border-border rounded-lg px-3 py-2.5">
      <Lock size={13} className="text-muted flex-shrink-0 mt-0.5" />
      <p className="text-xs text-muted leading-relaxed">
        <strong className="text-primary">{label}</strong> is currently managed by the server admin.
        Per-user keys will be supported in a future update — your key will be used in place of the shared one.
      </p>
    </div>
  )
}

// ── LLM Provider card ─────────────────────────────────────────────

const LLM_KEY_LINKS = [
  { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
  { label: 'OpenAI',    url: 'https://platform.openai.com/api-keys' },
  { label: 'Google',    url: 'https://aistudio.google.com/apikey' },
  { label: 'Ollama',    url: 'https://ollama.com', note: 'runs locally — no key needed' },
]

function LLMCard() {
  const { refresh } = useKeys()

  const [providers,       setProviders]       = useState({})
  const [provider,        setProvider]        = useState('anthropic')
  const [model,           setModel]           = useState('claude-haiku-4-5-20251001')
  const [apiKey,          setApiKey]          = useState('')
  const [hasKey,          setHasKey]          = useState(false)
  const [showKey,         setShowKey]         = useState(false)
  const [loading,         setLoading]         = useState(true)
  const [saving,          setSaving]          = useState(false)
  const [saved,           setSaved]           = useState(false)
  const [error,           setError]           = useState(null)
  const [ollamaAvailable, setOllamaAvailable] = useState(false)

  useEffect(() => {
    getLLMSettings()
      .then(data => {
        setProviders(data.providers || {})
        setProvider(data.provider  || 'anthropic')
        setModel(data.model        || 'claude-haiku-4-5-20251001')
        setHasKey(!!data.hasApiKey)
        setOllamaAvailable(!!data.ollamaAvailable)
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  const models = providers[provider]?.models ?? []

  const handleProviderChange = (p) => {
    setProvider(p)
    const first = providers[p]?.models?.[0]?.id
    if (first) setModel(first)
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      await saveLLMSettings({ provider, model, apiKey })
      const nowHasKey = hasKey || !!apiKey
      setHasKey(nowHasKey)
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      refresh() // update the sidebar badge
    } catch {
      setError('Failed to save — check your API key format.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <Card icon={Sparkles} title="AI Provider" status={<Loader2 size={13} className="animate-spin text-muted" />}>
      <div className="py-4 flex justify-center"><Loader2 size={18} className="animate-spin text-muted" /></div>
    </Card>
  )

  return (
    <Card
      icon={Sparkles}
      iconColor="text-accent-blue"
      title="AI Provider"
      status={<StatusBadge configured={hasKey} />}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          Powers the Trading Agent, Prompt Manager, and AI Portfolio. You need a personal API key from your chosen provider.
        </p>

        {/* Provider selector */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">Provider</label>
          <div className="space-y-1.5">
            {Object.entries(providers).map(([key, info]) => {
              const isOllama    = key === 'ollama'
              const unavailable = isOllama && !ollamaAvailable
              return (
                <button
                  key={key}
                  onClick={() => !unavailable && handleProviderChange(key)}
                  disabled={unavailable}
                  className={clsx(
                    'w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors flex items-center justify-between',
                    unavailable
                      ? 'border-border bg-surface-hover text-muted/40 cursor-not-allowed'
                      : provider === key
                      ? 'border-accent-blue/50 bg-accent-blue/8 text-primary'
                      : 'border-border bg-surface-hover text-muted hover:text-primary hover:border-accent-blue/30'
                  )}
                >
                  <span className="font-medium">{info.label}</span>
                  {isOllama && (
                    <span className={clsx(
                      'text-xs flex items-center gap-1',
                      ollamaAvailable ? 'text-gain' : 'text-muted/50'
                    )}>
                      <span className={clsx(
                        'w-1.5 h-1.5 rounded-full inline-block',
                        ollamaAvailable ? 'bg-gain' : 'bg-muted/30'
                      )} />
                      {ollamaAvailable ? 'running' : 'not detected'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Model selector */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">Model</label>
          <div className="relative">
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full appearance-none bg-surface-hover border border-border rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent-blue/50 transition-colors pr-8"
            >
              {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={hasKey ? '••••••••  (keep existing)' : 'Paste your API key'}
              className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted/50 outline-none focus:border-accent-blue/50 transition-colors pr-9"
            />
            <button type="button" onClick={() => setShowKey(v => !v)} tabIndex={-1}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors">
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <p className="text-xs text-muted mt-1.5">Keys are encrypted before storage and only used to call your chosen provider.</p>
        </div>

        {error && <p className="text-loss text-xs">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving || (!apiKey && hasKey && true)}
          className="w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {saved
            ? <><CheckCircle2 size={14} /> Saved</>
            : saving
            ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
            : 'Save'}
        </button>

        {/* Key links */}
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted font-medium mb-2">Get an API key</p>
          <div className="space-y-1">
            {LLM_KEY_LINKS.map(({ label, url, note }) => (
              <a key={label} href={url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs text-accent-blue hover:underline">
                {label} {note && <span className="text-muted">— {note}</span>}
                <ExternalLink size={10} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── MCP Servers card ──────────────────────────────────────────────

const MCP_API = (path, opts = {}) => {
  const token = localStorage.getItem('tradebuddy_token')
  return fetch(`/api/mcp-servers${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Request failed'); return d })
}

function MCPCard() {
  const [servers,  setServers]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [name,     setName]     = useState('')
  const [url,      setUrl]      = useState('')
  const [authHdr,  setAuthHdr]  = useState('')
  const [adding,   setAdding]   = useState(false)
  const [testing,  setTesting]  = useState(null)
  const [testRes,  setTestRes]  = useState({})
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
    <Card
      icon={Plug}
      iconColor="text-purple-400"
      title="MCP Servers"
      status={<span className="text-xs text-muted">{servers.length} connected</span>}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          Connect external MCP servers to give the Trading Agent new tools — web search, custom data sources, and more.
        </p>

        {/* Server list */}
        {loading ? (
          <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-muted" /></div>
        ) : servers.length === 0 ? (
          <p className="text-xs text-muted text-center py-3">No MCP servers added yet.</p>
        ) : (
          <div className="space-y-2">
            {servers.map(s => (
              <div key={s.id} className="bg-surface-hover border border-border rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-primary text-xs font-medium truncate">{s.name}</p>
                    <p className="text-muted text-xs truncate">{s.url}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleToggle(s)} title={s.enabled ? 'Disable' : 'Enable'}
                      className={clsx('p-1 rounded transition-colors', s.enabled ? 'text-accent-blue' : 'text-muted')}>
                      {s.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => handleTest(s.id)} title="Test"
                      className="p-1 rounded text-muted hover:text-primary transition-colors">
                      {testing === s.id ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
                    </button>
                    <button onClick={() => handleDelete(s.id)} title="Remove"
                      className="p-1 rounded text-muted hover:text-loss transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {testRes[s.id] && (
                  <div className={clsx('text-xs px-2 py-1.5 rounded-lg flex items-center gap-1',
                    testRes[s.id].ok ? 'text-gain bg-gain/10' : 'text-loss bg-loss/10')}>
                    {testRes[s.id].ok
                      ? <><CheckCircle2 size={11} /> {testRes[s.id].toolCount} tool{testRes[s.id].toolCount !== 1 ? 's' : ''} available</>
                      : <><AlertCircle size={11} /> {testRes[s.id].error}</>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <form onSubmit={handleAdd} className="space-y-2 border-t border-border pt-4">
          <p className="text-xs font-medium text-primary">Add Server</p>
          <input value={name} onChange={e => setName(e.target.value)} required placeholder="Server name"
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted/50 outline-none focus:border-accent-blue/50 transition-colors" />
          <input value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://your-mcp-server.com/mcp"
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted/50 outline-none focus:border-accent-blue/50 transition-colors" />
          <input value={authHdr} onChange={e => setAuthHdr(e.target.value)} placeholder="Authorization: Bearer … (optional)"
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted/50 outline-none focus:border-accent-blue/50 transition-colors" />
          {error && <p className="text-loss text-xs">{error}</p>}
          <button type="submit" disabled={adding || !name.trim() || !url.trim()}
            className="w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5">
            {adding ? <><Loader2 size={13} className="animate-spin" /> Adding…</> : <><Plus size={13} /> Add Server</>}
          </button>
        </form>

        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted font-medium mb-1.5">Example servers</p>
          {[
            { label: 'Tavily Search', url: 'https://mcp.tavily.com/mcp' },
            { label: 'Brave Search',  url: 'https://api.search.brave.com/mcp' },
          ].map(({ label, url: u }) => (
            <button key={label} type="button" onClick={() => { setName(label); setUrl(u) }}
              className="block text-xs text-accent-blue hover:underline text-left">
              {label} →
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ── Market Data card ──────────────────────────────────────────────

function MarketDataCard() {
  return (
    <Card icon={BarChart2} iconColor="text-gain" title="Market Data (Polygon.io)" status={<StatusBadge configured={true} />}>
      <div className="space-y-3">
        <p className="text-xs text-muted leading-relaxed">
          Powers live stock quotes, charts, and news. Used by the Trading Agent to answer price questions in real time.
        </p>
        <ServerManagedNote label="Polygon API key" />
        <a href="https://polygon.io" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline">
          polygon.io <ExternalLink size={10} />
        </a>
      </div>
    </Card>
  )
}

// ── Email card ────────────────────────────────────────────────────

function EmailCard() {
  return (
    <Card icon={Mail} iconColor="text-orange-400" title="Email (Resend)" status={<StatusBadge configured={true} />}>
      <div className="space-y-3">
        <p className="text-xs text-muted leading-relaxed">
          Used to deliver Prompt Manager results, password resets, class invites, and marketing campaigns.
        </p>
        <ServerManagedNote label="Resend API key" />
        <a href="https://resend.com" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline">
          resend.com <ExternalLink size={10} />
        </a>
      </div>
    </Card>
  )
}

// ── App Settings card (admin only) ────────────────────────────────

const APP_SETTING_DEFS = [
  {
    group: 'Market Data',
    icon: BarChart2,
    iconColor: 'text-gain',
    items: [
      { key: 'polygon_api_key', label: 'Polygon API Key', secret: true,
        hint: 'Required for live prices, charts, and news.', link: 'https://polygon.io/dashboard/api-keys' },
    ],
  },
  {
    group: 'Google OAuth',
    icon: KeyRound,
    iconColor: 'text-yellow-400',
    items: [
      { key: 'google_client_id',     label: 'Google Client ID',     secret: true,
        hint: 'Enables "Sign in with Google". Restart frontend after saving.', link: 'https://console.cloud.google.com/apis/credentials' },
      { key: 'google_client_secret', label: 'Google Client Secret', secret: true,
        hint: 'Required for the server-side OAuth code exchange.' },
    ],
  },
  {
    group: 'Email (Resend)',
    icon: Mail,
    iconColor: 'text-orange-400',
    items: [
      { key: 'resend_api_key', label: 'Resend API Key', secret: true,
        hint: 'Used for password resets, class invites, and prompt emails.', link: 'https://resend.com/api-keys' },
      { key: 'email_from',     label: 'From Address',   secret: false,
        hint: 'e.g. TradeBuddy <noreply@yourdomain.com>  (defaults to Resend sandbox)' },
    ],
  },
  {
    group: 'Alerts',
    icon: AlertCircle,
    iconColor: 'text-red-400',
    items: [
      { key: 'snapshot_alert_email', label: 'Snapshot Alert Email', secret: false,
        hint: 'Where to send daily snapshot failure notifications.' },
    ],
  },
]

function AppSettingField({ def, currentValue, onSave }) {
  const [val, setVal]       = useState('')
  const [show, setShow]     = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [err, setErr]       = useState(null)

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      const token = localStorage.getItem('tradebuddy_token')
      const res = await fetch(`/api/admin/app-settings/${def.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value: val }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setSaved(true); setVal(''); setTimeout(() => setSaved(false), 2000)
      onSave?.()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-primary">{def.label}</label>
        <div className="flex items-center gap-2">
          {currentValue?.configured && (
            <span className="flex items-center gap-1 text-xs text-gain">
              <CheckCircle2 size={10} /> Configured
            </span>
          )}
          {def.link && (
            <a href={def.link} target="_blank" rel="noreferrer"
               className="text-xs text-accent-blue hover:underline flex items-center gap-0.5">
              Get key <ExternalLink size={9} />
            </a>
          )}
        </div>
      </div>
      {def.hint && <p className="text-xs text-muted">{def.hint}</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={def.secret && !show ? 'password' : 'text'}
            value={val}
            onChange={e => setVal(e.target.value)}
            placeholder={currentValue?.configured ? '••••••••  (leave blank to keep current)' : 'Enter value…'}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-primary
                       placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue pr-8"
          />
          {def.secret && (
            <button onClick={() => setShow(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
              {show ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
        </div>
        <button onClick={handleSave} disabled={saving || !val}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue text-white text-xs
                           font-medium disabled:opacity-40 hover:bg-accent-blue/90 transition-colors">
          {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  )
}

function AppSettingsCard() {
  const [settings, setSettings] = useState({})
  const [loading, setLoading]   = useState(true)

  const load = async () => {
    try {
      const token = localStorage.getItem('tradebuddy_token')
      const res = await fetch('/api/admin/app-settings', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setSettings(await res.json())
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div className="flex justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted" />
    </div>
  )

  return (
    <div className="space-y-4">
      {APP_SETTING_DEFS.map(group => (
        <Card key={group.group} icon={group.icon} iconColor={group.iconColor} title={group.group}>
          <div className="space-y-5">
            {group.items.map(def => (
              <AppSettingField key={def.key} def={def} currentValue={settings[def.key]} onSave={load} />
            ))}
          </div>
        </Card>
      ))}
      <p className="text-xs text-muted text-center pt-2">
        Changes take effect immediately — no server restart needed.
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuth()
  const isAdmin  = user?.role === 'admin'

  const TABS = [
    { id: 'llm',    label: 'AI Provider',  icon: Sparkles,  color: 'text-accent-blue' },
    { id: 'mcp',    label: 'MCP Servers',  icon: Plug,      color: 'text-purple-400'  },
    { id: 'market', label: 'Market Data',  icon: BarChart2, color: 'text-gain'        },
    { id: 'email',  label: 'Email',        icon: Mail,      color: 'text-orange-400'  },
    ...(isAdmin ? [{ id: 'app', label: 'App Settings', icon: Settings2, color: 'text-red-400' }] : []),
  ]

  const [activeTab, setActiveTab] = useState('llm')
  const active = TABS.find(t => t.id === activeTab)

  return (
    <div className="flex flex-col h-full">

      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-accent-blue/10">
            <KeyRound size={18} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-primary">My Keys</h1>
            <p className="text-xs text-muted mt-0.5">API keys and integrations for your account</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-surface rounded-xl p-1 border border-border">
          {TABS.map(({ id, label, icon: Icon }) => (
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
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto">
          {activeTab === 'llm'    && <LLMCard />}
          {activeTab === 'mcp'    && <MCPCard />}
          {activeTab === 'market' && <MarketDataCard />}
          {activeTab === 'email'  && <EmailCard />}
          {activeTab === 'app'    && <AppSettingsCard />}
        </div>
      </div>

    </div>
  )
}
