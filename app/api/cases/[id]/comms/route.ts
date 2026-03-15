import { NextRequest, NextResponse }    from 'next/server'
import { getTeamSession }               from '@/lib/session'
import { createClient }                 from '@supabase/supabase-js'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const channel = searchParams.get('channel')

  // Staff role cannot see internal communications
  const canSeeInternal = session.role !== 'staff'

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Resolve case id (UUID or hubspot_deal_id)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: caseRow } = await db
    .from('cases')
    .select('id')
    .eq(isUUID ? 'id' : 'hubspot_deal_id', id)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  let query = db
    .from('communications')
    .select('id, channel, direction, subject, snippet, body, occurred_at, duration_seconds, outcome, resolution_method, needs_review, review_reason, hubspot_engagement_id, hubspot_contact_id, sender_email, sender_name, recipient_emails, from_number, to_number, recording_url, has_attachments, thread_id, is_internal')
    .eq('case_id', caseRow.id)
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false })
    .limit(200)

  if (channel)             query = query.eq('channel', channel)
  if (!canSeeInternal)     query = query.eq('is_internal', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Channel counts (role-filtered)
  let countQuery = db
    .from('communications')
    .select('channel, needs_review')
    .eq('case_id', caseRow.id)
    .eq('is_deleted', false)

  if (!canSeeInternal) countQuery = countQuery.eq('is_internal', false)

  const { data: all } = await countQuery

  const counts: Record<string, number> = {}
  let reviewCount = 0
  for (const r of all ?? []) {
    counts[r.channel] = (counts[r.channel] ?? 0) + 1
    if (r.needs_review) reviewCount++
  }

  return NextResponse.json({
    comms:       data ?? [],
    counts,
    reviewCount,
    total:       all?.length ?? 0,
    canSeeInternal,
  })
}
