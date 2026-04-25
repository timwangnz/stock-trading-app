/**
 * Sidebar.jsx
 * Left navigation bar for the app.
 *
 * View modes:
 *   admin   → 'admin'   | 'trading'   (admins default to admin mode)
 *   teacher → 'teacher' | 'trading'   (teachers default to teacher mode)
 *   others  → always 'trading'
 */

import { LayoutDashboard, Briefcase, TrendingUp, Shield, BarChart2, Activity, Trophy,
         Lightbulb, GraduationCap, Users, ArrowLeftRight, Wand2, Bot, Megaphone, KeyRound } from 'lucide-react'
import { useApp, ACTIONS } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { useKeys } from '../../context/KeysContext'
import PortfolioSparkline from '../PortfolioSparkline'
import clsx from 'clsx'

// ── Nav definitions ───────────────────────────────────────────────

const ADMIN_NAV = [
  { label: 'Campaigns',     page: 'campaigns', icon: Megaphone },
  { label: 'Admin Panel',   page: 'admin',     icon: Shield    },
]

const TEACHER_NAV = [
  { label: 'My Classes',    page: 'classroom',    icon: GraduationCap },
  { label: 'Leaderboard',   page: 'leaderboard',  icon: Trophy        },
  { label: 'Ideas',         page: 'ideas',        icon: Lightbulb     },
  { label: 'Activity',      page: 'activity',     icon: Activity      },
  { label: 'Prompt Manager',page: 'promptmanager',icon: Wand2         },
]

const TRADER_NAV = [
  { label: 'Dashboard',     page: 'dashboard',    icon: LayoutDashboard },
  { label: 'Portfolio',     page: 'portfolio',    icon: Briefcase       },
  { label: 'AI Portfolio',  page: 'agentportfolio',icon: Bot            },
  { label: 'History',       page: 'history',      icon: BarChart2       },
  { label: 'Ideas',         page: 'ideas',        icon: Lightbulb       },
  { label: 'Activity',      page: 'activity',     icon: Activity        },
  { label: 'Prompt Manager',page: 'promptmanager',icon: Wand2           },
]

const STUDENT_NAV = [
  { label: 'Dashboard',     page: 'dashboard',    icon: LayoutDashboard },
  { label: 'Portfolio',     page: 'portfolio',    icon: Briefcase       },
  { label: 'AI Portfolio',  page: 'agentportfolio',icon: Bot            },
  { label: 'History',       page: 'history',      icon: BarChart2       },
  { label: 'Leaderboard',   page: 'leaderboard',  icon: Trophy          },
  { label: 'Ideas',         page: 'ideas',        icon: Lightbulb       },
  { label: 'Activity',      page: 'activity',     icon: Activity        },
  { label: 'My Groups',     page: 'groups',       icon: Users           },
  { label: 'Prompt Manager',page: 'promptmanager',icon: Wand2           },
]

// ── Mode-specific style tokens ────────────────────────────────────

const MODE_STYLES = {
  admin: {
    active:    'bg-orange-400/15 text-orange-400 font-medium',
    subtitle:  'Admin Dashboard',
    toggleCls: 'border-orange-400/30 text-orange-400 hover:bg-orange-400/10',
    badgeHint: 'Admin mode',
  },
  teacher: {
    active:    'bg-purple-400/15 text-purple-400 font-medium',
    subtitle:  'Teacher Dashboard',
    toggleCls: 'border-purple-400/30 text-purple-400 hover:bg-purple-400/10',
    badgeHint: 'Teaching mode',
  },
  trading: {
    active:    'bg-accent-blue/15 text-accent-blue font-medium',
    subtitle:  'Portfolio & Trading',
    toggleCls: 'border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10',
    badgeHint: 'Trading mode',
  },
}

// ── Component ─────────────────────────────────────────────────────

export default function Sidebar({ open, onClose }) {
  const { state, dispatch }  = useApp()
  const { user, isAdmin, isTeacher, isStudent, role, viewMode, toggleViewMode } = useAuth()
  const { llmConfigured } = useKeys()

  const navigate = (page) => dispatch({ type: ACTIONS.NAVIGATE, payload: page })

  // Derived mode flags
  const inAdminMode   = isAdmin   && viewMode === 'admin'
  const inTeacherMode = isTeacher && viewMode === 'teacher'

  // Current mode key for style lookup
  const modeKey = inAdminMode ? 'admin' : inTeacherMode ? 'teacher' : 'trading'
  const styles  = MODE_STYLES[modeKey]

  // Pick nav list — students get an extended trader nav with classroom items baked in
  let navItems
  if (inAdminMode)        navItems = ADMIN_NAV
  else if (inTeacherMode) navItems = TEACHER_NAV
  else if (isStudent)     navItems = STUDENT_NAV
  else                    navItems = TRADER_NAV

  // First page of each mode — where we land after a mode switch
  const FIRST_PAGE = {
    admin:   'campaigns',
    teacher: 'classroom',
    trading: 'dashboard',
  }

  // Compute the next mode (mirrors AuthContext cycle logic) so we can navigate
  const nextMode = (() => {
    if (isAdmin && isTeacher) {
      if (viewMode === 'admin')   return 'teacher'
      if (viewMode === 'teacher') return 'trading'
      return 'admin'
    }
    if (isAdmin)   return viewMode === 'admin'   ? 'trading' : 'admin'
    if (isTeacher) return viewMode === 'teacher' ? 'trading' : 'teacher'
    return 'trading'
  })()

  // Label shows the NEXT mode in the cycle
  const toggleLabel = (() => {
    if (isAdmin && isTeacher) {
      if (viewMode === 'admin')   return 'Switch to Teaching'
      if (viewMode === 'teacher') return 'Switch to Trading'
      return 'Switch to Admin'
    }
    if (isAdmin)   return viewMode === 'admin'   ? 'Switch to Trading' : 'Switch to Admin'
    if (isTeacher) return viewMode === 'teacher' ? 'Switch to Trading' : 'Switch to Teaching'
    return null
  })()

  const handleToggle = () => {
    toggleViewMode(user)
    navigate(FIRST_PAGE[nextMode])
  }

  // Show the toggle for admins and teachers only
  const showToggle = isAdmin || isTeacher

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onClose} />
      )}

      <aside className={clsx(
        'flex flex-col overflow-y-auto bg-surface-card border-r border-border',
        'fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200',
        open ? 'translate-x-0' : '-translate-x-full',
        'md:static md:w-56 md:h-full md:translate-x-0 md:z-auto',
      )}>
        {/* Logo */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-accent-blue" size={22} />
            <span className="text-primary font-semibold text-lg tracking-tight">TradeBuddy</span>
          </div>
          <p className="text-muted text-xs mt-0.5">{styles.subtitle}</p>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ label, page, icon: Icon }) => {
            const isActive =
              state.currentPage === page ||
              (state.currentPage === 'stock' && page === 'dashboard')
            return (
              <button
                key={page}
                onClick={() => navigate(page)}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                  isActive ? styles.active : 'text-muted hover:bg-surface-hover hover:text-primary'
                )}
              >
                <Icon size={17} />
                {label}
              </button>
            )
          })}

        </nav>

        {/* Portfolio sparkline — trading mode only */}
        {modeKey === 'trading' && <PortfolioSparkline />}

        {/* Run a Classroom CTA — regular users only */}
        {(role === 'user' || role === 'premium') && (
          <div className="px-3 pb-2">
            <button
              onClick={() => navigate('classroom')}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors',
                state.currentPage === 'classroom'
                  ? 'bg-purple-400/15 text-purple-400 font-medium'
                  : 'text-muted/50 hover:bg-surface-hover hover:text-muted'
              )}
            >
              <GraduationCap size={14} />
              Run a Classroom
            </button>
          </div>
        )}

        {/* My Keys — always visible, badge when LLM not configured */}
        <div className="px-3 pb-1">
          <button
            onClick={() => navigate('settings')}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              state.currentPage === 'settings'
                ? 'bg-accent-blue/15 text-accent-blue font-medium'
                : 'text-muted hover:bg-surface-hover hover:text-primary'
            )}
          >
            <KeyRound size={17} />
            My Keys
            {!llmConfigured && (
              <span className="ml-auto w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" title="No AI provider configured" />
            )}
          </button>
        </div>

        {/* Mode toggle — admins and teachers */}
        {showToggle && (
          <div className="px-3 pb-2">
            <button
              onClick={handleToggle}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors border',
                styles.toggleCls
              )}
            >
              <ArrowLeftRight size={15} />
              {toggleLabel}
            </button>
          </div>
        )}

        {/* Footer — role badge */}
        <div className="px-5 py-4 border-t border-border">
          {role && (
            <div className="mb-3">
              <span className={clsx(
                'text-xs px-2 py-0.5 rounded-full border font-medium inline-block',
                role === 'admin'    && 'text-orange-400 border-orange-400/20 bg-orange-400/5',
                role === 'teacher'  && 'text-purple-400 border-purple-400/20 bg-purple-400/5',
                role === 'premium'  && 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5',
                role === 'student'  && 'text-gain       border-gain/20       bg-gain/5',
                role === 'user'     && 'text-accent-blue border-accent-blue/20 bg-accent-blue/5',
                role === 'readonly' && 'text-muted       border-border',
              )}>
                {role}
              </span>
              <p className={clsx(
                'text-xs mt-1.5 leading-relaxed',
                role === 'admin'    && 'text-orange-400/50',
                role === 'teacher'  && 'text-purple-400/50',
                role === 'premium'  && 'text-yellow-400/50',
                role === 'student'  && 'text-gain/50',
                role === 'user'     && 'text-accent-blue/50',
                role === 'readonly' && 'text-muted',
              )}>
                {role === 'admin'   && styles.badgeHint}
                {role === 'teacher' && styles.badgeHint}
                {role === 'premium' && 'Full portfolio & trading access'}
                {role === 'student' && 'Enrolled in a class'}
                {role === 'user'    && 'Full trading & portfolio access'}
                {role === 'readonly'&& 'View only — no edits'}
              </p>
            </div>
          )}
          <p className="text-muted text-xs leading-relaxed">
            All data is simulated.<br />Not financial advice.
          </p>
        </div>
      </aside>
    </>
  )
}
