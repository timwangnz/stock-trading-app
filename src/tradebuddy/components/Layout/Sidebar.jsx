/**
 * Sidebar.jsx
 * Left navigation bar for the app.
 *
 * View modes:
 *   admin   → 'admin'   | 'trading'   (admins default to admin mode)
 *   teacher → 'teacher' | 'trading'   (teachers default to teacher mode)
 *   others  → always 'trading'
 *
 * Collapsed state (desktop only):
 *   open=true  → w-56, shows icons + labels
 *   open=false → w-14, shows icons only with title tooltips
 *   Mobile always uses full-width overlay; icon-only doesn't apply.
 */

import { LayoutDashboard, Briefcase, TrendingUp, Shield, BarChart2, Activity, Trophy,
         Lightbulb, GraduationCap, Users, ArrowLeftRight, Wand2, Bot, Megaphone,
         KeyRound, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useApp, ACTIONS } from '../../context/AppContext'
import { useAuth } from '../../../common/context/AuthContext'
import { useKeys } from '../../../common/context/KeysContext'
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

export default function Sidebar({ open, onToggle }) {
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

  // Pick nav list
  let navItems
  if (inAdminMode)        navItems = ADMIN_NAV
  else if (inTeacherMode) navItems = TEACHER_NAV
  else if (isStudent)     navItems = STUDENT_NAV
  else                    navItems = TRADER_NAV

  // First page of each mode
  const FIRST_PAGE = { admin: 'campaigns', teacher: 'classroom', trading: 'dashboard' }

  // Next mode in the cycle
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

  const showToggle = isAdmin || isTeacher

  // Shared nav button class builder
  const navBtn = (isActive, extraCls = '') => clsx(
    'w-full flex items-center rounded-lg text-sm transition-colors',
    open ? 'gap-3 px-3 py-2.5' : 'justify-center py-2.5',
    isActive ? styles.active : 'text-muted hover:bg-surface-hover hover:text-primary',
    extraCls,
  )

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onToggle} />
      )}

      <aside className={clsx(
        'flex flex-col bg-surface-card border-r border-border shrink-0',
        // Mobile: fixed overlay, full width, slides in/out
        'fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto transition-transform duration-200',
        open ? 'translate-x-0' : '-translate-x-full',
        // Desktop: static in flow, width animates between expanded and icon-only
        'md:relative md:inset-auto md:z-auto md:translate-x-0 md:h-full md:overflow-y-auto',
        'md:transition-[width] md:duration-200 md:overflow-x-hidden',
        open ? 'md:w-56' : 'md:w-14',
      )}>

        {/* ── Header: logo + toggle button ── */}
        <div className={clsx(
          'flex items-center border-b border-border shrink-0 h-16',
          open ? 'px-4 gap-2' : 'justify-center px-0',
        )}>
          {open && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <TrendingUp className="text-accent-blue shrink-0" size={20} />
              <div className="min-w-0">
                <p className="text-primary font-semibold text-base tracking-tight leading-tight truncate">TradeBuddy</p>
                <p className="text-muted text-xs truncate">{styles.subtitle}</p>
              </div>
            </div>
          )}
          <button
            onClick={onToggle}
            title={open ? 'Collapse sidebar' : 'Expand sidebar'}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors shrink-0"
          >
            {open
              ? <PanelLeftClose size={18} />
              : <PanelLeftOpen  size={18} />
            }
          </button>
        </div>

        {/* ── Navigation links ── */}
        <nav className={clsx('flex-1 py-4 space-y-1 overflow-y-auto', open ? 'px-3' : 'px-2')}>
          {navItems.map(({ label, page, icon: Icon }) => {
            const isActive =
              state.currentPage === page ||
              (state.currentPage === 'stock' && page === 'dashboard')
            return (
              <button
                key={page}
                onClick={() => navigate(page)}
                title={!open ? label : undefined}
                className={navBtn(isActive)}
              >
                <Icon size={17} className="shrink-0" />
                {open && <span className="truncate">{label}</span>}
              </button>
            )
          })}
        </nav>

        {/* ── Portfolio sparkline — expanded + trading mode only ── */}
        {open && modeKey === 'trading' && <PortfolioSparkline />}

        {/* ── Run a Classroom CTA — regular users only ── */}
        {(role === 'user' || role === 'premium') && (
          <div className={clsx('pb-2', open ? 'px-3' : 'px-2')}>
            <button
              onClick={() => navigate('classroom')}
              title={!open ? 'Run a Classroom' : undefined}
              className={clsx(
                'w-full flex items-center rounded-lg text-xs transition-colors',
                open ? 'gap-3 px-3 py-2' : 'justify-center py-2',
                state.currentPage === 'classroom'
                  ? 'bg-purple-400/15 text-purple-400 font-medium'
                  : 'text-muted/50 hover:bg-surface-hover hover:text-muted'
              )}
            >
              <GraduationCap size={14} className="shrink-0" />
              {open && 'Run a Classroom'}
            </button>
          </div>
        )}

        {/* ── My Keys ── */}
        <div className={clsx('pb-1', open ? 'px-3' : 'px-2')}>
          <button
            onClick={() => navigate('settings')}
            title={!open ? 'My Keys' : undefined}
            className={clsx(
              'relative w-full flex items-center rounded-lg text-sm transition-colors',
              open ? 'gap-3 px-3 py-2.5' : 'justify-center py-2.5',
              state.currentPage === 'settings'
                ? 'bg-accent-blue/15 text-accent-blue font-medium'
                : 'text-muted hover:bg-surface-hover hover:text-primary'
            )}
          >
            <KeyRound size={17} className="shrink-0" />
            {open && <span className="truncate">My Keys</span>}
            {!llmConfigured && open && (
              <span className="ml-auto w-2 h-2 rounded-full bg-yellow-400 shrink-0" title="No AI provider configured" />
            )}
            {!llmConfigured && !open && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-yellow-400" />
            )}
          </button>
        </div>

        {/* ── Mode toggle — admins and teachers ── */}
        {showToggle && (
          <div className={clsx('pb-2', open ? 'px-3' : 'px-2')}>
            <button
              onClick={handleToggle}
              title={!open ? toggleLabel : undefined}
              className={clsx(
                'w-full flex items-center rounded-lg text-sm transition-colors border',
                open ? 'gap-3 px-3 py-2.5' : 'justify-center py-2.5',
                styles.toggleCls
              )}
            >
              <ArrowLeftRight size={15} className="shrink-0" />
              {open && <span className="truncate">{toggleLabel}</span>}
            </button>
          </div>
        )}

        {/* ── Footer — role badge + disclaimer, expanded only ── */}
        {open && (
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
                  {role === 'admin'    && styles.badgeHint}
                  {role === 'teacher'  && styles.badgeHint}
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
        )}

      </aside>
    </>
  )
}
