/**
 * server/promptRunner.js
 * Token parser and stateless prompt runner for the Prompt Manager.
 *
 * Template syntax:
 *   {{date}}              → today's date (YYYY-MM-DD)
 *   {{time}}              → current time in ET
 *   {{day}}               → day of the week
 *   {{user}}              → logged-in user's display name
 *   {{market_status}}     → "Open" | "Closed"
 *
 *   @portfolio            → current holdings + cash
 *   @watchlist            → watchlist symbols
 *   @market               → live snapshot of all portfolio + watchlist symbols
 *   @AAPL                 → live quote for a specific ticker
 *   @AAPL:financials      → annual financial statements
 *   @AAPL:financials:quarterly → quarterly financial statements
 *
 *   @mcp:server_name:tool_name → capability grant (tool made available to LLM)
 *   @email                     → native send_email capability backed by Resend
 */

import pool from './db.js'
import { callLLM } from './llm.js'
import { getToolsFromServer, callMCPTool } from './mcp.js'
import { sendPromptResultEmail } from './email.js'

// ── Helpers ───────────────────────────────────────────────────────

function fmtBig(n) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`
  return `$${Number(n).toFixed(0)}`
}

function isMarketOpen() {
  const now = new Date()
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()          // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false
  const mins = et.getHours() * 60 + et.getMinutes()
  return mins >= 9 * 60 + 30 && mins < 16 * 60
}

// ── Token constants ───────────────────────────────────────────────

export const KNOWN_BUILTINS = ['date', 'time', 'day', 'user', 'user_email', 'market_status']
export const KNOWN_KEYWORDS = ['portfolio', 'watchlist', 'market', 'email']

// Native capability tools (no MCP server required)
const NATIVE_TOOLS = {
  email: {
    name:        'send_email',
    description: 'Send an email to the user with the analysis results. Use this to deliver your findings.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Email subject line' },
        body:    { type: 'string', description: 'Email body — plain text, may include markdown-style formatting' },
      },
      required: ['subject', 'body'],
    },
  },
}

// Token regex — groups:
//  1: builtin name        {{date}}
//  2: mcp server slug     @mcp:server:tool  (spaces allowed via URL-encoded or quoted form)
//  3: mcp tool name
//  4: ticker (financials) @AAPL:financials[:quarterly]
//  5: financials timeframe
//  6: keyword             @portfolio | @watchlist | @market | @email
//  7: plain ticker        @AAPL
const TOKEN_RE = /\{\{(\w+)\}\}|@mcp:([a-zA-Z0-9_ .-]+):([a-zA-Z0-9_.-]+)|@([A-Z]{1,5}):financials(?::(quarterly|annual))?|@(portfolio|watchlist|market|email)\b|@([A-Z]{1,5})\b/g

// ── parseTokens ───────────────────────────────────────────────────

/**
 * Extract all unique tokens from a template string.
 * Returns an array of token descriptor objects.
 */
export function parseTokens(template) {
  const tokens = []
  const seen   = new Set()

  for (const m of template.matchAll(TOKEN_RE)) {
    const raw = m[0]
    if (seen.has(raw)) continue
    seen.add(raw)

    if (m[1])      tokens.push({ raw, type: 'builtin',    name: m[1] })
    else if (m[2]) tokens.push({ raw, type: 'mcp',        server: m[2], tool: m[3] })
    else if (m[4]) tokens.push({ raw, type: 'financials', ticker: m[4], timeframe: m[5] || 'annual' })
    else if (m[6]) tokens.push({ raw, type: 'keyword',    name: m[6] })
    else if (m[7]) tokens.push({ raw, type: 'ticker',     ticker: m[7] })
  }

  return tokens
}

// ── validateTokens ────────────────────────────────────────────────

/**
 * Validate tokens against known values and user's DB state.
 * Returns an array of error strings (empty array = valid).
 */
export async function validateTokens(tokens, userId) {
  const errors = []

  for (const t of tokens) {
    if (t.type === 'builtin' && !KNOWN_BUILTINS.includes(t.name)) {
      errors.push(`Unknown built-in: {{${t.name}}} — available: ${KNOWN_BUILTINS.map(b => `{{${b}}}`).join(', ')}`)
    }

    if (t.type === 'mcp') {
      try {
        const { rows } = await pool.query(
          `SELECT id FROM mcp_servers WHERE user_id=$1 AND name ILIKE $2 AND enabled=true`,
          [userId, t.server]
        )
        if (!rows.length) {
          errors.push(`MCP server not found or not enabled: "${t.server}" in ${t.raw}`)
        }
      } catch {
        errors.push(`Could not validate MCP server: ${t.server}`)
      }
    }
  }

  return errors
}

// ── resolveBuiltins ───────────────────────────────────────────────

function resolveBuiltins(userName, userEmail) {
  const now  = new Date()
  const pad  = n => String(n).padStart(2, '0')
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const etStr  = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
  const etDate = new Date(etStr)

  return {
    '{{date}}':          now.toISOString().slice(0, 10),
    '{{time}}':          `${pad(etDate.getHours())}:${pad(etDate.getMinutes())} ET`,
    '{{day}}':           DAYS[etDate.getDay()],
    '{{user}}':          userName  || 'User',
    '{{user_email}}':    userEmail || '',
    '{{market_status}}': isMarketOpen() ? 'Open' : 'Closed',
  }
}

// ── resolveDataTokens ─────────────────────────────────────────────

async function resolveDataTokens(tokens, userId, polyKey) {
  const resolutions = {}

  await Promise.allSettled(tokens.map(async t => {
    try {
      switch (t.type) {

        // ── @portfolio ──────────────────────────────────────────
        case 'keyword': {
          if (t.name === 'portfolio') {
            const { rows } = await pool.query(
              `SELECT p.symbol, p.shares, p.avg_cost, b.cash
               FROM portfolio p
               LEFT JOIN user_balances b ON b.user_id = p.user_id
               WHERE p.user_id = $1
               ORDER BY p.symbol`,
              [userId]
            )
            if (!rows.length) {
              resolutions[t.raw] = '[Portfolio: empty]'
              break
            }
            const lines = rows.map(r =>
              `  • ${r.symbol}: ${Number(r.shares).toFixed(4)} shares @ avg $${Number(r.avg_cost).toFixed(2)}`
            )
            if (rows[0]?.cash != null) {
              lines.push(`  • Cash: $${Number(rows[0].cash).toFixed(2)}`)
            }
            resolutions[t.raw] = `[Portfolio Holdings]\n${lines.join('\n')}`
          }

          // ── @watchlist ────────────────────────────────────────
          if (t.name === 'watchlist') {
            const { rows } = await pool.query(
              'SELECT symbol FROM watchlist WHERE user_id=$1 ORDER BY added_at',
              [userId]
            )
            resolutions[t.raw] = rows.length
              ? `[Watchlist]\n  ${rows.map(r => r.symbol).join(', ')}`
              : '[Watchlist: empty]'
          }

          // ── @market ───────────────────────────────────────────
          if (t.name === 'market') {
            if (!polyKey) {
              resolutions[t.raw] = '[Market snapshot: Polygon API key not configured]'
              break
            }
            const [{ rows: portRows }, { rows: wlRows }] = await Promise.all([
              pool.query('SELECT symbol FROM portfolio WHERE user_id=$1', [userId]),
              pool.query('SELECT symbol FROM watchlist WHERE user_id=$1', [userId]),
            ])
            const syms = [...new Set([
              ...portRows.map(r => r.symbol),
              ...wlRows.map(r => r.symbol),
            ])].slice(0, 50)

            if (!syms.length) {
              resolutions[t.raw] = '[Market snapshot: no symbols in portfolio or watchlist]'
              break
            }
            const res = await fetch(
              `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${syms.join(',')}&apiKey=${polyKey}`,
              { signal: AbortSignal.timeout(8000) }
            )
            if (!res.ok) { resolutions[t.raw] = '[Market snapshot: fetch failed]'; break }
            const data  = await res.json()
            const lines = (data.tickers ?? []).map(s => {
              const price = s.day?.c ?? s.prevDay?.c
              const chg   = s.todaysChangePerc
              return `  • ${s.ticker}: $${price?.toFixed(2) ?? '—'}` +
                (chg != null ? ` (${chg > 0 ? '+' : ''}${chg.toFixed(2)}%)` : '')
            })
            resolutions[t.raw] = lines.length
              ? `[Market Snapshot]\n${lines.join('\n')}`
              : '[Market snapshot: no data returned]'
          }
          break
        }

        // ── @TICKER (live quote) ──────────────────────────────
        case 'ticker': {
          if (!polyKey) {
            resolutions[t.raw] = `[${t.ticker}: API key not configured]`
            break
          }
          const res = await fetch(
            `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${t.ticker}?apiKey=${polyKey}`,
            { signal: AbortSignal.timeout(6000) }
          )
          if (!res.ok) { resolutions[t.raw] = `[${t.ticker}: not found]`; break }
          const data  = await res.json()
          const snap  = data.ticker
          const price = snap?.day?.c ?? snap?.prevDay?.c
          const chg   = snap?.todaysChangePerc
          resolutions[t.raw] = price != null
            ? `${t.ticker}: $${price.toFixed(2)}${chg != null ? ` (${chg > 0 ? '+' : ''}${chg.toFixed(2)}%)` : ''}`
            : `[${t.ticker}: no price data]`
          break
        }

        // ── @TICKER:financials[:quarterly] ────────────────────
        case 'financials': {
          if (!polyKey) {
            resolutions[t.raw] = `[${t.ticker} financials: API key not configured]`
            break
          }
          const res = await fetch(
            `https://api.polygon.io/vX/reference/financials?ticker=${t.ticker}&limit=4&timeframe=${t.timeframe}&apiKey=${polyKey}`,
            { signal: AbortSignal.timeout(10000) }
          )
          if (!res.ok) { resolutions[t.raw] = `[${t.ticker} financials: fetch failed]`; break }
          const data    = await res.json()
          const periods = data.results ?? []
          if (!periods.length) { resolutions[t.raw] = `[${t.ticker}: no financial data available]`; break }

          const lines = [`[${t.ticker} Financials — ${t.timeframe}]`]
          for (const period of periods.slice(0, 4)) {
            const fin   = period.financials ?? {}
            const label = period.fiscal_year
              ? `FY${period.fiscal_year}${period.fiscal_period ? ' ' + period.fiscal_period : ''}`
              : (period.end_date?.slice(0, 7) ?? '—')
            lines.push(`  ${label}:`)
            if (fin.income_statement) {
              const i = fin.income_statement
              lines.push(
                `    Revenue: ${fmtBig(i.revenues?.value)}` +
                `, Net Income: ${fmtBig(i.net_income_loss?.value)}` +
                `, EPS: ${i.basic_earnings_per_share?.value?.toFixed(2) ?? '—'}`
              )
            }
            if (fin.balance_sheet) {
              const b = fin.balance_sheet
              lines.push(
                `    Assets: ${fmtBig(b.assets?.value)}` +
                `, Liabilities: ${fmtBig(b.liabilities?.value)}` +
                `, Equity: ${fmtBig(b.equity?.value)}`
              )
            }
            if (fin.cash_flow_statement) {
              const c = fin.cash_flow_statement
              lines.push(
                `    Operating CF: ${fmtBig(c.net_cash_flow_from_operating_activities?.value)}` +
                `, Investing CF: ${fmtBig(c.net_cash_flow_from_investing_activities?.value)}`
              )
            }
          }
          resolutions[t.raw] = lines.join('\n')
          break
        }
      }
    } catch (err) {
      resolutions[t.raw] = `[Error resolving ${t.raw}: ${err.message}]`
    }
  }))

  return resolutions
}

// ── collectMCPGrants ──────────────────────────────────────────────

/**
 * Load tool definitions for @mcp tokens from the user's connected servers.
 * Returns an array of Anthropic-format tool objects (with _mcp* metadata attached).
 */
async function collectMCPGrants(mcpTokens, userId) {
  const tools = []

  for (const t of mcpTokens) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM mcp_servers WHERE user_id=$1 AND name ILIKE $2 AND enabled=true`,
        [userId, t.server]
      )
      if (!rows[0]) continue

      const serverTools = await getToolsFromServer(rows[0])
      // getToolsFromServer prefixes names: mcp_<slug>_<toolname>
      // Match by the original tool name suffix
      const match = serverTools.find(st =>
        st._mcpToolName === t.tool || st.name.endsWith(`_${t.tool}`)
      )
      if (match) tools.push(match)
    } catch (err) {
      console.warn(`[promptRunner] MCP grant failed for ${t.raw}:`, err.message)
    }
  }

  return tools
}

// ── substituteTokens ──────────────────────────────────────────────

function substituteTokens(template, resolutions) {
  let result = template
  // Replace longer tokens first to avoid partial matches
  for (const [raw, value] of Object.entries(resolutions).sort((a, b) => b[0].length - a[0].length)) {
    result = result.replaceAll(raw, value)
  }
  return result
}

// ── runPromptTemplate ─────────────────────────────────────────────

/**
 * Resolve all tokens in a template, then run a stateless LLM call.
 *
 * @param {object}  opts
 * @param {string}  opts.template   Raw prompt template
 * @param {string}  opts.userId     Auth user ID
 * @param {string}  opts.userName   Display name for {{user}}
 * @param {object}  opts.llmConfig  { provider, model, apiKey }
 * @param {number}  [opts.maxTools] Max tool-call iterations (default 5)
 *
 * @returns {{ text, tokensResolved, toolCallsMade, resolvedPrompt }}
 */
export async function runPromptTemplate({
  template,
  userId,
  userName,
  llmConfig,
  maxTools = 5,
}) {
  const polyKey = process.env.POLYGON_API_KEY

  // 1. Parse tokens
  const tokens       = parseTokens(template)
  const dataTokens   = tokens.filter(t => ['keyword', 'ticker', 'financials'].includes(t.type))
  const mcpTokens    = tokens.filter(t => t.type === 'mcp')
  const hasEmail     = tokens.some(t => t.type === 'keyword' && t.name === 'email')

  // 2. Fetch user email if needed (for {{user_email}} built-in or @email capability)
  let userEmail = ''
  if (hasEmail || tokens.some(t => t.type === 'builtin' && t.name === 'user_email')) {
    try {
      const { rows: [u] } = await pool.query('SELECT email FROM users WHERE id=$1', [userId])
      userEmail = u?.email ?? ''
    } catch { /* non-fatal */ }
  }

  // 3. Resolve data + built-ins + MCP grants in parallel
  const [builtinMap, dataMap, mcpTools] = await Promise.all([
    Promise.resolve(resolveBuiltins(userName, userEmail)),
    resolveDataTokens(dataTokens, userId, polyKey),
    collectMCPGrants(mcpTokens, userId),
  ])

  // 4. Build inline labels for @mcp and @email tokens
  const capabilityMap = {}
  for (const t of mcpTokens) {
    const found = mcpTools.find(mt => mt._mcpToolName === t.tool || mt.name.endsWith(`_${t.tool}`))
    capabilityMap[t.raw] = found
      ? `[Tool available: ${found.name}]`
      : `[Tool unavailable: ${t.raw}]`
  }
  if (hasEmail) {
    capabilityMap['@email'] = userEmail
      ? `[Email tool available — will send to ${userEmail}]`
      : `[Email tool available — send_email]`
  }

  // 5. Substitute all tokens into the template
  const allResolutions = { ...builtinMap, ...dataMap, ...capabilityMap }
  const resolvedPrompt = substituteTokens(template, allResolutions)

  // 6. Build tool schemas — MCP grants + native send_email if @email present
  const toolSchemas = [
    ...mcpTools.map(t => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.input_schema,
    })),
    ...(hasEmail ? [NATIVE_TOOLS.email] : []),
  ]

  // 7. Stateless LLM call
  const systemPrompt =
    'You are a financial analysis assistant. ' +
    'Answer the prompt thoroughly and concisely using the data provided. ' +
    'Do not make up numbers — rely only on the data included in the prompt.' +
    (hasEmail ? ' When finished, use the send_email tool to deliver your analysis.' : '')

  const tokensResolved = tokens
    .filter(t => t.type !== 'mcp')
    .map(t => t.raw)

  const toolCallsMade = []
  let userMessage = resolvedPrompt
  let finalText   = ''

  for (let i = 0; i <= maxTools; i++) {
    const response = await callLLM(llmConfig, {
      systemPrompt,
      userMessage,
      tools: toolSchemas.length > 0 ? toolSchemas : undefined,
    })

    if (!response.toolName) {
      finalText = response.text ?? ''
      break
    }

    toolCallsMade.push(response.toolName)

    let toolResult
    try {
      // Native send_email tool
      if (response.toolName === 'send_email') {
        const { subject, body } = response.toolInput ?? {}
        await sendPromptResultEmail({ to: userEmail, subject, body })
        toolResult = `Email sent to ${userEmail}`
      } else {
        // MCP tool
        const grantTool = mcpTools.find(mt => mt.name === response.toolName)
        if (!grantTool) {
          finalText = response.text ?? `[Tool not found: ${response.toolName}]`
          break
        }
        toolResult = await callMCPTool(
          { url: grantTool._mcpServerUrl, auth_header: grantTool._mcpAuthHeader },
          grantTool._mcpToolName,
          response.toolInput ?? {}
        )
      }
    } catch (err) {
      toolResult = `Error: ${err.message}`
    }

    userMessage = `${userMessage}\n\n[Tool result: ${response.toolName}]\n${toolResult}`
  }

  return {
    text:           finalText,
    tokensResolved,
    toolCallsMade,
    resolvedPrompt,
    emailedTo:      toolCallsMade.includes('send_email') ? userEmail : null,
  }
}
