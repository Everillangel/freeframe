'use client'

import * as React from 'react'
import { Palette, Upload, X, Check, RotateCcw, Moon, Sun } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useBrandingStore } from '@/stores/branding-store'
import { useThemeStore } from '@/stores/theme-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function LogoUploadSlot({
  label,
  description,
  logoUrl,
  onUpload,
  onRemove,
  previewBg,
}: {
  label: string
  description: string
  logoUrl: string | null
  onUpload: (url: string) => void
  onRemove: () => void
  previewBg: string
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result
      if (typeof result === 'string') onUpload(result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border border-border bg-bg-secondary">
      {/* Preview */}
      <div
        className={`h-16 w-16 rounded-xl border border-border flex items-center justify-center overflow-hidden shrink-0 ${previewBg}`}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={label} className="h-full w-full object-contain p-1" />
        ) : (
          <span className="text-xs text-text-tertiary text-center leading-tight px-1">No logo</span>
        )}
      </div>

      {/* Info + actions */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-tertiary mt-0.5 mb-3">{description}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            {logoUrl ? 'Replace' : 'Upload'}
          </Button>
          {logoUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="text-status-error hover:text-status-error hover:bg-status-error/10"
            >
              <X className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-2xs text-text-tertiary mt-2">PNG, JPG, SVG or WebP · Max 2 MB</p>
      </div>
    </div>
  )
}

export default function BrandingPage() {
  const { user } = useAuthStore()
  const { orgName, orgLogoDark, orgLogoLight, setOrgName, setOrgLogoDark, setOrgLogoLight, resetAll } = useBrandingStore()
  const { theme } = useThemeStore()

  const [nameValue, setNameValue] = React.useState(orgName)
  const [nameSaved, setNameSaved] = React.useState(false)

  React.useEffect(() => { setNameValue(orgName) }, [orgName])

  function handleSaveName() {
    const trimmed = nameValue.trim()
    if (!trimmed) return
    setOrgName(trimmed)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  const isAdmin = user?.is_superadmin
  const hasCustomBranding = orgName !== 'FreeFrame' || orgLogoDark !== null || orgLogoLight !== null

  // Which logo is active right now
  const activeLogo = theme === 'light' ? (orgLogoLight ?? orgLogoDark) : (orgLogoDark ?? orgLogoLight)

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-muted">
          <Palette className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Branding</h1>
          <p className="text-sm text-text-secondary">Customize your workspace name and logo</p>
        </div>
      </div>

      {/* Workspace name */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">Workspace name</h2>
        <div className="p-4 rounded-lg border border-border bg-bg-secondary space-y-3">
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                placeholder="e.g. Acme Studio"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                className="max-w-xs"
              />
              <Button
                size="sm"
                onClick={handleSaveName}
                disabled={!nameValue.trim() || nameValue.trim() === orgName}
              >
                {nameSaved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{orgName}</p>
          )}
          <p className="text-xs text-text-tertiary">
            Shown in the sidebar. Defaults to &ldquo;FreeFrame&rdquo;.
          </p>
        </div>
      </section>

      {/* Logo — per theme */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">Logo</h2>
        <p className="text-xs text-text-tertiary -mt-1">
          Upload separate logos for dark and light themes. If only one is set, it will be used for both.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Moon className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Dark theme</span>
          </div>
          <LogoUploadSlot
            label="Dark theme logo"
            description="Shown when the app is in dark mode. Use a light-colored logo."
            logoUrl={orgLogoDark}
            onUpload={isAdmin ? setOrgLogoDark : () => {}}
            onRemove={isAdmin ? () => setOrgLogoDark(null) : () => {}}
            previewBg="bg-zinc-900"
          />

          <div className="flex items-center gap-2 mt-4 mb-1">
            <Sun className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Light theme</span>
          </div>
          <LogoUploadSlot
            label="Light theme logo"
            description="Shown when the app is in light mode. Use a dark-colored logo."
            logoUrl={orgLogoLight}
            onUpload={isAdmin ? setOrgLogoLight : () => {}}
            onRemove={isAdmin ? () => setOrgLogoLight(null) : () => {}}
            previewBg="bg-white"
          />
        </div>
      </section>

      {/* Live preview */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">Preview</h2>
        <p className="text-xs text-text-tertiary -mt-1">
          Currently showing the <strong>{theme === 'light' ? 'light' : 'dark'}</strong> theme logo.
        </p>
        <div className="rounded-lg border border-border bg-bg-secondary p-4 flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md overflow-hidden flex items-center justify-center bg-bg-tertiary shrink-0">
            {activeLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeLogo} alt={orgName} className="h-full w-full object-contain" />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-icon.png" alt="FreeFrame" className="h-6 w-6 object-contain logo-dark" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-icon-dark.png" alt="FreeFrame" className="h-6 w-6 object-contain logo-light" />
              </>
            )}
          </div>
          <span className="text-sm font-semibold text-text-primary tracking-tight">{orgName}</span>
        </div>
      </section>

      {/* Reset */}
      {isAdmin && hasCustomBranding && (
        <section className="pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="text-status-error hover:text-status-error hover:bg-status-error/10 gap-1.5"
            onClick={() => { resetAll(); setNameValue('FreeFrame') }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to defaults
          </Button>
        </section>
      )}

      {!isAdmin && (
        <p className="text-xs text-text-tertiary">Only super admins can edit branding settings.</p>
      )}
    </div>
  )
}
