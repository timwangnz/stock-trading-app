/**
 * useDashboardSymbols.js
 *
 * Returns the merged set of symbols shown on the dashboard:
 *   1. Portfolio holdings  (AppContext — synced with DB)
 *   2. Watchlist symbols   (AppContext — synced with DB)
 *   3. Custom pins         (DB per user via /api/dashboard/symbols)
 *
 * Custom symbols are now stored server-side so they survive across
 * devices and browser data clears. Optimistic updates keep the UI
 * snappy — the local state changes immediately, then the API is
 * called in the background.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp }  from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

const API = '/api/dashboard/symbols'

// ── API helpers ───────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('tradebuddy_token')
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

// ── Hook ──────────────────────────────────────────────────────────
export function useDashboardSymbols() {
  const { state }           = useApp()
  const { user }            = useAuth()
  const [custom, setCustom] = useState([])

  // Load from DB when user is known
  useEffect(() => {
    if (!user?.id) { setCustom([]); return }

    apiFetch(API)
      .then(symbols => setCustom(symbols ?? []))
      .catch(() => setCustom([]))
  }, [user?.id])

  // Add — optimistic update then persist
  const addCustom = useCallback(async (symbol) => {
    const sym = symbol.toUpperCase().trim()
    if (!sym) return

    // Optimistic
    setCustom(prev => prev.includes(sym) ? prev : [...prev, sym])

    try {
      await apiFetch(API, { method: 'POST', body: JSON.stringify({ symbol: sym }) })
    } catch {
      // Roll back if the server rejected it
      setCustom(prev => prev.filter(s => s !== sym))
    }
  }, [])

  // Remove — optimistic update then persist
  const removeCustom = useCallback(async (symbol) => {
    const sym = symbol.toUpperCase().trim()

    // Optimistic
    setCustom(prev => prev.filter(s => s !== sym))

    try {
      await apiFetch(`${API}/${sym}`, { method: 'DELETE' })
    } catch {
      // Roll back
      setCustom(prev => prev.includes(sym) ? prev : [...prev, sym])
    }
  }, [])

  // Merge portfolio + watchlist + custom (deduped, ordered by source)
  const symbols = useMemo(() => {
    const seen = new Map()
    for (const h of state.portfolio) seen.set(h.symbol, 'portfolio')
    for (const s of state.watchlist) if (!seen.has(s)) seen.set(s, 'watchlist')
    for (const s of custom)          if (!seen.has(s)) seen.set(s, 'custom')
    return [...seen.entries()].map(([symbol, source]) => ({ symbol, source }))
  }, [state.portfolio, state.watchlist, custom])

  return { symbols, custom, addCustom, removeCustom }
}
