/**
 * Initialize document checklist for one or more cases.
 * Creates a checklist row for every active document_type,
 * marking required types as 'required' and optional as 'required' too
 * (staff can waive if not applicable).
 *
 * Safe to re-run — uses upsert, won't overwrite existing status.
 *
 * Usage:
 *   node scripts/init-case-checklist.mjs --deal-id=57782494293
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

async function initChecklist(caseRow) {
  // Load all active document types
  const { data: types, error: typeErr } = await coreDb
    .from('document_types')
    .select('code, is_required_default')
    .eq('is_active', true)
    .order('sort_order')

  if (typeErr) throw new Error(`Failed to load document_types: ${typeErr.message}`)

  const rows = types.map(t => ({
    case_id:            caseRow.id,
    document_type_code: t.code,
    status:             'required',
    is_required:        t.is_required_default,
  }))

  // Upsert — do nothing on conflict so existing status is preserved
  const { error } = await coreDb
    .from('case_document_checklist')
    .upsert(rows, { onConflict: 'case_id,document_type_code', ignoreDuplicates: true })

  if (error) throw new Error(`Checklist upsert failed: ${error.message}`)

  return types.length
}

// ─── Main ────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const dealIdArg  = args.find(a => a.startsWith('--deal-id='))?.split('=')[1]
const dealIdsArg = args.find(a => a.startsWith('--deal-ids='))?.split('=')[1]
const allFlag    = args.includes('--all')

let cases = []

if (dealIdArg) {
  const { data } = await coreDb.from('cases').select('id,hubspot_deal_id,client_first_name,client_last_name').eq('hubspot_deal_id', dealIdArg).single()
  if (!data) { console.error('Case not found'); process.exit(1) }
  cases = [data]
} else if (dealIdsArg) {
  const ids = dealIdsArg.split(',').map(s => s.trim())
  const { data } = await coreDb.from('cases').select('id,hubspot_deal_id,client_first_name,client_last_name').in('hubspot_deal_id', ids)
  cases = data ?? []
} else if (allFlag) {
  const { data } = await coreDb.from('cases').select('id,hubspot_deal_id,client_first_name,client_last_name').eq('is_deleted', false)
  cases = data ?? []
  console.log(`Found ${cases.length} cases`)
} else {
  console.error('Usage: --deal-id=<id>  |  --deal-ids=<id1,id2>  |  --all')
  process.exit(1)
}

let ok = 0, errors = 0

for (const c of cases) {
  const name = [c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || c.hubspot_deal_id
  process.stdout.write(`▶  ${name} ... `)
  try {
    const count = await initChecklist(c)
    console.log(`✅ (${count} checklist items)`)
    ok++
  } catch (e) {
    console.log(`✗ ${e.message}`)
    errors++
  }
}

console.log(`\nDone: ${ok} initialized | ${errors} errors`)
