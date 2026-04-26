/**
 * server/financials.js
 * Proxy routes for Polygon.io financial statement data.
 *
 * Uses Polygon's /vX/reference/financials endpoint to pull:
 *   - Income statements
 *   - Balance sheets
 *   - Cash flow statements
 *
 * Key ratios (P/E, P/B, ROE, etc.) are computed server-side from the
 * raw financial figures and the latest snapshot price.
 *
 * Cached aggressively — financial statements only update quarterly.
 *
 * Mounted at /api/financials in server/index.js.
 *
 * Routes:
 *   GET /api/financials/:ticker?timeframe=annual|quarterly&limit=4
 */

import { Router } from 'express'
import { cacheGet, cacheSet, TTL } from './cache.js'
import { getAppSetting } from './appSettings.js'

const router = Router()
const BASE   = 'https://api.polygon.io'

const SYMBOL_RE = /^[A-Z0-9.]{1,10}$/
function validSymbol(s) { return SYMBOL_RE.test((s ?? '').toUpperCase()) }

async function polyFetch(path) {
  const key = await getAppSetting('polygon_api_key', 'POLYGON_API_KEY')
  if (!key) throw new Error('Polygon API key not configured — add it in Admin → App Settings')
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}${path}${sep}apiKey=${key}`)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Polygon ${res.status}: ${body}`)
  }
  return res.json()
}

// ── Helpers: safe value extraction ───────────────────────────────

function val(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k]?.value !== undefined) return obj[k].value
  }
  return null
}

function pct(numerator, denominator) {
  if (!numerator || !denominator || denominator === 0) return null
  return numerator / denominator
}

// ── Transform Polygon financial result into clean shape ───────────

function transformPeriod(raw, ticker) {
  const fin  = raw.financials ?? {}
  const inc  = fin.income_statement   ?? {}
  const bal  = fin.balance_sheet      ?? {}
  const cf   = fin.cash_flow_statement ?? {}

  const revenue          = val(inc, 'revenues')
  const grossProfit      = val(inc, 'gross_profit')
  const operatingIncome  = val(inc, 'operating_income_loss')
  const netIncome        = val(inc, 'net_income_loss')
  const ebitda           = val(inc, 'operating_income_loss') !== null
                            ? (val(inc, 'operating_income_loss') + Math.abs(val(cf, 'depreciation_and_amortization') ?? 0))
                            : null
  const eps              = val(inc, 'basic_earnings_per_share', 'diluted_earnings_per_share')
  const sharesOutstanding = val(inc, 'basic_average_shares', 'diluted_average_shares')

  const totalAssets       = val(bal, 'assets')
  const totalLiabilities  = val(bal, 'liabilities')
  const equity            = val(bal, 'equity')
  const cash              = val(bal, 'cash')
  const longTermDebt      = val(bal, 'long_term_debt')
  const currentAssets     = val(bal, 'current_assets')
  const currentLiabilities = val(bal, 'current_liabilities')

  const operatingCF       = val(cf, 'net_cash_flow_from_operating_activities')
  const investingCF       = val(cf, 'net_cash_flow_from_investing_activities')
  const financingCF       = val(cf, 'net_cash_flow_from_financing_activities')
  const capex             = val(cf, 'capital_expenditure')
  const freeCashFlow      = operatingCF !== null && capex !== null
                            ? operatingCF - Math.abs(capex)
                            : null

  // Computed ratios (price-dependent ratios are added by the route handler)
  const grossMargin       = pct(grossProfit, revenue)
  const operatingMargin   = pct(operatingIncome, revenue)
  const netMargin         = pct(netIncome, revenue)
  const roe               = pct(netIncome, equity)
  const roa               = pct(netIncome, totalAssets)
  const debtToEquity      = equity && longTermDebt !== null ? longTermDebt / equity : null
  const currentRatio      = currentAssets && currentLiabilities
                            ? currentAssets / currentLiabilities : null

  return {
    ticker,
    period:    raw.period_of_report_date ?? raw.end_date,
    startDate: raw.start_date,
    timeframe: raw.timeframe,
    fiscalPeriod: raw.fiscal_period,
    fiscalYear:   raw.fiscal_year,

    income_statement: {
      revenue,
      gross_profit:     grossProfit,
      operating_income: operatingIncome,
      net_income:       netIncome,
      ebitda,
      eps,
      shares_outstanding: sharesOutstanding,
    },

    balance_sheet: {
      total_assets:         totalAssets,
      total_liabilities:    totalLiabilities,
      equity,
      cash,
      long_term_debt:       longTermDebt,
      current_assets:       currentAssets,
      current_liabilities:  currentLiabilities,
    },

    cash_flow_statement: {
      operating_cash_flow: operatingCF,
      investing_cash_flow: investingCF,
      financing_cash_flow: financingCF,
      capital_expenditure: capex,
      free_cash_flow:      freeCashFlow,
    },

    ratios: {
      gross_margin:      grossMargin,
      operating_margin:  operatingMargin,
      net_margin:        netMargin,
      roe,
      roa,
      debt_to_equity:    debtToEquity,
      current_ratio:     currentRatio,
      // price-dependent ratios (pe_ratio, pb_ratio, ps_ratio, ev_ebitda)
      // are injected by the route handler after fetching latest price
      pe_ratio:  null,
      pb_ratio:  null,
      ps_ratio:  null,
      ev_ebitda: null,
    },
  }
}

// ── Route: GET /api/financials/:ticker ───────────────────────────

router.get('/:ticker', async (req, res) => {
  const ticker    = req.params.ticker.toUpperCase()
  const timeframe = ['annual', 'quarterly'].includes(req.query.timeframe)
                    ? req.query.timeframe : 'annual'
  const limit     = Math.min(parseInt(req.query.limit ?? '4', 10), 8)

  if (!validSymbol(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' })
  }

  const cacheKey = `financials:${ticker}:${timeframe}:${limit}`
  const cached   = cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    // Fetch financial statements + latest price snapshot in parallel
    const [finData, snapData] = await Promise.allSettled([
      polyFetch(
        `/vX/reference/financials?ticker=${ticker}&timeframe=${timeframe}` +
        `&limit=${limit}&sort=period_of_report_date&order=desc`
      ),
      polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`),
    ])

    if (finData.status === 'rejected') {
      return res.status(502).json({ error: finData.reason.message })
    }

    const rawPeriods = finData.value.results ?? []
    if (rawPeriods.length === 0) {
      return res.status(404).json({
        error: `No financial statements found for ${ticker}. ` +
               `This ticker may require a higher-tier Polygon plan.`
      })
    }

    // Latest close price (for price-based ratios)
    const latestPrice = snapData.status === 'fulfilled'
      ? (snapData.value.ticker?.day?.c ?? snapData.value.ticker?.prevDay?.c ?? null)
      : null

    // Transform each period
    const periods = rawPeriods.map(p => {
      const transformed = transformPeriod(p, ticker)

      // Inject price-dependent ratios using the most recent period only
      if (latestPrice && transformed.income_statement.eps) {
        transformed.ratios.pe_ratio = latestPrice / transformed.income_statement.eps
      }
      if (latestPrice && transformed.balance_sheet.equity && transformed.income_statement.shares_outstanding) {
        const bvps = transformed.balance_sheet.equity / transformed.income_statement.shares_outstanding
        transformed.ratios.pb_ratio = bvps > 0 ? latestPrice / bvps : null
      }
      if (latestPrice && transformed.income_statement.revenue && transformed.income_statement.shares_outstanding) {
        const sps = transformed.income_statement.revenue / transformed.income_statement.shares_outstanding
        transformed.ratios.ps_ratio = sps > 0 ? latestPrice / sps : null
      }
      if (transformed.income_statement.ebitda && transformed.balance_sheet.equity &&
          transformed.balance_sheet.long_term_debt !== null && transformed.balance_sheet.cash !== null) {
        const ev     = (latestPrice && transformed.income_statement.shares_outstanding
                        ? latestPrice * transformed.income_statement.shares_outstanding : 0)
                       + (transformed.balance_sheet.long_term_debt ?? 0)
                       - (transformed.balance_sheet.cash ?? 0)
        const ebitda = transformed.income_statement.ebitda
        transformed.ratios.ev_ebitda = ebitda > 0 ? ev / ebitda : null
      }

      return transformed
    })

    // Ticker details (company name etc.) — best effort
    let companyName = ticker
    try {
      const details = await polyFetch(`/v3/reference/tickers/${ticker}`)
      companyName = details.results?.name ?? ticker
    } catch (_) { /* ignore */ }

    const result = {
      ticker,
      company_name: companyName,
      latest_price: latestPrice,
      timeframe,
      periods,
    }

    cacheSet(cacheKey, result, TTL.FINANCIALS)
    res.json(result)

  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
