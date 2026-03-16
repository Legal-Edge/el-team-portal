/**
 * GET /api/admin/count-check
 * Returns exact deal counts from both HubSpot and Supabase for reconciliation.
 * Token-protected (BACKFILL_IMPORT_TOKEN).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${TOKEN}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).schema('core')

  // Supabase total + per-stage counts
  const { count: supabaseTotal, error } = await client
    .from('cases')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Supabase per-stage breakdown
  const STAGES = ['intake','nurture','document_collection','attorney_review','info_needed','sign_up','retained','settled','dropped']
  const sbStage: Record<string, number> = {}
  for (const stage of STAGES) {
    const { count } = await client
      .from('cases')
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', false)
      .eq('case_status', stage)
    sbStage[stage] = count ?? 0
  }

  // HubSpot stage IDs → portal stage names
  const HS_STAGES: Record<string, string> = {
    '955864719': 'intake', '955864720': 'nurture', '955864721': 'document_collection',
    '955864722': 'attorney_review', '1177546038': 'info_needed',
    'closedwon': 'sign_up', 'closedlost': 'retained',
    '953447548': 'settled', '953447549': 'dropped',
  }
  const hsStage: Record<string, number> = {}
  let hubspotTotal = 0
  for (const [stageId, stageName] of Object.entries(HS_STAGES)) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: stageId }] }], limit: 1 }),
    })
    const d = await res.json()
    hsStage[stageName] = d.total ?? 0
    hubspotTotal += d.total ?? 0
  }

  const diff = (supabaseTotal ?? 0) - hubspotTotal
  const stageDiffs: Record<string, number> = {}
  for (const s of STAGES) {
    const d = (sbStage[s] ?? 0) - (hsStage[s] ?? 0)
    if (d !== 0) stageDiffs[s] = d
  }

  return NextResponse.json({
    hubspot:      hubspotTotal,
    supabase:     supabaseTotal ?? 0,
    diff,
    stage_diffs:  stageDiffs,
    supabase_by_stage: sbStage,
    hubspot_by_stage:  hsStage,
    status:       diff === 0 ? 'in_sync' : diff > 0 ? `supabase_ahead_by_${diff}` : `supabase_behind_by_${Math.abs(diff)}`,
    checked_at:   new Date().toISOString(),
  })
}
