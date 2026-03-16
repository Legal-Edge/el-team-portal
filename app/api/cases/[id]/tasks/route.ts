/**
 * GET  /api/cases/[id]/tasks  — list tasks for a case
 * POST /api/cases/[id]/tasks  — create a task
 * PATCH /api/cases/[id]/tasks/[taskId] handled in [taskId]/route.ts
 */
import { NextRequest, NextResponse }  from 'next/server'
import { auth }                       from '@/auth'
import { createClient }               from '@supabase/supabase-js'

export interface TaskRow {
  id:              string
  case_id:         string
  title:           string
  description:     string | null
  task_type:       string
  priority:        string
  task_status:     string
  due_at:          string | null
  completed_at:    string | null
  cancelled_at:    string | null
  created_at:      string
  updated_at:      string
  assigned_to:     string | null
  assigned_name:   string | null
  created_by:      string | null
  created_by_name: string | null
}

function getCoreDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')
}

// GET — list tasks for a case (all statuses, newest first)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = getCoreDb()

  // Resolve case UUID from hubspot_deal_id slug
  const { data: caseRow } = await db
    .from('cases')
    .select('id')
    .eq('hubspot_deal_id', id)
    .eq('is_deleted', false)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const { data: tasks, error } = await db
    .from('tasks')
    .select(`
      id, case_id, title, description, task_type, priority, task_status,
      due_at, completed_at, cancelled_at, created_at, updated_at,
      assigned_to, created_by
    `)
    .eq('case_id', caseRow.id)
    .eq('is_deleted', false)
    .order('task_status', { ascending: true })   // open first
    .order('due_at',      { ascending: true, nullsFirst: false })
    .order('created_at',  { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve staff names
  const staffIds = [...new Set([
    ...(tasks ?? []).map(t => t.assigned_to).filter(Boolean),
    ...(tasks ?? []).map(t => t.created_by).filter(Boolean),
  ])] as string[]

  const staffMap: Record<string, string> = {}
  if (staffIds.length > 0) {
    const staffDb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ).schema('staff')
    const { data: staffRows } = await staffDb
      .from('staff_users')
      .select('id, display_name')
      .in('id', staffIds)
    for (const r of staffRows ?? []) staffMap[r.id] = r.display_name
  }

  const rows: TaskRow[] = (tasks ?? []).map(t => ({
    ...t,
    assigned_name:   t.assigned_to  ? (staffMap[t.assigned_to]  ?? null) : null,
    created_by_name: t.created_by   ? (staffMap[t.created_by]   ?? null) : null,
  }))

  return NextResponse.json({ tasks: rows, caseId: caseRow.id })
}

// POST — create a task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db      = getCoreDb()
  const staffId = (session.user as { staffId?: string }).staffId ?? null
  const body    = await req.json()

  const { title, description, task_type, priority, due_at, assigned_to } = body
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })

  // Resolve case UUID
  const { data: caseRow } = await db
    .from('cases')
    .select('id')
    .eq('hubspot_deal_id', id)
    .eq('is_deleted', false)
    .single()

  if (!caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const { data: task, error } = await db
    .from('tasks')
    .insert({
      case_id:     caseRow.id,
      created_by:  staffId,
      assigned_to: assigned_to ?? staffId,
      title:       title.trim(),
      description: description ?? null,
      task_type:   task_type   ?? 'general',
      priority:    priority    ?? 'normal',
      task_status: 'open',
      due_at:      due_at      ?? null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, taskId: task.id })
}
