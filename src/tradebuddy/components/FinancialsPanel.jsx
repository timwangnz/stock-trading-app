/**
 * FinancialsPanel.jsx
 * Shared financial-statements widget.
 *
 * Props:
 *   ticker      {string}  — e.g. "AAPL"  (required)
 *   showRag     {boolean} — whether to render the RAG JSON exporter (default false)
 *   defaultTab  {string}  — which tab to open first (default 'income')
 *
 * Self-contained: fetches its own data, renders tabs, handles loading/error.
 * Used by both StockDetail and KnowledgeBase pages.
 */

import { useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, Minus,
  Scale, Waves, BarChart2,
  ChevronDown, ChevronUp, Loader2, AlertCircle,
  Copy, Check, Download, Database,
} from 'lucide-react'
import { getFinancials } from '../../common/services/apiService'
import clsx from 'clsx'

// ── Formatting helpers ────────────────────────────────────────────

function fmtNum(n) {
  if (n === null || n === undefined) return '—'
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(2)}`
}

function fmtPct(n)         { return n != null ? `${(n * 100).toFixed(1)}%` : '—' }
function fmtRatio(n, dp=2) { return n != null ? `${n.toFixed(dp)}x`        : '—' }
function fmtPrice(n)       { return n != null ? `$${n.toFixed(2)}`          : '—' }

function shortPeriod(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { year: '2-digit', month: 'short' })
}

// ── Tab + row definitions ─────────────────────────────────────────

const TABS = [
  { id: 'income',   label: 'Income',    icon: TrendingUp },
  { id: 'balance',  label: 'Balance',   icon: Scale      },
  { id: 'cashflow', label: 'Cash Flow', icon: Waves      },
  { id: 'ratios',   label: 'Ratios',    icon: BarChart2  },
]

const SECTION_MAP = {
  income: {
    key: 'income_statement',
    rows: [
      { key: 'revenue',             label: 'Revenue',             fmt: fmtNum   },
      { key: 'gross_profit',        label: 'Gross Profit',        fmt: fmtNum   },
      { key: 'operating_income',    label: 'Operating Income',    fmt: fmtNum   },
      { key: 'ebitda',              label: 'EBITDA',              fmt: fmtNum   },
      { key: 'net_income',          label: 'Net Income',          fmt: fmtNum   },
      { key: 'eps',                 label: 'EPS (Basic)',          fmt: v => v != null ? `$${v.toFixed(2)}` : '—' },
      { key: 'shares_outstanding',  label: 'Shares Outstanding',  fmt: v => v != null ? `${(v/1e6).toFixed(0)}M` : '—' },
    ],
  },
  balance: {
    key: 'balance_sheet',
    rows: [
      { key: 'total_assets',        label: 'Total Assets',        fmt: fmtNum },
      { key: 'current_assets',      label: 'Current Assets',      fmt: fmtNum },
      { key: 'cash',                label: 'Cash & Equivalents',  fmt: fmtNum },
      { key: 'total_liabilities',   label: 'Total Liabilities',   fmt: fmtNum },
      { key: 'current_liabilities', label: 'Current Liabilities', fmt: fmtNum },
      { key: 'long_term_debt',      label: 'Long-Term Debt',      fmt: fmtNum },
      { key: 'equity',              label: 'Stockholders\' Equity', fmt: fmtNum },
    ],
  },
  cashflow: {
    key: 'cash_flow_statement',
    rows: [
      { key: 'operating_cash_flow', label: 'Operating Cash Flow', fmt: fmtNum },
      { key: 'investing_cash_flow', label: 'Investing Cash Flow', fmt: fmtNum },
      { key: 'financing_cash_flow', label: 'Financing Cash Flow', fmt: fmtNum },
      { key: 'capital_expenditure', label: 'Capital Expenditure', fmt: fmtNum },
      { key: 'free_cash_flow',      label: 'Free Cash Flow',      fmt: fmtNum },
    ],
  },
  ratios: {
    key: 'ratios',
    rows: [
      { key: 'pe_ratio',         label: 'P/E Ratio',       fmt: fmtRatio, note: 'Price / EPS'         },
      { key: 'pb_ratio',         label: 'P/B Ratio',       fmt: fmtRatio, note: 'Price / Book Value'  },
      { key: 'ps_ratio',         label: 'P/S Ratio',       fmt: fmtRatio, note: 'Price / Sales/Share' },
      { key: 'ev_ebitda',        label: 'EV/EBITDA',       fmt: fmtRatio, note: 'Enterprise multiple' },
      { key: 'gross_margin',     label: 'Gross Margin',    fmt: fmtPct,   note: 'Gross Profit / Rev'  },
      { key: 'operating_margin', label: 'Op. Margin',      fmt: fmtPct,   note: 'Op. Income / Rev'    },
      { key: 'net_margin',       label: 'Net Margin',      fmt: fmtPct,   note: 'Net Income / Rev'    },
      { key: 'roe',              label: 'ROE',             fmt: fmtPct,   note: 'Net Inc / Equity'    },
      { key: 'roa',              label: 'ROA',             fmt: fmtPct,   note: 'Net Inc / Assets'    },
      { key: 'debt_to_equity',   label: 'Debt / Equity',  fmt: fmtRatio, note: 'LT Debt / Equity'    },
      { key: 'current_ratio',    label: 'Current Ratio',  fmt: fmtRatio, note: 'Curr Assets / Liab.' },
    ],
  },
}

// ── Sub-components ────────────────────────────────────────────────

function MetricCell({ value, prevValue, format }) {
  const display = format(value)
  const hasData = value !== null && value !== undefined
  const hasPrev = prevValue !== null && prevValue !== undefined
  let trend = null
  if (hasData && hasPrev && typeof value === 'number') {
    const delta = value - prevValue
    trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  }
  return (
    <td className="px-4 py-2.5 text-right text-sm tabular-nums">
      <span className={clsx('font-medium', hasData ? 'text-primary' : 'text-muted')}>
        {display}
      </span>
      {trend === 'up'   && <TrendingUp   size={11} className="inline ml-1 text-gain opacity-70"  />}
      {trend === 'down' && <TrendingDown size={11} className="inline ml-1 text-loss opacity-70"  />}
      {trend === 'flat' && <Minus        size={11} className="inline ml-1 text-muted opacity-70" />}
    </td>
  )
}

function FinancialTable({ tab, periods }) {
  const { key, rows } = SECTION_MAP[tab]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide w-44">
              Metric
            </th>
            {periods.map(p => (
              <th key={p.period} className="px-4 py-2.5 text-right text-xs font-medium text-muted uppercase tracking-wide">
                {shortPeriod(p.period)}
                <span className="block text-[10px] font-normal normal-case text-muted/60">
                  {p.fiscalPeriod ?? p.timeframe}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key: rowKey, label, fmt, note }, i) => (
            <tr
              key={rowKey}
              className={clsx(
                'border-b border-border/50 hover:bg-surface-hover transition-colors',
                i % 2 === 0 ? 'bg-transparent' : 'bg-surface-card/30'
              )}
            >
              <td className="px-4 py-2.5">
                <span className="text-secondary text-sm">{label}</span>
                {note && <span className="block text-[10px] text-muted/60">{note}</span>}
              </td>
              {periods.map((p, pi) => (
                <MetricCell
                  key={p.period}
                  value={p[key]?.[rowKey]}
                  prevValue={periods[pi + 1]?.[key]?.[rowKey]}
                  format={fmt}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── RAG chunk builder ─────────────────────────────────────────────

function buildRagChunks(data) {
  if (!data?.periods?.length) return []
  const sectionLabels = {
    income_statement:    'income_statement',
    balance_sheet:       'balance_sheet',
    cash_flow_statement: 'cash_flow_statement',
    ratios:              'key_ratios',
  }
  const chunks = []
  for (const period of data.periods) {
    const base = {
      ticker: data.ticker, company: data.company_name,
      period: period.period, start_date: period.startDate,
      timeframe: period.timeframe,
      fiscal_period: period.fiscalPeriod, fiscal_year: period.fiscalYear,
    }
    for (const [sectionKey, ragLabel] of Object.entries(sectionLabels)) {
      const cleaned = Object.fromEntries(
        Object.entries(period[sectionKey] ?? {}).filter(([, v]) => v !== null && v !== undefined)
      )
      if (Object.keys(cleaned).length === 0) continue
      chunks.push({
        id: `${data.ticker}_${ragLabel}_${period.period}_${period.timeframe}`,
        ...base, type: ragLabel, metrics: cleaned,
        metadata: {
          source: 'polygon.io',
          generated_at: new Date().toISOString(),
          latest_price: data.latest_price,
          unit: 'USD',
        },
      })
    }
  }
  return chunks
}

function RagPanel({ data }) {
  const [copied, setCopied]     = useState(false)
  const [expanded, setExpanded] = useState(false)
  const chunks = buildRagChunks(data)
  const json   = JSON.stringify(chunks, null, 2)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const handleDownload = () => {
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `${data.ticker}_rag_chunks_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3 bg-surface-card cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <Database size={15} className="text-accent-blue" />
          <span className="text-sm font-medium text-primary">RAG JSON Chunks</span>
          <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded-full border border-border">
            {chunks.length} chunks
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); handleCopy() }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-primary hover:bg-surface-hover transition-colors border border-border">
            {copied ? <Check size={12} className="text-gain" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={e => { e.stopPropagation(); handleDownload() }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors border border-accent-blue/20">
            <Download size={12} /> Download .json
          </button>
          {expanded
            ? <ChevronUp   size={14} className="text-muted ml-1" />
            : <ChevronDown size={14} className="text-muted ml-1" />}
        </div>
      </div>
      {expanded && (
        <pre className="p-5 text-xs text-secondary bg-surface overflow-x-auto max-h-96 font-mono leading-relaxed border-t border-border">
          {json}
        </pre>
      )}
      {!expanded && chunks.length > 0 && (
        <div className="border-t border-border px-5 py-3 bg-surface">
          <p className="text-[10px] text-muted uppercase tracking-wide mb-1.5 font-medium">Preview — first chunk</p>
          <pre className="text-xs text-secondary font-mono leading-relaxed overflow-x-auto max-h-28">
            {JSON.stringify(chunks[0], null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────

export default function FinancialsPanel({ ticker, showRag = false, defaultTab = 'income' }) {
  const [timeframe, setTimeframe] = useState('annual')
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [data,      setData]      = useState(null)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)
    setData(null)
    getFinancials(ticker, timeframe, 4)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [ticker, timeframe])

  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <p className="text-sm font-medium text-primary">Financial Statements</p>
        <div className="flex gap-1">
          {['annual', 'quarterly'].map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={clsx(
                'px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors border',
                timeframe === tf
                  ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30'
                  : 'text-muted border-border hover:text-primary hover:bg-surface-hover'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center gap-2.5 py-10 text-muted">
          <Loader2 size={16} className="animate-spin text-accent-blue" />
          <span className="text-sm">Loading financial statements…</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div className="flex items-start gap-3 m-4 p-4 bg-loss/8 border border-loss/20 rounded-xl">
          <AlertCircle size={16} className="text-loss shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-loss">Could not load financials</p>
            <p className="text-xs text-muted mt-1">{error}</p>
            <p className="text-xs text-muted mt-1">Financial statements require a Polygon.io Starter plan or higher.</p>
          </div>
        </div>
      )}

      {/* ── Data ── */}
      {data && !loading && (
        <>
          {/* Latest price badge */}
          {data.latest_price && (
            <div className="px-5 py-2 border-b border-border/50 flex items-center gap-3 text-xs text-muted">
              <span>
                Latest close: <span className="text-accent-blue font-medium">{fmtPrice(data.latest_price)}</span>
              </span>
              <span className="text-border">·</span>
              <span>{data.periods?.length} {data.timeframe} period{data.periods?.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-0 border-b border-border">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                  activeTab === id
                    ? 'border-accent-blue text-accent-blue'
                    : 'border-transparent text-muted hover:text-primary'
                )}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {/* Table */}
          {data.periods?.length > 0
            ? <FinancialTable tab={activeTab} periods={data.periods} />
            : <p className="py-8 text-center text-muted text-sm">No data available.</p>
          }

          {/* RAG exporter (optional) */}
          {showRag && (
            <div className="p-4 border-t border-border">
              <RagPanel data={data} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
