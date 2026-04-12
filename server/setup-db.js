/**
 * server/setup-db.js
 * Creates the tradebuddy database and all tables from scratch.
 * Run once with:  npm run db:setup
 * Safe to re-run — uses IF NOT EXISTS / IF EXISTS guards.
 */

import mysql  from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

async function setup() {
  console.log('🔧 Setting up TradeBuddy database…\n')

  // Connect without a database selected so we can CREATE it
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  })

  const dbName = process.env.DB_NAME || 'tradebuddy'

  // ── Database ─────────────────────────────────────────────────
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  )
  console.log(`✅ Database "${dbName}" ready`)
  await conn.query(`USE \`${dbName}\``)

  // ── users ─────────────────────────────────────────────────────
  // role:        admin | premium | user | readonly  (default: user)
  // is_disabled: admin can block a user from signing in
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          VARCHAR(50)                              NOT NULL PRIMARY KEY,
      email       VARCHAR(255)                             NOT NULL UNIQUE,
      name        VARCHAR(255),
      avatar_url  VARCHAR(500),
      password_hash VARCHAR(255)                              NULL,
      role          ENUM('admin','premium','user','readonly') NOT NULL DEFAULT 'user',
      is_disabled   TINYINT(1)                               NOT NULL DEFAULT 0,
      created_at    TIMESTAMP                                DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  // If the table already existed from a previous run, add any missing columns.
  // We check information_schema first so we don't fail on databases that don't
  // support ADD COLUMN IF NOT EXISTS (MySQL < 8.0).
  const columnsToAdd = [
    { name: 'password_hash', def: 'VARCHAR(255) NULL' },
    { name: 'role',          def: "ENUM('admin','premium','user','readonly') NOT NULL DEFAULT 'user'" },
    { name: 'is_disabled',   def: 'TINYINT(1) NOT NULL DEFAULT 0' },
  ]
  for (const col of columnsToAdd) {
    const [[row]] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
      [dbName, col.name]
    )
    if (!row) {
      await conn.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`)
      console.log(`   ↳ Added column "${col.name}"`)
    }
  }

  console.log('✅ Table "users" ready')

  // ── portfolio ─────────────────────────────────────────────────
  // If the table exists but is missing user_id (old single-user schema),
  // drop it and recreate with the correct multi-user schema.
  const [[portfolioUserIdCol]] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'portfolio' AND COLUMN_NAME = 'user_id'`,
    [dbName]
  )
  if (!portfolioUserIdCol) {
    await conn.query(`DROP TABLE IF EXISTS portfolio`)
    console.log('   ↳ Dropped old "portfolio" table (missing user_id column)')
  }
  await conn.query(`
    CREATE TABLE IF NOT EXISTS portfolio (
      user_id    VARCHAR(50)   NOT NULL,
      symbol     VARCHAR(10)   NOT NULL,
      shares     DECIMAL(15,6) NOT NULL,
      avg_cost   DECIMAL(15,4) NOT NULL,
      updated_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, symbol),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
  console.log('✅ Table "portfolio" ready')

  // ── watchlist ─────────────────────────────────────────────────
  const [[watchlistUserIdCol]] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'watchlist' AND COLUMN_NAME = 'user_id'`,
    [dbName]
  )
  if (!watchlistUserIdCol) {
    await conn.query(`DROP TABLE IF EXISTS watchlist`)
    console.log('   ↳ Dropped old "watchlist" table (missing user_id column)')
  }
  await conn.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id  VARCHAR(50)  NOT NULL,
      symbol   VARCHAR(10)  NOT NULL,
      added_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, symbol),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
  console.log('✅ Table "watchlist" ready')

  // ── audit_log ─────────────────────────────────────────────────
  // Records user actions: login, logout, buy, sell, watchlist changes, etc.
  // details is a JSON blob with action-specific data (symbol, shares, etc.)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id    VARCHAR(50)      NOT NULL,
      action     VARCHAR(50)      NOT NULL,
      details    JSON             NULL,
      ip         VARCHAR(45)      NULL,
      created_at TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user    (user_id),
      INDEX idx_action  (action),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)
  console.log('✅ Table "audit_log" ready')

  await conn.end()
  console.log('\n🎉 Database setup complete!')
  console.log('   No seed data — each user gets a fresh portfolio after signing in.')
  process.exit(0)
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.message)
  process.exit(1)
})
