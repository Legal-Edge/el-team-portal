/**
 * diagnose-sync-errors.mjs
 * Runs a single sync page at the specified cursor and prints full error details.
 * Usage: node scripts/diagnose-sync-errors.mjs [--after=<cursor>] [--page=<n>]
 */
import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const TOKEN    = process.env.BACKFILL_IMPORT_TOKEN
const ENDPOINT = 'https://team.easylemon.com/api/admin/sync-hubspot-cases'

const afterArg = process.argv.find(a => a.startsWith('--after='))?.split('=')[1] ?? null
const skipPages = parseInt(process.argv.find(a => a.startsWith('--page='))?.split('=')[1] ?? '0')

async function callSync(after, dryRun = false) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ after, limit: 50, dryRun }),
  })
  return res.json()
}

async function main() {
  let cursor = afterArg

  // Skip to target page
  if (skipPages > 0) {
    console.log(`Skipping to page ${skipPages}...`)
    for (let i = 0; i < skipPages; i++) {
      const r = await callSync(cursor, true)
      cursor = r.next_after
      if (!cursor) { console.log('No more pages'); return }
      if (i % 10 === 0) process.stdout.write(`  page ${i}/${skipPages}\r`)
    }
    console.log(`\nAt cursor: ${cursor}`)
  }

  // Now run 3 live pages and show all errors
  for (let i = 0; i < 5; i++) {
    console.log(`\n--- Page ${skipPages + i + 1} (cursor: ${cursor ?? 'start'}) ---`)
    const r = await callSync(cursor, false)
    console.log(`Synced: ${r.cases_synced} | Errors: ${r.cases_errors}`)
    if (r.errors?.length > 0) {
      console.log('ERRORS:')
      r.errors.forEach(e => console.log('  >', e))
    } else {
      console.log('No errors')
    }
    cursor = r.next_after
    if (!cursor) { console.log('No more pages'); break }
  }
}

main().catch(console.error)
