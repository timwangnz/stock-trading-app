/**
 * useLivePrices.js
 * Custom hook that fetches live snapshots for a list of symbols
 * and returns a Map of symbol → price data.
 *
 * Usage:
 *   const { prices, loading, error, refetch } = useLivePrices(['AAPL','MSFT'])
 *   prices.get('AAPL')  // → { price, change, changePct, volume, … }
 *
 * This hook is shared by Portfolio and Watchlist so they don't duplicate
 * the same fetch logic.
 */

import { useState, useEffect, useCallback } from 'react'
import { getSnapshots } from '../services/polygonApi'

export function useLivePrices(symbols) {
  const [prices,  setPrices]  = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const symbolKey = symbols.join(',') // stable string for the dependency array

  const fetchPrices = useCallback(async () => {
    if (symbols.length === 0) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const snaps = await getSnapshots(symbols)
      const map = new Map(snaps.map(s => [s.symbol, s]))
      setPrices(map)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  useEffect(() => { fetchPrices() }, [fetchPrices])

  return { prices, loading, error, refetch: fetchPrices }
}
