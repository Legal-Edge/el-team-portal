/**
 * POST /api/admin/backfill/engagements?deal_id=XXXX
 *
 * Full case backfill:
 *   1. Sync all HubSpot engagements (timeline)
 *   2. Sync all SharePoint documents into core.document_files
 *   3. Extract text from all unextracted PDFs
 *
 * Auth: BACKFILL_IMPORT_TOKEN Bearer header
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin }             from '@/lib/supabase'
import { syncEngagements }           from '@/lib/hubspot/sync-engagements'
import { syncCaseFiles }             from '@/lib/pipelines/sharepoint-sync'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN ?? ''
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dealId = new URL(req.url).searchParams.get('deal_id')
  if (!dealId) return NextResponse.json({ error: 'deal_id param required' }, { status: 400 })

  // Resolve case
  const { data: caseRow, error: caseErr } = await supabaseAdmin
    .schema('core').from('cases')
    .select('id, hubspot_deal_id, sharepoint_drive_item_id')
    .eq('hubspot_deal_id', dealId)
    .maybeSingle()

  if (caseErr || !caseRow) {
    return NextResponse.json({ error: `Case not found for deal ${dealId}` }, { status: 404 })
  }

  const results: Record<string, unknown> = { deal_id: dealId, case_id: caseRow.id }

  // ── Step 1: Sync HubSpot engagements (timeline) ──────────────────────────
  console.log(`[backfill] step 1 — engagements for deal ${dealId}`)
  const t1 = Date.now()
  try {
    const eng = await syncEngagements(supabaseAdmin, caseRow.id, dealId)
    results.engagements = { ok: eng.errors.length === 0, upserted: eng.upserted, contacts: eng.contacts, errors: eng.errors, ms: Date.now() - t1 }
  } catch (e) {
    results.engagements = { ok: false, error: String(e), ms: Date.now() - t1 }
  }

  // ── Step 2: Sync SharePoint documents ────────────────────────────────────
  console.log(`[backfill] step 2 — sharepoint docs for deal ${dealId}`)
  const t2 = Date.now()
  try {
    const driveItemId = caseRow.sharepoint_drive_item_id as string | null
    if (driveItemId) {
      const syncResult = await syncCaseFiles(supabaseAdmin, caseRow.id, driveItemId)
      results.documents = {
        ok:         syncResult.errors === 0,
        filesFound: syncResult.filesFound,
        inserted:   syncResult.inserted,
        updated:    syncResult.updated,
        skipped:    syncResult.skipped,
        errors:     syncResult.errorMessages,
        ms:         Date.now() - t2,
      }
    } else {
      results.documents = { ok: false, error: 'No SharePoint folder linked to this case yet. Open the case in the portal to link it first.', ms: Date.now() - t2 }
    }
  } catch (e) {
    results.documents = { ok: false, error: String(e), ms: Date.now() - t2 }
  }

  // ── Step 3: Extract text from unextracted documents ──────────────────────
  console.log(`[backfill] step 3 — text extraction for deal ${dealId}`)
  const t3 = Date.now()
  try {
    const baseUrl = new URL(req.url).origin
    const extractRes = await fetch(`${baseUrl}/api/cases/${caseRow.id}/documents/bulk-extract`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ force: false }),
    })
    const extractData = await extractRes.json().catch(() => ({}))
    results.extraction = { ok: extractRes.ok, ...extractData, ms: Date.now() - t3 }
  } catch (e) {
    results.extraction = { ok: false, error: String(e), ms: Date.now() - t3 }
  }

  console.log(`[backfill] complete for deal ${dealId}`, JSON.stringify(results))
  return NextResponse.json({ ok: true, ...results })
}
