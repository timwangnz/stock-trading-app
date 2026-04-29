/**
 * server/classes.js
 * Classroom management, invite flow, and leaderboard routes.
 *
 * Mounted at /api/classes and /api/leaderboard in server/index.js
 */

import { Router }  from 'express'
import crypto      from 'crypto'
import pool        from '../common/db.js'
import { sendClassInviteEmail } from '../common/email.js'
import { signJwt } from '../common/auth.js'

export const classRouter      = Router()
export const leaderboardRouter = Router()
export const groupRouter       = Router()

// ── Helpers ──────────────────────────────────────────────────────

/** Generate a short readable join code e.g. "BULL-7X3K" */
function makeJoinCode() {
  const words  = ['BULL','BEAR','HAWK','WOLF','LION','APEX','PEAK','RISE','BOLD','EDGE']
  const word   = words[Math.floor(Math.random() * words.length)]
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `${word}-${suffix}`
}

/** Resolve the user's latest portfolio value (from snapshots or 0). */
async function currentPortfolioValue(userId) {
  const { rows } = await pool.query(
    `SELECT total_value FROM portfolio_snapshots
     WHERE user_id = $1
     ORDER BY date DESC LIMIT 1`,
    [userId]
  )
  return rows[0] ? parseFloat(rows[0].total_value) : 0
}

/** Middleware: req.user must be teacher or admin */
function teacherOnly(req, res, next) {
  if (!['teacher', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Teacher or admin role required' })
  }
  next()
}

// ── Classes CRUD ──────────────────────────────────────────────────

// POST /api/classes — create a new class (teacher/admin only)
classRouter.post('/', teacherOnly, async (req, res) => {
  const { name, school_name, state, country = 'US', start_balance = 100000, start_date, end_date, ideas_public = false } = req.body
  if (!name || !school_name || !state) {
    return res.status(400).json({ error: 'name, school_name, and state are required' })
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO classes (name, teacher_id, school_name, state, country, start_balance, start_date, end_date, ideas_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, req.user.id, school_name, state, country, start_balance,
       start_date || new Date().toISOString().split('T')[0], end_date || null, ideas_public]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/classes — list classes for current teacher (or all for admin)
classRouter.get('/', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin'
    const { rows } = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM class_members WHERE class_id = c.id) AS member_count
       FROM classes c
       WHERE ${isAdmin ? 'TRUE' : 'c.teacher_id = $1'}
       ORDER BY c.created_at DESC`,
      isAdmin ? [] : [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/classes/mine — classes the current user is a member of
classRouter.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, cm.joined_at, cm.base_value,
              u.name AS teacher_name
       FROM class_members cm
       JOIN classes c ON c.id = cm.class_id
       JOIN users   u ON u.id = c.teacher_id
       WHERE cm.user_id = $1
       ORDER BY cm.joined_at DESC`,
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/classes/:id — class detail + enriched member list
// Returns per-member: trade_count, holdings_count, last_active, idea_count
classRouter.get('/:id', async (req, res) => {
  try {
    const { rows: cls } = await pool.query('SELECT * FROM classes WHERE id = $1', [req.params.id])
    if (!cls.length) return res.status(404).json({ error: 'Class not found' })

    // Only teacher of the class or admin can see full details
    const c = cls[0]
    if (c.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { rows: members } = await pool.query(
      `SELECT
         u.id, u.name, u.email, u.avatar_url,
         cm.joined_at, cm.base_value,
         COALESCE(stats.trade_count, 0)      AS trade_count,
         COALESCE(holdings.holdings_count, 0) AS holdings_count,
         COALESCE(ideas.idea_count, 0)       AS idea_count,
         stats.last_active
       FROM class_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN (
         SELECT
           user_id,
           COUNT(*)                                        AS trade_count,
           MAX(created_at)                                 AS last_active
         FROM audit_log
         WHERE action IN ('buy','sell','remove_holding')
         GROUP BY user_id
       ) stats ON stats.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS holdings_count
         FROM portfolio
         GROUP BY user_id
       ) holdings ON holdings.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS idea_count
         FROM trading_ideas
         WHERE class_id = $1
         GROUP BY user_id
       ) ideas ON ideas.user_id = u.id
       WHERE cm.class_id = $1
       ORDER BY cm.joined_at ASC`,
      [req.params.id]
    )
    res.json({ ...c, members })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/classes/:id/members/:userId — student drill-down (teacher/admin only)
// Returns the student's portfolio holdings + recent trade activity
classRouter.get('/:id/members/:userId', async (req, res) => {
  try {
    const classId = parseInt(req.params.id)
    const { userId } = req.params

    // Verify class exists and requester is teacher/admin
    const { rows: cls } = await pool.query('SELECT * FROM classes WHERE id = $1', [classId])
    if (!cls.length) return res.status(404).json({ error: 'Class not found' })
    if (cls[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Verify student is actually in the class
    const { rows: membership } = await pool.query(
      'SELECT * FROM class_members WHERE class_id = $1 AND user_id = $2',
      [classId, userId]
    )
    if (!membership.length) return res.status(404).json({ error: 'Student not in class' })

    // Portfolio holdings
    const { rows: holdings } = await pool.query(
      `SELECT symbol, shares, avg_cost, updated_at
       FROM portfolio WHERE user_id = $1
       ORDER BY symbol ASC`,
      [userId]
    )

    // Recent trade activity (last 50)
    const { rows: activity } = await pool.query(
      `SELECT id, action, details, created_at
       FROM audit_log
       WHERE user_id = $1 AND action IN ('buy','sell','remove_holding')
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    )

    // Student profile
    const { rows: user } = await pool.query(
      'SELECT id, name, email, avatar_url FROM users WHERE id = $1',
      [userId]
    )

    res.json({ student: user[0], holdings, activity })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/classes/:id — update class settings
classRouter.put('/:id', teacherOnly, async (req, res) => {
  try {
    const { rows: cls } = await pool.query('SELECT * FROM classes WHERE id = $1', [req.params.id])
    if (!cls.length) return res.status(404).json({ error: 'Class not found' })
    if (cls[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }
    const { name, school_name, state, country, end_date, ideas_public } = req.body
    const { rows } = await pool.query(
      `UPDATE classes SET
         name         = COALESCE($1, name),
         school_name  = COALESCE($2, school_name),
         state        = COALESCE($3, state),
         country      = COALESCE($4, country),
         end_date     = COALESCE($5, end_date),
         ideas_public = COALESCE($6, ideas_public)
       WHERE id = $7 RETURNING *`,
      [name, school_name, state, country, end_date, ideas_public, req.params.id]
    )
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Invites ───────────────────────────────────────────────────────

// POST /api/classes/:id/invite — send email invites to a list of students
classRouter.post('/:id/invite', teacherOnly, async (req, res) => {
  const { emails } = req.body   // array of email strings
  if (!Array.isArray(emails) || !emails.length) {
    return res.status(400).json({ error: 'emails array required' })
  }

  try {
    const { rows: cls } = await pool.query('SELECT * FROM classes WHERE id = $1', [req.params.id])
    if (!cls.length) return res.status(404).json({ error: 'Class not found' })
    if (cls[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    const appUrl  = process.env.APP_URL || 'http://localhost:3001'
    const results = []

    for (const rawEmail of emails) {
      const email = rawEmail.trim().toLowerCase()
      if (!email) continue

      // Skip if already a member
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM class_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.class_id = $1 AND u.email = $2`,
        [req.params.id, email]
      )
      if (existing.length) { results.push({ email, status: 'already_member' }); continue }

      // Generate token (7-day expiry)
      const token     = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 7 * 864e5)

      await pool.query(
        `INSERT INTO class_invites (class_id, email, token, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (token) DO NOTHING`,
        [req.params.id, email, token, expiresAt]
      )

      const joinUrl = `${appUrl}?join=${token}`
      try {
        await sendClassInviteEmail({
          to:          email,
          className:   cls[0].name,
          schoolName:  cls[0].school_name,
          teacherName: req.user.name || req.user.email,
          joinUrl,
        })
        results.push({ email, status: 'sent' })
      } catch (_) {
        results.push({ email, status: 'email_failed', joinUrl })
      }
    }

    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/classes/join — accept an invite token (any logged-in user)
classRouter.post('/join', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'token required' })

  try {
    const { rows } = await pool.query(
      `SELECT ci.*, c.name AS class_name, c.school_name
       FROM class_invites ci
       JOIN classes c ON c.id = ci.class_id
       WHERE ci.token = $1`,
      [token]
    )
    if (!rows.length) return res.status(404).json({ error: 'Invite not found or already used' })

    const invite = rows[0]
    if (invite.accepted_at) return res.status(400).json({ error: 'Invite already accepted' })
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invite has expired' })
    }

    // Check not already a member
    const { rows: already } = await pool.query(
      'SELECT 1 FROM class_members WHERE class_id = $1 AND user_id = $2',
      [invite.class_id, req.user.id]
    )
    if (already.length) {
      return res.status(400).json({ error: 'You are already a member of this class' })
    }

    // Snapshot current portfolio value as base
    const baseValue = await currentPortfolioValue(req.user.id)

    await pool.query(
      `INSERT INTO class_members (class_id, user_id, base_value) VALUES ($1, $2, $3)`,
      [invite.class_id, req.user.id, baseValue]
    )
    await pool.query(
      `UPDATE class_invites SET accepted_at = NOW() WHERE id = $1`,
      [invite.id]
    )

    // Promote to 'student' role — only if not already a higher-privileged user.
    // This is the ONLY place in the codebase that assigns the student role.
    const promotableRoles = ['readonly', 'user']
    let updatedUser = req.user
    if (promotableRoles.includes(req.user.role)) {
      const { rows: updated } = await pool.query(
        `UPDATE users SET role = 'student' WHERE id = $1 RETURNING *`,
        [req.user.id]
      )
      updatedUser = updated[0]
    }

    // Return a fresh JWT so the client's role reflects 'student' immediately
    const newToken = signJwt(updatedUser)
    res.json({
      token:       newToken,
      user:        { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role, avatar_url: updatedUser.avatar_url },
      class_id:    invite.class_id,
      class_name:  invite.class_name,
      school_name: invite.school_name,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Leaderboards ──────────────────────────────────────────────────

/** Build a ranked leaderboard from a list of members with base_value. */
async function buildLeaderboard(members) {
  const ranked = await Promise.all(members.map(async (m) => {
    const current = await currentPortfolioValue(m.user_id)
    const base    = parseFloat(m.base_value) || 0
    const returnPct = base > 0 ? ((current - base) / base) * 100 : 0
    return {
      user_id:     m.user_id,
      name:        m.name,
      avatar_url:  m.avatar_url,
      school_name: m.school_name,
      state:       m.state,
      class_name:  m.class_name,
      base_value:  base,
      current_value: current,
      return_pct:  parseFloat(returnPct.toFixed(2)),
    }
  }))
  ranked.sort((a, b) => b.return_pct - a.return_pct)
  return ranked.map((r, i) => ({ rank: i + 1, ...r }))
}

// GET /api/leaderboard/class/:id — class leaderboard
leaderboardRouter.get('/class/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cm.user_id, cm.base_value,
              u.name, u.avatar_url,
              c.school_name, c.state, c.name AS class_name
       FROM class_members cm
       JOIN users   u ON u.id = cm.user_id
       JOIN classes c ON c.id = cm.class_id
       WHERE cm.class_id = $1`,
      [req.params.id]
    )
    res.json(await buildLeaderboard(rows))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/leaderboard/state/:state — all students in all classes in that state
leaderboardRouter.get('/state/:state', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cm.user_id, cm.base_value,
              u.name, u.avatar_url,
              c.school_name, c.state, c.name AS class_name
       FROM class_members cm
       JOIN users   u ON u.id = cm.user_id
       JOIN classes c ON c.id = cm.class_id
       WHERE LOWER(c.state) = LOWER($1)`,
      [req.params.state]
    )
    res.json(await buildLeaderboard(rows))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/leaderboard/national — all students in all classes
leaderboardRouter.get('/national', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cm.user_id, cm.base_value,
              u.name, u.avatar_url,
              c.school_name, c.state, c.name AS class_name
       FROM class_members cm
       JOIN users   u ON u.id = cm.user_id
       JOIN classes c ON c.id = cm.class_id`
    )
    res.json(await buildLeaderboard(rows))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Related stocks ────────────────────────────────────────────────

// GET /api/classes/:id/related-stocks?symbol=AAPL
// Returns stocks most commonly co-held by class members who also hold :symbol.
// Accessible to any class member, teacher, or admin.
classRouter.get('/:id/related-stocks', async (req, res) => {
  const classId = parseInt(req.params.id)
  const symbol  = (req.query.symbol ?? '').toUpperCase()
  const userId  = req.user.id

  if (!symbol) return res.status(400).json({ error: 'symbol query param required' })

  try {
    // Access check
    const { rows: access } = await pool.query(
      `SELECT 1 FROM classes c
       LEFT JOIN class_members cm ON cm.class_id = c.id AND cm.user_id = $1
       WHERE c.id = $2 AND (c.teacher_id = $1 OR $3 = 'admin' OR cm.user_id IS NOT NULL)`,
      [userId, classId, req.user.role]
    )
    if (!access.length) return res.status(403).json({ error: 'Access denied' })

    // Find symbols co-held by classmates who hold :symbol
    const { rows } = await pool.query(
      `SELECT p2.symbol,
              COUNT(DISTINCT p2.user_id)::int AS holder_count,
              json_agg(
                json_build_object('name', u.name, 'avatar_url', u.avatar_url)
                ORDER BY u.name
              ) AS holders
       FROM portfolio p1
       JOIN class_members cm ON cm.user_id = p1.user_id AND cm.class_id = $1
       JOIN portfolio p2     ON p2.user_id = p1.user_id AND p2.symbol != $2
       JOIN users u           ON u.id = p2.user_id
       WHERE p1.symbol = $2
       GROUP BY p2.symbol
       ORDER BY holder_count DESC, p2.symbol
       LIMIT 12`,
      [classId, symbol]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Class activity feed ───────────────────────────────────────────

// GET /api/classes/:id/activity — audit entries for all class members
// Accessible to: teacher of the class, admin, or any class member
classRouter.get('/:id/activity', async (req, res) => {
  const classId = parseInt(req.params.id)
  const limit   = Math.min(parseInt(req.query.limit  ?? 100), 500)
  const offset  = parseInt(req.query.offset ?? 0)
  const userId  = req.user.id

  try {
    // Check access: must be teacher, admin, or a member
    const { rows: access } = await pool.query(
      `SELECT 1 FROM classes c
       LEFT JOIN class_members cm ON cm.class_id = c.id AND cm.user_id = $1
       WHERE c.id = $2 AND (c.teacher_id = $1 OR $3 = 'admin' OR cm.user_id IS NOT NULL)`,
      [userId, classId, req.user.role]
    )
    if (!access.length) return res.status(403).json({ error: 'Access denied' })

    // Fetch trade/watchlist actions for all class members
    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, a.action, a.details, a.created_at,
              u.name AS user_name, u.avatar_url
       FROM audit_log a
       JOIN class_members cm ON cm.user_id = a.user_id AND cm.class_id = $1
       JOIN users u ON u.id = a.user_id
       WHERE a.action IN ('buy','sell','add_holding','remove_holding',
                          'add_watchlist','remove_watchlist',
                          'agent_buy','agent_sell','agent_remove')
       ORDER BY a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [classId, limit, offset]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Groups ────────────────────────────────────────────────────────
// Any authenticated user can create a group.
// Groups are open: join by code, no email invite required.

// POST /api/groups — create a new peer group
groupRouter.post('/', async (req, res) => {
  const { name, description, start_balance = 100000 } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  // Generate a unique join code (retry on collision)
  let join_code, attempts = 0
  while (attempts < 5) {
    const candidate = makeJoinCode()
    const { rows } = await pool.query('SELECT 1 FROM classes WHERE join_code = $1', [candidate])
    if (!rows.length) { join_code = candidate; break }
    attempts++
  }
  if (!join_code) return res.status(500).json({ error: 'Could not generate a unique join code' })

  try {
    const { rows: [group] } = await pool.query(
      `INSERT INTO classes (name, teacher_id, type, join_code, school_name, state, start_balance, description, ideas_public)
       VALUES ($1, $2, 'group', $3, '', '', $4, $5, true)
       RETURNING *`,
      [name, req.user.id, join_code, start_balance, description || null]
    )
    // Creator auto-joins as a member
    const baseValue = await currentPortfolioValue(req.user.id)
    await pool.query(
      `INSERT INTO class_members (class_id, user_id, base_value) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [group.id, req.user.id, baseValue]
    )
    res.status(201).json({ ...group, member_count: 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/groups/mine — groups the current user belongs to
groupRouter.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, cm.joined_at, cm.base_value,
              u.name AS creator_name,
              (SELECT COUNT(*) FROM class_members WHERE class_id = c.id)::int AS member_count
       FROM class_members cm
       JOIN classes c ON c.id = cm.class_id
       JOIN users   u ON u.id = c.teacher_id
       WHERE cm.user_id = $1 AND c.type = 'group'
       ORDER BY cm.joined_at DESC`,
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/groups/:id — group detail + leaderboard
groupRouter.get('/:id', async (req, res) => {
  try {
    const { rows: [group] } = await pool.query(
      `SELECT c.*,
              u.name AS creator_name,
              (SELECT COUNT(*) FROM class_members WHERE class_id = c.id)::int AS member_count
       FROM classes c
       JOIN users u ON u.id = c.teacher_id
       WHERE c.id = $1 AND c.type = 'group'`,
      [req.params.id]
    )
    if (!group) return res.status(404).json({ error: 'Group not found' })

    // Check user is a member
    const { rows: [member] } = await pool.query(
      'SELECT 1 FROM class_members WHERE class_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!member && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You are not a member of this group' })
    }
    res.json(group)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/groups/join/:code — join by code (open, no token expiry)
groupRouter.post('/join/:code', async (req, res) => {
  const code = req.params.code.toUpperCase()
  try {
    const { rows: [group] } = await pool.query(
      `SELECT * FROM classes WHERE join_code = $1 AND type = 'group'`,
      [code]
    )
    if (!group) return res.status(404).json({ error: 'Group not found — check the code and try again' })

    // Already a member?
    const { rows: [existing] } = await pool.query(
      'SELECT 1 FROM class_members WHERE class_id = $1 AND user_id = $2',
      [group.id, req.user.id]
    )
    if (existing) return res.status(400).json({ error: 'You are already in this group' })

    const baseValue = await currentPortfolioValue(req.user.id)
    await pool.query(
      `INSERT INTO class_members (class_id, user_id, base_value) VALUES ($1, $2, $3)`,
      [group.id, req.user.id, baseValue]
    )
    res.json({ group_id: group.id, group_name: group.name, join_code: group.join_code })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/groups/:id/leaderboard — ranked by % return
groupRouter.get('/:id/leaderboard', async (req, res) => {
  try {
    const { rows: members } = await pool.query(
      `SELECT cm.user_id, cm.base_value,
              u.name, u.avatar_url
       FROM class_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.class_id = $1`,
      [req.params.id]
    )
    res.json(await buildLeaderboard(members))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/groups/:id/activity — trade activity for group members
groupRouter.get('/:id/activity', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? 100), 500)
  const offset = parseInt(req.query.offset ?? 0)
  try {
    const { rows: [member] } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    )
    const isAdmin = req.user.role === 'admin'
    if (!member && !isAdmin) return res.status(403).json({ error: 'Access denied' })

    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, a.action, a.details, a.created_at,
              u.name AS user_name, u.avatar_url
       FROM audit_log a
       JOIN class_members cm ON cm.user_id = a.user_id AND cm.class_id = $1
       JOIN users u ON u.id = a.user_id
       WHERE a.action IN ('buy','sell','add_holding','remove_holding',
                          'add_watchlist','remove_watchlist',
                          'agent_buy','agent_sell','agent_remove')
       ORDER BY a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
