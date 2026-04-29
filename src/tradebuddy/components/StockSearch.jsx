/**
 * StockSearch.jsx
 * Shared stock search autocomplete backed by Polygon's /v3/reference/tickers API.
 *
 * Features:
 *  - 300ms debounce so we don't hammer the API on every keystroke
 *  - Keyboard navigation: ↑ ↓ to move, Enter to select, Escape to close
 *  - Human-readable type badges (CS hidden, ETF/ADR/OTC highlighted)
 *  - OTC market warning badge (pink/orange)
 *  - Prevents blur-before-click race via onMouseDown e.preventDefault()
 *  - Accessible: role="listbox" + aria-activedescendant
 *
 * Props:
 *  value       string    controlled symbol value
 *  onChange    fn(sym)   called with selected symbol string
 *  placeholder string    optional input placeholder
 *  autoFocus   bool      optional
 *  onClear     fn()      optional, called when user clears input
 *  exclude     string[]  optional list of symbols to hide from results (e.g. already-watchlisted)
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { searchTickers } from '../services/polygonApi'
import clsx from 'clsx'

// ── Type label helpers ──────────────────────────────────────────────

const TYPE_LABELS = {
  CS:     null,          // Common Stock — most common, no badge needed
  ETF:    { label: 'ETF',   cls: 'bg-cyan-500/15 text-cyan-400' },
  ETV:    { label: 'ETV',   cls: 'bg-cyan-500/15 text-cyan-400' },
  ADRC:   { label: 'ADR',   cls: 'bg-amber-500/15 text-amber-400' },
  ADRW:   { label: 'ADR',   cls: 'bg-amber-500/15 text-amber-400' },
  PFD:    { label: 'PREF',  cls: 'bg-purple-500/15 text-purple-400' },
  FUND:   { label: 'FUND',  cls: 'bg-blue-500/15 text-blue-400' },
  RIGHT:  { label: 'RIGHT', cls: 'bg-gray-500/15 text-gray-400' },
  WARRANT:{ label: 'WARR',  cls: 'bg-gray-500/15 text-gray-400' },
  UNIT:   { label: 'UNIT',  cls: 'bg-gray-500/15 text-gray-400' },
}

function TypeBadge({ type, market }) {
  const isOTC = market === 'otc'
  const info  = type ? TYPE_LABELS[type] ?? { label: type, cls: 'bg-gray-500/15 text-gray-400' } : null

  if (!info && !isOTC) return null

  return (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      {isOTC && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">OTC</span>
      )}
      {info && (
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded', info.cls)}>
          {info.label}
        </span>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────

export default function StockSearch({
  value,
  onChange,
  placeholder = 'Search any stock or ETF…',
  autoFocus = false,
  onClear,
  exclude = [],
}) {
  const [query,     setQuery]     = useState(value || '')
  const [results,   setResults]   = useState([])
  const [open,      setOpen]      = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [confirmed, setConfirmed] = useState(!!value)
  const [cursor,    setCursor]    = useState(-1)   // keyboard highlight index

  const inputRef    = useRef(null)
  const listRef     = useRef(null)
  const debounceRef = useRef(null)

  // ── Debounced search ─────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current)

    if (confirmed || query.trim().length < 1) {
      setResults([])
      setLoading(false)
      setOpen(false)
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await searchTickers(query, 10)
        // Client-side sort as a second safety net — server already sorts,
        // but this covers cached results or any provider differences.
        const upper  = query.trim().toUpperCase()
        const rank   = (sym) => {
          if (sym === upper)         return 0
          if (sym.startsWith(upper)) return 1
          if (sym.includes(upper))   return 2
          return 3
        }
        const excludeSet = new Set(exclude.map(s => s.toUpperCase()))
        const sorted = [...hits]
          .filter(h => !excludeSet.has(h.symbol.toUpperCase()))
          .sort((a, b) => rank(a.symbol) - rank(b.symbol))
        setResults(sorted)
        setOpen(sorted.length > 0)
        setCursor(-1)
      } catch {
        setResults([])
        setOpen(false)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(debounceRef.current)
  }, [query, confirmed])

  // ── Selection ────────────────────────────────────────────────────
  const handleSelect = useCallback((stock) => {
    setQuery(stock.symbol)
    setConfirmed(true)
    setOpen(false)
    setResults([])
    setCursor(-1)
    onChange(stock.symbol)
  }, [onChange])

  // ── Clear ────────────────────────────────────────────────────────
  const handleClear = () => {
    setQuery('')
    setConfirmed(false)
    setOpen(false)
    setResults([])
    setCursor(-1)
    onChange('')
    onClear?.()
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // ── Keyboard navigation ──────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault()
      handleSelect(results[cursor])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setCursor(-1)
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (cursor < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-idx="${cursor}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const showDropdown = open && !confirmed && (loading || results.length > 0)

  return (
    <div className="relative">
      {/* Input */}
      <div className={clsx(
        'flex items-center gap-2 bg-surface-hover rounded-lg px-3 py-2 border transition-colors',
        showDropdown ? 'border-accent-blue/50 ring-1 ring-accent-blue/20' : 'border-border'
      )}>
        {loading
          ? <Loader2 size={13} className="text-accent-blue shrink-0 animate-spin" />
          : <Search  size={13} className="text-muted shrink-0" />
        }
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setConfirmed(false); onChange('') }}
          onFocus={() => results.length > 0 && !confirmed && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          className="bg-transparent text-primary text-sm placeholder-muted outline-none w-full"
        />
        {confirmed && (
          <span className="text-gain text-xs font-bold shrink-0 flex items-center gap-1">
            {query} <span className="text-[10px]">✓</span>
          </span>
        )}
        {query && (
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); handleClear() }}
            tabIndex={-1}
            className="text-muted hover:text-primary shrink-0 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <ul
          ref={listRef}
          role="listbox"
          onMouseDown={e => e.preventDefault()}
          className="absolute top-full mt-1.5 left-0 w-80 bg-surface-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden py-1 max-h-72 overflow-y-auto"
        >
          {/* Loading state */}
          {loading && results.length === 0 && (
            <li className="flex items-center gap-2 px-4 py-3 text-muted text-xs">
              <Loader2 size={11} className="animate-spin shrink-0" /> Searching Polygon…
            </li>
          )}

          {/* Results */}
          {results.map((stock, idx) => (
            <li key={stock.symbol} data-idx={idx}>
              <button
                type="button"
                onMouseDown={() => handleSelect(stock)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors text-left',
                  cursor === idx ? 'bg-accent-blue/10' : 'hover:bg-surface-hover'
                )}
              >
                {/* Symbol */}
                <span className="font-mono text-sm font-bold text-accent-blue w-16 shrink-0 truncate">
                  {stock.symbol}
                </span>

                {/* Company name */}
                <span className="text-secondary text-xs truncate flex-1 min-w-0">
                  {stock.name}
                </span>

                {/* Type / market badges */}
                <TypeBadge type={stock.type} market={stock.market} />
              </button>
            </li>
          ))}

          {/* Hint */}
          {results.length > 0 && (
            <li className="px-3 py-1.5 border-t border-border mt-1">
              <p className="text-faint text-[10px]">↑↓ navigate · Enter select · Esc close</p>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
