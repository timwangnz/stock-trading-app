/**
 * server/index.js
 * Express REST API with Google OAuth + JWT auth + RBAC.
 *
 * Public:
 *   POST /api/auth/google
 *   POST /api/auth/signup
 *   POST /api/auth/login
 *   GET  /api/health
 *
 * Protected (any authenticated user):
 *   GET    /api/portfolio
 *   GET    /api/watchlist
 *
 * Protected (role >= user  — blocked for readonly):
 *   PUT    /api/portfolio/:symbol
 *   DELETE /api/portfolio/:symbol
 *   PUT    /api/watchlist/:symbol
 *   DELETE /api/watchlist/:symbol
 *
 * Admin only (role = admin):
 *   GET    /api/admin/users
 *   PUT    /api/admin/users/:id/role
 *   PUT    /api/admin/users/:id/disable
 *   GET    /api/admin/users/:id/portfolio
 *   GET    /api/admin/users/:id/watchlist
 */

import express        from 'express'
import cors           from 'cors'
import bcrypt         from 'bcryptjs'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import pool           from './db.js'
import { verifyGoogleToken, signJwt, authMiddleware } from './auth.js'
import { requireRole, requirePermission, PERMISSIONS } from './rbac.js'
import { runTradingAgent } from './agent.js'
import { log as audit } from './audit.js'
import marketRouter from './market.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app  = express()
// Cloud Run sets PORT automatically; fall back to 3001 for local dev
const PORT = process.env.PORT || process.env.API_PORT || 3001

// In production the frontend is built into /dist and served here.
// In dev, Vite's own dev server handles the frontend.
const isProd = process.env.NODE_ENV === 'production'

app.use(cors())
app.use(express.json())

// ── Serve React build (production only) ─────────────────────────
if (isProd) {
  const distDir = join(__dirname, '../dist')
  app.use(express.static(distDir))
}

// ── Health ──────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message })
  }
})

// ── Auth ────────────────────────────────────────────────────────
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body
  if (!idToken) return res.status(400).json({ error: 'idToken required' })

  try {
    const googleUser = await verifyGoogleToken(idToken)

    // Upsert user — create on first sign-in with 'user' role, update name/avatar on return visits
    await pool.query(
      `INSERT INTO users (id, email, name, avatar_url, role)
       VALUES (?, ?, ?, ?, 'user')
       ON DUPLICATE KEY UPDATE name = VALUES(name), avatar_url = VALUES(avatar_url)`,
      [googleUser.googleId, googleUser.email, googleUser.name, googleUser.avatar]
    )

    const [[user]] = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled
       FROM users WHERE id = ?`,
      [googleUser.googleId]
    )

    if (user.is_disabled) {
      return res.status(403).json({ error: 'Account disabled — contact an administrator' })
    }

    const token = signJwt(user)
    audit(user.id, 'login', { method: 'google' }, req)
    takeSnapshot(user.id).catch(() => {})   // fire-and-forget daily snapshot
    res.json({ token, user })
  } catch (err) {
    console.error('Auth error:', err.message)
    res.status(401).json({ error: 'Google sign-in failed: ' + err.message })
  }
})

// ── Email / Password sign-up ────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body

  if (!name?.trim())     return res.status(400).json({ error: 'Name is required' })
  if (!email?.trim())    return res.status(400).json({ error: 'Email is required' })
  if (!password)         return res.status(400).json({ error: 'Password is required' })
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' })

  try {
    // Check email isn't already taken
    const [[existing]] = await pool.query(
      'SELECT id FROM users WHERE email = ?', [email.toLowerCase()]
    )
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' })

    const id           = randomUUID()
    const password_hash = await bcrypt.hash(password, 12)

    // Explicitly assign 'user' role — grants full portfolio & watchlist access
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'user')`,
      [id, email.toLowerCase(), name.trim(), password_hash]
    )

    const [[user]] = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled FROM users WHERE id = ?`,
      [id]
    )

    const token = signJwt(user)
    audit(user.id, 'signup', { method: 'email' }, req)
    res.status(201).json({ token, user })
  } catch (err) {
    console.error('Signup error:', err.message)
    res.status(500).json({ error: 'Signup failed — please try again' })
  }
})

// ── Email / Password sign-in ────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' })

  try {
    const [[user]] = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled, password_hash
       FROM users WHERE email = ?`,
      [email.toLowerCase()]
    )

    if (!user || !user.password_hash) {
      // No account, or account uses Google sign-in only
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    if (user.is_disabled)
      return res.status(403).json({ error: 'Account disabled — contact an administrator' })

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) return res.status(401).json({ error: 'Invalid email or password' })

    // Don't send the hash to the client
    const { password_hash: _, ...safeUser } = user
    const token = signJwt(safeUser)
    audit(safeUser.id, 'login', { method: 'email' }, req)
    takeSnapshot(safeUser.id).catch(() => {})   // fire-and-forget daily snapshot
    res.json({ token, user: safeUser })
  } catch (err) {
    console.error('Login error:', err.message)
    res.status(500).json({ error: 'Login failed — please try again' })
  }
})

// ── Logout ──────────────────────────────────────────────────────
// Optional — client already clears the token. This just writes an audit entry.
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  audit(req.user.id, 'logout', null, req)
  res.json({ ok: true })
})

// ── Market data (Polygon proxy — no JWT needed, API key stays server-side) ──
app.use('/api/market', marketRouter)

// ── Internal / machine-to-machine routes (no JWT — own auth) ────
// Must be registered BEFORE app.use('/api', authMiddleware) so the
// global JWT check doesn't fire on them.

// POST /api/internal/snapshot-all — called by the daily scheduled task
// Protected by SNAPSHOT_SECRET header instead of a user JWT
app.post('/api/internal/snapshot-all', async (req, res) => {
  const secret = process.env.SNAPSHOT_SECRET
  if (!secret || req.headers['x-snapshot-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const [users] = await pool.query('SELECT id FROM users WHERE is_disabled = 0')
    const results = await Promise.allSettled(users.map(u => takeSnapshot(u.id)))
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed    = results.filter(r => r.status === 'rejected').length
    console.log(`[snapshot] Daily run — ${succeeded} ok, ${failed} failed`)
    res.json({ succeeded, failed, total: users.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── All routes below require a valid JWT ────────────────────────
app.use('/api', authMiddleware)

// ── Portfolio (read — any authenticated user) ───────────────────
app.get('/api/portfolio', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT symbol, shares, avg_cost AS avgCost
       FROM portfolio WHERE user_id = ? ORDER BY symbol`,
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Portfolio (write — blocked for readonly) ────────────────────
app.put('/api/portfolio/:symbol',
  requirePermission(PERMISSIONS.TRADE),
  async (req, res) => {
    const { symbol }          = req.params
    const { shares, avgCost } = req.body
    if (typeof shares !== 'number' || typeof avgCost !== 'number') {
      return res.status(400).json({ error: 'shares and avgCost must be numbers' })
    }
    try {
      // Check if this is an add or an update for accurate audit action
      const [[existing]] = await pool.query(
        'SELECT shares FROM portfolio WHERE user_id = ? AND symbol = ?',
        [req.user.id, symbol.toUpperCase()]
      )
      await pool.query(
        `INSERT INTO portfolio (user_id, symbol, shares, avg_cost)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE shares = VALUES(shares), avg_cost = VALUES(avg_cost)`,
        [req.user.id, symbol.toUpperCase(), shares, avgCost]
      )
      const action = existing ? 'buy' : 'add_holding'
      audit(req.user.id, action, { symbol: symbol.toUpperCase(), shares, avgCost }, req)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

app.delete('/api/portfolio/:symbol',
  requirePermission(PERMISSIONS.TRADE),
  async (req, res) => {
    const sym = req.params.symbol.toUpperCase()
    try {
      await pool.query(
        'DELETE FROM portfolio WHERE user_id = ? AND symbol = ?',
        [req.user.id, sym]
      )
      audit(req.user.id, 'remove_holding', { symbol: sym }, req)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// ── Watchlist (read) ────────────────────────────────────────────
app.get('/api/watchlist', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at',
      [req.user.id]
    )
    res.json(rows.map(r => r.symbol))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Watchlist (write — blocked for readonly) ────────────────────
app.put('/api/watchlist/:symbol',
  requirePermission(PERMISSIONS.WATCHLIST),
  async (req, res) => {
    const sym = req.params.symbol.toUpperCase()
    try {
      await pool.query(
        'INSERT IGNORE INTO watchlist (user_id, symbol) VALUES (?, ?)',
        [req.user.id, sym]
      )
      audit(req.user.id, 'add_watchlist', { symbol: sym }, req)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

app.delete('/api/watchlist/:symbol',
  requirePermission(PERMISSIONS.WATCHLIST),
  async (req, res) => {
    const sym = req.params.symbol.toUpperCase()
    try {
      await pool.query(
        'DELETE FROM watchlist WHERE user_id = ? AND symbol = ?',
        [req.user.id, sym]
      )
      audit(req.user.id, 'remove_watchlist', { symbol: sym }, req)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// ── Trading Agent ────────────────────────────────────────────────
app.post('/api/agent/trade',
  requirePermission(PERMISSIONS.TRADE),
  async (req, res) => {
    const { message, portfolio } = req.body
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' })
    try {
      const result = await runTradingAgent({
        userId:    req.user.id,
        message:   message.trim(),
        portfolio: portfolio ?? [],
      })
      if (result.trade) {
        audit(req.user.id, `agent_${result.trade.action}`, { ...result.trade, command: message.trim() }, req)
      }
      res.json(result)
    } catch (err) {
      console.error('Agent error:', err.message)
      res.status(500).json({ error: err.message })
    }
  }
)

// ── Admin endpoints ─────────────────────────────────────────────
const adminOnly = requireRole('admin')

// List all users
app.get('/api/admin/users', adminOnly, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled, created_at
       FROM users ORDER BY created_at DESC`
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update a user's role
app.put('/api/admin/users/:id/role', adminOnly, async (req, res) => {
  const { role } = req.body
  const validRoles = ['admin', 'premium', 'user', 'readonly']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
  }
  // Prevent admin from demoting themselves
  if (req.params.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: "You can't change your own role" })
  }
  try {
    const [[target]] = await pool.query('SELECT role FROM users WHERE id = ?', [req.params.id])
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id])
    audit(req.user.id, 'role_changed', { targetUserId: req.params.id, from: target?.role, to: role }, req)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Enable / disable an account
app.put('/api/admin/users/:id/disable', adminOnly, async (req, res) => {
  const { disabled } = req.body   // true = disable, false = enable
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't disable your own account" })
  }
  try {
    await pool.query(
      'UPDATE users SET is_disabled = ? WHERE id = ?',
      [disabled ? 1 : 0, req.params.id]
    )
    audit(req.user.id, disabled ? 'account_disabled' : 'account_enabled', { targetUserId: req.params.id }, req)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// View any user's portfolio
app.get('/api/admin/users/:id/portfolio', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT symbol, shares, avg_cost AS avgCost
       FROM portfolio WHERE user_id = ? ORDER BY symbol`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// View any user's watchlist
app.get('/api/admin/users/:id/watchlist', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at',
      [req.params.id]
    )
    res.json(rows.map(r => r.symbol))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Portfolio snapshots ──────────────────────────────────────────

/**
 * Core snapshot logic — shared by all snapshot endpoints.
 * Fetches live prices from Polygon, computes total_value = Σ(shares × price),
 * and upserts one row into portfolio_snapshots for today's date.
 */
async function takeSnapshot(userId) {
  const [holdings] = await pool.query(
    'SELECT symbol, shares FROM portfolio WHERE user_id = ?',
    [userId]
  )
  if (!holdings.length) return null

  const symbols = holdings.map(h => h.symbol).join(',')
  const apiKey  = process.env.POLYGON_API_KEY
  if (!apiKey) throw new Error('POLYGON_API_KEY not set')

  const res  = await fetch(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbols}&apiKey=${apiKey}`
  )
  const data = await res.json()
  const priceMap = {}
  for (const t of (data.tickers ?? [])) {
    priceMap[t.ticker] = t.day?.c ?? t.prevDay?.c ?? 0
  }

  let totalValue = 0
  const breakdown = {}
  for (const h of holdings) {
    const price = priceMap[h.symbol] ?? 0
    const value = parseFloat(h.shares) * price
    totalValue += value
    breakdown[h.symbol] = { shares: parseFloat(h.shares), price, value }
  }

  const today = new Date().toISOString().split('T')[0]
  await pool.query(
    `INSERT INTO portfolio_snapshots (user_id, date, total_value, breakdown)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE total_value = VALUES(total_value), breakdown = VALUES(breakdown)`,
    [userId, today, totalValue.toFixed(2), JSON.stringify(breakdown)]
  )
  return { date: today, total_value: totalValue, breakdown }
}

// POST /api/portfolio/snapshot — take today's snapshot (any logged-in user)
app.post('/api/portfolio/snapshot', async (req, res) => {
  try {
    const snap = await takeSnapshot(req.user.id)
    res.json(snap ?? { message: 'Portfolio empty — nothing to snapshot' })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// GET /api/portfolio/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/api/portfolio/snapshots', async (req, res) => {
  const from = req.query.from ?? '2000-01-01'
  const to   = req.query.to   ?? new Date().toISOString().split('T')[0]
  try {
    const [rows] = await pool.query(
      `SELECT date, total_value, breakdown
       FROM portfolio_snapshots
       WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date ASC`,
      [req.user.id, from, to]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/snapshot-all — snapshot every active user (admin only)
app.post('/api/admin/snapshot-all', adminOnly, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id FROM users WHERE is_disabled = 0')
    const results = await Promise.allSettled(users.map(u => takeSnapshot(u.id)))
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed    = results.filter(r => r.status === 'rejected').length
    audit(req.user.id, 'snapshot_all', { succeeded, failed }, req)
    res.json({ succeeded, failed, total: users.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Dashboard custom symbols ──────────────────────────────────────
// GET  /api/dashboard/symbols        → list user's pinned symbols
// POST /api/dashboard/symbols        → pin a symbol  { symbol }
// DELETE /api/dashboard/symbols/:sym → unpin a symbol

app.get('/api/dashboard/symbols', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT symbol FROM dashboard_symbols WHERE user_id = ? ORDER BY added_at ASC`,
      [req.user.id]
    )
    res.json(rows.map(r => r.symbol))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/dashboard/symbols', authMiddleware, async (req, res) => {
  const { symbol } = req.body
  if (!symbol) return res.status(400).json({ error: 'symbol required' })
  const sym = symbol.toUpperCase().trim()
  try {
    await pool.query(
      `INSERT IGNORE INTO dashboard_symbols (user_id, symbol) VALUES (?, ?)`,
      [req.user.id, sym]
    )
    audit(req.user.id, 'dashboard_pin', { symbol: sym }, req)
    res.json({ ok: true, symbol: sym })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/dashboard/symbols/:symbol', authMiddleware, async (req, res) => {
  const sym = req.params.symbol.toUpperCase()
  try {
    await pool.query(
      `DELETE FROM dashboard_symbols WHERE user_id = ? AND symbol = ?`,
      [req.user.id, sym]
    )
    audit(req.user.id, 'dashboard_unpin', { symbol: sym }, req)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Audit log ────────────────────────────────────────────────────
// Own activity (any authenticated user)
app.get('/api/audit', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? 50), 200)
  const offset = parseInt(req.query.offset ?? 0)
  try {
    const [rows] = await pool.query(
      `SELECT id, action, details, ip, created_at
       FROM audit_log WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// All users' activity (admin only)
app.get('/api/admin/audit', adminOnly, async (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit  ?? 100), 500)
  const offset   = parseInt(req.query.offset ?? 0)
  const userId   = req.query.userId   ?? null
  const action   = req.query.action   ?? null

  let where  = []
  let params = []
  if (userId) { where.push('a.user_id = ?'); params.push(userId) }
  if (action) { where.push('a.action  = ?'); params.push(action) }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.user_id, u.name AS user_name, u.email AS user_email,
              a.action, a.details, a.ip, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereClause}
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Catch-all: serve React app for any non-API route (production) ──
// Must come AFTER all /api/* routes so the API still works.
if (isProd) {
  const distDir = join(__dirname, '../dist')
  app.get('*', (_req, res) => {
    res.sendFile(join(distDir, 'index.html'))
  })
}

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ TradeBuddy API running on port ${PORT} (${isProd ? 'production' : 'development'})`)
})
