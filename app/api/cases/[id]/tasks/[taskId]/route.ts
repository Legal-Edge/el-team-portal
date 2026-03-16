/**
 * PATCH /api/cases/[id]/tasks/[taskId]
 * Supported actions: status_change | update | complete | cancel
 */
import { NextRequest, NextResponse }  from 'next/server'
import { auth }                       from '@/auth'
import { createClient }               from '@supabase/supabase-js'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await params
  const staffId = (session.user as { staffId?: string }).staffId ?? null
  const body    = await req.json()
  const { action } = body

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const now = new Date().toISOString()
  let update: Record<string, unknown> = { updated_at: now }

  if (action === 'complete') {
    update = { ...update, task_status: 'completed', completed_at: now, completed_by: staffId }
  } else if (action === 'cancel') {
    update = { ...update, task_status: 'cancelled', cancelled_at: now, cancelled_by: staffId }
  } else if (action === 'reopen') {
    update = { ...update, task_status: 'open', completed_at: null, cancelled_at: null }
  } else if (action === 'status') {
    const { task_status } = body
    if (!task_status) return NextResponse.json({ error: 'task_status required' }, { status: 400 })
    update = { ...update, task_status }
  } else if (action === 'update') {
    const { title, description, priority, due_at, assigned_to, task_type } = body
    if (title !== undefined)       update.title       = title
    if (description !== undefined) update.description = description
    if (priority !== undefined)    update.priority    = priority
    if (due_at !== undefined)      update.due_at      = due_at
    if (assigned_to !== undefined) update.assigned_to = assigned_to
    if (task_type !== undefined)   update.task_type   = task_type
  } else {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  const { error } = await db
    .from('tasks')
    .update(update)
    .eq('id', taskId)
    .eq('is_deleted', false)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
