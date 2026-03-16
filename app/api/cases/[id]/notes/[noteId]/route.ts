/**
 * PATCH /api/cases/[id]/notes/[noteId]
 *
 * Supported actions:
 *   { is_pinned: boolean }    — pin/unpin (admin/attorney/manager or note author)
 *
 * Auth: session required. Pin requires elevated role or authorship.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth }                      from '@/auth'
import { createClient }              from '@supabase/supabase-js'

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ELEVATED = new Set(['admin', 'attorney', 'manager'])

type Params = { params: Promise<{ id: string; noteId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { noteId } = await params
  const role    = (session.user as { role?: string }).role    ?? 'staff'
  const staffId = (session.user as { staffId?: string }).staffId ?? null

  const body = await req.json().catch(() => ({}))

  const db = createClient(URL, KEY).schema('core')

  // Fetch existing note to check authorship
  const { data: existing } = await db
    .from('timeline_notes')
    .select('id, author_id, is_pinned')
    .eq('id', noteId)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  const isAuthor  = existing.author_id === staffId
  const canModify = ELEVATED.has(role) || isAuthor

  if (!canModify) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.is_pinned === 'boolean') update.is_pinned = body.is_pinned

  const { data: updated, error } = await db
    .from('timeline_notes')
    .update(update)
    .eq('id', noteId)
    .select('id, is_pinned')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, note: updated })
}
