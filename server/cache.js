/**
 * server/cache.js
 * Lightweight in-memory TTL cache for Polygon API responses.
 *
 * No external dependencies — just a Map with expiry timestamps.
 * Suitable for a single-process server (Railway, Render, etc.).
 *
 * Usage:
 *   import { cacheGet, cacheSet } from './cache.js'
 *
 *   const cached = cacheGet('snapshots:AAPL,MSFT')
 *   if (cached) return res.json(cached)
 *
 *   const data = await polyFetch(...)
 *   cacheSet('snapshots:AAPL,MSFT', data, 60_000)   // 60 s TTL
 *   res.json(data)
 */

const store = new Map()   // key → { value, expiresAt }

/**
 * Retrieve a cached value.
 * Returns null if the key doesn't exist or has expired.
 */
export function cacheGet(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

/**
 * Store a value with a TTL in milliseconds.
 */
export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Invalidate a specific key (e.g. after a forced refresh).
 */
export function cacheDel(key) {
  store.delete(key)
}

/**
 * Return basic cache stats (useful for debugging).
 */
export function cacheStats() {
  const now  = Date.now()
  let live   = 0
  let stale  = 0
  for (const entry of store.values()) {
    entry.expiresAt > now ? live++ : stale++
  }
  return { total: store.size, live, stale }
}

// ── TTL constants (export so routes can use them consistently) ────
export const TTL = {
  SNAPSHOT:       60_000,        //  1 min  — live prices
  AGGREGATES:  3_600_000,        //  1 hour — historical bars
  TICKER:     86_400_000,        // 24 hour — company details
  SEARCH:        300_000,        //  5 min  — ticker search
  PREV_CLOSE:  3_600_000,        //  1 hour — previous close
}

// ── Periodic cleanup — evict expired entries every 5 minutes ─────
// Prevents unbounded memory growth when many unique keys are cached.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key)
  }
}, 5 * 60_000).unref()   // .unref() so this timer never blocks process exit
