/**
 * server/errorLog.js
 * Persistent error logging to the `error_log` DB table.
 *
 * Unlike the in-memory SERVER_LOGS ring buffer (which resets on restart),
 * entries here survive deploys and are visible to admins at all times.
 *
 * Usage:
 *   import { logError } from './errorLog.js'
 *   logError('agent', 'Trade failed', { symbol: 'AAPL', reason: err.message }, userId)
 *
 * Fire-and-forget: errors are written to stderr only — never re-throws,
 * never calls console.error (to avoid infinite loops with the patch in index.js).
 *
 * Categories:
 *   agent      — trading agent execution failures
 *   snapshot   — portfolio snapshot failures
 *   scheduler  — background scheduler errors
 *   llm        — LLM API call failures
 *   polygon    — Polygon market data failures
 *   auth       — authentication / token errors
 *   db         — database query errors
 *   api        — general API route errors (uncaught 5xx)
 *   client     — errors reported by the browser
 *   system     — catch-all for everything else
 */

import pool from './db.js'

// Guard against writing while pool is still starting up
let _poolReady = false
setImmediate(() => { _poolReady = true })

/**
 * @param {string}       category  - One of the categories listed above
 * @param {string}       message   - Human-readable error summary
 * @param {object|null}  details   - Optional JSONB payload (stack, context, etc.)
 * @param {string|null}  userId    - Associated user ID if known
 */
export async function logError(category, message, details = null, userId = null) {
  if (!_poolReady) return   // too early — pool not initialised yet
  try {
    await pool.query(
      `INSERT INTO error_log (category, message, details, user_id)
       VALUES ($1, $2, $3, $4)`,
      [
        category,
        String(message).slice(0, 2000),
        details ?? null,
        userId ?? null,
      ]
    )
  } catch (err) {
    // Use stderr directly — never console.error (would cause a loop)
    process.stderr.write(`[errorLog] DB write failed: ${err.message}\n`)
  }
}
