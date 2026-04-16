/**
 * useDashboardSymbols.js
 *
 * Returns the merged set of symbols to show on the dashboard:
 *   1. Portfolio holdings   (from AppContext — synced with DB)
 *   2. Watchlist symbols    (from AppContext — synced with DB)
 *   3. Custom additions     (persisted in localStorage per user)
 *
 * Persistence design:
 *   - A dedicated useEffect LOADS from localStorage when user.id is known.
 *   - A separate useEffect SAVES to localStorage whenever custom changes,
 *     but ONLY after the initial load has completed (guarded by a ref).
 *   - No side effects inside state updaters — avoids React StrictMode issues.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApp }  from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

const storageKey = (userId) => `dashboard_custom_symbols_${userId}`

export function useDashboardSymbols() {
  const { state }           = useApp()
  const { user }            = useAuth()
  const [custom, setCustom] = useState([])

  // Tracks whether we've finished loading from localStorage for the current user.
  // Using a ref (not state) so flipping it doesn't trigger a re-render.
  const loadedRef = useRef(false)

  // ── LOAD: read from localStorage whenever user.id changes ──────
  useEffect(() => {
    if (!user?.id) {
      // User signed out — clear custom list
      loadedRef.current = false
      setCustom([])
      return
    }

    loadedRef.current = false   // prevent any in-flight save from firing
    try {
      const raw = localStorage.getItem(storageKey(user.id))
      setCustom(raw ? JSON.parse(raw) : [])
    } catch {
      setCustom([])
    }
    loadedRef.current = true
  }, [user?.id])

  // ── SAVE: persist to localStorage whenever custom changes ───────
  // The loadedRef guard means this will never fire before the load above
  // completes, so we never accidentally overwrite saved data with [].
  useEffect(() => {
    if (!user?.id || !loadedRef.current) return
    try {
      localStorage.setItem(storageKey(user.id), JSON.stringify(custom))
    } catch {
      // localStorage quota exceeded or private-browsing block — fail silently
    }
  }, [custom, user?.id])

  // ── Mutators ────────────────────────────────────────────────────
  const addCustom = useCallback((symbol) => {
    const sym = symbol.toUpperCase().trim()
    if (!sym) return
    setCustom(prev => prev.includes(sym) ? prev : [...prev, sym])
  }, [])

  const removeCustom = useCallback((symbol) => {
    setCustom(prev => prev.filter(s => s !== symbol))
  }, [])

  // ── Merge portfolio + watchlist + custom ────────────────────────
  const symbols = useMemo(() => {
    const seen = new Map()
    for (const h of state.portfolio)   seen.set(h.symbol, 'portfolio')
    for (const s of state.watchlist)   if (!seen.has(s)) seen.set(s, 'watchlist')
    for (const s of custom)            if (!seen.has(s)) seen.set(s, 'custom')
    return [...seen.entries()].map(([symbol, source]) => ({ symbol, source }))
  }, [state.portfolio, state.watchlist, custom])

  return { symbols, custom, addCustom, removeCustom }
}
