import { getTeamSession }   from '@/lib/session'
import { redirect }          from 'next/navigation'
import { UsersPageClient }   from '@/components/settings/UsersPageClient'
import { supabaseAdmin }     from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const TENANT_ID     = process.env.SHAREPOINT_TENANT_ID!
const CLIENT_ID     = process.env.SHAREPOINT_CLIENT_ID!
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET!

async function fetchAzureUsers() {
  try {
    // Get MS Graph access token
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          scope:         'https://graph.microsoft.com/.default',
          grant_type:    'client_credentials',
        }),
        cache: 'no-store',
      }
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return { users: [], error: `Token error: ${JSON.stringify(tokenData)}` }
    }

    // Fetch users from Graph API
    const usersRes = await fetch(
      'https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName,jobTitle,department,accountEnabled&$top=999&$orderby=displayName',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` }, cache: 'no-store' }
    )
    const usersData = await usersRes.json()
    if (!usersRes.ok) {
      return { users: [], error: `Graph API error: ${JSON.stringify(usersData)}` }
    }

    // Get blocked users from Supabase
    let blockedEmails = new Set<string>()
    try {
      const { data: blocked } = await supabaseAdmin
        .from('portal_blocked_users')
        .select('email')
      blockedEmails = new Set((blocked ?? []).map((b: { email: string }) => b.email.toLowerCase()))
    } catch {
      // Table not yet created — treat as empty
    }

    const users = (usersData.value ?? []).map((u: Record<string, unknown>) => {
      const email = ((u.mail ?? u.userPrincipalName) as string | null)?.toLowerCase() ?? null
      return {
        name:       u.displayName,
        email,
        title:      u.jobTitle,
        department: u.department,
        enabled:    u.accountEnabled,
        blocked:    email ? blockedEmails.has(email) : false,
      }
    })

    return { users, error: null }
  } catch (err) {
    return { users: [], error: String(err) }
  }
}

async function fetchStaffRoles() {
  try {
    const [rolesRes, usersRes] = await Promise.all([
      supabaseAdmin.schema('staff').from('staff_roles')
        .select('id, role_name, role_level, description')
        .order('role_level', { ascending: false }),
      supabaseAdmin.schema('staff').from('staff_users')
        .select('id, email, primary_role_id, display_name, first_name, last_name, staff_roles!primary_role_id(role_name)')
        .eq('is_deleted', false)
        .returns<{ id: string; email: string; primary_role_id: string | null; display_name: string | null; first_name: string | null; last_name: string | null; staff_roles: { role_name: string } | null }[]>(),
    ])
    return {
      roles:      rolesRes.data ?? [],
      staffUsers: usersRes.data ?? [],
    }
  } catch {
    return { roles: [], staffUsers: [] }
  }
}

export default async function UsersPage() {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') redirect('/dashboard')

  const [{ users, error }, { roles, staffUsers }] = await Promise.all([
    fetchAzureUsers(),
    fetchStaffRoles(),
  ])

  const ROLE_EDITOR = process.env.PORTAL_OWNER_EMAIL ?? 'novaj@rockpointgrowth.com'
  const canEditRoles = session.email.toLowerCase() === ROLE_EDITOR.toLowerCase()

  return (
    <div className="p-4 md:p-8">
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
