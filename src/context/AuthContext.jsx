/**
 * AuthContext.jsx
 * Manages the signed-in user and JWT token.
 *
 * Flow:
 *  1. On mount, check localStorage for a saved token (stays logged in
 *     across page refreshes).
 *  2. After Google sign-in succeeds, call login(idToken) — this hits
 *     POST /api/auth/google, gets back our JWT, and saves everything.
 *  3. logout() clears the token from memory and localStorage.
 *
 * Components access this via the useAuth() hook.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { googleSignIn, googleSignInWithToken, emailSignUp, emailSignIn, setAuthToken } from '../services/apiService'

const AuthContext = createContext(null)

const TOKEN_KEY = 'tradebuddy_token'
const USER_KEY  = 'tradebuddy_user'

// ── Role helpers (mirrors server/rbac.js) ─────────────────────
const ROLE_HIERARCHY = ['readonly', 'user', 'premium', 'admin']

function hasRole(userRole, requiredRole) {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(requiredRole)
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)  // true while restoring session

  // ── Restore session from localStorage on first load ──────────
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    const savedUser  = localStorage.getItem(USER_KEY)

    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser)
        setAuthToken(savedToken)   // re-arm the API client
        setUser(parsedUser)
      } catch {
        // Corrupted data — clear it
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
      }
    }
    setLoading(false)
  }, [])

  /**
   * Called by the Login page with the Google ID token.
   * Exchanges it for our JWT and persists the session.
   */
  // Shared helper — saves token + user after any successful auth
  const saveSession = useCallback((token, profile) => {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(profile))
    setAuthToken(token)
    setUser(profile)
  }, [])

  const login = useCallback(async (idToken) => {
    const { token, user: profile } = await googleSignIn(idToken)
    saveSession(token, profile)
  }, [saveSession])

  // Called when using the access-token (implicit) Google flow
  const loginWithToken = useCallback(async (accessToken) => {
    const { token, user: profile } = await googleSignInWithToken(accessToken)
    saveSession(token, profile)
  }, [saveSession])


  const signUp = useCallback(async (name, email, password) => {
    const { token, user: profile } = await emailSignUp(name, email, password)
    saveSession(token, profile)
  }, [saveSession])

  const signIn = useCallback(async (email, password) => {
    const { token, user: profile } = await emailSignIn(email, password)
    saveSession(token, profile)
  }, [saveSession])

  /**
   * Sign out — clears everything.
   */
  const logout = useCallback(() => {
    // Fire-and-forget logout audit entry before clearing the token
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    }
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setAuthToken(null)
    setUser(null)
  }, [])

  // Derived permission flags — components use these instead of checking roles directly
  const role       = user?.role ?? null
  const canTrade   = !!user && hasRole(role, 'user')      // buy/sell/watchlist changes
  const isAdmin    = !!user && hasRole(role, 'admin')     // admin panel access
  const isReadonly = !!user && !hasRole(role, 'user')     // view-only

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithToken, signUp, signIn, logout, role, canTrade, isAdmin, isReadonly }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
