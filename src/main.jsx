import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from './context/AuthContext'
import { AppProvider } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import { KeysProvider } from './context/KeysContext'
import './index.css'
import App from './App.jsx'

// Use the env var baked in at build time.
// If empty (e.g. local Docker install), Google Sign-In is hidden in the UI.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* GoogleOAuthProvider must be the outermost wrapper */}
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {/* AuthProvider manages the signed-in user + JWT */}
      <AuthProvider>
        {/* AppProvider manages portfolio + watchlist — must be inside AuthProvider
            so it can react to login/logout via useAuth() */}
        <AppProvider>
          <KeysProvider>
            <ThemeProvider>
              <App />
            </ThemeProvider>
          </KeysProvider>
        </AppProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
)
