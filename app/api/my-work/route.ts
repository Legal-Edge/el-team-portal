/**
 * GET /api/my-work
 *
 * Returns tasks from core.my_work_queue for the authenticated staff member.
 * Sorted by urgency_sort ASC (overdue → due today → urgent → high → normal).
 * Used by the /my-work page.
 */
import { NextRequest, NextResponse }  from 'next/server'
import { auth }                       from '@/auth'
import { createClient }               from '@supabase/supabase-js'

export interface WorkItem {
  task_id:         string
  case_id:         string
  case_number:     string | null
  hubspot_deal_id: string
  case_status:     string
  client_full_name: string | null
  title:           string
  description:     string | null
  task_type:       string
  priority:        string
  task_status:     string
  due_at:          string | null
  created_at:      string
  created_by_name: string | null
  urgency_sort:    number
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const staffId = (session.user as { staffId?: string }).staffId
  if (!staffId) return NextResponse.json({ tasks: [], total: 0 })

  const { searchParams } = new URL(req.url)
  const statusFilter = searchParams.get('status') ?? ''  // '' | 'open' | 'in_progress' | 'blocked'
  const typeFilter   = searchParams.get('type')   ?? ''
  const limit        = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const page         = Math.max(parseInt(searchParams.get('page')  ?? '1'), 1)
  const offset       = (page - 1) * limit

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  let query = db
    .from('my_work_queue')
    .select('*', { count: 'exact' })
    .eq('assigned_to', staffId)

  if (statusFilter) query = query.eq('task_status', statusFilter)
  if (typeFilter)   query = query.eq('task_type', typeFilter)

  query = query
    .order('urgency_sort', { ascending: true })
    .order('due_at',       { ascending: true, nullsFirst: false })
    .order('created_at',   { ascending: false })
    .range(offset, offset + limit - 1)

  const { data, count, error } = await query

  if (error) {
    console.error('[my-work] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tasks: data ?? [], total: count ?? 0, page, limit })
}
