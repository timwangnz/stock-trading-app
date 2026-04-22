/**
 * KnowledgeBase.jsx
 * Company Financial Knowledge Base — search a public company by ticker,
 * explore its financial statements, and export structured JSON chunks
 * ready for a RAG/trading-agent pipeline.
 *
 * The heavy lifting (data fetching, table rendering, RAG export) is
 * handled by the shared <FinancialsPanel> component.
 */

import { useState, useRef, useEffect } from 'react'
import { Search, BookOpen, Loader2 } from 'lucide-react'
import FinancialsPanel from '../components/FinancialsPanel'

// ── Popular tickers for quick access ─────────────────────────────

const QUICK_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'BRK.B',
  'JPM', 'V', 'JNJ', 'WMT', 'XOM', 'SPY',
]

// ── Main component ────────────────────────────────────────────────

export default function KnowledgeBase() {
  const [query,   setQuery]   = useState('')
  const [ticker,  setTicker]  = useState('')
  const [pending, setPending] = useState(false)   // brief flash while "committing" ticker
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = (sym) => {
    const s = sym.trim().toUpperCase()
    if (!s) return
    setQuery(s)
    setTicker('')          // unmount panel so it re-fetches cleanly
    setPending(true)
    setTimeout(() => { setTicker(s); setPending(false) }, 0)
  }

  const handleSearch = (e) => { e.preventDefault(); submit(query) }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Page header ── */}
      <div className="flex items-center gap-2.5">
        <BookOpen size={22} className="text-accent-blue" />
        <div>
          <h1 className="text-xl font-semibold text-primary leading-tight">
            Company Knowledge Base
          </h1>
          <p className="text-sm text-muted">
            Financial statements &amp; ratios — structured for your RAG trading agent
          </p>
        </div>
      </div>

      {/* ── Search bar ── */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            placeholder="Enter ticker — AAPL, MSFT, NVDA…"
            className="w-full pl-10 pr-4 py-2.5 bg-surface-card border border-border rounded-xl text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10 transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || pending}
          className="px-5 py-2.5 bg-accent-blue text-white rounded-xl text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Search
        </button>
      </form>

      {/* ── Quick tickers ── */}
      <div>
        <p className="text-xs text-muted mb-2">Quick access</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_TICKERS.map(t => (
            <button
              key={t}
              onClick={() => submit(t)}
              className="px-3 py-1.5 bg-surface-card border border-border rounded-lg text-xs text-secondary hover:text-accent-blue hover:border-accent-blue/30 hover:bg-accent-blue/5 transition-colors font-mono font-medium"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── Financials panel — renders once ticker is set ── */}
      {ticker && !pending && (
        <FinancialsPanel ticker={ticker} showRag={true} />
      )}

      {/* ── Empty state ── */}
      {!ticker && !pending && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent-blue/10 flex items-center justify-center mb-4">
            <BookOpen size={28} className="text-accent-blue" />
          </div>
          <h2 className="text-base font-semibold text-primary mb-2">
            Search a public company
          </h2>
          <p className="text-sm text-muted max-w-xs">
            Enter a ticker symbol above to load its income statement, balance sheet,
            cash flow, and key ratios — then export as structured JSON for your
            RAG trading agent.
          </p>
        </div>
      )}

      {ticker && (
        <p className="text-[11px] text-muted text-center pb-2">
          Data from Polygon.io · Cached daily · For research purposes only
        </p>
      )}
    </div>
  )
}
