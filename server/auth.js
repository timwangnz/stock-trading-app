/**
 * server/auth.js
 * Auth helpers used by the Express server:
 *
 *  verifyGoogleToken  — validates the ID token Google sends after sign-in
 *  signJwt            — issues our own short-lived session token
 *  authMiddleware     — Express middleware that protects API routes
 */

import jwt              from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import dotenv           from 'dotenv'

dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

// Read JWT_SECRET once at startup — it never changes at runtime
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

/**
 * Verify the Google ID token the frontend sends after the user clicks
 * "Sign in with Google".  Returns the user's profile from Google.
 *
 * NOTE: We read GOOGLE_CLIENT_ID inside the function (not at module load time)
 * to avoid ES module hoisting issues where the env var could be undefined
 * before dotenv has finished populating process.env.
 */
export async function verifyGoogleToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const client   = new OAuth2Client(clientId)

  const ticket  = await client.verifyIdToken({ idToken, audience: clientId })
  const payload = ticket.getPayload()
  return {
    googleId: payload.sub,
    email:    payload.email,
    name:     payload.name,
    avatar:   payload.picture,
  }
}

/**
 * Exchange a Google OAuth authorization code for an ID token,
 * then verify and return the user profile.
 * Used by the useGoogleLogin popup flow (redirect_uri = 'postmessage').
 */
export async function exchangeGoogleCode(code) {
  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const client       = new OAuth2Client(clientId, clientSecret, 'postmessage')

  const { tokens } = await client.getToken(code)
  if (!tokens.id_token) throw new Error('No id_token in Google token response')

  const ticket  = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId })
  const payload = ticket.getPayload()
  return {
    googleId: payload.sub,
    email:    payload.email,
    name:     payload.name,
    avatar:   payload.picture,
  }
}

/**
 * Issue a JWT — includes role so every request carries permission info
 * without a DB lookup.
 */
export function signJwt(user) {
  return jwt.sign(
    {
      id:          user.id,
      email:       user.email,
      name:        user.name,
      avatar:      user.avatar,
      role:        user.role ?? 'user',
      is_disabled: user.is_disabled ?? false,
    },
    JWT_SECRET,
    { expiresIn: '24h' }   // reduced from 7d — limits exposure if token is stolen
  )
}

/**
 * Express middleware — verifies JWT and blocks disabled accounts.
 */
export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — please sign in' })
  }
  try {
    const user = jwt.verify(auth.slice(7), JWT_SECRET)
    if (user.is_disabled) {
      return res.status(403).json({ error: 'Account disabled — contact an administrator' })
    }
    req.user = user
    next()
  } catch {
    res.status(401).json({ error: 'Token invalid or expired — please sign in again' })
  }
}
