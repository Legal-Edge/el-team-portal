/**
 * POST /api/admin/backfill-sms
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
import { createHash } from 'crypto'

const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SOURCE_SYSTEM = 'aloware_backfill'

interface BackfillRecord {
  direction:    'inbound' | 'outbound'
  body:         string | null
  snippet:      string | null
  occurred_at:  string | null
  from_number:  string | null
  to_number:    string | null
  thread_id:    string
  client_phone: string | null
  raw_metadata: Record<string, unknown>
}

interface CaseContact {
  case_id: string
  phone:   string
}

// Cache case contacts in module scope (survives warm lambda invocations)
let _phoneMap: Record<string, string[]> | null = null

async function getPhoneMap(coreDb: ReturnType<typeof createClient>) {
  if (_phoneMap) return _phoneMap

  const { data, error } = await coreDb
    .from('case_contacts')
    .select('case_id, phone') as { data: CaseContact[] | null, error: unknown }

  if (error || !data) {
    console.error('Failed to load case_contacts:', error)
    return {}
  }

  const map: Record<string, string[]> = {}
  for (const c of data) {
    if (!c.phone) continue
    if (!map[c.phone]) map[c.phone] = []
    if (!map[c.phone].includes(c.case_id)) map[c.phone].push(c.case_id)
  }

  _phoneMap = map
  return map
}

function resolveCase(phoneMap: Record<string, string[]>, clientPhone: string | null) {
  if (!clientPhone) return { caseId: null, needsReview: true, reviewReason: 'no_contact_phone' }

  const matches = phoneMap[clientPhone] ?? []
  if (matches.length === 0) return { caseId: null, needsReview: true,  reviewReason: 'no_case_for_phone' }
  if (matches.length > 1)  return { caseId: null, needsReview: true,  reviewReason: 'multiple_cases_for_phone' }
  return { caseId: matches[0], needsReview: false, reviewReason: null }
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

  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'records must be a non-empty array' }, { status: 400 })
  }

  // ── Supabase client ─────────────────────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const coreDb   = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: 'core' } })

  // ── Load existing hashes for dedup ──────────────────────────────────────────
  const incomingHashes = records
    .map(r => r.raw_metadata?.import_hash as string)
    .filter(Boolean)

  let existingHashes = new Set<string>()

  if (incomingHashes.length > 0 && !dryRun) {
    // Check which hashes already exist — use raw SQL via rpc to avoid ORM complexity
    const { data: existing } = await coreDb
      .from('communications')
      .select('raw_metadata')
      .eq('source_system', SOURCE_SYSTEM)
      .not('raw_metadata', 'is', null)

    for (const row of existing ?? []) {
      const h = (row.raw_metadata as Record<string, string>)?.import_hash
      if (h) existingHashes.add(h)
    }
  }

  // ── Phone map ────────────────────────────────────────────────────────────────
  const phoneMap = await getPhoneMap(coreDb)

  // ── Build insert records ─────────────────────────────────────────────────────
  const toInsert: Record<string, unknown>[] = []
  let skipped       = 0
  let needsReview   = 0

  for (const rec of records) {
    const importHash = rec.raw_metadata?.import_hash as string

    // Dedup check
    if (importHash && existingHashes.has(importHash)) {
      skipped++
      continue
    }

    // Case resolution
    const { caseId, needsReview: flag, reviewReason } = resolveCase(phoneMap, rec.client_phone ?? null)
    if (flag) needsReview++

    toInsert.push({
      case_id:        caseId,
      channel:        'sms',
      direction:      rec.direction,
      body:           rec.body,
      snippet:        rec.snippet,
      occurred_at:    rec.occurred_at,
      from_number:    rec.from_number,
      to_number:      rec.to_number,
      thread_id:      rec.thread_id,
      source_system:  SOURCE_SYSTEM,
      needs_review:   flag,
      review_reason:  reviewReason,
      raw_metadata:   rec.raw_metadata,
    })
  }

  // ── Insert ───────────────────────────────────────────────────────────────────
  let inserted  = 0
  const errors: string[] = []

  if (!dryRun && toInsert.length > 0) {
    const { data, error } = await coreDb
      .from('communications')
      .insert(toInsert)
      .select('id')

    if (error) {
      errors.push(error.message)
    } else {
      inserted = data?.length ?? toInsert.length
    }
  } else if (dryRun) {
    inserted = toInsert.length  // report what would be inserted
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
