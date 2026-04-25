/**
 * server/scheduler.js
 * Weekday prompt scheduler — wakes every minute, finds saved prompts
 * whose schedule is due, and runs them via runPromptTemplate.
 *
 * Schedule shape (stored in saved_prompts.schedule JSONB):
 * {
 *   enabled:  true,
 *   time:     "08:30",          // HH:MM in the configured timezone
 *   timezone: "America/New_York",
 *   days:     ["Mon","Tue","Wed","Thu","Fri"]
 * }
 *
 * A prompt is "due" when the current HH:MM in its timezone matches
 * schedule.time and today's short day name is in schedule.days.
 * To avoid running twice in the same minute we track the last run
 * time per prompt in memory.
 */

import pool from './db.js'
import { runPromptTemplate } from './promptRunner.js'
import { decrypt } from './crypto.js'
import { PROVIDERS } from './llm.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// In-memory dedup: promptId → "YYYY-MM-DD HH:MM" of last scheduled run
const lastRun = new Map()

function nowInTZ(timezone) {
  try {
    const str  = new Date().toLocaleString('en-US', { timeZone: timezone, hour12: false })
    return new Date(str)
  } catch {
    // Fallback to ET if timezone is invalid
    const str  = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
    return new Date(str)
  }
}

function pad(n) { return String(n).padStart(2, '0') }

function isDue(schedule) {
  if (!schedule?.enabled) return false
  const tz      = schedule.timezone || 'America/New_York'
  const now     = nowInTZ(tz)
  const hhmm    = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const dayName = DAY_NAMES[now.getDay()]
  const days    = schedule.days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  return hhmm === schedule.time && days.includes(dayName)
}

function getLLMConfig(row) {
  if (!row) return {}
  let apiKey = ''
  if (row.api_key_enc) {
    try { apiKey = decrypt(row.api_key_enc) } catch { /* ignore */ }
  }
  const provider = row.provider || 'anthropic'
  const models   = PROVIDERS[provider]?.models ?? []
  const model    = row.model || models[0]?.id || ''
  return { provider, model, apiKey }
}

async function runScheduledPrompts() {
  try {
    // Fetch all prompts that have a schedule defined
    const { rows: prompts } = await pool.query(
      `SELECT sp.*, u.name AS user_name, u.email AS user_email,
              lls.provider, lls.model, lls.api_key_enc
       FROM saved_prompts sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN user_llm_settings lls ON lls.user_id = sp.user_id
       WHERE sp.schedule IS NOT NULL
         AND (sp.schedule->>'enabled')::boolean = true`
    )

    for (const prompt of prompts) {
      if (!isDue(prompt.schedule)) continue

      // Dedup — don't fire twice in the same minute
      const tz       = prompt.schedule.timezone || 'America/New_York'
      const now      = nowInTZ(tz)
      const runKey   = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
      const lastKey  = lastRun.get(prompt.id)
      if (lastKey === runKey) continue
      lastRun.set(prompt.id, runKey)

      console.log(`[scheduler] Running prompt #${prompt.id} "${prompt.title}" for user ${prompt.user_id}`)

      const llmConfig = getLLMConfig(prompt)

      runPromptTemplate({
        template:  prompt.message,
        userId:    prompt.user_id,
        userName:  prompt.user_name,
        llmConfig,
      })
        .then(result => {
          pool.query(
            'UPDATE saved_prompts SET run_count = run_count + 1 WHERE id=$1',
            [prompt.id]
          ).catch(() => {})
          console.log(
            `[scheduler] Prompt #${prompt.id} done.`,
            result.emailedTo ? `Email sent to ${result.emailedTo}.` : 'No email.'
          )
        })
        .catch(err => {
          console.error(`[scheduler] Prompt #${prompt.id} failed:`, err.message)
        })
    }
  } catch (err) {
    console.error('[scheduler] Error checking scheduled prompts:', err.message)
  }
}

/**
 * Start the scheduler — polls every 30 seconds.
 * Call once at server startup.
 */
export function startPromptScheduler() {
  console.log('[scheduler] Prompt scheduler started')
  // Run immediately on startup (catches any missed runs after a restart)
  runScheduledPrompts()
  setInterval(runScheduledPrompts, 30_000)
}
