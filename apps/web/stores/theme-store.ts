import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  syncFromServer: (preferences: Record<string, unknown>) => void
}

function getResolvedTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'dark'
  }
  return theme
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const resolved = getResolvedTheme(theme)
  document.documentElement.setAttribute('data-theme', resolved)
}

async function saveToServer(theme: Theme) {
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ff_access_token') : null
    if (!token) return
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    await fetch(`${API_URL}/auth/me/preferences`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ theme }),
    })
  } catch {
    // Silent fail — localStorage still has the value
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
        saveToServer(theme)
      },
      syncFromServer: (preferences) => {
        const serverTheme = preferences?.theme as Theme | undefined
        if (serverTheme && ['dark', 'light', 'system'].includes(serverTheme)) {
          applyTheme(serverTheme)
          set({ theme: serverTheme })
        }
      },
    }),
    {
      name: 'ff-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)
