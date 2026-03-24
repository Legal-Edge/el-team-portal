// POST /api/admin/sharepoint/subscribe-case
// Creates a Graph subscription for a specific case's SharePoint folder.
// Used for manual subscription creation and testing before full backfill.
// Token-protected.

import { NextRequest, NextResponse }              from 'next/server'
import { createClient }                           from '@supabase/supabase-js'
import { createItemSubscription, DOCUMENTS_DRIVE_ID } from '@/lib/sharepoint'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).schema('core')
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${TOKEN}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { case_id } = await req.json() as { case_id?: string }
  if (!case_id) return NextResponse.json({ error: 'case_id required' }, { status: 400 })

  const db = getDb()

  // Load the case
  const { data: caseRow } = await db
    .from('cases')
    .select('id, sharepoint_drive_item_id, sharepoint_file_url, case_status')
    .eq('id', case_id)
    .maybeSingle()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (!caseRow.sharepoint_drive_item_id)
    return NextResponse.json({ error: 'Case has no sharepoint_drive_item_id — resolve folder first' }, { status: 400 })

  // Check if already subscribed
  const { data: existing } = await db
    .from('case_sp_subscriptions')
    .select('subscription_id, expires_at')
    .eq('case_id', case_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      ok:              true,
      action:          'already_subscribed',
      subscription_id: existing.subscription_id,
      expires_at:      existing.expires_at,
    })
  }

  // Create subscription
  const sub = await createItemSubscription(DOCUMENTS_DRIVE_ID, caseRow.sharepoint_drive_item_id)

  // Persist to case_sp_subscriptions
  const { error: insertErr } = await db.from('case_sp_subscriptions').insert({
    case_id:         case_id,
    subscription_id: sub.id,
    drive_item_id:   caseRow.sharepoint_drive_item_id,
    expires_at:      sub.expirationDateTime,
  })

  if (insertErr) {
    console.error('[subscribe-case] insert error:', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  console.log(`[subscribe-case] subscribed case ${case_id} → sub ${sub.id}`)

  return NextResponse.json({
    ok:              true,
    action:          'created',
    case_id,
    subscription_id: sub.id,
    drive_item_id:   caseRow.sharepoint_drive_item_id,
    expires_at:      sub.expirationDateTime,
  })
}
