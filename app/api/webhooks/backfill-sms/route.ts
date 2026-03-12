/**
 * POST /api/webhooks/backfill-sms
 *
 * One-time endpoint to receive batches of pre-processed Aloware SMS records
 * and insert them into core.communications.
 *
 * Protected by BACKFILL_IMPORT_TOKEN env var (Bearer token in Authorization header).
 * Runs server-side on Vercel — reads Supabase credentials from process.env.
 *
 * Body: { records: BackfillRecord[], dryRun?: boolean }
 * Response: { inserted, skipped, needsReview, errors }
 *
 * DELETE THIS FILE after import is complete.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Historical backfill rows use the same source_system as live webhook rows.
// This unifies all Aloware communications under one identity namespace.
// Dedup key differs by origin:
//   live webhook  → source_record_id = aloware_id (integer message ID from Aloware)
//   Excel backfill → source_record_id = import_hash (SHA-256 of row content, stable synthetic key)
// Both are unique within (source_system='aloware', source_record_id).
const SOURCE_SYSTEM = 'aloware'

interface BackfillRecord {
  direction:      'inbound' | 'outbound'
  body:           string | null
  snippet:        string | null
  occurred_at:    string | null
  from_number:    string | null
  to_number:      string | null
  thread_id:      string
  client_phone:   string | null
  raw_metadata:   Record<string, unknown>
}

// Cache case contacts across warm invocations
let _phoneMap: Record<string, string[]> | null = null

async function getPhoneMap(): Promise<Record<string, string[]>> {
  if (_phoneMap) return _phoneMap

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const { data, error } = await supabase
    .schema('core')
    .from('case_contacts')
    .select('case_id, phone')

  if (error || !data) {
    console.error('Failed to load case_contacts:', error)
    return {}
  }

  const map: Record<string, string[]> = {}
  for (const c of data as { case_id: string; phone: string }[]) {
    if (!c.phone) continue
    if (!map[c.phone]) map[c.phone] = []
    if (!map[c.phone].includes(c.case_id)) map[c.phone].push(c.case_id)
  }

  _phoneMap = map
  return map
}

function resolveCase(phoneMap: Record<string, string[]>, clientPhone: string | null) {
  if (!clientPhone) return { caseId: null as string | null, needsReview: true, reviewReason: 'no_contact_phone' }

  const matches = phoneMap[clientPhone] ?? []
  if (matches.length === 0) return { caseId: null as string | null, needsReview: true,  reviewReason: 'no_case_for_phone' }
  if (matches.length > 1)  return { caseId: null as string | null, needsReview: true,  reviewReason: 'multiple_cases_for_phone' }
  return { caseId: matches[0] as string | null, needsReview: false, reviewReason: null as string | null }
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  if (!IMPORT_TOKEN) {
    return NextResponse.json({ error: 'BACKFILL_IMPORT_TOKEN not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token      = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (token !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { records: BackfillRecord[]; dryRun?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { records, dryRun = false } = body

  if (!Array.isArray(records)) {
    return NextResponse.json({ error: 'records must be an array' }, { status: 400 })
  }

  // Empty batch — just acknowledge
  if (records.length === 0) {
    return NextResponse.json({ dry_run: dryRun, received: 0, inserted: 0, skipped: 0, needs_review: 0, errors: [] })
  }

  // ── Phone map ────────────────────────────────────────────────────────────────
  const phoneMap = await getPhoneMap()

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb   = supabase.schema('core')

  // ── Build upsert records ─────────────────────────────────────────────────────
  // No pre-check query needed — upsert with ignoreDuplicates handles dedup
  // atomically at the DB level via uq_communications_source (source_system, source_record_id).
  // This avoids the Supabase 1,000-row default page limit that caused pre-checks
  // to silently miss existing rows on large tables.
  const toInsert: Record<string, unknown>[] = []
  let needsReview = 0

  for (const rec of records) {
    const sourceRecordId = rec.raw_metadata?.import_hash as string | undefined

    // Case resolution via normalized phone
    const { caseId, needsReview: flag, reviewReason } = resolveCase(phoneMap, rec.client_phone ?? null)
    if (flag) needsReview++

    toInsert.push({
      // Source identity — source-agnostic dedup key
      source_system:          SOURCE_SYSTEM,
      source_record_id:       sourceRecordId ?? null,

      // Case linkage (nullable — resolved later via reconciliation)
      case_id:                caseId,

      // Channel
      channel:                'sms',
      direction:              rec.direction,

      // Content
      body:                   rec.body ?? null,
      snippet:                rec.snippet ?? null,

      // Timing
      occurred_at:            rec.occurred_at ?? null,

      // Phone fields
      from_number:            rec.from_number ?? null,
      to_number:              rec.to_number ?? null,
      thread_id:              rec.thread_id ?? null,

      // SMS-inapplicable fields — explicit clean defaults
      hubspot_engagement_id:  null,   // not applicable for Aloware
      recipient_emails:       [],     // not applicable for SMS
      cc_emails:              [],     // not applicable for SMS
      attachments_metadata:   [],     // not applicable for SMS
      has_attachments:        false,  // not applicable for SMS

      // Review flags
      needs_review:           flag,
      review_reason:          reviewReason ?? null,

      // Audit
      raw_metadata:           rec.raw_metadata,
      is_deleted:             false,
    })
  }

  // ── Upsert ───────────────────────────────────────────────────────────────────
  // ignoreDuplicates: true → existing rows are silently skipped (no error).
  // Rows returned in data[] are only the newly inserted ones.
  // Skipped = sent - inserted (duplicates resolved at DB level).
  let inserted  = 0
  let skipped   = 0
  const errors: string[] = []

  if (!dryRun && toInsert.length > 0) {
    const { data, error } = await coreDb
      .from('communications')
      .upsert(toInsert, {
        onConflict:       'source_system,source_record_id',
        ignoreDuplicates: true,
      })
      .select('id')

    if (error) {
      errors.push(error.message)
    } else {
      inserted = (data as unknown[])?.length ?? 0
      skipped  = toInsert.length - inserted
    }
  } else if (dryRun) {
    inserted = toInsert.length
  }

  return NextResponse.json({
    dry_run:      dryRun,
    received:     records.length,
    inserted:     inserted,
    skipped:      skipped,
    needs_review: needsReview,
    errors:       errors,
  })
}
