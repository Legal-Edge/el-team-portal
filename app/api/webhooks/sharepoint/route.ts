// ─────────────────────────────────────────────────────────────────────────────
// POST/GET /api/webhooks/sharepoint
//
// Microsoft Graph change notification endpoint for SharePoint drive.
//
// GET  — validation handshake (Graph sends validationToken; we echo it back)
// POST — change notification payload; triggers delta query to detect what changed
//
// IMPORTANT: SharePoint drive change notifications do NOT include per-file
// resourceData — the payload only indicates "something changed in the drive".
// We therefore use the delta query API (via runDeltaSync) to detect exactly
// what changed and sync only the affected case folders.
//
// The webhook acts as an immediate trigger; the 1-minute delta cron is the
// reliable safety net if webhook delivery is intermittent.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { CLIENT_STATE }              from '@/lib/sharepoint'
import { runDeltaSync }              from '@/lib/sharepoint-delta'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// GET — Graph API subscription validation handshake
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('validationToken')
  if (!token) return NextResponse.json({ error: 'No validationToken' }, { status: 400 })
  return new Response(decodeURIComponent(token), {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// POST — change notifications from Microsoft Graph
export async function POST(req: NextRequest) {
  // Validation handshake can also arrive as POST with validationToken query param
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(decodeURIComponent(validationToken), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const rawText = await req.text()
  console.log('[sharepoint-webhook] notification received:', rawText.slice(0, 300))

  let body: {
    value?: Array<{
      subscriptionId?: string
      clientState?:    string
      changeType?:     string
    }>
  }

  try {
    body = JSON.parse(rawText)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const notifications = body.value ?? []

  // Filter to notifications from our subscription only
  const ours = notifications.filter(n => n.clientState === CLIENT_STATE)

  if (ours.length === 0) {
    console.log('[sharepoint-webhook] no matching notifications (clientState mismatch)')
    return NextResponse.json({ ok: true, received: 0 }, { status: 202 })
  }

  // Log to DB — do this synchronously before responding so it's captured
  const { error: logErr } = await getDb().schema('core').from('sync_log').insert({
    sync_type:     'webhook',
    deals_seen:    ours.length,
    deals_synced:  0,
    deals_errored: 0,
    status:        'success',
    notes:         `sharepoint_notification: ${rawText.slice(0, 1000)}`,
  })
  if (logErr) console.error('[sharepoint-webhook] log insert error:', logErr)

  // Trigger delta sync asynchronously after responding 202.
  // SharePoint drive notifications carry no per-file resourceData — we MUST
  // call the delta API to learn what actually changed. The delta cron also runs
  // every minute as a safety net, so this is an opportunistic acceleration.
  const client = getDb()
  void runDeltaSync(client)
    .then(r  => console.log('[sharepoint-webhook] delta sync:', JSON.stringify(r)))
    .catch(e => console.error('[sharepoint-webhook] delta sync error:', e))

  return NextResponse.json({ ok: true, received: ours.length }, { status: 202 })
}
