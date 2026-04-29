/**
 * server/crypto.js
 * AES-256-GCM encryption/decryption for user API keys stored in the DB.
 * Requires LLM_ENCRYPTION_KEY env var — a 64-char hex string (32 bytes).
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey() {
  const hex = process.env.LLM_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('LLM_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

/** Encrypt a plaintext string → "iv:authTag:ciphertext" (all hex) */
export function encrypt(text) {
  const key    = getKey()
  const iv     = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

/** Decrypt "iv:authTag:ciphertext" → plaintext string */
export function decrypt(ciphertext) {
  const key              = getKey()
  const [ivH, tagH, encH] = ciphertext.split(':')
  const decipher         = createDecipheriv(ALGO, key, Buffer.from(ivH, 'hex'))
  decipher.setAuthTag(Buffer.from(tagH, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(encH, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}
