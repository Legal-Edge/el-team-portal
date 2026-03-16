/**
 * GET /api/staff
 * Returns active staff users for dropdowns (assignee picker, filters).
 */
import { NextResponse } from 'next/server'
import { auth }         from '@/auth'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const staffDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('staff')

  const { data } = await staffDb
    .from('staff_users')
    .select('id, display_name, primary_role_id')
    .eq('is_deleted', false)
    .eq('status', 'active')
    .order('display_name', { ascending: true })

  return NextResponse.json({ staff: data ?? [] })
}
