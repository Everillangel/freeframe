import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface BrandingState {
  orgName: string
  /** Logo for dark theme (shown on dark backgrounds) */
  orgLogoDark: string | null
  /** Logo for light theme (shown on light backgrounds) */
  orgLogoLight: string | null
  setOrgName: (name: string) => void
  setOrgLogoDark: (url: string | null) => void
  setOrgLogoLight: (url: string | null) => void
  resetAll: () => void
}

export const useBrandingStore = create<BrandingState>()(
  persist(
    (set) => ({
      orgName: 'FreeFrame',
      orgLogoDark: null,
      orgLogoLight: null,
      setOrgName: (name) => set({ orgName: name }),
      setOrgLogoDark: (url) => set({ orgLogoDark: url }),
      setOrgLogoLight: (url) => set({ orgLogoLight: url }),
      resetAll: () => set({ orgName: 'FreeFrame', orgLogoDark: null, orgLogoLight: null }),
    }),
    {
      name: 'ff-branding',
      version: 2,
      migrate: () => ({
        orgName: 'FreeFrame',
        orgLogoDark: null,
        orgLogoLight: null,
      }),
    },
  ),
)
