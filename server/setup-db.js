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
  // role:        admin | teacher | premium | student | user | readonly
  // is_disabled: admin can block a user from signing in
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            VARCHAR(50)  NOT NULL PRIMARY KEY,
      email         VARCHAR(255) NOT NULL UNIQUE,
      name          VARCHAR(255),
      avatar_url    VARCHAR(500),
      password_hash VARCHAR(255) NULL,
      role          VARCHAR(20)  NOT NULL DEFAULT 'user'
                    CHECK (role IN ('admin','teacher','premium','student','user','readonly')),
      is_disabled   BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  // Patch existing DBs: drop the old constraint (missing 'student') and recreate it.
  // This is idempotent — if the constraint is already correct it's a no-op.
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('admin','teacher','premium','student','user','readonly'));
    END$$
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

  // ── user_balances ─────────────────────────────────────────────
  // Tracks each user's simulated cash. Starts at DEFAULT_CASH.
  // Debited on buy, credited on sell. Enforced server-side on every trade.
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_balances (
      user_id    VARCHAR(50)    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      cash       NUMERIC(15,2)  NOT NULL DEFAULT 100000,
      updated_at TIMESTAMPTZ    DEFAULT NOW()
    )
  `)
  console.log('✅ Table "user_balances" ready')

  // ── transactions ──────────────────────────────────────────────
  // One row per completed buy or sell trade.
  // side: 'buy' | 'sell'
  // source: 'market' (student clicked Buy/Sell) | 'agent' (AI trade)
  await client.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id          BIGSERIAL       PRIMARY KEY,
      user_id     VARCHAR(50)     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol      VARCHAR(10)     NOT NULL,
      side        VARCHAR(4)      NOT NULL CHECK (side IN ('buy', 'sell')),
      shares      NUMERIC(15,6)   NOT NULL,
      price       NUMERIC(15,4)   NOT NULL,
      total       NUMERIC(15,2)   NOT NULL,
      source      VARCHAR(20)     NOT NULL DEFAULT 'market',
      executed_at TIMESTAMPTZ     DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_txn_user    ON transactions (user_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_txn_symbol  ON transactions (user_id, symbol)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_txn_created ON transactions (executed_at)`)
  console.log('✅ Table "transactions" ready')

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

  // ── classes ───────────────────────────────────────────────────
  // type='class': teacher-led, requires school info, invite-only.
  // type='group': peer-created, open join via join_code, no school required.
  await client.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id             SERIAL        PRIMARY KEY,
      name           VARCHAR(100)  NOT NULL,
      teacher_id     VARCHAR(50)   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type           VARCHAR(10)   NOT NULL DEFAULT 'class'
                     CHECK (type IN ('class', 'group')),
      join_code      VARCHAR(20)   UNIQUE,
      school_name    VARCHAR(200)  NOT NULL DEFAULT '',
      state          VARCHAR(100)  NOT NULL DEFAULT '',
      country        VARCHAR(100)  NOT NULL DEFAULT 'US',
      start_balance  NUMERIC(15,2) NOT NULL DEFAULT 100000,
      start_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
      end_date       DATE          NULL,
      ideas_public   BOOLEAN       NOT NULL DEFAULT FALSE,
      description    TEXT,
      created_at     TIMESTAMPTZ   DEFAULT NOW()
    )
  `)
  // ── Migrate existing classes table (add columns introduced after initial deploy) ──
  await client.query(`
    ALTER TABLE classes
      ADD COLUMN IF NOT EXISTS type        VARCHAR(10)  NOT NULL DEFAULT 'class',
      ADD COLUMN IF NOT EXISTS join_code   VARCHAR(20)  NULL,
      ADD COLUMN IF NOT EXISTS description TEXT         NULL
  `)
  // Add CHECK constraint on type if it doesn't already exist
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'classes_type_check' AND conrelid = 'classes'::regclass
      ) THEN
        ALTER TABLE classes ADD CONSTRAINT classes_type_check
          CHECK (type IN ('class', 'group'));
      END IF;
    END $$
  `)
  // Add UNIQUE constraint on join_code if it doesn't already exist
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'classes_join_code_key' AND conrelid = 'classes'::regclass
      ) THEN
        ALTER TABLE classes ADD CONSTRAINT classes_join_code_key UNIQUE (join_code);
      END IF;
    END $$
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_classes_teacher   ON classes (teacher_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_classes_state     ON classes (state)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_classes_type      ON classes (type)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_classes_join_code ON classes (join_code)`)
  console.log('✅ Table "classes" ready')

  // ── class_members ─────────────────────────────────────────────
  // Tracks which users belong to which class.
  // base_value: portfolio value at the moment of joining — used to calculate % return rank.
  await client.query(`
    CREATE TABLE IF NOT EXISTS class_members (
      class_id   INTEGER      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      user_id    VARCHAR(50)  NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      base_value NUMERIC(15,2) NOT NULL DEFAULT 0,
      joined_at  TIMESTAMPTZ  DEFAULT NOW(),
      PRIMARY KEY (class_id, user_id)
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members (user_id)`)
  console.log('✅ Table "class_members" ready')

  // ── class_invites ─────────────────────────────────────────────
  // Teacher invites students by email. Token is emailed; clicking it joins the class.
  await client.query(`
    CREATE TABLE IF NOT EXISTS class_invites (
      id          BIGSERIAL    PRIMARY KEY,
      class_id    INTEGER      NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      email       VARCHAR(255) NOT NULL,
      token       TEXT         NOT NULL UNIQUE,
      expires_at  TIMESTAMPTZ  NOT NULL,
      accepted_at TIMESTAMPTZ  NULL,
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_class_invites_token ON class_invites (token)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_class_invites_email ON class_invites (email)`)
  console.log('✅ Table "class_invites" ready')

  // ── trading_ideas ─────────────────────────────────────────────
  // Structured trade calls posted by students.
  // outcome: pending → hit | missed | expired (resolved when timeframe elapses)
  await client.query(`
    CREATE TABLE IF NOT EXISTS trading_ideas (
      id            BIGSERIAL     PRIMARY KEY,
      class_id      INTEGER       NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      user_id       VARCHAR(50)   NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      symbol        VARCHAR(10)   NOT NULL,
      direction     VARCHAR(4)    NOT NULL CHECK (direction IN ('BUY','SELL')),
      entry_price   NUMERIC(15,4) NOT NULL,
      target_price  NUMERIC(15,4) NOT NULL,
      timeframe_days INTEGER      NOT NULL,
      rationale     TEXT          NULL,
      outcome       VARCHAR(10)   NOT NULL DEFAULT 'pending'
                    CHECK (outcome IN ('pending','hit','missed','expired')),
      resolved_price NUMERIC(15,4) NULL,
      expires_at    TIMESTAMPTZ   NOT NULL,
      resolved_at   TIMESTAMPTZ   NULL,
      created_at    TIMESTAMPTZ   DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ideas_class   ON trading_ideas (class_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ideas_user    ON trading_ideas (user_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ideas_expires ON trading_ideas (expires_at) WHERE outcome = 'pending'`)
  console.log('✅ Table "trading_ideas" ready')

  // ── idea_reactions ────────────────────────────────────────────
  // Simple like system — one like per user per idea.
  await client.query(`
    CREATE TABLE IF NOT EXISTS idea_reactions (
      idea_id    BIGINT       NOT NULL REFERENCES trading_ideas(id) ON DELETE CASCADE,
      user_id    VARCHAR(50)  NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
      created_at TIMESTAMPTZ  DEFAULT NOW(),
      PRIMARY KEY (idea_id, user_id)
    )
  `)
  console.log('✅ Table "idea_reactions" ready')

  // ── teacher_verifications ─────────────────────────────────────
  // Stores teacher self-registration requests. Admin approves/rejects.
  // status: pending → approved | rejected
  await client.query(`
    CREATE TABLE IF NOT EXISTS teacher_verifications (
      id             BIGSERIAL    PRIMARY KEY,
      user_id        VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      school_name    VARCHAR(255) NOT NULL,
      school_website VARCHAR(500),
      state          VARCHAR(100) NOT NULL,
      title          VARCHAR(100) NOT NULL,
      status         VARCHAR(20)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
      reject_reason  TEXT,
      reviewed_by    VARCHAR(50)  REFERENCES users(id),
      reviewed_at    TIMESTAMPTZ,
      created_at     TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_verif_user   ON teacher_verifications (user_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_teacher_verif_status ON teacher_verifications (status)`)
  console.log('✅ Table "teacher_verifications" ready')

  // ── customer_profiles ────────────────────────────────────────
  // Extended profile for each user: title, company, contact info,
  // loyalty tier, internal notes, and a JSONB tags array.
  // One row per user (upserted on save).
  await client.query(`
    CREATE TABLE IF NOT EXISTS customer_profiles (
      user_id      VARCHAR(50)  PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      title        VARCHAR(255) NOT NULL DEFAULT '',
      company      VARCHAR(255) NOT NULL DEFAULT '',
      phone        VARCHAR(50)  NOT NULL DEFAULT '',
      location     VARCHAR(255) NOT NULL DEFAULT '',
      loyalty_tier VARCHAR(20)  NOT NULL DEFAULT 'Bronze'
                   CHECK (loyalty_tier IN ('Bronze','Silver','Gold','Platinum')),
      notes        TEXT         NOT NULL DEFAULT '',
      tags         JSONB        NOT NULL DEFAULT '[]',
      updated_at   TIMESTAMPTZ  DEFAULT NOW()
    )
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_profiles_user
      ON customer_profiles (user_id)
  `)
  // ── Migrate existing customer_profiles table (add columns introduced after initial deploy) ──
  await client.query(`
    ALTER TABLE customer_profiles
      ADD COLUMN IF NOT EXISTS honorific   VARCHAR(20)  NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS nickname    VARCHAR(100) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS dob         DATE         NULL,
      ADD COLUMN IF NOT EXISTS gender      VARCHAR(50)  NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS address     TEXT         NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS first_name  VARCHAR(100) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS last_name   VARCHAR(100) NOT NULL DEFAULT ''
  `)
  console.log('✅ Table "customer_profiles" ready')

  // ── agent_portfolio_settings ─────────────────────────────────
  // One row per user — stores the autopilot configuration.
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_portfolio_settings (
      user_id        VARCHAR(50)  PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      cash           NUMERIC(14,2) NOT NULL DEFAULT 0,
      starting_cash  NUMERIC(14,2) NOT NULL DEFAULT 0,
      bias           TEXT          NOT NULL DEFAULT '',
      frequency      VARCHAR(10)   NOT NULL DEFAULT 'weekly'
                     CHECK (frequency IN ('daily','weekly','monthly')),
      num_stocks     INTEGER       NOT NULL DEFAULT 10,
      status         VARCHAR(10)   NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','paused')),
      last_run_at    TIMESTAMPTZ,
      next_run_at    TIMESTAMPTZ,
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `)
  // Migration: add num_stocks to existing tables that pre-date this column
  await client.query(`
    ALTER TABLE agent_portfolio_settings
      ADD COLUMN IF NOT EXISTS num_stocks INTEGER NOT NULL DEFAULT 10
  `).catch(() => {})
  console.log('✅ Table "agent_portfolio_settings" ready')

  // ── agent_holdings ────────────────────────────────────────────
  // The agent's current stock positions (separate from user's own portfolio).
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_holdings (
      id         SERIAL       PRIMARY KEY,
      user_id    VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol     VARCHAR(10)  NOT NULL,
      shares     NUMERIC(14,6) NOT NULL,
      avg_cost   NUMERIC(14,4) NOT NULL,
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, symbol)
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_holdings_user ON agent_holdings (user_id)`)
  console.log('✅ Table "agent_holdings" ready')

  // ── agent_transactions ────────────────────────────────────────
  // Every trade the agent executes, with its per-trade reasoning.
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_transactions (
      id         SERIAL       PRIMARY KEY,
      user_id    VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id     INTEGER,
      symbol     VARCHAR(10)  NOT NULL,
      side       VARCHAR(4)   NOT NULL CHECK (side IN ('buy','sell')),
      shares     NUMERIC(14,6) NOT NULL,
      price      NUMERIC(14,4) NOT NULL,
      total      NUMERIC(14,2) NOT NULL,
      reasoning  TEXT,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_txns_user ON agent_transactions (user_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_txns_run  ON agent_transactions (run_id)`)
  console.log('✅ Table "agent_transactions" ready')

  // ── agent_runs ────────────────────────────────────────────────
  // Log of every rebalance cycle: status, summary, full JSON decisions.
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              SERIAL       PRIMARY KEY,
      user_id         VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status          VARCHAR(10)  NOT NULL DEFAULT 'success'
                      CHECK (status IN ('success','error','skipped')),
      summary         TEXT,
      decisions       JSONB,
      trades_count    INTEGER      NOT NULL DEFAULT 0,
      portfolio_value NUMERIC(14,2),
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs (user_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs (created_at DESC)`)
  console.log('✅ Table "agent_runs" ready')

  // ── mcp_servers ───────────────────────────────────────────────
  // Per-user list of MCP servers the trading agent can call tools from.
  await client.query(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id          SERIAL       PRIMARY KEY,
      user_id     VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        VARCHAR(100) NOT NULL,
      url         VARCHAR(500) NOT NULL,
      auth_header TEXT,
      enabled     BOOLEAN      NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers (user_id)`)
  console.log('✅ Table "mcp_servers" ready')

  // User-defined context entries that are auto-injected into the trading agent's system prompt.
  // type: 'instruction' (global rule), 'ticker_note' (per-symbol note), 'mcp_rule' (MCP guidance)
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_context (
      id          BIGSERIAL     PRIMARY KEY,
      user_id     VARCHAR(50)   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        VARCHAR(20)   NOT NULL DEFAULT 'instruction'
                  CHECK (type IN ('instruction', 'ticker_note', 'mcp_rule')),
      ticker      VARCHAR(10)   NULL,
      title       VARCHAR(255)  NOT NULL,
      content     TEXT          NOT NULL,
      enabled     BOOLEAN       NOT NULL DEFAULT true,
      priority    INTEGER       NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_context_user ON agent_context (user_id)`)
  console.log('✅ Table "agent_context" ready')

  // Saved, shareable prompts — message + context snapshot exported as runnable JSON / MCP prompt format.
  await client.query(`
    CREATE TABLE IF NOT EXISTS saved_prompts (
      id           BIGSERIAL    PRIMARY KEY,
      user_id      VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        VARCHAR(255) NOT NULL,
      description  TEXT         NULL,
      message      TEXT         NOT NULL,
      context_snap JSONB        NOT NULL DEFAULT '[]',
      datasets     JSONB        NOT NULL DEFAULT '[]',
      run_count    INTEGER      NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_saved_prompts_user ON saved_prompts (user_id)`)
  // Migration: add columns introduced after initial table creation
  await client.query(`
    ALTER TABLE saved_prompts
      ADD COLUMN IF NOT EXISTS datasets  JSONB   NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS run_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS schedule  JSONB   NULL
  `)
  console.log('✅ Table "saved_prompts" ready')

  // ── campaigns ─────────────────────────────────────────────────
  // Marketing campaign definitions. Admin-only.
  // compose_mode: 'manual' = {{token}} substitution, 'ai' = LLM generates body per user
  await client.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id               BIGSERIAL     PRIMARY KEY,
      title            VARCHAR(255)  NOT NULL,
      status           VARCHAR(20)   NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','sending','sent','scheduled','failed')),
      audience_desc    TEXT          NULL,
      audience_filter  JSONB         NOT NULL DEFAULT '{"logic":"AND","conditions":[]}',
      subject          VARCHAR(500)  NOT NULL DEFAULT '',
      compose_mode     VARCHAR(10)   NOT NULL DEFAULT 'manual'
                       CHECK (compose_mode IN ('manual','ai')),
      body_template    TEXT          NOT NULL DEFAULT '',
      ai_prompt        TEXT          NULL,
      scheduled_at     TIMESTAMPTZ   NULL,
      sent_at          TIMESTAMPTZ   NULL,
      recipient_count  INTEGER       NOT NULL DEFAULT 0,
      created_by       VARCHAR(50)   NOT NULL REFERENCES users(id),
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_status     ON campaigns (status)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns (created_by)`)
  console.log('✅ Table "campaigns" ready')

  // ── campaign_sends ────────────────────────────────────────────
  // One row per recipient per campaign — tracks delivery status.
  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_sends (
      id           BIGSERIAL    PRIMARY KEY,
      campaign_id  BIGINT       NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id      VARCHAR(50)  NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
      status       VARCHAR(10)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','failed')),
      error        TEXT         NULL,
      sent_at      TIMESTAMPTZ  NULL,
      UNIQUE (campaign_id, user_id)
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends (campaign_id)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_campaign_sends_user     ON campaign_sends (user_id)`)
  console.log('✅ Table "campaign_sends" ready')

  // ── app_settings ──────────────────────────────────────────────
  // Admin-configurable server-level settings (API keys, OAuth credentials, etc.)
  // Sensitive values are AES-256-GCM encrypted; the encrypted column flags them.
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        VARCHAR(100) PRIMARY KEY,
      value      TEXT,
      encrypted  BOOLEAN      NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  console.log('✅ Table "app_settings" ready')

  // ── error_log ─────────────────────────────────────────────────
  // Persistent record of server-side and client-side failures.
  // Unlike the in-memory SERVER_LOGS buffer, this survives restarts.
  // category: 'agent' | 'snapshot' | 'scheduler' | 'llm' | 'polygon' |
  //           'auth' | 'db' | 'api' | 'client' | 'system'
  await client.query(`
    CREATE TABLE IF NOT EXISTS error_log (
      id          BIGSERIAL    PRIMARY KEY,
      category    VARCHAR(50)  NOT NULL,
      message     TEXT         NOT NULL,
      details     JSONB        NULL,
      user_id     VARCHAR(50)  NULL,
      resolved    BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_error_log_category ON error_log (category)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_error_log_created  ON error_log (created_at DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_error_log_resolved ON error_log (resolved)`)
  console.log('✅ Table "error_log" ready')

  await client.end()
  console.log('\n🎉 Database setup complete!')
  console.log('   No seed data — each user gets a fresh portfolio after signing in.')
  process.exit(0)
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.message)
  process.exit(1)
})
