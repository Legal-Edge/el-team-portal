/**
 * GET /api/admin/cron/qb-sync
 * Nightly QuickBooks sync — called by Vercel Cron.
 * Syncs last 7 days of transactions for all connected entities.
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncEntity }                from '@/lib/quickbooks'
import { createClient }              from '@supabase/supabase-js'

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getFinanceDb()
  const { data: entities, error } = await db
    .from('qb_entities')
    .select('id, entity_name')
    .eq('connected', true)

  if (error || !entities || entities.length === 0) {
    return NextResponse.json({ message: 'No connected entities', error })
  }

  // Sync last 7 days (overlap ensures no gaps)
  const endDate   = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const results = []
  for (const entity of entities) {
    try {
      const result = await syncEntity(entity.id, startDate, endDate)
      results.push({ entity: entity.entity_name, success: true, ...result })
      console.log(`QB cron sync complete: ${entity.entity_name} — ${result.transactionsSynced} txns`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ entity: entity.entity_name, success: false, error: msg })
      console.error(`QB cron sync failed: ${entity.entity_name}:`, msg)
    }
  }

  return NextResponse.json({ synced: results, startDate, endDate, ts: new Date().toISOString() })
}
