import { getTeamSession, isAdmin } from '@/lib/session'
import { redirect } from 'next/navigation'

/**
 * Server-side guard for all /admin/* routes.
 * Any non-admin user is redirected to /dashboard before the page renders.
 * This cannot be bypassed client-side.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getTeamSession()

  if (!session) redirect('/login')
  if (!isAdmin(session)) redirect('/dashboard')

  return <>{children}</>
}
