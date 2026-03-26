/**
 * POST /api/admin/resync-deals
 *
 * Force-syncs a list of HubSpot deal IDs into Supabase.
 * Useful for re-adding deals that were accidentally deleted or are missing.
 *
 * Body: { deal_ids: string[] }  — max 20 per call
 * Auth: BACKFILL_IMPORT_TOKEN
 */
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { fetchHsDeal, fetchHsContact, upsertCase } from '@/lib/pipelines/hubspot'
import { EVENT_SOURCES } from '@/lib/events'

const IMPORT_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '').trim() !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const dealIds: string[] = (body.deal_ids ?? []).slice(0, 20).map(String)
  if (!dealIds.length) return NextResponse.json({ error: 'No deal_ids provided' }, { status: 400 })

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const results: Record<string, string> = {}

  for (const dealId of dealIds) {
    try {
      const deal = await fetchHsDeal(dealId)
      if (!deal) { results[dealId] = 'not_found_in_hubspot'; continue }
      const contact = await fetchHsContact(dealId)
      const r = await upsertCase(client, deal, contact, {
        emitEvents: true,
        source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
      })
      results[dealId] = r.error ? `error: ${r.error}` : r.isNew ? 'created' : 'upserted'
    } catch (err) {
      results[dealId] = `error: ${(err as Error).message}`
    }
  }

  const created  = Object.values(results).filter(v => v === 'created').length
  const upserted = Object.values(results).filter(v => v === 'upserted').length
  const errors   = Object.values(results).filter(v => v.startsWith('error')).length

  return NextResponse.json({ created, upserted, errors, results })
}
