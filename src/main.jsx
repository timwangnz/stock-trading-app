import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from './context/AuthContext'
import { AppProvider } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import './index.css'
import App from './App.jsx'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* GoogleOAuthProvider must be the outermost wrapper */}
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {/* AuthProvider manages the signed-in user + JWT */}
      <AuthProvider>
        {/* AppProvider manages portfolio + watchlist — must be inside AuthProvider
            so it can react to login/logout via useAuth() */}
        <AppProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </AppProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
)
