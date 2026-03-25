// POST /api/admin/sharepoint/subscribe-case
// Ensures the global drive subscription is active and records the case's
// drive_item_id in case_sp_subscriptions for fast webhook case lookup.
// Microsoft Graph only supports root-level drive subscriptions (not per-item).
// Token-protected.

import { NextRequest, NextResponse }                      from 'next/server'
import { createClient }                                   from '@supabase/supabase-js'
import { createDriveSubscription, renewSubscription, DOCUMENTS_DRIVE_ID } from '@/lib/sharepoint'

const TOKEN     = process.env.BACKFILL_IMPORT_TOKEN!
const STATE_KEY = 'sharepoint_subscription_id'

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

  if (!caseRow)
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (!caseRow.sharepoint_drive_item_id)
    return NextResponse.json({ error: 'Case has no sharepoint_drive_item_id — resolve folder first' }, { status: 400 })

  // ── Ensure global drive subscription exists ───────────────────────────────
  const { data: stateRow } = await db
    .from('sync_state')
    .select('value')
    .eq('key', STATE_KEY)
    .maybeSingle()

  let subscriptionId = stateRow?.value as string | null
  let subAction: 'existing' | 'renewed' | 'created' = 'existing'

  if (subscriptionId) {
    // Verify it still exists
    try {
      const { getGraphToken } = await import('@/lib/sharepoint')
      const token = await getGraphToken()
      const check = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!check.ok) {
        // Gone — create fresh
        const newSub   = await createDriveSubscription()
        subscriptionId = newSub.id
        subAction      = 'created'
        await db.from('sync_state').upsert(
          { key: STATE_KEY, value: subscriptionId, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
      }
    } catch {
      const newSub   = await createDriveSubscription()
      subscriptionId = newSub.id
      subAction      = 'created'
      await db.from('sync_state').upsert(
        { key: STATE_KEY, value: subscriptionId, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
    }
  } else {
    // No subscription yet — create one
    try {
      const newSub   = await createDriveSubscription()
      subscriptionId = newSub.id
      subAction      = 'created'
      const { error: upsertErr } = await db.from('sync_state').upsert(
        { key: STATE_KEY, value: subscriptionId, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
      if (upsertErr) console.error('[subscribe-case] sync_state upsert error:', upsertErr)
    } catch (err) {
      console.error('[subscribe-case] createDriveSubscription error:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Register case folder in case_sp_subscriptions for fast webhook lookup ─
  const { data: existingCaseSub } = await db
    .from('case_sp_subscriptions')
    .select('id')
    .eq('case_id', case_id)
    .maybeSingle()

  if (!existingCaseSub) {
    const { error: insertErr } = await db.from('case_sp_subscriptions').insert({
      case_id:         case_id,
      subscription_id: subscriptionId!,
      drive_item_id:   caseRow.sharepoint_drive_item_id,
      expires_at:      new Date(Date.now() + 4200 * 60 * 1000).toISOString(),
    })
    if (insertErr) console.error('[subscribe-case] case_sp_subscriptions insert error:', insertErr)
  }

  return NextResponse.json({
    ok:              true,
    case_id,
    drive_item_id:   caseRow.sharepoint_drive_item_id,
    subscription_id: subscriptionId,
    sub_action:      subAction,
    note:            'Root drive subscription — fires for all file changes in any case folder',
  })
}
