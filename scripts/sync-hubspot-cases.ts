/**
 * HubSpot → core.cases Sync Script
 * 
 * Usage:
 *   Single deal:  npx ts-node scripts/sync-hubspot-cases.ts --deal-id=57404229253
 *   Full backfill: npx ts-node scripts/sync-hubspot-cases.ts --backfill
 * 
 * Requires env vars:
 *   HUBSPOT_ACCESS_TOKEN
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

// ─── Config ────────────────────────────────────────────────────────────────

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!HUBSPOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: HUBSPOT_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const coreDb = createClient(SUPABASE_URL, SUPABASE_KEY).schema('core')

// ─── Stage Mapping (Internal Team Labels) ──────────────────────────────────

const STAGE_MAP: Record<string, string> = {
  '955864719':  'intake',              // Intake
  '955864720':  'nurture',             // Nurture
  '955864721':  'document_collection', // Document Collection
  '955864722':  'attorney_review',     // Attorney Review
  '1177546038': 'info_needed',         // Info Needed
  'closedwon':  'sign_up',             // Sign Up
  'closedlost': 'retained',            // Retained
  '953447548':  'settled',             // Settled
  '953447549':  'dropped',             // Dropped
}

// HubSpot deal properties to fetch
const DEAL_PROPERTIES = [
  'dealname',
  'dealstage',
  'pipeline',
  'createdate',
  'closedate',
  'amount',
  'el_app_status',
  'what_is_the_approximate_year_of_your_vehicle_',
  'what_is_the_make_of_your_vehicle_',
  'what_is_the_model_of_your_vehicle_',
  'what_is_the_vin_of_the_vehicle_',
  'what_is_the_current_mileage_of_your_vehicle_',
  'what_is_the_purchase_price_of_the_vehicle_',
  'what_is_the_purchase_date_of_the_vehicle_',
  'what_is_your_state_',
  'is_the_vehicle_new_or_used_',
]

const CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'phone',
]

// ─── HubSpot API Helpers ───────────────────────────────────────────────────

async function hubspotGet(path: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}` }
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`HubSpot API error ${res.status}: ${err}`)
  }
  return res.json()
}

async function fetchDeal(dealId: string) {
  const propsQuery = DEAL_PROPERTIES.join(',')
  return hubspotGet(`/crm/v3/objects/deals/${dealId}?properties=${propsQuery}`)
}

async function fetchDealContact(dealId: string) {
  try {
    const assoc = await hubspotGet(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
    const contacts = assoc?.results ?? []
    if (contacts.length === 0) return null

    const contactId = contacts[0].id
    const propsQuery = CONTACT_PROPERTIES.join(',')
    return hubspotGet(`/crm/v3/objects/contacts/${contactId}?properties=${propsQuery}`)
  } catch {
    return null
  }
}

async function fetchAllDeals() {
  const deals: any[] = []
  const propsQuery = DEAL_PROPERTIES.join(',')
  let after: string | undefined

  console.log('Fetching all deals from HubSpot...')

  while (true) {
    const url = `/crm/v3/objects/deals?limit=100&properties=${propsQuery}${after ? `&after=${after}` : ''}`
    const page = await hubspotGet(url)
    deals.push(...(page.results ?? []))
    console.log(`  Fetched ${deals.length} deals...`)
    if (!page.paging?.next?.after) break
    after = page.paging.next.after
    // Rate limit: 100 req/10s
    await new Promise(r => setTimeout(r, 150))
  }

  return deals
}

// ─── Field Mapper ──────────────────────────────────────────────────────────

function mapDealToCase(deal: any, contact: any | null) {
  const p = deal.properties ?? {}
  const c = contact?.properties ?? {}

  const dealstage = p.dealstage ?? ''
  const caseStatus = STAGE_MAP[dealstage] ?? 'unknown'
  const isClosed = ['settled', 'dropped'].includes(caseStatus)

  return {
    hubspot_deal_id:        String(deal.id),
    client_first_name:      c.firstname ?? null,
    client_last_name:       c.lastname  ?? null,
    client_email:           c.email     ?? null,
    client_phone:           c.phone     ?? null,
    vehicle_year:           p.what_is_the_approximate_year_of_your_vehicle_
                              ? parseInt(p.what_is_the_approximate_year_of_your_vehicle_) || null
                              : null,
    vehicle_make:           p.what_is_the_make_of_your_vehicle_           ?? null,
    vehicle_model:          p.what_is_the_model_of_your_vehicle_          ?? null,
    vehicle_vin:            p.what_is_the_vin_of_the_vehicle_             ?? null,
    vehicle_mileage:        p.what_is_the_current_mileage_of_your_vehicle_
                              ? parseInt(p.what_is_the_current_mileage_of_your_vehicle_) || null
                              : null,
    vehicle_purchase_price: p.what_is_the_purchase_price_of_the_vehicle_
                              ? parseFloat(p.what_is_the_purchase_price_of_the_vehicle_) || null
                              : null,
    vehicle_purchase_date:  p.what_is_the_purchase_date_of_the_vehicle_   ?? null,
    vehicle_is_new:         p.is_the_vehicle_new_or_used_ === 'New' ? true
                              : p.is_the_vehicle_new_or_used_ === 'Used' ? false
                              : null,
    state_jurisdiction:     p.what_is_your_state_                         ?? null,
    case_type:              'lemon_law',
    case_status:            caseStatus,
    case_priority:          'normal',
    estimated_value:        p.amount ? parseFloat(p.amount) || null : null,
    closed_at:              isClosed && p.closedate ? p.closedate : null,
    created_at:             p.createdate ?? new Date().toISOString(),
    updated_at:             new Date().toISOString(),
    is_deleted:             false,
  }
}

// ─── Upsert to Supabase ────────────────────────────────────────────────────

async function upsertCase(caseData: any): Promise<'inserted' | 'updated' | 'error'> {
  const { error } = await coreDb
    .from('cases')
    .upsert(caseData, {
      onConflict: 'hubspot_deal_id',
      ignoreDuplicates: false
    })

  if (error) {
    console.error('Upsert error:', error.message, '| Data:', JSON.stringify(caseData).slice(0, 200))
    return 'error'
  }

  return 'inserted'
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dealIdArg = args.find(a => a.startsWith('--deal-id='))?.split('=')[1]
  const isBackfill = args.includes('--backfill')

  if (!dealIdArg && !isBackfill) {
    console.error('Usage: --deal-id=<id> or --backfill')
    process.exit(1)
  }

  if (dealIdArg) {
    // ── Single deal mode ──
    console.log(`\n▶ Syncing single deal: ${dealIdArg}`)
    console.log('─'.repeat(50))

    const [deal, contact] = await Promise.all([
      fetchDeal(dealIdArg),
      fetchDealContact(dealIdArg)
    ])

    console.log('\nHubSpot data:')
    console.log(`  Deal ID:    ${deal.id}`)
    console.log(`  Stage:      ${deal.properties?.dealstage}`)
    console.log(`  Contact:    ${contact?.properties?.firstname} ${contact?.properties?.lastname} | ${contact?.properties?.email}`)
    console.log(`  Vehicle:    ${deal.properties?.what_is_the_approximate_year_of_your_vehicle_} ${deal.properties?.what_is_the_make_of_your_vehicle_} ${deal.properties?.what_is_the_model_of_your_vehicle_}`)
    console.log(`  State:      ${deal.properties?.what_is_your_state_}`)

    const mapped = mapDealToCase(deal, contact)
    console.log('\nMapped to core.cases:')
    console.log(JSON.stringify(mapped, null, 2))

    const result = await upsertCase(mapped)
    console.log(`\n✅ Result: ${result}`)

    // Verify in DB
    const { data: row } = await coreDb
      .from('cases')
      .select('hubspot_deal_id, client_first_name, client_last_name, case_status, vehicle_make, vehicle_model, created_at')
      .eq('hubspot_deal_id', dealIdArg)
      .single()

    console.log('\nVerification — row in core.cases:')
    console.log(JSON.stringify(row, null, 2))

    // Total count
    const { count } = await coreDb.from('cases').select('*', { count: 'exact', head: true })
    console.log(`\ncore.cases total rows: ${count}`)

  } else {
    // ── Full backfill mode ──
    console.log('\n▶ Starting full HubSpot backfill')
    console.log('─'.repeat(50))
    const deals = await fetchAllDeals()
    console.log(`\nTotal deals to sync: ${deals.length}`)

    let inserted = 0, updated = 0, errors = 0

    for (const deal of deals) {
      const contact = await fetchDealContact(deal.id)
      const mapped  = mapDealToCase(deal, contact)
      const result  = await upsertCase(mapped)

      if (result === 'inserted') inserted++
      else if (result === 'updated') updated++
      else errors++

      if ((inserted + updated + errors) % 50 === 0) {
        console.log(`  Progress: ${inserted + updated + errors}/${deals.length} | errors: ${errors}`)
      }

      await new Promise(r => setTimeout(r, 50)) // light rate limiting
    }

    const { count } = await coreDb.from('cases').select('*', { count: 'exact', head: true })
    console.log(`\n✅ Backfill complete`)
    console.log(`   Upserted: ${inserted + updated} | Errors: ${errors}`)
    console.log(`   core.cases total rows: ${count}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
