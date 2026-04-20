/**
 * Login.jsx
 * Sign-in / sign-up page with two methods:
 *   1. Google One-Tap
 *   2. Email + Password (with a Sign Up / Sign In toggle)
 */

import { useState } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react'
import { forgotPassword } from '../services/apiService'

// ── Small reusable input ────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, right }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-muted text-xs">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors"
        />
        {right && <div className="absolute right-2 top-1/2 -translate-y-1/2">{right}</div>}
      </div>
    </div>
  )
}

// ── Email/Password form (handles both sign-in and sign-up) ──────
function EmailForm({ onSuccess, onForgot }) {
  const { signUp, signIn }       = useAuth()
  const [mode, setMode]          = useState('signin')   // 'signin' | 'signup'
  const [name, setName]          = useState('')
  const [email, setEmail]        = useState('')
  const [password, setPassword]  = useState('')
  const [confirm, setConfirm]    = useState('')
  const [showPw, setShowPw]      = useState(false)
  const [loading, setLoading]    = useState(false)
  const [error, setError]        = useState(null)

  const isSignUp = mode === 'signup'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (isSignUp) {
      if (!name.trim())         return setError('Please enter your name.')
      if (password !== confirm) return setError('Passwords do not match.')
      if (password.length < 8)  return setError('Password must be at least 8 characters.')
    }

    setLoading(true)
    try {
      if (isSignUp) {
        await signUp(name, email, password)
      } else {
        await signIn(email, password)
      }
      onSuccess?.()
    } catch (err) {
      try {
        const body = JSON.parse(err.message.split('→')[1]?.trim() ?? '{}')
        setError(body.error ?? err.message)
      } catch {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setError(null) }

  const pwToggle = (
    <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
      className="text-muted hover:text-primary transition-colors">
      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {isSignUp && (
        <div className="bg-accent-blue/8 border border-accent-blue/20 rounded-lg px-3 py-2.5 space-y-1">
          <p className="text-accent-blue text-xs font-medium">New accounts include:</p>
          {['Edit your portfolio (buy & sell)', 'Manage your watchlist', 'View charts & price data'].map(item => (
            <div key={item} className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-accent-blue/70 shrink-0" />
              <span className="text-accent-blue/70 text-xs">{item}</span>
            </div>
          ))}
        </div>
      )}

      {isSignUp && (
        <Field label="Name" value={name} onChange={e => setName(e.target.value)}
          placeholder="Your name" />
      )}
      <Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com" />
      <Field label="Password" type={showPw ? 'text' : 'password'}
        value={password} onChange={e => setPassword(e.target.value)}
        placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
        right={pwToggle} />
      {isSignUp && (
        <Field label="Confirm Password" type={showPw ? 'text' : 'password'}
          value={confirm} onChange={e => setConfirm(e.target.value)}
          placeholder="Repeat password" />
      )}

      {!isSignUp && (
        <button type="button" onClick={onForgot}
          className="text-xs text-muted hover:text-accent-blue transition-colors text-left -mt-1">
          Forgot password?
        </button>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="mt-1 w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
      >
        {loading ? 'Please wait…' : isSignUp ? 'Create Account' : 'Sign In'}
      </button>

      <p className="text-center text-xs text-muted">
        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button type="button" onClick={toggle}
          className="text-accent-blue hover:underline">
          {isSignUp ? 'Sign In' : 'Sign Up'}
        </button>
      </p>
    </form>
  )
}

// ── Forgot Password form ────────────────────────────────────────
function ForgotPasswordForm({ onBack }) {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return setError('Please enter your email address.')
    setLoading(true)
    setError(null)
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CheckCircle2 size={32} className="text-gain" />
        <p className="text-primary font-medium text-sm">Check your inbox</p>
        <p className="text-muted text-xs leading-relaxed">
          If an account exists for <span className="text-primary">{email}</span>, a reset link has been sent. Check your spam folder too.
        </p>
        <button onClick={onBack} className="mt-2 text-xs text-accent-blue hover:underline">
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <button type="button" onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-primary transition-colors w-fit">
        <ArrowLeft size={13} /> Back to sign in
      </button>
      <div>
        <p className="text-primary font-medium text-sm">Forgot your password?</p>
        <p className="text-muted text-xs mt-0.5">Enter your email and we'll send a reset link.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted text-xs">Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
      >
        {loading ? 'Sending…' : 'Send Reset Link'}
      </button>
    </form>
  )
}

// ── Google Sign-In button ───────────────────────────────────────
function GoogleSignInButton({ onSuccess, onError }) {
  const [loading, setLoading] = useState(false)

  const login = useGoogleLogin({
    flow: 'implicit',
    onSuccess: async (tokenResponse) => {
      try {
        // Fetch the user's profile using the access token
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        })
        const profile = await res.json()
        // Pass access token to our backend
        await onSuccess(tokenResponse.access_token)
      } catch {
        onError()
      } finally {
        setLoading(false)
      }
    },
    onError: () => { setLoading(false); onError() },
    onNonOAuthError: () => { setLoading(false) },
  })

  return (
    <button
      onClick={() => { setLoading(true); login() }}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 disabled:opacity-60 text-gray-700 text-sm font-medium py-2.5 px-4 rounded-lg border border-gray-300 shadow-sm transition-colors"
    >
      {/* Google logo SVG */}
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.826.957 4.039l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
      </svg>
      {loading ? 'Signing in…' : 'Sign in with Google'}
    </button>
  )
}

// Google Sign-In is only available when a client ID was baked in at build time
const HAS_GOOGLE = !!import.meta.env.VITE_GOOGLE_CLIENT_ID

// ── Main Login page ─────────────────────────────────────────────
export default function Login() {
  const { loginWithToken }      = useAuth()
  const [tab, setTab]           = useState(HAS_GOOGLE ? 'google' : 'email')
  const [error, setError]       = useState(null)
  const [forgotMode, setForgotMode] = useState(false)

  const handleGoogleSuccess = async (accessToken) => {
    try {
      setError(null)
      await loginWithToken(accessToken)
    } catch {
      setError('Google sign-in failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-8">

      {/* Brand */}
      <div className="flex flex-col items-center gap-3">
        <img
          src="https://t3.ftcdn.net/jpg/01/36/20/40/360_F_136204027_JgHaab2r1wqenjQd6m1PNDJ6J9PM8tvH.jpg"
          alt="TradeBuddy"
          className="h-16 w-16 rounded-2xl object-cover shadow-xl"
        />
        <h1 className="text-primary font-bold text-3xl tracking-tight">TradeBuddy</h1>
        <p className="text-muted text-sm">Vibe Trading Platform</p>
      </div>

      {/* Card */}
      <div className="bg-surface-card border border-border rounded-2xl p-6 w-80 shadow-2xl space-y-5">

        {/* Tabs — only show Google tab if client ID is configured */}
        {HAS_GOOGLE && (
          <div className="flex rounded-lg bg-surface-hover p-1 gap-1">
            {[
              { key: 'google', label: 'Google' },
              { key: 'email',  label: 'Email'  },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setError(null) }}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === t.key
                    ? 'bg-surface-card text-primary shadow-sm'
                    : 'text-muted hover:text-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Tab content */}
        {HAS_GOOGLE && tab === 'google' ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-muted text-sm text-center">
              Sign in with your Google account
            </p>
            <GoogleSignInButton
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google sign-in failed. Please try again.')}
            />
            {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          </div>
        ) : forgotMode ? (
          <ForgotPasswordForm onBack={() => setForgotMode(false)} />
        ) : (
          <EmailForm onForgot={() => setForgotMode(true)} />
        )}
      </div>

      <p className="text-faint text-xs">
        Your data is private and tied to your account.
      </p>
    </div>
  )
}
