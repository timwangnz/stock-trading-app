/**
 * usePriceAlerts.js
 * Manages per-symbol price alerts stored in localStorage.
 *
 * Alert shape:
 *   { id, symbol, targetPrice, direction: 'above'|'below', triggered: bool, createdAt }
 *
 * Usage:
 *   const { alerts, addAlert, removeAlert, dismissAlert, checkPrice } = usePriceAlerts(symbol)
 *   checkPrice(currentPrice)  — call when live price arrives; returns newly-triggered alerts
 */

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'tradebuddy_price_alerts'

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  catch { return {} }
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function usePriceAlerts(symbol) {
  const [all, setAll] = useState(load)

  const alerts = (all[symbol] ?? []).slice().sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )

  const persist = useCallback((updated) => {
    save(updated)
    setAll(updated)
  }, [])

  const addAlert = useCallback((targetPrice, direction) => {
    const prev = load()
    const existing = prev[symbol] ?? []
    const entry = {
      id:          crypto.randomUUID(),
      symbol,
      targetPrice: parseFloat(targetPrice),
      direction,        // 'above' | 'below'
      triggered:   false,
      dismissed:   false,
      createdAt:   new Date().toISOString(),
    }
    persist({ ...prev, [symbol]: [entry, ...existing] })
  }, [symbol, persist])

  const removeAlert = useCallback((id) => {
    const prev = load()
    persist({ ...prev, [symbol]: (prev[symbol] ?? []).filter(a => a.id !== id) })
  }, [symbol, persist])

  // Mark a triggered alert as dismissed (hides the banner, keeps the record)
  const dismissAlert = useCallback((id) => {
    const prev = load()
    persist({
      ...prev,
      [symbol]: (prev[symbol] ?? []).map(a => a.id === id ? { ...a, dismissed: true } : a),
    })
  }, [symbol, persist])

  // Call with the current live price; returns newly-triggered alerts so the caller
  // can show a notification. Marks them triggered in storage automatically.
  const checkPrice = useCallback((currentPrice) => {
    if (!currentPrice) return []
    const prev = load()
    const list = prev[symbol] ?? []
    const fired = list.filter(a =>
      !a.triggered &&
      (a.direction === 'above' ? currentPrice >= a.targetPrice
                               : currentPrice <= a.targetPrice)
    )
    if (fired.length === 0) return []
    const firedIds = new Set(fired.map(a => a.id))
    persist({
      ...prev,
      [symbol]: list.map(a => firedIds.has(a.id) ? { ...a, triggered: true } : a),
    })
    return fired
  }, [symbol, persist])

  return { alerts, addAlert, removeAlert, dismissAlert, checkPrice }
}
