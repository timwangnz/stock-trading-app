/**
 * App.jsx
 * Root component. Shows the Login page for unauthenticated users,
 * and the full app shell for signed-in users.
 */

import { useState, useEffect }  from 'react'
import { useApp, ACTIONS }    from './tradebuddy/context/AppContext'
import { useAuth }   from './common/context/AuthContext'
import Sidebar       from './tradebuddy/components/Layout/Sidebar'
import Header        from './tradebuddy/components/Layout/Header'
import AgentPanel    from './tradebuddy/components/AgentPanel'
import Dashboard     from './tradebuddy/pages/Dashboard'
import Portfolio     from './tradebuddy/pages/Portfolio'
import StockDetail   from './tradebuddy/pages/StockDetail'
import AdminPanel    from './tradebuddy/pages/AdminPanel'
import History       from './tradebuddy/pages/History'
import Activity      from './tradebuddy/pages/Activity'
import Login         from './tradebuddy/pages/Login'
import ResetPassword from './tradebuddy/pages/ResetPassword'
import Classroom     from './tradebuddy/pages/Classroom'
import Leaderboard   from './tradebuddy/pages/Leaderboard'
import Ideas         from './tradebuddy/pages/Ideas'
import Groups        from './tradebuddy/pages/Groups'
import PromptManager     from './tradebuddy/pages/PromptManager'
import CustomerProfile  from './tradebuddy/pages/CustomerProfile'
import AgentPortfolio   from './tradebuddy/pages/AgentPortfolio'
import Campaigns        from './tradebuddy/pages/Campaigns'
import Settings         from './tradebuddy/pages/Settings'

const PAGES = {
  dashboard:       Dashboard,
  portfolio:       Portfolio,
  stock:           StockDetail,
  admin:           AdminPanel,
  history:         History,
  activity:        Activity,
  classroom:       Classroom,
  leaderboard:     Leaderboard,
  ideas:           Ideas,
  groups:          Groups,
  promptmanager:   PromptManager,
  customerprofile: CustomerProfile,
  agentportfolio:  AgentPortfolio,
  campaigns:       Campaigns,
  settings:        Settings,
}

// Read URL params once at module load (before any re-renders strip them)
const urlParams   = new URLSearchParams(window.location.search)
const RESET_TOKEN = urlParams.get('reset_token')
const JOIN_TOKEN  = urlParams.get('join')
if (RESET_TOKEN || JOIN_TOKEN) window.history.replaceState({}, '', '/')

export default function App() {
  const { user, loading, isAdmin } = useAuth()
  const { state, dispatch }        = useApp()
  const [agentOpen, setAgentOpen]   = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [resetToken, setResetToken] = useState(RESET_TOKEN)
  const [joinToken, setJoinToken]   = useState(JOIN_TOKEN)
  const [joinMsg,   setJoinMsg]     = useState(null)

  // Auto-join class when user is logged in and a join token is in the URL
  useEffect(() => {
    if (!user || !joinToken) return
    import('./services/apiService').then(({ joinClass }) => {
      joinClass(joinToken)
        .then(res => setJoinMsg(`🎉 You joined ${res.class_name}! Check the Leaderboard and Ideas tabs.`))
        .catch(err => setJoinMsg(`Could not join class: ${err.message}`))
        .finally(() => setJoinToken(null))
    })
  }, [user, joinToken])

  // On mobile, close the sidebar overlay when navigating
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false)
  }, [state.currentPage])

  const toggleSidebar = () => setSidebarOpen(v => !v)

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

  // Not signed in → show login page
  if (!user) return <Login />

  // Resolve page — block non-admins from admin-only pages
  const requestedPage = state.currentPage
  const isAdminPage   = requestedPage === 'admin' || requestedPage === 'campaigns'
  const resolvedPage  = isAdminPage && !isAdmin ? 'dashboard' : requestedPage
  const PageComponent = PAGES[resolvedPage] ?? Dashboard

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar open={sidebarOpen} onToggle={toggleSidebar} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          agentOpen={agentOpen}
          onToggleAgent={() => setAgentOpen(v => !v)}
        />
        {joinMsg && (
          <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-gain/10 border border-gain/30 text-gain text-sm flex items-center justify-between">
            <span>{joinMsg}</span>
            <button onClick={() => setJoinMsg(null)} className="ml-4 text-gain/60 hover:text-gain text-lg leading-none">×</button>
          </div>
        )}
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
