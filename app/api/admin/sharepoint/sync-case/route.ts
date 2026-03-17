// POST /api/admin/sharepoint/sync-case
// Manually trigger a SharePoint file sync for a specific case.
// Body: { case_id?: string, hubspot_deal_id?: string }
// Token-protected.

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { syncCaseByUrl, syncCaseFiles } from '@/lib/pipelines/sharepoint-sync'

import { auth } from '@/auth'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function POST(req: NextRequest) {
  // Accept either admin token OR authenticated session
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${TOKEN}`) {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { case_id, hubspot_deal_id } = await req.json()
  if (!case_id && !hubspot_deal_id)
    return NextResponse.json({ error: 'case_id or hubspot_deal_id required' }, { status: 400 })

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const db = client.schema('core')

  // Support UUID or HubSpot deal ID interchangeably
  const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

  let query
  if (case_id) {
    query = db.from('cases')
      .select('id, sharepoint_file_url, sharepoint_drive_item_id')
      .eq('is_deleted', false)
      .eq(isUUID(case_id) ? 'id' : 'hubspot_deal_id', case_id)
      .maybeSingle()
  } else {
    query = db.from('cases')
      .select('id, sharepoint_file_url, sharepoint_drive_item_id')
      .eq('is_deleted', false)
      .eq('hubspot_deal_id', String(hubspot_deal_id))
      .maybeSingle()
  }

  const { data: caseRow } = await query

  if (!caseRow)
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (!caseRow.sharepoint_file_url && !caseRow.sharepoint_drive_item_id)
    return NextResponse.json({ error: 'No SharePoint URL on this case' }, { status: 422 })

  const result = caseRow.sharepoint_drive_item_id
    ? await syncCaseFiles(client, caseRow.id, caseRow.sharepoint_drive_item_id)
    : await syncCaseByUrl(client, caseRow.id, caseRow.sharepoint_file_url!)

  return NextResponse.json(result)
}
