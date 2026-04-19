/**
 * server/agent.js
 * Trading agent powered by the user's chosen LLM provider.
 * Supports Anthropic (Claude), OpenAI (GPT), and Google (Gemini).
 * Tool definitions are kept in Anthropic format; llm.js converts them.
 */

import pool from './db.js'
import { callLLM } from './llm.js'

// ── Tool definitions (Anthropic format — llm.js converts for other providers) ──

const TOOLS = [
  {
    name: 'execute_buy',
    description: 'Buy (or add to) a stock position in the portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        symbol:    { type: 'string', description: 'Ticker symbol in uppercase, e.g. AAPL' },
        shares:    { type: 'number', description: 'Number of shares to buy (can be fractional)' },
        price:     { type: 'number', description: 'Price per share in USD' },
        reasoning: { type: 'string', description: 'One-sentence explanation shown to the user' },
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

// ── Trade execution helpers ──────────────────────────────────────

async function buyStock(userId, symbol, shares, price) {
  const sym = symbol.toUpperCase()
  const { rows: [existing] } = await pool.query(
    'SELECT shares, avg_cost FROM portfolio WHERE user_id = $1 AND symbol = $2',
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
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, symbol) DO UPDATE
       SET shares = EXCLUDED.shares, avg_cost = EXCLUDED.avg_cost`,
    [userId, sym, newShares, newAvgCost]
  )
  return { symbol: sym, shares: newShares, avgCost: newAvgCost }
}

async function sellStock(userId, symbol, shares) {
  const sym = symbol.toUpperCase()
  const { rows: [existing] } = await pool.query(
    'SELECT shares, avg_cost FROM portfolio WHERE user_id = $1 AND symbol = $2',
    [userId, sym]
  )
  if (!existing) throw new Error(`You don't hold any ${sym} to sell.`)
  if (shares > existing.shares)
    throw new Error(`You only hold ${existing.shares} shares of ${sym} — can't sell ${shares}.`)
  const remaining = parseFloat((existing.shares - shares).toFixed(6))
  if (remaining <= 0.000001) {
    await pool.query('DELETE FROM portfolio WHERE user_id = $1 AND symbol = $2', [userId, sym])
    return { symbol: sym, removed: true }
  }
  await pool.query(
    'UPDATE portfolio SET shares = $1 WHERE user_id = $2 AND symbol = $3',
    [remaining, userId, sym]
  )
  return { symbol: sym, shares: remaining, avgCost: existing.avg_cost }
}

async function removeStock(userId, symbol) {
  const sym = symbol.toUpperCase()
  await pool.query('DELETE FROM portfolio WHERE user_id = $1 AND symbol = $2', [userId, sym])
  return { symbol: sym, removed: true }
}

// ── Main agent entry point ───────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.message
 * @param {Array}  opts.portfolio
 * @param {object} opts.llmConfig   - { provider, model, apiKey }
 */
export async function runTradingAgent({ userId, message, portfolio, llmConfig = {} }) {
  const portfolioText = portfolio.length === 0
    ? 'The portfolio is currently empty.'
    : portfolio
        .map(h =>
          `  • ${h.symbol}: ${h.shares} shares, avg cost $${Number(h.avgCost).toFixed(2)}` +
          (h.value ? `, current value $${Number(h.value).toFixed(2)}` : '')
        )
        .join('\n')

  const systemPrompt = `You are a concise vibe-trading assistant for TradeBuddy.
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

  const { text, toolName, toolInput } = await callLLM(
    {
      provider: llmConfig.provider || 'anthropic',
      model:    llmConfig.model    || 'claude-haiku-4-5-20251001',
      apiKey:   llmConfig.apiKey   || null,
    },
    { systemPrompt, userMessage: message, tools: TOOLS }
  )

  if (!toolName) {
    return {
      response: text ?? "I'm not sure how to help with that. Try \"buy 10 AAPL at 180\" or \"sell half my TSLA\".",
      trade: null,
    }
  }

  try {
    if (toolName === 'execute_buy') {
      const { symbol, shares, price, reasoning } = toolInput
      const result = await buyStock(userId, symbol, shares, price)
      return {
        response: `Bought ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} at $${price.toFixed(2)}. ${reasoning}`,
        trade: { action: 'buy', ...result, price },
      }
    }
    if (toolName === 'execute_sell') {
      const { symbol, shares, reasoning } = toolInput
      const result = await sellStock(userId, symbol, shares)
      const msg = result.removed
        ? `Sold all ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol} — position closed. ${reasoning}`
        : `Sold ${shares} share${shares !== 1 ? 's' : ''} of ${result.symbol}. ${result.shares} remaining. ${reasoning}`
      return { response: msg, trade: { action: result.removed ? 'remove' : 'sell', ...result } }
    }
    if (toolName === 'remove_holding') {
      const { symbol, reasoning } = toolInput
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
