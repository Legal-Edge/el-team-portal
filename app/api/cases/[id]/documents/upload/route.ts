// POST /api/cases/[id]/documents/upload
// Uploads a file to SharePoint and syncs to document_files

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'

const DRIVE_ID = 'b!oTYerw9tj0KLIWLLGc_DzIZijDFxI1xNtMSGXezIVsUHL02cd1kmRra7r_dMei8k'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Resolve case
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id, sharepoint_file_url, sharepoint_drive_item_id, client_first_name, client_last_name')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (!caseRow.sharepoint_drive_item_id) {
    return NextResponse.json({ error: 'No SharePoint folder for this case' }, { status: 422 })
  }

  const token    = await getGraphToken()
  const bytes    = await file.arrayBuffer()
  const fileName = file.name

  // Upload to SharePoint via PUT (simple upload for files < 4MB)
  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${caseRow.sharepoint_drive_item_id}:/${encodeURIComponent(fileName)}:/content`,
    {
      method:  'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: bytes,
    }
  )

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    console.error('[upload] SharePoint PUT failed:', uploadRes.status, err)
    return NextResponse.json({ error: `SharePoint upload failed: ${uploadRes.status}` }, { status: 502 })
  }

  const uploaded = await uploadRes.json()

  // Insert into document_files
  await db.from('document_files').upsert({
    case_id:              caseRow.id,
    sharepoint_item_id:   uploaded.id,
    sharepoint_drive_id:  DRIVE_ID,
    file_name:            fileName,
    file_extension:       fileName.split('.').pop()?.toLowerCase() ?? null,
    size_bytes:           file.size,
    mime_type:            file.type || null,
    web_url:              uploaded.webUrl ?? null,
    source:               'portal_upload',
    created_by_name:      session.user?.name ?? session.user?.email ?? 'Staff',
    created_at_source:    new Date().toISOString(),
    modified_at_source:   new Date().toISOString(),
    is_deleted:           false,
    is_classified:        false,
    synced_at:            new Date().toISOString(),
  }, { onConflict: 'sharepoint_item_id' })

  return NextResponse.json({ ok: true, file_name: fileName })
}
