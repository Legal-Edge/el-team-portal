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
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const caseId = caseRow.id

  // Checklist with document type details
  const { data: checklist } = await db
    .from('case_document_checklist')
    .select(`
      id, document_type_code, status, is_required,
      requested_at, received_at, approved_at, notes,
      created_at, updated_at
    `)
    .eq('case_id', caseId)
    .eq('is_deleted', false)
    .order('document_type_code')

  // Document types catalog
  const { data: docTypes } = await db
    .from('document_types')
    .select('code, label, description, is_required_default, sort_order')
    .eq('is_active', true)
    .order('sort_order')

  // Actual files from SharePoint sync
  const { data: files } = await db
    .from('document_files')
    .select(`
      id, name, file_extension, size_bytes, mime_type,
      web_url, document_type_code, checklist_item_id,
      is_classified, classified_by, classified_at, classification_source,
      created_at_source, modified_at_source, created_by, synced_at
    `)
    .eq('case_id', caseId)
    .eq('is_deleted', false)
    .order('created_at_source', { ascending: false })

  // Build document type lookup
  const typeMap = Object.fromEntries((docTypes ?? []).map(t => [t.code, t]))

  // Enrich checklist with type metadata + linked files
  const enrichedChecklist = (checklist ?? []).map(item => ({
    ...item,
    type: typeMap[item.document_type_code] ?? null,
    files: (files ?? []).filter(f => f.checklist_item_id === item.id),
  })).sort((a, b) => (a.type?.sort_order ?? 99) - (b.type?.sort_order ?? 99))

  // Unclassified files (not linked to any checklist item)
  const unclassified = (files ?? []).filter(f => !f.checklist_item_id)

  const satisfied = (status: string) =>
    ['received', 'under_review', 'approved', 'waived'].includes(status)

  return NextResponse.json({
    checklist: enrichedChecklist,
    unclassified,
    docTypes: docTypes ?? [],
    stats: {
      total:        enrichedChecklist.length,
      // missing = is_required=true AND not yet satisfied — matches UI alarm logic
      required:     enrichedChecklist.filter(i => i.is_required && !satisfied(i.status)).length,
      requested:    enrichedChecklist.filter(i => i.status === 'requested').length,
      received:     enrichedChecklist.filter(i => satisfied(i.status)).length,
      approved:     enrichedChecklist.filter(i => i.status === 'approved').length,
      waived:       enrichedChecklist.filter(i => i.status === 'waived').length,
      unclassified: unclassified.length,
    },
  })
}
