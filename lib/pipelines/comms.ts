/**
 * lib/pipelines/comms.ts
 *
 * Communications pipeline — app-level operations on top of the DB trigger.
 *
 * The DB trigger (trg_update_comms_state) auto-populates core.comms_state
 * on every INSERT/UPDATE to core.communications. This module provides:
 *
 *   - syncCommsState()        — manual recalculation for a single case
 *   - bulkSyncCommsState()    — batch recalculation (post-import, admin tools)
 *   - markCommsRead()         — reset unread_count for a case
 *   - getSlaBreaches()        — query all overdue/due_soon cases
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { PLATFORM_EVENTS, EVENT_SOURCES, emitEvent } from '@/lib/events'

const SLA_HOURS = 24

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommsStateRow {
  case_id:              string
  last_inbound_at:      string | null
  last_outbound_at:     string | null
  last_inbound_channel: string | null
  awaiting_response:    boolean
  response_due_at:      string | null
  sla_hours:            number
  sla_status:           'ok' | 'due_soon' | 'overdue' | 'no_contact'
  unread_count:         number
  updated_at:           string
}

export type SlaStatus = CommsStateRow['sla_status']

// ── syncCommsState ────────────────────────────────────────────────────────────
/**
 * Manually recalculate and upsert comms state for a single case.
 * Useful after bulk imports or when the trigger may have been bypassed.
 */
export async function syncCommsState(
  client: SupabaseClient,
  caseId: string,
): Promise<{ error: string | null }> {
  const coreDb = client.schema('core')

  // Fetch all comms for this case
  const { data: comms, error: fetchErr } = await coreDb
    .from('communications')
    .select('direction, channel, occurred_at')
    .eq('case_id', caseId)
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false })

  if (fetchErr) return { error: fetchErr.message }
  if (!comms || comms.length === 0) {
    // No comms — upsert empty state
    await coreDb.from('comms_state').upsert({
      case_id:          caseId,
      sla_status:       'no_contact',
      awaiting_response: false,
      unread_count:     0,
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'case_id' })
    return { error: null }
  }

  const inbound  = comms.filter(c => c.direction === 'inbound')
  const outbound = comms.filter(c => c.direction === 'outbound')

  const lastInbound  = inbound[0]?.occurred_at  ?? null
  const lastOutbound = outbound.length > 0
    ? outbound.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0].occurred_at
    : null
  const lastInboundChannel = inbound[0]?.channel ?? null

  const awaiting = lastInbound !== null &&
    (lastOutbound === null || new Date(lastInbound) > new Date(lastOutbound))

  const unreadCount = lastOutbound
    ? inbound.filter(c => new Date(c.occurred_at) > new Date(lastOutbound)).length
    : inbound.length

  let responseDueAt: string | null = null
  let slaStatus: SlaStatus = 'ok'

  if (awaiting && lastInbound) {
    const dueAt = new Date(new Date(lastInbound).getTime() + SLA_HOURS * 3600 * 1000)
    responseDueAt = dueAt.toISOString()
    const now = Date.now()
    if (now > dueAt.getTime())                        slaStatus = 'overdue'
    else if (now > dueAt.getTime() - 4 * 3600 * 1000) slaStatus = 'due_soon'
    else                                               slaStatus = 'ok'
  } else if (!lastInbound) {
    slaStatus = 'no_contact'
  }

  const { error: upsertErr } = await coreDb.from('comms_state').upsert({
    case_id:              caseId,
    last_inbound_at:      lastInbound,
    last_outbound_at:     lastOutbound,
    last_inbound_channel: lastInboundChannel,
    awaiting_response:    awaiting,
    response_due_at:      responseDueAt,
    sla_hours:            SLA_HOURS,
    sla_status:           slaStatus,
    unread_count:         unreadCount,
    updated_at:           new Date().toISOString(),
  }, { onConflict: 'case_id' })

  return { error: upsertErr?.message ?? null }
}

// ── markCommsRead ─────────────────────────────────────────────────────────────
/**
 * Reset unread_count to 0 when staff opens the comms view for a case.
 */
export async function markCommsRead(
  client: SupabaseClient,
  caseId: string,
): Promise<void> {
  await client.schema('core')
    .from('comms_state')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('case_id', caseId)
}

// ── getSlaBreaches ────────────────────────────────────────────────────────────
/**
 * Returns all cases currently overdue or due_soon.
 * Used for the comms inbox and SLA dashboard.
 */
export async function getSlaBreaches(
  client:  SupabaseClient,
  status?: 'overdue' | 'due_soon',
): Promise<CommsStateRow[]> {
  let query = client.schema('core')
    .from('comms_state')
    .select('*')
    .in('sla_status', status ? [status] : ['overdue', 'due_soon'])
    .order('response_due_at', { ascending: true })

  const { data, error } = await query
  if (error) { console.error('[comms] getSlaBreaches:', error.message); return [] }
  return (data ?? []) as CommsStateRow[]
}

// ── recordOutboundComm ────────────────────────────────────────────────────────
/**
 * Insert an outbound communication record (SMS sent, email sent, call made by staff).
 * The DB trigger will update comms_state automatically after insert.
 */
export async function recordOutboundComm(
  client: SupabaseClient,
  params: {
    caseId:        string
    channel:       'sms' | 'email' | 'call' | 'note'
    body?:         string
    snippet?:      string
    occurredAt?:   string
    staffEmail?:   string
    sourceSystem?: string
    sourceRecordId?: string
  }
): Promise<{ commId: string | null; error: string | null }> {
  const { data, error } = await client.schema('core')
    .from('communications')
    .insert({
      case_id:         params.caseId,
      channel:         params.channel,
      direction:       'outbound',
      body:            params.body    ?? null,
      snippet:         params.snippet ?? (params.body?.slice(0, 500) ?? null),
      occurred_at:     params.occurredAt ?? new Date().toISOString(),
      sender_email:    params.staffEmail ?? null,
      source_system:   params.sourceSystem ?? 'portal_ui',
      source_record_id: params.sourceRecordId ?? `portal-${Date.now()}`,
      is_deleted:      false,
    })
    .select('id')
    .single()

  if (error) return { commId: null, error: error.message }

  // Emit event (DB trigger handles comms_state; event bus handles downstream pipelines)
  await emitEvent(client, {
    event_type: PLATFORM_EVENTS.SMS_SENT,
    source:     EVENT_SOURCES.PORTAL_UI,
    case_id:    params.caseId,
    actor:      params.staffEmail ?? null,
    payload:    { channel: params.channel, comm_id: data.id },
  })

  return { commId: data.id, error: null }
}
