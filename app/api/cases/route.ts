import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const page   = parseInt(searchParams.get('page') ?? '1')
  const limit  = 25
  const offset = (page - 1) * limit

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  let query = db
    .from('cases')
    .select('id, hubspot_deal_id, client_first_name, client_last_name, client_email, client_phone, vehicle_year, vehicle_make, vehicle_model, vehicle_mileage, vehicle_is_new, state_jurisdiction, case_status, case_priority, estimated_value, created_at, updated_at', { count: 'exact' })
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('case_status', status)

  if (search) {
    query = query.or(
      `client_first_name.ilike.%${search}%,client_last_name.ilike.%${search}%,client_email.ilike.%${search}%,vehicle_make.ilike.%${search}%,vehicle_model.ilike.%${search}%,hubspot_deal_id.eq.${search}`
    )
  }

  const { data, count, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Per-stage COUNT queries — never fetch rows, no 1000-row pagination cap
  const STAGE_KEYS = ['intake','nurture','document_collection','attorney_review','info_needed','sign_up','retained','settled','dropped']
  const stageCountResults = await Promise.all(
    STAGE_KEYS.map(s =>
      db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', s).eq('is_deleted', false)
    )
  )
  const counts: Record<string, number> = {}
  STAGE_KEYS.forEach((s, i) => { counts[s] = stageCountResults[i]?.count ?? 0 })

  return NextResponse.json({ cases: data ?? [], total: count ?? 0, stageCounts: counts, page, limit })
}
