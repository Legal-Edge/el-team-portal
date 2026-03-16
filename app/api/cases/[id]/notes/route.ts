/**
 * GET  /api/cases/[id]/notes  — list notes with visibility filtering
 * POST /api/cases/[id]/notes  — create a note
 *
 * Visibility rules (enforced server-side):
 *   public / internal  → all authenticated staff
 *   restricted         → admin, attorney, manager only
 *   private            → author only (staffId match)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth }                      from '@/auth'
import { createClient }              from '@supabase/supabase-js'

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const ELEVATED = new Set(['admin', 'attorney', 'manager'])

const VALID_NOTE_TYPES = new Set([
  'general', 'call_summary', 'verbal_update', 'attorney_note',
  'case_manager_note', 'milestone', 'client_communication', 'intake_note',
])
const VALID_VISIBILITY = new Set(['public', 'internal', 'restricted', 'private'])

type Params = { params: Promise<{ id: string }> }

// ── GET — list notes ────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const role    = (session.user as { role?: string }).role    ?? 'staff'
  const staffId = (session.user as { staffId?: string }).staffId ?? null

  const db = createClient(URL, KEY).schema('core')

  // Resolve case UUID
  const isUUID = /^[0-9a-f-]{36}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  // Fetch notes — join staff_users for author name
  // Visibility filtering done in application layer (cross-schema join makes RLS hard)
  const { data: notes, error } = await db
    .from('timeline_notes')
    .select(`
      id, note_type, visibility, body, is_pinned,
      created_at, edited_at,
      author_id
    `)
    .eq('case_id', caseRow.id)
    .eq('is_deleted', false)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Visibility filter (server-side enforcement)
  const visible = (notes ?? []).filter(n => {
    if (n.visibility === 'public' || n.visibility === 'internal') return true
    if (n.visibility === 'restricted') return ELEVATED.has(role)
    if (n.visibility === 'private')    return n.author_id === staffId
    return false
  })

  // Fetch author display names for visible notes
  const authorIds = [...new Set(visible.map(n => n.author_id).filter(Boolean))]
  let authorMap: Record<string, string> = {}
  if (authorIds.length > 0) {
    const staffDb = createClient(URL, KEY).schema('staff')
    const { data: staffRows } = await staffDb
      .from('staff_users')
      .select('id, display_name')
      .in('id', authorIds)
    for (const s of staffRows ?? []) {
      authorMap[s.id] = s.display_name ?? 'Unknown'
    }
  }

  const result = visible.map(n => ({
    ...n,
    author_name: authorMap[n.author_id] ?? 'Unknown',
    is_mine: n.author_id === staffId,
  }))

  return NextResponse.json({ notes: result })
}

// ── POST — create note ──────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const staffId = (session.user as { staffId?: string }).staffId ?? null
  if (!staffId) return NextResponse.json({ error: 'Staff identity not found' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { note_type = 'general', visibility = 'internal', body: noteBody, is_pinned = false } = body

  if (!noteBody?.trim())              return NextResponse.json({ error: 'Body is required' }, { status: 400 })
  if (!VALID_NOTE_TYPES.has(note_type)) return NextResponse.json({ error: 'Invalid note_type' }, { status: 400 })
  if (!VALID_VISIBILITY.has(visibility)) return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 })

  const db = createClient(URL, KEY).schema('core')

  // Resolve case UUID
  const isUUID = /^[0-9a-f-]{36}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const { data: note, error } = await db
    .from('timeline_notes')
    .insert({
      case_id:    caseRow.id,
      author_id:  staffId,
      note_type,
      visibility,
      body:       noteBody.trim(),
      is_pinned:  Boolean(is_pinned),
    })
    .select('id, note_type, visibility, body, is_pinned, created_at, author_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ note: { ...note, is_mine: true } }, { status: 201 })
}
