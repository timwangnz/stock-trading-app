/**
 * ConfigContext — runtime config fetched from /api/config before app render.
 * Provides: googleClientId (string | null)
 *
 * main.jsx fetches the config and passes it via ConfigProvider.
 */

import { createContext, useContext } from 'react'

const ConfigContext = createContext({ googleClientId: null })

export function ConfigProvider({ config, children }) {
  return (
    <ConfigContext.Provider value={config}>
      {children}
    </ConfigContext.Provider>
  )
}

export function useConfig() {
  return useContext(ConfigContext)
}
