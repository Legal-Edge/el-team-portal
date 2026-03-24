// GET /api/admin/cron/sharepoint-sync
// Polls SharePoint for file changes on active cases every 2 minutes.
// Syncs any case whose sharepoint_synced_at is older than 90 seconds,
// capped at 30 cases per run to stay within Graph rate limits.
//
// This is the reliable fallback alongside Graph change notifications.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { syncCaseFiles }             from '@/lib/pipelines/sharepoint-sync'
import { DOCUMENTS_DRIVE_ID }        from '@/lib/sharepoint'

const CRON_SECRET = process.env.CRON_SECRET!
const STALE_SECONDS = 90  // re-sync if not synced in last 90 seconds
const MAX_CASES     = 30  // cap per run

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const isToken      = authHeader === `Bearer ${process.env.BACKFILL_IMPORT_TOKEN}`

  if (!isVercelCron && !isToken && authHeader !== `Bearer ${CRON_SECRET}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const staleThreshold = new Date(Date.now() - STALE_SECONDS * 1000).toISOString()

  // Find cases with a linked SharePoint folder that haven't been synced recently
  const { data: cases, error } = await client.schema('core')
    .from('cases')
    .select('id, sharepoint_drive_item_id')
    .eq('is_deleted', false)
    .not('sharepoint_drive_item_id', 'is', null)
    .or(`sharepoint_synced_at.is.null,sharepoint_synced_at.lt.${staleThreshold}`)
    .in('case_status', ['intake', 'nurture', 'document_collection', 'attorney_review', 'info_needed'])
    .order('sharepoint_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_CASES)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = []
  for (const c of cases ?? []) {
    try {
      const r = await syncCaseFiles(client, c.id, c.sharepoint_drive_item_id!, DOCUMENTS_DRIVE_ID)
      results.push({ caseId: c.id, inserted: r.inserted, updated: r.updated, deleted: r.skipped })
    } catch (err) {
      results.push({ caseId: c.id, error: String(err) })
    }
  }

  const synced   = results.filter(r => !('error' in r))
  const changed  = synced.filter(r => (r as {inserted:number}).inserted > 0 || (r as {updated:number}).updated > 0)

  return NextResponse.json({
    ok:      true,
    checked: results.length,
    changed: changed.length,
    results: changed.length > 0 ? changed : undefined,
  })
}
