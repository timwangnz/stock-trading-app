/**
 * server/appSettings.js
 * Admin-configurable application settings stored in the DB.
 *
 * Sensitive values (API keys, secrets) are AES-256-GCM encrypted at rest
 * using the same crypto module as user LLM keys.
 *
 * Falls back to environment variables so existing installs with keys in
 * .env continue to work without any migration step.
 *
 * In-memory cache (60 s TTL) prevents a DB hit on every API request.
 */

import pool           from '../common/db.js'
import { encrypt, decrypt } from '../common/crypto.js'

// ── In-memory cache ───────────────────────────────────────────────
const _cache   = new Map()
const CACHE_TTL = 60_000   // 1 minute

function _cacheGet(key) {
  const entry = _cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return undefined }
  return entry.value
}
function _cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL })
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Read a setting from the DB.
 * Falls back to process.env[fallbackEnv] if no DB row exists.
 * Returns null if neither source has a value.
 */
export async function getAppSetting(key, fallbackEnv = null) {
  const cached = _cacheGet(key)
  if (cached !== undefined) return cached

  const { rows: [row] } = await pool.query(
    'SELECT value, encrypted FROM app_settings WHERE key = $1', [key]
  )

  let value = null
  if (row?.value) {
    value = row.encrypted ? decrypt(row.value) : row.value
  } else if (fallbackEnv && process.env[fallbackEnv]) {
    value = process.env[fallbackEnv]
  }

  _cacheSet(key, value)
  return value
}

/**
 * Write (upsert) a setting into the DB.
 * Pass encrypted=true for API keys and secrets.
 * Passing null/empty string clears the value.
 */
export async function setAppSetting(key, value, encrypted = false) {
  const stored = encrypted && value ? encrypt(value) : (value || null)
  await pool.query(
    `INSERT INTO app_settings (key, value, encrypted, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value      = EXCLUDED.value,
           encrypted  = EXCLUDED.encrypted,
           updated_at = NOW()`,
    [key, stored, encrypted]
  )
  _cache.delete(key)   // invalidate so next read is fresh
}

/**
 * Return a summary of all stored settings for the admin UI.
 * Sensitive values are never returned — only whether they are set.
 */
export async function getAllAppSettings() {
  const { rows } = await pool.query(
    'SELECT key, encrypted, updated_at FROM app_settings WHERE value IS NOT NULL'
  )
  return rows.reduce((acc, r) => {
    acc[r.key] = { configured: true, encrypted: r.encrypted, updatedAt: r.updated_at }
    return acc
  }, {})
}
