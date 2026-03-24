/**
 * GET /api/cases/[id]/timeline
 *
 * Unified case timeline — merges comms + events + notes from Supabase.
 * Directly queries the underlying tables instead of the RPC so that
 * SMS, email, and call records from core.communications always surface.
 *
 * Query params:
 *   before_ts  — cursor timestamp for pagination (ISO string)
 *   limit      — max items (default 50, max 100)
 *
 * Returns:
 *   { items: TimelineItem[], has_more: boolean, next_cursor: string | null }
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth }                      from '@/auth'
import { createClient }              from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export interface TimelineItem {
  source:       'event' | 'comm' | 'note'
  id:           string
  ts:           string
  item_type:    string
  body:         string | null
  author_ref:   string | null
  author_name:  string | null
  visibility:   string
  is_pinned:    boolean
  payload:      Record<string, unknown> | null
  direction:    'inbound' | 'outbound' | null
  needs_review: boolean
}

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getTeamSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id }  = await params
  const role    = (session.user as { role?: string }).role       ?? 'staff'
  const staffId = (session.user as { staffId?: string }).staffId ?? NIL_UUID

  const { searchParams } = new URL(req.url)
  const beforeTs = searchParams.get('before_ts') ?? new Date().toISOString()
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)

  const db = createClient(SB_URL, SB_KEY)

  // Resolve case UUID from id (could be UUID or hubspot_deal_id)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow } = await db
    .schema('core')
    .from('cases')
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!caseRow?.id) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  const caseId = caseRow.id

  const canSeeInternal = role !== 'staff'
  const ELEVATED = ['admin', 'attorney', 'manager']

  // ── Fetch all three sources in parallel ───────────────────────────────────

  const [commsResult, eventsResult, notesResult] = await Promise.all([

    // core.communications — SMS, calls, emails from Aloware
    db.schema('core').from('communications')
      .select('id, channel, direction, body, snippet, subject, occurred_at, needs_review, is_internal, from_number, to_number, sender_email, hubspot_engagement_id')
      .eq('case_id', caseId)
      .eq('is_deleted', false)
      .lt('occurred_at', beforeTs)
      .order('occurred_at', { ascending: false })
      .limit(limit + 1),

    // core.events — stage changes, doc uploads, portal activity
    db.schema('core').from('events')
      .select('id, event_type, occurred_at, actor_ref, payload')
      .eq('case_id', caseId)
      .lt('occurred_at', beforeTs)
      .order('occurred_at', { ascending: false })
      .limit(limit + 1),

    // core.timeline_notes — team notes
    db.schema('core').from('timeline_notes')
      .select('id, note_type, body, visibility, is_pinned, created_at, author_id')
      .eq('case_id', caseId)
      .eq('is_deleted', false)
      .lt('created_at', beforeTs)
      .order('created_at', { ascending: false })
      .limit(limit + 1),

  ])

  // ── Build unified items ───────────────────────────────────────────────────

  const items: TimelineItem[] = []

  // Comms
  for (const c of commsResult.data ?? []) {
    if (!canSeeInternal && c.is_internal) continue
    const bodyText = c.body ?? c.snippet ?? c.subject ?? null
    const authorRef = c.channel === 'sms' || c.channel === 'call'
      ? (c.from_number ?? c.to_number ?? c.sender_email ?? null)
      : (c.sender_email ?? null)
    items.push({
      source:      'comm',
      id:          c.id,
      ts:          c.occurred_at,
      item_type:   c.channel,   // 'sms' | 'call' | 'email'
      body:        bodyText,
      author_ref:  authorRef,
      author_name: null,
      visibility:  c.is_internal ? 'internal' : 'public',
      is_pinned:   false,
      payload:     null,
      direction:   (c.direction as 'inbound' | 'outbound' | null) ?? null,
      needs_review: Boolean(c.needs_review),
    })
  }

  // Events
  for (const e of eventsResult.data ?? []) {
    items.push({
      source:      'event',
      id:          e.id,
      ts:          e.occurred_at,
      item_type:   e.event_type,
      body:        null,
      author_ref:  e.actor_ref ?? null,
      author_name: null,
      visibility:  'internal',
      is_pinned:   false,
      payload:     (e.payload as Record<string, unknown>) ?? null,
      direction:   null,
      needs_review: false,
    })
  }

  // Notes — with visibility filtering
  const noteAuthorIds: string[] = []
  for (const n of notesResult.data ?? []) {
    const vis = n.visibility ?? 'internal'
    // Filter by role
    if (vis === 'private' && n.author_id !== staffId) continue
    if (vis === 'restricted' && !ELEVATED.includes(role)) continue
    if (vis === 'internal' && !canSeeInternal) continue
    if (n.author_id && n.author_id !== NIL_UUID) noteAuthorIds.push(n.author_id)
    items.push({
      source:      'note',
      id:          n.id,
      ts:          n.created_at,
      item_type:   n.note_type ?? 'general',
      body:        n.body ?? null,
      author_ref:  n.author_id ?? null,
      author_name: null,   // resolved below
      visibility:  vis,
      is_pinned:   Boolean(n.is_pinned),
      payload:     null,
      direction:   null,
      needs_review: false,
    })
  }

  // Resolve note author names
  if (noteAuthorIds.length > 0) {
    const { data: staffRows } = await db
      .schema('staff')
      .from('staff_users')
      .select('id, display_name')
      .in('id', [...new Set(noteAuthorIds)])
    const authorMap: Record<string, string> = {}
    for (const s of staffRows ?? []) authorMap[s.id] = s.display_name ?? 'Unknown'
    for (const item of items) {
      if (item.source === 'note' && item.author_ref) {
        item.author_name = authorMap[item.author_ref] ?? null
      }
    }
  }

  // ── Add HubSpot engagements from core.hubspot_engagements ────────────────
  // Skip tasks/meetings server-side since we already filter those at sync time.
  // Only fetch when not paginating (engagements are all synced, no cursor needed).
  const isPaginating = searchParams.has('before_ts')
  if (!isPaginating) {
    const { data: engRows } = await db
      .schema('core')
      .from('hubspot_engagements')
      .select('engagement_id, engagement_type, direction, occurred_at, body, call_summary, duration_ms, author_email, contact_id, contact_name, contact_initials, contact_color, contact_role, metadata')
      .eq('case_id', caseId)
      .order('occurred_at', { ascending: false })

    for (const eng of engRows ?? []) {
      items.push({
        source:           'hubspot' as 'event',    // cast to satisfy type, handled by client
        id:               `hs_${eng.engagement_id}`,
        ts:               eng.occurred_at,
        item_type:        eng.engagement_type.toLowerCase(),
        body:             eng.body ?? null,
        author_ref:       eng.author_email ?? null,
        author_name:      null,
        visibility:       'internal',
        is_pinned:        false,
        payload:          null,
        direction:        (eng.direction as 'inbound' | 'outbound' | null) ?? null,
        needs_review:     false,
        // Extended fields (matched by client via cast)
        call_summary:     eng.call_summary ?? null,
        engagement_id:    eng.engagement_id,
        duration_ms:      eng.duration_ms ?? null,
        contact_id:       eng.contact_id ?? null,
        contact_name:     eng.contact_name ?? null,
        contact_initials: eng.contact_initials ?? null,
        contact_color:    eng.contact_color ?? null,
        contact_role:     eng.contact_role ?? null,
        metadata:         (eng.metadata as Record<string, unknown> | null) ?? null,
      } as unknown as TimelineItem)
    }
  }

  // Re-sort everything after merging sources
  items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  const finalHasMore  = items.length > limit
  const finalPage     = items.slice(0, limit)
  const finalCursor   = finalHasMore ? finalPage[finalPage.length - 1]?.ts ?? null : null

  return NextResponse.json({ items: finalPage, has_more: finalHasMore, next_cursor: finalCursor })
}

// ── Auth helper (avoid double import) ────────────────────────────────────────
async function getTeamSession() {
  const session = await auth()
  if (!session?.user) return null
  return session as typeof session & {
    user: { role?: string; staffId?: string }
  }
}
