// ─────────────────────────────────────────────────────────────────────────────
// POST/GET /api/webhooks/sharepoint/lifecycle
//
// Microsoft Graph lifecycle notification endpoint.
// Graph sends reauthorizationRequired events here when a subscription is about
// to be deactivated. We respond by renewing it immediately.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { renewSubscription, CLIENT_STATE } from '@/lib/sharepoint'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// GET — validation handshake
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('validationToken')
  if (!token) return NextResponse.json({ error: 'No validationToken' }, { status: 400 })
  return new Response(decodeURIComponent(token), {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// POST — lifecycle events
export async function POST(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(decodeURIComponent(validationToken), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  let body: {
    value?: Array<{
      subscriptionId?:        string
      clientState?:           string
      lifecycleEvent?:        string
      sequenceNumber?:        number
    }>
  }

  try {
    body = JSON.parse(await req.text())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const events = body.value ?? []
  console.log('[sharepoint-lifecycle] events:', JSON.stringify(events))

  // Respond 202 immediately
  void handleLifecycleEvents(events)
  return NextResponse.json({ ok: true }, { status: 202 })
}

async function handleLifecycleEvents(
  events: Array<{
    subscriptionId?: string
    clientState?:    string
    lifecycleEvent?: string
  }>
) {
  const db = getDb().schema('core')

  for (const event of events) {
    if (event.clientState !== CLIENT_STATE) continue
    if (event.lifecycleEvent !== 'reauthorizationRequired') continue
    if (!event.subscriptionId) continue

    console.log(`[sharepoint-lifecycle] reauthorizationRequired for ${event.subscriptionId} — renewing`)

    try {
      const renewed = await renewSubscription(event.subscriptionId)

      // Update expiry in DB
      await db
        .from('case_sp_subscriptions')
        .update({
          expires_at: renewed.expirationDateTime,
          updated_at: new Date().toISOString(),
        })
        .eq('subscription_id', event.subscriptionId)

      console.log(`[sharepoint-lifecycle] renewed ${event.subscriptionId} → expires ${renewed.expirationDateTime}`)
    } catch (err) {
      console.error(`[sharepoint-lifecycle] renewal failed for ${event.subscriptionId}:`, err)
    }
  }
}
