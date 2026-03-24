'use client'

import { useEffect } from 'react'
import { useThemeStore } from '@/stores/theme-store'

export function ThemeInitializer() {
  const { theme, setTheme } = useThemeStore()

  useEffect(() => {
    // Apply theme on mount
    setTheme(theme)

    // Listen for system theme changes when in 'system' mode
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => setTheme('system')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme, setTheme])

  return null
}
