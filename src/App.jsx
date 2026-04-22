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
import StockDetail   from './pages/StockDetail'
import AdminPanel    from './pages/AdminPanel'
import History       from './pages/History'
import Activity      from './pages/Activity'
import Login         from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Classroom     from './pages/Classroom'
import Leaderboard   from './pages/Leaderboard'
import Ideas         from './pages/Ideas'
import Groups        from './pages/Groups'
import KnowledgeBase from './pages/KnowledgeBase'

const PAGES = {
  dashboard:     Dashboard,
  portfolio:     Portfolio,
  stock:         StockDetail,
  admin:         AdminPanel,
  history:       History,
  activity:      Activity,
  classroom:     Classroom,
  leaderboard:   Leaderboard,
  ideas:         Ideas,
  groups:        Groups,
  knowledgebase: KnowledgeBase,
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
