import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

// POST /api/cases/[id]/documents/classify
// Body: { file_id: string, document_type_code: string }
// Links a case_document to its checklist item + marks it classified

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { file_id, document_type_code } = body

  if (!file_id || !document_type_code) {
    return NextResponse.json({ error: 'file_id and document_type_code required' }, { status: 400 })
  }

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

  const now = new Date().toISOString()
  const classifiedBy = session.user.email ?? session.user.name ?? 'unknown'

  // Find or create checklist item for this document type
  let { data: checklistItem } = await db
    .from('case_document_checklist')
    .select('id, status')
    .eq('case_id', caseRow.id)
    .eq('document_type_code', document_type_code)
    .single()

  if (!checklistItem) {
    // Auto-create checklist item if missing (shouldn't happen after init, but safe fallback)
    const { data: newItem } = await db
      .from('case_document_checklist')
      .insert({
        case_id: caseRow.id,
        document_type_code,
        status: 'received',
        is_required: false,
        received_at: now,
        created_by: classifiedBy,
      })
      .select('id, status')
      .single()
    checklistItem = newItem
  } else if (['required', 'requested'].includes(checklistItem.status)) {
    // Advance status to received
    await db
      .from('case_document_checklist')
      .update({ status: 'received', received_at: now, updated_at: now, updated_by: classifiedBy })
      .eq('id', checklistItem.id)
  }

  // Update the file: link to checklist + mark classified
  const { error: fileErr } = await db
    .from('case_documents')
    .update({
      checklist_item_id:    checklistItem!.id,
      document_type_code,
      is_classified:        true,
      classified_by:        classifiedBy,
      classified_at:        now,
      classification_source: 'manual',
      updated_at:           now,
    })
    .eq('id', file_id)
    .eq('case_id', caseRow.id)

  if (fileErr) return NextResponse.json({ error: fileErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, checklist_item_id: checklistItem!.id })
}
