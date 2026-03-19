import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FreeFrame — Auth',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center px-4">
      {/* Wordmark */}
      <div className="mb-10 flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="h-4 w-4 text-white"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.9" />
            <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.3" />
          </svg>
        </div>
        <span className="text-lg font-semibold tracking-tight text-text-primary">
          FreeFrame
        </span>
      </div>

      {/* Page content */}
      <div className="w-full max-w-sm animate-fade-in">
        {children}
      </div>
    </div>
  )
}
