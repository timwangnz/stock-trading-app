/**
 * StockTreemap.jsx
 * Pure-render treemap shared by MarketHeatmap and PortfolioHeatmap.
 *
 * Props:
 *   data        — array of { symbol, size, changePct, price, label?, tooltip? }
 *   height      — chart height in px (default 200)
 *   clampRange  — [min%, max%] for colour scale (default [-5, 5])
 *   onCellClick — (symbol) => void
 *   title       — header text
 *   subtitle    — sub-header text
 */

import { useMemo } from 'react'
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts'

// ── Colour scale ──────────────────────────────────────────────
export function changePctToColor(pct, [lo, hi] = [-5, 5]) {
  const clamped = Math.max(lo, Math.min(hi, pct ?? 0))
  const t = (clamped - lo) / (hi - lo)   // 0 → lo, 1 → hi

  if (t < 0.5) {
    const s = t / 0.5
    return `rgb(${Math.round(180 * (1 - s) + 30 * s)},40,${Math.round(40 * (1 - s) + 55 * s)})`
  } else {
    const s = (t - 0.5) / 0.5
    return `rgb(30,${Math.round(40 * (1 - s) + 140 * s)},${Math.round(55 * (1 - s) + 50 * s)})`
  }
}

// ── Tooltip ───────────────────────────────────────────────────
function TreemapTooltip({ active, payload, labelFormatter }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d?.symbol) return null

  const pct  = d.changePct ?? 0
  const isUp = pct >= 0

  return (
    <div className="bg-surface-card border border-border rounded-xl px-3.5 py-2.5 shadow-xl text-xs space-y-0.5 pointer-events-none">
      <p className="text-primary font-semibold font-mono text-sm">{d.symbol}</p>
      {d.companyName && <p className="text-muted/70 text-[10px] -mt-0.5">{d.companyName}</p>}
      {d.price  != null && <p className="text-muted">${Number(d.price).toFixed(2)}</p>}
      <p className={isUp ? 'text-gain font-semibold' : 'text-loss font-semibold'}>
        {isUp ? '+' : ''}{pct.toFixed(2)}%
      </p>
      {/* Any extra lines injected by the caller */}
      {d.tooltipLines?.map((line, i) => (
        <p key={i} className="text-muted/70">{line}</p>
      ))}
    </div>
  )
}

// ── Cell ──────────────────────────────────────────────────────
function TreemapCell({ x, y, width, height, symbol, changePct, price,
                       clampRange, onCellClick }) {
  // Always render a rect to suppress Recharts' default cell rendering,
  // even for tiny cells — just fill with the background colour and no text.
  const bg      = changePctToColor(changePct, clampRange)
  const isUp    = (changePct ?? 0) >= 0
  const pctText = `${isUp ? '+' : ''}${(changePct ?? 0).toFixed(2)}%`

  const area       = width * height
  const symbolSize = Math.max(10, Math.min(17, Math.sqrt(area) / 5))
  const pctSize    = Math.max(8,  Math.min(13, symbolSize - 2))
  const showPct    = area > 1000 && width > 40 && height > 30
  const showPrice  = area > 5000

  // Unique clip-path id to prevent text overflowing into adjacent cells
  const clipId = `tc-${symbol}-${Math.round(x)}-${Math.round(y)}`

  return (
    <g onClick={() => onCellClick?.(symbol)} style={{ cursor: onCellClick ? 'pointer' : 'default' }}>
      <defs>
        <clipPath id={clipId}>
          <rect x={x+1} y={y+1} width={Math.max(0, width-2)} height={Math.max(0, height-2)} rx={4} />
        </clipPath>
      </defs>
      <rect x={x+1} y={y+1} width={Math.max(0, width-2)} height={Math.max(0, height-2)} fill={bg} rx={4} />
      <rect x={x+1} y={y+1} width={Math.max(0, width-2)} height={Math.max(0, height-2)}
            fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} rx={4} />
      {showPct && (
        <g clipPath={`url(#${clipId})`}>
          <text x={x + width/2} y={y + height/2 - pctSize * 0.6}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={symbolSize} fontWeight="700"
                fontFamily="ui-monospace, monospace" fill="rgba(255,255,255,0.93)">
            {symbol}
          </text>
          <text x={x + width/2} y={y + height/2 + symbolSize * 0.85}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={pctSize} fontWeight="600"
                fill={isUp ? 'rgba(120,255,150,0.92)' : 'rgba(255,110,110,0.92)'}>
            {pctText}
          </text>
          {showPrice && price != null && (
            <text x={x + width/2} y={y + height/2 + symbolSize * 0.85 + pctSize * 1.4}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={pctSize - 1} fill="rgba(255,255,255,0.40)">
              ${Number(price).toFixed(2)}
            </text>
          )}
        </g>
      )}
    </g>
  )
}

// ── Exported component ────────────────────────────────────────
export default function StockTreemap({
  data,
  height      = 200,
  clampRange  = [-5, 5],
  onCellClick,
  title,
  subtitle,
}) {
  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)),
    [data]
  )

  if (!sorted.length) return null

  const [lo, hi] = clampRange

  return (
    <div className="bg-surface-card border border-border rounded-xl p-4">
      {(title || subtitle) && (
        <div className="flex items-center justify-between mb-3">
          <div>
            {title    && <h2 className="text-primary text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="text-muted text-xs mt-0.5">{subtitle}</p>}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-1.5 text-[10px] text-muted">
            <span>{lo}%</span>
            <div className="h-2.5 w-20 rounded-full" style={{
              background: `linear-gradient(to right,
                ${changePctToColor(lo,  clampRange)},
                ${changePctToColor(0,   clampRange)},
                ${changePctToColor(hi,  clampRange)})`
            }} />
            <span>+{hi}%</span>
          </div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <Treemap
          data={sorted}
          dataKey="size"
          aspectRatio={4 / 3}
          isAnimationActive={false}
          content={(props) => {
            const sym = props.symbol ?? props.name
            // Recharts also calls content() for the invisible root/container node
            // which has no symbol — skip it to avoid phantom text in the SVG.
            if (!sym) return <g />
            return (
              <TreemapCell
                {...props}
                symbol={sym}
                changePct={props.changePct}
                price={props.price}
                clampRange={clampRange}
                onCellClick={onCellClick}
              />
            )
          }}
        >
          <Tooltip content={<TreemapTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  )
}
