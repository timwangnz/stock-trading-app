/**
 * Watchlist.jsx — now uses live prices via useLivePrices hook.
 */

import { useState } from 'react'
import { Star, StarOff, PlusCircle, RefreshCw } from 'lucide-react'
import { useApp, ACTIONS } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { STOCKS } from '../data/mockData'
import { useLivePrices } from '../hooks/useLivePrices'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'
import StockSearch from '../components/StockSearch'
import clsx from 'clsx'

export default function Watchlist() {
  const { state, dispatch } = useApp()
  const { canTrade } = useAuth()
  const [showPicker, setShowPicker] = useState(false)
  const [searchKey,  setSearchKey]  = useState(0)

  // Fetch live prices for watchlisted symbols
  const { prices, loading, error, refetch } = useLivePrices(state.watchlist)

  const handleAdd = (symbol) => {
    if (!symbol) return
    dispatch({ type: ACTIONS.ADD_TO_WATCHLIST, payload: symbol })
    // Reset the search box
    setSearchKey(k => k + 1)
  }

  const handleClosePicker = () => {
    setShowPicker(false)
    setSearchKey(k => k + 1)
  }

  // Enrich watchlist with live prices + static metadata
  const watchlistStocks = state.watchlist
    .map(symbol => {
      const live = prices.get(symbol)
      const meta = STOCKS.find(s => s.symbol === symbol) ?? { symbol, name: symbol }
      return live ? { ...meta, ...live } : null
    })
    .filter(Boolean)

  if (loading) return <LoadingSpinner message="Fetching live watchlist prices…" />
  if (error)   return <ErrorMessage error={error} />

  return (
    <div className="p-6 space-y-4">

      {/* ── Header row ───────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Star size={16} className="text-yellow-400 fill-yellow-400" />
            <p className="text-muted text-sm">{watchlistStocks.length} stocks</p>
          </div>
          <button onClick={refetch} className="text-faint hover:text-muted transition-colors flex items-center gap-1 text-xs" title="Refresh">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>

        {canTrade && (
          <button
            onClick={() => setShowPicker(v => !v)}
            className="flex items-center gap-1.5 text-accent-blue hover:text-accent-blue/80 text-xs font-medium transition-colors"
          >
            <PlusCircle size={14} /> Add Stock
          </button>
        )}
      </div>

      {/* ── Add stock search ─────────────────────────── */}
      {showPicker && (
        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <StockSearch
                key={searchKey}
                value=""
                onChange={handleAdd}
                exclude={state.watchlist}
                placeholder="Search any stock or ETF to add…"
                autoFocus
              />
            </div>
            <button
              onClick={handleClosePicker}
              className="text-muted hover:text-primary text-sm transition-colors shrink-0"
            >✕</button>
          </div>
        </div>
      )}

      {/* ── Watchlist table ──────────────────────────── */}
      {state.watchlist.length === 0 ? (
        <div className="bg-surface-card border border-border rounded-xl px-5 py-16 text-center">
          <StarOff size={32} className="text-faint mx-auto mb-3" />
          <p className="text-muted text-sm">Your watchlist is empty.</p>
          <p className="text-faint text-xs mt-1">Click "Add Stock" to start tracking stocks.</p>
        </div>
      ) : (
        <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 border-b border-border text-muted text-xs font-medium">
            <span>Stock</span>
            <span className="text-right w-20">Price (Live)</span>
            <span className="text-right w-24">Day Change</span>
            <span className="text-right w-36">52-Week Range</span>
            <span className="w-8"></span>
          </div>

          {watchlistStocks.map((s, idx) => {
            // Compute 52w high/low from what we have (fallback to price ± 10% if no history)
            const high52w = s.high52w ?? s.price * 1.1
            const low52w  = s.low52w  ?? s.price * 0.9

            return (
              <div
                key={s.symbol}
                className={clsx(
                  'grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 items-center',
                  'hover:bg-surface-hover transition-colors',
                  idx > 0 && 'border-t border-border'
                )}
              >
                <button onClick={() => dispatch({ type: ACTIONS.VIEW_STOCK, payload: s.symbol })} className="text-left">
                  <p className="text-primary font-mono font-semibold">{s.symbol}</p>
                  <p className="text-muted text-xs">{s.name}</p>
                </button>

                <div className="text-right w-20">
                  <p className="text-primary font-medium">${s.price.toFixed(2)}</p>
                </div>

                <div className="text-right w-24">
                  <p className={clsx('font-medium text-sm', s.change >= 0 ? 'text-gain' : 'text-loss')}>
                    {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}
                  </p>
                  <p className={clsx('text-xs', s.changePct >= 0 ? 'text-gain' : 'text-loss')}>
                    {s.changePct >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%
                  </p>
                </div>

                <div className="w-36">
                  <div className="flex justify-between text-muted text-xs mb-1">
                    <span>${low52w.toFixed(0)}</span>
                    <span>${high52w.toFixed(0)}</span>
                  </div>
                  <div className="relative h-1.5 bg-surface-hover rounded-full">
                    <div
                      className="absolute top-0 w-2 h-2 -mt-0.5 rounded-full bg-accent-blue"
                      style={{
                        left: `${Math.min(100, Math.max(0, ((s.price - low52w) / (high52w - low52w)) * 100))}%`,
                        transform: 'translateX(-50%)',
                      }}
                    />
                  </div>
                </div>

                <div className="w-8 flex justify-center">
                  {canTrade && (
                    <button
                      onClick={() => dispatch({ type: ACTIONS.REMOVE_FROM_WATCHLIST, payload: s.symbol })}
                      title="Remove from watchlist"
                      className="text-yellow-400/30 hover:text-yellow-400 transition-colors"
                    >
                      <Star size={15} className="fill-current" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-faint text-xs text-center">
        💡 Click any stock name to see its full price chart
      </p>
    </div>
  )
}
