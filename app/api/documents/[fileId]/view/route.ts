// GET /api/documents/[fileId]/view
//
// Proxies PDF bytes through our server using the Graph /content endpoint.
// Graph follows redirects automatically and returns the file bytes.
// We stream them back to the client as application/pdf.
//
// The blob URL approach in the client-side modal bypasses frame-ancestors CSP.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'

const DRIVE_ID = 'b!oTYerw9tj0KLIWLLGc_DzIZijDFxI1xNtMSGXezIVsUHL02cd1kmRra7r_dMei8k'

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

  const { data: file, error: dbErr } = await db
    .from('document_files')
    .select('sharepoint_item_id, sharepoint_drive_id, file_name')
    .eq('id', fileId)
    .eq('is_deleted', false)
    .single()

  if (dbErr || !file?.sharepoint_item_id) {
    console.error('[doc-view] DB lookup failed:', dbErr)
    return new NextResponse('File not found', { status: 404 })
  }

  const driveId = file.sharepoint_drive_id ?? DRIVE_ID
  const itemId  = file.sharepoint_item_id

  try {
    const token = await getGraphToken()

    // Graph /content endpoint returns file bytes directly (follows CDN redirect internally)
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      }
    )

    if (!contentRes.ok) {
      const errText = await contentRes.text()
      console.error('[doc-view] Graph content error:', contentRes.status, errText)
      return new NextResponse(`Graph error: ${contentRes.status}`, { status: 502 })
    }

    const buffer      = await contentRes.arrayBuffer()
    const contentType = contentRes.headers.get('content-type') ?? 'application/pdf'
    const safeName    = encodeURIComponent(file.file_name ?? 'document.pdf')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control':       'private, max-age=300',
      },
    })
  } catch (err) {
    console.error('[doc-view] unexpected error:', err)
    return new NextResponse('Internal error', { status: 500 })
  }
}
