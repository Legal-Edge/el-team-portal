import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin }             from '@/lib/supabase'
import { syncEngagements }           from '@/lib/hubspot/sync-engagements'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN ?? ''
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dealId = new URL(req.url).searchParams.get('deal_id')
  if (!dealId) return NextResponse.json({ error: 'deal_id param required' }, { status: 400 })

  const { data: caseRow, error: caseErr } = await supabaseAdmin
    .schema('core').from('cases')
    .select('id, hubspot_deal_id')
    .eq('hubspot_deal_id', dealId)
    .maybeSingle()

  if (caseErr || !caseRow) {
    return NextResponse.json({ error: `Case not found for deal ${dealId}` }, { status: 404 })
  }

  const t0     = Date.now()
  const result = await syncEngagements(supabaseAdmin, caseRow.id, dealId)
  const ms     = Date.now() - t0

  return NextResponse.json({
    ok:       result.errors.length === 0,
    deal_id:  dealId,
    case_id:  caseRow.id,
    upserted: result.upserted,
    skipped:  result.skipped,
    deleted:  result.deleted,
    contacts: result.contacts,
    errors:   result.errors,
    ms,
  })
}
