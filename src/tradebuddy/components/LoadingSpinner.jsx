/**
 * LoadingSpinner.jsx + ErrorMessage.jsx
 * Small shared UI pieces used whenever we're waiting on the Polygon API.
 */

import { AlertCircle, Loader2 } from 'lucide-react'

/** Centered spinner for full-page or section loading states */
export function LoadingSpinner({ message = 'Fetching live data…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Loader2 size={28} className="text-accent-blue animate-spin" />
      <p className="text-muted text-sm">{message}</p>
    </div>
  )
}

/** Inline error banner with the error message */
export function ErrorMessage({ error }) {
  const msg = error?.message ?? String(error)
  return (
    <div className="m-6 bg-loss/10 border border-loss/30 rounded-xl px-5 py-4 flex items-start gap-3">
      <AlertCircle size={18} className="text-loss shrink-0 mt-0.5" />
      <div>
        <p className="text-loss font-medium text-sm">Failed to load data</p>
        <p className="text-muted text-xs mt-1 font-mono">{msg}</p>
        {msg.includes('POLYGON_API_KEY') && (
          <p className="text-muted text-xs mt-2">
            👉 Make sure <code className="bg-surface-hover px-1 rounded">POLYGON_API_KEY</code> is set
            in your server <code className="bg-surface-hover px-1 rounded">.env</code> file.
            See <strong>SETUP.md</strong> for instructions.
          </p>
        )}
      </div>
    </div>
  )
}
