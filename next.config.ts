import type { NextConfig } from 'next'

// Derive Supabase hostname dynamically from env so CSP always matches
// regardless of which Supabase project is configured in Vercel.
const sbUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const sbHostname = sbUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') // e.g. "xyzxyz.supabase.co"
const sbHttps    = sbHostname ? `https://${sbHostname}` : ''
const sbWss      = sbHostname ? `wss://${sbHostname}`   : ''

const securityHeaders = [
  { key: 'X-Frame-Options',        value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${sbHttps}`,
      `connect-src 'self' ${sbHttps} wss://realtime.supabase.co ${sbWss} https://login.microsoftonline.com https://graph.microsoft.com https://app.aloware.com`,
      "frame-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://login.microsoftonline.com",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  images: {
    remotePatterns: sbHostname
      ? [{ protocol: 'https', hostname: sbHostname, pathname: '/storage/v1/object/public/**' }]
      : [],
    formats: ['image/avif', 'image/webp'],
  },
}

export default nextConfig
