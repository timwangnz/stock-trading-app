/**
 * db.js
 * Creates a shared PostgreSQL connection pool (node-postgres / pg).
 *
 * Connection priority:
 *
 *  1. DATABASE_URL   — used by Railway, Neon, Render, Heroku, etc.
 *                      Set automatically by Railway when you add a Postgres plugin.
 *  2. DB_SOCKET_PATH — Cloud SQL Unix socket for Google Cloud Run
 *  3. DB_HOST / DB_PORT + DB_USER / DB_PASSWORD / DB_NAME — local dev
 */

import pg     from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const { Pool, types } = pg

// Return NUMERIC / DECIMAL columns as JS numbers instead of strings.
types.setTypeParser(1700, (val) => parseFloat(val))

// Return DATE columns as plain "YYYY-MM-DD" strings instead of Date objects.
// pg's default DATE parser constructs a Date object, which when used as an
// object key (e.g. building a date→value map) serialises via .toString() to
// something like "Mon Apr 28 2026 00:00:00 GMT+0000" — breaking key lookups.
types.setTypeParser(1082, (val) => val)

const databaseUrl  = process.env.DATABASE_URL?.trim()
const socketPath   = process.env.DB_SOCKET_PATH

let poolConfig

if (databaseUrl) {
  // Railway / Neon / Render — connection string mode
  // SSL is required by most hosted providers; rejectUnauthorized: false
  // accepts self-signed certs (safe for app-to-db connections).
  poolConfig = {
    connectionString: databaseUrl,
    max: 10,
    ssl: { rejectUnauthorized: false },
  }
} else {
  // Local dev or Cloud SQL socket
  poolConfig = {
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'tradebuddy',
    max:      10,
    ...(socketPath
      ? { host: socketPath }                                    // Cloud SQL socket
      : {
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT  || '5432'),
        }
    ),
  }
}

const pool = new Pool(poolConfig)

export default pool
