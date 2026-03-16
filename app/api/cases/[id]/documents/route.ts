import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Resolve case UUID from deal ID or UUID
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id, sharepoint_file_url, sharepoint_drive_item_id, sharepoint_synced_at')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  const caseId = caseRow.id

  // Run all queries in parallel
  const [checklistRes, docTypesRes, filesRes, collectionRes] = await Promise.all([
    // Internal checklist (case_document_checklist)
    db.from('case_document_checklist')
      .select(`
        id, document_type_code, status, is_required,
        requested_at, received_at, approved_at, notes,
        created_at, updated_at
      `)
      .eq('case_id', caseId)
      .eq('is_deleted', false)
      .order('document_type_code'),

    // Document types catalog
    db.from('document_types')
      .select('code, label, description, is_required_default, sort_order')
      .eq('is_active', true)
      .order('sort_order'),

    // Files from SharePoint
    db.from('document_files')
      .select(`
        id, file_name, file_extension, size_bytes, mime_type,
        web_url, document_type_code, checklist_item_id,
        is_classified, classified_at, classification_source,
        created_at_source, modified_at_source, synced_at,
        created_by_name, modified_by_name
      `)
      .eq('case_id', caseId)
      .eq('is_deleted', false)
      .order('created_at_source', { ascending: false }),

    // HubSpot document collection state
    db.from('document_collection_state')
      .select('documents_needed, collection_status, collection_notes, promise_date, synced_from_hubspot_at')
      .eq('case_id', caseId)
      .maybeSingle(),
  ])

  const checklist  = checklistRes.data  ?? []
  const docTypes   = docTypesRes.data   ?? []
  const files      = filesRes.data      ?? []
  const collection = collectionRes.data

  // Build document type lookup
  const typeMap = Object.fromEntries(docTypes.map(t => [t.code, t]))

  // Enrich checklist with type metadata + linked files
  const enrichedChecklist = checklist.map(item => ({
    ...item,
    type:  typeMap[item.document_type_code] ?? null,
    files: files.filter(f => f.checklist_item_id === item.id),
  })).sort((a, b) => (a.type?.sort_order ?? 99) - (b.type?.sort_order ?? 99))

  // Unclassified files (not linked to any checklist item)
  const unclassified = files.filter(f => !f.checklist_item_id)

  const satisfied = (status: string) =>
    ['received', 'under_review', 'approved', 'waived'].includes(status)

  return NextResponse.json({
    checklist: enrichedChecklist,
    unclassified,
    docTypes,
    // HubSpot doc collection state
    collection: collection ?? {
      documents_needed:       [],
      collection_status:      null,
      collection_notes:       null,
      promise_date:           null,
      synced_from_hubspot_at: null,
    },
    // SharePoint folder info
    sharepoint: {
      has_url:     !!caseRow.sharepoint_file_url,
      file_url:    caseRow.sharepoint_file_url,
      synced_at:   caseRow.sharepoint_synced_at,
      file_count:  files.length,
    },
    stats: {
      total:        enrichedChecklist.length,
      required:     enrichedChecklist.filter(i => i.is_required && !satisfied(i.status)).length,
      requested:    enrichedChecklist.filter(i => i.status === 'requested').length,
      received:     enrichedChecklist.filter(i => satisfied(i.status)).length,
      approved:     enrichedChecklist.filter(i => i.status === 'approved').length,
      waived:       enrichedChecklist.filter(i => i.status === 'waived').length,
      unclassified: unclassified.length,
      docs_needed:  (collection?.documents_needed ?? []).length,
    },
  })
}
