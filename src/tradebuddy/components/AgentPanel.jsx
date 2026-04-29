/**
 * AgentPanel.jsx
 * Fixed right-side drawer containing the Trading Agent.
 * Includes a settings panel for users to configure their LLM provider,
 * model, and personal API key.
 */

import { useEffect, useCallback, useState } from 'react'
import { X, Sparkles, Settings, KeyRound, ArrowRight } from 'lucide-react'
import { useApp, ACTIONS } from '../context/AppContext'
import { fetchPortfolio }  from '../../common/services/apiService'
import { useKeys } from '../../common/context/KeysContext'
import TradingAgent from './TradingAgent'

// ── Settings shortcut panel ───────────────────────────────────────
function SettingsShortcut({ onNavigate }) {
  const { llmConfigured } = useKeys()
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <KeyRound size={32} className="text-muted/40" />
      <div>
        <p className="text-primary font-medium text-sm">API Keys & Integrations</p>
        <p className="text-muted text-xs mt-1 leading-relaxed">
          Manage your AI provider, MCP servers, and other keys in one place.
        </p>
        {!llmConfigured && (
          <p className="text-yellow-400 text-xs mt-2 flex items-center justify-center gap-1">
            ⚠ No AI provider configured yet
          </p>
        )}
      </div>
      <button
        onClick={onNavigate}
        className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white text-sm rounded-lg hover:bg-accent-blue/90 transition-colors"
      >
        Go to My Keys <ArrowRight size={14} />
      </button>
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────
export default function AgentPanel({ open, onClose }) {
  const { state, dispatch } = useApp()
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
          <SettingsShortcut onNavigate={() => {
            dispatch({ type: ACTIONS.NAVIGATE, payload: 'settings' })
            onClose()
          }} />
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
