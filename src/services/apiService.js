/**
 * apiService.js
 * Frontend API client. All requests go to /api/* which Vite proxies
 * to the Express server on port 3001.
 *
 * Call setAuthToken(token) after sign-in so every subsequent request
 * includes the Authorization header automatically.
 */

const BASE = '/api'

// Module-level token — set once after Google sign-in, cleared on logout
let authToken = null

export function setAuthToken(token) {
  authToken = token
}

async function request(method, path, body) {
  const headers = {}
  if (body)      headers['Content-Type']  = 'application/json'
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json()
}

// ── Auth ────────────────────────────────────────────────────────

/** Exchange Google ID token for our JWT + user profile */
export function googleSignIn(idToken) {
  return request('POST', '/auth/google', { idToken })
}

/** Create a new account with email + password */
export function emailSignUp(name, email, password) {
  return request('POST', '/auth/signup', { name, email, password })
}

/** Sign in with email + password */
export function emailSignIn(email, password) {
  return request('POST', '/auth/login', { email, password })
}

// ── Portfolio ───────────────────────────────────────────────────

export function fetchPortfolio() {
  return request('GET', '/portfolio')
}

export function upsertHolding(symbol, shares, avgCost) {
  return request('PUT', `/portfolio/${symbol}`, { shares, avgCost })
}

export function removeHolding(symbol) {
  return request('DELETE', `/portfolio/${symbol}`)
}

// ── Watchlist ───────────────────────────────────────────────────

export function fetchWatchlist() {
  return request('GET', '/watchlist')
}

export function addWatchlistSymbol(symbol) {
  return request('PUT', `/watchlist/${symbol}`)
}

export function removeWatchlistSymbol(symbol) {
  return request('DELETE', `/watchlist/${symbol}`)
}
