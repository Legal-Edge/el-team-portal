/**
 * GET /api/cases/[id]/timeline
 *
 * Calls core.case_timeline_feed() — returns merged events + comms + notes
 * in reverse-chronological order with role-based visibility filtering.
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
  author_name:  string | null   // resolved for notes (author_ref is UUID there)
  visibility:   string
  is_pinned:    boolean
  payload:      Record<string, unknown> | null
  // Comm enrichments (populated for source='comm')
  direction:    'inbound' | 'outbound' | null
  needs_review: boolean
}

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth()
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

  // Call core.case_timeline_feed() via schema-scoped RPC
  const { data: rows, error } = await db
    .schema('core')
    .rpc('case_timeline_feed', {
      p_case_id:   caseRow.id,
      p_role:      role,
      p_staff_id:  staffId,
      p_limit:     limit + 1,   // fetch one extra to detect has_more
      p_before_ts: beforeTs,
    }) as { data: Array<Record<string, unknown>> | null; error: unknown }

  if (error) {
    console.error('[timeline] rpc error:', (error as { message?: string }).message)
    return NextResponse.json({ error: (error as { message?: string }).message }, { status: 500 })
  }

  const allRows = rows ?? []
  const hasMore = allRows.length > limit
  const items   = allRows.slice(0, limit) as Array<Record<string, unknown>>

  // Resolve display names for note authors (author_ref is a UUID for notes)
  const noteAuthorIds = [...new Set(
    items
      .filter(r => r.source === 'note' && r.author_ref)
      .map(r => r.author_ref as string)
  )].filter(id => id !== NIL_UUID)

  let authorMap: Record<string, string> = {}
  if (noteAuthorIds.length > 0) {
    const { data: staffRows } = await db
      .schema('staff')
      .from('staff_users')
      .select('id, display_name')
      .in('id', noteAuthorIds)
    for (const s of staffRows ?? []) {
      authorMap[s.id] = s.display_name ?? 'Unknown'
    }
  }

  // Batch-fetch direction + needs_review for comm items
  const commIds = items.filter(r => r.source === 'comm').map(r => r.id as string)
  const commMeta: Record<string, { direction: string | null; needs_review: boolean }> = {}
  if (commIds.length > 0) {
    const { data: commRows } = await db
      .schema('core')
      .from('communications')
      .select('id, direction, needs_review')
      .in('id', commIds)
    for (const c of commRows ?? []) {
      commMeta[c.id] = { direction: c.direction ?? null, needs_review: Boolean(c.needs_review) }
    }
  }

  const result: TimelineItem[] = items.map(r => ({
    source:      r.source      as TimelineItem['source'],
    id:          r.id          as string,
    ts:          r.ts          as string,
    item_type:   r.item_type   as string,
    body:        (r.body       as string | null) ?? null,
    author_ref:  (r.author_ref as string | null) ?? null,
    author_name: r.source === 'note'
      ? (authorMap[r.author_ref as string] ?? 'Unknown')
      : null,
    visibility:  (r.visibility as string) ?? 'internal',
    is_pinned:    Boolean(r.is_pinned),
    payload:      (r.payload    as Record<string, unknown> | null) ?? null,
    direction:    (r.source === 'comm' ? (commMeta[r.id as string]?.direction ?? null) : null) as TimelineItem['direction'],
    needs_review: r.source === 'comm' ? (commMeta[r.id as string]?.needs_review ?? false) : false,
  }))

  const nextCursor = hasMore ? result[result.length - 1]?.ts ?? null : null

  return NextResponse.json({ items: result, has_more: hasMore, next_cursor: nextCursor })
}
