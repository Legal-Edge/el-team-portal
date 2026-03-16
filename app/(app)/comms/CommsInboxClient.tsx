'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import type { CommsInboxRow } from '@/app/api/comms-inbox/route'

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 60)   return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  return `${days}d ago`
}

function clientName(row: CommsInboxRow): string {
  // Prefer pre-computed view column; fall back to app-layer concat for safety
  const full = row.client_full_name?.trim()
  if (full) return full
  const first = row.client_first_name?.trim() ?? ''
  const last  = row.client_last_name?.trim()  ?? ''
  return [first, last].filter(Boolean).join(' ') || 'Unknown'
}

function slaLabel(status: string) {
  if (status === 'overdue')  return { text: 'Overdue',  cls: 'bg-red-100 text-red-700' }
  if (status === 'due_soon') return { text: 'Due Soon', cls: 'bg-amber-100 text-amber-700' }
  if (status === 'ok')       return { text: 'OK',       cls: 'bg-green-100 text-green-700' }
  return { text: 'No Contact', cls: 'bg-gray-100 text-gray-500' }
}

function urgencyBorder(status: string): string {
  if (status === 'overdue')  return 'border-l-[3px] border-l-red-400'
  if (status === 'due_soon') return 'border-l-[3px] border-l-amber-400'
  if (status === 'ok')       return 'border-l-[3px] border-l-green-400'
  return 'border-l-[3px] border-l-gray-200'
}

const STAGE_LABELS: Record<string, string> = {
  intake:              'Intake',
  nurture:             'Nurture',
  document_collection: 'Doc Collection',
  attorney_review:     'Attorney Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up',
  retained:            'Retained',
  settled:             'Settled',
  dropped:             'Dropped',
}

const CHANNEL_ICON: Record<string, string> = {
  sms:   '💬',
  call:  '📞',
  email: '✉️',
}

// ── Filter tabs ────────────────────────────────────────────────────────────

type Filter = 'all' | 'awaiting' | 'overdue' | 'due_soon'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',      label: 'All'              },
  { id: 'awaiting', label: 'Awaiting Response' },
  { id: 'overdue',  label: 'Overdue'           },
  { id: 'due_soon', label: 'Due Soon'          },
]

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  initialRows:  CommsInboxRow[]
  initialTotal: number
  attorneys:    { id: string; display_name: string }[]
}

export default function CommsInboxClient({ initialRows, initialTotal, attorneys }: Props) {
  const router = useRouter()

  const [filter,   setFilter]   = useState<Filter>('all')
  const [attorney, setAttorney] = useState('')
  const [stage,    setStage]    = useState('')
  const [rows,     setRows]     = useState<CommsInboxRow[]>(initialRows)
  const [total,    setTotal]    = useState(initialTotal)
  const [page,     setPage]     = useState(1)
  const [loading,  setLoading]  = useState(false)
  const [hasMore,  setHasMore]  = useState(initialRows.length < initialTotal)

  const LIMIT = 50

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (opts: {
    filter?: Filter; attorney?: string; stage?: string; page?: number; append?: boolean
  }) => {
    const f  = opts.filter   ?? filter
    const a  = opts.attorney ?? attorney
    const s  = opts.stage    ?? stage
    const p  = opts.page     ?? 1
    const ap = opts.append   ?? false

    setLoading(true)
    try {
      const params = new URLSearchParams({
        filter: f, limit: String(LIMIT), page: String(p),
        ...(a ? { attorney: a } : {}),
        ...(s ? { stage: s }    : {}),
      })
      const res  = await fetch(`/api/comms-inbox?${params}`)
      const json = await res.json()
      setRows(prev => ap ? [...prev, ...(json.rows ?? [])] : (json.rows ?? []))
      setTotal(json.total ?? 0)
      setHasMore((json.rows?.length ?? 0) === LIMIT)
    } finally {
      setLoading(false)
    }
  }, [filter, attorney, stage])

  // ── Filter handlers ──────────────────────────────────────────────────────

  function handleFilter(f: Filter) {
    setFilter(f); setPage(1)
    fetchRows({ filter: f, attorney, stage, page: 1 })
  }

  function handleAttorney(a: string) {
    setAttorney(a); setPage(1)
    fetchRows({ filter, attorney: a, stage, page: 1 })
  }

  function handleStage(s: string) {
    setStage(s); setPage(1)
    fetchRows({ filter, attorney, stage: s, page: 1 })
  }

  function loadMore() {
    const next = page + 1
    setPage(next)
    fetchRows({ filter, attorney, stage, page: next, append: true })
  }

  // ── Supabase Realtime ─────────────────────────────────────────────────────
  // Subscribe to core.comms_state updates and patch the inbox row in-place.
  // If a case enters or leaves the inbox (sla_status changes to/from no_contact),
  // trigger a full refresh.

  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)

  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    channelRef.current = supabase
      .channel('comms_state_inbox')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'core', table: 'comms_state' },
        (payload) => {
          const updated = payload.new as Record<string, unknown>
          setRows(prev => prev.map(r => {
            if (r.case_id !== updated.case_id) return r
            return {
              ...r,
              last_inbound_at:   updated.last_inbound_at   as string | null,
              last_outbound_at:  updated.last_outbound_at  as string | null,
              awaiting_response: updated.awaiting_response as boolean,
              response_due_at:   updated.response_due_at   as string | null,
              sla_status:        updated.sla_status        as CommsInboxRow['sla_status'],
              unread_count:      updated.unread_count       as number,
              sla_sort: updated.sla_status === 'overdue' ? 1
                       : updated.sla_status === 'due_soon' ? 2
                       : updated.sla_status === 'ok' ? 3 : 4,
            }
          }))
        }
      )
      .subscribe()

    return () => {
      channelRef.current?.unsubscribe()
    }
  }, [])

  // ── Row click → case detail on Comms tab ──────────────────────────────────

  function openCase(caseId: string) {
    router.push(`/cases/${caseId}?tab=comms`)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const awaitingCount = rows.filter(r => r.awaiting_response).length
  const overdueCount  = rows.filter(r => r.sla_status === 'overdue').length

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Comms Inbox</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {total} conversation{total !== 1 ? 's' : ''}
            {awaitingCount > 0 && <span className="ml-2 text-amber-600 font-medium">· {awaitingCount} awaiting response</span>}
            {overdueCount  > 0 && <span className="ml-2 text-red-600 font-medium">· {overdueCount} overdue</span>}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-100 flex-wrap">

        {/* SLA tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => handleFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all active:scale-95 ${
                filter === f.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Attorney filter */}
        {attorneys.length > 0 && (
          <select
            value={attorney}
            onChange={e => handleAttorney(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
          >
            <option value="">All Attorneys</option>
            {attorneys.map(a => (
              <option key={a.id} value={a.id}>{a.display_name}</option>
            ))}
          </select>
        )}

        {/* Stage filter */}
        <select
          value={stage}
          onChange={e => handleStage(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
        >
          <option value="">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-sm text-gray-400">
            <span className="text-2xl mb-2">📭</span>
            No conversations match this filter
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="w-1 px-0" />
                <th className="px-4 py-2.5 text-left font-medium">Client</th>
                <th className="px-4 py-2.5 text-left font-medium">Case</th>
                <th className="px-4 py-2.5 text-left font-medium">Stage</th>
                <th className="px-4 py-2.5 text-left font-medium">Last Inbound</th>
                <th className="px-4 py-2.5 text-left font-medium">Last Outbound</th>
                <th className="px-4 py-2.5 text-left font-medium">SLA</th>
                <th className="px-4 py-2.5 text-center font-medium">Unread</th>
                <th className="px-4 py-2.5 text-left font-medium">Attorney</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const sla   = slaLabel(row.sla_status)
                const name  = clientName(row)
                const phone = row.client_phone

                return (
                  <tr
                    key={row.case_id}
                    onClick={() => openCase(row.case_id)}
                    className={`cursor-pointer hover:bg-gray-50 transition-colors active:scale-[0.995] ${urgencyBorder(row.sla_status)}`}
                  >
                    {/* Urgency bar (CSS border-left) */}
                    <td className="w-1 px-0" />

                    {/* Client */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{name}</div>
                      {phone && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {CHANNEL_ICON[row.last_inbound_channel ?? ''] ?? '💬'} {phone}
                        </div>
                      )}
                    </td>

                    {/* Case number */}
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs whitespace-nowrap">
                      {row.case_number ?? row.hubspot_deal_id.slice(-6)}
                    </td>

                    {/* Stage */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        {STAGE_LABELS[row.case_status] ?? row.case_status}
                      </span>
                    </td>

                    {/* Last inbound */}
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {relativeTime(row.last_inbound_at)}
                    </td>

                    {/* Last outbound */}
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {relativeTime(row.last_outbound_at)}
                    </td>

                    {/* SLA badge */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sla.cls}`}>
                        {sla.text}
                      </span>
                      {row.awaiting_response && row.response_due_at && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          Due {relativeTime(row.response_due_at)}
                        </div>
                      )}
                    </td>

                    {/* Unread count */}
                    <td className="px-4 py-3 text-center">
                      {row.unread_count > 0 ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-lemon-400 text-xs font-bold text-gray-900">
                          {row.unread_count > 99 ? '99+' : row.unread_count}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Attorney */}
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {row.attorney_name ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="px-6 py-3 border-t border-gray-100">
          <button
            onClick={loadMore}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Loading…' : `Load more (${total - rows.length} remaining)`}
          </button>
        </div>
      )}

    </div>
  )
}
