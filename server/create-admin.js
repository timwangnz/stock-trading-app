/**
 * server/create-admin.js
 * Creates the initial admin user if SETUP_ADMIN_EMAIL is set in the environment.
 * Safe to re-run — skips if the user already exists.
 * Called automatically by docker-entrypoint.sh on first boot.
 */

import pg     from 'pg'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const { Client } = pg

const email    = process.env.SETUP_ADMIN_EMAIL
const password = process.env.SETUP_ADMIN_PASSWORD
const name     = process.env.SETUP_ADMIN_NAME || 'Admin'

if (!email || !password) {
  // No admin setup requested — skip silently
  process.exit(0)
}

async function createAdmin() {
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

  // Check if the user already exists
  const { rows: [existing] } = await client.query(
    'SELECT id, role FROM users WHERE email = $1',
    [email]
  )

  if (existing) {
    if (existing.role !== 'admin') {
      // Promote to admin if they exist but aren't one yet
      await client.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', existing.id])
      console.log(`✅ Promoted existing user "${email}" to admin.`)
    } else {
      console.log(`✅ Admin user "${email}" already exists — skipping.`)
    }
    await client.end()
    return
  }

  // Create the admin user
  const hash = await bcrypt.hash(password, 12)
  const id   = randomUUID()

  await client.query(
    `INSERT INTO users (id, email, name, password_hash, role)
     VALUES ($1, $2, $3, $4, 'admin')`,
    [id, email, name, hash]
  )

  await client.end()
  console.log(`✅ Admin user created: ${email}`)
}

createAdmin().catch(err => {
  console.error('❌ Failed to create admin user:', err.message)
  process.exit(1)
})
