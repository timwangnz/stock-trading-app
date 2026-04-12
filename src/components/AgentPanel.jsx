/**
 * AgentPanel.jsx
 * Fixed right-side drawer containing the Trading Agent.
 *
 * Slides in from the right with a smooth CSS transition.
 * A semi-transparent backdrop covers the main content; clicking it closes the panel.
 * Rendered at the App level so it's accessible from any page.
 */

import { useEffect, useCallback } from 'react'
import { X, Sparkles } from 'lucide-react'
import { useApp, ACTIONS } from '../context/AppContext'
import { fetchPortfolio }  from '../services/apiService'
import TradingAgent from './TradingAgent'

export default function AgentPanel({ open, onClose }) {
  const { state, dispatch } = useApp()

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // After the agent executes a trade, reload portfolio into AppContext
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
          fixed top-0 right-0 h-screen w-[420px] z-50
          bg-surface-card border-l border-slate-200
          flex flex-col shadow-2xl
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent-blue" />
            <span className="text-slate-900 font-semibold text-sm">Trading Agent</span>
            <span className="text-slate-400 text-xs">· powered by Claude</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-surface-hover transition-colors"
            title="Close panel (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Agent content — fills remaining height */}
        <div className="flex-1 overflow-hidden">
          <TradingAgent
            portfolio={state.portfolio}
            onTradeExecuted={handleTradeExecuted}
            embedded
          />
        </div>
      </aside>
    </>
  )
}
