/**
 * run-sync-hubspot-cases.mjs
 *
 * Runner for /api/admin/sync-hubspot-cases.
 * Pages through all HubSpot deals and syncs them to:
 *   - core.cases
 *   - core.case_contacts (with normalised phone)
 *
 * Usage:
 *   node scripts/run-sync-hubspot-cases.mjs [--dry-run] [--page-size=50]
 *
 * Environment:
 *   BACKFILL_IMPORT_TOKEN   — admin auth token (from .env.local)
 *   SYNC_TARGET_URL         — base URL (default: https://team.easylemon.com)
 */

import { config }     from 'dotenv'
import path           from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const TOKEN      = process.env.BACKFILL_IMPORT_TOKEN
const TARGET_URL = process.env.SYNC_TARGET_URL ?? 'https://team.easylemon.com'
const ENDPOINT   = `${TARGET_URL}/api/admin/sync-hubspot-cases`

const args     = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const pageSize = parseInt(args.find(a => a.startsWith('--page-size='))?.split('=')[1] ?? '50', 10)

if (!TOKEN) {
  console.error('Missing BACKFILL_IMPORT_TOKEN in .env.local')
  process.exit(1)
}

const startTime = Date.now()
console.log(`\n=== HubSpot → Supabase Case Sync ===`)
console.log(`Mode:       ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
console.log(`Endpoint:   ${ENDPOINT}`)
console.log(`Page size:  ${pageSize}`)
console.log(`Started:    ${new Date().toISOString()}\n`)

let after        = null
let page         = 0
let totalDeals   = 0
let totalCasesSynced    = 0
let totalCasesErrors    = 0
let totalContactsOk     = 0
let totalContactsNoPhone = 0
let totalContactsNoContact = 0
let totalContactsErrors = 0
const allErrors = []

while (true) {
  page++

  let res, data
  try {
    res  = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ after, limit: pageSize, dryRun: isDryRun }),
    })
    data = await res.json()
  } catch (err) {
    console.error(`Page ${page} fetch error:`, err.message)
    break
  }

  if (!res.ok || data.error) {
    console.error(`Page ${page} error (HTTP ${res.status}):`, data.error ?? JSON.stringify(data))
    break
  }

  totalDeals              += data.page_size       ?? 0
  totalCasesSynced        += data.cases_synced    ?? 0
  totalCasesErrors        += data.cases_errors    ?? 0
  totalContactsOk         += data.contacts_ok     ?? 0
  totalContactsNoPhone    += data.contacts_no_phone ?? 0
  totalContactsNoContact  += data.contacts_no_contact ?? 0
  totalContactsErrors     += data.contacts_errors ?? 0
  if (data.errors?.length) allErrors.push(...data.errors)

  console.log(
    `Page ${page}: ${data.page_size} deals → cases: ${data.cases_synced} ok / ${data.cases_errors} err` +
    ` | contacts: ${data.contacts_ok} ok / ${data.contacts_no_phone} no_phone / ${data.contacts_no_contact} no_contact` +
    (isDryRun ? ' [DRY RUN]' : '')
  )

  after = data.next_after
  if (!data.has_more) break

  // Small pause between pages to be gentle on HubSpot rate limits
  await new Promise(r => setTimeout(r, 200))
}

const runtimeSec = ((Date.now() - startTime) / 1000).toFixed(1)

console.log(`\n=== Sync Complete ===`)
console.log(`Deals processed:            ${totalDeals}`)
console.log(`Cases synced (upserted):    ${totalCasesSynced}`)
console.log(`Cases errors:               ${totalCasesErrors}`)
console.log(`Contacts with phone:        ${totalContactsOk}`)
console.log(`Contacts no phone:          ${totalContactsNoPhone}`)
console.log(`Contacts no contact record: ${totalContactsNoContact}`)
console.log(`Contacts errors:            ${totalContactsErrors}`)
console.log(`Total errors:               ${allErrors.length}`)
console.log(`Runtime:                    ${runtimeSec}s`)
console.log(`Mode:                       ${isDryRun ? 'DRY RUN — no writes' : 'LIVE — DB updated'}`)
console.log(`Completed:                  ${new Date().toISOString()}`)

if (allErrors.length > 0) {
  console.log(`\nFirst 10 errors:`)
  allErrors.slice(0, 10).forEach(e => console.log(`  - ${e}`))
}
