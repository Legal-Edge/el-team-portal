'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient }                      from '@supabase/supabase-js'
import Link                                  from 'next/link'
import type { WorkItem }                     from '@/app/api/my-work/route'

// ── Config ─────────────────────────────────────────────────────────────────

const TASK_TYPE_LABELS: Record<string, string> = {
  general:          'General',       follow_up:        'Follow Up',
  document_request: 'Doc Request',   demand_letter:    'Demand Letter',
  settlement:       'Settlement',    court_filing:     'Court Filing',
  call:             'Call',          email:            'Email',
  review:           'Review',        intake_follow_up: 'Intake Follow Up',
}

const PRIORITY_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  low:    { label: 'Low',    cls: 'bg-gray-100 text-gray-500',   dot: 'bg-gray-300'   },
  normal: { label: 'Normal', cls: 'bg-blue-50 text-blue-600',    dot: 'bg-blue-400'   },
  high:   { label: 'High',   cls: 'bg-amber-50 text-amber-700',  dot: 'bg-amber-400'  },
  urgent: { label: 'Urgent', cls: 'bg-red-50 text-red-700',      dot: 'bg-red-500'    },
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  open:        { label: 'Open',        cls: 'bg-blue-50 text-blue-700'  },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50 text-amber-700'},
  blocked:     { label: 'Blocked',     cls: 'bg-red-50 text-red-700'    },
}

const STAGE_LABELS: Record<string, string> = {
  intake: 'Intake', nurture: 'Nurture', document_collection: 'Doc Collection',
  attorney_review: 'Atty Review', info_needed: 'Info Needed',
  sign_up: 'Sign Up', retained: 'Retained', settled: 'Settled', dropped: 'Dropped',
}

const TYPE_ICON: Record<string, string> = {
  general: '📋', follow_up: '🔁', document_request: '📄', demand_letter: '📜',
  settlement: '🤝', court_filing: '⚖️', call: '📞', email: '✉️',
  review: '🔍', intake_follow_up: '📝',
}

type StatusFilter = '' | 'open' | 'in_progress' | 'blocked'

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: '',            label: 'All Active'   },
  { id: 'open',        label: 'Open'         },
  { id: 'in_progress', label: 'In Progress'  },
  { id: 'blocked',     label: 'Blocked'      },
]

function fmtDue(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: '—', cls: 'text-gray-400' }
  const diff = new Date(iso).getTime() - Date.now()
  const days = Math.ceil(diff / 86400000)
  if (days < 0)   return { text: `${Math.abs(days)}d overdue`, cls: 'text-red-600 font-semibold' }
  if (days === 0) return { text: 'Due today',                   cls: 'text-orange-600 font-semibold' }
  if (days === 1) return { text: 'Tomorrow',                    cls: 'text-amber-600 font-medium'  }
  if (days <= 7)  return { text: `${days}d`,                    cls: 'text-amber-500'               }
  return {
    text: new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    cls: 'text-gray-500',
  }
}

function urgencyBorder(item: WorkItem): string {
  if (item.urgency_sort === 1) return 'border-l-[3px] border-l-red-400'
  if (item.urgency_sort === 2) return 'border-l-[3px] border-l-orange-400'
  if (item.urgency_sort === 3) return 'border-l-[3px] border-l-amber-400'
  if (item.task_status === 'blocked') return 'border-l-[3px] border-l-red-300'
  return 'border-l-[3px] border-l-gray-200'
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MyWorkPage() {
  const [tasks,      setTasks]      = useState<WorkItem[]>([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [statusTab,  setStatusTab]  = useState<StatusFilter>('')
  const [typeFilter, setTypeFilter] = useState('')
  const [busyTask,   setBusyTask]   = useState<string | null>(null)
  const [newTaskIds, setNewTaskIds] = useState<Set<string>>(new Set())
  const [isLive,     setIsLive]     = useState(false)

  const load = useCallback(async (status: StatusFilter, type: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (status) params.set('status', status)
      if (type)   params.set('type', type)
      const res  = await fetch(`/api/my-work?${params}`)
      const json = await res.json()
      setTasks(json.tasks ?? [])
      setTotal(json.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(statusTab, typeFilter) }, [])

  // ── Realtime — tasks assigned to me ───────────────────────────────────────

  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const seenIds = new Set<string>()

    const ch = sb
      .channel('my-work-tasks')
      .on('postgres_changes', {
        event: '*', schema: 'core', table: 'tasks',
      }, (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        const { eventType, new: r, old: o } = payload
        if (eventType === 'INSERT') {
          if (seenIds.has(r.id as string)) return
          seenIds.add(r.id as string)
          // Re-fetch to get full work queue row (includes case context)
          load(statusTab, typeFilter)
          setNewTaskIds(ids => new Set(ids).add(r.id as string))
          setTimeout(() => setNewTaskIds(ids => { const n = new Set(ids); n.delete(r.id as string); return n }), 3000)
        } else if (eventType === 'UPDATE') {
          setTasks(prev => prev
            .map(t => t.task_id === r.id ? { ...t, task_status: r.task_status as string, priority: r.priority as string, due_at: r.due_at as string | null } : t)
            .filter(t => ['open', 'in_progress', 'blocked'].includes(t.task_status))
          )
        } else if (eventType === 'DELETE') {
          setTasks(prev => prev.filter(t => t.task_id !== (o?.id ?? '')))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'core', table: 'tasks' }, () => {})
      .subscribe(status => { setIsLive(status === 'SUBSCRIBED') })

    return () => { sb.removeChannel(ch) }
  }, [load, statusTab, typeFilter])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function taskAction(item: WorkItem, action: string, extra: Record<string, unknown> = {}) {
    setBusyTask(item.task_id)
    try {
      await fetch(`/api/cases/${item.hubspot_deal_id}/tasks/${item.task_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      setTimeout(() => load(statusTab, typeFilter), 300)
    } finally {
      setBusyTask(null)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const overdueCount  = tasks.filter(t => t.urgency_sort === 1).length
  const dueTodayCount = tasks.filter(t => t.urgency_sort === 2).length
  const blockedCount  = tasks.filter(t => t.task_status === 'blocked').length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900">My Work Queue</h1>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-gray-500">{total} active task{total !== 1 ? 's' : ''}</span>
            {overdueCount > 0 && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                🔴 {overdueCount} overdue
              </span>
            )}
            {dueTodayCount > 0 && (
              <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                ⚡ {dueTodayCount} due today
              </span>
            )}
            {blockedCount > 0 && (
              <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                🚫 {blockedCount} blocked
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 flex-wrap">
        {/* Status tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setStatusTab(tab.id); load(tab.id, typeFilter) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all active:scale-95 ${
                statusTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Task type filter */}
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); load(statusTab, e.target.value) }}
          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
        >
          <option value="">All Types</option>
          {Object.entries(TASK_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="text-sm text-gray-400 text-center py-10">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-4xl">✅</span>
            <p className="text-sm text-gray-500 font-medium">All clear — no active tasks</p>
            <p className="text-xs text-gray-400">Tasks assigned to you will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(item => {
              const due      = fmtDue(item.due_at)
              const prioCfg  = PRIORITY_CFG[item.priority]
              const statCfg  = STATUS_CFG[item.task_status]
              const busy     = busyTask === item.task_id
              const isNew    = newTaskIds.has(item.task_id)

              return (
                <div
                  key={item.task_id}
                  className={`bg-white rounded-xl border p-4 transition-all ${urgencyBorder(item)} ${
                    isNew ? 'ring-2 ring-lemon-400/40' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Urgency dot */}
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${prioCfg?.dot ?? 'bg-gray-300'}`} />

                    <div className="flex-1 min-w-0">
                      {/* Task title + badges */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900 leading-snug">{item.title}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[10px] font-semibold px-1.5 py-px rounded ${prioCfg?.cls ?? ''}`}>
                            {prioCfg?.label ?? item.priority}
                          </span>
                          <span className={`text-[10px] font-medium px-1.5 py-px rounded ${statCfg?.cls ?? ''}`}>
                            {statCfg?.label ?? item.task_status}
                          </span>
                        </div>
                      </div>

                      {/* Description */}
                      {item.description && (
                        <p className="text-xs text-gray-500 mt-0.5 leading-snug">{item.description}</p>
                      )}

                      {/* Case context */}
                      <Link
                        href={`/cases/${item.hubspot_deal_id}?tab=tasks`}
                        onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 mt-2 text-xs text-blue-600 hover:underline"
                      >
                        <span className="font-mono">{item.case_number ?? item.hubspot_deal_id.slice(-6)}</span>
                        {item.client_full_name?.trim() && (
                          <span className="text-gray-500">· {item.client_full_name.trim()}</span>
                        )}
                        {item.case_status && (
                          <span className="text-gray-400">· {STAGE_LABELS[item.case_status] ?? item.case_status}</span>
                        )}
                      </Link>

                      {/* Meta row: type icon + due + created by */}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-sm">{TYPE_ICON[item.task_type] ?? '📋'}</span>
                        <span className="text-xs text-gray-400">{TASK_TYPE_LABELS[item.task_type] ?? item.task_type}</span>
                        <span className={`text-xs ${due.cls}`}>{due.text}</span>
                        {item.created_by_name && (
                          <span className="text-xs text-gray-300">by {item.created_by_name}</span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 mt-3">
                        {/* Complete */}
                        <button
                          onClick={() => taskAction(item, 'complete')}
                          disabled={busy}
                          className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-lemon-400 hover:bg-lemon-500 text-gray-900 transition-all active:scale-95 disabled:opacity-40"
                        >
                          {busy ? '…' : '✓ Complete'}
                        </button>
                        {/* Status transitions */}
                        {item.task_status === 'open' && (
                          <button
                            onClick={() => taskAction(item, 'status', { task_status: 'in_progress' })}
                            disabled={busy}
                            className="text-[11px] px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            Start
                          </button>
                        )}
                        {item.task_status === 'in_progress' && (
                          <button
                            onClick={() => taskAction(item, 'status', { task_status: 'blocked' })}
                            disabled={busy}
                            className="text-[11px] px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            Mark Blocked
                          </button>
                        )}
                        {item.task_status === 'blocked' && (
                          <button
                            onClick={() => taskAction(item, 'status', { task_status: 'in_progress' })}
                            disabled={busy}
                            className="text-[11px] px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            Unblock
                          </button>
                        )}
                        {/* Open case */}
                        <Link
                          href={`/cases/${item.hubspot_deal_id}?tab=tasks`}
                          className="text-[11px] px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all"
                        >
                          Open Case
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
