/**
 * POST /api/admin/cleanup-stale-intake
 * One-time cleanup: deletes core.cases rows where case_status='intake'
 * but the deal no longer exists in HubSpot (archived/deleted deals).
 * Auth: BACKFILL_IMPORT_TOKEN
 */
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const IMPORT_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!
const HS_TOKEN     = process.env.HUBSPOT_ACCESS_TOKEN!

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '').trim() !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Get all Intake cases from Supabase
  const { data: intakeCases, error } = await client
    .from('cases')
    .select('id, hubspot_deal_id')
    .eq('case_status', 'intake')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const dealIds = (intakeCases ?? []).map((c: { hubspot_deal_id: string }) => c.hubspot_deal_id).filter(Boolean)
  if (!dealIds.length) return NextResponse.json({ deleted: 0 })

  // Batch-verify against HubSpot (100 at a time)
  const staleIds: string[] = []
  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100)
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk.map((id: string) => ({ id })), properties: ['hs_object_id'] })
    })
    const data = await res.json() as {
      results?: { id: string }[]
      errors?:  { id: string; message?: string }[]
    }
    const found = new Set((data.results ?? []).map(r => r.id))
    // errors = IDs HubSpot doesn't recognise (deleted/archived)
    for (const e of data.errors ?? []) {
      if (!found.has(e.id)) staleIds.push(e.id)
    }
  }

  if (!staleIds.length) return NextResponse.json({ deleted: 0, message: 'No stale cases found' })

  // Delete stale cases
  const { error: delErr } = await client
    .from('cases')
    .delete()
    .in('hubspot_deal_id', staleIds)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ deleted: staleIds.length, stale_deal_ids: staleIds.slice(0, 20) })
}
