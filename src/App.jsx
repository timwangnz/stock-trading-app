/**
 * App.jsx
 * Root component. Shows the Login page for unauthenticated users,
 * and the full app shell for signed-in users.
 */

import { useState, useEffect }  from 'react'
import { useApp, ACTIONS }    from './context/AppContext'
import { useAuth }   from './context/AuthContext'
import Sidebar       from './components/Layout/Sidebar'
import Header        from './components/Layout/Header'
import AgentPanel    from './components/AgentPanel'
import Dashboard     from './pages/Dashboard'
import Portfolio     from './pages/Portfolio'
import Watchlist     from './pages/Watchlist'
import StockDetail   from './pages/StockDetail'
import AdminPanel    from './pages/AdminPanel'
import History       from './pages/History'
import Activity      from './pages/Activity'
import Login         from './pages/Login'
import About         from './pages/About'
import ResetPassword from './pages/ResetPassword'

const PAGES = {
  dashboard: Dashboard,
  portfolio: Portfolio,
  watchlist: Watchlist,
  stock:     StockDetail,
  admin:     AdminPanel,
  history:   History,
  activity:  Activity,
  about:     About,
}

// Read URL params once at module load (before any re-renders strip them)
const urlParams   = new URLSearchParams(window.location.search)
const RESET_TOKEN = urlParams.get('reset_token')
const SHOW_ABOUT  = urlParams.get('about') !== null
if (RESET_TOKEN || SHOW_ABOUT) window.history.replaceState({}, '', '/')

export default function App() {
  const { user, loading, isAdmin } = useAuth()
  const { state, dispatch }        = useApp()
  const [agentOpen, setAgentOpen]   = useState(false)
  const [resetToken, setResetToken] = useState(RESET_TOKEN)
  const [showAbout, setShowAbout]   = useState(SHOW_ABOUT)

  // If the user is already logged in and /?about was in the URL, navigate to About
  useEffect(() => {
    if (user && showAbout) {
      dispatch({ type: ACTIONS.NAVIGATE, payload: 'about' })
      setShowAbout(false)
    }
  }, [user, showAbout, dispatch])

  // While restoring the session from localStorage, show nothing
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
      </div>
    )
  }

  // Password reset link — show reset form regardless of auth state
  if (resetToken) {
    return <ResetPassword token={resetToken} onDone={() => setResetToken(null)} />
  }

  // Public About page — accessible without signing in
  if (!user && showAbout) {
    return (
      <div className="min-h-screen bg-surface">
        {/* Minimal header with sign-in button */}
        <div className="border-b border-border px-6 py-3 flex items-center justify-between">
          <span className="text-primary font-semibold text-sm">TradeBuddy</span>
          <button
            onClick={() => setShowAbout(false)}
            className="text-sm bg-accent-blue hover:bg-accent-blue/80 text-white px-4 py-1.5 rounded-lg transition-colors font-medium"
          >
            Sign In
          </button>
        </div>
        <About />
      </div>
    )
  }

  // Not signed in → show login page
  if (!user) return <Login onAbout={() => setShowAbout(true)} />

  // Resolve page — block non-admins from reaching the admin panel
  const requestedPage = state.currentPage
  const resolvedPage  = requestedPage === 'admin' && !isAdmin ? 'dashboard' : requestedPage
  const PageComponent = PAGES[resolvedPage] ?? Dashboard

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar className="h-full overflow-y-auto" />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          agentOpen={agentOpen}
          onToggleAgent={() => setAgentOpen(v => !v)}
        />
        <main className="flex-1 overflow-y-auto">
          <PageComponent />
        </main>
      </div>

      {/* Trading Agent right panel — available from any page */}
      <AgentPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
      />
    </div>
  )
}
