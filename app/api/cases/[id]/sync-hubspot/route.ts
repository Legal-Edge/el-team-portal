/**
 * POST /api/cases/[id]/sync-hubspot
 * Force-sync a single deal from HubSpot — fetches all properties and updates
 * the hubspot_properties JSONB column immediately.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'
import { supabaseAdmin }             from '@/lib/supabase'
import { fetchHsDeal, fetchHsContact, buildCaseRow } from '@/lib/pipelines/hubspot'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dealId = params.id

  try {
    const [deal, contact] = await Promise.all([
      fetchHsDeal(dealId),
      fetchHsContact(dealId),
    ])

    if (!deal) return NextResponse.json({ error: 'Deal not found in HubSpot' }, { status: 404 })

    const row = buildCaseRow(deal, contact)

    const { error } = await supabaseAdmin
      .schema('core')
      .from('cases')
      .update({
        ...row,
        hubspot_synced_at: new Date().toISOString(),
      })
      .eq('hubspot_deal_id', dealId)

    if (error) {
      // Column might not exist yet — try updating just the fields we know exist
      console.error('Full sync failed, trying partial:', error.message)
      const { error: partialErr } = await supabaseAdmin
        .schema('core')
        .from('cases')
        .update({
          hubspot_properties:         row.hubspot_properties,
          hubspot_contact_properties: row.hubspot_contact_properties,
          hubspot_synced_at:          row.hubspot_synced_at,
          updated_at:                 row.updated_at,
        })
        .eq('hubspot_deal_id', dealId)

      if (partialErr) return NextResponse.json({ error: partialErr.message }, { status: 500 })
    }

    return NextResponse.json({
      success:   true,
      dealId,
      syncedAt:  row.hubspot_synced_at,
      propCount: Object.keys(row.hubspot_properties ?? {}).length,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
