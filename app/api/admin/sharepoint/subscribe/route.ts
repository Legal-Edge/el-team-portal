// POST /api/admin/sharepoint/subscribe
// Creates or renews the Microsoft Graph webhook subscription for the Legal drive.
// Token-protected.

import { NextRequest, NextResponse }                          from 'next/server'
import { createDriveSubscription, renewSubscription, listSubscriptions } from '@/lib/sharepoint'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${TOKEN}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const existing = await listSubscriptions()
    const ours     = existing.find(s => s.clientState === 'el-team-portal')

    let sub
    if (ours) {
      sub = await renewSubscription(ours.id)
    } else {
      sub = await createDriveSubscription()
    }

    return NextResponse.json({
      ok:              true,
      action:          ours ? 'renewed' : 'created',
      subscription_id: sub.id,
      expires_at:      sub.expirationDateTime,
    })
  } catch (err) {
    console.error('[sharepoint/subscribe] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
