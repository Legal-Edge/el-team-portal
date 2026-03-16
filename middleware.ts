import { auth } from "@/auth"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export default auth((req: NextRequest & { auth: any }) => {
  const { pathname } = req.nextUrl
  
  // Public routes that don't require authentication
  const publicRoutes = ['/login']
  
  // API routes that don't require authentication
  const publicApiRoutes = [
    '/api/auth',
    '/api/webhooks',        // all inbound webhooks (Aloware, SharePoint, etc.)
    '/api/admin/backfill-sms',    // one-time SMS backfill (token-protected, remove after use)
    '/api/admin/reconcile-comms',     // communications reconciliation job (token-protected)
    '/api/admin/sync-hubspot-cases',  // HubSpot → Supabase case sync (token-protected)
    '/api/admin/case-counts',         // case count stats (token-protected)
    '/api/admin/sync-missing-deals',  // gap-closing sync (token-protected)
    '/api/admin/cron',                // Vercel cron jobs (CRON_SECRET-protected)
    '/api/admin/count-check',          // HubSpot vs Supabase count reconciliation (token-protected)
    '/api/admin/find-orphaned-deals',  // Find deals in Supabase not in HubSpot (token-protected)
    '/api/admin/sharepoint',           // SharePoint admin endpoints (token-protected)
    '/api/webhooks/sharepoint',        // SharePoint Graph webhook (no session)
    '/api/webhooks/hubspot-team',     // HubSpot real-time webhook (token-protected)
  ]
  
  // Check if current path is public
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
  const isPublicApiRoute = publicApiRoutes.some(route => pathname.startsWith(route))
  
  // Allow public routes and API routes
  if (isPublicRoute || isPublicApiRoute) {
    return NextResponse.next()
  }
  
  // Redirect to login if not authenticated
  if (!req.auth?.user) {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }
  
  // Check if user is active
  if (req.auth.user.active === false) {
    const loginUrl = new URL('/login?error=inactive', req.url)
    return NextResponse.redirect(loginUrl)
  }
  
  return NextResponse.next()
})

// Configure which routes should be processed by the middleware
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/admin/backfill-sms|api/admin/reconcile-comms|api/admin/sync-hubspot-cases|api/admin/case-counts|api/admin/sync-missing-deals|api/admin/cron|api/admin/count-check|api/admin/find-orphaned-deals|api/admin/sharepoint|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}