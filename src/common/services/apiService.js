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

// Optional callback invoked when the server returns 401 (token expired / invalid).
// AuthContext registers this so it can clear the session and send the user to login.
let onUnauthorized = null

export function setAuthToken(token) {
  authToken = token
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
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

  if (res.status === 401) {
    // Token expired or invalid — clear the session and redirect to login
    if (onUnauthorized) onUnauthorized()
    const text = await res.text()
    throw new Error(`Session expired — please sign in again`)
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null
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

export function fetchCash() {
  return request('GET', '/portfolio/cash')
}

/** Buy at current live market price — price is fetched server-side */
export function buyAtMarket(symbol, shares) {
  return request('POST', '/portfolio/buy', { symbol, shares })
}

/** Sell at current live market price — price is fetched server-side */
export function sellAtMarket(symbol, shares) {
  return request('POST', '/portfolio/sell', { symbol, shares })
}

/** Sell at a manually specified price — teacher/admin only */
export function sellManual(symbol, shares, price) {
  return request('POST', '/portfolio/sell', { symbol, shares, price })
}

/** Add (or deduct if negative) cash — teacher/admin only */
export function addCash(amount) {
  return request('POST', '/portfolio/cash/add', { amount })
}

/** Manual upsert — teacher/admin only */
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

// ── Transactions ─────────────────────────────────────────────────

/** Fetch user's trade history (most recent first) */
export function fetchTransactions({ limit = 100, offset = 0, symbol } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (symbol) params.set('symbol', symbol)
  return request('GET', `/transactions?${params}`)
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

export function fetchStudentDetail(classId, userId) {
  return request('GET', `/classes/${classId}/members/${userId}`)
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

// ── Teacher verification ──────────────────────────────────────────
export function fetchClassActivity(classId, { limit = 100, offset = 0 } = {}) {
  return request('GET', `/classes/${classId}/activity?limit=${limit}&offset=${offset}`)
}

export function fetchRelatedStocks(classId, symbol) {
  return request('GET', `/classes/${classId}/related-stocks?symbol=${encodeURIComponent(symbol)}`)
}

// ── Groups ────────────────────────────────────────────────────────
export function createGroup(data) {
  return request('POST', '/groups', data)
}

export function fetchMyGroups() {
  return request('GET', '/groups/mine')
}

export function fetchGroupDetail(id) {
  return request('GET', `/groups/${id}`)
}

export function joinGroupByCode(code) {
  return request('POST', `/groups/join/${encodeURIComponent(code.trim().toUpperCase())}`)
}

export function fetchGroupLeaderboard(id) {
  return request('GET', `/groups/${id}/leaderboard`)
}

export function fetchGroupActivity(id, { limit = 100, offset = 0 } = {}) {
  return request('GET', `/groups/${id}/activity?limit=${limit}&offset=${offset}`)
}

export function applyForTeacher(data) {
  return request('POST', '/teacher/apply', data)
}

export function fetchTeacherApplicationStatus() {
  return request('GET', '/teacher/apply/status')
}

export function fetchTeacherVerifications(status = 'pending') {
  return request('GET', `/admin/teacher-verifications?status=${status}`)
}

export function approveTeacherVerification(id) {
  return request('PUT', `/admin/teacher-verifications/${id}/approve`)
}

export function rejectTeacherVerification(id, reason) {
  return request('PUT', `/admin/teacher-verifications/${id}/reject`, { reason })
}


// ── Knowledge Base: Financial Statements ─────────────────────────

/**
 * Fetch financial statements for a ticker from Polygon.io.
 * @param {string} ticker  — e.g. "AAPL"
 * @param {string} timeframe — "annual" | "quarterly"
 * @param {number} limit  — number of periods (max 8)
 */
export function getFinancials(ticker, timeframe = 'annual', limit = 4) {
  const t = encodeURIComponent(ticker.toUpperCase())
  return request('GET', `/financials/${t}?timeframe=${timeframe}&limit=${limit}`)
}

// ── Customer Profile ─────────────────────────────────────────────

/** Fetch the logged-in user's recent activity from the audit log */
export function fetchUserActivity(limit = 20) {
  return request('GET', `/audit?limit=${limit}`)
}

/** Fetch the logged-in user's customer profile */
export function fetchCustomerProfile() {
  return request('GET', '/customer-profile')
}

/**
 * Save (upsert) the logged-in user's customer profile.
 * @param {{ title, company, phone, location, loyaltyTier, notes, tags }} profile
 */
export function saveCustomerProfile(profile) {
  return request('PUT', '/customer-profile', profile)
}

// ── Agent Context (Knowledge Base) ───────────────────────────────

/** List all agent context entries for the current user */
export function fetchAgentContext() {
  return request('GET', '/agent-context')
}

/** Create a new context entry */
export function createAgentContext(entry) {
  return request('POST', '/agent-context', entry)
}

/** Toggle enabled / update fields on an existing entry */
export function updateAgentContext(id, patch) {
  return request('PATCH', `/agent-context/${id}`, patch)
}

/** Delete a context entry */
export function deleteAgentContext(id) {
  return request('DELETE', `/agent-context/${id}`)
}

// ── MCP Servers (for dataset configurator) ───────────────────────

/** List the user's connected MCP servers with their tools */
export async function fetchMCPServersWithTools() {
  const token = localStorage.getItem('vantage_token')
  // Fetch servers list
  const servers = await request('GET', '/mcp-servers')
  // Fetch tools for each enabled server in parallel
  const withTools = await Promise.all(
    servers.filter(s => s.enabled).map(async s => {
      try {
        const res = await fetch(`/api/mcp-servers/${s.id}/test`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        return { ...s, tools: data.toolNames ?? [] }
      } catch {
        return { ...s, tools: [] }
      }
    })
  )
  return withTools
}

// ── Saved Prompts ─────────────────────────────────────────────────

/** List saved prompts for the current user */
export function fetchSavedPrompts() {
  return request('GET', '/saved-prompts')
}

/** Save a new prompt (title, description, message, context_snap, include_live_data) */
export function createSavedPrompt(prompt) {
  return request('POST', '/saved-prompts', prompt)
}

/** Update a saved prompt */
export function updateSavedPrompt(id, patch) {
  return request('PATCH', `/saved-prompts/${id}`, patch)
}

/** Delete a saved prompt */
export function deleteSavedPrompt(id) {
  return request('DELETE', `/saved-prompts/${id}`)
}

/** Run a saved prompt through the stateless token runner */
export function runSavedPrompt(id) {
  return request('POST', `/saved-prompts/${id}/run`, {})
}

/** Run an ad-hoc template string (not yet saved) */
export function runPromptTemplate(template) {
  return request('POST', '/prompts/run', { template })
}

/** Validate @tokens and {{vars}} in a template — returns { errors, tokenCount } */
export function validatePromptTemplate(template) {
  return request('POST', '/prompts/validate', { template })
}
