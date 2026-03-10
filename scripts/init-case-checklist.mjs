/**
 * Initialize document checklist for one or more cases.
 *
 * Creates a checklist row for every active document_type per case.
 * is_required is set based on the case's CURRENT stage — not a blanket default.
 *
 * Stage → required document types:
 *   intake / nurture / document_collection / attorney_review / info_needed / unknown
 *     → repair_order only
 *   sign_up / retained
 *     → repair_order + purchase_agreement + vehicle_registration
 *   settled / dropped
 *     → nothing required (case resolved/closed)
 *
 * Safe to re-run — upsert preserves existing status but DOES update is_required
 * so stage transitions (e.g. intake → sign_up) are reflected on re-run.
 *
 * Usage:
 *   node scripts/init-case-checklist.mjs --deal-id=57782494293
 *   node scripts/init-case-checklist.mjs --deal-ids=57782494293,57750922281
 *   node scripts/init-case-checklist.mjs --all
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db     = createClient(SUPABASE_URL, SUPABASE_KEY)
const coreDb = db.schema('core')

// ── Stage → required document type codes ──────────────────────────────────

const PRE_SIGN_UP_STAGES = new Set([
  'intake', 'nurture', 'document_collection',
  'attorney_review', 'info_needed', 'unknown',
])

const POST_SIGN_UP_STAGES = new Set(['sign_up', 'retained'])

const RESOLVED_STAGES = new Set(['settled', 'dropped'])

function requiredTypesForStage(caseStatus) {
  if (RESOLVED_STAGES.has(caseStatus)) return new Set()
  if (POST_SIGN_UP_STAGES.has(caseStatus)) {
    return new Set(['repair_order', 'purchase_agreement', 'vehicle_registration'])
  }
  // Pre-sign-up (including unknown/fallback)
  return new Set(['repair_order'])
}

// ── Init checklist for one case ────────────────────────────────────────────

async function initChecklist(caseRow) {
  const required = requiredTypesForStage(caseRow.case_status)

  // Load all active document types
  const { data: types, error: typeErr } = await coreDb
    .from('document_types')
    .select('code')
    .eq('is_active', true)
    .order('sort_order')

  if (typeErr) throw new Error(`Failed to load document_types: ${typeErr.message}`)

  const rows = types.map(t => ({
    case_id:            caseRow.id,
    document_type_code: t.code,
    status:             'required',   // only used when INSERTING new rows
    is_required:        required.has(t.code),
  }))

  // Step 1: INSERT new rows only — ignoreDuplicates=true means existing rows
  // are untouched entirely (status, received_at, notes all preserved).
  const { error } = await coreDb
    .from('case_document_checklist')
    .upsert(rows, { onConflict: 'case_id,document_type_code', ignoreDuplicates: true })

  if (error) throw new Error(`Checklist insert failed: ${error.message}`)

  // Step 2: Update is_required on ALL rows for this case based on current stage.
  // This is the only column we ever touch on existing rows.
  // Status, received_at, notes etc. are never modified here.
  const nonRequired = types.map(t => t.code).filter(c => !required.has(c))

  if (nonRequired.length > 0) {
    await coreDb
      .from('case_document_checklist')
      .update({ is_required: false, updated_at: new Date().toISOString() })
      .eq('case_id', caseRow.id)
      .in('document_type_code', nonRequired)
  }

  if (required.size > 0) {
    await coreDb
      .from('case_document_checklist')
      .update({ is_required: true, updated_at: new Date().toISOString() })
      .eq('case_id', caseRow.id)
      .in('document_type_code', [...required])
  }

  return { total: types.length, required: required.size }
}

// ─── Main ────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const dealIdArg  = args.find(a => a.startsWith('--deal-id='))?.split('=')[1]
const dealIdsArg = args.find(a => a.startsWith('--deal-ids='))?.split('=')[1]
const allFlag    = args.includes('--all')

let cases = []

if (dealIdArg) {
  const { data } = await coreDb
    .from('cases')
    .select('id,hubspot_deal_id,client_first_name,client_last_name,case_status')
    .eq('hubspot_deal_id', dealIdArg)
    .single()
  if (!data) { console.error('Case not found'); process.exit(1) }
  cases = [data]
} else if (dealIdsArg) {
  const ids = dealIdsArg.split(',').map(s => s.trim())
  const { data } = await coreDb
    .from('cases')
    .select('id,hubspot_deal_id,client_first_name,client_last_name,case_status')
    .in('hubspot_deal_id', ids)
  cases = data ?? []
} else if (allFlag) {
  const { data } = await coreDb
    .from('cases')
    .select('id,hubspot_deal_id,client_first_name,client_last_name,case_status')
    .eq('is_deleted', false)
  cases = data ?? []
  console.log(`Found ${cases.length} cases`)
} else {
  console.error('Usage: --deal-id=<id>  |  --deal-ids=<id1,id2>  |  --all')
  process.exit(1)
}

let ok = 0, errors = 0

for (const c of cases) {
  const name = [c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || c.hubspot_deal_id
  process.stdout.write(`▶  ${name} [${c.case_status}] ... `)
  try {
    const { total, required } = await initChecklist(c)
    console.log(`✅ (${total} types | ${required} required)`)
    ok++
  } catch (e) {
    console.log(`✗ ${e.message}`)
    errors++
  }
}

console.log(`\nDone: ${ok} initialized | ${errors} errors`)
