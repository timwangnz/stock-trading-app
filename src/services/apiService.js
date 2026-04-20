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

/** Exchange Google access token for our JWT + user profile */
export function googleSignInWithToken(accessToken) {
  return request('POST', '/auth/google-token', { accessToken })
}

/** Create a new account with email + password */
export function emailSignUp(name, email, password) {
  return request('POST', '/auth/signup', { name, email, password })
}

/** Sign in with email + password */
export function emailSignIn(email, password) {
  return request('POST', '/auth/login', { email, password })
}

/** Get the user's LLM provider/model settings */
export function getLLMSettings() {
  return request('GET', '/settings/llm')
}

/** Save the user's LLM provider/model/key settings */
export function saveLLMSettings({ provider, model, apiKey }) {
  return request('PUT', '/settings/llm', { provider, model, apiKey })
}

/** Send a password reset email */
export function forgotPassword(email) {
  return request('POST', '/auth/forgot-password', { email })
}

/** Reset password using a token from the email link */
export function resetPassword(token, password) {
  return request('POST', '/auth/reset-password', { token, password })
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

// ── Portfolio Snapshots ─────────────────────────────────────────

/** Trigger a snapshot of the current portfolio value for the logged-in user */
export function triggerSnapshot() {
  return request('POST', '/portfolio/snapshot')
}

/** Fetch stored daily snapshots between two ISO date strings (YYYY-MM-DD) */
export function getPortfolioSnapshots(from, to) {
  return request('GET', `/portfolio/snapshots?from=${from}&to=${to}`)
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

// ── Classes ─────────────────────────────────────────────────────

export function createClass(data) {
  return request('POST', '/classes', data)
}

export function fetchMyClasses() {
  return request('GET', '/classes/mine')
}

export function fetchManagedClasses() {
  return request('GET', '/classes')
}

export function fetchClassDetail(id) {
  return request('GET', `/classes/${id}`)
}

export function updateClass(id, data) {
  return request('PUT', `/classes/${id}`, data)
}

export function sendInvites(classId, emails) {
  return request('POST', `/classes/${classId}/invite`, { emails })
}

export function joinClass(token) {
  return request('POST', '/classes/join', { token })
}

// ── Leaderboard ─────────────────────────────────────────────────

export function fetchClassLeaderboard(classId) {
  return request('GET', `/leaderboard/class/${classId}`)
}

export function fetchStateLeaderboard(state) {
  return request('GET', `/leaderboard/state/${encodeURIComponent(state)}`)
}

export function fetchNationalLeaderboard() {
  return request('GET', '/leaderboard/national')
}

// ── Trading Ideas ────────────────────────────────────────────────

export function postIdea(data) {
  return request('POST', '/ideas', data)
}

export function fetchIdeas(classId) {
  return request('GET', `/ideas?class_id=${classId}`)
}

export function fetchPublicIdeas(state) {
  return request('GET', `/ideas/public${state ? `?state=${encodeURIComponent(state)}` : ''}`)
}

export function toggleIdeaLike(ideaId) {
  return request('POST', `/ideas/${ideaId}/react`)
}

export function deleteIdea(ideaId) {
  return request('DELETE', `/ideas/${ideaId}`)
}
