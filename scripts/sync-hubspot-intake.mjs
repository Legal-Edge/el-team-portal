/**
 * HubSpot → core.case_intake Sync
 * Syncs intake questionnaire fields for cases already in core.cases
 *
 * Usage:
 *   node scripts/sync-hubspot-intake.mjs --deal-id=57785602325
 *   node scripts/sync-hubspot-intake.mjs --deal-ids=111,222,333
 *   node scripts/sync-hubspot-intake.mjs --all
 */

import { createClient } from '@supabase/supabase-js'

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!HUBSPOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: HUBSPOT_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const coreDb   = supabase.schema('core')

// All intake properties to fetch from HubSpot deal object
const INTAKE_DEAL_PROPS = [
  // Submission
  'ela_intake',
  'intake_management',
  'intake_hubspot_qualifier',
  'intake_associate',
  'have_you_had_any_repairs_done_to_your_vehicle_',
  'did_you_have_to_pay_for_the_repairs_',
  'how_many_repairs_have_you_had_done_to_your_vehicle_',
  // Vehicle supplement
  'did_you_purchase_or_lease_your_car_',
  'how_did_you_purchase_or_lease_your_used_vehicle_',
  'do_you_still_have_the_vehicle__or_have_you_sold__returned__or_traded_it_in_',
  // Problems
  'what_is_the_most_common_problem_you_re_having_with_your_vehicle_',
  'most_common_problem__notes_',
  'most_common_problem_repair_attempts',
  'what_is_the_second_most_common_problem_you_re_having_with_your_vehicle_',
  'second_common_problem__notes_',
  'second_common_problem_repair_attempts',
  'what_is_the_third_most_common_problem_you_re_having_with_your_vehicle_',
  'third_common_problem__notes_',
  'third_common_problem_repair_attempts',
  'what_is_the_fourth_most_common_problem_you_re_having_with_your_vehicle_',
  'fourth_common_problem__notes_',
  'fourth_common_problem_repair_attempts',
  'repair_attempts',
  'last_repair_attempt_date',
  // Additional
  'was_your_car_in_the_repair_shop_for_more_than_30_days_at_any_time_',
  'have_you_or_the_dealership_contacted_the_manufacturer_of_your_vehicle_',
  'did_the_manufacturer_offer_a_solution_like_a_refund__exchange_or_additional_repair_coverage_',
  'do_you_have_the_repair_documents__or_would_you_need_to_get_it_from_the_dealership_',
  'would_you_prefer_a_full_refund__or_keep_your_car_and_get_a_partial_refund_',
]

async function hs(path) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }
  })
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

function str(v) {
  if (v === null || v === undefined || v === '') return null
  return String(v).trim() || null
}

function parseDate(v) {
  if (!v) return null
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function parseBool(v) {
  if (v === null || v === undefined) return null
  const s = String(v).toLowerCase().trim()
  if (['yes', 'true', '1'].includes(s)) return true
  if (['no', 'false', '0'].includes(s)) return false
  return null
}

function mapIntake(dealId, caseId, p) {
  return {
    case_id: caseId,
    ela_intake: str(p.ela_intake),
    intake_management: str(p.intake_management),
    intake_hubspot_qualifier: str(p.intake_hubspot_qualifier),
    intake_associate: str(p.intake_associate),
    had_repairs: parseBool(p.have_you_had_any_repairs_done_to_your_vehicle_),
    paid_for_repairs: str(p.did_you_have_to_pay_for_the_repairs_),
    repair_count: str(p.how_many_repairs_have_you_had_done_to_your_vehicle_),
    purchase_or_lease: str(p.did_you_purchase_or_lease_your_car_),
    how_purchased: str(p.how_did_you_purchase_or_lease_your_used_vehicle_),
    vehicle_status: str(p.do_you_still_have_the_vehicle__or_have_you_sold__returned__or_traded_it_in_),
    problem_1_category: str(p.what_is_the_most_common_problem_you_re_having_with_your_vehicle_),
    problem_1_notes: str(p.most_common_problem__notes_),
    problem_1_repair_attempts: str(p.most_common_problem_repair_attempts),
    problem_2_category: str(p.what_is_the_second_most_common_problem_you_re_having_with_your_vehicle_),
    problem_2_notes: str(p.second_common_problem__notes_),
    problem_2_repair_attempts: str(p.second_common_problem_repair_attempts),
    problem_3_category: str(p.what_is_the_third_most_common_problem_you_re_having_with_your_vehicle_),
    problem_3_notes: str(p.third_common_problem__notes_),
    problem_3_repair_attempts: str(p.third_common_problem_repair_attempts),
    problem_4_category: str(p.what_is_the_fourth_most_common_problem_you_re_having_with_your_vehicle_),
    problem_4_notes: str(p.fourth_common_problem__notes_),
    problem_4_repair_attempts: str(p.fourth_common_problem_repair_attempts),
    repair_attempts: str(p.repair_attempts),
    last_repair_attempt_date: parseDate(p.last_repair_attempt_date),
    in_shop_30_days: str(p.was_your_car_in_the_repair_shop_for_more_than_30_days_at_any_time_),
    contacted_manufacturer: str(p.have_you_or_the_dealership_contacted_the_manufacturer_of_your_vehicle_),
    manufacturer_offer: str(p.did_the_manufacturer_offer_a_solution_like_a_refund__exchange_or_additional_repair_coverage_),
    has_repair_documents: str(p.do_you_have_the_repair_documents__or_would_you_need_to_get_it_from_the_dealership_),
    refund_preference: str(p.would_you_prefer_a_full_refund__or_keep_your_car_and_get_a_partial_refund_),
    updated_at: new Date().toISOString(),
  }
}

async function syncDeal(dealId) {
  // Look up case_id
  const { data: caseRow, error: caseErr } = await coreDb
    .from('cases')
    .select('id')
    .eq('hubspot_deal_id', String(dealId))
    .single()

  if (caseErr || !caseRow) {
    console.warn(`  ⚠ Case not found for deal ${dealId} — run sync-hubspot-cases first`)
    return 'missing'
  }

  // Fetch deal intake props from HubSpot
  const propsQuery = INTAKE_DEAL_PROPS.join(',')
  const deal = await hs(`/crm/v3/objects/deals/${dealId}?properties=${propsQuery}`)
  const p = deal.properties ?? {}

  const row = mapIntake(dealId, caseRow.id, p)

  const { error } = await coreDb
    .from('case_intake')
    .upsert(row, { onConflict: 'case_id', ignoreDuplicates: false })

  if (error) {
    console.error(`  ✗ Upsert error [${dealId}]:`, error.message)
    return 'error'
  }

  return 'ok'
}

// ─── Main ────────────────────────────────────────────────

const args = process.argv.slice(2)
const dealIdArg  = args.find(a => a.startsWith('--deal-id='))?.split('=')[1]
const dealIdsArg = args.find(a => a.startsWith('--deal-ids='))?.split('=')[1]
const allFlag    = args.includes('--all')

let dealIds = []

if (dealIdArg) {
  dealIds = [dealIdArg]
} else if (dealIdsArg) {
  dealIds = dealIdsArg.split(',').map(s => s.trim()).filter(Boolean)
} else if (allFlag) {
  const { data } = await coreDb.from('cases').select('hubspot_deal_id').eq('is_deleted', false)
  dealIds = (data ?? []).map(r => r.hubspot_deal_id)
  console.log(`Found ${dealIds.length} cases to sync intake for`)
} else {
  console.error('Usage: --deal-id=<id>  |  --deal-ids=<id1,id2>  |  --all')
  process.exit(1)
}

let ok = 0, errors = 0, missing = 0

for (const id of dealIds) {
  process.stdout.write(`▶  ${id} ... `)
  try {
    const res = await syncDeal(id)
    if (res === 'ok')      { ok++;      console.log('✅') }
    else if (res === 'missing') { missing++; console.log('⚠ (no case)') }
    else                   { errors++;  console.log('✗') }
  } catch (e) {
    errors++
    console.log('✗', e.message)
  }
  await new Promise(r => setTimeout(r, 100))
}

console.log(`\nTotal: ${ok} synced | ${errors} errors | ${missing} missing cases`)
