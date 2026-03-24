// GET /api/admin/cron/sharepoint-renew
// Renews all SharePoint Graph subscriptions expiring within 24 hours.
// Runs every 12h via Vercel cron.

import { NextRequest, NextResponse }              from 'next/server'
import { createClient }                           from '@supabase/supabase-js'
import { renewSubscription, createItemSubscription, DOCUMENTS_DRIVE_ID } from '@/lib/sharepoint'

const CRON_SECRET = process.env.CRON_SECRET!

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

  const db = getDb()

  // Find subscriptions expiring within 24h
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { data: expiring } = await db
    .from('case_sp_subscriptions')
    .select('id, case_id, subscription_id, drive_item_id, expires_at')
    .lt('expires_at', cutoff)

  const rows = expiring ?? []
  console.log(`[sharepoint-renew] ${rows.length} subscriptions expiring within 24h`)

  const results = { renewed: 0, recreated: 0, errors: 0 }

  for (const row of rows) {
    try {
      let newSub
      try {
        newSub = await renewSubscription(row.subscription_id)
        results.renewed++
      } catch {
        // Subscription gone — recreate it
        newSub = await createItemSubscription(DOCUMENTS_DRIVE_ID, row.drive_item_id)
        results.recreated++
        console.log(`[sharepoint-renew] recreated subscription for case ${row.case_id}`)
      }

      await db
        .from('case_sp_subscriptions')
        .update({
          subscription_id: newSub.id,
          expires_at:      newSub.expirationDateTime,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', row.id)
    } catch (err) {
      results.errors++
      console.error(`[sharepoint-renew] error for subscription ${row.subscription_id}:`, err)
    }
  }

  return NextResponse.json({ ok: true, checked: rows.length, ...results })
}
