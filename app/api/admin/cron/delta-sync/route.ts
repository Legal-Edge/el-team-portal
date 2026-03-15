/**
 * GET /api/admin/cron/delta-sync
 *
 * Vercel Cron job — runs every 10 minutes as a safety net behind HubSpot webhooks.
 * Fetches all HubSpot deals modified since `last_delta_sync_at` (stored in core.sync_state),
 * upserts them to core.cases + core.case_contacts, then advances the cursor.
 *
 * Auth: Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}`.
 *       Also accepts BACKFILL_IMPORT_TOKEN for manual/script calls.
 *
 * Logs every run to core.sync_log for auditing and monitoring.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const CRON_SECRET   = process.env.CRON_SECRET!
const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeDate(raw: unknown): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.startsWith('+') || s.startsWith('-0')) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s)).toISOString()
  try {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  } catch { /* fall through */ }
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
const CONTACT_PROPS = 'firstname,lastname,email,phone,mobilephone,state'

async function hsFetch(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    signal:  AbortSignal.timeout(8000),
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

async function fetchDeltaPage(modifiedSince: string, after: string | null, limit = 100) {
  const body = {
    filterGroups: [{
      filters: [{
        propertyName: 'hs_lastmodifieddate',
        operator:     'GTE',
        value:        String(new Date(modifiedSince).getTime()),
      }],
    }],
    properties: DEAL_PROPS,
    limit,
    ...(after ? { after } : {}),
    sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
  }
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method:  'POST',
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HubSpot search ${res.status}: ${(await res.text()).slice(0, 100)}`)
  const page = await res.json()
  return {
    deals:     (page.results ?? []) as Record<string, unknown>[],
    nextAfter: (page.paging?.next?.after ?? null) as string | null,
    total:     (page.total ?? 0) as number,
  }
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
    vehicle_year:           vehicleYear   ? applyTransform(vehicleYear,   'parseInt')      as number : null,
    vehicle_make:           vehicleMake   ? String(vehicleMake).slice(0, 100)              : null,
    vehicle_model:          vehicleModel  ? String(vehicleModel).slice(0, 100)             : null,
    vehicle_vin:            dp['vin']     ? String(dp['vin']).toUpperCase().trim().slice(0, 50) : null,
    vehicle_mileage:        mileage       ? applyTransform(mileage,       'parseInt')      as number : null,
    vehicle_purchase_price: purchasePrice ? applyTransform(purchasePrice, 'parseFloat')    as number : null,
    vehicle_purchase_date:  safeDate(purchaseDate),
    vehicle_is_new:         isNew ? applyTransform(isNew, 'boolean_new_used')              : null,
    state_jurisdiction:     stateRaw ? applyTransform(stateRaw, 'state_abbreviate')        : null,
    case_status:            stage,
    case_type:              'lemon_law',
    case_priority:          'normal',
    estimated_value:        dp['amount'] ? applyTransform(dp['amount'], 'parseFloat')      as number : null,
    created_at:             safeDate(dp['createdate']),
    closed_at:              isClosed ? safeDate(dp['closedate']) : null,
    is_deleted:             false,
    updated_at:             new Date().toISOString(),
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Auth — accept CRON_SECRET (Vercel cron) or BACKFILL_IMPORT_TOKEN (manual)
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer     = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (bearer !== CRON_SECRET && bearer !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db     = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb = db.schema('core')
  const startedAt = new Date()

  // ── Read cursor ─────────────────────────────────────────────────────────────
  const { data: stateRow } = await coreDb
    .from('sync_state')
    .select('value')
    .eq('key', 'last_delta_sync_at')
    .maybeSingle()

  // 2-minute buffer overlap to guard against clock skew / in-flight writes
  const rawCursor    = stateRow?.value ?? new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const modifiedSince = new Date(new Date(rawCursor).getTime() - 2 * 60 * 1000).toISOString()

  // ── Create sync_log row ─────────────────────────────────────────────────────
  const { data: logRow } = await coreDb
    .from('sync_log')
    .insert({
      sync_type:      'cron_delta',
      modified_since: modifiedSince,
      status:         'running',
    })
    .select('id')
    .single()

  const logId = logRow?.id ?? null

  // ── Page through all modified deals ────────────────────────────────────────
  let after:        string | null = null
  let totalSeen     = 0
  let totalSynced   = 0
  let totalErrored  = 0
  let deltaTotal:   number | null = null
  const allErrors:  string[] = []
  let runStatus:    'success' | 'partial' | 'error' = 'success'

  try {
    do {
      const { deals, nextAfter, total } = await fetchDeltaPage(modifiedSince, after, 100)
      if (deltaTotal === null) deltaTotal = total
      after = nextAfter
      totalSeen += deals.length

      for (const deal of deals) {
        const dealId = String((deal as { id: string }).id)
        try {
          const contact  = await fetchContact(dealId)
          const caseRow  = mapToCase(deal, contact)

          const { data: caseData, error: caseErr } = await coreDb
            .from('cases')
            .upsert(caseRow, { onConflict: 'hubspot_deal_id', ignoreDuplicates: false })
            .select('id')
            .maybeSingle()

          if (caseErr) {
            allErrors.push(`[${dealId}] ${caseErr.message}`)
            totalErrored++
            continue
          }

          totalSynced++

          // Upsert contact
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
              relationship:       'primary',
              is_primary:         true,
              is_deleted:         false,
              updated_at:         new Date().toISOString(),
            }, { onConflict: 'case_id,hubspot_contact_id', ignoreDuplicates: false })
          }
        } catch (err) {
          allErrors.push(`[${dealId}] ${(err as Error).message}`)
          totalErrored++
        }
      }
    } while (after !== null)

    if (totalErrored > 0 && totalSynced === 0) runStatus = 'error'
    else if (totalErrored > 0) runStatus = 'partial'

    // ── Advance cursor on success / partial ──────────────────────────────────
    if (runStatus !== 'error') {
      await coreDb
        .from('sync_state')
        .upsert({ key: 'last_delta_sync_at', value: startedAt.toISOString(), updated_at: new Date().toISOString() })
    }

  } catch (err) {
    runStatus = 'error'
    allErrors.push(`Fatal: ${(err as Error).message}`)
    console.error('[cron/delta-sync] fatal error:', err)
  }

  // ── Finalize sync_log ───────────────────────────────────────────────────────
  if (logId) {
    await coreDb.from('sync_log').update({
      completed_at:  new Date().toISOString(),
      deals_seen:    totalSeen,
      deals_synced:  totalSynced,
      deals_errored: totalErrored,
      status:        runStatus,
      notes:         deltaTotal !== null ? `HubSpot reported ${deltaTotal} modified deals` : null,
      errors:        allErrors.slice(0, 100),  // cap stored errors
    }).eq('id', logId)
  }

  const durationMs = Date.now() - startedAt.getTime()
  console.log(`[cron/delta-sync] ${runStatus} | seen=${totalSeen} synced=${totalSynced} errors=${totalErrored} duration=${durationMs}ms`)

  return NextResponse.json({
    status:       runStatus,
    modified_since: modifiedSince,
    delta_total:  deltaTotal,
    deals_seen:   totalSeen,
    deals_synced: totalSynced,
    deals_errored: totalErrored,
    duration_ms:  durationMs,
    errors:       allErrors.slice(0, 20),
  })
}
