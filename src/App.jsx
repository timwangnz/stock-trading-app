/**
 * App.jsx
 * Root component. Shows the Login page for unauthenticated users,
 * and the full app shell for signed-in users.
 */

import { useState }  from 'react'
import { useApp }    from './context/AppContext'
import { useAuth }   from './context/AuthContext'
import Sidebar       from './components/Layout/Sidebar'
import Header        from './components/Layout/Header'
import AgentPanel    from './components/AgentPanel'
import Dashboard     from './pages/Dashboard'
import Portfolio     from './pages/Portfolio'
import Watchlist     from './pages/Watchlist'
import StockDetail   from './pages/StockDetail'
import AdminPanel    from './pages/AdminPanel'
import Login         from './pages/Login'

const PAGES = {
  dashboard: Dashboard,
  portfolio: Portfolio,
  watchlist: Watchlist,
  stock:     StockDetail,
  admin:     AdminPanel,
}

export default function App() {
  const { user, loading, isAdmin } = useAuth()
  const { state }                  = useApp()
  const [agentOpen, setAgentOpen]  = useState(false)

  // While restoring the session from localStorage, show nothing
  // (avoids a flash of the login page on refresh)
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
      </div>
    )
  }

  // Not signed in → show login page
  if (!user) return <Login />

  // Resolve page — block non-admins from reaching the admin panel
  const requestedPage = state.currentPage
  const resolvedPage  = requestedPage === 'admin' && !isAdmin ? 'dashboard' : requestedPage
  const PageComponent = PAGES[resolvedPage] ?? Dashboard

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
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
