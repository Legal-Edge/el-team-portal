'use server'

import { getTeamSession } from '@/lib/session'
import { supabaseAdmin }  from '@/lib/supabase'

const ALLOWED_DOMAINS  = ['easylemon.com', 'rockpointgrowth.com', 'rockpointlaw.com']
const DEFAULT_ROLE_ID  = '5ed767f1-1442-404b-a440-25aa81c6d2b1' // staff
const OWNER_EMAIL      = process.env.PORTAL_OWNER_EMAIL ?? 'novaj@rockpointgrowth.com'

const BASE  = process.env.NEXTAUTH_URL ?? 'https://team.easylemon.com'
const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function provisionAllUsersAction(): Promise<{
  success:  boolean
  created:  number
  skipped:  number
  errors:   number
  error?:   string
}> {
  const session = await getTeamSession()
  const realEmail = session?.impersonating?.impersonatorEmail ?? session?.email
  if (!session || realEmail?.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    return { success: false, created: 0, skipped: 0, errors: 0, error: 'Unauthorized' }
  }

  try {
    // Fetch Azure users
    const azureRes = await fetch(`${BASE}/api/admin/azure-users`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
    })
    if (!azureRes.ok) throw new Error('Failed to fetch Azure users')
    const { users } = await azureRes.json()

    // Filter: active, not blocked, allowed domain
    const eligible = (users as Array<{
      email: string | null; name: string | null; enabled: boolean; blocked: boolean
    }>).filter(u =>
      u.email &&
      u.enabled &&
      !u.blocked &&
      ALLOWED_DOMAINS.includes(u.email.split('@')[1])
    )

    // Get existing staff_users emails
    const { data: existing } = await supabaseAdmin
      .schema('staff')
      .from('staff_users')
      .select('email')

    const existingEmails = new Set((existing ?? []).map((e: { email: string }) => e.email.toLowerCase()))

    // Build inserts for users not yet provisioned
    const toInsert = eligible
      .filter(u => !existingEmails.has(u.email!.toLowerCase()))
      .map(u => {
        const [first, ...rest] = (u.name ?? u.email!.split('@')[0]).split(' ')
        return {
          email:           u.email!.toLowerCase(),
          first_name:      first ?? null,
          last_name:       rest.join(' ') || null,
          display_name:    u.name,
          primary_role_id: DEFAULT_ROLE_ID,
          status:          'active',
          is_deleted:      false,
        }
      })

    if (toInsert.length === 0) {
      return { success: true, created: 0, skipped: eligible.length, errors: 0 }
    }

    // Batch insert in chunks of 50
    let created = 0
    let errors  = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const chunk = toInsert.slice(i, i + 50)
      const { error } = await supabaseAdmin
        .schema('staff')
        .from('staff_users')
        .insert(chunk)
      if (error) {
        console.error('Provision chunk error:', error)
        errors += chunk.length
      } else {
        created += chunk.length
      }
    }

    return {
      success: true,
      created,
      skipped: eligible.length - toInsert.length,
      errors,
    }
  } catch (err) {
    return { success: false, created: 0, skipped: 0, errors: 0, error: String(err) }
  }
}
