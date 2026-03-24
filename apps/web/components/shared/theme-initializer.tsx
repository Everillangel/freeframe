'use client'

import { useEffect } from 'react'
import { useThemeStore } from '@/stores/theme-store'
import { useAuthStore } from '@/stores/auth-store'

export function ThemeInitializer() {
  const { theme, setTheme, syncFromServer } = useThemeStore()
  const user = useAuthStore((s) => s.user)

  // Apply theme on mount
  useEffect(() => {
    setTheme(theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync from server when user loads
  useEffect(() => {
    if (user?.preferences) {
      syncFromServer(user.preferences)
    }
  }, [user?.preferences, syncFromServer])

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme, setTheme])

  return null
}
