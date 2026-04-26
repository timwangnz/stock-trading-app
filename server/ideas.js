/**
 * server/ideas.js
 * Trading ideas (structured trade calls) routes.
 *
 * Mounted at /api/ideas in server/index.js
 */

import { Router } from 'express'
import pool       from './db.js'
import { getAppSetting } from './appSettings.js'

export const ideasRouter = Router()

const VALID_TIMEFRAMES = [7, 14, 30, 90]  // days

// ── Helpers ───────────────────────────────────────────────────────

/** Attach like count + whether req.user liked each idea. */
async function enrichIdeas(ideas, userId) {
  if (!ideas.length) return []
  const ids = ideas.map(i => i.id)

  const { rows: counts } = await pool.query(
    `SELECT idea_id, COUNT(*) AS likes
     FROM idea_reactions WHERE idea_id = ANY($1)
     GROUP BY idea_id`,
    [ids]
  )
  const { rows: myLikes } = await pool.query(
    `SELECT idea_id FROM idea_reactions
     WHERE idea_id = ANY($1) AND user_id = $2`,
    [ids, userId]
  )
  const likeMap  = Object.fromEntries(counts.map(r => [r.idea_id, parseInt(r.likes)]))
  const likedSet = new Set(myLikes.map(r => r.idea_id))

  return ideas.map(i => ({
    ...i,
    likes:    likeMap[i.id]  ?? 0,
    liked_by_me: likedSet.has(i.id),
  }))
}

// ── Routes ────────────────────────────────────────────────────────

// POST /api/ideas — post a new trade call
ideasRouter.post('/', async (req, res) => {
  const { class_id, symbol, direction, target_price, timeframe_days, rationale } = req.body

  if (!class_id || !symbol || !direction || !target_price || !timeframe_days) {
    return res.status(400).json({ error: 'class_id, symbol, direction, target_price, timeframe_days are required' })
  }
  if (!['BUY', 'SELL'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be BUY or SELL' })
  }
  if (!VALID_TIMEFRAMES.includes(Number(timeframe_days))) {
    return res.status(400).json({ error: `timeframe_days must be one of: ${VALID_TIMEFRAMES.join(', ')}` })
  }

  try {
    // Confirm user is a member of this class
    const { rows: membership } = await pool.query(
      'SELECT 1 FROM class_members WHERE class_id = $1 AND user_id = $2',
      [class_id, req.user.id]
    )
    if (!membership.length) {
      return res.status(403).json({ error: 'You are not a member of this class' })
    }

    // Get current price from latest snapshot as entry price
    const { rows: snap } = await pool.query(
      `SELECT total_value FROM portfolio_snapshots
       WHERE user_id = $1 ORDER BY date DESC LIMIT 1`,
      [req.user.id]
    )

    // Fetch live entry price from Polygon via server-side call
    const apiKey = await getAppSetting('polygon_api_key', 'POLYGON_API_KEY')
    let entryPrice = parseFloat(target_price) // fallback
    if (apiKey) {
      try {
        const r = await fetch(
          `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbol.toUpperCase()}&apiKey=${apiKey}`
        )
        const d = await r.json()
        const t = d.tickers?.[0]
        const p = t?.day?.c || t?.prevDay?.c
        if (p) entryPrice = p
      } catch (_) {}
    }

    const expiresAt = new Date(Date.now() + Number(timeframe_days) * 864e5)

    const { rows } = await pool.query(
      `INSERT INTO trading_ideas
         (class_id, user_id, symbol, direction, entry_price, target_price, timeframe_days, rationale, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [class_id, req.user.id, symbol.toUpperCase(), direction,
       entryPrice, target_price, timeframe_days, rationale || null, expiresAt]
    )

    const enriched = await enrichIdeas(rows, req.user.id)
    res.status(201).json(enriched[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ideas?class_id=X — list ideas for a class
ideasRouter.get('/', async (req, res) => {
  const { class_id, limit = 50, offset = 0 } = req.query
  if (!class_id) return res.status(400).json({ error: 'class_id required' })

  try {
    // Check class visibility
    const { rows: cls } = await pool.query(
      'SELECT ideas_public FROM classes WHERE id = $1', [class_id]
    )
    if (!cls.length) return res.status(404).json({ error: 'Class not found' })

    // Must be member or class must be public
    if (!cls[0].ideas_public) {
      const { rows: m } = await pool.query(
        'SELECT 1 FROM class_members WHERE class_id = $1 AND user_id = $2',
        [class_id, req.user.id]
      )
      // Also allow teacher/admin
      if (!m.length && !['teacher','admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'This class feed is private' })
      }
    }

    const { rows } = await pool.query(
      `SELECT ti.*,
              u.name AS author_name, u.avatar_url AS author_avatar
       FROM trading_ideas ti
       JOIN users u ON u.id = ti.user_id
       WHERE ti.class_id = $1
       ORDER BY ti.created_at DESC
       LIMIT $2 OFFSET $3`,
      [class_id, limit, offset]
    )

    res.json(await enrichIdeas(rows, req.user.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ideas/public — public feed (ideas_public classes only)
ideasRouter.get('/public', async (req, res) => {
  const { state, limit = 50, offset = 0 } = req.query
  try {
    const { rows } = await pool.query(
      `SELECT ti.*,
              u.name AS author_name, u.avatar_url AS author_avatar,
              c.name AS class_name, c.school_name, c.state
       FROM trading_ideas ti
       JOIN users   u ON u.id   = ti.user_id
       JOIN classes c ON c.id   = ti.class_id
       WHERE c.ideas_public = TRUE
         ${state ? 'AND LOWER(c.state) = LOWER($3)' : ''}
       ORDER BY ti.created_at DESC
       LIMIT $1 OFFSET $2`,
      state ? [limit, offset, state] : [limit, offset]
    )
    res.json(await enrichIdeas(rows, req.user.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ideas/:id/react — toggle like on an idea
ideasRouter.post('/:id/react', async (req, res) => {
  const ideaId = req.params.id
  try {
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM idea_reactions WHERE idea_id = $1 AND user_id = $2',
      [ideaId, req.user.id]
    )
    if (existing.length) {
      await pool.query(
        'DELETE FROM idea_reactions WHERE idea_id = $1 AND user_id = $2',
        [ideaId, req.user.id]
      )
      res.json({ liked: false })
    } else {
      await pool.query(
        'INSERT INTO idea_reactions (idea_id, user_id) VALUES ($1, $2)',
        [ideaId, req.user.id]
      )
      res.json({ liked: true })
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/ideas/:id — delete own idea (or admin/teacher)
ideasRouter.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM trading_ideas WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Idea not found' })

    const isOwner = rows[0].user_id === req.user.id
    const isPriv  = ['admin', 'teacher'].includes(req.user.role)
    if (!isOwner && !isPriv) return res.status(403).json({ error: 'Cannot delete another student\'s idea' })

    await pool.query('DELETE FROM trading_ideas WHERE id = $1', [req.params.id])
    res.json({ deleted: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ideas/resolve — resolve expired pending calls (called internally)
// Checks all ideas past expires_at, fetches current price, marks hit/missed
ideasRouter.post('/resolve', async (req, res) => {
  // Only admin or the internal snapshot secret
  const secret = process.env.SNAPSHOT_SECRET
  const isAdmin  = req.user?.role === 'admin'
  const hasSecret = req.headers['x-snapshot-secret'] === secret
  if (!isAdmin && !hasSecret) return res.status(403).json({ error: 'Forbidden' })

  try {
    const { rows: pending } = await pool.query(
      `SELECT * FROM trading_ideas
       WHERE outcome = 'pending' AND expires_at <= NOW()`
    )
    if (!pending.length) return res.json({ resolved: 0 })

    const apiKey = await getAppSetting('polygon_api_key', 'POLYGON_API_KEY')
    let resolved = 0

    for (const idea of pending) {
      let currentPrice = null
      if (apiKey) {
        try {
          const r = await fetch(
            `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${idea.symbol}&apiKey=${apiKey}`
          )
          const d = await r.json()
          const t = d.tickers?.[0]
          currentPrice = t?.day?.c || t?.prevDay?.c || null
        } catch (_) {}
      }

      if (!currentPrice) continue  // skip if no price data

      const entry  = parseFloat(idea.entry_price)
      const target = parseFloat(idea.target_price)
      let outcome

      if (idea.direction === 'BUY') {
        outcome = currentPrice >= target ? 'hit' : 'missed'
      } else {
        outcome = currentPrice <= target ? 'hit' : 'missed'
      }

      await pool.query(
        `UPDATE trading_ideas
         SET outcome = $1, resolved_price = $2, resolved_at = NOW()
         WHERE id = $3`,
        [outcome, currentPrice, idea.id]
      )
      resolved++
    }

    res.json({ resolved, total: pending.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
