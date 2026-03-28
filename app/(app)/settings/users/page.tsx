import { getTeamSession }   from '@/lib/session'
import { redirect }          from 'next/navigation'
import { UsersPageClient }   from '@/components/settings/UsersPageClient'

export const dynamic = 'force-dynamic'

const BASE  = process.env.NEXTAUTH_URL ?? 'https://team.easylemon.com'
const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

async function fetchAll() {
  const [azureRes, rolesRes] = await Promise.all([
    fetch(`${BASE}/api/admin/azure-users`,  { headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store' }),
    fetch(`${BASE}/api/admin/staff-roles`,  { headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store' }),
  ])

  const [azureData, rolesData] = await Promise.all([
    azureRes.ok  ? azureRes.json()  : azureRes.json().catch(() => ({ users: [], error: `HTTP ${azureRes.status}: Failed to load users` })),
    rolesRes.ok  ? rolesRes.json()  : { roles: [], staffUsers: [] },
  ])

  // Surface the real error from the API response
  if (!azureRes.ok && azureData.detail) {
    azureData.error = `${azureData.error ?? 'Error'}: ${JSON.stringify(azureData.detail)}`
  }

  return {
    users:      azureData.users      ?? [],
    error:      azureData.error      ?? null,
    roles:      rolesData.roles      ?? [],
    staffUsers: rolesData.staffUsers ?? [],
  }
}

export default async function UsersPage() {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') redirect('/dashboard')

  const { users, error, roles, staffUsers } = await fetchAll()

  const ROLE_EDITOR = process.env.PORTAL_OWNER_EMAIL ?? 'novaj@rockpointgrowth.com'
  const canEditRoles = session.email.toLowerCase() === ROLE_EDITOR.toLowerCase()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Users &amp; Teams</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff accounts sync automatically from Azure AD. Portal roles control what each user can see and do.
        </p>
      </div>
      <UsersPageClient users={users} error={error} roles={roles} staffUsers={staffUsers} canEditRoles={canEditRoles} />
    </div>
  )
}
