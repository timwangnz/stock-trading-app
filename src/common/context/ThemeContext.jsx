/**
 * ThemeContext.jsx
 * Provides light/dark theme switching for the entire app.
 *
 * - Persists the user's preference in localStorage
 * - Sets data-theme="dark" on <html> so CSS variables swap automatically
 * - Exposes `chart` and `pieColors` for recharts (which can't read CSS vars)
 */

import { createContext, useContext, useEffect, useState } from 'react'
import { THEMES } from '../theme'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'tradebuddy_theme'

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    // Restore saved preference, or default to light
    return localStorage.getItem(STORAGE_KEY) ?? 'light'
  })

  // Apply data-theme attribute to <html> whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light')

  const value = {
    theme,
    isDark: theme === 'dark',
    toggleTheme,
    // Chart values for recharts inline props (can't use CSS vars there)
    chart:     THEMES[theme].chart,
    pieColors: THEMES[theme].pieColors,
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
