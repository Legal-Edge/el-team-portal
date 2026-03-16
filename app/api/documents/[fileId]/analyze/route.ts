// POST /api/documents/[fileId]/analyze
//
// Fetches the PDF from SharePoint, sends to Claude for lemon law analysis,
// stores result in document_files.ai_summary, returns the summary.
//
// Idempotent — returns cached result if already analyzed and file unchanged.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'
import { analyzeDocument } from '@/lib/document-pipeline/ai-analyze'

const DRIVE_ID = 'b!oTYerw9tj0KLIWLLGc_DzIZijDFxI1xNtMSGXezIVsUHL02cd1kmRra7r_dMei8k'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fileId } = await params
  const { force = false } = await req.json().catch(() => ({}))

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Load file + case context in parallel
  const { data: file } = await db
    .from('document_files')
    .select(`
      id, sharepoint_item_id, sharepoint_drive_id,
      file_name, document_type_code,
      ai_summary, ai_analyzed_at,
      case_id
    `)
    .eq('id', fileId)
    .eq('is_deleted', false)
    .single()

  if (!file?.sharepoint_item_id) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Return cached result unless forced
  if (file.ai_summary && !force) {
    return NextResponse.json({ summary: file.ai_summary, cached: true })
  }

  // Load case context for the prompt
  const { data: caseRow } = await db
    .from('cases')
    .select('client_name, vehicle_year, vehicle_make, vehicle_model, state')
    .eq('id', file.case_id)
    .single()

  const caseContext = {
    client_name: caseRow?.client_name ?? null,
    vehicle: [caseRow?.vehicle_year, caseRow?.vehicle_make, caseRow?.vehicle_model]
      .filter(Boolean).join(' ') || null,
    state: caseRow?.state ?? null,
  }

  // Fetch PDF bytes from SharePoint
  const driveId = file.sharepoint_drive_id ?? DRIVE_ID
  const token   = await getGraphToken()
  const pdfRes  = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${file.sharepoint_item_id}/content`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' }
  )
  if (!pdfRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch PDF' }, { status: 502 })
  }
  const pdfBytes = await pdfRes.arrayBuffer()

  // Run AI analysis
  const { summary, model } = await analyzeDocument(pdfBytes, file.document_type_code, caseContext)

  // Store result
  await db.from('document_files').update({
    ai_summary:     summary,
    ai_analyzed_at: new Date().toISOString(),
    ai_model:       model,
    updated_at:     new Date().toISOString(),
  }).eq('id', fileId)

  return NextResponse.json({ summary, cached: false })
}
