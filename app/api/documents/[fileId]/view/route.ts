// GET /api/documents/[fileId]/view
//
// Proxies the file content through our own server so the iframe stays on
// team.easylemon.com and avoids CSP / X-Frame-Options blocks from Microsoft CDN.
//
// Flow: auth check → look up SharePoint item ID → get fresh Graph download URL
//       → fetch bytes server-side → stream back as application/pdf

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
    .select('sharepoint_item_id, sharepoint_drive_id, file_name, file_extension')
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

    // Get a fresh pre-authenticated download URL from Graph
    const metaRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?$select=id,%40microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!metaRes.ok) {
      console.error('[doc-view] Graph meta error:', metaRes.status, await metaRes.text())
      return new NextResponse('Failed to fetch file metadata', { status: 502 })
    }

    const meta        = await metaRes.json()
    const downloadUrl = meta['@microsoft.graph.downloadUrl']
    if (!downloadUrl) {
      return new NextResponse('No download URL available', { status: 404 })
    }

    // Fetch the actual file bytes server-side — stays on our domain
    const fileRes = await fetch(downloadUrl)
    if (!fileRes.ok) {
      console.error('[doc-view] file fetch error:', fileRes.status)
      return new NextResponse('Failed to fetch file', { status: 502 })
    }

    const contentType = fileRes.headers.get('content-type') ?? 'application/pdf'
    const buffer      = await fileRes.arrayBuffer()
    const safeName    = encodeURIComponent(file.file_name ?? 'document.pdf')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control':       'private, max-age=300',
        // Allow iframe to render from same origin
        'X-Frame-Options':     'SAMEORIGIN',
      },
    })
  } catch (err) {
    console.error('[doc-view] error:', err)
    return new NextResponse('Internal error', { status: 500 })
  }
}
