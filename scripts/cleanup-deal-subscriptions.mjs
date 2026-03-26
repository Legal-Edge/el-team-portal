/**
 * cleanup-deal-subscriptions.mjs
 *
 * Deletes all deal.propertyChange subscriptions EXCEPT the ones we need,
 * then ensures the desired ones exist.
 *
 * Usage:
 *   node scripts/cleanup-deal-subscriptions.mjs [--dry-run]
 *
 * Required env (.env.local):
 *   HUBSPOT_ACCESS_TOKEN
 *   HUBSPOT_APP_ID
 *   BACKFILL_IMPORT_TOKEN
 */

import { config }        from 'dotenv'
import path              from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const HS_TOKEN  = process.env.HUBSPOT_ACCESS_TOKEN
const HS_APP_ID = process.env.HUBSPOT_APP_ID
const HOOK_TOKEN = process.env.BACKFILL_IMPORT_TOKEN
const DRY_RUN   = process.argv.includes('--dry-run')

if (!HS_TOKEN || !HS_APP_ID || !HOOK_TOKEN) {
  console.error('Missing: HUBSPOT_ACCESS_TOKEN, HUBSPOT_APP_ID, BACKFILL_IMPORT_TOKEN')
  process.exit(1)
}

// Only these deal subscriptions should exist
const KEEP_SUBSCRIPTIONS = new Set([
  'deal.creation',
  'deal.deletion',
  'deal.propertyChange::dealstage',
  'deal.propertyChange::amount',
  'deal.propertyChange::closedate',
])

async function hs(method, path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${HS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HubSpot ${res.status} ${method} ${path}: ${text.slice(0, 300)}`)
  }
  if (method === 'DELETE') return null
  return res.json()
}

function subKey(s) {
  return s.propertyName ? `${s.eventType}::${s.propertyName}` : s.eventType
}

async function main() {
  console.log(`\n=== Deal Subscription Cleanup${DRY_RUN ? ' (DRY RUN)' : ''} ===`)
  console.log(`App ID: ${HS_APP_ID}\n`)

  const { results: subs } = await hs('GET', `/webhooks/v3/${HS_APP_ID}/subscriptions`)
  const dealSubs = subs.filter(s => s.eventType.startsWith('deal.'))

  console.log(`Total deal subscriptions: ${dealSubs.length}`)

  let deleted = 0
  let kept    = 0

  for (const sub of dealSubs) {
    const key = subKey(sub)
    if (KEEP_SUBSCRIPTIONS.has(key)) {
      console.log(`  ✓ KEEP  [${sub.id}] ${key}`)
      kept++
    } else {
      console.log(`  ✗ DELETE [${sub.id}] ${key}`)
      if (!DRY_RUN) {
        try {
          await hs('DELETE', `/webhooks/v3/${HS_APP_ID}/subscriptions/${sub.id}`)
          deleted++
        } catch (err) {
          console.error(`    Failed to delete: ${err.message}`)
        }
      } else {
        deleted++
      }
    }
  }

  // Ensure required subscriptions exist
  const existingKeys = new Set(dealSubs.map(subKey))
  const TARGET_URL   = `https://team.easylemon.com/api/webhooks/hubspot-team?token=${HOOK_TOKEN}`
  const DESIRED = [
    { eventType: 'deal.creation' },
    { eventType: 'deal.deletion' },
    { eventType: 'deal.propertyChange', propertyName: 'dealstage'  },
    { eventType: 'deal.propertyChange', propertyName: 'amount'     },
    { eventType: 'deal.propertyChange', propertyName: 'closedate'  },
  ]

  console.log(`\nEnsuring required subscriptions exist...`)
  for (const desired of DESIRED) {
    const key = desired.propertyName ? `${desired.eventType}::${desired.propertyName}` : desired.eventType
    if (existingKeys.has(key)) {
      console.log(`  ✓ exists: ${key}`)
    } else {
      console.log(`  + creating: ${key}`)
      if (!DRY_RUN) {
        const sub = await hs('POST', `/webhooks/v3/${HS_APP_ID}/subscriptions`, {
          eventType:    desired.eventType,
          propertyName: desired.propertyName ?? undefined,
          active:       true,
        })
        console.log(`    ✅ created [${sub.id}]`)
      }
    }
  }

  console.log(`\n=== Done — ${deleted} deleted, ${kept} kept${DRY_RUN ? ' (dry run, no changes made)' : ''} ===`)
}

main().catch(err => { console.error(err); process.exit(1) })
