// ─────────────────────────────────────────────────────────────────────────────
// POST/GET /api/webhooks/sharepoint
//
// Microsoft Graph change notification endpoint for SharePoint drive.
//
// GET  — validation handshake (Graph sends validationToken; we echo it back)
// POST — change notification payload; look up affected case by subscription ID
//        and sync its files live
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { syncCaseFiles }             from '@/lib/pipelines/sharepoint-sync'
import { CLIENT_STATE, getGraphToken, DOCUMENTS_DRIVE_ID } from '@/lib/sharepoint'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function logToDb(count: number, rawBody: string) {
  try {
    await getDb().schema('core').from('sync_log').insert({
      sync_type:     'webhook',
      deals_seen:    count,
      deals_synced:  0,
      deals_errored: 0,
      status:        'success',
      notes:         `sharepoint_notification: ${rawBody.slice(0, 1000)}`,
    })
  } catch (err) {
    console.error('[sharepoint-webhook] log error:', err)
  }
}

// GET — Graph API subscription validation
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('validationToken')
  if (!token) return NextResponse.json({ error: 'No validationToken' }, { status: 400 })
  return new Response(decodeURIComponent(token), {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// POST — change notifications
export async function POST(req: NextRequest) {
  // Validation handshake can also come as POST with query param
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(decodeURIComponent(validationToken), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const rawText = await req.text()
  console.log('[sharepoint-webhook] raw body:', rawText.slice(0, 500))

  let body: {
    value?: Array<{
      subscriptionId?: string
      clientState?:    string
      resource?:       string
      resourceData?:   { id?: string }
      changeType?:     string
    }>
  }

  try {
    body = JSON.parse(rawText)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const notifications = body.value ?? []
  void logToDb(notifications.length, rawText)

  // Respond 202 immediately — Graph requires <30s response
  void processNotifications(notifications)

  return NextResponse.json({ ok: true, received: notifications.length }, { status: 202 })
}

async function processNotifications(
  notifications: Array<{
    subscriptionId?: string
    clientState?:    string
    resource?:       string
    resourceData?:   { id?: string }
  }>
) {
  const client = getDb()
  const db     = client.schema('core')
  const processed = new Set<string>()

  for (const n of notifications) {
    if (n.clientState !== CLIENT_STATE) {
      console.log('[sharepoint-webhook] skipping — clientState mismatch:', n.clientState)
      continue
    }

    let caseId: string | null = null
    let driveItemId: string | null = null

    // ── Primary lookup: subscription ID → case_sp_subscriptions ──────────────
    if (n.subscriptionId) {
      const { data: sub } = await db
        .from('case_sp_subscriptions')
        .select('case_id, drive_item_id')
        .eq('subscription_id', n.subscriptionId)
        .maybeSingle()

      if (sub) {
        caseId      = sub.case_id
        driveItemId = sub.drive_item_id
        console.log(`[sharepoint-webhook] matched via subscription ${n.subscriptionId} → case ${caseId}`)
      }
    }

    // ── Fallback: resolve via changed item's parent folder ───────────────────
    if (!caseId && n.resourceData?.id) {
      const itemId = n.resourceData.id
      // Check direct match
      const { data: directCase } = await db
        .from('cases')
        .select('id, sharepoint_drive_item_id')
        .eq('sharepoint_drive_item_id', itemId)
        .eq('is_deleted', false)
        .maybeSingle()

      if (directCase) {
        caseId      = directCase.id
        driveItemId = directCase.sharepoint_drive_item_id ?? null
      } else {
        // Try parent
        try {
          const token = await getGraphToken()
          const res   = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${DOCUMENTS_DRIVE_ID}/items/${itemId}?$select=id,parentReference`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (res.ok) {
            const item     = await res.json()
            const parentId = item.parentReference?.id
            if (parentId) {
              const { data: parentCase } = await db
                .from('cases')
                .select('id, sharepoint_drive_item_id')
                .eq('sharepoint_drive_item_id', parentId)
                .eq('is_deleted', false)
                .maybeSingle()
              if (parentCase) {
                caseId      = parentCase.id
                driveItemId = parentCase.sharepoint_drive_item_id ?? null
              }
            }
          }
        } catch (err) {
          console.error('[sharepoint-webhook] parent lookup error:', err)
        }
      }
    }

    if (!caseId || !driveItemId || processed.has(caseId)) continue
    processed.add(caseId)

    try {
      await syncCaseFiles(client, caseId, driveItemId)
      console.log(`[sharepoint-webhook] synced case ${caseId}`)
    } catch (err) {
      console.error(`[sharepoint-webhook] sync error for case ${caseId}:`, err)
    }
  }

  console.log(`[sharepoint-webhook] done — processed ${processed.size} cases`)
}
