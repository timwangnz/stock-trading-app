/**
 * server/setup-db.js
 * Creates all TradeBuddy tables in PostgreSQL from scratch.
 * Run once with:  npm run db:setup
 * Safe to re-run — uses IF NOT EXISTS / ON CONFLICT guards.
 */

import pg     from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const { Client } = pg

async function setup() {
  console.log('🔧 Setting up TradeBuddy database (PostgreSQL)…\n')

  const clientConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL.trim(), ssl: { rejectUnauthorized: false } }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'tradebuddy',
      }

  const client = new Client(clientConfig)

  await client.connect()

  // ── users ─────────────────────────────────────────────────────
  // role:        admin | premium | user | readonly  (default: user)
  // is_disabled: admin can block a user from signing in
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            VARCHAR(50)  NOT NULL PRIMARY KEY,
      email         VARCHAR(255) NOT NULL UNIQUE,
      name          VARCHAR(255),
      avatar_url    VARCHAR(500),
      password_hash VARCHAR(255) NULL,
      role          VARCHAR(20)  NOT NULL DEFAULT 'user'
                    CHECK (role IN ('admin','premium','user','readonly')),
      is_disabled   BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  console.log('✅ Table "users" ready')

  // ── portfolio ─────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS portfolio (
      user_id    VARCHAR(50)    NOT NULL,
      symbol     VARCHAR(10)    NOT NULL,
      shares     NUMERIC(15,6)  NOT NULL,
      avg_cost   NUMERIC(15,4)  NOT NULL,
      updated_at TIMESTAMPTZ    DEFAULT NOW(),
      PRIMARY KEY (user_id, symbol),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ Table "portfolio" ready')

  // ── watchlist ─────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id  VARCHAR(50)  NOT NULL,
      symbol   VARCHAR(10)  NOT NULL,
      added_at TIMESTAMPTZ  DEFAULT NOW(),
      PRIMARY KEY (user_id, symbol),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ Table "watchlist" ready')

  // ── portfolio_snapshots ───────────────────────────────────────
  // One row per user per calendar day — records the exact portfolio
  // value at the time of snapshot (after market close or on login).
  // breakdown: JSONB object { SYMBOL: { shares, price, value }, … }
  await client.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id          BIGSERIAL      PRIMARY KEY,
      user_id     VARCHAR(50)    NOT NULL,
      date        DATE           NOT NULL,
      total_value NUMERIC(15,2)  NOT NULL,
      breakdown   JSONB          NULL,
      created_at  TIMESTAMPTZ    DEFAULT NOW(),
      UNIQUE (user_id, date)
    )
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_user_date
      ON portfolio_snapshots (user_id, date)
  `)
  console.log('✅ Table "portfolio_snapshots" ready')

  // ── audit_log ─────────────────────────────────────────────────
  // Records user actions: login, logout, buy, sell, watchlist changes, etc.
  // details is a JSONB blob with action-specific data (symbol, shares, etc.)
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         BIGSERIAL    PRIMARY KEY,
      user_id    VARCHAR(50)  NOT NULL,
      action     VARCHAR(50)  NOT NULL,
      details    JSONB        NULL,
      ip         VARCHAR(45)  NULL,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log (user_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log (action)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at)`)
  console.log('✅ Table "audit_log" ready')

  // ── dashboard_symbols ─────────────────────────────────────────
  // Custom stocks pinned to a user's dashboard via the Manage button.
  await client.query(`
    CREATE TABLE IF NOT EXISTS dashboard_symbols (
      id       SERIAL       PRIMARY KEY,
      user_id  VARCHAR(50)  NOT NULL,
      symbol   VARCHAR(20)  NOT NULL,
      added_at TIMESTAMPTZ  DEFAULT NOW(),
      UNIQUE (user_id, symbol)
    )
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_dashboard_symbols_user
      ON dashboard_symbols (user_id)
  `)
  console.log('✅ Table "dashboard_symbols" ready')

  // ── user_llm_settings ────────────────────────────────────────
  // Stores each user's chosen LLM provider, model, and encrypted API key.
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_llm_settings (
      user_id     VARCHAR(50)  PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider    VARCHAR(20)  NOT NULL DEFAULT 'anthropic',
      model       VARCHAR(100) NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
      api_key_enc TEXT         NULL,
      updated_at  TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  console.log('✅ Table "user_llm_settings" ready')

  // ── password_reset_tokens ─────────────────────────────────────
  // One-time tokens for the forgot-password flow.
  // Expires after 1 hour; marked used after password is changed.
  await client.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         BIGSERIAL    PRIMARY KEY,
      user_id    VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT         NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ  NOT NULL,
      used       BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_reset_tokens_token
      ON password_reset_tokens (token)
  `)
  console.log('✅ Table "password_reset_tokens" ready')

  await client.end()
  console.log('\n🎉 Database setup complete!')
  console.log('   No seed data — each user gets a fresh portfolio after signing in.')
  process.exit(0)
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.message)
  process.exit(1)
})
