/**
 * POST /api/admin/sync-missing-deals
 *
 * Finds deals that exist in HubSpot but are missing from core.cases,
 * then syncs them. Designed to close persistent count gaps.
 *
 * Strategy:
 *   1. Load all hubspot_deal_ids currently in core.cases
 *   2. Page through all HubSpot deals (id only, fast)
 *   3. Diff → missing deal IDs
 *   4. Fetch full deal + contact for each missing ID and upsert
 *
 * Protected by BACKFILL_IMPORT_TOKEN.
 *
 * Body: { dryRun?: boolean }
 * Response: { missing_count, synced, errors, deal_ids }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

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

function safeDate(raw: unknown): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.startsWith('+') || s.startsWith('-0')) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s)).toISOString()
  try { const d = new Date(s); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10) } catch { /* */ }
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
      return Math.min(parseInt(s) || 0, 2147483647) || null
    }
    case 'parseFloat': return parseFloat(String(value).replace(/,/g, '')) || null
    case 'state_abbreviate': {
      const v = String(value).trim()
      if (v.length === 2) return v.toUpperCase()
      return STATE_ABBREVIATIONS[v.toLowerCase()] ?? v.slice(0, 2).toUpperCase()
    }
    case 'boolean_new_used':
      return String(value).toLowerCase().includes('new') ? true
           : String(value).toLowerCase().includes('used') ? false : null
    default: return value
  }
}

const DEAL_PROPS = [
  'hs_object_id','dealstage','amount','closedate','createdate',
  'vehicle_year','vehicle_make','vehicle_model','vin',
  'what_is_the_approximate_year_of_your_vehicle_','what_is_the_make_of_your_vehicle_',
  'what_is_the_model_of_your_vehicle_','what_is_the_mileage_of_your_vehicle_',
  'mileage_at_first_repair','purchase_price','purchase__lease_agreement_amount',
  'purchase__lease_date','when_did_you_purchase_or_lease_your_vehicle_',
  'was_it_purchased_or_leased_new_or_used_','did_you_purchase_or_lease_your_car_',
  'which_state_did_you_purchase_or_lease_your_vehicle_',
].join(',')
const CONTACT_PROPS = 'firstname,lastname,email,phone,mobilephone,state'

async function hsFetch(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    signal:  AbortSignal.timeout(10000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 100)}`)
  return res.json()
}

async function fetchContact(dealId: string) {
  try {
    const assoc = await hsFetch(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
    const first = assoc?.results?.[0]
    if (!first) return null
    return hsFetch(`/crm/v3/objects/contacts/${first.id}?properties=${CONTACT_PROPS}`)
  } catch { return null }
}

function mapToCase(deal: Record<string, unknown>, contact: Record<string, unknown> | null) {
  const dp = (deal.properties ?? {}) as Record<string, unknown>
  const cp = ((contact as Record<string, unknown> | null)?.properties ?? {}) as Record<string, unknown>
  const stage    = STAGE_MAP[String(dp['dealstage'] ?? '')] ?? 'unknown'
  const isClosed = CLOSED_STATUSES.has(stage)
  const vehicleYear   = dp['vehicle_year']   ?? dp['what_is_the_approximate_year_of_your_vehicle_']
  const vehicleMake   = dp['vehicle_make']   ?? dp['what_is_the_make_of_your_vehicle_']
  const vehicleModel  = dp['vehicle_model']  ?? dp['what_is_the_model_of_your_vehicle_']
  const mileage       = dp['what_is_the_mileage_of_your_vehicle_'] ?? dp['mileage_at_first_repair']
  const purchasePrice = dp['purchase_price'] ?? dp['purchase__lease_agreement_amount']
  const purchaseDate  = dp['purchase__lease_date'] ?? dp['when_did_you_purchase_or_lease_your_vehicle_']
  const isNew         = dp['was_it_purchased_or_leased_new_or_used_'] ?? dp['did_you_purchase_or_lease_your_car_']
  const stateRaw      = dp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? cp['state']
  return {
    hubspot_deal_id:        String((deal as { id: string }).id),
    client_first_name:      cp['firstname'] ?? null,
    client_last_name:       cp['lastname']  ?? null,
    client_email:           cp['email'] ? String(cp['email']).toLowerCase() : null,
    client_phone:           normalisePhone(String(cp['phone'] ?? cp['mobilephone'] ?? '')),
    vehicle_year:           vehicleYear   ? applyTransform(vehicleYear,   'parseInt')   as number : null,
    vehicle_make:           vehicleMake   ? String(vehicleMake).slice(0, 100)           : null,
    vehicle_model:          vehicleModel  ? String(vehicleModel).slice(0, 100)          : null,
    vehicle_vin:            dp['vin']     ? String(dp['vin']).toUpperCase().trim().slice(0, 50) : null,
    vehicle_mileage:        mileage       ? applyTransform(mileage,       'parseInt')   as number : null,
    vehicle_purchase_price: purchasePrice ? applyTransform(purchasePrice, 'parseFloat') as number : null,
    vehicle_purchase_date:  safeDate(purchaseDate),
    vehicle_is_new:         isNew ? applyTransform(isNew, 'boolean_new_used')           : null,
    state_jurisdiction:     stateRaw ? applyTransform(stateRaw, 'state_abbreviate')     : null,
    case_status:            stage,
    case_type:              'lemon_law',
    case_priority:          'normal',
    estimated_value:        dp['amount'] ? applyTransform(dp['amount'], 'parseFloat')   as number : null,
    created_at:             safeDate(dp['createdate']),
    closed_at:              isClosed ? safeDate(dp['closedate']) : null,
    is_deleted:             false,
    updated_at:             new Date().toISOString(),
  }
}

export async function POST(req: NextRequest) {
  // Auth
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (token !== IMPORT_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { dryRun?: boolean } = {}
  try { body = await req.json() } catch { /* no body */ }
  const dryRun = body.dryRun ?? false

  const db     = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb = db.schema('core')

  // ── Step 1: load all deal IDs from Supabase (paginated) ──────────────────
  const supabaseIds = new Set<string>()
  let sbFrom = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await coreDb
      .from('cases')
      .select('hubspot_deal_id')
      .range(sbFrom, sbFrom + PAGE - 1)
    if (error) return NextResponse.json({ error: `Supabase read failed: ${error.message}` }, { status: 500 })
    if (!data || data.length === 0) break
    for (const row of data) supabaseIds.add(String(row.hubspot_deal_id))
    if (data.length < PAGE) break
    sbFrom += PAGE
  }

  // ── Step 2: page through all HubSpot deals (id + dealstage only, fast) ──
  const hubspotIds = new Set<string>()
  let after: string | null = null
  do {
    const afterQ = after ? `&after=${after}` : ''
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealstage${afterQ}`,
      { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) return NextResponse.json({ error: `HubSpot page failed: ${res.status}` }, { status: 500 })
    const page = await res.json()
    for (const deal of (page.results ?? [])) hubspotIds.add(String(deal.id))
    after = page.paging?.next?.after ?? null
  } while (after !== null)

  // ── Step 3: diff ──────────────────────────────────────────────────────────
  const missingIds = [...hubspotIds].filter(id => !supabaseIds.has(id))

  if (dryRun || missingIds.length === 0) {
    return NextResponse.json({
      dry_run:       dryRun,
      supabase_count: supabaseIds.size,
      hubspot_count:  hubspotIds.size,
      missing_count:  missingIds.length,
      missing_ids:    missingIds,
      synced:         0,
      errors:         [],
    })
  }

  // ── Step 4: sync missing deals ────────────────────────────────────────────
  let synced  = 0
  const errors: string[] = []

  for (const dealId of missingIds) {
    try {
      const deal = await hsFetch(`/crm/v3/objects/deals/${dealId}?properties=${DEAL_PROPS}`)
      if (!deal) { errors.push(`[${dealId}] 404 from HubSpot`); continue }

      const contact  = await fetchContact(dealId)
      const caseRow  = mapToCase(deal, contact)

      const { data: caseData, error: caseErr } = await coreDb
        .from('cases')
        .upsert(caseRow, { onConflict: 'hubspot_deal_id', ignoreDuplicates: false })
        .select('id')
        .maybeSingle()

      if (caseErr) { errors.push(`[${dealId}] ${caseErr.message}`); continue }
      synced++

      let caseId = caseData?.id ?? null
      if (!caseId) {
        const { data: existing } = await coreDb
          .from('cases').select('id').eq('hubspot_deal_id', dealId).maybeSingle()
        caseId = existing?.id ?? null
      }

      if (caseId && contact) {
        const cp    = ((contact as Record<string, unknown>).properties ?? {}) as Record<string, unknown>
        const phone = normalisePhone(String(cp['phone'] ?? '')) ?? normalisePhone(String(cp['mobilephone'] ?? ''))
        await coreDb.from('case_contacts').upsert({
          case_id:            caseId,
          hubspot_contact_id: String((contact as { id: string }).id),
          first_name:         cp['firstname'] ?? null,
          last_name:          cp['lastname']  ?? null,
          email:              cp['email']     ?? null,
          phone,
          relationship: 'primary', is_primary: true, is_deleted: false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'case_id,hubspot_contact_id', ignoreDuplicates: false })
      }
    } catch (err) {
      errors.push(`[${dealId}] ${(err as Error).message}`)
    }
  }

  // Log to sync_log
  try {
    await coreDb.from('sync_log').insert({
      sync_type: 'manual', completed_at: new Date().toISOString(),
      deals_seen: missingIds.length, deals_synced: synced, deals_errored: errors.length,
      status: errors.length === missingIds.length ? 'error' : errors.length > 0 ? 'partial' : 'success',
      notes: `sync-missing-deals: found ${missingIds.length} gaps, synced ${synced}`,
      errors: errors.slice(0, 100),
    })
  } catch { /* non-critical */ }

  return NextResponse.json({
    supabase_count: supabaseIds.size,
    hubspot_count:  hubspotIds.size,
    missing_count:  missingIds.length,
    synced,
    errors,
  })
}
