/**
 * ManageStocksModal.jsx
 * Let users customise which stocks appear on the dashboard.
 *
 * - Portfolio & watchlist symbols are shown as read-only (with their source badge)
 * - Custom symbols can be added via a live Polygon ticker search
 * - Custom symbols can be removed with the × button
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Search, Plus, Briefcase, Star, SlidersHorizontal, Loader } from 'lucide-react'
import { searchTickers } from '../services/polygonApi'
import clsx from 'clsx'

// ── Source badge ─────────────────────────────────────────────────
function SourceBadge({ source }) {
  const cfg = {
    portfolio: { label: 'Portfolio', color: 'text-accent-purple bg-accent-purple/10 border-accent-purple/20', Icon: Briefcase },
    watchlist: { label: 'Watchlist', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',          Icon: Star      },
    custom:    { label: 'Custom',    color: 'text-accent-blue bg-accent-blue/10 border-accent-blue/20',        Icon: SlidersHorizontal },
  }[source] ?? { label: source, color: 'text-muted bg-surface-hover border-border', Icon: null }

  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium', cfg.color)}>
      {cfg.Icon && <cfg.Icon size={9} />}
      {cfg.label}
    </span>
  )
}

// ── Main modal ───────────────────────────────────────────────────
export default function ManageStocksModal({ symbols, onAddCustom, onRemoveCustom, onClose }) {
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState([])
  const [searching,  setSearching]  = useState(false)
  const [added,      setAdded]      = useState(null)   // last-added symbol for flash feedback
  const inputRef  = useRef(null)
  const debounceRef = useRef(null)

  // Focus search on open
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80) }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Debounced Polygon search
  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const data = await searchTickers(q, 6)
      setResults(data)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleQueryChange = (e) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(q), 300)
  }

  const handleAdd = (symbol) => {
    onAddCustom(symbol)
    setAdded(symbol)
    setQuery('')
    setResults([])
    setTimeout(() => setAdded(null), 1500)
  }

  const existingSymbols = new Set(symbols.map(s => s.symbol))

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-surface-card border border-border rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-accent-blue" />
              <h2 className="text-primary font-semibold text-sm">Manage Dashboard Stocks</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-5 space-y-5">

            {/* Search to add */}
            <div>
              <label className="text-muted text-xs font-medium mb-2 block">Add a stock</label>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={handleQueryChange}
                  placeholder="Search ticker or company name…"
                  className="w-full bg-surface-hover border border-border rounded-xl pl-8 pr-4 py-2.5 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/40 transition-colors"
                />
                {searching && (
                  <Loader size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted animate-spin" />
                )}
              </div>

              {/* Search results dropdown */}
              {results.length > 0 && (
                <div className="mt-1.5 bg-surface-card border border-border rounded-xl overflow-hidden shadow-lg">
                  {results.map(r => {
                    const alreadyAdded = existingSymbols.has(r.symbol)
                    return (
                      <button
                        key={r.symbol}
                        disabled={alreadyAdded}
                        onClick={() => handleAdd(r.symbol)}
                        className={clsx(
                          'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors border-b border-border/50 last:border-0',
                          alreadyAdded
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-surface-hover'
                        )}
                      >
                        <div>
                          <span className="text-primary text-sm font-semibold font-mono">{r.symbol}</span>
                          <span className="text-muted text-xs ml-2">{r.name}</span>
                        </div>
                        {alreadyAdded
                          ? <span className="text-faint text-xs">Added</span>
                          : <Plus size={14} className="text-accent-blue shrink-0" />
                        }
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Flash feedback */}
              {added && (
                <p className="text-gain text-xs mt-1.5 flex items-center gap-1">
                  <Plus size={11} /> {added} added to dashboard
                </p>
              )}
            </div>

            {/* Current stock list */}
            <div>
              <label className="text-muted text-xs font-medium mb-2 block">
                Currently showing ({symbols.length})
              </label>

              {symbols.length === 0 ? (
                <p className="text-faint text-sm text-center py-6">
                  No stocks yet — add some above, or add stocks to your portfolio / watchlist.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {symbols.map(({ symbol, source }) => (
                    <div
                      key={symbol}
                      className="flex items-center justify-between bg-surface-hover rounded-xl px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-primary font-mono font-semibold text-sm w-14 shrink-0">
                          {symbol}
                        </span>
                        <SourceBadge source={source} />
                      </div>

                      {source === 'custom' ? (
                        <button
                          onClick={() => onRemoveCustom(symbol)}
                          title="Remove from dashboard"
                          className="p-1 rounded-md text-muted hover:text-loss hover:bg-loss/10 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      ) : (
                        <span className="text-faint text-xs">
                          {source === 'portfolio' ? 'Remove from portfolio to hide' : 'Remove from watchlist to hide'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 pt-1 border-t border-border flex-wrap">
              <SourceBadge source="portfolio" />
              <SourceBadge source="watchlist" />
              <SourceBadge source="custom" />
              <span className="text-faint text-xs ml-auto">Custom symbols saved locally</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
