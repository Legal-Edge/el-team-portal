/**
 * Aloware webhook payload capture endpoint.
 *
 * Purpose: capture real Aloware SMS webhook payloads before building the
 * production parser. Stores raw body + parsed JSON + headers in
 * infrastructure.webhook_captures so we can inspect the exact field names,
 * types, and event shapes before committing to idempotency keys, direction
 * mapping, and case resolution logic.
 *
 * This endpoint is intentionally permissive — it accepts any POST and stores
 * everything. Once we have confirmed payloads, this route is replaced by the
 * production /api/webhooks/aloware route.
 *
 * URL: https://team.easylemon.com/api/webhooks/aloware-test
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Headers we want to keep — strip auth/cookie noise
const KEEP_HEADERS = [
  'content-type',
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
  'x-aloware-signature',
  'x-aloware-event',
  'x-webhook-event',
  'x-request-id',
  'accept',
  'host',
]

export async function POST(req: NextRequest) {
  const supabase = getDb()
  const rawBody  = await req.text()
  const ip       = req.headers.get('x-forwarded-for')
               ??  req.headers.get('x-real-ip')
               ??  'unknown'

  // Sanitise headers — keep only what's useful
  const headers: Record<string, string> = {}
  for (const key of KEEP_HEADERS) {
    const val = req.headers.get(key)
    if (val) headers[key] = val
  }

  // Try to parse body as JSON
  let body: unknown = null
  let parseError: string | null = null
  try {
    body = JSON.parse(rawBody)
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'JSON parse failed'
  }

  // Extract event type hint from headers or top-level body field
  const eventType =
    req.headers.get('x-aloware-event')
    ?? req.headers.get('x-webhook-event')
    ?? (body && typeof body === 'object' && body !== null
        ? ((body as Record<string, unknown>).type
           ?? (body as Record<string, unknown>).event
           ?? (body as Record<string, unknown>).event_type
           ?? null) as string | null
        : null)

  const notes = parseError ? `JSON parse error: ${parseError}` : null

  const { error } = await supabase
    .schema('infrastructure' as never)
    .from('webhook_captures')
    .insert({
      source:     'aloware',
      event_type: eventType ? String(eventType) : null,
      ip_address: ip,
      headers,
      body:       body ?? null,
      raw_body:   rawBody,
      notes,
    })

  if (error) {
    console.error('[aloware-test] Supabase insert error:', error.message)
    // Still return 200 so Aloware retries don't pile up
    return NextResponse.json({ ok: false, error: error.message }, { status: 200 })
  }

  console.log('[aloware-test] Captured payload — event:', eventType ?? 'unknown', '| size:', rawBody.length, 'bytes')

  return NextResponse.json({ ok: true, captured: true })
}

// Aloware may send a GET to verify the endpoint is reachable
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'aloware-test-capture', status: 'listening' })
}
