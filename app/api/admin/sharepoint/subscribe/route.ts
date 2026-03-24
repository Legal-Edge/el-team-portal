// POST /api/admin/sharepoint/subscribe
// Creates or renews the Microsoft Graph webhook subscription for the Legal drive.
// Stores subscription ID in sync_state so renewal works without listSubscriptions().
// Token-protected.

import { NextRequest, NextResponse }              from 'next/server'
import { createClient }                           from '@supabase/supabase-js'
import { createDriveSubscription, renewSubscription } from '@/lib/sharepoint'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!
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

  try {
    const db = getDb()

    // Look up stored subscription ID
    const { data: stateRow } = await db
      .from('sync_state')
      .select('value')
      .eq('key', STATE_KEY)
      .maybeSingle()

    const storedSubId = stateRow?.value as string | null
    let sub
    let action: 'renewed' | 'created' = 'created'

    if (storedSubId) {
      try {
        sub    = await renewSubscription(storedSubId)
        action = 'renewed'
      } catch {
        // Subscription expired or deleted — create fresh
        sub    = await createDriveSubscription()
        action = 'created'
      }
    } else {
      sub = await createDriveSubscription()
    }

    // Store/update the subscription ID for future renewals
    await db.from('sync_state').upsert(
      { key: STATE_KEY, value: sub.id, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )

    return NextResponse.json({
      ok:              true,
      action,
      subscription_id: sub.id,
      expires_at:      sub.expirationDateTime,
    })
  } catch (err) {
    console.error('[sharepoint/subscribe] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
