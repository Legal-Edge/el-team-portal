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

  // Supabase count
  const { count: supabaseTotal, error } = await client
    .from('cases')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // HubSpot count
  const hsRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filterGroups: [], limit: 1 }),
  })
  const hsData = await hsRes.json()
  const hubspotTotal: number = hsData.total ?? 0

  const diff = (supabaseTotal ?? 0) - hubspotTotal

  return NextResponse.json({
    hubspot:   hubspotTotal,
    supabase:  supabaseTotal ?? 0,
    diff,
    status:    diff === 0 ? 'in_sync' : diff > 0 ? `supabase_ahead_by_${diff}` : `supabase_behind_by_${Math.abs(diff)}`,
    checked_at: new Date().toISOString(),
  })
}
