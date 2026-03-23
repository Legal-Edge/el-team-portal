'use server'

import { getTeamSession } from '@/lib/session'
import { supabaseAdmin }  from '@/lib/supabase'

// Provision ALL Azure users — no domain restriction
// Domain-gated login is handled separately in auth.ts
const DEFAULT_ROLE_ID = '5ed767f1-1442-404b-a440-25aa81c6d2b1' // staff
const OWNER_EMAIL     = process.env.PORTAL_OWNER_EMAIL ?? 'novaj@rockpointgrowth.com'
const BASE            = process.env.NEXTAUTH_URL ?? 'https://team.easylemon.com'
const TOKEN           = process.env.BACKFILL_IMPORT_TOKEN!

export async function provisionAllUsersAction(): Promise<{
  success:     boolean
  created:     number
  skipped:     number
  errors:      number
  firstError?: string
  error?:      string
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

    // All active, non-blocked Azure users (no domain filter)
    const eligible = (users as Array<{
      email: string | null; name: string | null; enabled: boolean; blocked: boolean
    }>).filter(u => u.email && u.enabled && !u.blocked)

    // Get existing staff_users emails
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .schema('staff')
      .from('staff_users')
      .select('email')

    if (fetchErr) throw new Error(`Fetch existing: ${fetchErr.message}`)

    const existingEmails = new Set((existing ?? []).map((e: { email: string }) => e.email.toLowerCase()))

    const toInsert = eligible.filter(u => !existingEmails.has(u.email!.toLowerCase()))

    if (toInsert.length === 0) {
      return { success: true, created: 0, skipped: eligible.length, errors: 0 }
    }

    // Insert one-by-one to isolate failures
    let created    = 0
    let errors     = 0
    let firstError = ''

    for (const u of toInsert) {
      const nameParts = (u.name ?? u.email!.split('@')[0]).split(' ')
      const firstName = nameParts[0] ?? ''
      const lastName  = nameParts.slice(1).join(' ') || ''

      const { error } = await supabaseAdmin
        .schema('staff')
        .from('staff_users')
        .insert({
          email:           u.email!.toLowerCase(),
          first_name:      firstName,
          last_name:       lastName,
          display_name:    u.name,
          primary_role_id: DEFAULT_ROLE_ID,
          status:          'active',
        })

      if (error) {
        if (!firstError) firstError = `${u.email}: ${error.message} (code: ${error.code})`
        errors++
      } else {
        created++
      }
    }

    return { success: true, created, skipped: existingEmails.size, errors, firstError }
  } catch (err) {
    return { success: false, created: 0, skipped: 0, errors: 0, error: String(err) }
  }
}
