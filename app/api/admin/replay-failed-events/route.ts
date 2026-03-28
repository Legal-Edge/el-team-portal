/**
 * POST /api/admin/replay-failed-events
 *
 * Re-processes deal IDs from the failed_webhook_events table.
 * Fetches each from HubSpot and upserts to Supabase.
 * Marks replayed_at on success.
 *
 * Body: { limit?: number }  — defaults to 50 oldest unresolved events
 * Auth: BACKFILL_IMPORT_TOKEN
 */
export const maxDuration = 60

import { NextRequest, NextResponse }                        from 'next/server'
import { createClient }                                     from '@supabase/supabase-js'
import { fetchHsDeal, fetchHsContact, upsertCase }         from '@/lib/pipelines/hubspot'
import { EVENT_SOURCES }                                    from '@/lib/events'

const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '').trim() !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body  = await req.json().catch(() => ({}))
  const limit = Math.min(Number(body.limit ?? 50), 100)

  const client = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb = client.schema('core')

  // Fetch oldest unresolved failed events (deduplicated by deal_id)
  const { data: events, error: fetchErr } = await coreDb
    .from('failed_webhook_events')
    .select('id, deal_id, event_type, error_message')
    .is('replayed_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!events?.length) return NextResponse.json({ replayed: 0, message: 'No pending failed events' })

  // Deduplicate by deal_id — only replay the oldest event per deal
  const seenDeals = new Set<string>()
  const toReplay  = events.filter(e => {
    if (seenDeals.has(e.deal_id)) return false
    seenDeals.add(e.deal_id)
    return true
  })

  const results: Record<string, string> = {}
  let replayed = 0, errors = 0

  for (const event of toReplay) {
    const { id, deal_id } = event
    try {
      const deal = await fetchHsDeal(deal_id)
      if (!deal) {
        // Deal deleted in HubSpot — mark as resolved (no longer relevant)
        await coreDb.from('failed_webhook_events')
          .update({ replayed_at: new Date().toISOString(), replay_result: 'not_found_in_hubspot' })
          .eq('id', id)
        results[deal_id] = 'not_found_in_hubspot'
        replayed++
        continue
      }

      const contact = await fetchHsContact(deal_id)
      const result  = await upsertCase(client, deal, contact, {
        emitEvents: true,
        source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
      })

      const outcome = result.error ? `error: ${result.error}` : result.isNew ? 'created' : 'upserted'
      await coreDb.from('failed_webhook_events')
        .update({
          replayed_at:   new Date().toISOString(),
          replay_result: outcome,
        })
        .eq('id', id)

      results[deal_id] = outcome
      if (result.error) errors++
      else replayed++
    } catch (err) {
      const msg = (err as Error).message
      results[deal_id] = `error: ${msg}`
      errors++
    }
  }

  return NextResponse.json({
    total_pending: events.length,
    attempted:     toReplay.length,
    replayed,
    errors,
    results,
  })
}
