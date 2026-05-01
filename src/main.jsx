import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './common/context/AuthContext'
import { AppProvider } from './tradebuddy/context/AppContext'
import { ThemeProvider } from './common/context/ThemeContext'
import { KeysProvider } from './common/context/KeysContext'
import { THEMES } from './tradebuddy/theme.js'
import './index.css'
import App from './App.jsx'

// ── Client-side error reporter ───────────────────────────────────
// Sends unhandled JS errors and promise rejections to the server so
// they appear in the admin Error Log. Fire-and-forget — never throws.
function reportClientError(message, details = null) {
  try {
    const token = localStorage.getItem('vantage_token')
    fetch('/api/client-error', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message: String(message).slice(0, 500), details }),
    }).catch(() => {})   // silently ignore network failures
  } catch { /* ignore */ }
}

window.addEventListener('error', (e) => {
  reportClientError(e.message, { source: e.filename, line: e.lineno, col: e.colno })
})

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? 'Unhandled rejection')
  reportClientError(msg, { stack: e.reason instanceof Error ? e.reason.stack?.slice(0, 500) : null })
})

// ── React Error Boundary ─────────────────────────────────────────
// Catches React render errors and reports them before showing the fallback.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { crashed: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, error }
  }

  componentDidCatch(error, info) {
    reportClientError(`React render error: ${error.message}`, {
      stack:          error.stack?.slice(0, 500),
      componentStack: info?.componentStack?.slice(0, 500),
    })
  }

  render() {
    if (this.state.crashed) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', color: '#ef4444' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>{this.state.error?.message}</p>
          <button
            onClick={() => { this.setState({ crashed: false, error: null }); window.location.reload() }}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// GoogleOAuthProvider is now owned by Login.jsx so it can re-fetch the
// client ID on every login page visit — picking up App Settings changes
// without requiring an app restart.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AppProvider>
          <KeysProvider>
            <ThemeProvider themes={THEMES}>
              <App />
            </ThemeProvider>
          </KeysProvider>
        </AppProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
