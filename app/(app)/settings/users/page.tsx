import { getTeamSession }   from '@/lib/session'
import { redirect }          from 'next/navigation'
import { UsersTable }        from '@/components/settings/UsersTable'

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

  const active   = users.filter((u: { enabled: boolean }) => u.enabled).length
  const disabled = users.filter((u: { enabled: boolean }) => !u.enabled).length
  const noTitle  = users.filter((u: { title: string | null }) => !u.title).length

  return (
    <div className="p-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Users &amp; Teams</h1>
        <p className="mt-1 text-sm text-gray-500">
          Staff accounts are managed in Azure AD and sync automatically.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Users',     value: users.length, sub: null },
          { label: 'Active',          value: active,       sub: null },
          { label: 'Disabled',        value: disabled,     sub: disabled > 0 ? 'Review in Azure' : null },
          { label: 'No Role Assigned',value: noTitle,      sub: noTitle > 0 ? 'Assign job titles in Azure' : null },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            {s.sub && (
              <p className="text-[11px] text-lemon-600 font-medium mt-1">{s.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* Table */}
      {error ? (
        <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-red-600 text-sm">
          {error}
        </div>
      ) : (
        <UsersTable users={users} />
      )}
    </div>
  )
}
