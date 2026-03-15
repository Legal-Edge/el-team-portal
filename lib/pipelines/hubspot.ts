/**
 * lib/pipelines/hubspot.ts
 *
 * Canonical HubSpot → Supabase case pipeline.
 * Single source of truth for all HubSpot sync logic.
 *
 * Used by:
 *   app/api/webhooks/hubspot-team/route.ts
 *   app/api/admin/sync-hubspot-cases/route.ts
 *   app/api/admin/cron/delta-sync/route.ts
 *
 * Architecture rule: external systems feed the platform through this
 * pipeline. No HubSpot fetch/map/upsert logic outside this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { PLATFORM_EVENTS, EVENT_SOURCES, emitEvent, emitEvents } from '@/lib/events'

// ── Stage map ─────────────────────────────────────────────────────────────────
export const STAGE_MAP: Record<string, string> = {
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

export const CLOSED_STATUSES = new Set(['settled', 'dropped'])

// ── HubSpot property lists ────────────────────────────────────────────────────
export const DEAL_PROPS = [
  'hs_object_id','dealstage','amount','closedate','createdate','notes_last_updated',
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
]

export const CONTACT_PROPS = ['firstname','lastname','email','phone','mobilephone','state']

// ── State abbreviation map ────────────────────────────────────────────────────
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

// ── Data helpers ──────────────────────────────────────────────────────────────

/**
 * Parse any raw HubSpot date value into YYYY-MM-DD or null.
 * Guards against: extended ISO years (+010480...), bare integers, bad ranges.
 */
export function safeDate(raw: unknown): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s || s.startsWith('+')) return null

  // HubSpot epoch milliseconds
  if (/^\d{13}$/.test(s)) {
    try {
      const d = new Date(parseInt(s))
      const y = d.getUTCFullYear()
      if (y < 1900 || y > 2100) return null
      return d.toISOString().slice(0, 10)
    } catch { return null }
  }

  // ISO date — extract YYYY-MM-DD only, discard time+timezone to prevent offset corruption
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, ys, ms, ds] = isoMatch
    const y = +ys, m = +ms, d = +ds
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
    return `${ys}-${ms}-${ds}`
  }

  // Last-resort native parse
  try {
    const d = new Date(s)
    if (!isNaN(d.getTime())) {
      const y = d.getUTCFullYear()
      if (y < 1900 || y > 2100) return null
      return d.toISOString().slice(0, 10)
    }
  } catch { /* fall through */ }
  return null
}

export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10)                                return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1'))     return `+${digits}`
  if (digits.length > 7 && String(raw).startsWith('+'))  return `+${digits}`
  return null
}

export function applyTransform(value: unknown, transform: string): unknown {
  if (value === null || value === undefined || value === '') return null
  switch (transform) {
    case 'parseInt': {
      const s = String(value).trim().replace(/,/g, '')
      if (/k$/i.test(s)) return Math.round(parseFloat(s) * 1000) || null
      if (/m$/i.test(s)) return Math.round(parseFloat(s) * 1_000_000) || null
      return parseInt(s) || null
    }
    case 'parseFloat':
      return parseFloat(String(value).replace(/,/g, '')) || null
    case 'boolean_new_used': {
      const v = String(value).toLowerCase()
      return v.includes('new') ? true : v.includes('used') ? false : null
    }
    case 'state_abbreviate': {
      const v = String(value).trim()
      if (v.length === 2) return v.toUpperCase()
      return STATE_ABBREVIATIONS[v.toLowerCase()] ?? v.slice(0, 2).toUpperCase()
    }
    default: return value
  }
}

// ── HubSpot API fetchers ──────────────────────────────────────────────────────

function getHsToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN not set')
  return token
}

async function hsFetch(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${getHsToken()}` },
    signal:  AbortSignal.timeout(8000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

export async function fetchHsDeal(dealId: string): Promise<Record<string, unknown> | null> {
  const propsQ = DEAL_PROPS.join(',')
  return hsFetch(`/crm/v3/objects/deals/${dealId}?properties=${propsQ}`)
}

export async function fetchHsContact(dealId: string): Promise<Record<string, unknown> | null> {
  try {
    const assoc = await hsFetch(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
    const first = (assoc?.results as Array<{ id: string }>)?.[0]
    if (!first) return null
    return hsFetch(`/crm/v3/objects/contacts/${first.id}?properties=${CONTACT_PROPS.join(',')}`)
  } catch { return null }
}

export async function fetchPageOfDeals(after: string | null, limit: number): Promise<{
  deals:     Record<string, unknown>[]
  nextAfter: string | null
}> {
  const propsQ  = DEAL_PROPS.join(',')
  const afterQ  = after ? `&after=${after}` : ''
  const page    = await hsFetch(`/crm/v3/objects/deals?limit=${limit}&properties=${propsQ}${afterQ}`) ?? {}
  return {
    deals:     (page.results as Record<string, unknown>[]) ?? [],
    nextAfter: (page as { paging?: { next?: { after?: string } } }).paging?.next?.after ?? null,
  }
}

export async function fetchDeltaDeals(
  modifiedSince: string,
  after:         string | null,
  limit:         number
): Promise<{ deals: Record<string, unknown>[]; nextAfter: string | null; total: number }> {
  const body = {
    filterGroups: [{ filters: [{
      propertyName: 'hs_lastmodifieddate',
      operator:     'GTE',
      value:        String(new Date(modifiedSince).getTime()),
    }]}],
    properties: DEAL_PROPS,
    limit,
    ...(after ? { after } : {}),
    sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
  }
  const token = getHsToken()
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HubSpot search ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const page = await res.json() as {
    results?: Record<string, unknown>[]
    paging?:  { next?: { after?: string } }
    total?:   number
  }
  return {
    deals:     page.results ?? [],
    nextAfter: page.paging?.next?.after ?? null,
    total:     page.total   ?? 0,
  }
}

// ── Case row builder ──────────────────────────────────────────────────────────

export interface CaseRow {
  hubspot_deal_id:        string
  client_first_name:      string | null
  client_last_name:       string | null
  client_email:           string | null
  client_phone:           string | null
  vehicle_year:           number | null
  vehicle_make:           string | null
  vehicle_model:          string | null
  vehicle_vin:            string | null
  vehicle_mileage:        number | null
  vehicle_purchase_price: number | null
  vehicle_purchase_date:  string | null
  vehicle_is_new:         boolean | null
  state_jurisdiction:     string | null
  case_status:            string
  case_type:              string
  case_priority:          string
  estimated_value:        number | null
  created_at:             string | null
  closed_at:              string | null
  notes_last_updated:     string | null
  is_deleted:             boolean
  updated_at:             string
}

export function buildCaseRow(
  deal:    Record<string, unknown>,
  contact: Record<string, unknown> | null
): CaseRow {
  const dp = (deal.properties  ?? {}) as Record<string, unknown>
  const cp = ((contact as Record<string, unknown> | null)?.properties ?? {}) as Record<string, unknown>

  const stage     = STAGE_MAP[String(dp['dealstage'] ?? '')] ?? 'unknown'
  const isClosed  = CLOSED_STATUSES.has(stage)

  // Field resolution — HubSpot uses multiple property names for the same concept
  const vehicleYear   = dp['vehicle_year']   ?? dp['what_is_the_approximate_year_of_your_vehicle_']
  const vehicleMake   = dp['vehicle_make']   ?? dp['what_is_the_make_of_your_vehicle_']
  const vehicleModel  = dp['vehicle_model']  ?? dp['what_is_the_model_of_your_vehicle_']
  const mileage       = dp['what_is_the_mileage_of_your_vehicle_'] ?? dp['mileage_at_first_repair']
  const purchasePrice = dp['purchase_price'] ?? dp['purchase__lease_agreement_amount']
  const purchaseDate  = dp['purchase__lease_date'] ?? dp['when_did_you_purchase_or_lease_your_vehicle_']
  const isNew         = dp['was_it_purchased_or_leased_new_or_used_'] ?? dp['did_you_purchase_or_lease_your_car_']
  const stateRaw      = dp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? cp['state']

  const mileageNum = mileage ? applyTransform(mileage, 'parseInt') as number : null

  return {
    hubspot_deal_id:        String((deal as { id: string }).id),
    client_first_name:      cp['firstname'] ? String(cp['firstname']).slice(0, 100) : null,
    client_last_name:       cp['lastname']  ? String(cp['lastname']).slice(0, 100)  : null,
    client_email:           cp['email']     ? String(cp['email']).toLowerCase().slice(0, 254) : null,
    client_phone:           normalisePhone(String(cp['phone'] ?? cp['mobilephone'] ?? '')),
    vehicle_year:           vehicleYear  ? applyTransform(vehicleYear,  'parseInt')  as number : null,
    vehicle_make:           vehicleMake  ? String(vehicleMake).slice(0, 100)  : null,
    vehicle_model:          vehicleModel ? String(vehicleModel).slice(0, 100) : null,
    vehicle_vin:            dp['vin']    ? String(dp['vin']).toUpperCase().trim().slice(0, 50) : null,
    vehicle_mileage:        mileageNum !== null ? Math.min(mileageNum, 2_147_483_647) : null,
    vehicle_purchase_price: purchasePrice ? applyTransform(purchasePrice, 'parseFloat') as number : null,
    vehicle_purchase_date:  safeDate(purchaseDate),
    vehicle_is_new:         isNew ? applyTransform(isNew, 'boolean_new_used') as boolean : null,
    state_jurisdiction:     stateRaw ? applyTransform(stateRaw, 'state_abbreviate') as string : null,
    case_status:            stage,
    case_type:              'lemon_law',
    case_priority:          'normal',
    estimated_value:        dp['amount'] ? applyTransform(dp['amount'], 'parseFloat') as number : null,
    created_at:             safeDate(dp['createdate']),
    closed_at:              isClosed ? safeDate(dp['closedate']) : null,
    notes_last_updated:     safeDate(dp['notes_last_updated']),
    is_deleted:             false,
    updated_at:             new Date().toISOString(),
  }
}

// ── Upsert result ─────────────────────────────────────────────────────────────

export interface UpsertResult {
  caseId:    string | null
  isNew:     boolean
  prevStage: string | null
  error:     string | null
}

// ── upsertCase ────────────────────────────────────────────────────────────────

/**
 * Full case upsert: builds row, detects stage change, upserts case +
 * contact into Supabase, optionally emits events.
 *
 * @param client      Raw Supabase client (service role)
 * @param deal        HubSpot deal object (from API response)
 * @param contact     HubSpot contact object or null
 * @param options
 *   emitEvents  Whether to emit events (true for webhook/delta, false for full sync)
 *   source      Event source string (defaults to 'hubspot_webhook')
 */
export async function upsertCase(
  client:  SupabaseClient,
  deal:    Record<string, unknown>,
  contact: Record<string, unknown> | null,
  options: { emitEvents?: boolean; source?: string } = {}
): Promise<UpsertResult> {
  const { emitEvents: shouldEmit = false, source = EVENT_SOURCES.HUBSPOT_WEBHOOK } = options
  const coreDb  = client.schema('core')
  const caseRow = buildCaseRow(deal, contact)
  const dealId  = caseRow.hubspot_deal_id

  // Snapshot existing state for change detection
  const { data: existing } = await coreDb
    .from('cases')
    .select('id, case_status')
    .eq('hubspot_deal_id', dealId)
    .maybeSingle()

  const isNew    = !existing
  const prevStage = existing?.case_status ?? null

  // Upsert case
  const { data: upserted, error: caseErr } = await coreDb
    .from('cases')
    .upsert(caseRow, { onConflict: 'hubspot_deal_id', ignoreDuplicates: false })
    .select('id')
    .maybeSingle()

  if (caseErr) {
    return { caseId: null, isNew, prevStage, error: caseErr.message }
  }

  // Resolve case ID (upsert may not return it if row existed)
  let caseId = upserted?.id ?? existing?.id ?? null
  if (!caseId) {
    const { data: lookup } = await coreDb
      .from('cases')
      .select('id')
      .eq('hubspot_deal_id', dealId)
      .maybeSingle()
    caseId = lookup?.id ?? null
  }

  // Upsert contact
  if (caseId && contact) {
    const cp    = ((contact as Record<string, unknown>).properties ?? {}) as Record<string, unknown>
    const phone = normalisePhone(String(cp['phone'] ?? '')) ??
                  normalisePhone(String(cp['mobilephone'] ?? ''))
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

  // Emit events
  if (shouldEmit && caseId) {
    const eventsToEmit = []

    if (isNew) {
      eventsToEmit.push({
        event_type:  PLATFORM_EVENTS.CASE_CREATED,
        source,
        case_id:     caseId,
        payload:     {
          hubspot_deal_id: dealId,
          case_status:     caseRow.case_status,
          client_name:     [caseRow.client_first_name, caseRow.client_last_name].filter(Boolean).join(' ') || null,
        },
        occurred_at: caseRow.created_at ?? undefined,
      })
    } else if (prevStage && prevStage !== caseRow.case_status) {
      eventsToEmit.push({
        event_type: PLATFORM_EVENTS.CASE_STAGE_CHANGED,
        source,
        case_id:    caseId,
        payload:    {
          hubspot_deal_id: dealId,
          from:            prevStage,
          to:              caseRow.case_status,
        },
      })
    }

    if (eventsToEmit.length > 0) {
      await emitEvents(client, eventsToEmit)
    }
  }

  return { caseId, isNew, prevStage, error: null }
}

// ── deleteCase ────────────────────────────────────────────────────────────────

/**
 * Hard-delete a case by HubSpot deal ID and optionally emit a deletion event.
 */
export async function deleteCase(
  client:  SupabaseClient,
  dealId:  string,
  options: { emitEvents?: boolean; source?: string } = {}
): Promise<{ caseId: string | null; error: string | null }> {
  const { emitEvents: shouldEmit = false, source = EVENT_SOURCES.HUBSPOT_WEBHOOK } = options
  const coreDb = client.schema('core')

  // Fetch ID before delete (for event payload)
  const { data: existing } = await coreDb
    .from('cases')
    .select('id, case_status, client_first_name, client_last_name')
    .eq('hubspot_deal_id', dealId)
    .maybeSingle()

  const { error } = await coreDb
    .from('cases')
    .delete()
    .eq('hubspot_deal_id', dealId)

  if (error) return { caseId: null, error: error.message }

  if (shouldEmit && existing?.id) {
    await emitEvent(client, {
      event_type: PLATFORM_EVENTS.CASE_DELETED,
      source,
      case_id:    null,   // case row is gone; don't FK reference it
      payload:    {
        hubspot_deal_id: dealId,
        prev_status:     existing.case_status,
        client_name:     [existing.client_first_name, existing.client_last_name].filter(Boolean).join(' ') || null,
      },
    })
  }

  return { caseId: existing?.id ?? null, error: null }
}

// ── Contact upsert (standalone — used by bulk sync routes) ───────────────────

export interface ContactUpsertResult {
  ok:       boolean
  noPhone:  boolean
  noContact: boolean
  error:    string | null
}

export async function upsertContact(
  client:  SupabaseClient,
  caseId:  string,
  contact: Record<string, unknown> | null
): Promise<ContactUpsertResult> {
  if (!contact) return { ok: false, noPhone: false, noContact: true, error: null }

  const cp    = ((contact as Record<string, unknown>).properties ?? {}) as Record<string, unknown>
  const phone = normalisePhone(String(cp['phone'] ?? '')) ??
                normalisePhone(String(cp['mobilephone'] ?? ''))

  if (!phone) return { ok: false, noPhone: true, noContact: false, error: null }

  const { error } = await client.schema('core').from('case_contacts').upsert({
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

  if (error) return { ok: false, noPhone: false, noContact: false, error: error.message }
  return { ok: true, noPhone: false, noContact: false, error: null }
}
