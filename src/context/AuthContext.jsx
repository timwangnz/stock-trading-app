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
import { googleSignIn, googleSignInWithToken, emailSignUp, emailSignIn, setAuthToken, joinClass } from '../services/apiService'

const AuthContext = createContext(null)

const TOKEN_KEY     = 'tradebuddy_token'
const USER_KEY      = 'tradebuddy_user'
const VIEW_MODE_KEY = 'tradebuddy_view_mode'

// ── Role helpers (mirrors server/rbac.js) ─────────────────────
// 'student' is between 'user' and 'premium'.
// It is ONLY assigned server-side when a user joins a class — never at signup.
const ROLE_HIERARCHY = ['readonly', 'user', 'student', 'premium', 'teacher', 'admin']

function hasRole(userRole, requiredRole) {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(requiredRole)
}

export function AuthProvider({ children }) {
  const [user,     setUser]     = useState(null)
  const [loading,  setLoading]  = useState(true)  // true while restoring session

  // Default viewMode based on the saved user's role:
  //   admin   → 'admin'   (primary duty is platform management)
  //   teacher → 'teacher' (primary duty is classroom)
  //   others  → 'trading'
  const [viewMode, setViewMode] = useState(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY)
    if (saved) return saved
    try {
      const u = JSON.parse(localStorage.getItem(USER_KEY) || '{}')
      if (u.role === 'admin')   return 'admin'
      if (u.role === 'teacher') return 'teacher'
    } catch { /* ignore */ }
    return 'trading'
  })

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
   * Join a class via invite token.
   * The server sets role = 'student' (if not already privileged) and returns
   * a fresh JWT — this is the ONLY way the 'student' role is assigned.
   */
  const joinClassWithToken = useCallback(async (inviteToken) => {
    const result = await joinClass(inviteToken)
    // Server returns { token, user, class_id, class_name, school_name }
    if (result.token && result.user) {
      saveSession(result.token, result.user)
    }
    return result
  }, [saveSession])

  /**
   * Cycle view mode — persisted in localStorage.
   *
   * Admin + Teacher: 'admin' → 'teacher' → 'trading' → 'admin'
   * Admin only:      'admin' ↔ 'trading'
   * Teacher only:    'teacher' ↔ 'trading'
   */
  const toggleViewMode = useCallback((currentUser) => {
    const isAdminRole   = currentUser?.role === 'admin'
    const isTeacherRole = currentUser?.role === 'teacher' || isAdminRole

    setViewMode(prev => {
      let next
      if (isAdminRole && isTeacherRole) {
        if (prev === 'admin')        next = 'teacher'
        else if (prev === 'teacher') next = 'trading'
        else                         next = 'admin'
      } else if (isAdminRole) {
        next = prev === 'admin' ? 'trading' : 'admin'
      } else {
        next = prev === 'teacher' ? 'trading' : 'teacher'
      }
      localStorage.setItem(VIEW_MODE_KEY, next)
      return next
    })
  }, [])

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
  const isTeacher  = role === 'teacher' || isAdmin        // teacher + admin can manage classes
  const isStudent  = role === 'student'                   // only set via joinClassWithToken
  const isReadonly = !!user && !hasRole(role, 'user')     // view-only

  // Effective view mode — normalised to valid states per role
  const effectiveViewMode = isAdmin
    ? (['admin', 'teacher', 'trading'].includes(viewMode) ? viewMode : 'admin')
    : isTeacher
      ? (['teacher', 'trading'].includes(viewMode) ? viewMode : 'teacher')
      : 'trading'

  // Expose the raw JWT so components that do their own fetch() can use it.
  // Components that use apiService.js functions don't need this — the token
  // is pre-loaded there via setAuthToken().
  const token = localStorage.getItem(TOKEN_KEY)

  return (
    <AuthContext.Provider value={{
      user, loading, login, loginWithToken, signUp, signIn, logout,
      joinClassWithToken, token,
      role, canTrade, isAdmin, isTeacher, isStudent, isReadonly,
      viewMode: effectiveViewMode, toggleViewMode,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
