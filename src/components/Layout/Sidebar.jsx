/**
 * Sidebar.jsx
 * Left navigation bar for the app.
 * Highlights the active page and dispatches NAVIGATE actions.
 */

import { LayoutDashboard, Briefcase, Star, TrendingUp, Shield } from 'lucide-react'
import { useApp, ACTIONS } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import clsx from 'clsx'

const NAV_ITEMS = [
  { label: 'Dashboard',  page: 'dashboard',  icon: LayoutDashboard },
  { label: 'Portfolio',  page: 'portfolio',  icon: Briefcase },
  { label: 'Watchlist',  page: 'watchlist',  icon: Star },
]

export default function Sidebar() {
  const { state, dispatch } = useApp()
  const { isAdmin, role }   = useAuth()

  const navigate = (page) => {
    dispatch({ type: ACTIONS.NAVIGATE, payload: page })
  }

  return (
    <aside className="w-56 min-h-screen bg-surface-card border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-accent-blue" size={22} />
          <span className="text-primary font-semibold text-lg tracking-tight">
            TradeBuddy
          </span>
        </div>
        <p className="text-muted text-xs mt-0.5">Vibe Trading Platform</p>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ label, page, icon: Icon }) => {
          // A nav item is "active" if we're on that page,
          // OR if we're viewing a stock (which is a sub-page of the main nav)
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
                  ? 'bg-accent-blue/15 text-accent-blue font-medium'
                  : 'text-muted hover:bg-surface-hover hover:text-primary'
              )}
            >
              <Icon size={17} />
              {label}
            </button>
          )
        })}
      </nav>

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

      {/* Footer — show role badge + permissions hint */}
      <div className="px-5 py-4 border-t border-border">
        {role && (
          <div className="mb-3">
            <span className={clsx(
              'text-xs px-2 py-0.5 rounded-full border font-medium inline-block',
              role === 'admin'    && 'text-orange-400  border-orange-400/20  bg-orange-400/5',
              role === 'premium'  && 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5',
              role === 'user'     && 'text-accent-blue border-accent-blue/20 bg-accent-blue/5',
              role === 'readonly' && 'text-muted   border-border',
            )}>
              {role}
            </span>
            <p className={clsx(
              'text-xs mt-1.5 leading-relaxed',
              role === 'admin'    && 'text-orange-400/50',
              role === 'premium'  && 'text-yellow-400/50',
              role === 'user'     && 'text-accent-blue/50',
              role === 'readonly' && 'text-muted',
            )}>
              {role === 'admin'    && 'Full access + admin panel'}
              {role === 'premium'  && 'Full portfolio & watchlist access'}
              {role === 'user'     && 'Can edit portfolio & watchlist'}
              {role === 'readonly' && 'View only — no edits'}
            </p>
          </div>
        )}
        <p className="text-muted text-xs leading-relaxed">
          All data is simulated.<br />Not financial advice.
        </p>
      </div>
    </aside>
  )
}
