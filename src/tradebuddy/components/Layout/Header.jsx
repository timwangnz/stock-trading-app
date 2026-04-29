/**
 * Header.jsx
 * Top bar showing the current page title and a search box
 * for quickly jumping to a stock's detail view.
 */

import { useState } from 'react'
import { Bot, Sun, Moon, KeyRound } from 'lucide-react'
import { useApp, ACTIONS } from '../../context/AppContext'
import { useAuth } from '../../../common/context/AuthContext'
import { useTheme } from '../../../common/context/ThemeContext'
import { useKeys } from '../../../common/context/KeysContext'
import StockSearch from '../StockSearch'
import UserMenu from '../UserMenu'

// Map page keys → human-readable titles
const PAGE_TITLES = {
  dashboard: 'Market Overview',
  portfolio: 'My Portfolio',
  watchlist: 'Watchlist',
  stock:     'Stock Detail',
}

export default function Header({ agentOpen, onToggleAgent }) {
  const { state, dispatch } = useApp()
  const { canTrade } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { llmConfigured } = useKeys()
  const [searchKey, setSearchKey] = useState(0)  // bump to reset StockSearch after selection

  const handleSelect = (symbol) => {
    if (!symbol) return
    dispatch({ type: ACTIONS.VIEW_STOCK, payload: symbol })
    // Reset the search box by remounting it
    setSearchKey(k => k + 1)
  }

  return (
    <header className="h-16 px-4 md:px-6 bg-surface-card border-b border-border flex items-center justify-between gap-2">
      {/* Logo + Page title */}
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <img
            src="https://t3.ftcdn.net/jpg/01/36/20/40/360_F_136204027_JgHaab2r1wqenjQd6m1PNDJ6J9PM8tvH.jpg"
            alt="TradeBuddy logo"
            className="h-8 w-8 rounded-lg object-cover"
          />
          <span className="text-primary font-bold text-sm tracking-tight hidden sm:inline">TradeBuddy</span>
        </div>

        <div className="w-px h-5 bg-surface-hover hidden sm:block" />

        <h1 className="text-secondary font-medium text-sm truncate hidden sm:block">
          {state.currentPage === 'stock' && state.selectedStock
            ? state.selectedStock
            : PAGE_TITLES[state.currentPage]}
        </h1>
      </div>

      {/* Search + User */}
      <div className="flex items-center gap-2 md:gap-3">
      {/* Search — hidden on mobile */}
      <div className="hidden md:block w-72">
        <StockSearch
          key={searchKey}
          value=""
          onChange={handleSelect}
          onClear={() => {}}
          placeholder="Search any stock or ETF…"
        />
      </div>{/* end search */}

      {/* Trading Agent toggle — only for users who can trade */}
      {canTrade && (
        <button
          onClick={llmConfigured
            ? onToggleAgent
            : () => dispatch({ type: ACTIONS.NAVIGATE, payload: 'settings' })}
          title={llmConfigured ? 'Trading Agent' : 'No AI provider configured — click to set up'}
          className={`
            relative p-2 rounded-lg transition-colors
            ${!llmConfigured
              ? 'text-yellow-400/60 hover:text-yellow-400 hover:bg-yellow-400/10 cursor-pointer'
              : agentOpen
              ? 'bg-accent-blue/20 text-accent-blue'
              : 'text-muted hover:text-primary hover:bg-surface-hover'}
          `}
        >
          <Bot size={18} />
          {/* Active dot */}
          {agentOpen && llmConfigured && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent-blue" />
          )}
          {/* Warning dot when no LLM */}
          {!llmConfigured && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-yellow-400" />
          )}
        </button>
      )}

      {/* Light / dark toggle */}
      <button
        onClick={toggleTheme}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
      >
        {isDark ? <Sun size={17} /> : <Moon size={17} />}
      </button>

      <UserMenu />
      </div>{/* end search + user */}
    </header>
  )
}
