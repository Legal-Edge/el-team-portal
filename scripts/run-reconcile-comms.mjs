/**
 * run-reconcile-comms.mjs
 *
 * Runner for the /api/admin/reconcile-comms endpoint.
 * Pages through all unresolved communications in batches until complete.
 *
 * Usage:
 *   node scripts/run-reconcile-comms.mjs [--dry-run] [--source=aloware] [--batch-size=500]
 *
 * Environment:
 *   BACKFILL_IMPORT_TOKEN  — auth token (from .env.local)
 *   RECONCILE_TARGET_URL   — base URL (default: https://team.easylemon.com)
 */

import { config }     from 'dotenv'
import path           from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const TOKEN      = process.env.BACKFILL_IMPORT_TOKEN
const TARGET_URL = process.env.RECONCILE_TARGET_URL ?? 'https://team.easylemon.com'
const ENDPOINT   = `${TARGET_URL}/api/admin/reconcile-comms`

const args       = process.argv.slice(2)
const isDryRun   = args.includes('--dry-run')
const batchSize  = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? '500', 10)
const source     = args.find(a => a.startsWith('--source='))?.split('=')[1] ?? null

if (!TOKEN) {
  console.error('Missing BACKFILL_IMPORT_TOKEN in .env.local')
  process.exit(1)
}

console.log(`\n=== Communications Reconciliation Runner ===`)
console.log(`Mode:       ${isDryRun ? 'DRY RUN' : 'LIVE'}`)
console.log(`Endpoint:   ${ENDPOINT}`)
console.log(`Batch size: ${batchSize}`)
console.log(`Source:     ${source ?? 'all'}`)
console.log(`Started:    ${new Date().toISOString()}\n`)

const startTime = Date.now()
let offset = 0
let totalFetched  = 0
let totalResolved = 0
let totalAmbiguous = 0
let totalNoMatch  = 0
let totalErrors   = 0
let batchNum      = 0
let allSamples    = { resolved: [], ambiguous: [], no_match: [] }

while (true) {
  batchNum++

  const payload = { dryRun: isDryRun, batchSize, offset, ...(source ? { source } : {}) }

  let res, data
  try {
    res  = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    data = await res.json()
  } catch (err) {
    console.error(`Batch ${batchNum} fetch error:`, err.message)
    totalErrors++
    break
  }

  if (!res.ok || data.error) {
    console.error(`Batch ${batchNum} error (HTTP ${res.status}):`, data.error ?? JSON.stringify(data))
    totalErrors++
    break
  }

  totalFetched   += data.fetched   ?? 0
  totalResolved  += data.resolved  ?? 0
  totalAmbiguous += data.ambiguous ?? 0
  totalNoMatch   += data.no_match  ?? 0
  if (data.errors?.length) totalErrors += data.errors.length

  // Collect samples (first batch only)
  if (batchNum === 1 && isDryRun && data.samples) {
    allSamples = data.samples
  }

  console.log(
    `Batch ${batchNum} (offset=${offset}): fetched=${data.fetched}, ` +
    `resolved=${data.resolved}, ambiguous=${data.ambiguous}, no_match=${data.no_match}` +
    (isDryRun ? ' [DRY RUN]' : '')
  )

  offset = data.next_offset

  if (!data.has_more || data.fetched === 0) break
}

const runtimeSec = ((Date.now() - startTime) / 1000).toFixed(1)

console.log(`\n=== Reconciliation Complete ===`)
console.log(`Total unresolved scanned:        ${totalFetched}`)
console.log(`Would resolve (1:1 phone match): ${totalResolved}`)
console.log(`Multiple cases (ambiguous):      ${totalAmbiguous}`)
console.log(`No case match:                   ${totalNoMatch}`)
console.log(`Errors:                          ${totalErrors}`)
console.log(`Runtime:                         ${runtimeSec}s`)
console.log(`Mode:                            ${isDryRun ? 'DRY RUN — no writes' : 'LIVE — DB updated'}`)
console.log(`Completed:                       ${new Date().toISOString()}`)

if (isDryRun && allSamples) {
  console.log(`\n--- Sample: Would Resolve (up to 10) ---`)
  console.log(JSON.stringify(allSamples.resolved, null, 2))
  console.log(`\n--- Sample: Ambiguous / Multiple Cases (up to 10) ---`)
  console.log(JSON.stringify(allSamples.ambiguous, null, 2))
  console.log(`\n--- Sample: No Case Match (up to 10) ---`)
  console.log(JSON.stringify(allSamples.no_match, null, 2))
}
