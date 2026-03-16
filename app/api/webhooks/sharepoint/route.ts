// ─────────────────────────────────────────────────────────────────────────────
// POST/GET /api/webhooks/sharepoint
//
// Microsoft Graph change notification endpoint for SharePoint drive.
//
// GET  — validation handshake (Graph sends validationToken; we echo it back)
// POST — change notification payload; look up affected case and sync its files
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { syncCaseFiles, syncCaseByUrl } from '@/lib/pipelines/sharepoint-sync'

const CLIENT_STATE = 'el-team-portal'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// GET — Graph API subscription validation
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('validationToken')
  if (!token) return NextResponse.json({ error: 'No validationToken' }, { status: 400 })

  // Must respond with plain text + 200 within 10 seconds
  return new Response(decodeURIComponent(token), {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// POST — change notifications
export async function POST(req: NextRequest) {
  // Validation handshake also comes as POST with query param
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(decodeURIComponent(validationToken), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  let body: {
    value?: Array<{
      clientState?: string
      resource?: string
      resourceData?: { id?: string; '@odata.type'?: string }
      changeType?: string
      tenantId?: string
    }>
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const notifications = body.value ?? []

  // Respond 202 immediately — Graph requires <30s response
  // Process asynchronously (fire-and-forget per Next.js edge conventions)
  void processNotifications(notifications)

  return NextResponse.json({ ok: true, received: notifications.length }, { status: 202 })
}

async function processNotifications(
  notifications: Array<{
    clientState?: string
    resource?: string
    resourceData?: { id?: string }
    changeType?: string
  }>
) {
  const client = getDb()
  const db     = client.schema('core')

  // Collect unique drive item IDs that changed
  const changedItemIds = new Set<string>()
  for (const n of notifications) {
    if (n.clientState !== CLIENT_STATE) continue
    // resource looks like: drives/{driveId}/items/{itemId}
    const match = n.resource?.match(/drives\/[^/]+\/items\/([^/]+)/)
    if (match?.[1]) changedItemIds.add(match[1])
  }

  if (changedItemIds.size === 0) return

  // For each changed item, find the parent folder → look up case
  // Changed items may be files inside a case folder, so we check:
  // 1. Is the item itself a case folder? (direct match)
  // 2. Is the item's parent a case folder? (file inside a case folder — most common)
  const processedCases = new Set<string>()

  for (const itemId of changedItemIds) {
    // Check if this itemId is a known case folder
    const { data: directCase } = await db
      .from('cases')
      .select('id, sharepoint_drive_item_id, sharepoint_file_url')
      .eq('sharepoint_drive_item_id', itemId)
      .eq('is_deleted', false)
      .maybeSingle()

    if (directCase && !processedCases.has(directCase.id)) {
      processedCases.add(directCase.id)
      await syncCaseFiles(client, directCase.id, directCase.sharepoint_drive_item_id!)
      continue
    }

    // Otherwise: get the parent of this item from Graph and look up that
    try {
      const { getGraphToken, DOCUMENTS_DRIVE_ID } = await import('@/lib/sharepoint')
      const token = await getGraphToken()
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${DOCUMENTS_DRIVE_ID}/items/${itemId}?$select=id,parentReference`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.ok) {
        const item = await res.json()
        const parentId = item.parentReference?.id
        if (parentId) {
          const { data: parentCase } = await db
            .from('cases')
            .select('id, sharepoint_drive_item_id, sharepoint_file_url')
            .eq('sharepoint_drive_item_id', parentId)
            .eq('is_deleted', false)
            .maybeSingle()

          if (parentCase && !processedCases.has(parentCase.id)) {
            processedCases.add(parentCase.id)
            await syncCaseFiles(client, parentCase.id, parentCase.sharepoint_drive_item_id!)
          } else if (!parentCase) {
            // Parent folder not in our DB yet — try resolving via sharepoint_file_url
            // This handles the case where sharepoint_drive_item_id hasn't been populated yet
            const { data: urlCase } = await db
              .from('cases')
              .select('id, sharepoint_file_url')
              .not('sharepoint_file_url', 'is', null)
              .eq('is_deleted', false)
              .limit(1)
              .maybeSingle()

            if (urlCase?.sharepoint_file_url && !processedCases.has(urlCase.id)) {
              processedCases.add(urlCase.id)
              await syncCaseByUrl(client, urlCase.id, urlCase.sharepoint_file_url)
            }
          }
        }
      }
    } catch (err) {
      console.error('[sharepoint-webhook] error resolving item parent:', err)
    }
  }

  console.log(`[sharepoint-webhook] processed ${processedCases.size} cases from ${changedItemIds.size} changed items`)
}
