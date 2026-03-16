/**
 * lib/events.ts
 *
 * Platform event bus — controlled vocabulary + emit helper.
 *
 * Events are append-only facts: they record what happened.
 * Pipelines consume events and update operational state tables.
 *
 * Usage:
 *   import { PLATFORM_EVENTS, emitEvent } from '@/lib/events'
 *   await emitEvent(supabaseClient, {
 *     event_type:  PLATFORM_EVENTS.CASE_STAGE_CHANGED,
 *     source:      'hubspot_webhook',
 *     case_id:     caseId,
 *     payload:     { from: 'intake', to: 'nurture', hubspot_deal_id: '12345' },
 *   })
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Controlled event type vocabulary ─────────────────────────────────────────
// Add new types here only. Never use ad-hoc strings in emitters.

export const PLATFORM_EVENTS = {
  // Case lifecycle
  CASE_CREATED:          'case.created',
  CASE_STAGE_CHANGED:    'case.stage_changed',
  CASE_UPDATED:          'case.updated',
  CASE_DELETED:          'case.deleted',

  // Communications
  SMS_RECEIVED:          'sms.received',
  SMS_SENT:              'sms.sent',
  CALL_COMPLETED:        'call.completed',
  CALL_MISSED:           'call.missed',
  VOICEMAIL_RECEIVED:    'voicemail.received',
  EMAIL_RECEIVED:        'email.received',
  EMAIL_SENT:            'email.sent',

  // Documents
  DOCUMENT_UPLOADED:     'document.uploaded',
  DOCUMENT_CLASSIFIED:   'document.classified',
  DOCUMENT_REVIEWED:     'document.reviewed',
  DOCUMENT_ACCEPTED:     'document.accepted',
  DOCUMENT_REJECTED:     'document.rejected',

  // Intake
  INTAKE_SUBMITTED:      'intake.submitted',
  INTAKE_STEP_COMPLETED: 'intake.step_completed',
  INTAKE_FIELD_UPDATED:  'intake.field_updated',

  // Referrals
  REFERRAL_SUBMITTED:    'referral.submitted',

  // Tasks — emitted by DB trigger (core.emit_task_event), not application code
  TASK_CREATED:          'task.created',
  TASK_STATUS_CHANGED:   'task.status_changed',
  TASK_COMPLETED:        'task.completed',
  TASK_CANCELLED:        'task.cancelled',

  // AI
  AI_OUTPUT_GENERATED:   'ai.output_generated',

  // System
  SYNC_COMPLETED:        'system.sync_completed',
  SYNC_DELTA:            'system.sync_delta',
} as const

export type PlatformEventType = typeof PLATFORM_EVENTS[keyof typeof PLATFORM_EVENTS]

// ── Event sources ─────────────────────────────────────────────────────────────
export const EVENT_SOURCES = {
  HUBSPOT_WEBHOOK: 'hubspot_webhook',
  HUBSPOT_CRON:    'hubspot_cron',
  HUBSPOT_SYNC:    'hubspot_sync',
  ALOWARE:         'aloware',
  PORTAL_UI:       'portal_ui',
  PARTNER_PORTAL:  'partner_portal',
  SYSTEM:          'system',
} as const

export type EventSource = typeof EVENT_SOURCES[keyof typeof EVENT_SOURCES]

// ── Emit helper ───────────────────────────────────────────────────────────────

export interface EmitEventParams {
  event_type:   PlatformEventType
  source:       EventSource | string
  case_id?:     string | null
  actor?:       string | null
  payload?:     Record<string, unknown>
  occurred_at?: string   // ISO timestamp — defaults to NOW() in DB
}

/**
 * Insert a single event into core.events.
 * Non-blocking: errors are logged but never thrown — a failed event
 * must never block the main operation.
 */
export async function emitEvent(
  client: SupabaseClient,
  params: EmitEventParams
): Promise<void> {
  try {
    const row: Record<string, unknown> = {
      event_type:  params.event_type,
      source:      params.source,
      case_id:     params.case_id ?? null,
      actor:       params.actor   ?? null,
      payload:     params.payload ?? {},
    }
    if (params.occurred_at) row.occurred_at = params.occurred_at

    const { error } = await client
      .schema('core')
      .from('events')
      .insert(row)

    if (error) {
      console.error('[events] emit failed:', params.event_type, error.message)
    }
  } catch (err) {
    console.error('[events] emit threw:', params.event_type, (err as Error).message)
  }
}

/**
 * Batch-insert multiple events in a single round-trip.
 * Use for atomic multi-event sequences.
 */
export async function emitEvents(
  client: SupabaseClient,
  events: EmitEventParams[]
): Promise<void> {
  if (events.length === 0) return
  try {
    const rows = events.map(p => ({
      event_type:  p.event_type,
      source:      p.source,
      case_id:     p.case_id    ?? null,
      actor:       p.actor      ?? null,
      payload:     p.payload    ?? {},
      ...(p.occurred_at ? { occurred_at: p.occurred_at } : {}),
    }))

    const { error } = await client
      .schema('core')
      .from('events')
      .insert(rows)

    if (error) {
      console.error('[events] batch emit failed:', error.message)
    }
  } catch (err) {
    console.error('[events] batch emit threw:', (err as Error).message)
  }
}
