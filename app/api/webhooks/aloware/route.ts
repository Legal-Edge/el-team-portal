/**
 * Production Aloware SMS webhook handler.
 *
 * Accepts Aloware webhook events and writes inbound SMS messages into
 * core.communications — the same unified table used for HubSpot emails
 * and calls. Outbound SMS handling is wired but gated pending a confirmed
 * real outbound payload.
 *
 * Idempotency: application-level dedup on aloware_id in raw_metadata.
 * Thread grouping: derived key aloware:{contact_id}:{campaign_id}
 * Case resolution: body.lead_number → core.case_contacts.phone
 *
 * URL: https://team.easylemon.com/api/webhooks/aloware
 * Method: POST
 * Auth: none (public webhook endpoint; Aloware IPs: 52.x, 34.x, 54.x)
 */

import { NextRequest, NextResponse }   from 'next/server'
import { createClient }                 from '@supabase/supabase-js'
import {
  AlowareWebhookPayload,
  validateInbound,
  parseDirection,
  deriveThreadId,
  normalisePhone,
  makeSnippet,
  parseOccurredAt,
  isSmsEvent,
} from '@/lib/aloware/parse-sms'

export const dynamic = 'force-dynamic'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Case resolution ────────────────────────────────────────────────────────
// Matches client phone against core.case_contacts.
// Returns: { caseId, caseContactId } | null (ambiguous or not found)

interface ResolvedCase {
  caseId:        string
  caseContactId: string
  hubspotDealId: string | null
}

interface ResolutionResult {
  resolved: ResolvedCase | null
  needsReview: boolean
  reviewReason: string | null
}

async function resolveCase(
  db: ReturnType<typeof getDb>,
  phone: string,
): Promise<ResolutionResult> {
  const normalisedPhone = normalisePhone(phone)
  if (!normalisedPhone) {
    return { resolved: null, needsReview: true, reviewReason: 'invalid_phone' }
  }

  const { data: contacts, error } = await db
    .schema('core' as never)
    .from('case_contacts')
    .select('id, case_id, hubspot_contact_id')
    .eq('phone', normalisedPhone)
    .eq('is_deleted', false)

  if (error) {
    console.error('[aloware] case_contacts lookup error:', error.message)
    return { resolved: null, needsReview: true, reviewReason: `db_error: ${error.message}` }
  }

  if (!contacts || contacts.length === 0) {
    return { resolved: null, needsReview: true, reviewReason: 'no_case_for_phone' }
  }

  if (contacts.length > 1) {
    // Multiple cases share this phone — flag for human review, do not guess
    return {
      resolved: null,
      needsReview: true,
      reviewReason: `multiple_cases_for_phone: ${contacts.map(c => c.case_id).join(', ')}`,
    }
  }

  const contact = contacts[0]

  // Fetch the case to get hubspot_deal_id
  const { data: caseRow } = await db
    .schema('core' as never)
    .from('cases')
    .select('id, hubspot_deal_id')
    .eq('id', contact.case_id)
    .single()

  return {
    resolved: {
      caseId:        contact.case_id,
      caseContactId: contact.id,
      hubspotDealId: caseRow?.hubspot_deal_id ?? null,
    },
    needsReview: false,
    reviewReason: null,
  }
}

// ── Idempotency check ──────────────────────────────────────────────────────
// Dedup on source_record_id (= Aloware communication ID), which is the
// canonical unique field under the new uq_communications_source constraint:
//   UNIQUE (source_system, source_record_id)
//
// Application-level pre-check returns a clean skip response; the upsert
// with ignoreDuplicates:true below provides atomic DB-level protection
// against race conditions (two events for the same aloware_id arriving
// simultaneously both pass the pre-check before either commits).

async function isDuplicate(
  db: ReturnType<typeof getDb>,
  alowareId: number,
): Promise<boolean> {
  const { data } = await db
    .schema('core' as never)
    .from('communications')
    .select('id')
    .eq('source_system', 'aloware')
    .eq('source_record_id', String(alowareId))
    .limit(1)

  return (data?.length ?? 0) > 0
}

// ── Process inbound SMS ────────────────────────────────────────────────────

async function processInboundSms(
  db: ReturnType<typeof getDb>,
  payload: AlowareWebhookPayload,
): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string }> {
  const b = payload.body

  // Idempotency — dedup on Aloware communication ID
  const duplicate = await isDuplicate(db, b.id)
  if (duplicate) {
    console.log(`[aloware] Skipping duplicate aloware_id=${b.id}`)
    return { ok: true, skipped: true }
  }

  // Case resolution
  const resolution = await resolveCase(db, b.lead_number)

  const threadId    = deriveThreadId(b.contact_id, b.campaign_id)
  const occurredAt  = parseOccurredAt(b.created_at)
  const bodyText    = b.body ?? ''
  const snippet     = makeSnippet(bodyText)
  const fromNumber  = normalisePhone(b.lead_number)
  const toNumber    = normalisePhone(b.incoming_number)

  const row = {
    // Case linkage
    case_id:                resolution.resolved?.caseId        ?? null,
    case_contact_id:        resolution.resolved?.caseContactId ?? null,
    hubspot_deal_id:        resolution.resolved?.hubspotDealId ?? null,

    // External message ID — stored in both fields for backwards compatibility.
    // source_record_id is the canonical dedup field (uq_communications_source).
    // hubspot_engagement_id kept populated for existing queries.
    hubspot_engagement_id:  String(b.id),
    source_record_id:       String(b.id),

    // Communication fields
    channel:              'sms',
    direction:            'inbound',
    body:                 bodyText,
    snippet,
    occurred_at:          occurredAt,
    from_number:          fromNumber,
    to_number:            toNumber,
    thread_id:            threadId,

    // Source
    source_system:        'aloware',
    resolution_method:    resolution.resolved ? 'phone_match' : null,

    // Review flags
    needs_review:         resolution.needsReview,
    review_reason:        resolution.reviewReason,

    // Raw payload preserved in full for audit/reprocessing
    raw_metadata: {
      aloware_id:         b.id,
      aloware_contact_id: b.contact_id,
      aloware_campaign_id:b.campaign_id,
      event:              payload.event,
      contact_name:       [b.contact?.first_name, b.contact?.last_name].filter(Boolean).join(' ') || null,
      contact_uuid:       b.contact?.uuid_v4 ?? null,
      direction_raw:      b.direction,
      current_status:     b.current_status ?? null,
    },
  }

  // Upsert with ignoreDuplicates provides atomic DB-level dedup on
  // (source_system, source_record_id) — eliminates race condition where
  // two Aloware events for the same message arrive simultaneously.
  const { data, error } = await db
    .schema('core' as never)
    .from('communications')
    .upsert(row, {
      onConflict:       'source_system,source_record_id',
      ignoreDuplicates: true,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[aloware] Insert error:', error.message)
    return { ok: false, error: error.message }
  }

  if (!data) {
    // Conflict resolved by ignoreDuplicates — already existed
    console.log(`[aloware] Skipped (DB conflict) aloware_id=${b.id}`)
    return { ok: true, skipped: true }
  }

  console.log(
    `[aloware] Stored aloware_id=${b.id} → comms id=${data.id}`,
    resolution.resolved
      ? `case=${resolution.resolved.caseId}`
      : `needs_review=${resolution.reviewReason}`,
  )

  return { ok: true, id: data.id }
}

// ── Route handlers ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: AlowareWebhookPayload

  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 200 })
  }

  // Test ping from Aloware webhook config ("Save and Test Webhook" button)
  if (payload && 'test_payload' in payload) {
    console.log('[aloware] Test ping received')
    return NextResponse.json({ ok: true, test: true })
  }

  // Only process SMS events
  if (!isSmsEvent(payload)) {
    console.log('[aloware] Skipping non-SMS event:', payload?.event)
    return NextResponse.json({ ok: true, skipped: true, reason: 'not_sms' })
  }

  const direction = parseDirection(payload.body?.direction)

  if (direction === 'inbound') {
    const validation = validateInbound(payload)
    if (!validation.valid) {
      console.warn('[aloware] Invalid inbound payload:', validation.reason)
      return NextResponse.json({ ok: false, error: validation.reason }, { status: 200 })
    }

    const db     = getDb()
    const result = await processInboundSms(db, payload)
    return NextResponse.json(result)
  }

  if (direction === 'outbound') {
    // Outbound payload confirmed 2026-03-10 — identical structure to inbound.
    // direction=2, lead_number=client, incoming_number=EL line.
    // from/to are flipped: EL line sends to client.
    const db = getDb()

    const b = payload.body
    const duplicate = await isDuplicate(db, b.id)
    if (duplicate) {
      console.log(`[aloware] Skipping duplicate outbound aloware_id=${b.id}`)
      return NextResponse.json({ ok: true, skipped: true })
    }

    const resolution = await resolveCase(db, b.lead_number)
    const threadId   = deriveThreadId(b.contact_id, b.campaign_id)
    const bodyText   = b.body ?? ''

    const row = {
      case_id:               resolution.resolved?.caseId        ?? null,
      case_contact_id:       resolution.resolved?.caseContactId ?? null,
      hubspot_deal_id:       resolution.resolved?.hubspotDealId ?? null,
      hubspot_engagement_id: String(b.id),
      source_record_id:      String(b.id),

      channel:               'sms',
      direction:             'outbound',
      body:                  bodyText,
      snippet:               makeSnippet(bodyText),
      occurred_at:           parseOccurredAt(b.created_at),
      from_number:           normalisePhone(b.incoming_number), // EL line sends
      to_number:             normalisePhone(b.lead_number),     // to client
      thread_id:             threadId,

      source_system:         'aloware',
      resolution_method:     resolution.resolved ? 'phone_match' : null,
      needs_review:          resolution.needsReview,
      review_reason:         resolution.reviewReason,

      raw_metadata: {
        aloware_id:          b.id,
        aloware_contact_id:  b.contact_id,
        aloware_campaign_id: b.campaign_id,
        event:               payload.event,
        direction_raw:       b.direction,
        user_id:             b.user_id ?? null,
      },
    }

    const { data, error } = await db
      .schema('core' as never)
      .from('communications')
      .upsert(row, {
        onConflict:       'source_system,source_record_id',
        ignoreDuplicates: true,
      })
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[aloware] Outbound insert error:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 200 })
    }

    if (!data) {
      console.log(`[aloware] Outbound skipped (DB conflict) aloware_id=${b.id}`)
      return NextResponse.json({ ok: true, skipped: true })
    }

    console.log(`[aloware] Outbound stored aloware_id=${b.id} → comms id=${data.id}`)
    return NextResponse.json({ ok: true, id: data.id })
  }

  return NextResponse.json({ ok: true, skipped: true, reason: `unknown_direction: ${payload.body?.direction}` })
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'aloware-production', status: 'listening' })
}
