/** @type {import('next').NextConfig} */

// Server-side address of the API, used to proxy the relative "/api" path the
// browser calls. In Docker this is the api service (http://api:8000); for a
// bare local dev server it's http://localhost:8000. A reverse proxy (nginx /
// Traefik) may route "/api" itself, in which case this rewrite is just a
// same-origin fallback.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:8000'

const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
      },
    ],
  },
  async rewrites() {
    return [
      // Browser calls same-origin "/api/*"; proxy it to the API (strips /api).
      { source: '/api/:path*', destination: `${API_PROXY_TARGET}/:path*` },
    ]
  },
}

module.exports = nextConfig
