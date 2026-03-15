import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

// Stage → group mapping
const STAGE_GROUPS: Record<string, string> = {
  intake:              'active',
  nurture:             'active',
  document_collection: 'active',
  attorney_review:     'active',
  info_needed:         'active',
  sign_up:             'retained',
  retained:            'retained',
  settled:             'settled',
  dropped:             'dropped',
}

// All stages per group
const GROUP_STAGES: Record<string, string[]> = {
  active:   ['intake','nurture','document_collection','attorney_review','info_needed'],
  retained: ['sign_up','retained'],
  settled:  ['settled'],
  dropped:  ['dropped'],
}

const STAGE_KEYS = ['intake','nurture','document_collection','attorney_review','info_needed','sign_up','retained','settled','dropped']

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status  = searchParams.get('status')   // individual stage filter
  const group   = searchParams.get('group')    // group filter: active|retained|settled|dropped
  const search  = searchParams.get('search')
  const sortCol = searchParams.get('sort')     ?? 'notes_last_updated'
  const sortDir = searchParams.get('dir')      === 'asc'
  const page    = parseInt(searchParams.get('page') ?? '1')
  const limit   = 25
  const offset  = (page - 1) * limit

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Allowed sort columns (whitelist to prevent injection)
  const SORT_COLS: Record<string, string> = {
    notes_last_updated: 'notes_last_updated',
    created_at:         'created_at',
    updated_at:         'updated_at',
    client_first_name:  'client_first_name',
    case_status:        'case_status',
    estimated_value:    'estimated_value',
    vehicle_make:       'vehicle_make',
  }
  const orderCol = SORT_COLS[sortCol] ?? 'notes_last_updated'

  let query = db
    .from('cases')
    .select(
      'id, hubspot_deal_id, client_first_name, client_last_name, client_email, client_phone, ' +
      'vehicle_year, vehicle_make, vehicle_model, vehicle_mileage, vehicle_is_new, ' +
      'state_jurisdiction, case_status, case_priority, estimated_value, ' +
      'notes_last_updated, created_at, updated_at',
      { count: 'exact' }
    )
    .eq('is_deleted', false)
    .order(orderCol, { ascending: sortDir, nullsFirst: false })
    .range(offset, offset + limit - 1)

  // Stage filter (individual stage takes priority over group)
  if (status) {
    query = query.eq('case_status', status)
  } else if (group && GROUP_STAGES[group]) {
    query = query.in('case_status', GROUP_STAGES[group])
  }

  if (search) {
    query = query.or(
      `client_first_name.ilike.%${search}%,client_last_name.ilike.%${search}%,client_email.ilike.%${search}%,vehicle_make.ilike.%${search}%,vehicle_model.ilike.%${search}%,hubspot_deal_id.eq.${search}`
    )
  }

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Per-stage COUNT queries
  const stageCountResults = await Promise.all(
    STAGE_KEYS.map(s =>
      db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', s).eq('is_deleted', false)
    )
  )
  const stageCounts: Record<string, number> = {}
  STAGE_KEYS.forEach((s, i) => { stageCounts[s] = stageCountResults[i]?.count ?? 0 })

  // Group counts
  const groupCounts: Record<string, number> = { active: 0, retained: 0, settled: 0, dropped: 0 }
  for (const [stage, cnt] of Object.entries(stageCounts)) {
    const g = STAGE_GROUPS[stage]
    if (g) groupCounts[g] = (groupCounts[g] ?? 0) + cnt
  }

  return NextResponse.json({
    cases: data ?? [],
    total: count ?? 0,
    stageCounts,
    groupCounts,
    page,
    limit,
    sort: orderCol,
    dir:  sortDir ? 'asc' : 'desc',
  })
}
