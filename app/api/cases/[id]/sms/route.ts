/**
 * Send SMS to a case's primary contact via Aloware SMS Gateway.
 *
 * POST /api/cases/[id]/sms
 * Body: { message: string }
 *
 * The Aloware webhook fires automatically after send, so the outbound
 * message is captured in core.communications via the webhook handler.
 * This endpoint only initiates the send — it does not write to DB directly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth }                       from '@/auth'
import { createClient }               from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const ALOWARE_SEND_URL  = 'https://app.aloware.com/api/v1/webhook/sms-gateway/send'
const MAX_SMS_LENGTH    = 160

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body   = await req.json()
  const message: string = (body.message ?? '').trim()

  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  const apiToken  = process.env.ALOWARE_API_TOKEN
  const fromNumber = process.env.ALOWARE_FROM_NUMBER

  if (!apiToken || !fromNumber) {
    return NextResponse.json({ error: 'Aloware not configured' }, { status: 500 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).schema('core' as never)

  // Resolve case
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id, client_first_name, client_last_name')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (!caseRow) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  // Get primary contact phone
  const { data: contact } = await db
    .from('case_contacts')
    .select('phone, first_name, last_name')
    .eq('case_id', caseRow.id)
    .eq('is_primary', true)
    .eq('is_deleted', false)
    .single()

  if (!contact?.phone) {
    return NextResponse.json({ error: 'No primary contact phone on file' }, { status: 422 })
  }

  // Send via Aloware — user_id=0 sends as contact owner (assigned agent)
  const payload = {
    api_token: apiToken,
    from:      fromNumber,
    to:        contact.phone,
    message:   message.slice(0, MAX_SMS_LENGTH),
    user_id:   0,
  }

  const alowareRes = await fetch(ALOWARE_SEND_URL, {
    method:  'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  const alowareBody = await alowareRes.json().catch(() => ({}))

  if (!alowareRes.ok) {
    console.error('[sms/send] Aloware error:', alowareRes.status, alowareBody)
    return NextResponse.json(
      { error: alowareBody.message ?? 'Aloware send failed', details: alowareBody.errors },
      { status: 502 }
    )
  }

  console.log(
    `[sms/send] Sent to ${contact.phone} for case ${caseRow.id}`,
    `by ${session.user.email}`,
  )

  // The outbound webhook will fire from Aloware and capture this in core.communications.
  // Return success — client should poll or wait for webhook to deliver the message to the thread.
  return NextResponse.json({
    ok:      true,
    to:      contact.phone,
    message: message.slice(0, MAX_SMS_LENGTH),
  })
}
