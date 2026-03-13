/**
 * HubSpot → core.cases + core.case_contacts Sync (Mapping-driven)
 * Reads field mappings from integration.hubspot_case_field_mapping
 *
 * Usage:
 *   node scripts/sync-hubspot-cases.mjs --deal-id=57785602325
 *   node scripts/sync-hubspot-cases.mjs --backfill
 *
 * NOTE: This script requires SUPABASE_SERVICE_ROLE_KEY which is only
 * available on Vercel. For production backfill use:
 *   node scripts/run-sync-hubspot-cases.mjs --backfill
 * which calls the server-side /api/admin/sync-hubspot-cases endpoint.
 */

import { createClient } from '@supabase/supabase-js'

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!HUBSPOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase       = createClient(SUPABASE_URL, SUPABASE_KEY)
const coreDb         = supabase.schema('core')
const integrationDb  = supabase.schema('integration')

const STAGE_MAP = {
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

const STATE_ABBREVIATIONS = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
  'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
  'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
  'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
  'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
  'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY'
}

// ─── Load mappings from DB ─────────────────────────────────

async function loadMappings() {
  const { data, error } = await integrationDb
    .from('hubspot_case_field_mapping')
    .select('*')
    .eq('is_active', true)
  if (error) throw new Error(`Failed to load mappings: ${error.message}`)
  return data
}

// ─── HubSpot API ───────────────────────────────────────────

async function hs(path) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }
  })
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function fetchDeal(dealId, dealProps) {
  const propsQuery = dealProps.join(',')
  return hs(`/crm/v3/objects/deals/${dealId}?properties=${propsQuery}`)
}

async function fetchContact(dealId, contactProps) {
  try {
    const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
    const first = assoc?.results?.[0]
    if (!first) return null
    const propsQuery = contactProps.join(',')
    return hs(`/crm/v3/objects/contacts/${first.id}?properties=${propsQuery}`)
  } catch { return null }
}

async function fetchAllDeals(dealProps) {
  const deals = []
  let after = null
  const propsQuery = dealProps.join(',')
  while (true) {
    const url = `/crm/v3/objects/deals?limit=100&properties=${propsQuery}${after ? `&after=${after}` : ''}`
    const page = await hs(url)
    deals.push(...(page.results ?? []))
    process.stdout.write(`\r  Fetched ${deals.length} deals...`)
    if (!page.paging?.next?.after) break
    after = page.paging.next.after
    await new Promise(r => setTimeout(r, 150))
  }
  console.log()
  return deals
}

// ─── Transform engine ──────────────────────────────────────

function applyTransform(value, transform, mapping) {
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
      return STAGE_MAP[value] ?? 'unknown'
    case 'parse_date': {
      // Handle ISO dates, "July 2021", "07/2021", "2021-07", etc.
      const s = String(value).trim()
      if (!s) return null
      // Already ISO date
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
      // "Month YYYY" or "Month, YYYY"
      const monthYear = s.match(/^([A-Za-z]+)[,\s]+(\d{4})$/)
      if (monthYear) {
        const months = { january:1,february:2,march:3,april:4,may:5,june:6,
          july:7,august:8,september:9,october:10,november:11,december:12 }
        const m = months[monthYear[1].toLowerCase()]
        if (m) return `${monthYear[2]}-${String(m).padStart(2,'0')}-01`
      }
      // "MM/DD/YYYY" or "MM/YYYY"
      const slashDate = s.match(/^(\d{1,2})\/(\d{1,2}|\d{4})(?:\/(\d{4}))?$/)
      if (slashDate) {
        if (slashDate[3]) return `${slashDate[3]}-${String(slashDate[1]).padStart(2,'0')}-${String(slashDate[2]).padStart(2,'0')}`
        if (slashDate[2].length === 4) return `${slashDate[2]}-${String(slashDate[1]).padStart(2,'0')}-01`
      }
      // Try native Date parse as last resort
      const d = new Date(s)
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
      return null
    }
    case 'state_abbreviate': {
      const v = String(value).trim()
      if (v.length === 2) return v.toUpperCase()
      return STATE_ABBREVIATIONS[v.toLowerCase()] ?? v.slice(0, 2).toUpperCase()
    }
    default:
      return value
  }
}

function getValue(mapping, dealProps, contactProps) {
  // Hardcoded fallbacks (no HubSpot property)
  if (!mapping.hs_property && mapping.fallback_value !== null) {
    return mapping.fallback_value
  }

  const source = mapping.hs_object_type === 'deal' ? dealProps : contactProps
  if (!source) return mapping.fallback_value ?? null

  let value = source[mapping.hs_property] ?? null

  // Try fallback property if primary is null
  if ((value === null || value === '') && mapping.fallback_hs_property) {
    const contactFallbacks = new Set(['mobilephone', 'state'])
    const fallbackSource = contactFallbacks.has(mapping.fallback_hs_property) ? contactProps : source
    value = fallbackSource?.[mapping.fallback_hs_property] ?? null
    // Fallback deal state enum returns full name — abbreviate it
    if (value && mapping.case_column === 'state_jurisdiction' && mapping.fallback_hs_property !== 'state') {
      value = applyTransform(value, 'state_abbreviate', mapping)
    }
  }

  // Apply transform
  if (value !== null && value !== '') {
    value = applyTransform(value, mapping.transform, mapping)
  } else {
    value = null
  }

  // Static fallback
  if (value === null && mapping.fallback_value !== null) {
    value = mapping.fallback_value
  }

  return value
}

// ─── Map deal + contact to core.cases row ─────────────────

function mapToCase(deal, contact, mappings) {
  const dealP    = deal?.properties ?? {}
  const contactP = contact?.properties ?? {}
  const row = {}

  // Always set the deal ID directly
  row.hubspot_deal_id = String(deal.id)

  for (const mapping of mappings) {
    if (mapping.case_column === 'hubspot_deal_id') continue // already set

    // Special case: only set closed_at for closed deals
    if (mapping.transform === 'only_if_closed') {
      const stage = STAGE_MAP[dealP.dealstage]
      row[mapping.case_column] = CLOSED_STATUSES.has(stage) && dealP[mapping.hs_property]
        ? dealP[mapping.hs_property]
        : null
      continue
    }

    row[mapping.case_column] = getValue(mapping, dealP, contactP)
  }

  row.is_deleted = false
  row.updated_at = new Date().toISOString()

  return row
}

// ─── Phone normalisation ───────────────────────────────────
// Stores all phones in E.164 format (+1XXXXXXXXXX for US numbers).
// Returns null if the number can't be resolved — never store garbage.

function normalisePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 7 && String(raw).startsWith('+')) return `+${digits}`
  return null
}

// ─── Upsert case ───────────────────────────────────────────
// Returns { result: 'ok'|'error', caseId: uuid|null }

async function upsert(row) {
  const { data, error } = await coreDb
    .from('cases')
    .upsert(row, { onConflict: 'hubspot_deal_id', ignoreDuplicates: false })
    .select('id')
    .maybeSingle()
  if (error) {
    console.error(`  Upsert error [${row.hubspot_deal_id}]:`, error.message)
    return { result: 'error', caseId: null }
  }
  return { result: 'ok', caseId: data?.id ?? null }
}

// ─── Upsert case_contact ───────────────────────────────────
// Writes one primary contact row per case.
// Dedup key: (case_id, hubspot_contact_id).
// Returns: 'ok' | 'no_contact' | 'no_phone' | 'error'

async function upsertCaseContact(caseId, contact) {
  if (!contact || !caseId) return 'no_contact'

  const p = contact.properties ?? {}
  const phone = normalisePhone(p.phone) ?? normalisePhone(p.mobilephone)

  const row = {
    case_id:             caseId,
    hubspot_contact_id:  String(contact.id),
    first_name:          p.firstname ?? null,
    last_name:           p.lastname  ?? null,
    email:               p.email     ?? null,
    phone:               phone,           // null if unnormalisable — stored, flagged in stats
    relationship:        'primary',
    is_primary:          true,
    is_deleted:          false,
    updated_at:          new Date().toISOString(),
  }

  const { error } = await coreDb
    .from('case_contacts')
    .upsert(row, { onConflict: 'case_id,hubspot_contact_id', ignoreDuplicates: false })

  if (error) {
    console.error(`  case_contacts upsert error [case=${caseId}]:`, error.message)
    return 'error'
  }
  return phone ? 'ok' : 'no_phone'
}

// ─── Main ─────────────────────────────────────────────────

const args = process.argv.slice(2)
const dealId   = args.find(a => a.startsWith('--deal-id='))?.split('=')[1]
const backfill = args.includes('--backfill')

if (!dealId && !backfill) {
  console.error('Usage: --deal-id=<id>  or  --backfill')
  process.exit(1)
}

console.log('Loading field mappings from integration.hubspot_case_field_mapping...')
const mappings = await loadMappings()
console.log(`  ${mappings.length} active mappings loaded`)

// Collect which properties to fetch per object type
const dealPropNames    = [...new Set(mappings.filter(m => m.hs_object_type === 'deal' && m.hs_property).map(m => m.hs_property)
  .concat(mappings.filter(m => m.fallback_hs_property && m.hs_object_type === 'deal').map(m => m.fallback_hs_property)))]
const contactPropNames = [...new Set(mappings.filter(m => m.hs_object_type === 'contact' && m.hs_property).map(m => m.hs_property)
  .concat(['mobilephone', 'state']))]

if (dealId) {
  console.log(`\n▶  Syncing deal: ${dealId}`)
  console.log('─'.repeat(50))

  const [deal, contact] = await Promise.all([
    fetchDeal(dealId, dealPropNames),
    fetchContact(dealId, contactPropNames)
  ])

  const p = deal.properties ?? {}
  const c = contact?.properties ?? {}

  console.log('\nHubSpot source data:')
  console.log(`  Deal ID:        ${deal.id}`)
  console.log(`  Stage:          ${p.dealstage} → ${STAGE_MAP[p.dealstage] ?? 'unknown'}`)
  console.log(`  Client:         ${c.firstname} ${c.lastname} | ${c.email} | ${c.phone}`)
  console.log(`  Vehicle:        ${p.vehicle_year ?? p.what_is_the_approximate_year_of_your_vehicle_} ${p.vehicle_make ?? p.what_is_the_make_of_your_vehicle_} ${p.vehicle_model ?? p.what_is_the_model_of_your_vehicle_}`)
  console.log(`  VIN:            ${p.vin ?? '—'}`)
  console.log(`  Mileage:        ${p.what_is_the_mileage_of_your_vehicle_ ?? '—'}`)
  console.log(`  Purchase Price: ${p.purchase_price ?? '—'}`)
  console.log(`  Purchase Date:  ${p.purchase__lease_date ?? '—'}`)
  console.log(`  State:          ${p.which_state_did_you_purchase_or_lease_your_vehicle_ ?? c.state ?? '—'}`)

  const row = mapToCase(deal, contact, mappings)
  console.log('\nMapped row → core.cases:')
  console.log(JSON.stringify(row, null, 2))

  const { result, caseId: newCaseId } = await upsert(row)
  console.log(`\nUpsert: ${result}`)

  const { data: verify } = await coreDb
    .from('cases')
    .select('id, hubspot_deal_id, client_first_name, client_last_name, case_status, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, state_jurisdiction, created_at')
    .eq('hubspot_deal_id', dealId)
    .single()

  console.log('\n✅ Verified row in core.cases:')
  console.log(JSON.stringify(verify, null, 2))

  // Sync case_contacts
  const resolvedCaseId = newCaseId ?? verify?.id ?? null
  if (resolvedCaseId) {
    const contactResult = await upsertCaseContact(resolvedCaseId, contact)
    console.log(`\ncase_contacts upsert: ${contactResult}`)
    if (contact) {
      console.log(`  hubspot_contact_id: ${contact.id}`)
      console.log(`  phone raw:          ${contact.properties?.phone ?? contact.properties?.mobilephone ?? '—'}`)
      console.log(`  phone normalised:   ${normalisePhone(contact.properties?.phone) ?? normalisePhone(contact.properties?.mobilephone) ?? 'null'}`)
    }
  }

  const { count } = await coreDb.from('cases').select('*', { count: 'exact', head: true })
  const { count: ccCount } = await coreDb.from('case_contacts').select('*', { count: 'exact', head: true })
  console.log(`\ncore.cases total: ${count} | core.case_contacts total: ${ccCount}`)

} else {
  // Log sync start
  const { data: logEntry } = await integrationDb
    .from('hubspot_sync_log')
    .insert({ sync_type: 'cases_backfill', status: 'running' })
    .select('id')
    .single()
  const logId = logEntry?.id

  try {
    console.log('\n▶  Full backfill starting...')
    const deals = await fetchAllDeals(dealPropNames)
    console.log(`Total deals: ${deals.length}`)

    let ok = 0, err = 0
    let contactsOk = 0, contactsNoPhone = 0, contactsNoContact = 0, contactsErr = 0

    for (const deal of deals) {
      const contact = await fetchContact(deal.id, contactPropNames)
      const { result, caseId } = await upsert(mapToCase(deal, contact, mappings))
      result === 'ok' ? ok++ : err++

      // Sync case_contacts for successfully upserted cases
      if (result === 'ok' && caseId) {
        // caseId may be null if upsert matched existing row without returning id
        // Fall back: look up by hubspot_deal_id
        let resolvedCaseId = caseId
        if (!resolvedCaseId) {
          const { data: existing } = await coreDb
            .from('cases').select('id').eq('hubspot_deal_id', String(deal.id)).maybeSingle()
          resolvedCaseId = existing?.id ?? null
        }
        if (resolvedCaseId) {
          const contactResult = await upsertCaseContact(resolvedCaseId, contact)
          if      (contactResult === 'ok')         contactsOk++
          else if (contactResult === 'no_phone')   contactsNoPhone++
          else if (contactResult === 'no_contact') contactsNoContact++
          else                                     contactsErr++
        }
      }

      if ((ok + err) % 100 === 0) console.log(`  ${ok + err}/${deals.length} cases (${err} errors) | contacts: ${contactsOk} ok, ${contactsNoPhone} no_phone`)
      await new Promise(r => setTimeout(r, 50))
    }

    const { count: casesTotal }    = await coreDb.from('cases').select('*', { count: 'exact', head: true })
    const { count: contactsTotal } = await coreDb.from('case_contacts').select('*', { count: 'exact', head: true })

    if (logId) {
      await integrationDb.from('hubspot_sync_log').update({
        status: 'success', records_total: deals.length,
        records_synced: ok, records_failed: err,
        completed_at: new Date().toISOString(),
        metadata: {
          total_cases_in_db: casesTotal,
          total_contacts_in_db: contactsTotal,
          contacts_synced: contactsOk,
          contacts_no_phone: contactsNoPhone,
          contacts_no_contact: contactsNoContact,
          contacts_err: contactsErr,
        }
      }).eq('id', logId)
    }

    console.log(`\n✅ Done`)
    console.log(`   Cases synced:          ${ok} (${err} errors) | total in DB: ${casesTotal}`)
    console.log(`   Contacts synced:       ${contactsOk} with phone, ${contactsNoPhone} no phone, ${contactsNoContact} no contact, ${contactsErr} errors`)
    console.log(`   core.case_contacts:    ${contactsTotal} total`)
  } catch (e) {
    if (logId) await integrationDb.from('hubspot_sync_log')
      .update({ status: 'error', error_message: e.message, completed_at: new Date().toISOString() })
      .eq('id', logId)
    throw e
  }
}
