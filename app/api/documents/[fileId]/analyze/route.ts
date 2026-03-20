// POST /api/documents/[fileId]/analyze
//
// Stage 1: Gemini 2.5 Flash extraction for a single document.
// Fetches PDF from SharePoint, runs gemini-2.5-flash, caches in ai_extraction.
// Returns cached result on repeat calls.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

export const maxDuration = 120
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'
import { extractDocument } from '@/lib/document-pipeline/ai-analyze'
import { calculateSOL } from '@/lib/lemon-law/sol'

const DRIVE_ID = 'b!oTYerw9tj0KLIWLLGc_DzIZijDFxI1xNtMSGXezIVsUHL02cd1kmRra7r_dMei8k'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fileId } = await params
  const { force = false, cached_only = false } = await req.json().catch(() => ({}))

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const { data: file } = await db
    .from('document_files')
    .select('id, sharepoint_item_id, sharepoint_drive_id, file_name, document_type_code, ai_extraction, ai_extracted_at, case_id')
    .eq('id', fileId)
    .eq('is_deleted', false)
    .single()

  if (!file?.sharepoint_item_id) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Return cached extraction if available
  if (file.ai_extraction && !force) {
    return NextResponse.json({ extraction: file.ai_extraction, cached: true, extracted_at: file.ai_extracted_at })
  }

  // cached_only = just checking for existing extraction, don't run Gemini
  if (cached_only) {
    return NextResponse.json({ extraction: null, cached: false, extracted_at: null })
  }

  // Fetch PDF from SharePoint
  const driveId = file.sharepoint_drive_id ?? DRIVE_ID
  const token   = await getGraphToken()
  const pdfRes  = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${file.sharepoint_item_id}/content`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' }
  )
  if (!pdfRes.ok) {
    return NextResponse.json({ error: `SharePoint fetch failed: ${pdfRes.status}` }, { status: 502 })
  }
  const pdfBytes = await pdfRes.arrayBuffer()

  // Run Gemini extraction
  const { extraction, model } = await extractDocument(pdfBytes, file.document_type_code)

  const extractedAt = new Date().toISOString()
  await db.from('document_files').update({
    ai_extraction:       extraction,
    ai_extracted_at:     extractedAt,
    ai_extraction_model: model,
    updated_at:          extractedAt,
  }).eq('id', fileId)

  // ── Auto-recalculate SOL if purchase_date extracted ───────────────────────
  // If this document has a purchase_date, update the case's ai_analysis SOL fields
  const extractedPurchaseDate = typeof extraction.purchase_date === 'string' ? extraction.purchase_date : null
  if (extractedPurchaseDate && file.case_id) {
    try {
      // Fetch case context for SOL calculation
      const { data: caseRow } = await db
        .from('cases')
        .select('ai_analysis, vehicle_year, state, current_mileage')
        .eq('id', file.case_id)
        .single()

      if (caseRow?.ai_analysis) {
        const sol = calculateSOL({
          purchase_date:   extractedPurchaseDate,
          vehicle_year:    caseRow.vehicle_year,
          state:           caseRow.state,
          current_mileage: caseRow.current_mileage,
        })
        await db.from('cases').update({
          ai_analysis: { ...(caseRow.ai_analysis as object), sol },
          updated_at:  new Date().toISOString(),
        }).eq('id', file.case_id)
        console.log(`[sol] Auto-updated SOL for case ${file.case_id} — basis: ${sol.basis}`)
      }
    } catch (e) {
      console.warn('[sol] Auto-update failed (non-critical):', e)
    }
  }

  return NextResponse.json({ extraction, cached: false, extracted_at: extractedAt })
}
