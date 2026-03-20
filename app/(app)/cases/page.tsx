'use client'

import { useEffect, useState, useCallback, useRef }  from 'react'
import { createClient }                               from '@supabase/supabase-js'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Case {
  id:                  string
  hubspot_deal_id:     string
  client_first_name:   string | null
  client_last_name:    string | null
  client_email:        string | null
  client_phone:        string | null
  vehicle_year:        number | null
  vehicle_make:        string | null
  vehicle_model:       string | null
  vehicle_mileage:     number | null
  vehicle_is_new:      boolean | null
  state_jurisdiction:  string | null
  case_status:         string
  case_priority:       string | null
  estimated_value:     number | null
  notes_last_updated:  string | null
  created_at:          string
  updated_at:          string
  // Comms state (enriched from core.comms_state)
  comms_state?: {
    sla_status:        string
    unread_count:      number
    awaiting_response: boolean
    response_due_at:   string | null
  } | null
  // Doc state (enriched from core.case_doc_summary)
  doc_state?: {
    total_docs:       number
    unclassified:     number
    needs_review:     number
    missing_required: number
  } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  intake:              'Intake',
  nurture:             'Nurture',
  document_collection: 'Documents',
  attorney_review:     'Atty Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up',
  retained:            'Retained',
  settled:             'Settled',
  dropped:             'Dropped',
}

const STATUS_COLORS: Record<string, string> = {
  intake:              'bg-blue-100 text-blue-700',
  nurture:             'bg-yellow-100 text-yellow-700',
  document_collection: 'bg-purple-100 text-purple-700',
  attorney_review:     'bg-indigo-100 text-indigo-700',
  info_needed:         'bg-orange-100 text-orange-700',
  sign_up:             'bg-teal-100 text-teal-700',
  retained:            'bg-green-100 text-green-700',
  settled:             'bg-emerald-100 text-emerald-700',
  dropped:             'bg-red-100 text-red-700',
  unknown:             'bg-gray-100 text-gray-500',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysSince(date: string | null): number | null {
  if (!date) return null
  const diff = Date.now() - new Date(date).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  const now  = new Date()
  const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

// Left-border urgency: based on days since last activity
function urgencyClass(c: Case): string {
  // Dropped cases — no urgency indicator
  if (c.case_status === 'dropped' || c.case_status === 'settled') return 'border-l-gray-100'
  const days = daysSince(c.notes_last_updated ?? c.updated_at)
  if (days === null) return 'border-l-gray-100'
  if (days > 30) return 'border-l-red-400'
  if (days > 14) return 'border-l-amber-400'
  return 'border-l-emerald-400'
}

// Sort chevron
function SortIcon({ col, active, asc }: { col: string; active: boolean; asc: boolean }) {
  return (
    <span className={`ml-1 inline-flex flex-col gap-px leading-none ${active ? 'opacity-100' : 'opacity-30'}`}>
      <span className={`text-[8px] ${active && asc  ? 'text-gray-900' : 'text-gray-400'}`}>▲</span>
      <span className={`text-[8px] ${active && !asc ? 'text-gray-900' : 'text-gray-400'}`}>▼</span>
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
function CasesContent() {
  const searchParams = useSearchParams()

  const [cases,       setCases]       = useState<Case[]>([])
  const [total,       setTotal]       = useState(0)
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({})
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({})
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState(searchParams.get('search') ?? '')
  const [activeGroup, setActiveGroup] = useState(searchParams.get('group') ?? '')
  const [activeStage, setActiveStage] = useState(searchParams.get('status') ?? '')
  const [page,        setPage]        = useState(1)
  const [hasMore,     setHasMore]     = useState(false)
  const [sortCol,     setSortCol]     = useState('notes_last_updated')
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [isLive,      setIsLive]      = useState(false)
  const [flashedIds,  setFlashedIds]  = useState<Set<string>>(new Set())
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => { document.title = 'Cases | Team Portal' }, [])

  const load = useCallback(async (
    group: string, status: string, q: string, p: number, col: string, dir: string, append = false
  ) => {
    if (!append) setLoading(true)
    const params = new URLSearchParams({ page: String(p), sort: col, dir })
    if (status) params.set('status', status)
    else if (group) params.set('group', group)
    if (q) params.set('search', q)
    const res = await fetch(`/api/cases?${params}`)
    if (res.ok) {
      const data = await res.json()
      setCases(prev => append ? [...prev, ...(data.cases ?? [])] : (data.cases ?? []))
      setTotal(data.total)
      setGroupCounts(data.groupCounts ?? {})
      setStageCounts(data.stageCounts ?? {})
      setHasMore((data.cases?.length ?? 0) === 25)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    setPage(1)
    load(activeGroup, activeStage, search, 1, sortCol, sortDir)
  }, [activeGroup, activeStage, sortCol, sortDir])

  // SSE — live case updates
  useEffect(() => {
    function connect() {
      const es = new EventSource('/api/cases/stream')
      esRef.current = es
      es.addEventListener('connected', () => setIsLive(true))
      es.onerror = () => setIsLive(false)
      es.addEventListener('case', (e: MessageEvent) => {
        const payload = JSON.parse(e.data) as { type: string; new: Case | null; old: Case | null }
        if (payload.type === 'INSERT' && payload.new) {
          setCases(prev => [payload.new!, ...prev])
          setTotal(t => t + 1)
        } else if (payload.type === 'UPDATE' && payload.new) {
          setCases(prev => prev.map(c => c.id === payload.new!.id ? { ...c, ...payload.new! } : c))
          const id = payload.new.id
          setFlashedIds(prev => new Set([...prev, id]))
          setTimeout(() => setFlashedIds(prev => { const n = new Set(prev); n.delete(id); return n }), 1500)
        } else if (payload.type === 'DELETE' && payload.old) {
          setCases(prev => prev.filter(c => c.id !== payload.old!.id))
          setTotal(t => Math.max(0, t - 1))
        }
      })
    }
    connect()
    return () => { esRef.current?.close(); setIsLive(false) }
  }, [])

  // Supabase Realtime — live comms_state updates in the queue
  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    let ch: ReturnType<typeof sb.channel> | undefined
    try {
    ch = sb
      .channel('cases-queue-comms')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'core', table: 'comms_state',
      }, (payload: { new: Record<string, unknown> }) => {
        const r = payload.new
        setCases(prev => prev.map(c => {
          if (c.id !== r.case_id) return c
          // Flash the updated row
          setFlashedIds(ids => {
            const next = new Set(ids).add(c.id)
            setTimeout(() => setFlashedIds(i => { const n = new Set(i); n.delete(c.id); return n }), 1500)
            return next
          })
          return {
            ...c,
            comms_state: {
              sla_status:        r.sla_status        as string,
              unread_count:      r.unread_count       as number,
              awaiting_response: r.awaiting_response  as boolean,
              response_due_at:   r.response_due_at    as string | null,
            },
          }
        }))
      })
      .subscribe()
    } catch (e) { console.warn('[Realtime] subscription failed:', e) }
    return () => { try { if (ch) sb.removeChannel(ch) } catch { /* ignore */ } }
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    load(activeGroup, activeStage, search, 1, sortCol, sortDir)
  }

  function selectGroup(g: string) {
    setActiveGroup(g)
    setActiveStage('')
    setPage(1)
  }

  function selectStage(s: string) {
    setActiveStage(s === activeStage ? '' : s)
    setActiveGroup('')
    setPage(1)
  }

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  function loadMore() {
    const nextPage = page + 1
    setPage(nextPage)
    load(activeGroup, activeStage, search, nextPage, sortCol, sortDir, true)
  }

  // Group tab definitions
  const GROUPS = [
    { id: '',         label: 'All',      count: total },
    { id: 'active',          label: 'Active',      count: groupCounts.active          ?? 0 },
    { id: 'attorney_review', label: 'Atty Review', count: groupCounts.attorney_review ?? 0 },
    { id: 'retained',        label: 'Retained',    count: groupCounts.retained        ?? 0 },
    { id: 'settled',         label: 'Settled',     count: groupCounts.settled         ?? 0 },
    { id: 'dropped',         label: 'Dropped',     count: groupCounts.dropped         ?? 0 },
  ]

  // Sub-stage filter (only shown when a group is active)
  const GROUP_STAGES: Record<string, string[]> = {
    active:          ['intake','nurture','document_collection','info_needed','sign_up'],
    attorney_review: ['attorney_review'],
    retained:        ['retained'],
    settled:         ['settled'],
    dropped:         ['dropped'],
  }
  const subStages = activeGroup ? GROUP_STAGES[activeGroup] ?? [] : []

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-screen-xl mx-auto">

      {/* ── Title row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">Case Queue</h1>
          {total > 0 && <span className="text-sm text-gray-400">{total.toLocaleString()} cases</span>}
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium transition-all duration-500 ${isLive ? 'text-emerald-600' : 'text-gray-300'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            {isLive ? 'Live' : 'Connecting…'}
          </span>
        </div>
      </div>

      {/* ── Search ── */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, email, vehicle, deal ID…"
          className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lemon-400 focus:border-lemon-400 focus:bg-white transition-all"
        />
        <button type="submit" className="px-4 py-2 bg-lemon-400 hover:bg-lemon-500 text-gray-900 text-sm font-semibold rounded-lg transition-all duration-150 active:scale-95">
          Search
        </button>
        {search && (
          <button type="button" onClick={() => { setSearch(''); load(activeGroup, activeStage, '', 1, sortCol, sortDir) }}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all duration-150 active:scale-95">
            Clear
          </button>
        )}
      </form>

      {/* ── Group filter tabs ── */}
      <div className="flex gap-1.5 items-center border-b border-gray-100 pb-3">
        {GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => selectGroup(g.id)}
            className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-all duration-150 active:scale-95 ${
              activeGroup === g.id && !activeStage
                ? 'bg-lemon-400 text-gray-900'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {g.label}
            <span className={`ml-1.5 text-xs tabular-nums ${activeGroup === g.id && !activeStage ? 'text-gray-700' : 'text-gray-400'}`}>
              {g.count.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {/* ── Sub-stage chips (shown when group is active) ── */}
      {subStages.length > 1 && (
        <div className="flex gap-1.5 flex-wrap -mt-2">
          {subStages.map(s => (
            <button
              key={s}
              onClick={() => selectStage(s)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-all duration-150 active:scale-95 border ${
                activeStage === s
                  ? `${STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-700'} border-transparent`
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {STATUS_LABELS[s] ?? s}
              {stageCounts[s] ? <span className="ml-1 opacity-70">{stageCounts[s].toLocaleString()}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden">
        {loading && cases.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : cases.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No cases found</p>
            {search && <p className="text-gray-300 text-xs mt-1">Try a different search term</p>}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-1 px-0" /> {/* urgency bar spacer */}
                  {[
                    { col: 'client_first_name', label: 'Client'        },
                    { col: 'vehicle_make',       label: 'Vehicle'       },
                    { col: 'case_status',        label: 'Status'        },
                    { col: 'estimated_value',    label: 'Value'         },
                    { col: 'notes_last_updated', label: 'Last Activity' },
                    { col: 'created_at',         label: 'Added'         },
                    { col: '',                   label: 'Comms'         },
                    { col: '',                   label: 'Docs'          },
                  ].map(h => (
                    <th key={h.col}
                      onClick={() => toggleSort(h.col)}
                      className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none transition-colors first:pl-6"
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {h.label}
                        <SortIcon col={h.col} active={sortCol === h.col} asc={sortDir === 'asc'} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cases.map(c => {
                  const clientName = [c.client_first_name, c.client_last_name].filter(Boolean).join(' ')
                  const vehicle    = [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')
                  const activity   = c.notes_last_updated ?? c.updated_at
                  const days       = daysSince(activity)

                  return (
                    <tr
                      key={c.id}
                      onClick={() => {
                        const returnParams = new URLSearchParams()
                        if (activeGroup) returnParams.set('group', activeGroup)
                        if (activeStage) returnParams.set('status', activeStage)
                        const qs = returnParams.toString()
                        window.location.href = `/cases/${c.hubspot_deal_id}${qs ? `?from=${encodeURIComponent('/cases?' + qs)}` : ''}`
                      }}
                      className={`cursor-pointer transition-all duration-500 border-l-4 ${
                        flashedIds.has(c.id)
                          ? 'bg-lemon-400/10 border-l-lemon-400'
                          : `hover:bg-gray-50 ${urgencyClass(c)}`
                      }`}
                    >
                      <td className="w-0 p-0" />
                      {/* Client */}
                      <td className="pl-5 pr-4 py-3.5">
                        <div className="font-medium text-gray-900 leading-tight">
                          {clientName || <span className="text-gray-300 italic text-xs">Unknown</span>}
                        </div>
                        {c.client_phone && (
                          <a
                            href={`tel:${c.client_phone}`}
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-gray-400 hover:text-lemon-500 transition-colors mt-0.5 block"
                          >
                            {c.client_phone}
                          </a>
                        )}
                      </td>
                      {/* Vehicle */}
                      <td className="px-4 py-3.5">
                        <div className="text-gray-900 leading-tight">
                          {vehicle || <span className="text-gray-300">—</span>}
                        </div>
                        {c.vehicle_is_new !== null && (
                          <div className="text-xs text-gray-400 mt-0.5">{c.vehicle_is_new ? 'New' : 'Used'}</div>
                        )}
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[c.case_status] ?? STATUS_COLORS.unknown}`}>
                          {STATUS_LABELS[c.case_status] ?? c.case_status}
                        </span>
                      </td>
                      {/* Value */}
                      <td className="px-4 py-3.5 text-gray-700 tabular-nums text-sm">
                        {c.estimated_value ? '$' + c.estimated_value.toLocaleString() : <span className="text-gray-300">—</span>}
                      </td>
                      {/* Last Activity */}
                      <td className="px-4 py-3.5">
                        <span className={`text-xs tabular-nums ${
                          days !== null && days > 30 ? 'text-red-500 font-medium' :
                          days !== null && days > 14 ? 'text-amber-500 font-medium' :
                          'text-gray-500'
                        }`}>
                          {fmtDate(activity)}
                        </span>
                        {days !== null && days > 30 && (
                          <div className="text-[10px] text-red-400 mt-0.5">{days}d inactive</div>
                        )}
                      </td>
                      {/* Added */}
                      <td className="px-4 py-3.5 text-gray-400 text-xs tabular-nums">
                        {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      {/* Comms state */}
                      <td className="px-4 py-3.5 pr-6">
                        {c.comms_state && c.comms_state.sla_status !== 'no_contact' ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Unread badge */}
                            {c.comms_state.unread_count > 0 && (
                              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-lemon-400 text-xs font-bold text-gray-900">
                                {c.comms_state.unread_count > 99 ? '99+' : c.comms_state.unread_count}
                              </span>
                            )}
                            {/* Awaiting response dot */}
                            {c.comms_state.awaiting_response && (
                              <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" title="Awaiting response" />
                            )}
                            {/* SLA badge */}
                            {c.comms_state.sla_status === 'overdue' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">Overdue</span>
                            )}
                            {c.comms_state.sla_status === 'due_soon' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Due Soon</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-200 text-xs">—</span>
                        )}
                      </td>
                      {/* Doc state */}
                      <td className="px-4 py-3.5 pr-6">
                        {(() => {
                          const ds = c.doc_state
                          if (!ds || ds.total_docs === 0) return <span className="text-gray-200 text-xs">—</span>
                          const hasAlarm = ds.missing_required > 0 && ['document_collection', 'attorney_review'].includes(c.case_status)
                          return (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {hasAlarm && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">
                                  🔴 {ds.missing_required} missing
                                </span>
                              )}
                              {ds.unclassified > 0 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                                  {ds.unclassified} unclassified
                                </span>
                              )}
                              {ds.needs_review > 0 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                                  {ds.needs_review} to review
                                </span>
                              )}
                              {ds.total_docs > 0 && ds.missing_required === 0 && ds.unclassified === 0 && ds.needs_review === 0 && (
                                <span className="text-[10px] text-emerald-500 font-medium">✓ {ds.total_docs}</span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
                <p className="text-sm text-gray-400">
                  Showing {cases.length.toLocaleString()} of {total.toLocaleString()}
                </p>
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all duration-150 active:scale-95 disabled:opacity-40"
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function CasesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-16 text-gray-400 text-sm">Loading…</div>}>
      <CasesContent />
    </Suspense>
  )
}
