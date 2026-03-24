// GET /api/admin/cron/sharepoint-renew
// Renews the Microsoft Graph webhook subscription before it expires.
// Runs every 12 hours via Vercel cron. Subscriptions expire every 3 days.

import { NextRequest, NextResponse }                        from 'next/server'
import { createClient }                                     from '@supabase/supabase-js'
import { renewSubscription, createDriveSubscription, getGraphToken } from '@/lib/sharepoint'

const CRON_SECRET = process.env.CRON_SECRET!
const STATE_KEY   = 'sharepoint_subscription_id'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).schema('core')
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  if (!isVercelCron && req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = getDb()

    const { data: stateRow } = await db
      .from('sync_state')
      .select('value')
      .eq('key', STATE_KEY)
      .maybeSingle()

    const storedSubId = stateRow?.value as string | null
    let sub
    let action: 'renewed' | 'created' | 'no_op' = 'no_op'

    if (storedSubId) {
      try {
        // Check expiry before renewing
        const checkRes = await fetch(
          `https://graph.microsoft.com/v1.0/subscriptions/${storedSubId}`,
          { headers: { Authorization: `Bearer ${await getGraphToken()}` } }
        )
        if (checkRes.ok) {
          const current  = await checkRes.json()
          const hoursLeft = (new Date(current.expirationDateTime).getTime() - Date.now()) / (1000 * 60 * 60)
          if (hoursLeft < 24) {
            sub    = await renewSubscription(storedSubId)
            action = 'renewed'
          } else {
            return NextResponse.json({ ok: true, action: 'no_op', subscription_id: storedSubId, hours_remaining: Math.round(hoursLeft) })
          }
        } else {
          // Sub not found — create new
          sub    = await createDriveSubscription()
          action = 'created'
        }
      } catch {
        sub    = await createDriveSubscription()
        action = 'created'
      }
    } else {
      sub    = await createDriveSubscription()
      action = 'created'
    }

    // Persist subscription ID
    await db.from('sync_state').upsert(
      { key: STATE_KEY, value: sub.id, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )

    return NextResponse.json({ ok: true, action, subscription_id: sub.id, expires_at: sub.expirationDateTime })
  } catch (err) {
    console.error('[sharepoint-renew] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
