// GET /api/documents/[fileId]/view
// Fetches a fresh pre-authenticated download URL from Microsoft Graph and
// redirects to it. Used by the in-app PDF viewer iframe.
//
// Graph's @microsoft.graph.downloadUrl is valid for ~60 min and requires no
// SharePoint session — the browser can load it directly.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await auth()
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 })

  const { fileId } = await params

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const { data: file } = await db
    .from('document_files')
    .select('sharepoint_item_id, sharepoint_drive_id, file_name, web_url')
    .eq('id', fileId)
    .eq('is_deleted', false)
    .single()

  if (!file?.sharepoint_item_id) {
    return new NextResponse('File not found', { status: 404 })
  }

  const driveId = file.sharepoint_drive_id ?? process.env.SHAREPOINT_DRIVE_ID!
  const itemId  = file.sharepoint_item_id

  try {
    const token = await getGraphToken()
    const res   = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?$select=id,%40microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!res.ok) {
      console.error('[doc-view] Graph error:', res.status, await res.text())
      // Fall back to web_url if Graph fails
      if (file.web_url) return NextResponse.redirect(file.web_url)
      return new NextResponse('Failed to fetch download URL', { status: 502 })
    }

    const data        = await res.json()
    const downloadUrl = data['@microsoft.graph.downloadUrl']

    if (!downloadUrl) {
      if (file.web_url) return NextResponse.redirect(file.web_url)
      return new NextResponse('No download URL available', { status: 404 })
    }

    // Redirect — browser fetches the file directly from Microsoft's CDN
    return NextResponse.redirect(downloadUrl)
  } catch (err) {
    console.error('[doc-view] error:', err)
    return new NextResponse('Internal error', { status: 500 })
  }
}
