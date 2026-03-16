// POST /api/cases/[id]/ai-analyze
//
// Stage 2: Sonnet case-level analysis.
// Reads all ai_extraction records for the case, passes to claude-sonnet,
// stores case-level findings in core.cases.ai_analysis.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { analyzeCaseDocuments } from '@/lib/document-pipeline/ai-analyze'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { force = false } = await req.json().catch(() => ({}))

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Resolve case — select only columns guaranteed to exist
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow, error: caseErr } = await db
    .from('cases')
    .select('id, client_first_name, client_last_name, stage')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (caseErr || !caseRow) {
    console.error('[ai-analyze] case lookup failed', { id, error: caseErr?.message })
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const clientName = [caseRow.client_first_name, caseRow.client_last_name].filter(Boolean).join(' ') || null

  // Try to read cached AI analysis (columns may not exist yet if migration pending)
  let cachedAnalysis: Record<string, unknown> | null = null
  let cachedAt: string | null = null
  try {
    const { data: aiRow } = await db
      .from('cases')
      .select('ai_analysis, ai_analyzed_at')
      .eq('id', caseRow.id)
      .single()
    cachedAnalysis = (aiRow as Record<string, unknown> | null)?.ai_analysis as Record<string, unknown> ?? null
    cachedAt       = (aiRow as Record<string, unknown> | null)?.ai_analyzed_at as string ?? null
  } catch { /* migration not yet run — columns don't exist, skip cache */ }

  // Return cached if recent (< 1 hour) and not forced
  if (cachedAnalysis && cachedAt && !force) {
    const age = Date.now() - new Date(cachedAt).getTime()
    if (age < 60 * 60 * 1000) {
      return NextResponse.json({ analysis: cachedAnalysis, cached: true })
    }
  }

  // Load all extracted documents for this case
  const { data: files } = await db
    .from('document_files')
    .select('file_name, document_type_code, ai_extraction')
    .eq('case_id', caseRow.id)
    .eq('is_deleted', false)
    .not('ai_extraction', 'is', null)
    .order('created_at_source', { ascending: true })

  if (!files || files.length === 0) {
    return NextResponse.json({
      error: 'No extracted documents found. Open each document first to extract, then analyze.',
    }, { status: 422 })
  }

  // Build case context from case + RO extractions
  const ros = files.filter(f => f.document_type_code === 'repair_order')
  const purchase = files.find(f => ['purchase_agreement','lease_agreement'].includes(f.document_type_code ?? ''))

  const vehicleFromPurchase = purchase?.ai_extraction
    ? [
        (purchase.ai_extraction as Record<string, unknown>).vehicle_year,
        (purchase.ai_extraction as Record<string, unknown>).vehicle_make,
        (purchase.ai_extraction as Record<string, unknown>).vehicle_model,
      ].filter(Boolean).join(' ')
    : null

  // Try to infer state from registration
  const reg = files.find(f => f.document_type_code === 'vehicle_registration')
  const stateFromReg = reg?.ai_extraction
    ? (reg.ai_extraction as Record<string, unknown>).registered_state as string ?? null
    : null

  const caseContext = {
    client_name: clientName,
    vehicle:     vehicleFromPurchase || null,
    state:       stateFromReg || null,
  }

  // Run Sonnet analysis
  const { analysis, model } = await analyzeCaseDocuments(
    files.map(f => ({
      file_name:          f.file_name,
      document_type_code: f.document_type_code,
      ai_extraction:      (f.ai_extraction as Record<string, unknown>) ?? {},
    })),
    caseContext,
  )

  // Cache on case (best-effort — columns may not exist if migration pending)
  try {
    await db.from('cases').update({
      ai_analysis:       analysis,
      ai_analyzed_at:    new Date().toISOString(),
      ai_analyzed_model: model,
    }).eq('id', caseRow.id)
  } catch { /* migration not yet run — cache skipped */ }

  return NextResponse.json({ analysis, cached: false })
}
