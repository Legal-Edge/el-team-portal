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
    '/api/webhooks',   // all inbound webhooks (Aloware, SharePoint, etc.)
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}