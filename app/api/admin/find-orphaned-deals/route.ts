/**
 * GET /api/admin/find-orphaned-deals
 * Scans Supabase deals in pages and checks each batch against HubSpot batch read.
 * Identifies deals in Supabase that no longer exist in HubSpot (orphans).
 * Optionally deletes them with ?delete=true
 *
 * Token-protected (BACKFILL_IMPORT_TOKEN).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const TOKEN    = process.env.BACKFILL_IMPORT_TOKEN!
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!
const PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${TOKEN}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shouldDelete = req.nextUrl.searchParams.get('delete') === 'true'

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).schema('core')

  const orphans: string[] = []
  let offset = 0
  let totalScanned = 0

  while (true) {
    // Fetch a page of Supabase deal IDs
    const { data: rows, error } = await client
      .from('cases')
      .select('id, hubspot_deal_id')
      .eq('is_deleted', false)
      .not('hubspot_deal_id', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!rows || rows.length === 0) break

    totalScanned += rows.length

    // Batch-check all deal IDs against HubSpot
    const dealIds = rows.map(r => r.hubspot_deal_id as string)
    const hsRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${HS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs:     dealIds.map(id => ({ id })),
        properties: ['dealname'],
      }),
    })

    if (hsRes.ok) {
      const hsData = await hsRes.json()
      const foundIds = new Set(
        (hsData.results ?? []).map((r: { id: string }) => r.id)
      )
      // Any ID not found in HubSpot response is an orphan
      for (const row of rows) {
        if (!foundIds.has(row.hubspot_deal_id as string)) {
          orphans.push(row.hubspot_deal_id as string)
        }
      }
    } else if (hsRes.status === 207) {
      // 207 = partial success — some found, some not
      const hsData = await hsRes.json()
      const foundIds = new Set(
        (hsData.results ?? []).map((r: { id: string }) => r.id)
      )
      for (const row of rows) {
        if (!foundIds.has(row.hubspot_deal_id as string)) {
          orphans.push(row.hubspot_deal_id as string)
        }
      }
    }

    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE

    // Safety: cap at 50k scanned to avoid timeout
    if (totalScanned >= 50000) break
  }

  // Optionally soft-delete orphans
  const deleted: string[] = []
  if (shouldDelete && orphans.length > 0) {
    for (const dealId of orphans) {
      const { error } = await client
        .from('cases')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('hubspot_deal_id', dealId)
        .eq('is_deleted', false)
      if (!error) deleted.push(dealId)
    }
  }

  return NextResponse.json({
    total_scanned: totalScanned,
    orphans_found: orphans.length,
    orphan_deal_ids: orphans,
    deleted: deleted.length > 0 ? deleted : undefined,
    action: shouldDelete ? 'deleted' : 'dry_run',
  })
}
