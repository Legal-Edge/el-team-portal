import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'
import { supabaseAdmin }             from '@/lib/supabase'
import type { CaseView }             from '@/lib/cases/column-defs'

const PORTAL_OWNER_EMAIL = process.env.PORTAL_OWNER_EMAIL ?? 'novaj@rockpointgrowth.com'

// ── GET /api/cases/views ──────────────────────────────────────────────────────
// Returns team presets + personal views for the current user.
export async function GET() {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve staff user ID from email
  const { data: staffRow } = await supabaseAdmin
    .schema('staff')
    .from('staff_users')
    .select('id')
    .eq('email', session.email)
    .single()

  const staffId = staffRow?.id as string | undefined

  // Fetch team presets + this user's personal views
  let query = supabaseAdmin
    .schema('staff')
    .from('case_views')
    .select('*')
    .order('position', { ascending: true })

  if (staffId) {
    // Using or filter: team presets OR owned by this staff member
    query = query.or(`is_team_preset.eq.true,owner_id.eq.${staffId}`)
  } else {
    query = query.eq('is_team_preset', true)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ views: data ?? [] })
}

// ── POST /api/cases/views ─────────────────────────────────────────────────────
// Creates a new saved view (team preset requires admin).
export async function POST(req: NextRequest) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Partial<CaseView> & { is_team_preset?: boolean }
  const isAdmin = session.email === PORTAL_OWNER_EMAIL

  if (body.is_team_preset && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can create team presets' }, { status: 403 })
  }

  // Resolve staff user ID
  const { data: staffRow } = await supabaseAdmin
    .schema('staff')
    .from('staff_users')
    .select('id')
    .eq('email', session.email)
    .single()

  const { data, error } = await supabaseAdmin
    .schema('staff')
    .from('case_views')
    .insert({
      name:           body.name           ?? 'My View',
      owner_id:       staffRow?.id        ?? null,
      is_team_preset: body.is_team_preset ?? false,
      stage_tab:      body.stage_tab      ?? null,
      columns:        body.columns        ?? [],
      filters:        body.filters        ?? [],
      sort_by:        body.sort_by        ?? 'notes_last_updated',
      sort_dir:       body.sort_dir       ?? 'desc',
      position:       body.position       ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ view: data }, { status: 201 })
}

// ── PUT /api/cases/views?id=xxx ───────────────────────────────────────────────
// Updates an existing saved view (owner or admin).
export async function PUT(req: NextRequest) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const isAdmin = session.email === PORTAL_OWNER_EMAIL

  // Verify ownership (or admin override)
  const { data: existing } = await supabaseAdmin
    .schema('staff')
    .from('case_views')
    .select('owner_id, is_team_preset')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: staffRow } = await supabaseAdmin
    .schema('staff')
    .from('staff_users')
    .select('id')
    .eq('email', session.email)
    .single()

  if (!isAdmin && existing.owner_id !== staffRow?.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (existing.is_team_preset && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can edit team presets' }, { status: 403 })
  }

  const body = await req.json() as Partial<CaseView>
  const { data, error } = await supabaseAdmin
    .schema('staff')
    .from('case_views')
    .update({
      ...(body.name      !== undefined && { name:      body.name      }),
      ...(body.stage_tab !== undefined && { stage_tab: body.stage_tab }),
      ...(body.columns   !== undefined && { columns:   body.columns   }),
      ...(body.filters   !== undefined && { filters:   body.filters   }),
      ...(body.sort_by   !== undefined && { sort_by:   body.sort_by   }),
      ...(body.sort_dir  !== undefined && { sort_dir:  body.sort_dir  }),
      ...(body.position  !== undefined && { position:  body.position  }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ view: data })
}

// ── DELETE /api/cases/views?id=xxx ────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const isAdmin = session.email === PORTAL_OWNER_EMAIL

  const { data: existing } = await supabaseAdmin
    .schema('staff')
    .from('case_views')
    .select('owner_id, is_team_preset')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: staffRow } = await supabaseAdmin
    .schema('staff')
    .from('staff_users')
    .select('id')
    .eq('email', session.email)
    .single()

  if (!isAdmin && existing.owner_id !== staffRow?.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (existing.is_team_preset && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can delete team presets' }, { status: 403 })
  }

  const { error } = await supabaseAdmin
    .schema('staff')
    .from('case_views')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
