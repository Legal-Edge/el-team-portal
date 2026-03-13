/**
 * POST /api/admin/sync-hubspot-cases
 *
 * Server-side HubSpot → core.cases + core.case_contacts sync.
 * Processes one page of HubSpot deals per call; runner script pages through
 * using the returned `next_after` cursor until `has_more = false`.
 *
 * Protected by BACKFILL_IMPORT_TOKEN (same admin token).
 *
 * Body: {
 *   after?:   string   HubSpot pagination cursor (omit for first page)
 *   limit?:   number   Deals per page (default 50, max 100)
 *   dryRun?:  boolean  If true, fetch + map but don't write (default false)
 * }
 *
 * Response: {
 *   dry_run:       boolean
 *   page_size:     number    deals fetched this page
 *   cases_synced:  number
 *   cases_errors:  number
 *   contacts_ok:       number  (phone normalised + upserted)
 *   contacts_no_phone: number  (contact exists, phone missing/invalid)
 *   contacts_no_contact: number (deal has no associated contact)
 *   contacts_errors:   number
 *   has_more:      boolean
 *   next_after:    string | null
 *   errors:        string[]
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const IMPORT_TOKEN   = process.env.BACKFILL_IMPORT_TOKEN
const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const HUBSPOT_TOKEN  = process.env.HUBSPOT_ACCESS_TOKEN!

// ── Stage map ─────────────────────────────────────────────────────────────────
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

// ── Phone normalisation ───────────────────────────────────────────────────────
function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 7 && String(raw).startsWith('+')) return `+${digits}`
  return null
}

// ── HubSpot API ───────────────────────────────────────────────────────────────
async function hs(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  })
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

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
]
const CONTACT_PROPS = ['firstname','lastname','email','phone','mobilephone','state']

async function fetchPageOfDeals(after: string | null, limit: number) {
  const propsQ = DEAL_PROPS.join(',')
  const afterQ = after ? `&after=${after}` : ''
  const page = await hs(`/crm/v3/objects/deals?limit=${limit}&properties=${propsQ}${afterQ}`)
  return {
    deals:      page.results ?? [],
    nextAfter:  page.paging?.next?.after ?? null,
  }
}

async function fetchContact(dealId: string) {
  try {
    const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
    const first = assoc?.results?.[0]
    if (!first) return null
    const propsQ = CONTACT_PROPS.join(',')
    return hs(`/crm/v3/objects/contacts/${first.id}?properties=${propsQ}`)
  } catch { return null }
}

// ── Transform helpers ─────────────────────────────────────────────────────────
function applyTransform(value: unknown, transform: string | null): unknown {
  if (value === null || value === undefined || value === '') return null
  switch (transform) {
    case 'parseInt': {
      const s = String(value).trim().replace(/,/g, '')
      if (/k$/i.test(s)) return Math.round(parseFloat(s) * 1000) || null
      if (/m$/i.test(s)) return Math.round(parseFloat(s) * 1000000) || null
      return parseInt(s) || null
    }
    case 'parseFloat':
      return parseFloat(String(value).replace(/,/g, '')) || null
    case 'lowercase':
      return String(value).toLowerCase()
    case 'uppercase':
      return String(value).toUpperCase().trim()
    case 'boolean_new_used':
      if (String(value).toLowerCase().includes('new')) return true
      if (String(value).toLowerCase().includes('used')) return false
      return null
    case 'stage_map':
      return STAGE_MAP[String(value)] ?? 'unknown'
    case 'state_abbreviate': {
      const v = String(value).trim()
      if (v.length === 2) return v.toUpperCase()
      return STATE_ABBREVIATIONS[v.toLowerCase()] ?? v.slice(0, 2).toUpperCase()
    }
    default:
      return value
  }
}

function mapToCase(deal: Record<string, unknown>, contact: Record<string, unknown> | null): Record<string, unknown> {
  const dp = (deal.properties ?? {}) as Record<string, unknown>
  const cp = ((contact as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>

  const pick = (prop: string, src: Record<string, unknown>) => src[prop] ?? null

  const vehicleYear = dp['vehicle_year'] ?? dp['what_is_the_approximate_year_of_your_vehicle_']
  const vehicleMake = dp['vehicle_make'] ?? dp['what_is_the_make_of_your_vehicle_']
  const vehicleModel = dp['vehicle_model'] ?? dp['what_is_the_model_of_your_vehicle_']
  const mileage = dp['what_is_the_mileage_of_your_vehicle_'] ?? dp['mileage_at_first_repair']
  const purchasePrice = dp['purchase_price'] ?? dp['purchase__lease_agreement_amount']
  const purchaseDate = dp['purchase__lease_date'] ?? dp['when_did_you_purchase_or_lease_your_vehicle_']
  const isNew = dp['was_it_purchased_or_leased_new_or_used_'] ?? dp['did_you_purchase_or_lease_your_car_']
  const stateRaw = dp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? cp['state']

  const stage = STAGE_MAP[String(dp['dealstage'] ?? '')] ?? 'unknown'
  const isClosed = CLOSED_STATUSES.has(stage)

  return {
    hubspot_deal_id:       String((deal as { id: string }).id),
    client_first_name:     pick('firstname', cp),
    client_last_name:      pick('lastname', cp),
    client_email:          cp['email'] ? String(cp['email']).toLowerCase() : null,
    client_phone:          normalisePhone(String(cp['phone'] ?? cp['mobilephone'] ?? '')),
    vehicle_year:          vehicleYear ? (applyTransform(vehicleYear, 'parseInt') as number) : null,
    vehicle_make:          vehicleMake ?? null,
    vehicle_model:         vehicleModel ?? null,
    vehicle_vin:           dp['vin'] ? String(dp['vin']).toUpperCase().trim() : null,
    vehicle_mileage:       mileage ? (applyTransform(mileage, 'parseInt') as number) : null,
    vehicle_purchase_price: purchasePrice ? (applyTransform(purchasePrice, 'parseFloat') as number) : null,
    vehicle_purchase_date: purchaseDate ?? null,
    vehicle_is_new:        isNew ? applyTransform(isNew, 'boolean_new_used') : null,
    state_jurisdiction:    stateRaw ? applyTransform(stateRaw, 'state_abbreviate') : null,
    case_status:           stage,
    case_type:             'lemon_law',
    case_priority:         'normal',
    estimated_value:       dp['amount'] ? (applyTransform(dp['amount'], 'parseFloat') as number) : null,
    created_at:            dp['createdate'] ?? null,
    closed_at:             isClosed && dp['closedate'] ? dp['closedate'] : null,
    is_deleted:            false,
    updated_at:            new Date().toISOString(),
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Auth
  if (!IMPORT_TOKEN) return NextResponse.json({ error: 'BACKFILL_IMPORT_TOKEN not configured' }, { status: 500 })
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (token !== IMPORT_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { after?: string; limit?: number; dryRun?: boolean }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const after   = body.after  ?? null
  const limit   = Math.min(body.limit ?? 50, 100)
  const dryRun  = body.dryRun ?? false

  const db     = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb = db.schema('core')

  const errors: string[] = []
  let casesSynced = 0, casesErrors = 0
  let contactsOk = 0, contactsNoPhone = 0, contactsNoContact = 0, contactsErrors = 0

  // Fetch one page of deals
  let deals: Record<string, unknown>[], nextAfter: string | null
  try {
    ({ deals, nextAfter } = await fetchPageOfDeals(after, limit))
  } catch (e) {
    return NextResponse.json({ error: `HubSpot fetch failed: ${(e as Error).message}` }, { status: 500 })
  }

  for (const deal of deals) {
    const dealId = String((deal as { id: string }).id)

    // Fetch associated contact
    const contact = await fetchContact(dealId)

    const caseRow = mapToCase(deal, contact)

    if (dryRun) {
      casesSynced++
      contact ? contactsOk++ : contactsNoContact++
      continue
    }

    // Upsert case
    const { data: caseData, error: caseErr } = await coreDb
      .from('cases')
      .upsert(caseRow, { onConflict: 'hubspot_deal_id', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()

    if (caseErr) {
      errors.push(`case upsert [${dealId}]: ${caseErr.message}`)
      casesErrors++
      continue
    }

    casesSynced++

    // Resolve case UUID (may be null if upsert matched without returning)
    let caseId = caseData?.id ?? null
    if (!caseId) {
      const { data: existing } = await coreDb
        .from('cases').select('id').eq('hubspot_deal_id', dealId).maybeSingle()
      caseId = existing?.id ?? null
    }

    if (!caseId) {
      errors.push(`case_id lookup failed for deal ${dealId}`)
      contactsErrors++
      continue
    }

    // Upsert case_contact
    if (!contact) {
      contactsNoContact++
      continue
    }

    const cp = ((contact as Record<string, unknown>).properties ?? {}) as Record<string, unknown>
    const phone = normalisePhone(String(cp['phone'] ?? '')) ?? normalisePhone(String(cp['mobilephone'] ?? ''))

    const contactRow = {
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
    }

    const { error: ccErr } = await coreDb
      .from('case_contacts')
      .upsert(contactRow, { onConflict: 'case_id,hubspot_contact_id', ignoreDuplicates: false })

    if (ccErr) {
      errors.push(`case_contacts upsert [case=${caseId}]: ${ccErr.message}`)
      contactsErrors++
    } else if (phone) {
      contactsOk++
    } else {
      contactsNoPhone++
    }
  }

  return NextResponse.json({
    dry_run:              dryRun,
    page_size:            deals.length,
    cases_synced:         casesSynced,
    cases_errors:         casesErrors,
    contacts_ok:          contactsOk,
    contacts_no_phone:    contactsNoPhone,
    contacts_no_contact:  contactsNoContact,
    contacts_errors:      contactsErrors,
    has_more:             nextAfter !== null,
    next_after:           nextAfter,
    errors,
  })
}
