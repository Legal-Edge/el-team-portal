/**
 * setup-team-webhooks.mjs
 *
 * Registers HubSpot webhook subscriptions for team.easylemon.com real-time sync.
 * Run once. Safe to re-run (lists existing subscriptions first).
 *
 * Usage:
 *   HUBSPOT_APP_ID=<appId> node scripts/setup-team-webhooks.mjs
 *
 * How to find your App ID:
 *   HubSpot → Settings → Integrations → Private Apps → [your app] → App ID
 *   OR: use the app ID from the existing partner portal subscriptions.
 *
 * Required env:
 *   HUBSPOT_ACCESS_TOKEN  — private app token
 *   HUBSPOT_APP_ID        — numeric app ID
 *   BACKFILL_IMPORT_TOKEN — webhook auth token (goes into the URL)
 */

import { config } from 'dotenv'
import path       from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const HS_TOKEN   = process.env.HUBSPOT_ACCESS_TOKEN
const HS_APP_ID  = process.env.HUBSPOT_APP_ID ?? process.argv.find(a => a.startsWith('--app-id='))?.split('=')[1]
const HOOK_TOKEN = process.env.BACKFILL_IMPORT_TOKEN

if (!HS_TOKEN || !HS_APP_ID || !HOOK_TOKEN) {
  console.error('Missing: HUBSPOT_ACCESS_TOKEN, HUBSPOT_APP_ID, BACKFILL_IMPORT_TOKEN')
  process.exit(1)
}

const TARGET_URL = `https://team.easylemon.com/api/webhooks/hubspot-team?token=${HOOK_TOKEN}`

const DESIRED_SUBSCRIPTIONS = [
  { eventType: 'deal.creation' },
  { eventType: 'deal.deletion' },
  { eventType: 'deal.propertyChange', propertyName: 'dealstage' },
  { eventType: 'deal.propertyChange', propertyName: 'amount' },
  { eventType: 'deal.propertyChange', propertyName: 'closedate' },
]

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
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

async function main() {
  console.log(`\n=== HubSpot Webhook Setup for team.easylemon.com ===`)
  console.log(`App ID:   ${HS_APP_ID}`)
  console.log(`Hook URL: ${TARGET_URL.replace(HOOK_TOKEN, '<REDACTED>')}\n`)

  // 1. Check current webhook target URL
  try {
    const settings = await hs('GET', `/webhooks/v3/${HS_APP_ID}/settings`)
    console.log(`Current target URL: ${settings.targetUrl ?? '(none)'}`)

    if (settings.targetUrl !== TARGET_URL) {
      console.log(`Updating target URL...`)
      await hs('PUT', `/webhooks/v3/${HS_APP_ID}/settings`, {
        targetUrl: TARGET_URL,
        throttling: { maxConcurrentRequests: 10, period: 'SECONDLY' },
      })
      console.log(`✅ Target URL updated`)
    } else {
      console.log(`✅ Target URL already correct`)
    }
  } catch (err) {
    console.error(`Failed to get/update webhook settings: ${err.message}`)
    console.log(`Continuing to subscription setup...`)
  }

  // 2. List existing subscriptions
  const existing = await hs('GET', `/webhooks/v3/${HS_APP_ID}/subscriptions`)
  const existingList = existing.results ?? []
  console.log(`\nExisting subscriptions (${existingList.length}):`)
  for (const s of existingList) {
    console.log(`  [${s.id}] ${s.eventType}${s.propertyName ? ` → ${s.propertyName}` : ''} (${s.active ? 'ACTIVE' : 'INACTIVE'})`)
  }

  // 3. Create missing subscriptions
  console.log(`\nChecking desired subscriptions...`)
  let created = 0
  for (const desired of DESIRED_SUBSCRIPTIONS) {
    const key = desired.propertyName
      ? `${desired.eventType}::${desired.propertyName}`
      : desired.eventType

    const exists = existingList.some(s => {
      if (s.eventType !== desired.eventType) return false
      if (desired.propertyName) return s.propertyName === desired.propertyName
      return !s.propertyName
    })

    if (exists) {
      console.log(`  ✓ already exists: ${key}`)
    } else {
      console.log(`  + creating: ${key}...`)
      try {
        const sub = await hs('POST', `/webhooks/v3/${HS_APP_ID}/subscriptions`, {
          eventType:    desired.eventType,
          propertyName: desired.propertyName ?? undefined,
          active:       true,
        })
        console.log(`    ✅ created [${sub.id}]`)
        created++
      } catch (err) {
        console.error(`    ❌ failed: ${err.message}`)
      }
    }
  }

  console.log(`\n=== Done — ${created} subscription(s) created ===`)
  console.log(`\nTest the webhook:`)
  console.log(`  curl -X POST "${TARGET_URL.replace(HOOK_TOKEN, '<TOKEN>')}" \\`)
  console.log(`    -H 'Content-Type: application/json' \\`)
  console.log(`    -d '[{"subscriptionType":"deal.propertyChange","objectId":57404229253,"propertyName":"dealstage","propertyValue":"955864719"}]'`)
}

main().catch(err => { console.error(err); process.exit(1) })
