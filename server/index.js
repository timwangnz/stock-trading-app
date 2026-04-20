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
import { requireRole, requirePermission, PERMISSIONS } from './rbac.js'
import { runTradingAgent } from './agent.js'
import { log as audit } from './audit.js'
import { sendPasswordResetEmail } from './email.js'
import marketRouter from './market.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app  = express()
// Cloud Run sets PORT automatically; fall back to 3001 for local dev
const PORT = process.env.PORT || process.env.API_PORT || 3001

// ── Default dashboard symbols for new users ──────────────────────
const DEFAULT_DASHBOARD_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA']

async function addDefaultSymbols(userId) {
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

// ── Rate limiting ─────────────────────────────────────────────────
// Auth endpoints: max 20 requests per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later' },
})

// General API: max 300 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later' },
})

app.use('/api/auth', authLimiter)
app.use('/api', apiLimiter)

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
app.use('/api/market', authMiddleware, marketRouter)

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
      // Load the user's LLM settings (provider, model, decrypted API key)
      const { rows: [settings] } = await pool.query(
        'SELECT provider, model, api_key_enc FROM user_llm_settings WHERE user_id = $1',
        [req.user.id]
      )
      if (!settings?.api_key_enc) {
        return res.status(400).json({
          error: 'No API key configured. Please open the Trading Agent settings (⚙️) and add your API key before using the agent.',
        })
      }

      const llmConfig = {
        provider: settings.provider || 'anthropic',
        model:    settings.model    || 'claude-haiku-4-5-20251001',
        apiKey:   decrypt(settings.api_key_enc),
      }

      const result = await runTradingAgent({
        userId:    req.user.id,
        message:   message.trim(),
        portfolio: portfolio ?? [],
        llmConfig,
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
  const validRoles = ['admin', 'premium', 'user', 'readonly']
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
  const { rows: holdings } = await pool.query(
    'SELECT symbol, shares FROM portfolio WHERE user_id = $1',
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
    const price = t.day?.c ?? t.prevDay?.c ?? 0
    if (price > 0) priceMap[t.ticker] = price
  }

  // If Polygon returned no prices at all (weekend / market holiday / API error),
  // skip the snapshot rather than writing a $0 record that corrupts history.
  if (Object.keys(priceMap).length === 0) {
    console.log(`[snapshot] No price data from Polygon (market closed?) — skipping snapshot for user ${userId}`)
    return null
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
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ set' : '❌ missing'}`)
})
