import { NextResponse }  from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BEARER_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!
const BASE         = process.env.NEXTAUTH_URL ?? 'https://team.easylemon.com'

// ── Role mapping by job title ─────────────────────────────────────────────────
// Canonical role IDs from staff.staff_roles
const ROLE_IDS: Record<string, string> = {
  admin:        '9e226272-f967-4d4a-80a2-f6c062073a96',
  attorney:     '339e7692-40df-42eb-b28f-5c8a6ebb12d9',
  manager:      '5cc484f0-cadd-4c8d-83df-d59e56eba8d1',
  case_manager: '665f2ff5-c2c7-4e42-98a6-814c23b80785',
  paralegal:    '49676a1e-f8d0-42eb-bd7d-d58e4b55565c',
  support:      '144bf8e5-4111-46d1-97d8-7203c4b7e6c1',
  intake:       '4894c5e5-7139-4cfe-8bd5-2d91a6033b27',
  staff:        '5ed767f1-1442-404b-a440-25aa81c6d2b1',
}

function titleToRole(title: string | null): string {
  if (!title) return 'staff'
  const t = title.toLowerCase().trim()

  // Admin — executive + IT
  if (['ceo','cfo','clo','cmo'].includes(t)) return 'admin'
  if (t.includes('director of operations')) return 'admin'
  if (t.includes('it systems')) return 'admin'

  // Attorney
  if (t.includes('senior associate') || t.includes('associate attorney')) return 'attorney'

  // Paralegal
  if (t.includes('paralegal') || t.includes('legal assistant')) return 'paralegal'

  // Case Manager
  if (t.includes('case manager') || t.includes('senior case manager')) return 'case_manager'
  if (t.includes('case compliance') || t.includes('case summary')) return 'case_manager'
  if (t.includes('settlement coordinator')) return 'case_manager'

  // Manager (ops-level, team leads)
  if (t.includes('operations manager') || t.includes('intake manager')) return 'manager'

  // Intake
  if (t.includes('intake') || t.includes('document intake') ||
      t.includes('document coordinator') || t.includes('quality control') ||
      t.includes('demand writer')) return 'intake'

  // Support
  if (t.includes('client support') || t.includes('client services') ||
      t.includes('client success') || t.includes('service support')) return 'support'

  // Staff — everything else
  return 'staff'
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Fetch Azure users for job titles
    const azureRes = await fetch(`${BASE}/api/admin/azure-users`, {
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      cache: 'no-store',
    })
    const { users: azureUsers } = await azureRes.json()

    // Build email → title map
    const titleMap = new Map<string, string | null>()
    for (const u of azureUsers) {
      if (u.email) titleMap.set(u.email.toLowerCase(), u.title)
    }

    // Fetch all staff_users
    const { data: staffUsers, error } = await supabaseAdmin
      .schema('staff')
      .from('staff_users')
      .select('id, email, primary_role_id')
      .eq('is_deleted', false)

    if (error) throw error

    // Compute updates
    const updates: Array<{ id: string; email: string; newRole: string; roleId: string }> = []
    for (const su of staffUsers ?? []) {
      const title   = titleMap.get(su.email?.toLowerCase() ?? '') ?? null
      const newRole = titleToRole(title)
      const roleId  = ROLE_IDS[newRole]

      // Only update if role is changing or unset
      if (roleId && su.primary_role_id !== roleId) {
        updates.push({ id: su.id, email: su.email, newRole, roleId })
      }
    }

    // Batch update
    let updated = 0
    let errors  = 0
    for (const u of updates) {
      const { error: err } = await supabaseAdmin
        .schema('staff')
        .from('staff_users')
        .update({ primary_role_id: u.roleId, updated_at: new Date().toISOString() })
        .eq('id', u.id)
      if (err) { console.error(`Failed to update ${u.email}:`, err); errors++ }
      else updated++
    }

    return NextResponse.json({
      success: true,
      totalStaffUsers: (staffUsers ?? []).length,
      updated,
      unchanged: (staffUsers ?? []).length - updates.length,
      errors,
      breakdown: updates.reduce((acc, u) => {
        acc[u.newRole] = (acc[u.newRole] ?? 0) + 1
        return acc
      }, {} as Record<string, number>),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
