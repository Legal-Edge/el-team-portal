/**
 * HubSpot → core.cases real-time webhook handler
 *
 * Receives HubSpot CRM events and syncs immediately to core.cases + core.case_contacts.
 * Drives the "always matches HubSpot" guarantee.
 *
 * HubSpot sends an array of events per request (may be batched).
 * We deduplicate deal IDs and process each once per webhook call.
 *
 * Subscriptions required (set up via HubSpot portal or scripts/setup-team-webhooks.mjs):
 *   deal.creation
 *   deal.deletion
 *   deal.propertyChange → dealstage (and any other mapped properties)
 *
 * Security: ?token=<BACKFILL_IMPORT_TOKEN> query param
 *   Replace with X-HubSpot-Signature-v3 HMAC for production hardening.
 *
 * URL: https://team.easylemon.com/api/webhooks/hubspot-team?token=<BACKFILL_IMPORT_TOKEN>
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const WEBHOOK_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

// ── Stage map (identical to sync-hubspot-cases/route.ts) ──────────────────────
const STAGE_MAP: Record<string, string> = {
  '955864719':  'intake',
  '955864720':  'nurture',
  '955864721':  'document_collection',
  '955864722':  'attorney_review',
  '1177546038': 'info_needed',
  'closedwon':  'sign_up',
  'closedlost': 'retained',
  '953447548':  'settled',
  '953447549':  'dropped',
}
const CLOSED_STATUSES = new Set(['settled', 'dropped'])

const STATE_ABBREVIATIONS: Record<string, string> = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
  'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
  'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
  'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
  'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
  'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeDate(raw: unknown): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.startsWith('+')) return null
  if (/^\d{13}$/.test(s)) {
    try {
      const d = new Date(parseInt(s))
      const y = d.getUTCFullYear()
      if (y < 1900 || y > 2100) return null
      return d.toISOString().slice(0, 10)
    } catch { return null }
  }
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const y = parseInt(isoMatch[1]), m = parseInt(isoMatch[2]), d = parseInt(isoMatch[3])
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }
  try {
    const d = new Date(s)
    if (!isNaN(d.getTime())) {
      const y = d.getUTCFullYear()
      if (y < 1900 || y > 2100) return null
      return d.toISOString().slice(0, 10)
    }
  } catch { /* */ }
  return null
}

function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 7 && String(raw).startsWith('+')) return `+${digits}`
  return null
}

function applyTransform(value: unknown, transform: string): unknown {
  if (value === null || value === undefined || value === '') return null
  switch (transform) {
    case 'parseInt': {
      const s = String(value).replace(/,/g, '')
      if (/k$/i.test(s)) return Math.round(parseFloat(s) * 1000) || null
      return parseInt(s) || null
    }
    case 'parseFloat':  return parseFloat(String(value).replace(/,/g, '')) || null
    case 'state_abbreviate': {
      const v = String(value).trim()
      if (v.length === 2) return v.toUpperCase()
      return STATE_ABBREVIATIONS[v.toLowerCase()] ?? v.slice(0, 2).toUpperCase()
    }
    case 'boolean_new_used':
      return String(value).toLowerCase().includes('new') ? true : String(value).toLowerCase().includes('used') ? false : null
    default: return value
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HubSpot API helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEAL_PROPS = [
  'hs_object_id','dealstage','amount','closedate','createdate',
  'vehicle_year','vehicle_make','vehicle_model','vin',
  'what_is_the_approximate_year_of_your_vehicle_',
  'what_is_the_make_of_your_vehicle_',
  'what_is_the_model_of_your_vehicle_',
  'what_is_the_mileage_of_your_vehicle_',
  'mileage_at_first_repair',
  'purchase_price','purchase__lease_agreement_amount',
  'purchase__lease_date','when_did_you_purchase_or_lease_your_vehicle_',
  'was_it_purchased_or_leased_new_or_used_','did_you_purchase_or_lease_your_car_',
  'which_state_did_you_purchase_or_lease_your_vehicle_',
].join(',')

const CONTACT_PROPS = 'firstname,lastname,email,phone,mobilephone,state'

async function hsFetch(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    signal:  AbortSignal.timeout(8000),
  })
  if (res.status === 404) return null    // deal deleted before we fetched it — handle gracefully
  if (!res.ok) throw new Error(`HubSpot ${res.status}`)
  return res.json()
}

async function fetchDeal(dealId: string) {
  return hsFetch(`/crm/v3/objects/deals/${dealId}?properties=${DEAL_PROPS}`)
}

async function fetchContact(dealId: string) {
  try {
    const assoc = await hsFetch(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
    const first = assoc?.results?.[0]
    if (!first) return null
    return hsFetch(`/crm/v3/objects/contacts/${first.id}?properties=${CONTACT_PROPS}`)
  } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Case mapping (mirrors sync-hubspot-cases/route.ts mapToCase)
// ─────────────────────────────────────────────────────────────────────────────

function mapToCase(deal: Record<string, unknown>, contact: Record<string, unknown> | null) {
  const dp = (deal.properties ?? {}) as Record<string, unknown>
  const cp = ((contact as Record<string, unknown> | null)?.properties ?? {}) as Record<string, unknown>

  const stage  = STAGE_MAP[String(dp['dealstage'] ?? '')] ?? 'unknown'
  const isClosed = CLOSED_STATUSES.has(stage)

  const vehicleYear  = dp['vehicle_year']  ?? dp['what_is_the_approximate_year_of_your_vehicle_']
  const vehicleMake  = dp['vehicle_make']  ?? dp['what_is_the_make_of_your_vehicle_']
  const vehicleModel = dp['vehicle_model'] ?? dp['what_is_the_model_of_your_vehicle_']
  const mileage      = dp['what_is_the_mileage_of_your_vehicle_'] ?? dp['mileage_at_first_repair']
  const purchasePrice = dp['purchase_price'] ?? dp['purchase__lease_agreement_amount']
  const purchaseDate  = dp['purchase__lease_date'] ?? dp['when_did_you_purchase_or_lease_your_vehicle_']
  const isNew         = dp['was_it_purchased_or_leased_new_or_used_'] ?? dp['did_you_purchase_or_lease_your_car_']
  const stateRaw      = dp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? cp['state']

  return {
    hubspot_deal_id:       String((deal as { id: string }).id),
    client_first_name:     cp['firstname'] ?? null,
    client_last_name:      cp['lastname']  ?? null,
    client_email:          cp['email'] ? String(cp['email']).toLowerCase() : null,
    client_phone:          normalisePhone(String(cp['phone'] ?? cp['mobilephone'] ?? '')),
    vehicle_year:          vehicleYear  ? applyTransform(vehicleYear,  'parseInt')  as number : null,
    vehicle_make:          vehicleMake  ?? null,
    vehicle_model:         vehicleModel ?? null,
    vehicle_vin:           dp['vin'] ? String(dp['vin']).toUpperCase().trim() : null,
    vehicle_mileage:       mileage      ? applyTransform(mileage,       'parseInt')  as number : null,
    vehicle_purchase_price: purchasePrice ? applyTransform(purchasePrice,'parseFloat') as number : null,
    vehicle_purchase_date: safeDate(purchaseDate),
    vehicle_is_new:        isNew ? applyTransform(isNew, 'boolean_new_used') : null,
    state_jurisdiction:    stateRaw ? applyTransform(stateRaw, 'state_abbreviate') : null,
    case_status:           stage,
    case_type:             'lemon_law',
    case_priority:         'normal',
    estimated_value:       dp['amount'] ? applyTransform(dp['amount'], 'parseFloat') as number : null,
    created_at:            safeDate(dp['createdate']),
    closed_at:             isClosed ? safeDate(dp['closedate']) : null,
    is_deleted:            false,
    updated_at:            new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook event type
// ─────────────────────────────────────────────────────────────────────────────

interface HubSpotEvent {
  subscriptionType: string   // 'deal.creation' | 'deal.deletion' | 'deal.propertyChange'
  objectId:         number   // HubSpot deal ID
  propertyName?:    string
  propertyValue?:   string
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — HubSpot URL verification challenge
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (token !== WEBHOOK_TOKEN) return new Response('Forbidden', { status: 403 })
  // HubSpot sends challengeCode during verification; just return 200
  return new Response('OK', { status: 200 })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — process incoming events
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth
  const token = req.nextUrl.searchParams.get('token')
  if (token !== WEBHOOK_TOKEN) return new Response('Forbidden', { status: 403 })

  let events: HubSpotEvent[]
  try { events = await req.json() }
  catch { return new Response('Bad JSON', { status: 400 }) }

  if (!Array.isArray(events) || events.length === 0) return new Response('OK', { status: 200 })

  const db     = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb = db.schema('core')

  // Deduplicate — HubSpot may batch multiple events for the same deal
  const deletions = new Set<string>()
  const upserts   = new Set<string>()

  for (const e of events) {
    const dealId = String(e.objectId)
    if (e.subscriptionType === 'deal.deletion') {
      deletions.add(dealId)
      upserts.delete(dealId)   // deletion wins over upsert
    } else {
      if (!deletions.has(dealId)) upserts.add(dealId)
    }
  }

  const results: Record<string, string> = {}

  // ── Hard deletes ──────────────────────────────────────────────────────────
  for (const dealId of deletions) {
    const { error } = await coreDb
      .from('cases')
      .delete()
      .eq('hubspot_deal_id', dealId)

    results[dealId] = error ? `delete_err: ${error.message}` : 'deleted'
    console.log(`[webhook] DELETE deal ${dealId}: ${results[dealId]}`)
  }

  // ── Upserts ───────────────────────────────────────────────────────────────
  for (const dealId of upserts) {
    try {
      const deal = await fetchDeal(dealId)

      if (!deal) {
        // Deal 404 — may have been deleted between event and fetch
        await coreDb.from('cases').delete().eq('hubspot_deal_id', dealId)
        results[dealId] = 'deleted_on_404'
        continue
      }

      const contact = await fetchContact(dealId)
      const caseRow = mapToCase(deal, contact)

      const { data: caseData, error: caseErr } = await coreDb
        .from('cases')
        .upsert(caseRow, { onConflict: 'hubspot_deal_id', ignoreDuplicates: false })
        .select('id')
        .maybeSingle()

      if (caseErr) {
        results[dealId] = `case_err: ${caseErr.message}`
        console.error(`[webhook] case upsert [${dealId}]:`, caseErr.message)
        continue
      }

      // Upsert contact
      let caseId = caseData?.id ?? null
      if (!caseId) {
        const { data: existing } = await coreDb
          .from('cases').select('id').eq('hubspot_deal_id', dealId).maybeSingle()
        caseId = existing?.id ?? null
      }

      if (caseId && contact) {
        const cp = ((contact as Record<string, unknown>).properties ?? {}) as Record<string, unknown>
        const phone = normalisePhone(String(cp['phone'] ?? '')) ?? normalisePhone(String(cp['mobilephone'] ?? ''))
        await coreDb.from('case_contacts').upsert({
          case_id:            caseId,
          hubspot_contact_id: String((contact as { id: string }).id),
          first_name:         cp['firstname'] ?? null,
          last_name:          cp['lastname']  ?? null,
          email:              cp['email']     ?? null,
          phone,
          relationship:       'primary',
          is_primary:         true,
          is_deleted:         false,
          updated_at:         new Date().toISOString(),
        }, { onConflict: 'case_id,hubspot_contact_id', ignoreDuplicates: false })
      }

      results[dealId] = 'upserted'
      console.log(`[webhook] UPSERT deal ${dealId}: stage=${caseRow.case_status}`)

    } catch (err) {
      results[dealId] = `error: ${(err as Error).message}`
      console.error(`[webhook] deal ${dealId} error:`, (err as Error).message)
    }
  }

  // ── Log to sync_log ───────────────────────────────────────────────────────
  const synced  = Object.values(results).filter(v => v === 'upserted' || v === 'deleted' || v === 'deleted_on_404').length
  const errored = Object.values(results).filter(v => v.startsWith('case_err') || v.startsWith('error')).length
  const status  = errored > 0 && synced === 0 ? 'error' : errored > 0 ? 'partial' : 'success'
  const errors  = Object.entries(results).filter(([,v]) => v.startsWith('case_err') || v.startsWith('error')).map(([k,v]) => `[${k}] ${v}`)

  try {
    await coreDb.from('sync_log').insert({
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
    console.error('[webhook] sync_log write failed:', (logErr as Error).message)
  }

  return NextResponse.json({ processed: events.length, results })
}
