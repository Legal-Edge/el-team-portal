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

  const [filesRes, docTypesRes, collectionRes] = await Promise.all([
    db.from('document_files')
      .select(`
        id, file_name, file_extension, size_bytes, mime_type,
        web_url, document_type_code, is_classified, classification_source,
        classified_at, created_at_source, modified_at_source, synced_at,
        created_by_name, modified_by_name
      `)
      .eq('case_id', caseId)
      .eq('is_deleted', false)
      .order('created_at_source', { ascending: false }),

    db.from('document_types')
      .select('code, label')
      .eq('is_active', true),

    db.from('document_collection_state')
      .select('documents_needed, collection_status, collection_notes, promise_date, synced_from_hubspot_at')
      .eq('case_id', caseId)
      .maybeSingle(),
  ])

  const files      = filesRes.data      ?? []
  const docTypes   = docTypesRes.data   ?? []
  const collection = collectionRes.data

  // Build type label lookup
  const typeLabels = Object.fromEntries(docTypes.map(t => [t.code, t.label]))

  // Enrich files with type label
  const enrichedFiles = files.map(f => ({
    ...f,
    type_label: f.document_type_code ? (typeLabels[f.document_type_code] ?? f.document_type_code) : null,
  }))

  return NextResponse.json({
    files: enrichedFiles,
    docTypes,
    collection: collection ?? {
      documents_needed:       [],
      collection_status:      null,
      collection_notes:       null,
      promise_date:           null,
      synced_from_hubspot_at: null,
    },
    sharepoint: {
      has_url:    !!caseRow.sharepoint_file_url,
      file_url:   caseRow.sharepoint_file_url,
      synced_at:  caseRow.sharepoint_synced_at,
      file_count: files.length,
    },
  })
}
