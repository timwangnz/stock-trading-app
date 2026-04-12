/**
 * db.js
 * Creates a shared MySQL connection pool.
 *
 * Supports two connection modes:
 *
 *  1. LOCAL DEV  — connects via TCP (DB_HOST + DB_PORT)
 *  2. CLOUD RUN  — connects via Cloud SQL Unix socket (DB_SOCKET_PATH)
 *     Cloud SQL Auth Proxy mounts the socket automatically when you
 *     add the Cloud SQL instance to the Cloud Run service.
 *
 * Set the following environment variables (Secret Manager in production):
 *
 *   DB_USER          MySQL user
 *   DB_PASSWORD      MySQL password
 *   DB_NAME          Database name
 *
 *   Local:
 *   DB_HOST          Host (default: localhost)
 *   DB_PORT          Port  (default: 3306)
 *
 *   Cloud Run / Cloud SQL:
 *   DB_SOCKET_PATH   e.g. /cloudsql/PROJECT:REGION:INSTANCE
 */

import mysql  from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

// Cloud SQL Auth Proxy provides a Unix socket; TCP is used for local dev.
const socketPath = process.env.DB_SOCKET_PATH

const poolConfig = {
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,   // return DECIMAL columns as JS numbers, not strings
  ...(socketPath
    ? { socketPath }                                           // Cloud SQL socket
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT  || '3306'),
      }
  ),
}

const pool = mysql.createPool(poolConfig)

export default pool
