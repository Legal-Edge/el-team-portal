/**
 * POST /api/integrations/hubspot/settlements
 *
 * Two modes:
 * 1. HubSpot webhook — fires when attorneys_fees / date___settled /
 *    date___disburse_funds changes on a deal.
 *    Payload: array of { objectId, propertyName, propertyValue }
 *
 * 2. Backfill — triggered via ?backfill=true (admin only).
 *    Fetches ALL HubSpot deals with attorneys_fees > 0 and at least one
 *    settlement date set, then upserts them all.
 *
 * Revenue rule:
 *   revenue_date = COALESCE(date___settled, date___disburse_funds)
 *   Only upsert when attorneys_fees > 0 AND revenue_date is present.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { getTeamSession }            from '@/lib/session'

const HS_BASE    = 'https://api.hubapi.com'
const HS_TOKEN   = () => process.env.HUBSPOT_ACCESS_TOKEN!
const PROPERTIES = ['dealname', 'attorneys_fees', 'date___settled', 'date___disburse_funds'].join(',')

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

// ── Fetch a single deal from HubSpot ─────────────────────────────────────────
async function fetchDeal(dealId: string): Promise<any | null> {
  const url = `${HS_BASE}/crm/v3/objects/deals/${dealId}?properties=${PROPERTIES}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${HS_TOKEN()}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

// ── Parse a HubSpot date string to ISO date ────────────────────────────────
function parseHsDate(val: string | null | undefined): string | null {
  if (!val) return null
  // HubSpot stores dates as milliseconds since epoch OR YYYY-MM-DD
  if (/^\d{10,}$/.test(val)) {
    return new Date(parseInt(val)).toISOString().split('T')[0]
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.split('T')[0]
  return null
}

// ── Build and upsert a settlement row ─────────────────────────────────────────
async function upsertSettlement(db: ReturnType<typeof getFinanceDb>, deal: any): Promise<boolean> {
  const props = deal.properties || deal
  const dealId       = String(deal.id || deal.dealId || props.hs_object_id || '')
  const attorneys    = parseFloat(props.attorneys_fees || '0') || 0
  const dateSettled  = parseHsDate(props.date___settled)
  const dateDisburse = parseHsDate(props.date___disburse_funds)
  const revenueDate  = dateSettled || dateDisburse

  // Only store when we have both a fee amount and a date
  if (attorneys <= 0 || !revenueDate || !dealId) return false

  const { error } = await db.from('settlements').upsert({
    hubspot_deal_id: dealId,
    deal_name:       props.dealname || null,
    attorneys_fees:  attorneys,
    date_settled:    dateSettled,
    date_disburse:   dateDisburse,
    revenue_date:    revenueDate,
    entity_name:     'RockPoint Law, P.C.',
    synced_at:       new Date().toISOString(),
  }, { onConflict: 'hubspot_deal_id' })

  if (error) {
    console.error('settlements upsert error:', error)
    return false
  }
  return true
}

// ── Webhook handler (POST from HubSpot) ───────────────────────────────────────
export async function POST(req: NextRequest) {
  const isBackfill = req.nextUrl.searchParams.get('backfill') === 'true'

  // ── Backfill mode (admin only) ─────────────────────────────────────────────
  if (isBackfill) {
    const session = await getTeamSession()
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = getFinanceDb()
    let upserted = 0
    let after: string | undefined

    while (true) {
      const body: any = {
        filterGroups: [
          {
            filters: [
              { propertyName: 'attorneys_fees', operator: 'GT', value: '0' },
            ],
          },
        ],
        properties: PROPERTIES.split(','),
        limit: 100,
        ...(after ? { after } : {}),
      }

      const res = await fetch(`${HS_BASE}/crm/v3/objects/deals/search`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${HS_TOKEN()}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        cache:   'no-store',
      })

      if (!res.ok) {
        console.error('HubSpot search error:', await res.text())
        break
      }

      const data = await res.json()
      const deals: any[] = data.results || []

      for (const deal of deals) {
        const ok = await upsertSettlement(db, deal)
        if (ok) upserted++
      }

      const nextPage = data.paging?.next?.after
      if (!nextPage || deals.length === 0) break
      after = nextPage
    }

    console.log(`Settlements backfill: ${upserted} deals upserted`)
    return NextResponse.json({ ok: true, upserted })
  }

  // ── Webhook mode ───────────────────────────────────────────────────────────
  let payload: any[]
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // HubSpot sends an array of change events
  const events = Array.isArray(payload) ? payload : [payload]

  // Collect unique deal IDs that changed relevant properties
  const relevantProps = new Set(['attorneys_fees', 'date___settled', 'date___disburse_funds'])
  const dealIds = new Set<string>()

  for (const event of events) {
    const prop = event.propertyName || event.subscriptionType
    const id   = String(event.objectId || event.dealId || '')
    if (id && (!prop || relevantProps.has(prop))) {
      dealIds.add(id)
    }
  }

  if (dealIds.size === 0) {
    return NextResponse.json({ ok: true, message: 'No relevant deal changes' })
  }

  const db = getFinanceDb()
  let processed = 0

  for (const dealId of dealIds) {
    try {
      const deal = await fetchDeal(dealId)
      if (!deal) continue
      const ok = await upsertSettlement(db, deal)
      if (ok) processed++
    } catch (err) {
      console.error(`settlements webhook: failed for deal ${dealId}:`, err)
    }
  }

  console.log(`Settlements webhook: processed ${processed} deals`)
  return NextResponse.json({ ok: true, processed })
}
