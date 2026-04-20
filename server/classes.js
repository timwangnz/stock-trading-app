/**
 * server/classes.js
 * Classroom management, invite flow, and leaderboard routes.
 *
 * Mounted at /api/classes and /api/leaderboard in server/index.js
 */

import { Router }  from 'express'
import crypto      from 'crypto'
import pool        from './db.js'
import { sendClassInviteEmail } from './email.js'

export const classRouter      = Router()
export const leaderboardRouter = Router()

// ── Helpers ───────────────────────────────────────────────────────

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

// GET /api/classes/:id — class detail + member list
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
      `SELECT u.id, u.name, u.email, u.avatar_url, cm.joined_at, cm.base_value
       FROM class_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.class_id = $1
       ORDER BY cm.joined_at ASC`,
      [req.params.id]
    )
    res.json({ ...c, members })
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

    res.json({ class_id: invite.class_id, class_name: invite.class_name, school_name: invite.school_name })
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
