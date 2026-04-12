/**
 * db.js
 * Creates a shared MySQL connection pool used by all API routes.
 * Using a pool (not a single connection) means multiple requests
 * can run in parallel without waiting for each other.
 */

import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

// Load .env from the project root (one level above this file)
dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

const pool = mysql.createPool({
  host:             process.env.DB_HOST     || 'localhost',
  port:             parseInt(process.env.DB_PORT || '3306'),
  user:             process.env.DB_USER,
  password:         process.env.DB_PASSWORD,
  database:         process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:  10,
  decimalNumbers:   true,   // return DECIMAL columns as JS numbers, not strings
})

export default pool
