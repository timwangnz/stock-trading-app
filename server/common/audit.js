/**
 * server/audit.js
 * Lightweight helper for writing to the audit_log table.
 *
 * Usage:
 *   import { log } from '../common/audit.js'
 *   await log(userId, 'buy', { symbol: 'AAPL', shares: 10, price: 180 }, req)
 *
 * Fire-and-forget: errors are swallowed so a logging failure never
 * breaks the actual request.
 */

import pool from '../common/db.js'

/**
 * @param {string}      userId  - The acting user's ID
 * @param {string}      action  - Short action key, e.g. 'login', 'buy', 'sell'
 * @param {object|null} details - JSON payload (action-specific data)
 * @param {object|null} req     - Express request (used to extract IP); optional
 */
export async function log(userId, action, details = null, req = null) {
  try {
    const ip = req
      ? (req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? null)
      : null

    await pool.query(
      `INSERT INTO audit_log (user_id, action, details, ip)
       VALUES ($1, $2, $3, $4)`,
      [userId, action, details ?? null, ip]
    )
  } catch (err) {
    // Never let audit failures surface to the caller
    console.error('[audit] Failed to write log entry:', err.message)
  }
}
