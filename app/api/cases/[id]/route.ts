import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Support lookup by UUID or hubspot_deal_id
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

  const { data, error } = await db
    .from('cases')
    .select('*')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .eq('is_deleted', false)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  // Fetch intake data (non-fatal if table doesn't exist yet)
  let intake = null
  try {
    const { data: intakeData } = await db
      .from('case_intake')
      .select('*')
      .eq('case_id', data.id)
      .single()
    intake = intakeData ?? null
  } catch {
    // Table may not exist yet
  }

  // Fetch intake status from case_state (non-fatal)
  let intakeStatus: string | null = null
  try {
    const { data: caseState } = await db
      .from('case_state')
      .select('intake_status')
      .eq('case_id', data.id)
      .maybeSingle()
    intakeStatus = caseState?.intake_status ?? null
  } catch {
    // case_state may be empty for this case
  }

  return NextResponse.json({
    case: data,
    intake,
    intakeStatus,
    userRole: (session.user as { role?: string }).role ?? 'staff',
  })
}
