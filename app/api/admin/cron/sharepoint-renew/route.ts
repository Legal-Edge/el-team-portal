// GET /api/admin/cron/sharepoint-renew
// Renews the Microsoft Graph webhook subscription before it expires.
// Runs every 12 hours via Vercel cron. Subscriptions expire every 3 days.

import { NextRequest, NextResponse }                      from 'next/server'
import { listSubscriptions, renewSubscription, createDriveSubscription } from '@/lib/sharepoint'

const CRON_SECRET = process.env.CRON_SECRET!

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const existing = await listSubscriptions()
    const ours     = existing.find(s => s.clientState === 'el-team-portal')

    let sub
    if (ours) {
      // Renew if expiring within 24h
      const expiresAt = new Date(ours.expirationDateTime).getTime()
      const hoursLeft = (expiresAt - Date.now()) / (1000 * 60 * 60)

      if (hoursLeft < 24) {
        sub = await renewSubscription(ours.id)
        console.log(`[sharepoint-renew] renewed — was expiring in ${hoursLeft.toFixed(1)}h`)
      } else {
        return NextResponse.json({
          ok: true, action: 'no_op',
          subscription_id: ours.id,
          expires_at: ours.expirationDateTime,
          hours_remaining: Math.round(hoursLeft),
        })
      }
    } else {
      // No subscription found — create fresh
      sub = await createDriveSubscription()
      console.log('[sharepoint-renew] no subscription found — created new')
    }

    return NextResponse.json({
      ok:              true,
      action:          ours ? 'renewed' : 'created',
      subscription_id: sub.id,
      expires_at:      sub.expirationDateTime,
    })
  } catch (err) {
    console.error('[sharepoint-renew] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
