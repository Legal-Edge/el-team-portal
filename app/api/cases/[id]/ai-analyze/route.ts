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

  // Resolve case — select only id to guarantee no missing-column errors
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow, error: caseErr } = await db
    .from('cases')
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (caseErr || !caseRow) {
    console.error('[ai-analyze] case lookup failed', { id, isUUID, error: caseErr?.message, code: caseErr?.code })
    return NextResponse.json({ error: `Case not found (id=${id}, err=${caseErr?.message ?? 'null row'})` }, { status: 404 })
  }

  // Fetch client name + case context for engine
  let clientName: string | null = null
  let caseDetails: Record<string, unknown> = {}
  try {
    const { data: nameRow } = await db.from('cases').select(
      'client_first_name, client_last_name, vehicle_year, vehicle_make, vehicle_model, state_jurisdiction'
    ).eq('id', caseRow.id).single()
    if (nameRow) {
      clientName  = [nameRow.client_first_name, nameRow.client_last_name].filter(Boolean).join(' ') || null
      caseDetails = nameRow as Record<string, unknown>
    }
  } catch { /* ignore */ }

  // Fetch intake data for purchase date, new/used, mileage
  let intakeDetails: Record<string, unknown> = {}
  try {
    const { data: intakeRow } = await db.from('case_state').select(
      'intake_status'
    ).eq('case_id', caseRow.id).single()
    if (intakeRow) intakeDetails = intakeRow as Record<string, unknown>
  } catch { /* ignore */ }

  // Also try to get purchase date from HubSpot fields stored on case
  let purchaseDateFromCase: string | null = null
  let mileageFromCase: number | null = null
  let newUsedFromCase: string | null = null
  let purchaseLeaseFromCase: string | null = null
  try {
    const { data: hsRow } = await db.from('cases').select(
      'purchase_lease_date, current_mileage, new_or_used, purchase_or_lease'
    ).eq('id', caseRow.id).single()
    if (hsRow) {
      purchaseDateFromCase  = (hsRow as Record<string,unknown>).purchase_lease_date as string ?? null
      mileageFromCase       = (hsRow as Record<string,unknown>).current_mileage as number ?? null
      newUsedFromCase       = (hsRow as Record<string,unknown>).new_or_used as string ?? null
      purchaseLeaseFromCase = (hsRow as Record<string,unknown>).purchase_or_lease as string ?? null
    }
  } catch { /* columns may not exist — ignore */ }

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

  // Return cached if recent (< 24 hours) and not forced
  if (cachedAnalysis && cachedAt && !force) {
    const age = Date.now() - new Date(cachedAt).getTime()
    if (age < 24 * 60 * 60 * 1000) {
      // Still load file coverage so we can show pending docs
      const { data: allFiles } = await db
        .from('document_files')
        .select('file_name, ai_extraction')
        .eq('case_id', caseRow.id)
        .eq('is_deleted', false)
      const pendingFiles = (allFiles ?? []).filter(f => f.ai_extraction == null).map(f => f.file_name)
      return NextResponse.json({
        analysis:       cachedAnalysis,
        cached:         true,
        analyzed_at:    cachedAt,
        files_analyzed: (allFiles ?? []).filter(f => f.ai_extraction != null).length,
        files_pending:  pendingFiles,
      })
    }
  }

  // Load ALL documents for this case (extracted + pending)
  const { data: allFiles } = await db
    .from('document_files')
    .select('id, file_name, document_type_code, ai_extraction, ai_extracted_at')
    .eq('case_id', caseRow.id)
    .eq('is_deleted', false)
    .order('created_at_source', { ascending: true })

  const files         = (allFiles ?? []).filter(f => f.ai_extraction != null)
  const pendingFiles  = (allFiles ?? []).filter(f => f.ai_extraction == null)

  if (files.length === 0) {
    return NextResponse.json({
      error: 'No extracted documents yet. Open each PDF first (Gemini extracts automatically), then analyze.',
      files_total:    (allFiles ?? []).length,
      files_analyzed: 0,
      files_pending:  pendingFiles.map(f => f.file_name),
    }, { status: 422 })
  }

  // ── Build case context: documents are primary source of truth ────────────
  // Priority order: extracted documents > HubSpot case fields
  const ros     = files.filter(f => f.document_type_code === 'repair_order')
  const purchase = files.find(f => ['purchase_agreement','lease_agreement'].includes(f.document_type_code ?? ''))
  const reg      = files.find(f => f.document_type_code === 'vehicle_registration')

  const purchaseEx = purchase?.ai_extraction as Record<string, unknown> | null ?? null
  const regEx      = reg?.ai_extraction     as Record<string, unknown> | null ?? null

  // Vehicle identity — purchase agreement > registration > RO > HubSpot
  const roEx = ros[0]?.ai_extraction as Record<string, unknown> | null ?? null
  const yearFromDoc  = (purchaseEx?.vehicle_year  ?? regEx?.vehicle_year  ?? roEx?.vehicle_year)  as number | null ?? null
  const makeFromDoc  = (purchaseEx?.vehicle_make  ?? regEx?.vehicle_make  ?? roEx?.vehicle_make)  as string | null ?? null
  const modelFromDoc = (purchaseEx?.vehicle_model ?? regEx?.vehicle_model ?? roEx?.vehicle_model) as string | null ?? null

  const resolvedYear  = yearFromDoc  || (caseDetails.vehicle_year  as number | null) || null
  const resolvedMake  = makeFromDoc  || (caseDetails.vehicle_make  as string | null) || null
  const resolvedModel = modelFromDoc || (caseDetails.vehicle_model as string | null) || null
  const vehicleStr    = [resolvedYear, resolvedMake, resolvedModel].filter(Boolean).join(' ') || null

  // Purchase date — purchase agreement extraction > HubSpot field
  const purchaseDateFromDoc = purchaseEx?.purchase_date as string | null ?? null
  const resolvedPurchaseDate = purchaseDateFromDoc || purchaseDateFromCase || null

  // State — registration > HubSpot
  const stateFromReg = regEx?.registered_state as string | null ?? null
  const resolvedState = stateFromReg || (caseDetails.state_jurisdiction as string | null) || null

  // New/used + purchase/lease — purchase agreement > HubSpot
  const newUsedFromDoc      = purchaseEx?.new_or_used      as string | null ?? null
  const purchaseLeaseFromDoc = purchaseEx?.purchase_or_lease as string | null ?? null
  const resolvedNewUsed      = newUsedFromDoc      || newUsedFromCase      || null
  const resolvedPurchaseLease = purchaseLeaseFromDoc || purchaseLeaseFromCase || null

  // Mileage — latest RO mileage_in > HubSpot current_mileage
  const roMileages = ros
    .map(r => (r.ai_extraction as Record<string, unknown> | null)?.mileage_in as number | null ?? null)
    .filter((m): m is number => typeof m === 'number' && m > 0)
  const latestRoMileage = roMileages.length > 0 ? Math.max(...roMileages) : null
  const resolvedMileage = latestRoMileage || mileageFromCase || null

  const caseContext = {
    client_name:       clientName,
    vehicle:           vehicleStr,
    state:             resolvedState,
    purchase_date:     resolvedPurchaseDate,
    vehicle_year:      resolvedYear,
    vehicle_make:      resolvedMake,
    new_or_used:       resolvedNewUsed,
    purchase_lease:    resolvedPurchaseLease,
    mileage_at_intake: resolvedMileage,
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

  const analyzedAt = new Date().toISOString()

  // Cache on case
  const { error: updateErr } = await db.from('cases').update({
    ai_analysis:       analysis,
    ai_analyzed_at:    analyzedAt,
    ai_analyzed_model: model,
  }).eq('id', caseRow.id)

  if (updateErr) console.error('[ai-analyze] cache write failed', updateErr.message)

  return NextResponse.json({
    analysis,
    cached:         false,
    analyzed_at:    analyzedAt,
    files_analyzed: files.length,
    files_pending:  pendingFiles.map(f => f.file_name),
  })
}
