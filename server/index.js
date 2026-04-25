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
import helmet         from 'helmet'
import rateLimit      from 'express-rate-limit'
import bcrypt         from 'bcryptjs'
import { randomUUID } from 'crypto'
import { encrypt, decrypt } from './crypto.js'
import { PROVIDERS } from './llm.js'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import pool           from './db.js'
import { verifyGoogleToken, exchangeGoogleCode, signJwt, authMiddleware } from './auth.js'
import { OAuth2Client } from 'google-auth-library'
import { requireRole, requirePermission, requireNonStudent, PERMISSIONS } from './rbac.js'
import { runTradingAgent } from './agent.js'
import { getToolsFromServer, testServer } from './mcp.js'
import { runPromptTemplate, validateTokens, parseTokens } from './promptRunner.js'
import { runRebalance, getAgentPortfolioState, runScheduledRebalances, calcNextRun } from './agentPortfolio.js'
import { log as audit } from './audit.js'
import { sendPasswordResetEmail, sendSnapshotFailureEmail } from './email.js'
import marketRouter                    from './market.js'
import financialsRouter                from './financials.js'
import { classRouter, leaderboardRouter, groupRouter } from './classes.js'
import { ideasRouter }                    from './ideas.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app  = express()
// Cloud Run sets PORT automatically; fall back to 3001 for local dev
const PORT = process.env.PORT || process.env.API_PORT || 3001

// ── Default dashboard symbols for new users ──────────────────────
const DEFAULT_DASHBOARD_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA']

async function addDefaultSymbols(userId) {
  // Initialise cash balance for new user
  await pool.query(
    'INSERT INTO user_balances (user_id, cash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, DEFAULT_CASH]
  )
  for (const sym of DEFAULT_DASHBOARD_SYMBOLS) {
    await pool.query(
      'INSERT INTO dashboard_symbols (user_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, sym]
    )
  }
}

// In production the frontend is built into /dist and served here.
// In dev, Vite's own dev server handles the frontend.
const isProd = process.env.NODE_ENV === 'production'

// Trust Railway's reverse proxy so rate limiting uses the real client IP
app.set('trust proxy', 1)

// ── Security headers ─────────────────────────────────────────────
// CSP disabled — Google Identity Services loads resources from
// accounts.google.com across many sub-paths that are hard to enumerate.
//
// crossOriginOpenerPolicy disabled — Helmet sets COOP: same-origin by
// default, which nulls out window.opener for cross-origin popups. This
// silently breaks Google's OAuth popup flow (the popup can't hand the
// token back). COOP must be off for any Google popup sign-in to work.
//
// Real security is enforced by JWT Bearer auth, rate limiting, and HTTPS.
// All other Helmet headers (HSTS, X-Content-Type-Options, etc.) remain on.
app.use(helmet({
  contentSecurityPolicy:    false,
  frameguard:               false,
  crossOriginOpenerPolicy:  false,
}))

// ── CORS ─────────────────────────────────────────────────────────
// The frontend and backend share the same origin in production so CORS
// headers aren't strictly required. We allow all origins and rely on
// JWT Bearer token auth (not cookies) as the real security layer —
// this makes us immune to CSRF by design.
app.use(cors())

// ── Body size limit ───────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }))

// ── In-memory server log buffer ──────────────────────────────────
// Keeps the last 500 entries (requests + errors) in a circular buffer.
// Resets on server restart — for persistent logs use a DB table.
const SERVER_LOGS   = []
const MAX_LOG_SIZE  = 500
let   _logIdCounter = 0

function addServerLog(entry) {
  SERVER_LOGS.unshift({ id: ++_logIdCounter, ts: new Date().toISOString(), ...entry })
  if (SERVER_LOGS.length > MAX_LOG_SIZE) SERVER_LOGS.length = MAX_LOG_SIZE
}

// Capture request / response pairs
app.use((req, res, next) => {
  const start = Date.now()
  // Skip static asset noise in the log
  const skip = ['.js', '.css', '.png', '.ico', '.svg', '.woff'].some(ext =>
    req.path.endsWith(ext)
  )
  res.on('finish', () => {
    if (skip) return
    addServerLog({
      type:   'request',
      method: req.method,
      path:   req.path,
      status: res.statusCode,
      ms:     Date.now() - start,
      ip:     req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? null,
    })
  })
  next()
})

// Patch console.error to also capture server-side errors
const _origConsoleError = console.error.bind(console)
console.error = (...args) => {
  _origConsoleError(...args)
  const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  addServerLog({ type: 'error', message: message.slice(0, 500) })
}

// ── Rate limiting ─────────────────────────────────────────────────
// Skipped entirely in development — all local requests share 127.0.0.1
// so limits would fire constantly during normal dev usage.
if (isProd) {
  // Auth endpoints: max 40 requests per 15 min per IP
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please try again later' },
  })

  // General API: max 1500 requests per 15 min per IP (100/min)
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please try again later' },
  })

  app.use('/api/auth', authLimiter)
  app.use('/api', apiLimiter)
}

// ── Serve React build (production only) ─────────────────────────
if (isProd) {
  const distDir = join(__dirname, '../dist')
  app.use(express.static(distDir))
}

// ── Health ──────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  // Basic liveness — always returns 200 so Railway's health check passes
  // even if the DB is momentarily unreachable.
  const dbUrl = process.env.DATABASE_URL
  res.json({ ok: true, db: dbUrl ? 'configured' : 'missing' })
})

// ── Google OAuth redirect flow ───────────────────────────────────
// Step 1 — redirect browser to Google's consent screen
app.get('/api/auth/google/redirect', (req, res) => {
  const clientId    = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.APP_URL + '/api/auth/google/callback'
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

// Step 2 — Google calls back with an auth code; exchange it for a JWT
app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query
  const appUrl   = process.env.APP_URL || ''

  if (!code) return res.redirect(`${appUrl}/?auth_error=missing_code`)

  try {
    const clientId     = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri  = appUrl + '/api/auth/google/callback'

    const client = new OAuth2Client(clientId, clientSecret, redirectUri)
    const { tokens } = await client.getToken(code)
    const ticket  = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId })
    const payload = ticket.getPayload()

    const googleUser = {
      googleId: payload.sub,
      email:    payload.email,
      name:     payload.name,
      avatar:   payload.picture,
    }

    const { rows: [upserted] } = await pool.query(
      `INSERT INTO users (id, email, name, avatar_url, role)
       VALUES ($1, $2, $3, $4, 'user')
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, (xmax = 0) AS is_new`,
      [googleUser.googleId, googleUser.email, googleUser.name, googleUser.avatar]
    )
    if (upserted.is_new) await addDefaultSymbols(upserted.id)

    const { rows: [user] } = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled FROM users WHERE id = $1`,
      [googleUser.googleId]
    )

    if (user.is_disabled) return res.redirect(`${appUrl}/?auth_error=disabled`)

    const token = signJwt(user)
    audit(user.id, 'login', { method: 'google_redirect' }, req)
    takeSnapshot(user.id).catch(() => {})

    // Pass JWT back to the SPA via URL fragment — never touches server logs
    res.redirect(`${appUrl}/?auth_token=${token}`)
  } catch (err) {
    console.error('Google callback error:', err.message)
    res.redirect(`${appUrl}/?auth_error=failed`)
  }
})

// ── Auth ────────────────────────────────────────────────────────
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body
  if (!idToken) return res.status(400).json({ error: 'idToken required' })

  try {
    const googleUser = await verifyGoogleToken(idToken)

    // Upsert user — create on first sign-in with 'user' role, update name/avatar on return visits.
    // (xmax = 0) is true when the row was freshly inserted (new user), false on update (returning user).
    const { rows: [upserted] } = await pool.query(
      `INSERT INTO users (id, email, name, avatar_url, role)
       VALUES ($1, $2, $3, $4, 'user')
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, (xmax = 0) AS is_new`,
      [googleUser.googleId, googleUser.email, googleUser.name, googleUser.avatar]
    )
    if (upserted.is_new) await addDefaultSymbols(upserted.id)

    const { rows: [user] } = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled
       FROM users WHERE id = $1`,
      [googleUser.googleId]
    )

    if (user.is_disabled) {
      return res.status(403).json({ error: 'Account disabled — contact an administrator' })
    }

    const token = signJwt(user)
    audit(user.id, 'login', { method: 'google' }, req)
    takeSnapshot(user.id).catch(() => {})        // fire-and-forget daily snapshot
    backfillSnapshots(user.id).catch(() => {})   // fill any gaps since last login
    res.json({ token, user })
  } catch (err) {
    console.error('Auth error:', err.message)
    res.status(401).json({ error: 'Google sign-in failed: ' + err.message })
  }
})

// ── Google access token sign-in (implicit popup flow) ────────────
// Receives an access_token from useGoogleLogin({ flow: 'implicit' }),
// verifies it by calling Google's userinfo endpoint, then signs in the user.
app.post('/api/auth/google-token', async (req, res) => {
  const { accessToken } = req.body
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' })

  try {
    // Verify access token and get user profile from Google
    const infoRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`
    )
    if (!infoRes.ok) return res.status(401).json({ error: 'Invalid Google access token' })
    const info = await infoRes.json()

    const googleUser = {
      googleId: info.sub,
      email:    info.email,
      name:     info.name,
      avatar:   info.picture,
    }

    const { rows: [upserted] } = await pool.query(
      `INSERT INTO users (id, email, name, avatar_url, role)
       VALUES ($1, $2, $3, $4, 'user')
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, (xmax = 0) AS is_new`,
      [googleUser.googleId, googleUser.email, googleUser.name, googleUser.avatar]
    )
    if (upserted.is_new) await addDefaultSymbols(upserted.id)

    const { rows: [user] } = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled
       FROM users WHERE id = $1`,
      [googleUser.googleId]
    )

    if (user.is_disabled) {
      return res.status(403).json({ error: 'Account disabled — contact an administrator' })
    }

    const token = signJwt(user)
    audit(user.id, 'login', { method: 'google' }, req)
    takeSnapshot(user.id).catch(() => {})        // fire-and-forget daily snapshot
    backfillSnapshots(user.id).catch(() => {})   // fill any gaps since last login
    res.json({ token, user })
  } catch (err) {
    console.error('Google token auth error:', err.message)
    res.status(401).json({ error: 'Google sign-in failed: ' + err.message })
  }
})

// ── Google OAuth code exchange (popup flow) ─────────────────────
// Receives an authorization code from useGoogleLogin({ flow: 'auth-code' }),
// exchanges it server-side for an ID token, then signs in the user.
app.post('/api/auth/google-code', async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'code required' })

  try {
    const googleUser = await exchangeGoogleCode(code)

    const { rows: [upserted] } = await pool.query(
      `INSERT INTO users (id, email, name, avatar_url, role)
       VALUES ($1, $2, $3, $4, 'user')
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, (xmax = 0) AS is_new`,
      [googleUser.googleId, googleUser.email, googleUser.name, googleUser.avatar]
    )
    if (upserted.is_new) await addDefaultSymbols(upserted.id)

    const { rows: [user] } = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled
       FROM users WHERE id = $1`,
      [googleUser.googleId]
    )

    if (user.is_disabled) {
      return res.status(403).json({ error: 'Account disabled — contact an administrator' })
    }

    const token = signJwt(user)
    audit(user.id, 'login', { method: 'google' }, req)
    takeSnapshot(user.id).catch(() => {})        // fire-and-forget daily snapshot
    backfillSnapshots(user.id).catch(() => {})   // fill any gaps since last login
    res.json({ token, user })
  } catch (err) {
    console.error('Google code exchange error:', err.message)
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
    const { rows: [existing] } = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
    )
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' })

    const id            = randomUUID()
    const password_hash = await bcrypt.hash(password, 12)

    // Explicitly assign 'user' role — grants full portfolio & watchlist access
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'user')`,
      [id, email.toLowerCase(), name.trim(), password_hash]
    )

    const { rows: [user] } = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled FROM users WHERE id = $1`,
      [id]
    )

    await addDefaultSymbols(user.id)
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
    const { rows: [user] } = await pool.query(
      `SELECT id, email, name, avatar_url AS avatar, role, is_disabled, password_hash
       FROM users WHERE email = $1`,
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
    takeSnapshot(safeUser.id).catch(() => {})        // fire-and-forget daily snapshot
    backfillSnapshots(safeUser.id).catch(() => {})   // fill any gaps since last login
    res.json({ token, user: safeUser })
  } catch (err) {
    console.error('Login error:', err.message)
    res.status(500).json({ error: 'Login failed — please try again' })
  }
})

// ── Forgot password ─────────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required' })

  // Always respond with success to prevent email enumeration
  res.json({ ok: true })

  try {
    const { rows: [user] } = await pool.query(
      `SELECT id, name, email, password_hash FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    )
    // Only send reset email for email/password accounts (not Google-only)
    if (!user || !user.password_hash) return

    const { randomBytes } = await import('crypto')
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Invalidate any previous unused tokens for this user
    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
      [user.id]
    )
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    )

    const appUrl   = process.env.APP_URL || 'http://localhost:5173'
    const resetUrl = `${appUrl}/?reset_token=${token}`
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl })
  } catch (err) {
    console.error('Forgot-password error:', err.message)
  }
})

// ── Reset password ──────────────────────────────────────────────
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token)    return res.status(400).json({ error: 'Reset token is required' })
  if (!password) return res.status(400).json({ error: 'New password is required' })
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' })

  try {
    const { rows: [row] } = await pool.query(
      `SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = $1`,
      [token]
    )
    if (!row)          return res.status(400).json({ error: 'Invalid or expired reset link' })
    if (row.used)      return res.status(400).json({ error: 'This reset link has already been used' })
    if (new Date() > new Date(row.expires_at))
      return res.status(400).json({ error: 'Reset link has expired — please request a new one' })

    const hash = await bcrypt.hash(password, 12)
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, row.user_id])
    await pool.query(`UPDATE password_reset_tokens SET used = true WHERE id = $1`, [row.id])

    res.json({ ok: true })
  } catch (err) {
    console.error('Reset-password error:', err.message)
    res.status(500).json({ error: 'Password reset failed — please try again' })
  }
})

// ── Logout ──────────────────────────────────────────────────────
// Optional — client already clears the token. This just writes an audit entry.
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  audit(req.user.id, 'logout', null, req)
  res.json({ ok: true })
})

// ── Market data (Polygon proxy — JWT required to prevent quota abuse) ────────
app.use('/api/market',       authMiddleware, marketRouter)

// ── Financial statements (Polygon proxy — JWT required) ──────────────────────
app.use('/api/financials',   authMiddleware, financialsRouter)

// ── Classroom, leaderboard, trading ideas ────────────────────────────────────
app.use('/api/classes',      authMiddleware, classRouter)
app.use('/api/groups',       authMiddleware, groupRouter)
app.use('/api/leaderboard',  authMiddleware, leaderboardRouter)
app.use('/api/ideas',        authMiddleware, ideasRouter)

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
    const { rows: users } = await pool.query('SELECT id FROM users WHERE is_disabled = false')
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
    const { rows } = await pool.query(
      `SELECT symbol, shares, avg_cost AS "avgCost"
       FROM portfolio WHERE user_id = $1 ORDER BY symbol`,
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Portfolio market trades (buy/sell at live price) ────────────
const SYMBOL_RE       = /^[A-Z0-9.]{1,10}$/
const DEFAULT_CASH    = 100_000   // starting cash for new users

/** Get user's cash balance, initialising to DEFAULT_CASH if first time. */
async function getCash(userId) {
  const { rows } = await pool.query(
    `INSERT INTO user_balances (user_id, cash)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING cash`,
    [userId, DEFAULT_CASH]
  )
  if (rows.length) return parseFloat(rows[0].cash)
  const { rows: [existing] } = await pool.query(
    'SELECT cash FROM user_balances WHERE user_id = $1', [userId]
  )
  return parseFloat(existing.cash)
}

/** Record a completed trade to the transactions table (fire-and-forget safe). */
async function recordTransaction(userId, symbol, side, shares, price, source = 'market') {
  try {
    await pool.query(
      `INSERT INTO transactions (user_id, symbol, side, shares, price, total, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, symbol.toUpperCase(), side, shares, price,
       (parseFloat(shares) * parseFloat(price)).toFixed(2), source]
    )
  } catch (err) {
    // Never let transaction recording break the trade itself
    console.warn('[transactions] Record failed:', err.message)
  }
}

/** Adjust cash balance by `delta` (positive = credit, negative = debit). */
async function adjustCash(userId, delta) {
  const { rows: [row] } = await pool.query(
    `UPDATE user_balances SET cash = cash + $1, updated_at = NOW()
     WHERE user_id = $2 RETURNING cash`,
    [delta, userId]
  )
  return parseFloat(row.cash)
}

async function fetchLivePrice(symbol) {
  const key = process.env.POLYGON_API_KEY
  if (!key) throw new Error('POLYGON_API_KEY not set')
  const res = await fetch(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbol}&apiKey=${key}`
  )
  if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`)
  const data = await res.json()
  const ticker = data.tickers?.[0]
  if (!ticker) throw new Error(`No price data for ${symbol}`)
  // Use day close, fall back to prev day close, then last trade price
  return ticker.day?.c || ticker.prevDay?.c || ticker.lastTrade?.p || null
}

// POST /api/portfolio/buy — buy at current market price (students)
app.post('/api/portfolio/buy', requirePermission(PERMISSIONS.TRADE), async (req, res) => {
  const sym    = (req.body.symbol || '').toUpperCase().trim()
  const shares = parseFloat(req.body.shares)
  if (!SYMBOL_RE.test(sym))         return res.status(400).json({ error: 'Invalid symbol' })
  if (isNaN(shares) || shares <= 0) return res.status(400).json({ error: 'Invalid shares' })

  try {
    const price = await fetchLivePrice(sym)
    if (!price) return res.status(502).json({ error: `Could not fetch live price for ${sym}` })

    const cost = shares * price
    const cash = await getCash(req.user.id)
    if (cash < cost) {
      return res.status(400).json({
        error: `Insufficient funds — need $${cost.toFixed(2)}, have $${cash.toFixed(2)}`,
      })
    }

    const { rows: [existing] } = await pool.query(
      'SELECT shares, avg_cost FROM portfolio WHERE user_id = $1 AND symbol = $2',
      [req.user.id, sym]
    )
    let newShares, newAvgCost
    if (existing) {
      newShares  = parseFloat(existing.shares) + shares
      newAvgCost = ((parseFloat(existing.shares) * parseFloat(existing.avg_cost)) + (shares * price)) / newShares
    } else {
      newShares  = shares
      newAvgCost = price
    }
    await pool.query(
      `INSERT INTO portfolio (user_id, symbol, shares, avg_cost)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, symbol) DO UPDATE
         SET shares = EXCLUDED.shares, avg_cost = EXCLUDED.avg_cost, updated_at = NOW()`,
      [req.user.id, sym, newShares, newAvgCost]
    )
    const newCash = await adjustCash(req.user.id, -cost)
    audit(req.user.id, 'buy', { symbol: sym, shares, avgCost: newAvgCost, price, cost }, req)
    recordTransaction(req.user.id, sym, 'buy', shares, price, 'market')
    res.json({ symbol: sym, shares: newShares, avgCost: newAvgCost, price, cash: newCash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/portfolio/sell — sell shares and credit cash
// Students: always uses live market price fetched server-side
// Teacher/admin: can pass optional { price } body param to sell at a manual price
app.post('/api/portfolio/sell', requirePermission(PERMISSIONS.TRADE), async (req, res) => {
  const sym    = (req.body.symbol || '').toUpperCase().trim()
  const shares = parseFloat(req.body.shares)
  if (!SYMBOL_RE.test(sym))         return res.status(400).json({ error: 'Invalid symbol' })
  if (isNaN(shares) || shares <= 0) return res.status(400).json({ error: 'Invalid shares' })

  // Only teacher/admin may set a manual sell price
  const canManualPrice = ['teacher', 'admin'].includes(req.user.role)
  const manualPrice    = req.body.price != null ? parseFloat(req.body.price) : null
  if (manualPrice !== null && !canManualPrice) {
    return res.status(403).json({ error: 'Only teachers and admins may set a manual sell price' })
  }

  try {
    // Resolve price: manual (teacher/admin) or live market (everyone else)
    let price
    if (manualPrice !== null && canManualPrice) {
      if (isNaN(manualPrice) || manualPrice < 0) return res.status(400).json({ error: 'Invalid price' })
      price = manualPrice
    } else {
      price = await fetchLivePrice(sym)
    }

    const { rows: [existing] } = await pool.query(
      'SELECT shares, avg_cost FROM portfolio WHERE user_id = $1 AND symbol = $2',
      [req.user.id, sym]
    )
    if (!existing) return res.status(400).json({ error: `You don't hold any ${sym}` })
    if (shares > parseFloat(existing.shares)) {
      return res.status(400).json({ error: `You only hold ${existing.shares} shares of ${sym}` })
    }
    const remaining = parseFloat((parseFloat(existing.shares) - shares).toFixed(6))
    if (remaining <= 0.000001) {
      await pool.query('DELETE FROM portfolio WHERE user_id = $1 AND symbol = $2', [req.user.id, sym])
    } else {
      await pool.query(
        'UPDATE portfolio SET shares = $1, updated_at = NOW() WHERE user_id = $2 AND symbol = $3',
        [remaining, req.user.id, sym]
      )
    }
    const proceeds = shares * (price ?? 0)
    const newCash  = await adjustCash(req.user.id, proceeds)
    const source   = canManualPrice ? 'manual' : 'market'
    audit(req.user.id, 'sell', { symbol: sym, shares, price: price ?? null, proceeds }, req)
    if (price) recordTransaction(req.user.id, sym, 'sell', shares, price, source)
    res.json({ symbol: sym, remaining, price, cash: newCash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/portfolio/cash — current cash balance
app.get('/api/portfolio/cash', async (req, res) => {
  try {
    const cash = await getCash(req.user.id)
    res.json({ cash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/portfolio/cash/add — non-student: manually adjust cash balance
// amount can be positive (add) or negative (deduct), floor enforced at $0
app.post('/api/portfolio/cash/add', requireNonStudent, async (req, res) => {
  const amount = parseFloat(req.body.amount)
  if (isNaN(amount) || amount === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero number' })
  }
  try {
    // Prevent cash from going below $0
    const current = await getCash(req.user.id)
    if (amount < 0 && current + amount < 0) {
      return res.status(400).json({ error: `Cannot deduct more than current balance ($${current.toFixed(2)})` })
    }
    const newCash = await adjustCash(req.user.id, amount)
    audit(req.user.id, 'add_cash', { amount, newCash }, req)
    res.json({ cash: newCash })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Portfolio (manual write — all non-students) ──────────────────
app.put('/api/portfolio/:symbol',
  requireNonStudent,
  async (req, res) => {
    const { symbol }          = req.params
    const { shares, avgCost } = req.body
    if (typeof shares !== 'number' || typeof avgCost !== 'number') {
      return res.status(400).json({ error: 'shares and avgCost must be numbers' })
    }
    try {
      // Check if this is an add or an update for accurate audit action
      const { rows: [existing] } = await pool.query(
        'SELECT shares FROM portfolio WHERE user_id = $1 AND symbol = $2',
        [req.user.id, symbol.toUpperCase()]
      )
      await pool.query(
        `INSERT INTO portfolio (user_id, symbol, shares, avg_cost)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, symbol) DO UPDATE
           SET shares = EXCLUDED.shares, avg_cost = EXCLUDED.avg_cost`,
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
        'DELETE FROM portfolio WHERE user_id = $1 AND symbol = $2',
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
    const { rows } = await pool.query(
      'SELECT symbol FROM watchlist WHERE user_id = $1 ORDER BY added_at',
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
        'INSERT INTO watchlist (user_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING',
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
        'DELETE FROM watchlist WHERE user_id = $1 AND symbol = $2',
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
      // Load the user's LLM settings — falls back to local Ollama if no cloud key is set
      const { rows: [settings] } = await pool.query(
        'SELECT provider, model, api_key_enc FROM user_llm_settings WHERE user_id = $1',
        [req.user.id]
      )
      const llmConfig = getLLMConfigForUser(settings ?? {})

      // Load enabled MCP servers and their tools for this user
      const { rows: mcpRows } = await pool.query(
        'SELECT * FROM mcp_servers WHERE user_id=$1 AND enabled=true', [req.user.id]
      )
      const mcpServers = await Promise.all(
        mcpRows.map(async s => ({ ...s, _tools: await getToolsFromServer(s) }))
      )

      // Load user's enabled agent context entries (instructions, ticker notes, MCP rules)
      const { rows: userContext } = await pool.query(
        `SELECT type, ticker, title, content
         FROM agent_context
         WHERE user_id=$1 AND enabled=true
         ORDER BY priority DESC, created_at ASC`,
        [req.user.id]
      )

      const result = await runTradingAgent({
        userId:      req.user.id,
        message:     message.trim(),
        portfolio:   portfolio ?? [],
        llmConfig,
        mcpServers,
        userContext,
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

// ── Agent Context (knowledge base entries injected into system prompt) ──
app.get('/api/agent-context', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, type, ticker, title, content, enabled, priority, created_at, updated_at
     FROM agent_context WHERE user_id=$1 ORDER BY priority DESC, created_at ASC`,
    [req.user.id]
  )
  res.json(rows)
})

app.post('/api/agent-context', authMiddleware, async (req, res) => {
  const { type = 'instruction', ticker, title, content, priority = 0 } = req.body
  if (!title?.trim())   return res.status(400).json({ error: 'title is required' })
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' })
  if (!['instruction', 'ticker_note', 'mcp_rule'].includes(type))
    return res.status(400).json({ error: 'invalid type' })

  const { rows: [row] } = await pool.query(
    `INSERT INTO agent_context (user_id, type, ticker, title, content, priority)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, type, ticker, title, content, enabled, priority, created_at, updated_at`,
    [req.user.id, type, ticker?.toUpperCase() || null, title.trim(), content.trim(), priority]
  )
  res.status(201).json(row)
})

app.patch('/api/agent-context/:id', authMiddleware, async (req, res) => {
  const { id } = req.params
  // Only allow updating fields the user controls
  const fields = ['title', 'content', 'ticker', 'enabled', 'priority']
  const sets   = []
  const vals   = []
  let   idx    = 1
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = $${idx++}`)
      vals.push(f === 'ticker' ? (req.body[f]?.toUpperCase() || null) : req.body[f])
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' })
  sets.push(`updated_at = NOW()`)
  vals.push(id, req.user.id)

  const { rows: [row] } = await pool.query(
    `UPDATE agent_context SET ${sets.join(', ')}
     WHERE id=$${idx++} AND user_id=$${idx}
     RETURNING id, type, ticker, title, content, enabled, priority, created_at, updated_at`,
    vals
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.delete('/api/agent-context/:id', authMiddleware, async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM agent_context WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// ── Saved Prompts ────────────────────────────────────────────────
// Prompts bundle a message + context_snap + datasets[].
// Each dataset entry is resolved at run time — portfolio from DB, market
// prices from Polygon, financials from Polygon, MCP tools via HTTP.
// Exported JSON is MCP-prompt compatible so any MCP client can replay it.

/** Small number formatter for server-side dataset blocks */
function fmtBig(n) {
  if (n == null) return '—'
  const abs = Math.abs(n), sign = n < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}$${(abs/1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${sign}$${(abs/1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${sign}$${(abs/1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${sign}$${(abs/1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(2)}`
}

/**
 * Resolve each dataset entry into a formatted text block.
 * Returns an array of strings that get joined and prepended to the system prompt.
 */
async function fetchDatasets(userId, datasets = []) {
  const polyKey = process.env.POLYGON_API_KEY
  const parts   = []

  for (const ds of datasets) {
    try {
      switch (ds.type) {

        case 'portfolio': {
          const { rows } = await pool.query(
            `SELECT p.symbol, p.shares, p.avg_cost, b.cash
             FROM portfolio p
             LEFT JOIN user_balances b ON b.user_id = p.user_id
             WHERE p.user_id = $1`,
            [userId]
          )
          if (rows.length > 0) {
            const lines = rows.map(r =>
              `  • ${r.symbol}: ${Number(r.shares).toFixed(4)} shares @ avg $${Number(r.avg_cost).toFixed(2)}`
            )
            if (rows[0]?.cash != null) lines.push(`  • Cash: $${Number(rows[0].cash).toFixed(2)}`)
            parts.push(`[Dataset: Portfolio Holdings]\n${lines.join('\n')}`)
          }
          break
        }

        case 'watchlist': {
          const { rows } = await pool.query(
            'SELECT symbol FROM watchlist WHERE user_id=$1 ORDER BY added_at',
            [userId]
          )
          if (rows.length > 0) {
            parts.push(`[Dataset: Watchlist]\n  ${rows.map(r => r.symbol).join(', ')}`)
          }
          break
        }

        case 'market_snapshot': {
          const tickers = (ds.tickers ?? []).filter(Boolean)
          if (!tickers.length || !polyKey) break
          const syms = tickers.join(',')
          const res  = await fetch(
            `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${syms}&apiKey=${polyKey}`,
            { signal: AbortSignal.timeout(8000) }
          )
          if (!res.ok) break
          const data  = await res.json()
          const lines = (data.tickers ?? []).map(t => {
            const price = t.day?.c ?? t.prevDay?.c
            const chg   = t.todaysChangePerc
            return `  • ${t.ticker}: $${price?.toFixed(2) ?? '—'}` +
              (chg != null ? ` (${chg > 0 ? '+' : ''}${chg.toFixed(2)}%)` : '')
          })
          if (lines.length) parts.push(`[Dataset: Live Market Snapshot]\n${lines.join('\n')}`)
          break
        }

        case 'financials': {
          const { ticker, statements = ['income'] } = ds
          if (!ticker || !polyKey) break
          const res = await fetch(
            `https://api.polygon.io/vX/reference/financials?ticker=${ticker}&limit=1&timeframe=annual&apiKey=${polyKey}`,
            { signal: AbortSignal.timeout(10000) }
          )
          if (!res.ok) break
          const data   = await res.json()
          const period = data.results?.[0]
          if (!period) break
          const fin  = period.financials ?? {}
          const year = period.fiscal_year ?? period.end_date?.slice(0, 4) ?? ''
          const lines = [`[Dataset: ${ticker} Financials ${year}]`]
          if (statements.includes('income') && fin.income_statement) {
            const i = fin.income_statement
            lines.push(`  Income — Revenue: ${fmtBig(i.revenues?.value)}, Net Income: ${fmtBig(i.net_income_loss?.value)}, EPS: ${i.basic_earnings_per_share?.value?.toFixed(2) ?? '—'}`)
          }
          if (statements.includes('balance') && fin.balance_sheet) {
            const b = fin.balance_sheet
            lines.push(`  Balance — Assets: ${fmtBig(b.assets?.value)}, Liabilities: ${fmtBig(b.liabilities?.value)}, Equity: ${fmtBig(b.equity?.value)}`)
          }
          if (statements.includes('cashflow') && fin.cash_flow_statement) {
            const c = fin.cash_flow_statement
            lines.push(`  Cash Flow — Operating: ${fmtBig(c.net_cash_flow_from_operating_activities?.value)}, Investing: ${fmtBig(c.net_cash_flow_from_investing_activities?.value)}`)
          }
          parts.push(lines.join('\n'))
          break
        }

        case 'mcp_tool': {
          const { server_id, tool_name, query, server_name } = ds
          if (!server_id || !tool_name) break
          const { rows: [server] } = await pool.query(
            'SELECT * FROM mcp_servers WHERE id=$1 AND user_id=$2',
            [server_id, userId]
          )
          if (!server) break
          const result = await callMCPTool(
            { url: server.url, auth_header: server.auth_header },
            tool_name,
            { query: query || '' }
          ).catch(e => `Error: ${e.message}`)
          if (result) parts.push(`[Dataset: ${server_name || tool_name} Results]\n${result}`)
          break
        }
      }
    } catch (err) {
      console.warn(`[datasets] Failed to resolve "${ds.type}":`, err.message)
    }
  }

  return parts.join('\n\n')
}

app.get('/api/saved-prompts', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, description, message, context_snap, datasets, run_count, created_at, updated_at
     FROM saved_prompts WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user.id]
  )
  res.json(rows)
})

app.post('/api/saved-prompts', authMiddleware, async (req, res) => {
  const { title, description, message, context_snap = [], datasets = [] } = req.body
  if (!title?.trim())   return res.status(400).json({ error: 'title is required' })
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' })
  const { rows: [row] } = await pool.query(
    `INSERT INTO saved_prompts (user_id, title, description, message, context_snap, datasets)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, title, description, message, context_snap, datasets, run_count, created_at, updated_at`,
    [req.user.id, title.trim(), description?.trim() || null, message.trim(), JSON.stringify(context_snap), JSON.stringify(datasets)]
  )
  res.status(201).json(row)
})

app.patch('/api/saved-prompts/:id', authMiddleware, async (req, res) => {
  const jsonFields = new Set(['context_snap', 'datasets'])
  const allowed    = ['title', 'description', 'message', 'context_snap', 'datasets']
  const sets = [], vals = []
  let idx = 1
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = $${idx++}`)
      vals.push(jsonFields.has(f) ? JSON.stringify(req.body[f]) : req.body[f])
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' })
  sets.push(`updated_at = NOW()`)
  vals.push(req.params.id, req.user.id)
  const { rows: [row] } = await pool.query(
    `UPDATE saved_prompts SET ${sets.join(', ')}
     WHERE id=$${idx++} AND user_id=$${idx}
     RETURNING id, title, description, message, context_snap, datasets, run_count, created_at, updated_at`,
    vals
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

app.delete('/api/saved-prompts/:id', authMiddleware, async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM saved_prompts WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// Run a saved prompt via the stateless token-based runner
app.post('/api/saved-prompts/:id/run',
  requirePermission(PERMISSIONS.TRADE),
  async (req, res) => {
    try {
      const { rows: [prompt] } = await pool.query(
        'SELECT * FROM saved_prompts WHERE id=$1 AND user_id=$2',
        [req.params.id, req.user.id]
      )
      if (!prompt) return res.status(404).json({ error: 'Prompt not found' })

      const { rows: [settings] } = await pool.query(
        'SELECT provider, model, api_key_enc FROM user_llm_settings WHERE user_id=$1',
        [req.user.id]
      )
      const llmConfig = getLLMConfigForUser(settings ?? {})

      const result = await runPromptTemplate({
        template:  prompt.message,
        userId:    req.user.id,
        userName:  req.user.name,
        llmConfig,
      })

      pool.query('UPDATE saved_prompts SET run_count = run_count + 1 WHERE id=$1', [prompt.id])
      res.json({ ...result, prompt_title: prompt.title })
    } catch (err) {
      console.error('[saved-prompts/run]', err.message)
      res.status(500).json({ error: err.message })
    }
  }
)

// Ad-hoc stateless prompt run (no saved prompt required)
app.post('/api/prompts/run',
  requirePermission(PERMISSIONS.TRADE),
  async (req, res) => {
    const { template } = req.body
    if (!template?.trim()) return res.status(400).json({ error: 'template is required' })

    try {
      const { rows: [settings] } = await pool.query(
        'SELECT provider, model, api_key_enc FROM user_llm_settings WHERE user_id=$1',
        [req.user.id]
      )
      const llmConfig = getLLMConfigForUser(settings ?? {})

      const result = await runPromptTemplate({
        template: template.trim(),
        userId:   req.user.id,
        userName: req.user.name,
        llmConfig,
      })

      res.json(result)
    } catch (err) {
      console.error('[prompts/run]', err.message)
      res.status(500).json({ error: err.message })
    }
  }
)

// Validate tokens in a template (used on save)
app.post('/api/prompts/validate',
  authMiddleware,
  async (req, res) => {
    const { template } = req.body
    if (!template) return res.json({ errors: [] })
    try {
      const tokens = parseTokens(template)
      const errors = await validateTokens(tokens, req.user.id)
      res.json({ errors, tokenCount: tokens.length })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// ── MCP Servers ──────────────────────────────────────────────────
app.get('/api/mcp-servers', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, url, auth_header, enabled, created_at FROM mcp_servers WHERE user_id=$1 ORDER BY created_at',
    [req.user.id]
  )
  // Mask auth header value in response
  res.json(rows.map(r => ({ ...r, auth_header: r.auth_header ? '••••••••' : null })))
})

app.post('/api/mcp-servers', authMiddleware, async (req, res) => {
  const { name, url, authHeader } = req.body
  if (!name?.trim() || !url?.trim()) return res.status(400).json({ error: 'name and url are required' })
  try {
    new URL(url)  // validate URL
  } catch { return res.status(400).json({ error: 'Invalid URL' }) }
  const { rows: [row] } = await pool.query(
    `INSERT INTO mcp_servers (user_id, name, url, auth_header)
     VALUES ($1,$2,$3,$4) RETURNING id, name, url, enabled, created_at`,
    [req.user.id, name.trim(), url.trim(), authHeader?.trim() || null]
  )
  res.json(row)
})

app.patch('/api/mcp-servers/:id', authMiddleware, async (req, res) => {
  const { name, url, authHeader, enabled } = req.body
  const updates = []; const vals = []
  if (name?.trim())          { updates.push(`name=$${vals.push(name.trim())}`) }
  if (url?.trim())           { updates.push(`url=$${vals.push(url.trim())}`) }
  if (authHeader !== undefined) { updates.push(`auth_header=$${vals.push(authHeader?.trim() || null)}`) }
  if (enabled !== undefined) { updates.push(`enabled=$${vals.push(enabled)}`) }
  if (!updates.length)       return res.status(400).json({ error: 'Nothing to update' })
  updates.push('updated_at=NOW()')
  vals.push(req.user.id, req.params.id)
  await pool.query(
    `UPDATE mcp_servers SET ${updates.join(',')} WHERE user_id=$${vals.length - 1} AND id=$${vals.length}`,
    vals
  )
  res.json({ ok: true })
})

app.delete('/api/mcp-servers/:id', authMiddleware, async (req, res) => {
  await pool.query('DELETE FROM mcp_servers WHERE user_id=$1 AND id=$2', [req.user.id, req.params.id])
  res.json({ ok: true })
})

app.get('/api/mcp-servers/:id/test', authMiddleware, async (req, res) => {
  const { rows: [server] } = await pool.query(
    'SELECT * FROM mcp_servers WHERE user_id=$1 AND id=$2', [req.user.id, req.params.id]
  )
  if (!server) return res.status(404).json({ error: 'Server not found' })
  const result = await testServer(server)
  res.json(result)
})

// ── LLM settings ────────────────────────────────────────────────
// GET — return current config (never expose the raw API key)
app.get('/api/settings/llm', authMiddleware, async (req, res) => {
  const { rows: [settings] } = await pool.query(
    'SELECT provider, model, api_key_enc FROM user_llm_settings WHERE user_id = $1',
    [req.user.id]
  )
  res.json({
    provider:  settings?.provider  || 'anthropic',
    model:     settings?.model     || 'claude-haiku-4-5-20251001',
    hasApiKey: !!settings?.api_key_enc,
    providers: PROVIDERS,
  })
})

// PUT — save provider, model, and optionally a new API key
app.put('/api/settings/llm', authMiddleware, async (req, res) => {
  const { provider, model, apiKey } = req.body
  if (!provider || !model) return res.status(400).json({ error: 'provider and model are required' })
  if (!PROVIDERS[provider]) return res.status(400).json({ error: 'Invalid provider' })
  if (!PROVIDERS[provider].models.find(m => m.id === model))
    return res.status(400).json({ error: 'Invalid model for provider' })

  try {
    // If apiKey is an empty string, keep existing key; if provided, encrypt new one
    let apiKeyUpdate = ''
    if (apiKey && apiKey.trim()) {
      const enc = encrypt(apiKey.trim())
      apiKeyUpdate = ', api_key_enc = $3'
    }

    if (apiKey && apiKey.trim()) {
      const enc = encrypt(apiKey.trim())
      await pool.query(
        `INSERT INTO user_llm_settings (user_id, provider, model, api_key_enc, updated_at)
         VALUES ($1, $2, $4, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET provider = EXCLUDED.provider, model = EXCLUDED.model,
               api_key_enc = EXCLUDED.api_key_enc, updated_at = NOW()`,
        [req.user.id, provider, enc, model]
      )
    } else {
      await pool.query(
        `INSERT INTO user_llm_settings (user_id, provider, model, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET provider = EXCLUDED.provider, model = EXCLUDED.model, updated_at = NOW()`,
        [req.user.id, provider, model]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('LLM settings error:', err.message)
    res.status(500).json({ error: 'Failed to save settings' })
  }
})

// ── Admin endpoints ─────────────────────────────────────────────
const adminOnly = requireRole('admin')

// GET /api/admin/server-logs — live in-memory request + error log
app.get('/api/admin/server-logs', adminOnly, (req, res) => {
  const { type, status, limit = 200 } = req.query
  let entries = [...SERVER_LOGS]
  if (type)   entries = entries.filter(e => e.type   === type)
  if (status) entries = entries.filter(e => {
    if (status === '2xx') return e.status >= 200 && e.status < 300
    if (status === '3xx') return e.status >= 300 && e.status < 400
    if (status === '4xx') return e.status >= 400 && e.status < 500
    if (status === '5xx') return e.status >= 500
    return true
  })
  res.json(entries.slice(0, parseInt(limit)))
})

// List all users
app.get('/api/admin/users', adminOnly, async (_req, res) => {
  try {
    const { rows } = await pool.query(
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
  const validRoles = ['admin', 'teacher', 'premium', 'user', 'readonly']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
  }
  // Prevent admin from demoting themselves
  if (req.params.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: "You can't change your own role" })
  }
  try {
    const { rows: [target] } = await pool.query(
      'SELECT role FROM users WHERE id = $1', [req.params.id]
    )
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id])
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
      'UPDATE users SET is_disabled = $1 WHERE id = $2',
      [disabled, req.params.id]
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
    const { rows } = await pool.query(
      `SELECT symbol, shares, avg_cost AS "avgCost"
       FROM portfolio WHERE user_id = $1 ORDER BY symbol`,
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
    const { rows } = await pool.query(
      'SELECT symbol FROM watchlist WHERE user_id = $1 ORDER BY added_at',
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
  const [{ rows: holdings }, { rows: [cashRow] }] = await Promise.all([
    pool.query('SELECT symbol, shares FROM portfolio WHERE user_id = $1', [userId]),
    pool.query('SELECT cash FROM user_balances WHERE user_id = $1', [userId]),
  ])

  const cashBalance = parseFloat(cashRow?.cash ?? 0)

  // Need at least some holdings to fetch prices — but if user only has cash
  // (no stocks yet), still snapshot the cash balance.
  if (!holdings.length) {
    if (cashBalance <= 0) return null
    const today = new Date().toISOString().split('T')[0]
    await pool.query(
      `INSERT INTO portfolio_snapshots (user_id, date, total_value, breakdown)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, date) DO UPDATE
         SET total_value = EXCLUDED.total_value,
             breakdown   = EXCLUDED.breakdown`,
      [userId, today, cashBalance.toFixed(2), { CASH: { value: cashBalance } }]
    )
    return { date: today, total_value: cashBalance, breakdown: { CASH: { value: cashBalance } } }
  }

  const symbols = holdings.map(h => h.symbol).join(',')
  const apiKey  = process.env.POLYGON_API_KEY
  if (!apiKey) throw new Error('POLYGON_API_KEY not set')

  const res  = await fetch(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbols}&apiKey=${apiKey}`
  )
  const data = await res.json()
  const priceMap = {}
  for (const t of (data.tickers ?? [])) {
    const price = t.day?.c ?? t.prevDay?.c ?? 0
    if (price > 0) priceMap[t.ticker] = price
  }

  // If Polygon returned no prices at all (weekend / market holiday / API error),
  // skip the snapshot rather than writing a $0 record that corrupts history.
  if (Object.keys(priceMap).length === 0) {
    console.log(`[snapshot] No price data from Polygon (market closed?) — skipping snapshot for user ${userId}`)
    return null
  }

  let holdingsValue = 0
  const breakdown = {}
  for (const h of holdings) {
    const price = priceMap[h.symbol] ?? 0
    const value = parseFloat(h.shares) * price
    holdingsValue += value
    breakdown[h.symbol] = { shares: parseFloat(h.shares), price, value }
  }

  // Include cash so total_value = cash + stocks (matches the Portfolio page display)
  if (cashBalance > 0) breakdown.CASH = { value: cashBalance }
  const totalValue = holdingsValue + cashBalance

  const today = new Date().toISOString().split('T')[0]
  await pool.query(
    `INSERT INTO portfolio_snapshots (user_id, date, total_value, breakdown)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, date) DO UPDATE
       SET total_value = EXCLUDED.total_value,
           breakdown   = EXCLUDED.breakdown`,
    [userId, today, totalValue.toFixed(2), breakdown]
  )
  return { date: today, total_value: totalValue, breakdown }
}

/**
 * backfillSnapshots(userId)
 * Called fire-and-forget on every login.
 *
 * Finds the user's latest snapshot date, then fetches actual historical
 * closing prices from Polygon for every missing trading day up to yesterday,
 * and inserts retroactive snapshots so the history chart stays accurate
 * even when the user hasn't logged in for a while.
 *
 * Uses DO NOTHING so existing snapshots are never overwritten.
 */
async function backfillSnapshots(userId) {
  try {
    const apiKey = process.env.POLYGON_API_KEY
    if (!apiKey) return

    const { rows: holdings } = await pool.query(
      'SELECT symbol, shares FROM portfolio WHERE user_id = $1',
      [userId]
    )
    if (!holdings.length) return

    // Find the most recent snapshot date
    const { rows: latest } = await pool.query(
      'SELECT MAX(date) AS latest FROM portfolio_snapshots WHERE user_id = $1',
      [userId]
    )
    const latestDate = latest[0]?.latest   // null if no snapshots yet
    if (!latestDate) return               // nothing to backfill from

    // Yesterday in YYYY-MM-DD (we don't backfill today — takeSnapshot handles that)
    const yesterday = new Date(Date.now() - 864e5).toISOString().split('T')[0]
    if (latestDate >= yesterday) return   // already up to date

    // Use SPY aggregates to get the exact list of trading days in the gap
    const spyRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${latestDate}/${yesterday}` +
      `?adjusted=true&sort=asc&limit=365&apiKey=${apiKey}`
    )
    const spyData = await spyRes.json()
    const missingDays = (spyData.results ?? [])
      .map(r => new Date(r.t).toISOString().split('T')[0])
      .filter(d => d > latestDate)        // exclude the latestDate itself

    if (!missingDays.length) return

    // Fetch historical closes for each holding symbol
    const symbols = holdings.map(h => h.symbol)
    const pricesByDate = {}              // { 'YYYY-MM-DD': { SYMBOL: closePrice } }

    for (const symbol of symbols) {
      const r = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${latestDate}/${yesterday}` +
        `?adjusted=true&sort=asc&limit=365&apiKey=${apiKey}`
      )
      const d = await r.json()
      for (const bar of (d.results ?? [])) {
        const date = new Date(bar.t).toISOString().split('T')[0]
        if (!pricesByDate[date]) pricesByDate[date] = {}
        pricesByDate[date][symbol] = bar.c
      }
    }

    // Insert a snapshot for each missing trading day
    let filled = 0
    for (const date of missingDays) {
      const prices = pricesByDate[date]
      if (!prices) continue

      let totalValue = 0
      const breakdown = {}
      for (const h of holdings) {
        const price = prices[h.symbol] ?? 0
        const value = parseFloat(h.shares) * price
        totalValue += value
        breakdown[h.symbol] = { shares: parseFloat(h.shares), price, value }
      }
      if (totalValue === 0) continue      // no price data for this day

      await pool.query(
        `INSERT INTO portfolio_snapshots (user_id, date, total_value, breakdown)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, date) DO NOTHING`,
        [userId, date, totalValue.toFixed(2), breakdown]
      )
      filled++
    }

    if (filled > 0) {
      console.log(`[backfill] Filled ${filled} missing day(s) for user ${userId}`)
    }
  } catch (err) {
    // backfill is best-effort — never let it crash login
    console.warn('[backfill] Error:', err.message)
  }
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
    const { rows } = await pool.query(
      `SELECT date, total_value, breakdown
       FROM portfolio_snapshots
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
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
    const { rows: users } = await pool.query('SELECT id FROM users WHERE is_disabled = false')
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
    const { rows } = await pool.query(
      `SELECT symbol FROM dashboard_symbols WHERE user_id = $1 ORDER BY added_at ASC`,
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
      `INSERT INTO dashboard_symbols (user_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
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
      `DELETE FROM dashboard_symbols WHERE user_id = $1 AND symbol = $2`,
      [req.user.id, sym]
    )
    audit(req.user.id, 'dashboard_unpin', { symbol: sym }, req)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Transactions ─────────────────────────────────────────────────
// GET /api/transactions — user's own trade history
app.get('/api/transactions', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? 100), 500)
  const offset = parseInt(req.query.offset ?? 0)
  const symbol = req.query.symbol?.toUpperCase() ?? null
  try {
    const params = [req.user.id]
    const extra  = symbol ? ` AND symbol = $${params.push(symbol)}` : ''
    const { rows } = await pool.query(
      `SELECT id, symbol, side, shares, price, total, source, executed_at
       FROM transactions
       WHERE user_id = $1${extra}
       ORDER BY executed_at DESC
       LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params
    )
    res.json(rows)
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
    const { rows } = await pool.query(
      `SELECT id, action, details, ip, created_at
       FROM audit_log WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// All users' activity (admin only)
app.get('/api/admin/audit', adminOnly, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? 100), 500)
  const offset = parseInt(req.query.offset ?? 0)
  const userId = req.query.userId ?? null
  const action = req.query.action ?? null

  // Build dynamic WHERE clause with positional parameters ($1, $2, …)
  // Array.push() returns the new array length, which equals the param index.
  const params = []
  const where  = []
  if (userId) where.push(`a.user_id = $${params.push(userId)}`)
  if (action) where.push(`a.action  = $${params.push(action)}`)
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const limitN  = params.push(limit)
  const offsetN = params.push(offset)

  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, u.name AS user_name, u.email AS user_email,
              a.action, a.details, a.ip, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereClause}
       ORDER BY a.created_at DESC LIMIT $${limitN} OFFSET $${offsetN}`,
      params
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// All classes (admin overview)
app.get('/api/admin/classes', adminOnly, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.school_name, c.state, c.ideas_public, c.created_at,
              u.name AS teacher_name, u.email AS teacher_email,
              COUNT(DISTINCT cm.user_id)::int AS member_count,
              COUNT(DISTINCT ti.id)::int       AS idea_count
       FROM classes c
       LEFT JOIN users u         ON u.id = c.teacher_id
       LEFT JOIN class_members cm ON cm.class_id = c.id
       LEFT JOIN trading_ideas ti ON ti.class_id = c.id
       GROUP BY c.id, u.name, u.email
       ORDER BY c.created_at DESC`
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Teacher verification ─────────────────────────────────────────

// Submit a teacher verification request
app.post('/api/teacher/apply', async (req, res) => {
  const { school_name, school_website, state, title } = req.body
  if (!school_name || !state || !title) {
    return res.status(400).json({ error: 'school_name, state, and title are required' })
  }
  const userId = req.user.id
  try {
    // Only allow one pending application at a time
    const { rows: [existing] } = await pool.query(
      `SELECT id, status FROM teacher_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    )
    if (existing?.status === 'pending') {
      return res.status(409).json({ error: 'You already have a pending application' })
    }
    if (existing?.status === 'approved') {
      return res.status(409).json({ error: 'Your account is already approved as a teacher' })
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO teacher_verifications (user_id, school_name, school_website, state, title)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, school_name, school_website || null, state, title]
    )
    res.json(row)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get current user's own verification status
app.get('/api/teacher/apply/status', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT id, status, reject_reason, created_at, reviewed_at
       FROM teacher_verifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    )
    res.json(row ?? null)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: list all verification requests
app.get('/api/admin/teacher-verifications', adminOnly, async (req, res) => {
  const status = req.query.status ?? 'pending'
  try {
    const { rows } = await pool.query(
      `SELECT tv.*, u.name AS user_name, u.email AS user_email, u.avatar_url,
              r.name AS reviewer_name
       FROM teacher_verifications tv
       LEFT JOIN users u ON u.id = tv.user_id
       LEFT JOIN users r ON r.id = tv.reviewed_by
       WHERE ($1 = 'all' OR tv.status = $1)
       ORDER BY tv.created_at DESC`,
      [status]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: approve a teacher verification
app.put('/api/admin/teacher-verifications/:id/approve', adminOnly, async (req, res) => {
  const { id } = req.params
  try {
    const { rows: [verif] } = await pool.query(
      `UPDATE teacher_verifications
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 RETURNING *`,
      [req.user.id, id]
    )
    if (!verif) return res.status(404).json({ error: 'Application not found' })

    // Promote user to teacher
    await pool.query(`UPDATE users SET role = 'teacher' WHERE id = $1`, [verif.user_id])
    audit(req.user.id, 'role_changed', { targetUserId: verif.user_id, from: 'user', to: 'teacher', via: 'teacher_verification' }, req)

    // Send approval email (fire and forget)
    const { rows: [user] } = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [verif.user_id])
    const appUrl = process.env.APP_URL || 'https://tradebuddy.app'
    import('./email.js').then(({ sendTeacherApprovedEmail }) => {
      sendTeacherApprovedEmail({ to: user.email, name: user.name, appUrl }).catch(() => {})
    })

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: reject a teacher verification
app.put('/api/admin/teacher-verifications/:id/reject', adminOnly, async (req, res) => {
  const { id } = req.params
  const { reason } = req.body
  try {
    const { rows: [verif] } = await pool.query(
      `UPDATE teacher_verifications
       SET status = 'rejected', reject_reason = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3 RETURNING *`,
      [reason ?? null, req.user.id, id]
    )
    if (!verif) return res.status(404).json({ error: 'Application not found' })

    // Send rejection email (fire and forget)
    const { rows: [user] } = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [verif.user_id])
    const appUrl = process.env.APP_URL || 'https://tradebuddy.app'
    import('./email.js').then(({ sendTeacherRejectedEmail }) => {
      sendTeacherRejectedEmail({ to: user.email, name: user.name, reason, appUrl }).catch(() => {})
    })

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Customer Profile ────────────────────────────────────────────────
// GET  /api/customer-profile  → fetch the logged-in user's profile
// PUT  /api/customer-profile  → upsert (create or update) the profile

app.get('/api/customer-profile', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT title, company, phone, location, loyalty_tier, notes, tags,
              honorific, nickname, dob, gender, address,
              first_name, middle_name, last_name, updated_at
       FROM customer_profiles
       WHERE user_id = $1`,
      [req.user.id]
    )
    if (rows.length === 0) {
      return res.json({
        title: '', company: '', phone: '', location: '',
        loyaltyTier: 'Bronze', notes: '', tags: [],
        honorific: '', nickname: '', dob: null, gender: '', address: '',
        firstName: '', middleName: '', lastName: '',
      })
    }
    const row = rows[0]
    res.json({
      title:       row.title,
      company:     row.company,
      phone:       row.phone,
      location:    row.location,
      loyaltyTier: row.loyalty_tier,
      notes:       row.notes,
      tags:        row.tags,
      honorific:   row.honorific,
      nickname:    row.nickname,
      dob:         row.dob ? row.dob.toISOString().slice(0, 10) : null,
      gender:      row.gender,
      address:     row.address,
      firstName:   row.first_name,
      middleName:  row.middle_name,
      lastName:    row.last_name,
      updatedAt:   row.updated_at,
    })
  } catch (err) {
    console.error('GET /api/customer-profile error:', err.message)
    res.status(500).json({ error: 'Failed to fetch customer profile' })
  }
})

app.put('/api/customer-profile', authMiddleware, async (req, res) => {
  const {
    title = '', company = '', phone = '', location = '',
    loyaltyTier = 'Bronze', notes = '', tags = [],
    honorific = '', nickname = '', dob = null, gender = '', address = '',
    firstName = '', middleName = '', lastName = '',
  } = req.body

  const VALID_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum']
  if (!VALID_TIERS.includes(loyaltyTier)) {
    return res.status(400).json({ error: 'Invalid loyalty tier' })
  }
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: 'tags must be an array' })
  }
  // Validate dob is a valid date string or null
  const dobValue = dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null

  try {
    await pool.query(
      `INSERT INTO customer_profiles
         (user_id, title, company, phone, location, loyalty_tier, notes, tags,
          honorific, nickname, dob, gender, address,
          first_name, middle_name, last_name, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         title        = EXCLUDED.title,
         company      = EXCLUDED.company,
         phone        = EXCLUDED.phone,
         location     = EXCLUDED.location,
         loyalty_tier = EXCLUDED.loyalty_tier,
         notes        = EXCLUDED.notes,
         tags         = EXCLUDED.tags,
         honorific    = EXCLUDED.honorific,
         nickname     = EXCLUDED.nickname,
         dob          = EXCLUDED.dob,
         gender       = EXCLUDED.gender,
         address      = EXCLUDED.address,
         first_name   = EXCLUDED.first_name,
         middle_name  = EXCLUDED.middle_name,
         last_name    = EXCLUDED.last_name,
         updated_at   = NOW()`,
      [
        req.user.id,
        title.trim(), company.trim(), phone.trim(), location.trim(),
        loyaltyTier, notes.trim(), JSON.stringify(tags),
        honorific.trim(), nickname.trim(), dobValue, gender.trim(), address.trim(),
        firstName.trim(), middleName.trim(), lastName.trim(),
      ]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT /api/customer-profile error:', err.message)
    res.status(500).json({ error: 'Failed to save customer profile' })
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

// ── Daily portfolio snapshot scheduler ──────────────────────────
//
// Runs Mon–Fri at 4:15 PM US/Eastern (just after market close).
// On partial failure it retries only the failed users, up to 3 attempts
// total, waiting 5 min then 10 min between tries.
//
// No external dependencies — uses only setTimeout + Intl.

/**
 * Snapshot a specific list of users (by id).  Returns the ids that failed.
 */
async function snapshotUsers(userIds, attempt, maxAttempts) {
  console.log(`[snapshot-scheduler] Attempt ${attempt}/${maxAttempts} — snapshotting ${userIds.length} user(s)`)
  const results = await Promise.allSettled(userIds.map(id => takeSnapshot(id)))
  const failedIds = []
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[snapshot-scheduler] User ${userIds[i]} failed: ${r.reason?.message ?? r.reason}`)
      failedIds.push(userIds[i])
    }
  })
  const ok = userIds.length - failedIds.length
  console.log(`[snapshot-scheduler] Attempt ${attempt} — ${ok} ok, ${failedIds.length} failed`)
  return failedIds
}

/**
 * Entry point called by the scheduler.  Fetches all active users on the
 * first run; subsequent retry calls pass only the ids that failed.
 */
async function runDailySnapshot({ attempt = 1, maxAttempts = 3, userIds = null } = {}) {
  try {
    let ids = userIds
    if (!ids) {
      const { rows } = await pool.query('SELECT id FROM users WHERE is_disabled = false')
      ids = rows.map(r => r.id)
    }
    if (!ids.length) {
      console.log('[snapshot-scheduler] No active users — skipping')
      return
    }

    const failedIds = await snapshotUsers(ids, attempt, maxAttempts)

    if (failedIds.length === 0) return  // all good

    if (attempt < maxAttempts) {
      const delayMin = attempt * 5   // 5 min, then 10 min
      console.log(`[snapshot-scheduler] Retrying ${failedIds.length} user(s) in ${delayMin} min (attempt ${attempt + 1}/${maxAttempts})`)
      setTimeout(
        () => runDailySnapshot({ attempt: attempt + 1, maxAttempts, userIds: failedIds }),
        delayMin * 60 * 1000
      )
    } else {
      const date = new Date().toISOString().split('T')[0]
      console.error(
        `[snapshot-scheduler] All ${maxAttempts} attempts exhausted. ` +
        `${failedIds.length} user(s) not snapshotted today: ${failedIds.join(', ')}`
      )
      sendSnapshotFailureEmail({
        to: SNAPSHOT_ALERT_EMAIL,
        date,
        failedUserIds: failedIds,
        totalUsers: ids.length,
      }).catch(e => console.error('[snapshot-scheduler] Could not send failure email:', e.message))
    }
  } catch (err) {
    // Catastrophic failure (e.g. DB down) — retry the whole run
    console.error(`[snapshot-scheduler] Fatal error on attempt ${attempt}: ${err.message}`)
    if (attempt < maxAttempts) {
      const delayMin = attempt * 5
      console.log(`[snapshot-scheduler] Retrying full run in ${delayMin} min`)
      setTimeout(() => runDailySnapshot({ attempt: attempt + 1, maxAttempts }), delayMin * 60 * 1000)
    } else {
      const date = new Date().toISOString().split('T')[0]
      console.error('[snapshot-scheduler] All retry attempts exhausted — giving up for today')
      sendSnapshotFailureEmail({
        to: SNAPSHOT_ALERT_EMAIL,
        date,
        failedUserIds: userIds ?? ['unknown — catastrophic failure'],
        totalUsers: userIds?.length ?? 0,
      }).catch(e => console.error('[snapshot-scheduler] Could not send failure email:', e.message))
    }
  }
}

/**
 * Returns the milliseconds until the next weekday occurrence of HH:MM in the
 * given IANA timezone (e.g. 'America/New_York').
 */
function msUntilNext(hour, minute, tz) {
  const now = new Date()

  // Build a Date for "today at HH:MM" in the target timezone by formatting
  // a UTC candidate and checking what local time it corresponds to.
  const candidate = new Date(now)
  candidate.setUTCHours(0, 0, 0, 0)

  // Walk forward day-by-day until we find a weekday slot in the future
  for (let d = 0; d < 8; d++) {
    const probe = new Date(candidate)
    probe.setUTCDate(candidate.getUTCDate() + d)

    // What day-of-week is this in the target TZ?
    const dow = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' })
        .format(probe)
        .slice(0, 2)   // unused — use numeric below
    )
    const dowName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(probe)
    if (dowName === 'Saturday' || dowName === 'Sunday') continue

    // Build the exact fire time: find the UTC instant that equals HH:MM in tz.
    // Strategy: set probe to midnight UTC of that day, then binary-search / offset.
    // Simpler: format "what UTC offset applies at noon that day" via DateTimeFormat.
    const noonUTC = new Date(probe)
    noonUTC.setUTCHours(12, 0, 0, 0)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric', minute: 'numeric', hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(noonUTC)
    const get = type => parseInt(parts.find(p => p.type === type)?.value ?? 0)
    // UTC offset at that moment (in minutes)
    const localNoon = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
    const offsetMs = noonUTC.getTime() - localNoon   // positive = behind UTC (e.g. ET = +4h or +5h)

    // Fire time in UTC
    const fireUTC = Date.UTC(
      parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, year:  'numeric' }).format(probe)),
      parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).format(probe)) - 1,
      parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, day:   'numeric' }).format(probe)),
      hour, minute, 0, 0
    ) + offsetMs

    if (fireUTC > now.getTime()) {
      return fireUTC - now.getTime()
    }
  }
  // Fallback (shouldn't happen): 24 h
  return 24 * 60 * 60 * 1000
}

/**
 * Schedules runDailySnapshot() on the next weekday at snapshotHour:snapshotMinute ET,
 * then reschedules itself for the following day.
 */
const SNAPSHOT_ALERT_EMAIL = process.env.SNAPSHOT_ALERT_EMAIL || 'anpwang@gmail.com'
const SNAPSHOT_TZ          = 'America/New_York'
const SNAPSHOT_HOUR   = 16   // 4 PM
const SNAPSHOT_MINUTE = 15   // :15

function scheduleNextSnapshot() {
  const delay = msUntilNext(SNAPSHOT_HOUR, SNAPSHOT_MINUTE, SNAPSHOT_TZ)
  const fireAt = new Date(Date.now() + delay).toLocaleString('en-US', { timeZone: SNAPSHOT_TZ })
  console.log(`[snapshot-scheduler] Next snapshot scheduled for ${fireAt} ET (in ${Math.round(delay / 60000)} min)`)
  setTimeout(() => {
    runDailySnapshot()
    scheduleNextSnapshot()   // queue tomorrow's run
  }, delay)
}

scheduleNextSnapshot()

// ── Agent Portfolio Routes ───────────────────────────────────────

// Helper: build LLM config from a user_llm_settings row (or fall back to Ollama)
// Ollama is the only provider that doesn't need an API key.
function getLLMConfigForUser(row) {
  const provider = row?.provider || 'ollama'
  const model    = row?.model    || 'gemma4:26b-a4b-it-q4_K_M'
  if (provider === 'ollama') {
    return { provider: 'ollama', model, apiKey: null }
  }
  if (!row?.api_key_enc) {
    // No cloud key — fall back to local Ollama rather than erroring
    return { provider: 'ollama', model: 'gemma4:26b-a4b-it-q4_K_M', apiKey: null }
  }
  return { provider, model, apiKey: decrypt(row.api_key_enc) }
}

// GET  /api/agent-portfolio  — full state (settings, holdings, runs, summary)
app.get('/api/agent-portfolio', authMiddleware, async (req, res) => {
  try {
    const state = await getAgentPortfolioState(req.user.id)
    res.json(state)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agent-portfolio/setup  — create or replace the agent portfolio
app.post('/api/agent-portfolio/setup', authMiddleware, async (req, res) => {
  const { startingCash, bias, frequency, numStocks } = req.body
  if (!startingCash || !bias?.trim() || !frequency) {
    return res.status(400).json({ error: 'startingCash, bias, and frequency are required' })
  }
  if (!['daily','weekly','monthly'].includes(frequency)) {
    return res.status(400).json({ error: 'frequency must be daily, weekly, or monthly' })
  }
  const cash = parseFloat(startingCash)
  if (isNaN(cash) || cash < 100) {
    return res.status(400).json({ error: 'startingCash must be at least $100' })
  }
  const stocks = Math.min(Math.max(parseInt(numStocks ?? 10, 10), 1), 20)
  try {
    const nextRun = calcNextRun(frequency)
    await pool.query(
      `INSERT INTO agent_portfolio_settings (user_id, cash, starting_cash, bias, frequency, num_stocks, next_run_at)
       VALUES ($1,$2,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE
         SET cash=$2, starting_cash=$2, bias=$3, frequency=$4,
             num_stocks=$5, next_run_at=$6, status='active', updated_at=NOW()`,
      [req.user.id, cash, bias.trim(), frequency, stocks, nextRun]
    )
    // Clear any old holdings & runs for a fresh start
    await pool.query('DELETE FROM agent_holdings     WHERE user_id=$1', [req.user.id])
    await pool.query('DELETE FROM agent_runs         WHERE user_id=$1', [req.user.id])
    await pool.query('DELETE FROM agent_transactions WHERE user_id=$1', [req.user.id])
    res.json({ ok: true, nextRun })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/agent-portfolio/settings  — update bias/frequency/status/numStocks without resetting
app.patch('/api/agent-portfolio/settings', authMiddleware, async (req, res) => {
  const { bias, frequency, status, numStocks } = req.body
  try {
    const updates = []
    const vals    = []
    if (bias?.trim())         { updates.push(`bias=$${updates.length+1}`)       ; vals.push(bias.trim()) }
    if (frequency)            { updates.push(`frequency=$${updates.length+1}`)  ; vals.push(frequency)   }
    if (status)               { updates.push(`status=$${updates.length+1}`)     ; vals.push(status)      }
    if (numStocks != null)    { updates.push(`num_stocks=$${updates.length+1}`) ; vals.push(Math.min(Math.max(parseInt(numStocks, 10), 1), 20)) }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' })
    updates.push('updated_at=NOW()')
    vals.push(req.user.id)
    await pool.query(
      `UPDATE agent_portfolio_settings SET ${updates.join(',')} WHERE user_id=$${vals.length}`,
      vals
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agent-portfolio/run  — manually trigger a rebalance now
app.post('/api/agent-portfolio/run', authMiddleware, async (req, res) => {
  try {
    // Load LLM settings — falls back to local Ollama if no cloud key is set
    const { rows: [llmRow] } = await pool.query(
      'SELECT provider, model, api_key_enc FROM user_llm_settings WHERE user_id=$1',
      [req.user.id]
    )
    const llmConfig = getLLMConfigForUser(llmRow ?? {})
    const result    = await runRebalance(req.user.id, llmConfig)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET  /api/agent-portfolio/history  — paginated run history with transactions
app.get('/api/agent-portfolio/history', authMiddleware, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? '20', 10), 50)
  const offset = parseInt(req.query.offset ?? '0', 10)
  try {
    const { rows: runs } = await pool.query(
      `SELECT * FROM agent_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    )
    // Attach transactions to each run
    const runIds = runs.map(r => r.id)
    let txnMap   = {}
    if (runIds.length) {
      const { rows: txns } = await pool.query(
        `SELECT * FROM agent_transactions WHERE run_id = ANY($1) ORDER BY created_at`,
        [runIds]
      )
      for (const t of txns) {
        if (!txnMap[t.run_id]) txnMap[t.run_id] = []
        txnMap[t.run_id].push(t)
      }
    }
    res.json(runs.map(r => ({ ...r, transactions: txnMap[r.id] ?? [] })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/agent-portfolio  — liquidate everything and reset
app.delete('/api/agent-portfolio', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM agent_holdings     WHERE user_id=$1', [req.user.id])
    await pool.query('DELETE FROM agent_runs         WHERE user_id=$1', [req.user.id])
    await pool.query('DELETE FROM agent_transactions WHERE user_id=$1', [req.user.id])
    await pool.query('DELETE FROM agent_portfolio_settings WHERE user_id=$1', [req.user.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Agent Portfolio Scheduler ────────────────────────────────────
// Check every 5 minutes for portfolios whose next_run_at has passed
setInterval(() => {
  runScheduledRebalances(getLLMConfigForUser).catch(() => {})
}, 5 * 60_000)

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ TradeBuddy API running on port ${PORT} (${isProd ? 'production' : 'development'})`)
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ set' : '❌ missing'}`)
})
