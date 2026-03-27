/**
 * POST /api/webhooks/hubspot-team
 *
 * HubSpot → Supabase real-time webhook handler.
 *
 * Handles:
 *   deal.*           → upsert/delete core.cases (full property sync)
 *   note.*           → upsert core.hubspot_engagements (Aloware SMS/notes)
 *   call.*           → upsert core.hubspot_engagements
 *   email.*          → upsert core.hubspot_engagements
 *   communication.*  → upsert core.hubspot_engagements
 *   contact.*        → re-sync contact props on associated cases
 *
 * Security: ?token=<BACKFILL_IMPORT_TOKEN>
 */

export const maxDuration = 60   // extend Vercel function timeout to 60s

import { NextRequest, NextResponse }                          from 'next/server'
import { createClient }                                       from '@supabase/supabase-js'
import { fetchHsDeal, fetchHsContact, upsertCase, deleteCase, patchCaseFromWebhook } from '@/lib/pipelines/hubspot'
import { syncSingleEngagement }                               from '@/lib/hubspot/sync-single-engagement'
import { EVENT_SOURCES }                                      from '@/lib/events'

const WEBHOOK_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface HubSpotEvent {
  subscriptionType: string
  objectId:         number
  propertyName?:    string
  propertyValue?:   string
  mergedObjectIds?: number[]  // deal.merge — secondary deal IDs that were absorbed
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

  // ── Route events by type ──────────────────────────────────────────────────
  const dealDeletions        = new Set<string>()
  const dealCreations        = new Set<string>()                    // need full HubSpot fetch
  const dealPatches          = new Map<string, { name: string; value: string | null }[]>()  // fast-path
  const engagements: { objectId: string; objectType: string }[] = []
  const engagementDeletions  = new Set<string>()
  const contactIds           = new Set<string>()

  for (const e of events) {
    const id   = String(e.objectId)
    const type = e.subscriptionType ?? ''

    if (type.startsWith('deal.')) {
      if (type === 'deal.deletion') {
        dealDeletions.add(id)
        dealCreations.delete(id)
        dealPatches.delete(id)
      } else if (type === 'deal.creation') {
        // New deal — needs full HubSpot fetch to populate all columns
        if (!dealDeletions.has(id)) dealCreations.add(id)
      } else if (type === 'deal.propertyChange' && e.propertyName) {
        // Fast-path: update only the changed column(s) — no HubSpot API call needed
        if (!dealDeletions.has(id) && !dealCreations.has(id)) {
          const patches = dealPatches.get(id) ?? []
          patches.push({ name: e.propertyName, value: e.propertyValue ?? null })
          dealPatches.set(id, patches)
        }
      } else if (type === 'deal.merge') {
        // Primary deal (objectId) absorbed secondary deal(s) (mergedObjectIds)
        // → delete secondary deals from DB, full upsert primary
        if (!dealDeletions.has(id)) dealCreations.add(id)  // upsert primary
        for (const mergedId of e.mergedObjectIds ?? []) {
          const sid = String(mergedId)
          dealDeletions.add(sid)   // delete secondary
          dealCreations.delete(sid)
          dealPatches.delete(sid)
        }
      } else {
        // deal.restore or unknown deal event — treat as creation (full fetch)
        if (!dealDeletions.has(id)) dealCreations.add(id)
      }
    } else if (type.startsWith('note.')) {
      if (type === 'note.deletion') engagementDeletions.add(id)
      else engagements.push({ objectId: id, objectType: 'notes' })
    } else if (type.startsWith('call.')) {
      if (type === 'call.deletion') engagementDeletions.add(id)
      else engagements.push({ objectId: id, objectType: 'calls' })
    } else if (type.startsWith('email.')) {
      if (type === 'email.deletion') engagementDeletions.add(id)
      else engagements.push({ objectId: id, objectType: 'emails' })
    } else if (type.startsWith('communication.')) {
      if (type === 'communication.deletion') engagementDeletions.add(id)
      else engagements.push({ objectId: id, objectType: 'communications' })
    } else if (type.startsWith('contact.')) {
      contactIds.add(id)
    }
  }

  const results: Record<string, string> = {}

  // ── Deal deletions ────────────────────────────────────────────────────────
  for (const dealId of dealDeletions) {
    const { error } = await deleteCase(client, dealId, {
      emitEvents: true,
      source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
    })
    results[`deal:${dealId}`] = error ? `delete_err: ${error}` : 'deleted'
  }

  // ── Deal property patches (fast-path — no HubSpot API call) ─────────────
  // For each deal with only propertyChange events, apply targeted column updates
  // directly from the webhook payload. ~10ms per deal vs ~800ms for a full fetch.
  for (const [dealId, patches] of dealPatches) {
    try {
      const { result, stageChanged } = await patchCaseFromWebhook(
        client,
        dealId,
        patches.map(p => ({ propertyName: p.name, propertyValue: p.value })),
        { emitEvents: true, source: EVENT_SOURCES.HUBSPOT_WEBHOOK }
      )
      if (result === 'not_found') {
        // Deal exists in HubSpot but not in our DB — do a full upsert to create it
        dealCreations.add(dealId)
        results[`deal:${dealId}`] = 'not_found_queued_for_full_sync'
      } else {
        results[`deal:${dealId}`] = stageChanged ? `fast_patch:${result}` : 'fast_patch:ok'
      }
    } catch (err) {
      results[`deal:${dealId}`] = `error: ${(err as Error).message}`
    }
  }

  // ── Deal creations (full HubSpot fetch — new rows need all columns) ───────
  for (const dealId of dealCreations) {
    try {
      let deal = await fetchHsDeal(dealId)
      // New deals may not be immediately available — retry with backoff
      if (!deal) {
        for (const ms of [1500, 3000, 6000]) {
          await new Promise(r => setTimeout(r, ms))
          deal = await fetchHsDeal(dealId)
          if (deal) break
        }
      }
      if (!deal) {
        await deleteCase(client, dealId, { emitEvents: true, source: EVENT_SOURCES.HUBSPOT_WEBHOOK })
        results[`deal:${dealId}`] = 'deleted_on_404'
        continue
      }
      const resolvedId = (deal as { id?: string }).id
      if (!resolvedId || resolvedId === 'undefined') {
        results[`deal:${dealId}`] = 'error: fetchHsDeal returned no id'
        console.error(`[webhook] fetchHsDeal returned no id for deal ${dealId}`)
        continue
      }

      const contact = await fetchHsContact(dealId)
      const result  = await upsertCase(client, deal, contact, {
        emitEvents: true,
        source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
      })
      results[`deal:${dealId}`] = result.error ? `case_err: ${result.error}` : result.isNew ? 'created' : 'upserted'
    } catch (err) {
      results[`deal:${dealId}`] = `error: ${(err as Error).message}`
    }
  }

  // ── Engagement deletions ─────────────────────────────────────────────────
  for (const engId of engagementDeletions) {
    // Find case_id before deleting (needed to touch hubspot_synced_at)
    const { data: engRow } = await client
      .schema('core')
      .from('hubspot_engagements')
      .select('case_id')
      .eq('engagement_id', engId)
      .single()

    const { error } = await client
      .schema('core')
      .from('hubspot_engagements')
      .delete()
      .eq('engagement_id', engId)
    results[`del:${engId}`] = error ? `delete_err: ${error.message}` : 'deleted'
    console.log(`[webhook] DELETE engagement ${engId}: ${results[`del:${engId}`]}`)

    // Touch hubspot_synced_at → fires core.cases Realtime → browser reloads timeline
    if (!error && engRow?.case_id) {
      await client
        .schema('core')
        .from('cases')
        .update({ hubspot_synced_at: new Date().toISOString() })
        .eq('id', engRow.case_id)
    }
  }

  // ── Engagement upserts (call / note / email / communication) ─────────────
  // Deduplicate by objectId — HubSpot may fire multiple events per activity
  const seenEngIds = new Set<string>()
  for (const { objectId, objectType } of engagements) {
    if (seenEngIds.has(objectId)) continue
    seenEngIds.add(objectId)
    try {
      const r = await syncSingleEngagement(client, objectId, objectType)
      results[`${objectType}:${objectId}`] = r.error ?? r.result
    } catch (err) {
      results[`${objectType}:${objectId}`] = `error: ${(err as Error).message}`
    }
  }

  // ── Contact property changes → re-sync contact props on associated cases ──
  for (const contactId of contactIds) {
    try {
      // Find deals associated with this contact
      const hsToken = process.env.HUBSPOT_ACCESS_TOKEN!
      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/deals`,
        { headers: { Authorization: `Bearer ${hsToken}` }, signal: AbortSignal.timeout(6000) }
      )
      if (!assocRes.ok) { results[`contact:${contactId}`] = 'assoc_fetch_failed'; continue }
      const assocData = await assocRes.json() as { results?: { id: string }[] }
      const dealIds = (assocData.results ?? []).map(r => r.id)

      for (const dealId of dealIds.slice(0, 5)) {  // cap at 5 deals per contact
        if (!dealCreations.has(dealId) && !dealPatches.has(dealId)) {  // skip if deal already being synced
          const deal    = await fetchHsDeal(dealId)
          const contact = await fetchHsContact(dealId)
          if (deal) {
            await upsertCase(client, deal, contact, { emitEvents: false, source: EVENT_SOURCES.HUBSPOT_WEBHOOK })
            results[`contact:${contactId}:deal:${dealId}`] = 'contact_synced'
          }
        }
      }
    } catch (err) {
      results[`contact:${contactId}`] = `error: ${(err as Error).message}`
    }
  }

  // ── Sync log ──────────────────────────────────────────────────────────────
  const synced  = Object.values(results).filter(v => ['created','upserted','deleted','deleted_on_404','contact_synced','ok'].includes(v)).length
  const errored = Object.values(results).filter(v => v.includes('err') || v.startsWith('error')).length

  try {
    await client.schema('core').from('sync_log').insert({
      sync_type:     'webhook',
      completed_at:  new Date().toISOString(),
      deals_seen:    dealCreations.size + dealPatches.size + dealDeletions.size,
      deals_synced:  synced,
      deals_errored: errored,
      status:        errored > 0 && synced === 0 ? 'error' : errored > 0 ? 'partial' : 'success',
      notes:         `batch of ${events.length} events (${dealCreations.size} creations, ${dealPatches.size} patches, ${dealDeletions.size} deletions, ${seenEngIds.size} engagements, ${contactIds.size} contacts)`,
      errors:        Object.entries(results).filter(([,v]) => v.includes('err') || v.startsWith('error')).map(([k,v]) => `[${k}] ${v}`).slice(0, 50),
    })
  } catch { /* log failure is non-fatal */ }

  return NextResponse.json({ processed: events.length, results })
}
