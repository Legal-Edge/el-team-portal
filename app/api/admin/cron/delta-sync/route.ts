/**
 * GET /api/admin/cron/delta-sync
 *
 * Vercel cron (every 10 min) — delta sync HubSpot → core.cases.
 * Processes ONE page (100 deals) per invocation to stay within timeout.
 * Cursor advances after each page — catches up automatically across runs.
 *
 * ?since=ISO_DATE  — override cursor (for backfill; still advances cursor)
 * ?page_size=N     — override page size (default 100)
 *
 * Auth: CRON_SECRET or BACKFILL_IMPORT_TOKEN (Bearer)
 */

export const maxDuration = 60   // Vercel Pro: up to 60s per invocation

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { fetchDeltaDeals, fetchHsContact, upsertCase } from '@/lib/pipelines/hubspot'
import { EVENT_SOURCES }               from '@/lib/events'

const CRON_SECRET  = process.env.CRON_SECRET
const IMPORT_TOKEN = process.env.BACKFILL_IMPORT_TOKEN
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer     = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (bearer !== CRON_SECRET && bearer !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client    = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb    = client.schema('core')
  const startedAt = new Date()

  // ── Read cursor ────────────────────────────────────────────────────────────
  // ?since=ISO_DATE overrides cursor for manual backfill (does NOT advance cursor)
  const sinceOverride = req.nextUrl.searchParams.get('since')

  const { data: stateRow } = await coreDb
    .from('sync_state')
    .select('value')
    .eq('key', 'last_delta_sync_at')
    .maybeSingle()

  // 2-minute buffer overlap to guard against clock skew
  const rawCursor     = sinceOverride ?? stateRow?.value ?? new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const modifiedSince = new Date(new Date(rawCursor).getTime() - 2 * 60 * 1000).toISOString()

  // ── Create sync_log row ────────────────────────────────────────────────────
  const { data: logRow } = await coreDb
    .from('sync_log')
    .insert({ sync_type: 'cron_delta', modified_since: modifiedSince, status: 'running' })
    .select('id')
    .single()
  const logId = logRow?.id ?? null

  // ── One page per invocation — sustainable within timeout ─────────────────
  // Reads the stored `after` cursor to continue where the last run left off.
  const pageSize    = Math.min(parseInt(req.nextUrl.searchParams.get('page_size') ?? '100'), 100)

  // Per-page pagination cursor (separate from time cursor)
  const { data: afterRow } = await coreDb
    .from('sync_state').select('value').eq('key', 'last_delta_sync_after').maybeSingle()
  const afterCursor: string | null = sinceOverride ? null : (afterRow?.value ?? null)

  let totalSeen     = 0
  let totalSynced   = 0
  let totalErrored  = 0
  let deltaTotal:   number | null = null
  const allErrors:  string[] = []
  let runStatus:    'success' | 'partial' | 'error' = 'success'
  let hasMore       = false

  try {
    const { deals, nextAfter, total } = await fetchDeltaDeals(modifiedSince, afterCursor, pageSize)
    deltaTotal = total
    hasMore    = nextAfter !== null
    totalSeen  = deals.length

    for (const deal of deals) {
      const dealId = String((deal as { id: string }).id)
      try {
        const contact = await fetchHsContact(dealId)
        const result  = await upsertCase(client, deal, contact, {
          emitEvents: true,
          source:     EVENT_SOURCES.HUBSPOT_CRON,
        })
        if (result.error) { allErrors.push(`[${dealId}] ${result.error}`); totalErrored++ }
        else                 totalSynced++
      } catch (err) {
        allErrors.push(`[${dealId}] ${(err as Error).message}`)
        totalErrored++
      }
    }

    if      (totalErrored > 0 && totalSynced === 0) runStatus = 'error'
    else if (totalErrored > 0)                       runStatus = 'partial'

    if (runStatus !== 'error') {
      if (hasMore) {
        // Save page cursor so next run continues from here
        await coreDb.from('sync_state').upsert({
          key: 'last_delta_sync_after', value: nextAfter!, updated_at: new Date().toISOString(),
        })
      } else {
        // Finished all pages — advance time cursor, clear page cursor
        await coreDb.from('sync_state').upsert([
          { key: 'last_delta_sync_at',    value: startedAt.toISOString(), updated_at: new Date().toISOString() },
          { key: 'last_delta_sync_after', value: null,                     updated_at: new Date().toISOString() },
        ])
      }
    }
  } catch (err) {
    runStatus = 'error'
    allErrors.push(`Fatal: ${(err as Error).message}`)
    console.error('[cron/delta-sync] fatal:', err)
  }

  // ── Finalize log ───────────────────────────────────────────────────────────
  if (logId) {
    await coreDb.from('sync_log').update({
      completed_at:  new Date().toISOString(),
      deals_seen:    totalSeen,
      deals_synced:  totalSynced,
      deals_errored: totalErrored,
      status:        runStatus,
      notes:         deltaTotal !== null ? `HubSpot reported ${deltaTotal} modified` : null,
      errors:        allErrors.slice(0, 100),
    }).eq('id', logId)
  }

  const durationMs = Date.now() - startedAt.getTime()
  console.log(`[cron/delta-sync] ${runStatus} seen=${totalSeen} synced=${totalSynced} errors=${totalErrored} ${durationMs}ms`)

  return NextResponse.json({
    status:         runStatus,
    modified_since: modifiedSince,
    delta_total:    deltaTotal,
    deals_seen:     totalSeen,
    deals_synced:   totalSynced,
    deals_errored:  totalErrored,
    has_more:       hasMore,
    duration_ms:    durationMs,
    errors:         allErrors.slice(0, 20),
  })
}
