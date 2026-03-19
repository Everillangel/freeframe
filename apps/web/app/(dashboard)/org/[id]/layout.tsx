'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { Avatar } from '@/components/shared/avatar'
import type { Organization } from '@/types'

const tabs = [
  { label: 'Overview', href: '' },
  { label: 'Members', href: '/members' },
  { label: 'Teams', href: '/teams' },
  { label: 'Settings', href: '/settings' },
]

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const orgId = params.id as string

  const { data: org } = useSWR<Organization>(
    `/organizations/${orgId}`,
    () => api.get<Organization>(`/organizations/${orgId}`),
  )

  return (
    <div className="flex flex-col h-full">
      {/* Org header */}
      <div className="border-b border-border bg-bg-secondary px-6 py-4">
        <div className="flex items-center gap-3 mb-4">
          {org?.logo_url ? (
            <Avatar src={org.logo_url} name={org.name} size="lg" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-muted shrink-0">
              <Building2 className="h-5 w-5 text-accent" />
            </div>
          )}
          <div>
            <h1 className="text-lg font-semibold text-text-primary">
              {org?.name ?? <span className="h-5 w-32 animate-pulse rounded bg-bg-tertiary inline-block" />}
            </h1>
            {org?.slug && (
              <p className="text-xs text-text-tertiary">/{org.slug}</p>
            )}
          </div>
        </div>

        {/* Sub-navigation */}
        <nav className="flex items-center gap-1 -mb-px">
          {tabs.map((tab) => {
            const href = `/org/${orgId}${tab.href}`
            return (
              <NavTab key={tab.label} href={href} label={tab.label} orgId={orgId} suffix={tab.href} />
            )
          })}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function NavTab({
  href,
  label,
  orgId,
  suffix,
}: {
  href: string
  label: string
  orgId: string
  suffix: string
}) {
  const [active, setActive] = React.useState(false)

  React.useEffect(() => {
    const path = window.location.pathname
    const expected = `/org/${orgId}${suffix}`
    setActive(path === expected)
  }, [orgId, suffix])

  return (
    <Link
      href={href}
      className={cn(
        'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border',
      )}
    >
      {label}
    </Link>
  )
}
