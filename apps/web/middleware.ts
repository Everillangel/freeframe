import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/setup']
const PUBLIC_PREFIXES = ['/invite/', '/share/']

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  return false
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes through
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  // Check for auth tokens in cookies (middleware runs on server, no localStorage)
  // Allow through if either access token or refresh token exists
  // (client-side JS will handle token refresh if access token is expired)
  const accessToken = request.cookies.get('ff_access_token')?.value
  const refreshToken = request.cookies.get('ff_refresh_token')?.value

  if (!accessToken && !refreshToken) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - api routes
     * - public assets (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)).*)',
  ],
}
