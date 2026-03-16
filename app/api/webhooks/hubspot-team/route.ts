/**
 * POST /api/webhooks/hubspot-team
 *
 * HubSpot → core.cases real-time webhook handler.
 * Receives HubSpot CRM events → delegates to lib/pipelines/hubspot → emits events.
 *
 * Subscriptions (configured in HubSpot portal):
 *   deal.creation, deal.deletion, deal.propertyChange → dealstage
 *
 * Security: ?token=<BACKFILL_IMPORT_TOKEN>
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { fetchHsDeal, fetchHsContact, upsertCase, deleteCase } from '@/lib/pipelines/hubspot'
import { EVENT_SOURCES } from '@/lib/events'

const WEBHOOK_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface HubSpotEvent {
  subscriptionType: string
  objectId:         number
  propertyName?:    string
  propertyValue?:   string
}

// ── GET — HubSpot URL verification ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (token !== WEBHOOK_TOKEN) return new Response('Forbidden', { status: 403 })
  return new Response('OK', { status: 200 })
}

// ── POST — process events ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (token !== WEBHOOK_TOKEN) return new Response('Forbidden', { status: 403 })

  let events: HubSpotEvent[]
  try { events = await req.json() }
  catch { return new Response('Bad JSON', { status: 400 }) }

  if (!Array.isArray(events) || events.length === 0) return new Response('OK', { status: 200 })

  const client = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Deduplicate — HubSpot may batch multiple events for the same deal
  const deletions = new Set<string>()
  const upserts   = new Set<string>()

  for (const e of events) {
    const dealId = String(e.objectId)
    if (e.subscriptionType === 'deal.deletion') {
      deletions.add(dealId)
      upserts.delete(dealId)   // deletion always wins
    } else {
      if (!deletions.has(dealId)) upserts.add(dealId)
    }
  }

  const results: Record<string, string> = {}

  // ── Deletions ─────────────────────────────────────────────────────────────
  for (const dealId of deletions) {
    const { error } = await deleteCase(client, dealId, {
      emitEvents: true,
      source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
    })
    results[dealId] = error ? `delete_err: ${error}` : 'deleted'
    console.log(`[webhook] DELETE deal ${dealId}: ${results[dealId]}`)
  }

  // Which deal IDs came from a deal.creation event (need retry on 404)
  const creationIds = new Set<string>()
  for (const e of events) {
    if (e.subscriptionType === 'deal.creation') creationIds.add(String(e.objectId))
  }

  // ── Upserts ───────────────────────────────────────────────────────────────
  for (const dealId of upserts) {
    try {
      // HubSpot fires deal.creation webhooks before the deal is queryable via API.
      // Retry up to 3× with exponential backoff for creation events to avoid
      // false-positive 'deleted_on_404' outcomes.
      let deal = await fetchHsDeal(dealId)
      if (!deal && creationIds.has(dealId)) {
        const delays = [1500, 3000, 6000]
        for (const ms of delays) {
          await new Promise(r => setTimeout(r, ms))
          deal = await fetchHsDeal(dealId)
          if (deal) break
        }
      }

      if (!deal) {
        // Still 404 after retries — deal was deleted immediately after creation
        await deleteCase(client, dealId, {
          emitEvents: true,
          source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
        })
        results[dealId] = 'deleted_on_404'
        continue
      }

      const contact = await fetchHsContact(dealId)
      const result  = await upsertCase(client, deal, contact, {
        emitEvents: true,
        source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
      })

      if (result.error) {
        results[dealId] = `case_err: ${result.error}`
        console.error(`[webhook] upsert [${dealId}]:`, result.error)
      } else {
        results[dealId] = result.isNew ? 'created' : 'upserted'
        const stage = (deal.properties as Record<string, unknown>)?.dealstage
        console.log(`[webhook] ${results[dealId]} deal ${dealId} stage=${stage}`)
      }
    } catch (err) {
      results[dealId] = `error: ${(err as Error).message}`
      console.error(`[webhook] deal ${dealId}:`, (err as Error).message)
    }
  }

  // ── Sync log ──────────────────────────────────────────────────────────────
  const synced  = Object.values(results).filter(v => ['created','upserted','deleted','deleted_on_404'].includes(v)).length
  const errored = Object.values(results).filter(v => v.startsWith('case_err') || v.startsWith('error') || v.startsWith('delete_err')).length
  const status  = errored > 0 && synced === 0 ? 'error' : errored > 0 ? 'partial' : 'success'
  const errors  = Object.entries(results)
    .filter(([, v]) => v.startsWith('case_err') || v.startsWith('error') || v.startsWith('delete_err'))
    .map(([k, v]) => `[${k}] ${v}`)

  try {
    await client.schema('core').from('sync_log').insert({
      sync_type:     'webhook',
      completed_at:  new Date().toISOString(),
      deals_seen:    upserts.size + deletions.size,
      deals_synced:  synced,
      deals_errored: errored,
      status,
      notes:         `batch of ${events.length} events`,
      errors:        errors.slice(0, 50),
    })
  } catch (logErr) {
    console.error('[webhook] sync_log failed:', (logErr as Error).message)
  }

  return NextResponse.json({ processed: events.length, results })
}
