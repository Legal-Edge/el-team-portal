'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient }                     from '@supabase/supabase-js'
import type { TaskRow }                     from '@/app/api/cases/[id]/tasks/route'

// ── Constants ──────────────────────────────────────────────────────────────

const TASK_TYPES: { code: string; label: string }[] = [
  { code: 'general',          label: 'General'          },
  { code: 'follow_up',        label: 'Follow Up'        },
  { code: 'document_request', label: 'Document Request' },
  { code: 'demand_letter',    label: 'Demand Letter'    },
  { code: 'settlement',       label: 'Settlement'       },
  { code: 'court_filing',     label: 'Court Filing'     },
  { code: 'call',             label: 'Call'             },
  { code: 'email',            label: 'Email'            },
  { code: 'review',           label: 'Review'           },
  { code: 'intake_follow_up', label: 'Intake Follow Up' },
]

const PRIORITIES: { code: string; label: string; cls: string }[] = [
  { code: 'low',    label: 'Low',    cls: 'bg-gray-100 text-gray-500'    },
  { code: 'normal', label: 'Normal', cls: 'bg-blue-50 text-blue-600'     },
  { code: 'high',   label: 'High',   cls: 'bg-amber-50 text-amber-700'   },
  { code: 'urgent', label: 'Urgent', cls: 'bg-red-50 text-red-700'       },
]

const STATUSES: { code: string; label: string; cls: string }[] = [
  { code: 'open',        label: 'Open',        cls: 'bg-blue-50 text-blue-700'      },
  { code: 'in_progress', label: 'In Progress', cls: 'bg-amber-50 text-amber-700'   },
  { code: 'blocked',     label: 'Blocked',     cls: 'bg-red-50 text-red-700'       },
  { code: 'completed',   label: 'Completed',   cls: 'bg-green-50 text-green-700'   },
  { code: 'cancelled',   label: 'Cancelled',   cls: 'bg-gray-100 text-gray-400'    },
]

const STATUS_MAP  = Object.fromEntries(STATUSES.map(s => [s.code, s]))
const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map(p => [p.code, p]))

const TYPE_ICON: Record<string, string> = {
  general:          '📋', follow_up:        '🔁', document_request: '📄',
  demand_letter:    '📜', settlement:       '🤝', court_filing:     '⚖️',
  call:             '📞', email:            '✉️', review:           '🔍',
  intake_follow_up: '📝',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDue(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: 'No due date', cls: 'text-gray-400' }
  const diff  = new Date(iso).getTime() - Date.now()
  const days  = Math.ceil(diff / 86400000)
  if (days < 0)   return { text: `${Math.abs(days)}d overdue`, cls: 'text-red-600 font-semibold' }
  if (days === 0) return { text: 'Due today',                   cls: 'text-orange-600 font-semibold' }
  if (days === 1) return { text: 'Due tomorrow',                cls: 'text-amber-600 font-medium' }
  if (days <= 7)  return { text: `Due in ${days}d`,             cls: 'text-amber-500'              }
  return {
    text: new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    cls: 'text-gray-500',
  }
}

function isActive(t: TaskRow) {
  return t.task_status === 'open' || t.task_status === 'in_progress' || t.task_status === 'blocked'
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  caseSlug:    string    // hubspot_deal_id (URL param)
  caseUUID:    string | null
  staffId:     string | null
  userRole:    string
  staffList:   { id: string; display_name: string }[]
}

// ── Create Task form ───────────────────────────────────────────────────────

interface CreateFormState {
  title:       string
  description: string
  task_type:   string
  priority:    string
  due_at:      string
  assigned_to: string
}

const EMPTY_FORM: CreateFormState = {
  title: '', description: '', task_type: 'general',
  priority: 'normal', due_at: '', assigned_to: '',
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TasksSection({ caseSlug, caseUUID, staffId, userRole, staffList }: Props) {
  const [tasks,       setTasks]       = useState<TaskRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showCreate,  setShowCreate]  = useState(false)
  const [form,        setForm]        = useState<CreateFormState>(EMPTY_FORM)
  const [submitting,  setSubmitting]  = useState(false)
  const [busyTask,    setBusyTask]    = useState<string | null>(null)
  const [showDone,    setShowDone]    = useState(false)
  const [newTaskIds,  setNewTaskIds]  = useState<Set<string>>(new Set())

  const canManage = ['admin', 'attorney', 'manager'].includes(userRole)

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/cases/${caseSlug}/tasks`)
      const json = await res.json()
      setTasks(json.tasks ?? [])
    } finally {
      setLoading(false)
    }
  }, [caseSlug])

  useEffect(() => { loadTasks() }, [loadTasks])

  // ── Realtime ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!caseUUID) return
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const seenIds = new Set<string>()

    let ch: ReturnType<typeof sb.channel> | undefined
    try {
    ch = sb
      .channel(`tasks-${caseUUID}`)
      .on('postgres_changes', {
        event: '*', schema: 'core', table: 'tasks',
        filter: `case_id=eq.${caseUUID}`,
      }, (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        const { eventType, new: r, old: o } = payload

        if (eventType === 'INSERT') {
          if (seenIds.has(r.id as string)) return
          seenIds.add(r.id as string)
          const newRow = r as unknown as TaskRow
          setTasks(prev => [newRow, ...prev])
          setNewTaskIds(ids => new Set(ids).add(newRow.id))
          setTimeout(() => setNewTaskIds(ids => { const n = new Set(ids); n.delete(newRow.id); return n }), 3000)
        } else if (eventType === 'UPDATE') {
          setTasks(prev => prev.map(t => t.id === r.id ? { ...t, ...(r as unknown as TaskRow) } : t))
        } else if (eventType === 'DELETE') {
          setTasks(prev => prev.filter(t => t.id !== (o?.id ?? '')))
        }
      })
      .subscribe()
    } catch (e) { console.warn('[Realtime] subscription failed:', e) }
    return () => { try { if (ch) sb.removeChannel(ch) } catch { /* ignore */ } }
  }, [caseUUID])

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSubmitting(true)
    try {
      await fetch(`/api/cases/${caseSlug}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       form.title.trim(),
          description: form.description || null,
          task_type:   form.task_type,
          priority:    form.priority,
          due_at:      form.due_at || null,
          assigned_to: form.assigned_to || staffId,
        }),
      })
      setForm(EMPTY_FORM)
      setShowCreate(false)
      // Realtime will push the new task; fall back to reload after 300ms
      setTimeout(() => loadTasks(), 300)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function taskAction(taskId: string, action: string, extra: Record<string, unknown> = {}) {
    setBusyTask(taskId)
    try {
      await fetch(`/api/cases/${caseSlug}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      // Realtime handles state update; fallback reload
      setTimeout(() => loadTasks(), 300)
    } finally {
      setBusyTask(null)
    }
  }

  // ── Derived views ─────────────────────────────────────────────────────────

  const activeTasks = tasks.filter(isActive).sort((a, b) => {
    // Sort: overdue > due today > urgent > high > open; then by due date
    const overdueA = a.due_at && new Date(a.due_at) < new Date() ? 0 : 1
    const overdueB = b.due_at && new Date(b.due_at) < new Date() ? 0 : 1
    if (overdueA !== overdueB) return overdueA - overdueB
    const prioOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
    const pa = prioOrder[a.priority as keyof typeof prioOrder] ?? 2
    const pb = prioOrder[b.priority as keyof typeof prioOrder] ?? 2
    if (pa !== pb) return pa - pb
    if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at)
    if (a.due_at) return -1
    if (b.due_at) return 1
    return 0
  })

  const doneTasks = tasks.filter(t => !isActive(t))

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Tasks</h2>
          {activeTasks.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-lemon-400 text-[10px] font-bold text-gray-900">
              {activeTasks.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {doneTasks.length > 0 && (
            <button
              onClick={() => setShowDone(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showDone ? 'Hide' : `Show ${doneTasks.length} done`}
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setShowCreate(v => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-lemon-400 hover:bg-lemon-500 text-gray-900 transition-all active:scale-95"
            >
              + Add Task
            </button>
          )}
        </div>
      </div>

      {/* ── Create form ── */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3"
        >
          {/* Title */}
          <input
            type="text"
            placeholder="Task title *"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            autoFocus
            required
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-lemon-400"
          />
          {/* Description */}
          <textarea
            placeholder="Description (optional)"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-lemon-400 resize-none"
          />
          {/* Row: type + priority + due */}
          <div className="grid grid-cols-3 gap-2">
            <select
              value={form.task_type}
              onChange={e => setForm(f => ({ ...f, task_type: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-lemon-400"
            >
              {TASK_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
            <select
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-lemon-400"
            >
              {PRIORITIES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
            <input
              type="date"
              value={form.due_at}
              onChange={e => setForm(f => ({ ...f, due_at: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-lemon-400"
            />
          </div>
          {/* Assign to */}
          {staffList.length > 0 && (
            <select
              value={form.assigned_to}
              onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-lemon-400 w-full"
            >
              <option value="">Assign to me</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            </select>
          )}
          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting || !form.title.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-lemon-400 hover:bg-lemon-500 text-gray-900 transition-all active:scale-95 disabled:opacity-40"
            >
              {submitting ? 'Creating…' : 'Create Task'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setForm(EMPTY_FORM) }}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── Active tasks ── */}
      {loading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading tasks…</div>
      ) : activeTasks.length === 0 && !showCreate ? (
        <div className="text-sm text-gray-400 py-6 text-center">
          No open tasks for this case
        </div>
      ) : (
        <div className="space-y-2">
          {activeTasks.map(task => {
            const due      = fmtDue(task.due_at)
            const statusCfg = STATUS_MAP[task.task_status]
            const prioCfg   = PRIORITY_MAP[task.priority]
            const busy      = busyTask === task.id
            const isNew     = newTaskIds.has(task.id)

            return (
              <div
                key={task.id}
                className={`rounded-xl border p-4 transition-all ${
                  isNew
                    ? 'border-lemon-400 bg-lemon-400/5'
                    : task.task_status === 'blocked'
                    ? 'border-red-200 bg-red-50/30'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Complete checkbox */}
                  <button
                    onClick={() => taskAction(task.id, 'complete')}
                    disabled={busy || !canManage}
                    title="Mark complete"
                    className="mt-0.5 w-4.5 h-4.5 shrink-0 rounded border-2 border-gray-300 hover:border-lemon-400 transition-colors flex items-center justify-center disabled:cursor-default"
                  >
                    {busy && <span className="text-[8px] text-gray-400">…</span>}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Priority */}
                        <span className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold ${prioCfg?.cls ?? ''}`}>
                          {prioCfg?.label ?? task.priority}
                        </span>
                        {/* Status */}
                        <span className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium ${statusCfg?.cls ?? ''}`}>
                          {statusCfg?.label ?? task.task_status}
                        </span>
                      </div>
                    </div>

                    {/* Description */}
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1 leading-snug">{task.description}</p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="text-sm">{TYPE_ICON[task.task_type] ?? '📋'}</span>
                      <span className={`text-xs ${due.cls}`}>{due.text}</span>
                      {task.assigned_name && (
                        <span className="text-xs text-gray-400">→ {task.assigned_name}</span>
                      )}
                      {task.created_by_name && task.created_by !== staffId && (
                        <span className="text-xs text-gray-300">by {task.created_by_name}</span>
                      )}
                    </div>

                    {/* Action buttons */}
                    {canManage && (
                      <div className="flex gap-2 mt-3">
                        {task.task_status === 'open' && (
                          <button
                            onClick={() => taskAction(task.id, 'status', { task_status: 'in_progress' })}
                            disabled={busy}
                            className="text-[11px] px-2 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            Start
                          </button>
                        )}
                        {task.task_status === 'in_progress' && (
                          <button
                            onClick={() => taskAction(task.id, 'status', { task_status: 'blocked' })}
                            disabled={busy}
                            className="text-[11px] px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            Mark Blocked
                          </button>
                        )}
                        {task.task_status === 'blocked' && (
                          <button
                            onClick={() => taskAction(task.id, 'status', { task_status: 'in_progress' })}
                            disabled={busy}
                            className="text-[11px] px-2 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            Unblock
                          </button>
                        )}
                        <button
                          onClick={() => taskAction(task.id, 'cancel')}
                          disabled={busy}
                          className="text-[11px] px-2 py-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all active:scale-95 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Done / cancelled tasks (collapsed) ── */}
      {showDone && doneTasks.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-1">Completed / Cancelled</p>
          {doneTasks.map(task => {
            const statusCfg = STATUS_MAP[task.task_status]
            return (
              <div key={task.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50">
                <span className="text-gray-300 text-sm">{task.task_status === 'completed' ? '✓' : '✕'}</span>
                <span className="text-xs text-gray-400 line-through flex-1 truncate">{task.title}</span>
                <span className={`text-[10px] px-1.5 py-px rounded ${statusCfg?.cls ?? ''}`}>
                  {statusCfg?.label ?? task.task_status}
                </span>
                {canManage && (
                  <button
                    onClick={() => taskAction(task.id, 'reopen')}
                    className="text-[10px] text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    Reopen
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
