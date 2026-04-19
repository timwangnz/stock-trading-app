/**
 * ResetPassword.jsx
 * Shown when the user arrives via a ?reset_token=... link from their email.
 * Lets them set a new password, then redirects to login.
 */

import { useState } from 'react'
import { TrendingUp, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { resetPassword } from '../services/apiService'

export default function ResetPassword({ token, onDone }) {
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [success, setSuccess]     = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm)  return setError('Passwords do not match.')

    setLoading(true)
    try {
      await resetPassword(token, password)
      setSuccess(true)
      setTimeout(onDone, 2500)
    } catch (err) {
      try {
        const body = JSON.parse(err.message.split('→')[1]?.trim() ?? '{}')
        setError(body.error ?? 'Reset failed — please try again.')
      } catch {
        setError('Reset failed — please request a new link.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-accent-blue/10 flex items-center justify-center">
          <TrendingUp size={22} className="text-accent-blue" />
        </div>
        <h1 className="text-primary font-bold text-2xl tracking-tight">TradeBuddy</h1>
      </div>

      <div className="bg-surface-card border border-border rounded-2xl p-6 w-80 shadow-2xl space-y-5">
        <div>
          <h2 className="text-primary font-semibold text-lg">Set new password</h2>
          <p className="text-muted text-xs mt-1">Choose a strong password for your account.</p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 size={36} className="text-gain" />
            <p className="text-primary font-medium text-sm">Password updated!</p>
            <p className="text-muted text-xs text-center">Redirecting you to sign in…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-muted text-xs">New Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors"
                />
                <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-muted text-xs">Confirm Password</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat password"
                className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent-blue/50 transition-colors"
              />
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Saving…' : 'Set New Password'}
            </button>

            <button type="button" onClick={onDone}
              className="text-center text-xs text-muted hover:text-primary transition-colors">
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
