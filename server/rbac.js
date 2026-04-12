/**
 * server/rbac.js
 * Role-Based Access Control definitions and Express middleware.
 *
 * Role hierarchy (highest → lowest):
 *   admin  >  premium  >  user  >  readonly
 *
 * Usage in routes:
 *   import { requireRole, requirePermission, PERMISSIONS } from './rbac.js'
 *
 *   app.put('/api/portfolio/:symbol', authMiddleware, requirePermission(PERMISSIONS.TRADE), ...)
 *   app.get('/api/admin/users',       authMiddleware, requireRole('admin'), ...)
 */

// ── Role hierarchy ─────────────────────────────────────────────
// Higher index = more permissions. Used to check "at least this role".
export const ROLE_HIERARCHY = ['readonly', 'user', 'premium', 'admin']

// ── Permissions ────────────────────────────────────────────────
// Named permissions map to the minimum role required.
export const PERMISSIONS = {
  TRADE:       'user',     // buy / sell / add to portfolio
  WATCHLIST:   'user',     // add / remove watchlist items
  VIEW:        'readonly', // view portfolio, watchlist, charts
  ADMIN:       'admin',    // access the admin panel
}

/**
 * Check if a role has at least the required level.
 * e.g. hasRole('premium', 'user') → true
 *      hasRole('readonly', 'user') → false
 */
export function hasRole(userRole, requiredRole) {
  const userIdx     = ROLE_HIERARCHY.indexOf(userRole)
  const requiredIdx = ROLE_HIERARCHY.indexOf(requiredRole)
  if (userIdx === -1 || requiredIdx === -1) return false
  return userIdx >= requiredIdx
}

/**
 * Express middleware — requires the user to have at least `role`.
 * Must be placed AFTER authMiddleware (which sets req.user).
 *
 * Example:  requireRole('admin')
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    if (!hasRole(req.user.role, role)) {
      return res.status(403).json({
        error: `Forbidden — requires role: ${role}. Your role: ${req.user.role}`,
      })
    }
    next()
  }
}

/**
 * Express middleware — requires the user to have the role that grants `permission`.
 * Uses the PERMISSIONS map above to look up the minimum required role.
 *
 * Example:  requirePermission(PERMISSIONS.TRADE)
 */
export function requirePermission(permission) {
  return requireRole(permission)
}
