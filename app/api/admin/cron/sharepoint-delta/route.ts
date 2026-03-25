// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/cron/sharepoint-delta
//
// Vercel cron (every minute) — Microsoft Graph delta query–based SharePoint sync.
//
// Unlike the full-rescan cron (/api/admin/cron/sharepoint-sync), this endpoint:
//   1. Reads the stored deltaLink from core.sync_state
//   2. Asks Graph "what changed since my last check?"
//   3. Identifies ONLY the case folders that had file changes
//   4. Syncs only those cases — zero unnecessary API calls
//   5. Stores the new deltaLink for next run
//
// First run: initializes delta tracking with `?token=latest` (no items enumerated,
// just anchors the cursor to "now"). First sync happens on the second run.
//
// Why: Microsoft Graph drive change notifications (webhooks) silently fail for
// SharePoint document libraries in many tenants. Delta polling at 1-minute intervals
// gives a reliable ≤60s latency without depending on webhook delivery.
// ─────────────────────────────────────────────────────────────────────────────

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { runDeltaSync }              from '@/lib/sharepoint-delta'

export async function GET(req: NextRequest) {
  const authHeader   = req.headers.get('authorization') ?? ''
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const isToken      = authHeader === `Bearer ${process.env.BACKFILL_IMPORT_TOKEN}`
  const isCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!isVercelCron && !isToken && !isCronSecret)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const result = await runDeltaSync(client)
    console.log('[cron/sharepoint-delta]', JSON.stringify(result))
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/sharepoint-delta] fatal:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
