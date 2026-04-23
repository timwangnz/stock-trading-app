/**
 * Sidebar.jsx
 * Left navigation bar for the app.
 * Highlights the active page and dispatches NAVIGATE actions.
 * Teachers see a mode toggle: Teaching ↔ Trading.
 */

import { LayoutDashboard, Briefcase, TrendingUp, Shield, BarChart2, Activity, Trophy, Lightbulb, GraduationCap, Users, ArrowLeftRight, BookOpen } from 'lucide-react'
import { useApp, ACTIONS } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import PortfolioSparkline from '../PortfolioSparkline'
import clsx from 'clsx'

// Nav for regular traders (user / premium) — no classroom-specific items
const TRADER_NAV = [
  { label: 'Dashboard',        page: 'dashboard',       icon: LayoutDashboard },
  { label: 'Portfolio',        page: 'portfolio',       icon: Briefcase },
  { label: 'History',          page: 'history',         icon: BarChart2 },
  { label: 'Ideas',            page: 'ideas',           icon: Lightbulb },
  { label: 'Activity',         page: 'activity',        icon: Activity },
  { label: 'Knowledge Base',   page: 'knowledgebase',   icon: BookOpen },
]

// Nav for students in a class — includes classroom-specific items
const STUDENT_NAV = [
  { label: 'Dashboard',        page: 'dashboard',       icon: LayoutDashboard },
  { label: 'Portfolio',        page: 'portfolio',       icon: Briefcase },
  { label: 'History',          page: 'history',         icon: BarChart2 },
  { label: 'Leaderboard',      page: 'leaderboard',     icon: Trophy },
  { label: 'Ideas',            page: 'ideas',           icon: Lightbulb },
  { label: 'Activity',         page: 'activity',        icon: Activity },
  { label: 'My Groups',        page: 'groups',          icon: Users },
  { label: 'Knowledge Base',   page: 'knowledgebase',   icon: BookOpen },
]

// Nav items shown in Teacher mode (teacher/admin only)
const TEACHER_NAV = [
  { label: 'My Classes',       page: 'classroom',       icon: GraduationCap },
  { label: 'Leaderboard',      page: 'leaderboard',     icon: Trophy },
  { label: 'Ideas',            page: 'ideas',           icon: Lightbulb },
  { label: 'Activity',         page: 'activity',        icon: Activity },
  { label: 'Knowledge Base',   page: 'knowledgebase',   icon: BookOpen },
]

export default function Sidebar({ open, onClose }) {
  const { state, dispatch }                       = useApp()
  const { isAdmin, isTeacher, isStudent, role, viewMode, toggleViewMode } = useAuth()

  const navigate = (page) => {
    dispatch({ type: ACTIONS.NAVIGATE, payload: page })
  }

  const inTeacherMode = isTeacher && viewMode === 'teacher'

  // Pick the right nav based on role:
  //  - teacher in teaching mode → TEACHER_NAV
  //  - student → STUDENT_NAV (has leaderboard + groups)
  //  - everyone else (user, premium, teacher in trading mode) → TRADER_NAV
  const navItems = inTeacherMode ? TEACHER_NAV : isStudent ? STUDENT_NAV : TRADER_NAV

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={onClose}
        />
      )}

    <aside className={clsx(
      'flex flex-col overflow-y-auto bg-surface-card border-r border-border',
      // Mobile: fixed overlay, slides in/out
      'fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200',
      open ? 'translate-x-0' : '-translate-x-full',
      // Desktop: static, always visible
      'md:static md:w-56 md:h-full md:translate-x-0 md:z-auto',
    )}>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-accent-blue" size={22} />
          <span className="text-primary font-semibold text-lg tracking-tight">
            TradeBuddy
          </span>
        </div>
        <p className="text-muted text-xs mt-0.5">
          {inTeacherMode ? 'Teacher Dashboard' : 'Portfolio & Trading'}
        </p>
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
                isActive
                  ? (inTeacherMode
                      ? 'bg-purple-400/15 text-purple-400 font-medium'
                      : 'bg-accent-blue/15 text-accent-blue font-medium')
                  : 'text-muted hover:bg-surface-hover hover:text-primary'
              )}
            >
              <Icon size={17} />
              {label}
            </button>
          )
        })}

        {/* My Classes — only for teachers in trading/student mode */}
        {isTeacher && !inTeacherMode && (
          <button
            onClick={() => navigate('classroom')}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              state.currentPage === 'classroom'
                ? 'bg-accent-blue/15 text-accent-blue font-medium'
                : 'text-muted hover:bg-surface-hover hover:text-primary'
            )}
          >
            <GraduationCap size={17} />
            My Classes
          </button>
        )}
      </nav>

      {/* Portfolio sparkline — only in student/trading mode */}
      {!inTeacherMode && <PortfolioSparkline />}

      {/* Run a Classroom — subtle CTA for regular users; classroom is a secondary feature */}
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

      {/* Admin link — only visible to admins */}
      {isAdmin && (
        <div className="px-3 pb-2">
          <button
            onClick={() => navigate('admin')}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              state.currentPage === 'admin'
                ? 'bg-orange-400/15 text-orange-400 font-medium'
                : 'text-orange-400/50 hover:bg-orange-400/10 hover:text-orange-400'
            )}
          >
            <Shield size={17} />
            Admin Panel
          </button>
        </div>
      )}

      {/* Teacher mode toggle */}
      {isTeacher && (
        <div className="px-3 pb-2">
          <button
            onClick={toggleViewMode}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors border',
              inTeacherMode
                ? 'border-purple-400/30 text-purple-400 hover:bg-purple-400/10'
                : 'border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10'
            )}
          >
            <ArrowLeftRight size={15} />
            {inTeacherMode ? 'Switch to Trading' : 'Switch to Teaching'}
          </button>
        </div>
      )}

      {/* Footer — show role badge + permissions hint */}
      <div className="px-5 py-4 border-t border-border">
        {role && (
          <div className="mb-3">
            <span className={clsx(
              'text-xs px-2 py-0.5 rounded-full border font-medium inline-block',
              role === 'admin'    && 'text-orange-400  border-orange-400/20  bg-orange-400/5',
              role === 'teacher'  && 'text-purple-400  border-purple-400/20  bg-purple-400/5',
              role === 'premium'  && 'text-yellow-400  border-yellow-400/20  bg-yellow-400/5',
              role === 'student'  && 'text-gain        border-gain/20        bg-gain/5',
              role === 'user'     && 'text-accent-blue border-accent-blue/20 bg-accent-blue/5',
              role === 'readonly' && 'text-muted        border-border',
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
              {role === 'admin'    && 'Full access + admin panel'}
              {role === 'teacher'  && (inTeacherMode ? 'Teaching mode' : 'Trading mode')}
              {role === 'premium'  && 'Full portfolio & trading access'}
              {role === 'student'  && 'Enrolled in a class'}
              {role === 'user'     && 'Full trading & portfolio access'}
              {role === 'readonly' && 'View only — no edits'}
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
