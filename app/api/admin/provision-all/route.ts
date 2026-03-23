import { NextResponse }  from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BEARER_TOKEN    = process.env.BACKFILL_IMPORT_TOKEN!
const DEFAULT_ROLE_ID = '5ed767f1-1442-404b-a440-25aa81c6d2b1' // staff
const BASE            = process.env.NEXTAUTH_URL ?? 'https://team.easylemon.com'

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all Azure users
  const azureRes = await fetch(`${BASE}/api/admin/azure-users`, {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
    cache: 'no-store',
  })
  const { users } = await azureRes.json()

  // All active, non-blocked users
  const eligible = (users as Array<{ email: string | null; name: string | null; enabled: boolean; blocked: boolean }>)
    .filter(u => u.email && u.enabled && !u.blocked)

  // Get existing
  const { data: existing } = await supabaseAdmin.schema('staff').from('staff_users').select('email')
  const existingEmails = new Set((existing ?? []).map((e: { email: string }) => e.email.toLowerCase()))
  const toInsert = eligible.filter(u => !existingEmails.has(u.email!.toLowerCase()))

  const results: Array<{ email: string; status: 'ok' | 'error'; error?: string }> = []

  for (const u of toInsert) {
    const parts     = (u.name ?? u.email!.split('@')[0]).split(' ')
    const firstName = parts[0] ?? ''
    const lastName  = parts.slice(1).join(' ') || '' // empty string satisfies NOT NULL

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

    results.push({ email: u.email!, status: error ? 'error' : 'ok', error: error?.message })
  }

  const created = results.filter(r => r.status === 'ok').length
  const errors  = results.filter(r => r.status === 'error')

  return NextResponse.json({
    total_eligible:  eligible.length,
    already_existed: existingEmails.size,
    attempted:       toInsert.length,
    created,
    errors:          errors.length,
    error_details:   errors.slice(0, 10), // first 10 errors
  })
}
