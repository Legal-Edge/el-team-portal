/**
 * POST /api/admin/reconcile-comms
 *
 * Server-side reconciliation of unresolved communications.
 * Matches core.communications rows where case_id = null AND needs_review = true
 * to cases via core.case_contacts.phone (normalized phone number).
 *
 * Protected by BACKFILL_IMPORT_TOKEN (same token, reused for admin ops).
 *
 * Body: {
 *   dryRun?:    boolean  (default false)
 *   batchSize?: number   (default 500)
 *   source?:    string   (filter by source_system, e.g. 'aloware')
 *   offset?:    number   (default 0, for pagination)
 * }
 *
 * Response: {
 *   dry_run:    boolean
 *   fetched:    number
 *   resolved:   number
 *   ambiguous:  number
 *   no_match:   number
 *   errors:     string[]
 *   samples:    { resolved: [], ambiguous: [], no_match: [] }  (dry_run only)
 *   has_more:   boolean
 *   next_offset: number
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getDb() {
  return createClient(SUPABASE_URL, SUPABASE_KEY).schema('core')
}

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  if (!IMPORT_TOKEN) {
    return NextResponse.json({ error: 'BACKFILL_IMPORT_TOKEN not configured' }, { status: 500 })
  }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (token !== IMPORT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { dryRun?: boolean; batchSize?: number; source?: string; offset?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const dryRun    = body.dryRun    ?? false
  const batchSize = Math.min(body.batchSize ?? 500, 1000)
  const source    = body.source    ?? null
  const offset    = body.offset    ?? 0

  const db = getDb()

  // ── Load phone map ────────────────────────────────────────────────────────
  const { data: contacts, error: contactsErr } = await db
    .from('case_contacts')
    .select('case_id, phone')

  if (contactsErr || !contacts) {
    return NextResponse.json({ error: `Failed to load case_contacts: ${contactsErr?.message}` }, { status: 500 })
  }

  const phoneMap = new Map<string, string[]>()
  for (const c of contacts as { case_id: string; phone: string }[]) {
    if (!c.phone) continue
    const existing = phoneMap.get(c.phone) ?? []
    if (!existing.includes(c.case_id)) existing.push(c.case_id)
    phoneMap.set(c.phone, existing)
  }

  // ── Fetch unresolved rows ─────────────────────────────────────────────────
  let query = db
    .from('communications')
    .select('id, source_system, direction, from_number, to_number, review_reason')
    .eq('needs_review', true)
    .is('case_id', null)
    .range(offset, offset + batchSize - 1)
    .order('id', { ascending: true })

  if (source) query = query.eq('source_system', source)

  const { data: rows, error: fetchErr } = await query
  if (fetchErr) {
    return NextResponse.json({ error: `Fetch error: ${fetchErr.message}` }, { status: 500 })
  }

  const fetched   = rows?.length ?? 0
  let resolved    = 0
  let ambiguous   = 0
  let noMatch     = 0
  const errors: string[] = []

  const samples = {
    resolved:  [] as object[],
    ambiguous: [] as object[],
    no_match:  [] as object[],
  }

  const toUpdate: { id: string; case_id: string | null; needs_review: boolean; review_reason: string | null }[] = []

  for (const row of (rows ?? []) as { id: string; source_system: string; direction: string; from_number: string | null; to_number: string | null; review_reason: string | null }[]) {
    const clientPhone = row.direction === 'inbound' ? row.from_number : row.to_number

    if (!clientPhone) {
      noMatch++
      if (samples.no_match.length < 10) samples.no_match.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: null, reason: 'no_contact_phone' })
      continue
    }

    const matches = phoneMap.get(clientPhone) ?? []

    if (matches.length === 0) {
      noMatch++
      if (samples.no_match.length < 10) samples.no_match.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: clientPhone, reason: 'no_case_for_phone' })
      continue
    }

    if (matches.length > 1) {
      ambiguous++
      toUpdate.push({ id: row.id, case_id: null, needs_review: true, review_reason: `multiple_cases_for_phone: ${matches.join(', ')}` })
      if (samples.ambiguous.length < 10) samples.ambiguous.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: clientPhone, matched_cases: matches })
      continue
    }

    resolved++
    toUpdate.push({ id: row.id, case_id: matches[0], needs_review: false, review_reason: null })
    if (samples.resolved.length < 10) samples.resolved.push({ id: row.id, source_system: row.source_system, direction: row.direction, phone: clientPhone, would_assign_case_id: matches[0] })
  }

  // ── Apply updates (live only) ─────────────────────────────────────────────
  if (!dryRun && toUpdate.length > 0) {
    const { error: upsertErr } = await db
      .from('communications')
      .upsert(toUpdate, { onConflict: 'id' })

    if (upsertErr) errors.push(upsertErr.message)
  }

  const hasMore    = fetched === batchSize
  const nextOffset = offset + fetched

  return NextResponse.json({
    dry_run:     dryRun,
    fetched,
    resolved,
    ambiguous,
    no_match:    noMatch,
    errors,
    ...(dryRun ? { samples } : {}),
    has_more:    hasMore,
    next_offset: nextOffset,
  })
}
