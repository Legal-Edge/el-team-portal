import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

export interface DocumentQueueRow {
  doc_id:               string
  case_id:              string
  case_number:          string | null
  case_status:          string
  hubspot_deal_id:      string
  assigned_attorney:    string | null
  attorney_name:        string | null
  client_full_name:     string | null
  client_phone:         string | null
  file_name:            string
  file_extension:       string | null
  source:               string
  web_url:              string | null
  size_bytes:           number | null
  document_type_code:   string | null
  created_at_source:    string | null
  synced_at:            string
  created_at:           string
  is_classified:        boolean
  classification_source: string | null
  classified_at:        string | null
  classified_by_name:   string | null
  is_reviewed:          boolean
  review_notes:         string | null
  reviewed_at:          string | null
  reviewed_by_name:     string | null
  checklist_status:     string | null
  review_sort:          number
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const docType    = searchParams.get('doc_type')     ?? ''
  const classified = searchParams.get('classified')   ?? ''  // 'yes' | 'no' | ''
  const reviewed   = searchParams.get('reviewed')     ?? ''  // 'yes' | 'no' | ''
  const stage      = searchParams.get('stage')        ?? ''
  const attorney   = searchParams.get('attorney')     ?? ''
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const page       = Math.max(parseInt(searchParams.get('page')  ?? '1'), 1)
  const offset     = (page - 1) * limit

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  let query = db
    .from('documents_queue')
    .select('*', { count: 'exact' })

  // ── Filters ────────────────────────────────────────────────
  if (docType)            query = query.eq('document_type_code', docType)
  if (classified === 'yes') query = query.eq('is_classified', true)
  if (classified === 'no')  query = query.eq('is_classified', false)
  if (reviewed === 'yes')   query = query.eq('is_reviewed', true)
  if (reviewed === 'no')    query = query.eq('is_reviewed', false)
  if (stage)              query = query.eq('case_status', stage)
  if (attorney)           query = query.eq('assigned_attorney', attorney)

  // ── Sort: needs-action first, then by date ──────────────────
  query = query
    .order('review_sort',    { ascending: true })
    .order('created_at',     { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('[documents-queue] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    rows:  data ?? [],
    total: count ?? 0,
    page,
    limit,
  })
}

// PATCH — update classification or review status on a document
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { doc_id, action, review_notes, document_type_code } = body

  if (!doc_id || !action) {
    return NextResponse.json({ error: 'doc_id and action required' }, { status: 400 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const staffId = (session.user as { staffId?: string }).staffId ?? null

  let update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  // All classification + review state writes go to document_review_state (not document_files).
  // document_files is the immutable file identity record per the architecture rule.
  if (action === 'classify') {
    update = {
      ...update,
      is_classified:         true,
      classification_source: 'manual',
      classified_at:         new Date().toISOString(),
      classified_by:         staffId,
      ...(document_type_code ? { document_type_code } : {}),
    }
  } else if (action === 'approve') {
    update = {
      ...update,
      is_reviewed:  true,
      reviewed_by:  staffId,
      reviewed_at:  new Date().toISOString(),
      review_notes: review_notes ?? null,
    }
  } else if (action === 'reject') {
    update = {
      ...update,
      is_reviewed:  true,
      reviewed_by:  staffId,
      reviewed_at:  new Date().toISOString(),
      review_notes: review_notes ?? null,
    }
  } else {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  // Write to document_review_state (operational state table)
  const { error } = await db
    .from('document_review_state')
    .upsert({ doc_id, ...update }, { onConflict: 'doc_id' })

  if (error) {
    console.error('[documents-queue] PATCH error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
