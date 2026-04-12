/**
 * AppContext.jsx
 *
 * Global state for the TradeBuddy app.
 * Using React's built-in Context + useReducer pattern — a great
 * intermediate pattern to learn before reaching for Redux/Zustand.
 *
 * What lives here:
 *  - currentPage  : which page is displayed (Dashboard | Portfolio | Watchlist | StockDetail)
 *  - selectedStock: symbol of the stock being viewed in detail
 *  - portfolio    : array of { symbol, shares, avgCost }
 *  - watchlist    : array of symbol strings
 *  - dbReady      : true once the initial API load completes
 *
 * Persistence:
 *  On mount, portfolio and watchlist are fetched from the MySQL backend.
 *  Every buy/sell/watchlist change is immediately written back to MySQL
 *  so nothing is ever lost on page refresh.
 */

import { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import {
  fetchPortfolio, upsertHolding, removeHolding,
  fetchWatchlist, addWatchlistSymbol, removeWatchlistSymbol,
} from '../services/apiService'

// ── Initial (empty) state ─────────────────────────────────────
// We start with empty arrays and dbReady:false, then fill them
// from the API in a useEffect below.
const initialState = {
  currentPage:  'dashboard',  // 'dashboard' | 'portfolio' | 'watchlist' | 'stock'
  selectedStock: null,
  portfolio:    [],
  watchlist:    [],
  dbReady:      false,        // flips to true once the API load finishes
}

// ── Action types ──────────────────────────────────────────────
export const ACTIONS = {
  NAVIGATE:              'NAVIGATE',
  VIEW_STOCK:            'VIEW_STOCK',
  LOAD_DATA:             'LOAD_DATA',             // initial DB load
  ADD_TO_WATCHLIST:      'ADD_TO_WATCHLIST',
  REMOVE_FROM_WATCHLIST: 'REMOVE_FROM_WATCHLIST',
  ADD_TO_PORTFOLIO:      'ADD_TO_PORTFOLIO',
  SELL_SHARES:           'SELL_SHARES',
  REMOVE_FROM_PORTFOLIO: 'REMOVE_FROM_PORTFOLIO',
}

// ── Reducer ───────────────────────────────────────────────────
function appReducer(state, action) {
  switch (action.type) {

    case ACTIONS.NAVIGATE:
      return { ...state, currentPage: action.payload }

    case ACTIONS.VIEW_STOCK:
      return { ...state, currentPage: 'stock', selectedStock: action.payload }

    case ACTIONS.LOAD_DATA:
      return {
        ...state,
        portfolio: action.payload.portfolio,
        watchlist: action.payload.watchlist,
        dbReady:   true,
      }

    case ACTIONS.ADD_TO_WATCHLIST: {
      if (state.watchlist.includes(action.payload)) return state
      return { ...state, watchlist: [...state.watchlist, action.payload] }
    }

    case ACTIONS.REMOVE_FROM_WATCHLIST:
      return {
        ...state,
        watchlist: state.watchlist.filter(s => s !== action.payload),
      }

    case ACTIONS.ADD_TO_PORTFOLIO: {
      const { symbol, shares, avgCost } = action.payload
      const existing = state.portfolio.find(h => h.symbol === symbol)
      if (existing) {
        const totalShares = existing.shares + shares
        const newAvgCost  = ((existing.avgCost * existing.shares) + (avgCost * shares)) / totalShares
        return {
          ...state,
          portfolio: state.portfolio.map(h =>
            h.symbol === symbol
              ? { ...h, shares: totalShares, avgCost: parseFloat(newAvgCost.toFixed(2)) }
              : h
          ),
        }
      }
      return { ...state, portfolio: [...state.portfolio, { symbol, shares, avgCost }] }
    }

    case ACTIONS.SELL_SHARES: {
      const { symbol, shares: sharesToSell } = action.payload
      const holding = state.portfolio.find(h => h.symbol === symbol)
      if (!holding) return state

      const remaining = parseFloat((holding.shares - sharesToSell).toFixed(6))

      if (remaining <= 0) {
        return {
          ...state,
          portfolio: state.portfolio.filter(h => h.symbol !== symbol),
        }
      }
      return {
        ...state,
        portfolio: state.portfolio.map(h =>
          h.symbol === symbol ? { ...h, shares: remaining } : h
        ),
      }
    }

    case ACTIONS.REMOVE_FROM_PORTFOLIO:
      return {
        ...state,
        portfolio: state.portfolio.filter(h => h.symbol !== action.payload),
      }

    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────
const AppContext = createContext(null)

// ── Provider ──────────────────────────────────────────────────
export function AppProvider({ children }) {
  const { user }          = useAuth()
  const [state, dispatch] = useReducer(appReducer, initialState)

  // ── 1. Load from MySQL whenever the signed-in user changes ──
  // This handles first login AND switching accounts (logout → login).
  useEffect(() => {
    if (!user) {
      // Signed out — reset to empty state
      dispatch({ type: ACTIONS.LOAD_DATA, payload: { portfolio: [], watchlist: [] } })
      return
    }
    Promise.all([fetchPortfolio(), fetchWatchlist()])
      .then(([portfolio, watchlist]) => {
        dispatch({ type: ACTIONS.LOAD_DATA, payload: { portfolio, watchlist } })
      })
      .catch(err => {
        console.error('Failed to load from MySQL — is the server running?', err.message)
        dispatch({ type: ACTIONS.LOAD_DATA, payload: { portfolio: [], watchlist: [] } })
      })
  }, [user])

  // ── 2. Wrap dispatch to also sync each change to MySQL ──────
  // This is an "optimistic update" pattern:
  //   a) dispatch() updates local state immediately so the UI feels instant
  //   b) the API call persists the change to MySQL in the background
  const apiDispatch = useCallback(async (action) => {
    // Update local state first (optimistic — no waiting for the network)
    dispatch(action)

    // Then persist to MySQL based on what changed
    try {
      switch (action.type) {

        case ACTIONS.ADD_TO_PORTFOLIO: {
          // After ADD_TO_PORTFOLIO, the reducer recalculates avgCost.
          // We need to compute the same merged values here so we save
          // the correct numbers, not the raw incoming values.
          const { symbol, shares: inShares, avgCost: inCost } = action.payload
          const existing = state.portfolio.find(h => h.symbol === symbol)
          let finalShares, finalAvgCost
          if (existing) {
            finalShares   = existing.shares + inShares
            finalAvgCost  = ((existing.avgCost * existing.shares) + (inCost * inShares)) / finalShares
            finalAvgCost  = parseFloat(finalAvgCost.toFixed(2))
          } else {
            finalShares   = inShares
            finalAvgCost  = inCost
          }
          await upsertHolding(symbol, finalShares, finalAvgCost)
          break
        }

        case ACTIONS.SELL_SHARES: {
          const { symbol, shares: sharesToSell } = action.payload
          const holding = state.portfolio.find(h => h.symbol === symbol)
          if (!holding) break
          const remaining = parseFloat((holding.shares - sharesToSell).toFixed(6))
          if (remaining <= 0) {
            await removeHolding(symbol)
          } else {
            await upsertHolding(symbol, remaining, holding.avgCost)
          }
          break
        }

        case ACTIONS.REMOVE_FROM_PORTFOLIO:
          await removeHolding(action.payload)
          break

        case ACTIONS.ADD_TO_WATCHLIST:
          if (!state.watchlist.includes(action.payload)) {
            await addWatchlistSymbol(action.payload)
          }
          break

        case ACTIONS.REMOVE_FROM_WATCHLIST:
          await removeWatchlistSymbol(action.payload)
          break

        // NAVIGATE, VIEW_STOCK, LOAD_DATA → UI-only, nothing to persist
        default:
          break
      }
    } catch (err) {
      console.error('MySQL sync error (local state already updated):', err.message)
    }
  }, [state])

  return (
    <AppContext.Provider value={{ state, dispatch: apiDispatch }}>
      {children}
    </AppContext.Provider>
  )
}

// ── Custom hook ───────────────────────────────────────────────
export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside <AppProvider>')
  return context
}
