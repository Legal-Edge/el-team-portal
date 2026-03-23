import { getTeamSession }   from '@/lib/session'
import { redirect }          from 'next/navigation'
import { UsersPageClient }   from '@/components/settings/UsersPageClient'

export const dynamic = 'force-dynamic'

async function fetchAzureUsers() {
  const token = process.env.BACKFILL_IMPORT_TOKEN!
  const base  = process.env.NEXTAUTH_URL ?? 'https://team.easylemon.com'

  try {
    const res = await fetch(`${base}/api/admin/azure-users`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return { users: [], error: 'Failed to load users' }
    const data = await res.json()
    return { users: data.users ?? [], error: null }
  } catch {
    return { users: [], error: 'Network error' }
  }
}

export default async function UsersPage() {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') redirect('/dashboard')

  const { users, error } = await fetchAzureUsers()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Users &amp; Teams</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff accounts sync automatically from Azure AD.
        </p>
      </div>
      <UsersPageClient users={users} error={error} />
    </div>
  )
}
