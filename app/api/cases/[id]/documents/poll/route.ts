// GET /api/cases/[id]/documents/poll?since=<ISO timestamp>
//
// Lightweight polling endpoint for the Documents tab live-update layer.
// Returns only files created or modified AFTER `since`, plus the current
// server timestamp for the next poll's `since` value.
//
// Design principles:
// - Only hits document_files; no SharePoint API calls
// - Merge by `id` in the client → no duplicate inserts possible
// - Works even when Supabase Realtime / SSE is slow or disconnected
// - Called every 25s from DocumentsSection; 0 rows returned = no UI update

import { NextRequest, NextResponse } from 'next/server'
import { auth }                       from '@/auth'
import { createClient }               from '@supabase/supabase-js'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id }   = await params
  const since    = req.nextUrl.searchParams.get('since')
  const serverTime = new Date().toISOString()

  // `since` is required — without it we'd return all files on every poll
  if (!since) {
    return NextResponse.json({ error: '`since` param required' }, { status: 400 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).schema('core')

  // Resolve case UUID from hubspot_deal_id or UUID
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  // Fetch files modified or created after `since` (covers insert + update + undelete)
  // Also return recently un-deleted files (is_deleted toggled) by checking synced_at
  const { data: files, error } = await db
    .from('document_files')
    .select(`
      id, file_name, file_extension, size_bytes, mime_type,
      web_url, document_type_code, is_classified, classification_source,
      classified_at, created_at_source, modified_at_source, synced_at,
      created_by_name, modified_by_name,
      ai_extraction, ai_extracted_at,
      is_deleted
    `)
    .eq('case_id', caseRow.id)
    .or(`synced_at.gt.${since},created_at_source.gt.${since}`)
    .order('created_at_source', { ascending: false })

  if (error) {
    console.error('[documents/poll] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    files:      files ?? [],
    serverTime,             // client stores this as the next `since` value
    count:      (files ?? []).length,
  })
}
