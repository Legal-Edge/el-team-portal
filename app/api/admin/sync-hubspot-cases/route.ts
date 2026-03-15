/**
 * POST /api/admin/sync-hubspot-cases
 *
 * HubSpot → core.cases bulk sync. Processes one page of deals per call.
 * Runner script pages through using the returned next_after cursor.
 *
 * Protected by BACKFILL_IMPORT_TOKEN (Bearer auth).
 * Does NOT emit events (bulk import — use delta sync for change events).
 *
 * Body: { after?, limit?, dryRun?, modifiedSince? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import {
  buildCaseRow,
  fetchHsContact,
  fetchPageOfDeals,
  fetchDeltaDeals,
  upsertContact,
} from '@/lib/pipelines/hubspot'

const IMPORT_TOKEN = process.env.BACKFILL_IMPORT_TOKEN
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  if (!IMPORT_TOKEN) return NextResponse.json({ error: 'BACKFILL_IMPORT_TOKEN not configured' }, { status: 500 })

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (token !== IMPORT_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { after?: string; limit?: number; dryRun?: boolean; modifiedSince?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const after         = body.after         ?? null
  const limit         = Math.min(body.limit ?? 50, 100)
  const dryRun        = body.dryRun        ?? false
  const modifiedSince = body.modifiedSince ?? null

  const client = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb = client.schema('core')

  const errors: string[] = []
  let casesSynced = 0, casesErrors = 0
  let contactsOk = 0, contactsNoPhone = 0, contactsNoContact = 0, contactsErrors = 0

  // Fetch one page of deals
  let deals: Record<string, unknown>[], nextAfter: string | null, deltaTotal: number | null = null
  try {
    if (modifiedSince) {
      const result  = await fetchDeltaDeals(modifiedSince, after, limit)
      deals         = result.deals
      nextAfter     = result.nextAfter
      deltaTotal    = result.total
    } else {
      ({ deals, nextAfter } = await fetchPageOfDeals(after, limit))
    }
  } catch (e) {
    return NextResponse.json({ error: `HubSpot fetch: ${(e as Error).message}` }, { status: 500 })
  }

  for (const deal of deals) {
    const dealId  = String((deal as { id: string }).id)
    const contact = await fetchHsContact(dealId)
    const caseRow = buildCaseRow(deal, contact)

    if (dryRun) {
      casesSynced++
      contact ? contactsOk++ : contactsNoContact++
      continue
    }

    // Upsert case
    const { data: upserted, error: caseErr } = await coreDb
      .from('cases')
      .upsert(caseRow, { onConflict: 'hubspot_deal_id', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()

    if (caseErr) {
      errors.push(`[${dealId}] ${caseErr.message}`)
      casesErrors++
      continue
    }

    casesSynced++

    // Resolve case ID
    let caseId = upserted?.id ?? null
    if (!caseId) {
      const { data: ex } = await coreDb.from('cases').select('id').eq('hubspot_deal_id', dealId).maybeSingle()
      caseId = ex?.id ?? null
    }
    if (!caseId) { errors.push(`[${dealId}] id lookup failed`); contactsErrors++; continue }

    // Upsert contact
    const cr = await upsertContact(client, caseId, contact)
    if (cr.ok)          contactsOk++
    else if (cr.noPhone)   contactsNoPhone++
    else if (cr.noContact) contactsNoContact++
    else { errors.push(`[${dealId}] contact: ${cr.error}`); contactsErrors++ }
  }

  return NextResponse.json({
    dry_run:             dryRun,
    mode:                modifiedSince ? 'delta' : 'full',
    modified_since:      modifiedSince ?? undefined,
    delta_total:         deltaTotal    ?? undefined,
    page_size:           deals.length,
    cases_synced:        casesSynced,
    cases_errors:        casesErrors,
    contacts_ok:         contactsOk,
    contacts_no_phone:   contactsNoPhone,
    contacts_no_contact: contactsNoContact,
    contacts_errors:     contactsErrors,
    has_more:            nextAfter !== null,
    next_after:          nextAfter,
    errors,
  })
}
