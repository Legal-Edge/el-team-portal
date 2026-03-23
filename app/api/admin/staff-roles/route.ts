import { NextResponse }  from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BEARER_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

// GET — return all roles + all staff_users with their current role
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [rolesRes, usersRes] = await Promise.all([
      supabaseAdmin.schema('staff').from('staff_roles')
        .select('id, role_name, role_level, description')
        .order('role_level', { ascending: false }),
      supabaseAdmin.schema('staff').from('staff_users')
        .select('id, email, primary_role_id, display_name, first_name, last_name, staff_roles!primary_role_id(role_name)')
        .eq('is_deleted', false),
    ])

    return NextResponse.json({
      roles: rolesRes.data ?? [],
      staffUsers: usersRes.data ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
