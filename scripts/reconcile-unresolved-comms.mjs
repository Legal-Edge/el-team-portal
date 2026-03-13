/**
 * reconcile-unresolved-comms.mjs
 *
 * Matches unresolved communications (case_id = null, needs_review = true)
 * to cases by normalized phone number via core.case_contacts.
 *
 * Safe to run multiple times — only updates rows where a clean 1:1 phone match
 * is found. Rows with 0 or 2+ matches are left alone with needs_review = true.
 *
 * Usage:
 *   node scripts/reconcile-unresolved-comms.mjs [--dry-run] [--batch-size=500] [--source=aloware]
 *
 * Options:
 *   --dry-run          Print what would be updated without writing to DB
 *   --batch-size=N     Process N unresolved rows per iteration (default: 500)
 *   --source=system    Limit to a specific source_system (default: all)
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL     — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY    — Service role key (never the anon key)
 */

import { createClient } from '@supabase/supabase-js'
import { config }       from 'dotenv'
import path             from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

// ── CLI args ─────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2)
const isDryRun   = args.includes('--dry-run')
const batchSize  = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? '500', 10)
const sourceFilter = args.find(a => a.startsWith('--source='))?.split('=')[1] ?? null

// ── Init ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const coreDb   = supabase.schema('core')

const startTime = Date.now()
console.log(`\n=== Unresolved Communications Reconciliation ===`)
console.log(`Mode:       ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
console.log(`Batch size: ${batchSize}`)
console.log(`Source:     ${sourceFilter ?? 'all'}`)
console.log(`Started:    ${new Date().toISOString()}\n`)

// ── Step 1: Build phone → case_id map from core.case_contacts ───────────────
console.log('Loading case_contacts phone map...')

const { data: contacts, error: contactsErr } = await coreDb
  .from('case_contacts')
  .select('case_id, phone')

if (contactsErr || !contacts) {
  console.error('Failed to load case_contacts:', contactsErr)
  process.exit(1)
}

// phone → [case_id, ...]
const phoneMap = new Map()
for (const c of contacts) {
  if (!c.phone) continue
  const existing = phoneMap.get(c.phone) ?? []
  if (!existing.includes(c.case_id)) existing.push(c.case_id)
  phoneMap.set(c.phone, existing)
}

const uniquePhones = phoneMap.size
const ambiguousPhones = [...phoneMap.values()].filter(ids => ids.length > 1).length
console.log(`Loaded ${contacts.length} case_contacts → ${uniquePhones} unique phones (${ambiguousPhones} ambiguous)\n`)

// ── Step 2: Page through unresolved communications ────────────────────────────
let offset     = 0
let totalFetched  = 0
let totalResolved = 0
let totalAmbiguous = 0
let totalNoMatch  = 0
let totalErrors   = 0
let continueLoop  = true

// Sample collection (dry run only — first 10 per category)
const samples = { resolved: [], ambiguous: [], no_match: [] }

while (continueLoop) {
  // Fetch a batch of unresolved rows
  let query = coreDb
    .from('communications')
    .select('id, source_system, from_number, to_number, direction, needs_review, review_reason')
    .eq('needs_review', true)
    .is('case_id', null)
    .range(offset, offset + batchSize - 1)
    .order('id', { ascending: true })

  if (sourceFilter) {
    query = query.eq('source_system', sourceFilter)
  }

  const { data: rows, error: fetchErr } = await query

  if (fetchErr) {
    console.error('Fetch error:', fetchErr.message)
    totalErrors++
    break
  }

  if (!rows || rows.length === 0) {
    continueLoop = false
    break
  }

  totalFetched += rows.length

  // Determine the client phone for each row
  // For inbound: client phone is from_number; outbound: to_number
  const updates = []
  let batchResolved  = 0
  let batchAmbiguous = 0
  let batchNoMatch   = 0

  for (const row of rows) {
    const clientPhone = row.direction === 'inbound' ? row.from_number : row.to_number

    if (!clientPhone) {
      batchNoMatch++
      if (isDryRun && samples.no_match.length < 10) {
        samples.no_match.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: null, review_reason: 'no_contact_phone' })
      }
      continue
    }

    const matches = phoneMap.get(clientPhone) ?? []

    if (matches.length === 0) {
      batchNoMatch++
      if (isDryRun && samples.no_match.length < 10) {
        samples.no_match.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: clientPhone, review_reason: 'no_case_for_phone' })
      }
      continue
    }

    if (matches.length > 1) {
      updates.push({
        id:            row.id,
        case_id:       null,
        needs_review:  true,
        review_reason: `multiple_cases_for_phone: ${matches.join(', ')}`,
      })
      batchAmbiguous++
      if (isDryRun && samples.ambiguous.length < 10) {
        samples.ambiguous.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: clientPhone, matched_cases: matches })
      }
      continue
    }

    // Clean 1:1 match — resolve
    updates.push({
      id:            row.id,
      case_id:       matches[0],
      needs_review:  false,
      review_reason: null,
    })
    batchResolved++
    if (isDryRun && samples.resolved.length < 10) {
      samples.resolved.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: clientPhone, would_assign_case_id: matches[0] })
    }
  }

  totalResolved  += batchResolved
  totalAmbiguous += batchAmbiguous
  totalNoMatch   += batchNoMatch

  // Apply updates
  if (!isDryRun && updates.length > 0) {
    // Supabase bulk upsert on PK
    const { error: upsertErr } = await coreDb
      .from('communications')
      .upsert(updates, { onConflict: 'id' })

    if (upsertErr) {
      console.error(`Upsert error at offset ${offset}:`, upsertErr.message)
      totalErrors++
    }
  }

  console.log(
    `Batch offset=${offset}: fetched=${rows.length}, resolved=${batchResolved}, ` +
    `skipped=${batchSkipped}${isDryRun ? ' (dry run)' : ''}`
  )

  offset += batchSize

  // Stop if we got fewer rows than requested (last page)
  if (rows.length < batchSize) continueLoop = false
}

// ── Final report ─────────────────────────────────────────────────────────────
const runtimeMs  = Date.now() - startTime
const runtimeSec = (runtimeMs / 1000).toFixed(1)

console.log(`\n=== Reconciliation Complete ===`)
console.log(`Total unresolved scanned:         ${totalFetched}`)
console.log(`Would resolve (1:1 phone match):  ${totalResolved}`)
console.log(`Multiple cases (ambiguous):       ${totalAmbiguous}`)
console.log(`No case match:                    ${totalNoMatch}`)
console.log(`Errors:                           ${totalErrors}`)
console.log(`Runtime:                          ${runtimeSec}s`)
console.log(`Mode:                             ${isDryRun ? 'DRY RUN — no writes' : 'LIVE — DB updated'}`)
console.log(`Completed:                        ${new Date().toISOString()}`)

if (isDryRun) {
  console.log(`\n--- Sample: Would Resolve (up to 10) ---`)
  console.log(JSON.stringify(samples.resolved, null, 2))
  console.log(`\n--- Sample: Ambiguous / Multiple Cases (up to 10) ---`)
  console.log(JSON.stringify(samples.ambiguous, null, 2))
  console.log(`\n--- Sample: No Case Match (up to 10) ---`)
  console.log(JSON.stringify(samples.no_match, null, 2))
}
