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
import { syncIntakeFromHubSpot } from '@/lib/pipelines/intake'

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
  'hs_object_id','dealstage','amount','closedate','createdate','notes_last_updated','el_app_status',
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
  // Document collection fields
  'documents_needed',
  'document_collection_notes',
  'document_promise_date',
  'document_collection_status',
  'sharepoint_file_url',
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

// All HubSpot deal properties fetched for full sync (in addition to DEAL_PROPS)
export const ALL_DEAL_PROPS_EXTRA = [
  // Activity & engagement
  'notes_last_contacted','notes_next_activity_date','num_contacted_notes','num_notes',
  'hs_v2_time_in_current_stage','hs_v2_date_entered_current_stage',
  // Nurture
  'nurture__notes_','nurture__reason_',
  // Case intelligence
  'case_summary','vehicle_issues','summary_of_repairs','legal_strength__l__m__h_',
  'sol_deadline','repair_attempts','last_repair_attempt_date','total_days_out_of_service',
  'legal_issues___grounds','cause_of_action','statute',
  // Assignments
  'handling_attorney','case_manager','paralegal','case_resolution_manager',
  'assistant_case_manager','intake_associate',
  // Pre-qual form
  'most_common_problem__notes_','second_common_problem__notes_',
  'third_common_problem__notes_','fourth_common_problem__notes_',
  'most_common_problem_repair_attempts','second_common_problem_repair_attempts',
  'third_common_problem_repair_attempts','fourth_common_problem_repair_attempts',
  'most_common_problem_status','second_common_problem_status',
  'have_you_had_any_repairs_done_to_your_vehicle_',
  'how_many_repairs_have_you_had_done_to_your_vehicle_',
  'did_you_have_to_pay_for_the_repairs_',
  'do_you_still_have_the_vehicle__or_have_you_sold__returned__or_traded_it_in_',
  'have_you_or_the_dealership_contacted_the_manufacturer_of_your_vehicle_',
  'did_the_manufacturer_offer_a_solution_like_a_refund__exchange_or_additional_repair_coverage_',
  'what_were_the_exact_terms_of_the_manufacturer_offer_',
  'do_you_have_the_repair_documents__or_would_you_need_to_get_it_from_the_dealership_',
  'would_you_prefer_a_full_refund__or_keep_your_car_and_get_a_partial_refund_',
  'was_your_car_in_the_repair_shop_for_more_than_30_days_at_any_time_',
  // Legal details
  'initial_demand_amount','settlement_type','pending_total_settlement_amount',
  'attorneys_fees','estimated_damages','forecasted_attorneys_fees',
  'purchase__lease_agreement_amount','purchase__lease_agreement_taxes',
  'purchase__lease_agreement_rebate','mileage_at_the_time_of_purchase__lease',
  'facility_name_purchased__leased','co_buyer_first_name','co_buyer_last_name',
  'attorney_comments','case_preparation_questions','attorney_review_decision',
  // Stage tracking
  'hs_v2_date_entered_955864719','hs_v2_date_entered_955864720',
  'hs_v2_date_entered_955864721','hs_v2_date_entered_955864722',
  'hs_v2_date_entered_closedwon','hs_v2_date_entered_closedlost',
  // Analytics
  'hs_analytics_latest_source','lead_source_demographic',
  // HubSpot owner
  'hubspot_owner_id','hs_synced_deal_owner_name_and_email',
  // Attorney review fields
  'attorney_review_clarification_needed__notes_',
  'attorney_review_nurture_decision__notes_',
  'attorney_review__repairs_needed___instruct_pc_client_comment',
  'attorney_nurture_instructions__ai_',
  'attorney_review_decision',
  'attorney_review_clarification_provided__notes_',
  // Portal
  'easy_lemon_portal','ela_intake','el_app_status',
  // Drop/close reasons
  'closed_lost_reason','closed_won_reason','drop_reasons','drop_reason',
]

const ALL_DEAL_PROPS = [...new Set([...DEAL_PROPS, ...ALL_DEAL_PROPS_EXTRA])]

// All contact properties for full sync
const ALL_CONTACT_PROPS = [
  ...CONTACT_PROPS,
  'address','city','zip','lifecyclestage','hs_lead_status',
  'how_did_you_hear_about_us_','createdate','lastmodifieddate',
]

// Cache of all discovered deal property names (populated once per process lifetime)
let _allDealPropNames: string[] | null = null

/** Fetch ALL deal property names from HubSpot Properties API */
async function fetchAllDealPropNames(): Promise<string[]> {
  if (_allDealPropNames) return _allDealPropNames
  try {
    const res = await hsFetch('/crm/v3/properties/deals?limit=1000')
    const results = (res?.results as Array<{ name: string }>) ?? []
    _allDealPropNames = results.map(p => p.name).filter(Boolean)
    return _allDealPropNames
  } catch {
    // Fall back to hardcoded list if discovery fails
    return ALL_DEAL_PROPS
  }
}

export async function fetchHsDeal(dealId: string): Promise<Record<string, unknown> | null> {
  // Fast path: if property names already cached, use them
  // Cold path: fall back to known ALL_DEAL_PROPS list first (instant, no extra API call),
  //            then fire property discovery in the background to warm the cache.
  const allProps = _allDealPropNames ?? ALL_DEAL_PROPS

  // Warm cache in background on first call (doesn't block this request)
  if (!_allDealPropNames) {
    fetchAllDealPropNames().catch(() => {})
  }

  // HubSpot GET query strings can hit URL limits; batch into 500-prop chunks and merge
  const CHUNK = 500
  const merged: Record<string, unknown> = {}
  for (let i = 0; i < allProps.length; i += CHUNK) {
    const chunk = allProps.slice(i, i + CHUNK)
    const data = await hsFetch(`/crm/v3/objects/deals/${dealId}?properties=${chunk.join(',')}`)
    if (data?.properties) Object.assign(merged, data.properties as Record<string, unknown>)
    else if (i === 0) return data   // passthrough if unexpected shape
  }
  return { id: dealId, properties: merged }
}

export async function fetchHsContact(dealId: string): Promise<Record<string, unknown> | null> {
  try {
    const assoc = await hsFetch(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
    const first = (assoc?.results as Array<{ id: string }>)?.[0]
    if (!first) return null
    return hsFetch(`/crm/v3/objects/contacts/${first.id}?properties=${ALL_CONTACT_PROPS.join(',')}`)
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
  hubspot_deal_id:            string
  el_app_status:              string | null
  client_first_name:          string | null
  client_last_name:           string | null
  client_email:               string | null
  client_phone:               string | null
  vehicle_year:               number | null
  vehicle_make:               string | null
  vehicle_model:              string | null
  vehicle_vin:                string | null
  vehicle_mileage:            number | null
  vehicle_purchase_price:     number | null
  vehicle_purchase_date:      string | null
  vehicle_is_new:             boolean | null
  state_jurisdiction:         string | null
  case_status:                string
  case_type:                  string
  case_priority:              string
  estimated_value:            number | null
  created_at:                 string | null

  closed_at:                  string | null
  notes_last_updated:         string | null
  is_deleted:                 boolean
  updated_at:                 string
  // Full property snapshots — stored as JSONB, schema-free
  hubspot_properties:         Record<string, unknown>
  hubspot_contact_properties: Record<string, unknown> | null
  hubspot_synced_at:          string
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
    el_app_status:              dp['el_app_status'] ? String(dp['el_app_status']) : null,
    is_deleted:                 false,
    updated_at:                 new Date().toISOString(),
    // Full JSONB snapshots — schema-free, always fresh
    hubspot_properties:         dp as Record<string, unknown>,
    hubspot_contact_properties: Object.keys(cp).length > 0 ? cp as Record<string, unknown> : null,
    hubspot_synced_at:          new Date().toISOString(),
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

  // Sync intake state from HubSpot → core.case_state
  if (caseId) {
    await syncIntakeFromHubSpot(client, caseId, caseRow.el_app_status ?? null)
  }

  // Sync document collection state from HubSpot → core.document_collection_state
  if (caseId) {
    const dp = ((deal as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>
    const docsNeeded = dp['documents_needed']
      ? String(dp['documents_needed']).split(';').map(s => s.trim()).filter(Boolean)
      : []
    const promiseDateRaw = dp['document_promise_date']
    const promiseDate = promiseDateRaw
      ? String(promiseDateRaw).slice(0, 10)  // YYYY-MM-DD
      : null

    await client.schema('core')
      .from('document_collection_state')
      .upsert({
        case_id:                 caseId,
        documents_needed:        docsNeeded,
        collection_status:       dp['document_collection_status'] ? String(dp['document_collection_status']) : null,
        collection_notes:        dp['document_collection_notes']  ? String(dp['document_collection_notes'])  : null,
        promise_date:            promiseDate,
        synced_from_hubspot_at:  new Date().toISOString(),
        updated_at:              new Date().toISOString(),
      }, { onConflict: 'case_id', ignoreDuplicates: false })
      .then(({ error }) => {
        if (error) console.error('[pipeline] doc_collection_state upsert error:', error.message)
      })

    // Store sharepoint_file_url on cases if present; resolve drive item ID for webhook matching
    if (dp['sharepoint_file_url']) {
      const spUrl = String(dp['sharepoint_file_url'])
      await client.schema('core')
        .from('cases')
        .update({ sharepoint_file_url: spUrl })
        .eq('id', caseId)
        .then(({ error }) => {
          if (error) console.error('[pipeline] sharepoint_file_url update error:', error.message)
        })

      // Pre-resolve the SharePoint folder → store sharepoint_drive_item_id
      // so that Graph change notifications can match file changes to this case.
      // Fire-and-forget — don't block the webhook response.
      void (async () => {
        try {
          const { resolveCaseFolder } = await import('@/lib/pipelines/sharepoint-sync')
          await resolveCaseFolder(client as never, caseId, spUrl)
          console.log(`[pipeline] resolved sharepoint_drive_item_id for case ${caseId}`)
        } catch (err) {
          console.error('[pipeline] sharepoint folder resolve error:', err)
        }
      })()
    }
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

// ── Fast-path property patch (webhook propertyChange events) ─────────────────

/**
 * Maps HubSpot property names → Supabase column names + transform.
 * Used by the webhook fast-path to avoid full HubSpot API fetches on every
 * property change.  ALL 300+ deal properties that don't map to a dedicated
 * column still get merged into `hubspot_properties` (JSONB snapshot).
 */
export const HS_PROPERTY_TO_COLUMN: Record<string, { col: string; transform?: string } | null> = {
  // Pipeline
  dealstage:    { col: 'case_status', transform: 'stage_map' },
  amount:       { col: 'estimated_value', transform: 'parseFloat' },
  closedate:    { col: 'closed_at', transform: 'safeDate' },
  el_app_status: { col: 'el_app_status' },
  // Vehicle
  vehicle_year:  { col: 'vehicle_year',  transform: 'parseInt' },
  what_is_the_approximate_year_of_your_vehicle_: { col: 'vehicle_year',  transform: 'parseInt' },
  vehicle_make:  { col: 'vehicle_make'  },
  what_is_the_make_of_your_vehicle_: { col: 'vehicle_make' },
  vehicle_model: { col: 'vehicle_model' },
  what_is_the_model_of_your_vehicle_: { col: 'vehicle_model' },
  vin:           { col: 'vehicle_vin'   },
  what_is_the_mileage_of_your_vehicle_:  { col: 'vehicle_mileage', transform: 'parseInt' },
  mileage_at_first_repair:               { col: 'vehicle_mileage', transform: 'parseInt' },
  purchase_price:                          { col: 'vehicle_purchase_price', transform: 'parseFloat' },
  purchase__lease_agreement_amount:        { col: 'vehicle_purchase_price', transform: 'parseFloat' },
  purchase__lease_date:                    { col: 'vehicle_purchase_date', transform: 'safeDate' },
  when_did_you_purchase_or_lease_your_vehicle_: { col: 'vehicle_purchase_date', transform: 'safeDate' },
  was_it_purchased_or_leased_new_or_used_: { col: 'vehicle_is_new', transform: 'boolean_new_used' },
  did_you_purchase_or_lease_your_car_:     { col: 'vehicle_is_new', transform: 'boolean_new_used' },
  which_state_did_you_purchase_or_lease_your_vehicle_: { col: 'state_jurisdiction', transform: 'state_abbreviate' },
  notes_last_updated: { col: 'notes_last_updated', transform: 'safeDate' },
  sharepoint_file_url: { col: 'sharepoint_file_url' },
  // Properties that only update the JSONB snapshot — no dedicated column (null = JSONB only)
  documents_needed:          null,
  document_collection_notes: null,
  document_promise_date:     null,
  document_collection_status: null,
}

export interface PropertyPatch {
  propertyName:  string
  propertyValue: string | null
}

/**
 * Fast-path update for deal.propertyChange webhook events.
 *
 * Reads nothing from HubSpot.  Applies typed column updates + merges the
 * changed properties into the `hubspot_properties` JSONB snapshot.
 *
 * Returns 'not_found' when the deal isn't in Supabase yet (caller should
 * fall back to a full upsert via fetchHsDeal + upsertCase).
 */
export async function patchCaseFromWebhook(
  client:  SupabaseClient,
  dealId:  string,
  patches: PropertyPatch[],
  options: { emitEvents?: boolean; source?: string } = {}
): Promise<{ result: string; stageChanged: boolean; prevStage: string | null; newStage: string | null }> {
  const { emitEvents: shouldEmit = false, source = EVENT_SOURCES.HUBSPOT_WEBHOOK } = options
  const coreDb = client.schema('core')

  // Look up existing case (need id, current stage, current JSONB props)
  const { data: existing } = await coreDb
    .from('cases')
    .select('id, case_status, hubspot_properties')
    .eq('hubspot_deal_id', dealId)
    .maybeSingle()

  if (!existing) return { result: 'not_found', stageChanged: false, prevStage: null, newStage: null }

  const update: Record<string, unknown> = {
    hubspot_synced_at: new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }

  // Merge changed values into JSONB snapshot
  const mergedProps: Record<string, unknown> = { ...(existing.hubspot_properties as Record<string, unknown> ?? {}) }
  let stageChanged = false
  let newStage: string | null = null
  const prevStage = existing.case_status

  for (const { propertyName, propertyValue: raw } of patches) {
    const val = raw ?? ''
    mergedProps[propertyName] = val  // always keep JSONB fresh

    const mapping = HS_PROPERTY_TO_COLUMN[propertyName]
    if (mapping === undefined) continue  // not in map at all — JSONB only
    if (mapping === null)      continue  // explicitly JSONB only

    const { col, transform } = mapping

    switch (transform) {
      case 'stage_map': {
        const stage = STAGE_MAP[val] ?? null
        if (stage) {
          update[col] = stage
          newStage     = stage
          stageChanged  = stage !== prevStage
          // Clear closed_at when moving to active stage
          if (!CLOSED_STATUSES.has(stage)) update['closed_at'] = null
        }
        break
      }
      case 'safeDate':
        update[col] = safeDate(val) ?? null
        break
      case 'parseInt':
        update[col] = val ? (parseInt(String(val).replace(/,/g, '')) || null) : null
        break
      case 'parseFloat':
        update[col] = val ? (parseFloat(String(val).replace(/,/g, '')) || null) : null
        break
      case 'boolean_new_used':
        update[col] = val ? applyTransform(val, 'boolean_new_used') : null
        break
      case 'state_abbreviate':
        update[col] = val ? applyTransform(val, 'state_abbreviate') : null
        break
      default:
        update[col] = val || null
    }
  }

  // If moving to a closed stage and closedate wasn't in the batch, set closed_at = today
  if (stageChanged && newStage && CLOSED_STATUSES.has(newStage) && !('closed_at' in update)) {
    update['closed_at'] = new Date().toISOString().slice(0, 10)
  }

  update['hubspot_properties'] = mergedProps

  const { error } = await coreDb
    .from('cases')
    .update(update)
    .eq('hubspot_deal_id', dealId)

  if (error) return { result: `error: ${error.message}`, stageChanged: false, prevStage, newStage: null }

  // Emit stage change event
  if (shouldEmit && stageChanged && newStage && existing.id) {
    await emitEvent(client, {
      event_type: PLATFORM_EVENTS.CASE_STAGE_CHANGED,
      source,
      case_id:    existing.id,
      payload:    { hubspot_deal_id: dealId, from: prevStage, to: newStage },
    }).catch(() => {})
  }

  return {
    result:       stageChanged ? `stage: ${prevStage} → ${newStage}` : 'patched',
    stageChanged,
    prevStage,
    newStage,
  }
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
