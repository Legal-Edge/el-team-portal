import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

export interface CommsInboxRow {
  case_id:              string
  case_number:          string | null
  case_status:          string
  hubspot_deal_id:      string
  client_first_name:    string | null
  client_last_name:     string | null
  client_full_name:     string | null   // pre-computed TRIM(CONCAT(...)) in view
  client_phone:         string | null
  client_email:         string | null
  assigned_attorney:    string | null
  attorney_name:        string | null
  last_inbound_at:      string | null
  last_outbound_at:     string | null
  last_inbound_channel: string | null
  awaiting_response:    boolean
  response_due_at:      string | null
  sla_status:           'ok' | 'due_soon' | 'overdue' | 'no_contact'
  unread_count:         number
  sla_sort:             number
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const filter   = searchParams.get('filter')   ?? 'all'     // all|awaiting|overdue|due_soon
  const attorney = searchParams.get('attorney') ?? ''
  const stage    = searchParams.get('stage')    ?? ''
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const page     = Math.max(parseInt(searchParams.get('page')  ?? '1'), 1)
  const offset   = (page - 1) * limit

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  let query = db
    .from('comms_inbox')
    .select('*', { count: 'exact' })

  // ── Filters ────────────────────────────────────────────────
  if (filter === 'awaiting')  query = query.eq('awaiting_response', true)
  if (filter === 'overdue')   query = query.eq('sla_status', 'overdue')
  if (filter === 'due_soon')  query = query.eq('sla_status', 'due_soon')
  // 'all' = no SLA filter (view already excludes no_contact cases)

  if (attorney) query = query.eq('assigned_attorney', attorney)
  if (stage)    query = query.eq('case_status', stage)

  // ── Sort: urgency first, then response deadline, then last inbound ──
  query = query
    .order('sla_sort',        { ascending: true })
    .order('response_due_at', { ascending: true,  nullsFirst: false })
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('[comms-inbox] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    rows:   data ?? [],
    total:  count ?? 0,
    page,
    limit,
  })
}
