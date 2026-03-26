/**
 * POST /api/admin/audit-stage
 *
 * Audits all Supabase cases for a given stage against HubSpot's actual current stage.
 * Identifies and optionally fixes deals that have the wrong stage in our DB.
 *
 * Body: { stage: "intake", fix: true|false }
 *   stage — the case_status value to audit (e.g. "intake")
 *   fix   — if true, updates wrong-stage rows in Supabase to match HubSpot (default: false = dry run)
 *
 * Auth: BACKFILL_IMPORT_TOKEN
 */
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { STAGE_MAP }                 from '@/lib/pipelines/hubspot'

const IMPORT_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!
const HS_TOKEN     = process.env.HUBSPOT_ACCESS_TOKEN!

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '').trim() !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body       = await req.json().catch(() => ({}))
  const stage      = String(body.stage ?? 'intake')
  const fix        = body.fix === true
  const offset     = Number(body.offset ?? 0)   // for pagination — audit 200 at a time
  const limit      = 200

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // 1. Fetch cases in this stage from Supabase (paginated)
  const { data: cases, error } = await client
    .from('cases')
    .select('id, hubspot_deal_id')
    .eq('case_status', stage)
    .range(offset, offset + limit - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const dealIds = (cases ?? []).map(c => c.hubspot_deal_id).filter(Boolean)
  if (!dealIds.length) return NextResponse.json({ total_checked: 0, wrong_stage: [], has_more: false })

  // 2. Batch-read current dealstage from HubSpot (100 per request)
  const hubspotStages: Record<string, string | null> = {}  // dealId → our internal stage
  const rawStages:     Record<string, string>        = {}  // dealId → raw HubSpot stage ID
  const deletedIds: string[] = []

  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100)
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs:     chunk.map(id => ({ id })),
        properties: ['dealstage'],
      }),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `HubSpot batch/read failed: ${res.status}` }, { status: 500 })
    }
    const data = await res.json() as {
      results?: { id: string; properties: { dealstage: string } }[]
      errors?:  { id: string }[]
    }
    for (const r of data.results ?? []) {
      const mapped = STAGE_MAP[r.properties?.dealstage ?? ''] ?? null
      hubspotStages[r.id] = mapped
      rawStages[r.id] = r.properties?.dealstage ?? ''
    }
    for (const e of data.errors ?? []) {
      deletedIds.push(e.id)
      hubspotStages[e.id] = '__deleted__'
    }
  }

  // 3. Find wrong-stage deals
  const wrongStage: { dealId: string; supabase: string; hubspot: string | null; raw_hs_stage: string }[] = []
  for (const dealId of dealIds) {
    const hsStage = hubspotStages[dealId]
    if (hsStage === stage) continue          // correct — skip
    wrongStage.push({ dealId, supabase: stage, hubspot: hsStage ?? 'unknown', raw_hs_stage: rawStages[dealId] ?? '' })
  }

  // 4. Fix if requested
  let fixed = 0
  const fixErrors: string[] = []

  if (fix && wrongStage.length > 0) {
    // Rule 1: no dealstage in HubSpot → delete from app entirely
    // Rule 2: dealstage exists but doesn't match our DB → update to correct stage
    const toDelete: string[] = []
    const byTarget = new Map<string, string[]>()

    for (const { dealId, hubspot, raw_hs_stage } of wrongStage) {
      if (hubspot === '__deleted__' || raw_hs_stage === '') {
        // No stage or deal doesn't exist in HubSpot — remove from app
        toDelete.push(dealId)
      } else if (hubspot && hubspot !== 'unknown') {
        // Valid stage — update to correct one
        if (!byTarget.has(hubspot)) byTarget.set(hubspot, [])
        byTarget.get(hubspot)!.push(dealId)
      }
      // If hubspot='unknown' but raw_hs_stage is non-empty, it's an unrecognized pipeline stage
      // — treat as deleted (not part of our pipeline)
      else if (raw_hs_stage !== '') {
        toDelete.push(dealId)
      }
    }

    // Delete in batches of 100
    for (let i = 0; i < toDelete.length; i += 100) {
      const chunk = toDelete.slice(i, i + 100)
      const { error: delErr } = await client.from('cases').delete().in('hubspot_deal_id', chunk)
      if (delErr) fixErrors.push(`delete error: ${delErr.message}`)
      else fixed += chunk.length
    }

    // Update to correct stages
    for (const [targetStage, ids] of byTarget) {
      const now = new Date().toISOString()
      const { error: updErr } = await client
        .from('cases')
        .update({
          case_status:       targetStage,
          hubspot_synced_at: now,
          updated_at:        now,
          ...(targetStage === 'settled' || targetStage === 'dropped' ? {} : { closed_at: null }),
        })
        .in('hubspot_deal_id', ids)
      if (updErr) fixErrors.push(`update to ${targetStage} error: ${updErr.message}`)
      else fixed += ids.length
    }
  }

  const hasMore = dealIds.length === limit

  return NextResponse.json({
    stage,
    offset,
    total_checked:  dealIds.length,
    correct:        dealIds.length - wrongStage.length,
    wrong_stage:    wrongStage.length,
    wrong_details:  wrongStage.slice(0, 50),   // first 50 for visibility
    deleted_in_hs:  deletedIds.length,
    fixed:          fix ? fixed : 'dry_run',
    fix_errors:     fixErrors,
    has_more:       hasMore,
    next_offset:    hasMore ? offset + limit : null,
  })
}
