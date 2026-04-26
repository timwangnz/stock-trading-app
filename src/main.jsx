import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './context/AuthContext'
import { AppProvider } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import { KeysProvider } from './context/KeysContext'
import './index.css'
import App from './App.jsx'

// GoogleOAuthProvider is now owned by Login.jsx so it can re-fetch the
// client ID on every login page visit — picking up App Settings changes
// without requiring an app restart.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AppProvider>
        <KeysProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </KeysProvider>
      </AppProvider>
    </AuthProvider>
  </StrictMode>,
)
