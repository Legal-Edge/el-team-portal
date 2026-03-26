/**
 * POST /api/admin/find-missing-deals
 *
 * Given a list of HubSpot deal IDs, returns which ones are NOT in Supabase
 * for the given stage. Fast — only a DB query, no HubSpot API calls.
 *
 * Body: { deal_ids: string[], stage?: string }
 * Auth: BACKFILL_IMPORT_TOKEN
 */
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const IMPORT_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '').trim() !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body     = await req.json().catch(() => ({}))
  const dealIds  = (body.deal_ids ?? []).map(String) as string[]
  const stage    = body.stage as string | undefined  // optional filter

  if (!dealIds.length) return NextResponse.json({ error: 'No deal_ids provided' }, { status: 400 })

  const coreDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Find which IDs exist in Supabase
  const baseQuery = coreDb
    .from('cases')
    .select('hubspot_deal_id, case_status')
    .in('hubspot_deal_id', dealIds)

  const { data, error } = await (stage ? baseQuery.eq('case_status', stage) : baseQuery)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const foundIds   = new Set((data ?? []).map(r => r.hubspot_deal_id))
  const missingIds = dealIds.filter(id => !foundIds.has(id))
  const wrongStage = stage
    ? (data ?? []).filter(r => r.case_status !== stage).map(r => ({ id: r.hubspot_deal_id, actual: r.case_status }))
    : []

  return NextResponse.json({
    total_checked: dealIds.length,
    found:         foundIds.size,
    missing:       missingIds.length,
    missing_ids:   missingIds,
    wrong_stage:   wrongStage,
  })
}
