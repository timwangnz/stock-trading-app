/**
 * server/agent.js
 * Trading agent powered by Claude via direct Anthropic REST API.
 * Uses tool_use so Claude can execute buy / sell / remove actions
 * against the live MySQL portfolio table.
 *
 * No SDK needed — Node 22 has built-in fetch.
 */

import pool from './db.js'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL             = 'claude-haiku-4-5-20251001'

// ── Tool definitions ─────────────────────────────────────────────

const TOOLS = [
  {
    name: 'execute_buy',
    description: 'Buy (or add to) a stock position in the portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:    { type: 'string',  description: 'Ticker symbol in uppercase, e.g. AAPL' },
        shares:    { type: 'number',  description: 'Number of shares to buy (can be fractional)' },
        price:     { type: 'number',  description: 'Price per share in USD' },
        reasoning: { type: 'string',  description: 'One-sentence explanation shown to the user' },
      },
      required: ['symbol', 'shares', 'price', 'reasoning'],
    },
  },
  {
    name: 'execute_sell',
    description: 'Sell a specific number of shares of a stock.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:    { type: 'string', description: 'Ticker symbol in uppercase' },
        shares:    { type: 'number', description: 'Number of shares to sell' },
        reasoning: { type: 'string', description: 'One-sentence explanation shown to the user' },
      },
      required: ['symbol', 'shares', 'reasoning'],
    },
  },
  {
    name: 'remove_holding',
    description: 'Remove an entire stock position (sell all shares) from the portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:    { type: 'string', description: 'Ticker symbol in uppercase' },
        reasoning: { type: 'string', description: 'One-sentence explanation shown to the user' },
      },
      required: ['symbol', 'reasoning'],
    },
  },
]

// ── Claude API call ──────────────────────────────────────────────

async function callClaude({ systemPrompt, userMessage }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    throw new Error('ANTHROPIC_API_KEY is not configured. Add it to your .env file.')
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 512,
      system:     systemPrompt,
      tools:      TOOLS,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${err}`)
  }

  return res.json()
}

// ── Trade execution helpers ──────────────────────────────────────

async function buyStock(userId, symbol, shares, price) {
  const sym = symbol.toUpperCase()

  const [[existing]] = await pool.query(
    'SELECT shares, avg_cost FROM portfolio WHERE user_id = ? AND symbol = ?',
    [userId, sym]
  )

  let newShares, newAvgCost
  if (existing) {
    newShares  = existing.shares + shares
    newAvgCost = ((existing.shares * existing.avg_cost) + (shares * price)) / newShares
  } else {
    newShares  = shares
    newAvgCost = price
  }

  await pool.query(
    `INSERT INTO portfolio (user_id, symbol, shares, avg_cost)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE shares = VALUES(shares), avg_cost = VALUES(avg_cost)`,
    [userId, sym, newShares, newAvgCost]
  )

  return { symbol: sym, shares: newShares, avgCost: newAvgCost }
}

async function sellStock(userId, symbol, shares) {
  const sym = symbol.toUpperCase()

  const [[existing]] = await pool.query(
    'SELECT shares, avg_cost FROM portfolio WHERE user_id = ? AND symbol = ?',
    [userId, sym]
  )

  if (!existing) {
    throw new Error(`You don't hold any ${sym} to sell.`)
  }
  if (shares > existing.shares) {
    throw new Error(`You only hold ${existing.shares} shares of ${sym} — can't sell ${shares}.`)
  }

  const remaining = parseFloat((existing.shares - shares).toFixed(6))
  if (remaining <= 0.000001) {
    await pool.query(
      'DELETE FROM portfolio WHERE user_id = ? AND symbol = ?',
      [userId, sym]
    )
    return { symbol: sym, removed: true }
  }

  await pool.query(
    'UPDATE portfolio SET shares = ? WHERE user_id = ? AND symbol = ?',
    [remaining, userId, sym]
  )
  return { symbol: sym, shares: remaining, avgCost: existing.avg_cost }
}

async function removeStock(userId, symbol) {
  const sym = symbol.toUpperCase()
  await pool.query(
    'DELETE FROM portfolio WHERE user_id = ? AND symbol = ?',
    [userId, sym]
  )
  return { symbol: sym, removed: true }
}

// ── Main agent entry point ───────────────────────────────────────

export async function runTradingAgent({ userId, message, portfolio }) {
  // Build a portfolio summary for Claude's context
  const portfolioText = portfolio.length === 0
    ? 'The portfolio is currently empty.'
    : portfolio
        .map(h =>
          `  • ${h.symbol}: ${h.shares} shares, avg cost $${Number(h.avgCost).toFixed(2)}` +
          (h.value ? `, current value $${Number(h.value).toFixed(2)}` : '')
        )
        .join('\n')

  const systemPrompt = `You are a concise paper-trading assistant for TradeBuddy.
Help the user manage their simulated portfolio using the tools provided.

Current portfolio:
${portfolioText}

Guidelines:
- Use execute_buy when the user wants to purchase shares
- Use execute_sell when the user wants to sell a specific number of shares
- Use remove_holding when the user says "remove", "close", "exit", or "sell all" a position
- "sell half" → calculate shares / 2 (round to 3 decimal places)
- If no price is given for a buy, make a reasonable estimate based on well-known stocks and note it in the reasoning
- Always use UPPERCASE ticker symbols
- For questions or analysis (no trade), respond conversationally with no tool call
- Keep text responses to 1-2 sentences`

  const claudeResponse = await callClaude({ systemPrompt, userMessage: message })

  // Check for a tool call
  const toolUse = claudeResponse.content.find(b => b.type === 'tool_use')

  if (!toolUse) {
    const text = claudeResponse.content.find(b => b.type === 'text')?.text
      ?? "I'm not sure how to help with that. Try something like \"buy 10 AAPL at 180\" or \"sell half my TSLA\"."
    return { response: text, trade: null }
  }

  const { name, input } = toolUse

  try {
    if (name === 'execute_buy') {
      const { symbol, shares, price, reasoning } = input
      const result = await buyStock(userId, symbol, shares, price)
      return {
        response: `Bought ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} at $${price.toFixed(2)}. ${reasoning}`,
        trade: { action: 'buy', ...result, price },
      }
    }

    if (name === 'execute_sell') {
      const { symbol, shares, reasoning } = input
      const result = await sellStock(userId, symbol, shares)
      const msg = result.removed
        ? `Sold all ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} — position closed. ${reasoning}`
        : `Sold ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol}. ${result.shares} shares remaining. ${reasoning}`
      return { response: msg, trade: { action: result.removed ? 'remove' : 'sell', ...result } }
    }

    if (name === 'remove_holding') {
      const { symbol, reasoning } = input
      const result = await removeStock(userId, symbol)
      return {
        response: `Removed ${result.symbol} from your portfolio. ${reasoning}`,
        trade: { action: 'remove', ...result },
      }
    }

    return { response: 'Unknown action — no trade executed.', trade: null }

  } catch (err) {
    return { response: err.message, trade: null }
  }
}
