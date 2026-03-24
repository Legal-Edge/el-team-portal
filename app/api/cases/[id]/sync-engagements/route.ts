/**
 * POST /api/cases/[id]/sync-engagements
 *
 * On-demand sync of all HubSpot engagements (deal + all associated contacts)
 * into core.hubspot_engagements for a single case.
 *
 * Called automatically when the Timeline tab opens (if last sync > 5 min ago)
 * and can be triggered manually via the refresh button.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'
import { supabaseAdmin }             from '@/lib/supabase'
import { syncEngagements }           from '@/lib/hubspot/sync-engagements'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: dealId } = await params

  // Resolve case UUID
  const { data: caseRow, error: caseErr } = await supabaseAdmin
    .schema('core')
    .from('cases')
    .select('id, hubspot_deal_id')
    .eq('hubspot_deal_id', dealId)
    .maybeSingle()

  if (caseErr || !caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const result = await syncEngagements(supabaseAdmin, caseRow.id, dealId)

  return NextResponse.json({
    ok:       result.errors.length === 0,
    upserted: result.upserted,
    skipped:  result.skipped,
    deleted:  result.deleted,
    contacts: result.contacts,
    errors:   result.errors,
  })
}
