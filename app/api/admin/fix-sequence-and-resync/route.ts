/**
 * POST /api/admin/fix-sequence-and-resync
 *
 * One-shot recovery:
 *   1. Advance case_number_seq past current max (+ 1000 buffer)
 *   2. Resync all deal IDs passed in body
 *
 * This is the manual escape hatch when sequence exhaustion prevents new deal inserts.
 * Once migrate-team-v16-resilience.sql is applied, upsertCase handles this automatically.
 *
 * Body: { deal_ids: string[] }
 * Auth: BACKFILL_IMPORT_TOKEN
 */
export const maxDuration = 60

import { NextRequest, NextResponse }                        from 'next/server'
import { createClient }                                     from '@supabase/supabase-js'
import { fetchHsDeal, fetchHsContact, upsertCase }         from '@/lib/pipelines/hubspot'
import { EVENT_SOURCES }                                    from '@/lib/events'

const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '').trim() !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body    = await req.json().catch(() => ({}))
  const dealIds = (body.deal_ids ?? []).map(String) as string[]
  if (!dealIds.length) return NextResponse.json({ error: 'No deal_ids provided' }, { status: 400 })
  if (dealIds.length > 10) return NextResponse.json({ error: 'Max 10 deal_ids per call' }, { status: 400 })

  const client = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb = client.schema('core')

  // ── Step 1: Advance the sequence ──────────────────────────────────────────
  // Read current max case_number and advance past it with +1000 buffer
  const { data: seqData, error: seqErr } = await coreDb
    .from('cases')
    .select('case_number')
    .not('case_number', 'is', null)
    .order('case_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let seqAdvanced = false
  let newSeqVal   = 0

  if (!seqErr && seqData?.case_number) {
    const parts   = String(seqData.case_number).split('-')
    const maxNNNN = parseInt(parts[2] ?? '0', 10)
    newSeqVal     = maxNNNN + 1000

    // Use the RPC if available, otherwise try raw setval via postgres fn
    try {
      const { error: rpcErr } = await coreDb.rpc('advance_case_number_seq' as never)
      seqAdvanced = !rpcErr
    } catch { /* RPC not yet deployed */ }

    if (!seqAdvanced) {
      // Fallback: insert a dummy case to force-set the sequence via a workaround
      // Actually just log it — without raw SQL access we can't call setval directly
      console.warn(`[fix-sequence] advance_case_number_seq RPC not available. Max is ${maxNNNN}. Run migration v16 to fix permanently.`)
    }
  }

  // ── Step 2: Resync the provided deal IDs ─────────────────────────────────
  const results: Record<string, string> = {}
  let created = 0, upserted = 0, errors = 0

  for (const dealId of dealIds) {
    try {
      const deal = await fetchHsDeal(dealId)
      if (!deal) { results[dealId] = 'not_found_in_hubspot'; continue }

      const contact = await fetchHsContact(dealId)
      const result  = await upsertCase(client, deal, contact, {
        emitEvents: true,
        source:     EVENT_SOURCES.HUBSPOT_WEBHOOK,
      })

      if (result.error) {
        results[dealId] = `error: ${result.error}`
        errors++
      } else if (result.isNew) {
        results[dealId] = 'created'
        created++
      } else {
        results[dealId] = 'upserted'
        upserted++
      }
    } catch (err) {
      results[dealId] = `error: ${(err as Error).message}`
      errors++
    }
  }

  return NextResponse.json({
    seq_advanced:   seqAdvanced,
    seq_new_val:    newSeqVal,
    seq_rpc_note:   seqAdvanced ? null : 'advance_case_number_seq RPC not found — run migrate-team-v16-resilience.sql in Supabase',
    created,
    upserted,
    errors,
    results,
  })
}
