// POST /api/cases/[id]/documents/bulk-extract
//
// Bulk Stage-1 Haiku extraction for all unextracted PDFs in a case,
// optionally filtered to specific document type codes.
//
// Body: { types?: string[], force?: boolean }
//   types — if provided, only extract docs matching those type codes
//   force — re-extract even if already extracted
//
// Runs up to 3 Haiku calls in parallel to balance speed vs. API limits.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'
import { extractDocument } from '@/lib/document-pipeline/ai-analyze'

const DRIVE_ID = 'b!oTYerw9tj0KLIWLLGc_DzIZijDFxI1xNtMSGXezIVsUHL02cd1kmRra7r_dMei8k'
const CONCURRENCY = 3

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { types, force = false } = await req.json().catch(() => ({}))

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Resolve case
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  // Load all PDFs for this case
  let query = db
    .from('document_files')
    .select('id, file_name, document_type_code, sharepoint_item_id, sharepoint_drive_id, ai_extraction')
    .eq('case_id', caseRow.id)
    .eq('is_deleted', false)
    .not('sharepoint_item_id', 'is', null)
    // Only PDFs (extension check done below)

  const { data: allFiles } = await query

  const isPdf = (name: string) =>
    name.toLowerCase().endsWith('.pdf') || name.toLowerCase().endsWith('.PDF')

  let targets = (allFiles ?? []).filter(f => isPdf(f.file_name))

  // Filter by type if requested
  if (Array.isArray(types) && types.length > 0) {
    targets = targets.filter(f => types.includes(f.document_type_code ?? ''))
  }

  // Skip already extracted unless force=true
  if (!force) {
    targets = targets.filter(f => !f.ai_extraction)
  }

  if (targets.length === 0) {
    return NextResponse.json({ extracted: 0, skipped: 0, errors: 0, total: 0 })
  }

  // Get SharePoint token once for all calls
  const token = await getGraphToken()
  const now   = new Date().toISOString()

  const results = { extracted: 0, skipped: 0, errors: 0, total: targets.length }
  const errorDetails: Array<{ file: string; error: string }> = []

  // Process in batches of CONCURRENCY
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY)

    await Promise.all(batch.map(async (file) => {
      try {
        const driveId = file.sharepoint_drive_id ?? DRIVE_ID
        const pdfRes  = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${file.sharepoint_item_id}/content`,
          { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' }
        )

        if (!pdfRes.ok) {
          results.errors++
          errorDetails.push({ file: file.file_name, error: `SharePoint ${pdfRes.status}` })
          return
        }

        const pdfBytes = await pdfRes.arrayBuffer()
        const { extraction, model } = await extractDocument(pdfBytes, file.document_type_code)

        await db.from('document_files').update({
          ai_extraction:       extraction,
          ai_extracted_at:     now,
          ai_extraction_model: model,
          updated_at:          now,
        }).eq('id', file.id)

        results.extracted++
      } catch (err) {
        results.errors++
        errorDetails.push({ file: file.file_name, error: String(err) })
      }
    }))
  }

  return NextResponse.json({ ...results, errors_detail: errorDetails })
}
