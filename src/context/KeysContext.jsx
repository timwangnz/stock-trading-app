/**
 * KeysContext.jsx
 * Tracks which API keys / integrations the user has configured.
 * Used by the Sidebar badge and AI feature inline notices.
 *
 * Currently tracks: LLM provider (hasApiKey)
 * Future: Polygon per-user, Resend per-user, etc.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { getLLMSettings } from '../services/apiService'

const KeysContext = createContext(null)

export function KeysProvider({ children }) {
  const { user } = useAuth()
  const [llmConfigured, setLlmConfigured] = useState(false)
  const [loading,       setLoading]       = useState(true)

  const refresh = useCallback(async () => {
    if (!user) { setLlmConfigured(false); setLoading(false); return }
    try {
      const data = await getLLMSettings()
      setLlmConfigured(!!data.hasApiKey)
    } catch {
      setLlmConfigured(false)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  return (
    <KeysContext.Provider value={{ llmConfigured, loading, refresh }}>
      {children}
    </KeysContext.Provider>
  )
}

export function useKeys() {
  const ctx = useContext(KeysContext)
  if (!ctx) throw new Error('useKeys must be used inside <KeysProvider>')
  return ctx
}
