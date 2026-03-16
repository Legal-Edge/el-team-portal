/**
 * GET /api/comms-stats
 *
 * Aggregate comms health KPIs from core.comms_state.
 * Used by the dashboard for live comms health cards.
 *
 * Returns:
 *   { awaiting, overdue, due_soon, unread_total, total_with_comms, fetched_at }
 */
import { NextResponse }  from 'next/server'
import { auth }          from '@/auth'
import { createClient }  from '@supabase/supabase-js'

export interface CommsStats {
  awaiting:         number
  overdue:          number
  due_soon:         number
  unread_total:     number
  total_with_comms: number
  fetched_at:       string
}

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const [awaiting, overdue, dueSoon, unreadAgg, totalWithComms] = await Promise.all([
    db.from('comms_state').select('*', { count: 'exact', head: true }).eq('awaiting_response', true),
    db.from('comms_state').select('*', { count: 'exact', head: true }).eq('sla_status', 'overdue'),
    db.from('comms_state').select('*', { count: 'exact', head: true }).eq('sla_status', 'due_soon'),
    db.from('comms_state').select('unread_count').gt('unread_count', 0),
    db.from('comms_state').select('*', { count: 'exact', head: true }).not('last_inbound_at', 'is', null),
  ])

  const unreadTotal = (unreadAgg.data ?? []).reduce((sum, r) => sum + (r.unread_count ?? 0), 0)

  const stats: CommsStats = {
    awaiting:         awaiting.count    ?? 0,
    overdue:          overdue.count     ?? 0,
    due_soon:         dueSoon.count     ?? 0,
    unread_total:     unreadTotal,
    total_with_comms: totalWithComms.count ?? 0,
    fetched_at:       new Date().toISOString(),
  }

  return NextResponse.json(stats)
}
