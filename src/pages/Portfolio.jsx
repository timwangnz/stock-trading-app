/**
 * Portfolio.jsx — now uses live prices via useLivePrices hook.
 */

import { useMemo, useState, useRef, useEffect } from 'react'
import { Trash2, PlusCircle, TrendingUp, DollarSign, Percent, RefreshCw, Search, X, Loader2, TrendingDown, ShoppingCart, MinusCircle } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useApp, ACTIONS } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { STOCKS } from '../data/mockData'
import { useLivePrices } from '../hooks/useLivePrices'
import { searchTickers } from '../services/polygonApi'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'
import { useTheme } from '../context/ThemeContext'
import clsx from 'clsx'

/**
 * StockSearchInput
 * Live autocomplete backed by Polygon's /v3/reference/tickers API.
 * Debounces keystrokes (300ms) so we don't hammer the API on every key.
 *
 * Key concepts:
 *  - useEffect + setTimeout for debouncing
 *  - Cleanup function (return () => clearTimeout) to cancel stale requests
 *  - AbortController to cancel in-flight fetch when query changes
 */
function StockSearchInput({ value, onChange }) {
  const [query,     setQuery]     = useState(value || '')
  const [results,   setResults]   = useState([])
  const [open,      setOpen]      = useState(false)
  const [searching, setSearching] = useState(false)  // shows spinner while API is called
  const [confirmed, setConfirmed] = useState(!!value)
  const inputRef = useRef(null)

  // ── Debounced search ───────────────────────────────────────
  // Every time `query` changes (and the symbol isn't already confirmed),
  // we wait 300ms then call Polygon. If the user types again within that
  // window, the previous timeout is cancelled and we start fresh.
  useEffect(() => {
    if (confirmed || query.trim().length < 1) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)

    const timer = setTimeout(async () => {
      try {
        const hits = await searchTickers(query, 8)
        setResults(hits)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300) // 300ms debounce delay

    // Cleanup: if the component re-renders before 300ms, cancel the timer
    return () => clearTimeout(timer)
  }, [query, confirmed])

  const handleSelect = (stock) => {
    setQuery(stock.symbol)
    setConfirmed(true)
    setOpen(false)
    setResults([])
    onChange(stock.symbol)
  }

  const handleClear = () => {
    setQuery('')
    setConfirmed(false)
    setOpen(false)
    setResults([])
    onChange('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleChange = (e) => {
    setQuery(e.target.value)
    setConfirmed(false)
    onChange('')
  }

  const showDropdown = open && !confirmed && (searching || results.length > 0 || query.length >= 1)

  return (
    <div className="relative">
      {/* Input box */}
      <div className={clsx(
        'flex items-center gap-2 bg-surface-hover rounded-lg px-3 py-2 border transition-colors',
        showDropdown ? 'border-accent-blue/50' : 'border-border'
      )}>
        {searching
          ? <Loader2 size={13} className="text-accent-blue shrink-0 animate-spin" />
          : <Search  size={13} className="text-muted shrink-0" />
        }
        <input
          ref={inputRef}
          type="text"
          placeholder="Search any stock…"
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="bg-transparent text-primary text-sm placeholder-muted outline-none w-full"
          autoComplete="off"
        />
        {confirmed && (
          <span className="text-gain text-xs font-bold shrink-0">{query} ✓</span>
        )}
        {query && (
          <button type="button" onClick={handleClear} tabIndex={-1}>
            <X size={12} className="text-muted hover:text-primary shrink-0" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <ul className="absolute top-full mt-1 w-72 bg-surface-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {searching && results.length === 0 && (
            <li className="flex items-center gap-2 px-4 py-3 text-muted text-xs">
              <Loader2 size={12} className="animate-spin" /> Searching Polygon…
            </li>
          )}
          {!searching && results.length === 0 && query.length >= 1 && (
            <li className="px-4 py-3 text-muted text-xs">No results for "{query}"</li>
          )}
          {results.map(stock => (
            <li key={stock.symbol}>
              <button
                type="button"
                onMouseDown={() => handleSelect(stock)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover transition-colors text-left"
              >
                <span className="text-accent-blue font-mono text-sm font-bold w-14 shrink-0">
                  {stock.symbol}
                </span>
                <span className="text-muted text-xs truncate">{stock.name}</span>
                <span className="ml-auto text-faint text-xs shrink-0 uppercase">{stock.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddHoldingForm({ onAdd, onCancel }) {
  const [symbol,  setSymbol]  = useState('')
  const [shares,  setShares]  = useState('')
  const [avgCost, setAvgCost] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const s  = symbol.toUpperCase().trim()
    const sh = parseFloat(shares)
    const ac = parseFloat(avgCost)
    if (!s || isNaN(sh) || isNaN(ac) || sh <= 0 || ac <= 0) return
    onAdd({ symbol: s, shares: sh, avgCost: ac })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-card border border-border rounded-xl p-4 space-y-3">
      <h3 className="text-primary text-sm font-semibold">Add Holding</h3>
      <div className="grid grid-cols-3 gap-2">
        {/* Searchable stock picker replaces the old <select> */}
        <StockSearchInput value={symbol} onChange={setSymbol} />
        <input
          type="number" min="0.001" step="any" placeholder="Shares"
          value={shares} onChange={e => setShares(e.target.value)}
          className="bg-surface-hover text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border"
          required
        />
        <input
          type="number" min="0.01" step="any" placeholder="Avg cost ($)"
          value={avgCost} onChange={e => setAvgCost(e.target.value)}
          className="bg-surface-hover text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border"
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!symbol}
          className="bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Add to Portfolio
        </button>
        <button type="button" onClick={onCancel} className="text-muted hover:text-primary text-sm px-3 py-2 transition-colors">Cancel</button>
        {!symbol && (
          <span className="text-muted text-xs ml-1">← Select a stock first</span>
        )}
      </div>
    </form>
  )
}

/**
 * TradePanel
 * Inline buy/sell form that appears beneath a holdings row.
 *
 * - Buy: uses current live price as default, recalculates weighted avg cost
 * - Sell: validates you can't sell more than you hold; removing all = full exit
 *
 * @param {'buy'|'sell'} mode
 * @param {object} holding  - the enriched holding object (has .shares, .price, .symbol)
 * @param {function} onClose
 */
function TradePanel({ mode, holding, onClose, onBuy, onSell }) {
  const [qty,       setQty]       = useState('')
  const [price,     setPrice]     = useState(mode === 'buy' ? holding.price.toFixed(2) : '')
  const [error,     setError]     = useState('')

  const isBuy  = mode === 'buy'
  const shares = parseFloat(qty)
  const cost   = parseFloat(price)

  // Live preview calculations
  const totalCash = !isNaN(shares) && !isNaN(cost) ? shares * cost : null

  // For sells: what % of the holding is being sold
  const sellPct = !isNaN(shares) && holding.shares > 0
    ? Math.min(100, (shares / holding.shares) * 100).toFixed(1)
    : null

  // New avg cost after a buy (weighted average formula)
  const newAvgCost = isBuy && !isNaN(shares) && !isNaN(cost) && shares > 0
    ? ((holding.avgCost * holding.shares) + (cost * shares)) / (holding.shares + shares)
    : null

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

    if (isNaN(shares) || shares <= 0) { setError('Enter a valid number of shares.'); return }

    if (isBuy) {
      if (isNaN(cost) || cost <= 0) { setError('Enter a valid price.'); return }
      onBuy({ symbol: holding.symbol, shares, avgCost: cost })
    } else {
      if (shares > holding.shares) {
        setError(`You only hold ${holding.shares} shares — can't sell more than that.`)
        return
      }
      onSell({ symbol: holding.symbol, shares })
    }
    onClose()
  }

  return (
    <tr className="bg-surface-hover/50 border-t border-border">
      <td colSpan={7} className="px-5 py-4">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start gap-4 flex-wrap">

            {/* Mode label */}
            <div className={clsx(
              'flex items-center gap-1.5 text-sm font-semibold shrink-0 mt-2',
              isBuy ? 'text-gain' : 'text-loss'
            )}>
              {isBuy ? <ShoppingCart size={14} /> : <MinusCircle size={14} />}
              {isBuy ? 'Buy More' : 'Sell'} {holding.symbol}
            </div>

            {/* Shares input */}
            <div className="flex flex-col gap-1">
              <label className="text-muted text-xs">Shares</label>
              <input
                type="number" min="0.001" step="any"
                placeholder={isBuy ? 'How many to buy' : `Max ${holding.shares}`}
                value={qty} onChange={e => setQty(e.target.value)}
                autoFocus
                className="bg-surface-card text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border w-40 focus:border-accent-blue/50 transition-colors"
              />
            </div>

            {/* Price input (buy only) */}
            {isBuy && (
              <div className="flex flex-col gap-1">
                <label className="text-muted text-xs">Price per share ($)</label>
                <input
                  type="number" min="0.01" step="any"
                  value={price} onChange={e => setPrice(e.target.value)}
                  className="bg-surface-card text-primary text-sm rounded-lg px-3 py-2 outline-none border border-border w-36 focus:border-accent-blue/50 transition-colors"
                />
              </div>
            )}

            {/* Live preview */}
            {qty && !isNaN(shares) && shares > 0 && (
              <div className="flex flex-col gap-1 mt-2 text-xs text-muted min-w-0">
                {isBuy && totalCash !== null && (
                  <p>Total cost: <span className="text-primary font-medium">${totalCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
                )}
                {isBuy && newAvgCost !== null && (
                  <p>New avg cost: <span className="text-primary font-medium">${newAvgCost.toFixed(2)}</span></p>
                )}
                {!isBuy && sellPct !== null && (
                  <p>
                    Selling <span className="text-primary font-medium">{sellPct}%</span> of position
                    {shares >= holding.shares && <span className="text-loss ml-1">(full exit)</span>}
                  </p>
                )}
                {!isBuy && totalCash !== null && holding.price > 0 && (
                  <p>Proceeds: <span className="text-primary font-medium">${(shares * holding.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
                )}
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-2 mt-auto ml-auto shrink-0">
              {error && <p className="text-loss text-xs">{error}</p>}
              <button
                type="submit"
                className={clsx(
                  'text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors',
                  isBuy
                    ? 'bg-gain hover:bg-gain/80'
                    : 'bg-loss hover:bg-loss/80'
                )}
              >
                {isBuy ? 'Confirm Buy' : 'Confirm Sell'}
              </button>
              <button
                type="button" onClick={onClose}
                className="text-muted hover:text-primary text-sm px-3 py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  )
}

export default function Portfolio() {
  const { state, dispatch } = useApp()
  const { canTrade, isReadonly } = useAuth()
  const { chart: chartTheme, pieColors: COLORS } = useTheme()
  const [showAddForm, setShowAddForm] = useState(false)
  // activePanel: { symbol, mode: 'buy'|'sell' } or null
  const [activePanel, setActivePanel] = useState(null)

  // Fetch live prices for all held symbols
  const symbols = state.portfolio.map(h => h.symbol)
  const { prices, loading, error, refetch } = useLivePrices(symbols)


  // Enrich holdings with live price data
  const holdings = useMemo(() => {
    return state.portfolio.map((holding, i) => {
      const live     = prices.get(holding.symbol)
      const price    = live?.price ?? 0
      const value    = price * holding.shares
      const cost     = holding.avgCost * holding.shares
      const gain     = value - cost
      const gainPct  = cost > 0 ? (gain / cost) * 100 : 0
      const meta     = STOCKS.find(s => s.symbol === holding.symbol) ?? {}
      return { ...holding, ...meta, price, value, cost, gain, gainPct, colorIndex: i }
    })
  }, [state.portfolio, prices])

  const totalValue   = holdings.reduce((s, h) => s + h.value, 0)
  const totalCost    = holdings.reduce((s, h) => s + h.cost,  0)
  const totalGain    = totalValue - totalCost
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

  if (loading) return <LoadingSpinner message="Fetching live prices…" />
  if (error)   return <ErrorMessage error={error} />

  return (
    <div className="p-6 space-y-6">

      {/* ── Summary cards ────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <DollarSign size={14} className="text-muted" />
              <p className="text-muted text-xs">Total Value</p>
            </div>
            <button onClick={refetch} className="text-faint hover:text-muted transition-colors" title="Refresh prices">
              <RefreshCw size={11} />
            </button>
          </div>
          <p className="text-primary font-bold text-2xl">
            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-muted" />
            <p className="text-muted text-xs">Unrealized P&L</p>
          </div>
          <p className={clsx('font-bold text-2xl', totalGain >= 0 ? 'text-gain' : 'text-loss')}>
            {totalGain >= 0 ? '+' : ''}${totalGain.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-surface-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Percent size={14} className="text-muted" />
            <p className="text-muted text-xs">Return %</p>
          </div>
          <p className={clsx('font-bold text-2xl', totalGainPct >= 0 ? 'text-gain' : 'text-loss')}>
            {totalGainPct >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}%
          </p>
        </div>
      </div>

      {/* ── Allocation pie chart ─────────────────────── */}
      {holdings.length > 0 && totalValue > 0 && (
        <div className="bg-surface-card border border-border rounded-xl p-5">
          <p className="text-muted text-xs mb-4">Portfolio Allocation</p>
          <div className="flex items-center gap-6">

            {/* Pie */}
            <div className="shrink-0" style={{ width: 180, height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={holdings.map(h => ({
                      name:  h.symbol,
                      value: h.value,
                      pct:   ((h.value / totalValue) * 100).toFixed(1),
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {holdings.map((h, i) => (
                      <Cell key={h.symbol} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: chartTheme.tooltip.bg,
                      border: `1px solid ${chartTheme.tooltip.border}`,
                      borderRadius: '10px',
                      fontSize: '12px',
                      color: chartTheme.tooltip.text,
                    }}
                    formatter={(value, name, props) => [
                      `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${props.payload.pct}%)`,
                      name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              {holdings.map((h, i) => {
                const pct = ((h.value / totalValue) * 100)
                return (
                  <div key={h.symbol} className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="text-secondary text-xs font-mono font-semibold w-14 shrink-0">
                      {h.symbol}
                    </span>
                    {/* Bar */}
                    <div className="flex-1 bg-surface-hover rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: COLORS[i % COLORS.length],
                        }}
                      />
                    </div>
                    <span className="text-muted text-xs w-10 text-right shrink-0">
                      {pct.toFixed(1)}%
                    </span>
                    <span className="text-muted text-xs w-20 text-right shrink-0 hidden sm:block">
                      ${h.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </div>
                )
              })}
            </div>

          </div>
        </div>
      )}

      {/* ── Holdings table ───────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-primary text-sm font-semibold">Holdings ({holdings.length})</h2>
          {canTrade ? (
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="flex items-center gap-1.5 text-accent-blue hover:text-accent-blue/80 text-xs font-medium transition-colors"
            >
              <PlusCircle size={14} /> Add Holding
            </button>
          ) : (
            <span className="text-faint text-xs italic">view only</span>
          )}
        </div>

        {showAddForm && (
          <div className="p-4 border-b border-border">
            <AddHoldingForm
              onAdd={h => { dispatch({ type: ACTIONS.ADD_TO_PORTFOLIO, payload: h }); setShowAddForm(false) }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        {holdings.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted text-sm">No holdings yet. Click "Add Holding" to get started.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs">
                <th className="text-left px-5 py-3 font-medium">Symbol</th>
                <th className="text-right px-5 py-3 font-medium">Shares</th>
                <th className="text-right px-5 py-3 font-medium">Avg Cost</th>
                <th className="text-right px-5 py-3 font-medium">Current (Live)</th>
                <th className="text-right px-5 py-3 font-medium">Value</th>
                <th className="text-right px-5 py-3 font-medium">Gain / Loss</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map(h => {
                const panelOpen = activePanel?.symbol === h.symbol
                const panelMode = activePanel?.mode

                const togglePanel = (mode) => {
                  // If the same button is clicked again, close the panel
                  setActivePanel(panelOpen && panelMode === mode ? null : { symbol: h.symbol, mode })
                }

                return (
                  <>
                    <tr
                      key={h.symbol}
                      className={clsx(
                        'border-t border-border transition-colors',
                        panelOpen ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                      )}
                    >
                      {/* Symbol */}
                      <td className="px-5 py-3">
                        <button onClick={() => dispatch({ type: ACTIONS.VIEW_STOCK, payload: h.symbol })} className="text-left">
                          <p className="text-primary font-mono font-semibold">{h.symbol}</p>
                          <p className="text-muted text-xs">{h.name}</p>
                        </button>
                      </td>
                      <td className="text-right px-5 py-3 text-secondary">{h.shares}</td>
                      <td className="text-right px-5 py-3 text-secondary">${h.avgCost.toFixed(2)}</td>
                      <td className="text-right px-5 py-3 text-primary">${h.price.toFixed(2)}</td>
                      <td className="text-right px-5 py-3 text-primary font-medium">
                        ${h.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="text-right px-5 py-3">
                        <p className={clsx('font-medium', h.gain >= 0 ? 'text-gain' : 'text-loss')}>
                          {h.gain >= 0 ? '+' : ''}${h.gain.toFixed(2)}
                        </p>
                        <p className={clsx('text-xs', h.gainPct >= 0 ? 'text-gain' : 'text-loss')}>
                          {h.gainPct >= 0 ? '+' : ''}{h.gainPct.toFixed(2)}%
                        </p>
                      </td>

                      {/* Actions: Buy / Sell / Remove — hidden for readonly */}
                      <td className="px-4 py-3">
                        {canTrade ? (
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              onClick={() => togglePanel('buy')}
                              title="Buy more"
                              className={clsx(
                                'px-2 py-1 rounded text-xs font-medium border transition-colors',
                                panelOpen && panelMode === 'buy'
                                  ? 'bg-gain/20 border-gain/40 text-gain'
                                  : 'border-border text-muted hover:border-gain/40 hover:text-gain'
                              )}
                            >
                              Buy
                            </button>
                            <button
                              onClick={() => togglePanel('sell')}
                              title="Sell shares"
                              className={clsx(
                                'px-2 py-1 rounded text-xs font-medium border transition-colors',
                                panelOpen && panelMode === 'sell'
                                  ? 'bg-loss/20 border-loss/40 text-loss'
                                  : 'border-border text-muted hover:border-loss/40 hover:text-loss'
                              )}
                            >
                              Sell
                            </button>
                            <button
                              onClick={() => dispatch({ type: ACTIONS.REMOVE_FROM_PORTFOLIO, payload: h.symbol })}
                              title="Remove holding"
                              className="text-faint hover:text-loss transition-colors ml-1"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-faint text-xs italic text-right block">view only</span>
                        )}
                      </td>
                    </tr>

                    {/* Inline trade panel — renders as a full-width row beneath */}
                    {panelOpen && (
                      <TradePanel
                        key={`panel-${h.symbol}`}
                        mode={panelMode}
                        holding={h}
                        onClose={() => setActivePanel(null)}
                        onBuy={(payload) => dispatch({ type: ACTIONS.ADD_TO_PORTFOLIO, payload })}
                        onSell={(payload) => dispatch({ type: ACTIONS.SELL_SHARES, payload })}
                      />
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
