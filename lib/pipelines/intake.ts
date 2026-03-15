/**
 * lib/pipelines/intake.ts
 *
 * Intake state pipeline — Supabase is the source of truth.
 *
 * Architecture:
 *   HubSpot el_app_status → sync → core.case_state.intake_status  (read direction)
 *   Platform update → core.case_state.intake_status → HubSpot write-back  (write direction)
 *
 * Rule: nothing outside this file should write intake_status directly.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { PLATFORM_EVENTS, EVENT_SOURCES, emitEvent } from '@/lib/events'

// ── Controlled intake status vocabulary ──────────────────────────────────────
// Mirrors HubSpot el_app_status enum exactly.
// Changing these requires updating the HubSpot property definition too.

export const INTAKE_STATUS = {
  // Intake questionnaire batches
  BATCH_1_NEEDED:    'intake_batch_1_needed',
  BATCH_2_NEEDED:    'intake_batch_2_needed',
  BATCH_3_NEEDED:    'intake_batch_3_needed',
  BATCH_4_NEEDED:    'intake_batch_4_needed',
  BATCH_5_NEEDED:    'intake_batch_5_needed',
  BATCH_6_NEEDED:    'intake_batch_6_needed',
  BATCH_7_NEEDED:    'intake_batch_7_needed',

  // Review stages
  UNDER_REVIEW:      'intake_under_review',
  DOCS_NEEDED:       'intake_docs_needed',
  ATTORNEY_REVIEW:   'intake_attorney_review',
  CASE_APPROVED:     'intake_case_approved',

  // Legal stages
  CASE_ACTIVE:       'legal_case_active',
  CASE_RESOLVED:     'legal_case_resolved',

  // Default
  NOT_STARTED:       'not_started',
} as const

export type IntakeStatus = typeof INTAKE_STATUS[keyof typeof INTAKE_STATUS]

// Human-readable labels for the UI
export const INTAKE_STATUS_LABELS: Record<string, string> = {
  not_started:              'Not Started',
  intake_batch_1_needed:    'Batch 1 Needed',
  intake_batch_2_needed:    'Batch 2 Needed',
  intake_batch_3_needed:    'Batch 3 Needed',
  intake_batch_4_needed:    'Batch 4 Needed',
  intake_batch_5_needed:    'Batch 5 Needed',
  intake_batch_6_needed:    'Batch 6 Needed',
  intake_batch_7_needed:    'Batch 7 Needed',
  intake_under_review:      'Under Review',
  intake_docs_needed:       'Documents Needed',
  intake_attorney_review:   'Attorney Review',
  intake_case_approved:     'Case Approved',
  legal_case_active:        'Case Active',
  legal_case_resolved:      'Case Resolved',
}

// Badge colors for the UI
export const INTAKE_STATUS_COLORS: Record<string, string> = {
  not_started:              'bg-gray-100 text-gray-500',
  intake_batch_1_needed:    'bg-blue-100 text-blue-700',
  intake_batch_2_needed:    'bg-blue-100 text-blue-700',
  intake_batch_3_needed:    'bg-blue-100 text-blue-700',
  intake_batch_4_needed:    'bg-blue-100 text-blue-700',
  intake_batch_5_needed:    'bg-blue-100 text-blue-700',
  intake_batch_6_needed:    'bg-blue-100 text-blue-700',
  intake_batch_7_needed:    'bg-blue-100 text-blue-700',
  intake_under_review:      'bg-yellow-100 text-yellow-700',
  intake_docs_needed:       'bg-orange-100 text-orange-700',
  intake_attorney_review:   'bg-purple-100 text-purple-700',
  intake_case_approved:     'bg-green-100 text-green-700',
  legal_case_active:        'bg-teal-100 text-teal-700',
  legal_case_resolved:      'bg-emerald-100 text-emerald-700',
}

// ── Batch number derivation ───────────────────────────────────────────────────
// Returns how many batches are complete based on current status.
export function completedBatchCount(status: string | null): number {
  if (!status) return 0
  const match = status.match(/^intake_batch_(\d+)_needed$/)
  if (match) return parseInt(match[1]) - 1
  if ([
    'intake_under_review', 'intake_docs_needed',
    'intake_attorney_review', 'intake_case_approved',
    'legal_case_active', 'legal_case_resolved',
  ].includes(status)) return 7
  return 0
}

// ── Sync from HubSpot (inbound direction) ────────────────────────────────────
/**
 * Called by the HubSpot sync pipeline when a deal is upserted.
 * Updates core.case_state.intake_status to match HubSpot's el_app_status.
 * This is the INBOUND direction — HubSpot is feeding the platform.
 */
export async function syncIntakeFromHubSpot(
  client:      SupabaseClient,
  caseId:      string,
  elAppStatus: string | null,
): Promise<void> {
  if (!caseId) return
  const intakeStatus = elAppStatus ?? INTAKE_STATUS.NOT_STARTED

  await client.schema('core').from('case_state').upsert({
    case_id:         caseId,
    intake_status:   intakeStatus,
    intake_batch:    completedBatchCount(intakeStatus),
    last_event_at:   new Date().toISOString(),
    last_event_type: 'hubspot_sync',
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'case_id', ignoreDuplicates: false })
}

// ── Set intake status (platform → HubSpot) ───────────────────────────────────
/**
 * Called when staff update intake status from within the platform.
 * 1. Updates core.case_state (Supabase = truth)
 * 2. Emits intake.field_updated event
 * 3. Writes back to HubSpot deal property (side effect)
 *
 * @param client        Service role Supabase client
 * @param caseId        UUID of the case
 * @param hubspotDealId HubSpot deal ID string (for write-back)
 * @param newStatus     New intake status value
 * @param actor         Who made the change (email)
 */
export async function setIntakeStatus(
  client:        SupabaseClient,
  caseId:        string,
  hubspotDealId: string,
  newStatus:     IntakeStatus,
  actor:         string,
): Promise<{ error: string | null }> {
  const coreDb = client.schema('core')

  // Read current status for change detection
  const { data: existing } = await coreDb
    .from('case_state')
    .select('intake_status')
    .eq('case_id', caseId)
    .maybeSingle()

  const prevStatus = existing?.intake_status ?? null
  if (prevStatus === newStatus) return { error: null } // no-op

  // 1. Update Supabase (source of truth)
  const { error: stateErr } = await coreDb.from('case_state').upsert({
    case_id:         caseId,
    intake_status:   newStatus,
    intake_batch:    completedBatchCount(newStatus),
    last_event_at:   new Date().toISOString(),
    last_event_type: PLATFORM_EVENTS.INTAKE_FIELD_UPDATED,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'case_id', ignoreDuplicates: false })

  if (stateErr) return { error: stateErr.message }

  // Also update core.cases.el_app_status mirror
  await coreDb.from('cases')
    .update({ el_app_status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', caseId)

  // 2. Emit event
  await emitEvent(client, {
    event_type: PLATFORM_EVENTS.INTAKE_FIELD_UPDATED,
    source:     EVENT_SOURCES.PORTAL_UI,
    case_id:    caseId,
    actor,
    payload:    { field: 'intake_status', from: prevStatus, to: newStatus, hubspot_deal_id: hubspotDealId },
  })

  // 3. Write back to HubSpot (side effect — non-blocking)
  writeBackToHubSpot(hubspotDealId, newStatus).catch(err =>
    console.error(`[intake] HubSpot write-back failed for deal ${hubspotDealId}:`, err.message)
  )

  return { error: null }
}

// ── HubSpot write-back ────────────────────────────────────────────────────────
/**
 * Writes el_app_status back to the HubSpot deal.
 * Called as a non-blocking side effect — failures are logged, never thrown.
 */
async function writeBackToHubSpot(dealId: string, status: string): Promise<void> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) { console.error('[intake] HUBSPOT_ACCESS_TOKEN not set'); return }

  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
    method:  'PATCH',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { el_app_status: status } }),
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HubSpot PATCH ${res.status}: ${body.slice(0, 200)}`)
  }
}
