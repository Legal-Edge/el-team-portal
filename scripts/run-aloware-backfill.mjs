/**
 * Aloware SMS Backfill Driver
 *
 * Reads pre-processed fixture JSON and POSTs batches to the deployed
 * /api/admin/backfill-sms endpoint on Vercel (where Supabase creds live).
 *
 * Usage:
 *   # 100-row dry run:
 *   node scripts/run-aloware-backfill.mjs --dry-run
 *
 *   # Full import:
 *   node scripts/run-aloware-backfill.mjs
 *
 * Env vars required (set locally):
 *   BACKFILL_IMPORT_TOKEN   — must match value set in Vercel env
 *   BACKFILL_TARGET_URL     — https://team.easylemon.com  (or localhost:3000)
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname   = dirname(fileURLToPath(import.meta.url))
const FIXTURE     = resolve(__dirname, 'data/aloware-backfill.json')
const TOKEN       = process.env.BACKFILL_IMPORT_TOKEN
const TARGET_URL  = process.env.BACKFILL_TARGET_URL ?? 'https://team.easylemon.com'
const ENDPOINT    = `${TARGET_URL}/api/admin/backfill-sms`

const DRY_RUN     = process.argv.includes('--dry-run')
const BATCH_SIZE  = 500
const DRY_RUN_MAX = 100

if (!TOKEN) {
  console.error('Error: BACKFILL_IMPORT_TOKEN env var is required')
  process.exit(1)
}

async function postBatch(records, dryRun = false) {
  const res = await fetch(ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ records, dryRun }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  return res.json()
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log(' Aloware SMS Backfill Driver')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`Mode:     ${DRY_RUN ? '🧪 DRY RUN (100 rows)' : '🚀 FULL IMPORT'}`)
  console.log(`Endpoint: ${ENDPOINT}`)
  console.log('')

  // Load fixture
  console.log('Loading fixture...')
  const allRecords = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const records    = DRY_RUN ? allRecords.slice(0, DRY_RUN_MAX) : allRecords
  console.log(`Records to process: ${records.length}`)
  console.log('')

  // Split into batches
  const batches = []
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push(records.slice(i, i + BATCH_SIZE))
  }
  console.log(`Batches: ${batches.length} × ${BATCH_SIZE} rows`)
  console.log('')

  // Cumulative stats
  const totals = { received: 0, inserted: 0, skipped: 0, needs_review: 0, errors: [] }
  let batchNum = 0

  for (const batch of batches) {
    batchNum++
    const label = `Batch ${batchNum}/${batches.length} (${batch.length} records)`
    process.stdout.write(`${label}: `)

    try {
      const result = await postBatch(batch, DRY_RUN)
      totals.received     += result.received     ?? 0
      totals.inserted     += result.inserted     ?? 0
      totals.skipped      += result.skipped      ?? 0
      totals.needs_review += result.needs_review ?? 0
      if (result.errors?.length) totals.errors.push(...result.errors)

      console.log(
        `✓  inserted=${result.inserted}  skipped=${result.skipped}  review=${result.needs_review}` +
        (result.errors?.length ? `  ERRORS=${result.errors.length}` : '')
      )
    } catch (err) {
      console.error(`FAILED: ${err.message}`)
      totals.errors.push(`Batch ${batchNum}: ${err.message}`)
      // Continue — don't abort full import on single batch failure
    }

    // Small delay to avoid overwhelming serverless cold starts
    if (!DRY_RUN && batchNum % 10 === 0) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────────
  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(' Summary Report')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`Total sent:       ${totals.received}`)
  console.log(`Inserted:         ${totals.inserted}`)
  console.log(`Skipped (dups):   ${totals.skipped}`)
  console.log(`Needs review:     ${totals.needs_review}`)
  console.log(`Batch errors:     ${totals.errors.length}`)

  if (totals.errors.length > 0) {
    console.log('\nErrors:')
    totals.errors.forEach(e => console.log(`  ${e}`))
  }

  const reportPath = resolve(__dirname, `../../../aloware-backfill-report-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify({ ...totals, dry_run: DRY_RUN, timestamp: new Date().toISOString() }, null, 2))
  console.log(`\nReport saved: ${reportPath}`)

  console.log(`
Verification query (run in Supabase SQL editor):

  SELECT 
    COUNT(*)                                                  AS total_imported,
    SUM(CASE WHEN case_id IS NOT NULL THEN 1 ELSE 0 END)     AS linked_to_cases,
    SUM(CASE WHEN needs_review = true THEN 1 ELSE 0 END)     AS needs_review,
    SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END)   AS inbound,
    SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END)  AS outbound,
    MIN(occurred_at)                                          AS earliest,
    MAX(occurred_at)                                          AS latest
  FROM core.communications
  WHERE source_system = 'aloware_backfill';
  `)

  if (DRY_RUN) {
    console.log('\n✅ Dry run complete. Remove --dry-run flag for full import.')
  } else {
    console.log('\n✅ Import complete!')
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
