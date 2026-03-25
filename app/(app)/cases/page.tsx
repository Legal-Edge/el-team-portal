'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient }                             from '@supabase/supabase-js'
import { useSearchParams, useRouter, usePathname }  from 'next/navigation'
import { Suspense }                                 from 'react'

import { StageTabs }    from '@/components/cases/queue/StageTabs'
import { ViewTabs }     from '@/components/cases/queue/ViewTabs'
import { FilterBuilder } from '@/components/cases/queue/FilterBuilder'
import { ColumnManager } from '@/components/cases/queue/ColumnManager'
import { CaseRow, type CaseRecord } from '@/components/cases/queue/CaseRow'
import {
  ALL_COLUMNS,
  DEFAULT_COLUMNS,
  getDefaultColumnsForStage,
  type CaseView,
  type FilterGroup,
} from '@/lib/cases/column-defs'

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
  const router      = useRouter()
  const pathname    = usePathname()

  const [cases,        setCases]        = useState<CaseRecord[]>([])
  const [total,        setTotal]        = useState(0)
  const [stageCounts,  setStageCounts]  = useState<Record<string, number>>({})
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState(searchParams.get('search') ?? '')
  const [activeStage,  setActiveStage]  = useState(searchParams.get('status') ?? '')
  const [page,         setPage]         = useState(1)
  const [hasMore,      setHasMore]      = useState(false)
  const [sortCol,      setSortCol]      = useState('notes_last_updated')
  const [sortDir,      setSortDir]      = useState<'asc' | 'desc'>('desc')
  const [isLive,       setIsLive]       = useState(false)
  const [flashedIds,   setFlashedIds]   = useState<Set<string>>(new Set())
  const [lastViewedId, setLastViewedId] = useState<string | null>(null)

  // Columns
  const [activeColumns, setActiveColumns]   = useState<string[]>(DEFAULT_COLUMNS)
  const [colWidths,     setColWidths]       = useState<Record<string, number>>({})
  const [showColMgr,    setShowColMgr]      = useState(false)

  // Filters
  const [filterGroups,   setFilterGroups]   = useState<FilterGroup[]>([])
  const [showFilter,     setShowFilter]     = useState(false)

  // Saved views
  const [savedViews,     setSavedViews]     = useState<CaseView[]>([])
  const [activeViewId,   setActiveViewId]   = useState<string | null>(null)
  const [isAdmin,        setIsAdmin]        = useState(false)
  const [showSaveModal,  setShowSaveModal]  = useState(false)
  const [saveError,      setSaveError]      = useState<string | null>(null)
  const [saveConfirm,    setSaveConfirm]    = useState<string | null>(null)
  const [newViewName,    setNewViewName]    = useState('')
  const [saveAsTeam,     setSaveAsTeam]     = useState(false)
  const [savingView,     setSavingView]     = useState(false)
  const [saveMode,       setSaveMode]       = useState<'new' | 'update'>('new')
  const [updateTargetId, setUpdateTargetId] = useState<string>('')

  const esRef      = useRef<EventSource | null>(null)
  const resizeRef  = useRef<{ colId: string; startX: number; startW: number } | null>(null)

  const startResize = (e: React.MouseEvent, colId: string, currentWidth: number) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { colId, startX: e.clientX, startW: currentWidth }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const newW = Math.max(50, resizeRef.current.startW + (ev.clientX - resizeRef.current.startX))
      setColWidths(prev => ({ ...prev, [resizeRef.current!.colId]: newW }))
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const colBtnRef = useRef<HTMLDivElement>(null)
  const filterBtnRef = useRef<HTMLDivElement>(null)

  useEffect(() => { document.title = 'Cases | Team Portal' }, [])

  // Restore last viewed
  useEffect(() => {
    const id = sessionStorage.getItem('last_viewed_case_id')
    if (id) { setLastViewedId(id); sessionStorage.removeItem('last_viewed_case_id') }
  }, [])

  // Check admin status + load saved views
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch('/api/cases/views')
        if (res.ok) {
          const json = await res.json()
          const views: CaseView[] = json.views ?? []
          setSavedViews(views)

          // Auto-apply the saved view that matches the current stage (or first view if no stage)
          const currentStage = searchParams.get('status') ?? ''
          const match = views.find(v => v.stage_tab === (currentStage || null))
            ?? (currentStage ? null : views[0] ?? null)
          if (match) {
            setActiveViewId(match.id)
            if (match.columns?.length)  setActiveColumns(match.columns)
            if (match.filters?.length)  setFilterGroups(match.filters)
            if (match.sort_by)          setSortCol(match.sort_by)
            if (match.sort_dir)         setSortDir(match.sort_dir as 'asc' | 'desc')
          }
        }
        // Check if admin via session
        const sr = await fetch('/api/session')
        if (sr.ok) {
          const sj = await sr.json()
          const ownerEmail = process.env.NEXT_PUBLIC_PORTAL_OWNER_EMAIL ?? 'novaj@rockpointgrowth.com'
          setIsAdmin(sj?.email === ownerEmail)
        }
      } catch { /* ignore */ }
    }
    init()
  }, [])

  // ── Data fetcher ──────────────────────────────────────────────────────────
  const load = useCallback(async (
    status: string, q: string, p: number, col: string, dir: string,
    filters: FilterGroup[], append = false
  ) => {
    if (!append) setLoading(true)
    const params = new URLSearchParams({ page: String(p), sort: col, dir })
    if (status) params.set('status', status)
    if (q)      params.set('search', q)
    if (filters.length > 0) params.set('filters', JSON.stringify(filters))

    const res = await fetch(`/api/cases?${params}`)
    if (res.ok) {
      const data = await res.json()
      setCases(prev => append ? [...prev, ...(data.cases ?? [])] : (data.cases ?? []))
      setTotal(data.total ?? 0)
      setStageCounts(data.stageCounts ?? {})
      setHasMore((data.cases?.length ?? 0) === 25)
    }
    setLoading(false)
  }, [])

  // Initial + filter changes
  useEffect(() => {
    setPage(1)
    load(activeStage, search, 1, sortCol, sortDir, filterGroups)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage, sortCol, sortDir, filterGroups])

  // Update columns when stage changes
  useEffect(() => {
    if (!activeViewId) {
      setActiveColumns(activeStage ? getDefaultColumnsForStage(activeStage) : DEFAULT_COLUMNS)
    }
  }, [activeStage, activeViewId])

  // ── SSE live updates ──────────────────────────────────────────────────────
  useEffect(() => {
    function connect() {
      const es = new EventSource('/api/cases/stream')
      esRef.current = es
      es.addEventListener('connected', () => setIsLive(true))
      es.onerror = () => setIsLive(false)
      es.addEventListener('case', (e: MessageEvent) => {
        const payload = JSON.parse(e.data) as { type: string; new: CaseRecord | null; old: CaseRecord | null }
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

  // ── Supabase realtime comms_state ─────────────────────────────────────────
  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    let ch: ReturnType<typeof sb.channel> | undefined
    try {
      ch = sb
        .channel('cases-queue-comms')
        .on('postgres_changes', { event: 'UPDATE', schema: 'core', table: 'comms_state' },
          (payload: { new: Record<string, unknown> }) => {
            const r = payload.new
            setCases(prev => prev.map(c => {
              if (c.id !== r.case_id) return c
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
    } catch (e) { console.warn('[Realtime] comms_state subscription failed:', e) }
    return () => { try { if (ch) sb.removeChannel(ch) } catch { /* ignore */ } }
  }, [])

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    load(activeStage, search, 1, sortCol, sortDir, filterGroups)
  }

  function selectStage(s: string) {
    setActiveStage(s)
    setActiveViewId(null)
    setPage(1)
    // Persist tab in URL so refresh restores it
    const params = new URLSearchParams(searchParams.toString())
    if (s) { params.set('status', s) } else { params.delete('status') }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function toggleSort(col: string) {
    if (!col) return
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function loadMore() {
    const next = page + 1
    setPage(next)
    load(activeStage, search, next, sortCol, sortDir, filterGroups, true)
  }

  function applyView(view: CaseView) {
    setActiveViewId(view.id)
    setActiveStage(view.stage_tab ?? '')
    setActiveColumns(view.columns.length > 0 ? view.columns : DEFAULT_COLUMNS)
    setFilterGroups(view.filters ?? [])
    setSortCol(view.sort_by ?? 'notes_last_updated')
    setSortDir((view.sort_dir ?? 'desc') as 'asc' | 'desc')
  }

  async function deleteView(view: CaseView) {
    if (!confirm(`Delete view "${view.name}"?`)) return
    await fetch(`/api/cases/views?id=${view.id}`, { method: 'DELETE' })
    setSavedViews(prev => prev.filter(v => v.id !== view.id))
    if (activeViewId === view.id) setActiveViewId(null)
  }

  // Update existing view in-place (no modal needed)
  async function updateView() {
    if (!activeViewId) return
    setSavingView(true)
    try {
      const res = await fetch(`/api/cases/views?id=${activeViewId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_tab: activeStage || null,
          columns:   activeColumns,
          filters:   filterGroups,
          sort_by:   sortCol,
          sort_dir:  sortDir,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        setSavedViews(prev => prev.map(v => v.id === activeViewId ? { ...v, ...json.view } : v))
      }
    } finally {
      setSavingView(false)
    }
  }

  // Create new named view (uses modal)
  async function saveView() {
    if (!newViewName.trim()) return
    setSavingView(true)
    try {
      const res = await fetch('/api/cases/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           newViewName.trim(),
          is_team_preset: saveAsTeam,
          stage_tab:      activeStage || null,
          columns:        activeColumns,
          filters:        filterGroups,
          sort_by:        sortCol,
          sort_dir:       sortDir,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        setSavedViews(prev => [...prev, json.view])
        setActiveViewId(json.view.id)
        setShowSaveModal(false)
        setNewViewName('')
        setSaveAsTeam(false)
        setShowFilter(false)
        setSaveError(null)
      } else {
        const err = await res.json().catch(() => ({}))
        setSaveError(err.error ?? `Error ${res.status}`)
      }
    } finally {
      setSavingView(false)
    }
  }

  const hasActiveFilters = filterGroups.length > 0 &&
    filterGroups.some(g => g.conditions.some(c => c.value || ['is_known','is_unknown'].includes(c.operator)))

  // Sortable column headers
  const SORTABLE_COLS: Record<string, string> = {
    case_number:        'case_number',
    client:             'client_first_name',
    state:              'state_jurisdiction',
    stage:              'case_status',
    last_activity:      'notes_last_updated',
  }

  return (
    <div className="p-4 md:p-6 space-y-4">

      {/* ── Title row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Case Queue</h1>
          {total > 0 && <span className="text-sm text-gray-400">{total.toLocaleString()} cases</span>}
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium transition-all duration-500 ${isLive ? 'text-emerald-600' : 'text-gray-300'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            {isLive ? 'Live' : 'Connecting…'}
          </span>
        </div>
      </div>

      {/* ── Stage tabs ── */}
      <StageTabs
        activeStage={activeStage}
        stageCounts={stageCounts}
        total={total}
        onSelect={selectStage}
      />

      {/* ── Saved view tabs — hidden for now (per-stage configs save/restore silently) ── */}
      {false && savedViews.length > 0 && (
        <ViewTabs
          views={savedViews}
          activeViewId={activeViewId}
          onSelect={applyView}
          onDelete={deleteView}
          isAdmin={isAdmin}
        />
      )}

      {/* ── Toolbar: search + filter + columns ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, vehicle, deal ID…"
            className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lemon-400 focus:border-lemon-400 focus:bg-white transition-all"
          />
          <button type="submit" className="px-4 py-2 bg-lemon-400 hover:bg-lemon-500 text-gray-900 text-sm font-semibold rounded-lg transition-all duration-150 active:scale-95">
            Search
          </button>
          {search && (
            <button type="button"
              onClick={() => { setSearch(''); load(activeStage, '', 1, sortCol, sortDir, filterGroups) }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all duration-150">
              Clear
            </button>
          )}
        </form>

        {/* Filter button */}
        <div ref={filterBtnRef} className="relative">
          <button
            onClick={() => { setShowFilter(v => !v); setShowColMgr(false) }}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-all duration-150 ${
              hasActiveFilters
                ? 'bg-lemon-400 border-lemon-400 text-gray-900'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            {hasActiveFilters ? `Filters (${filterGroups.reduce((acc, g) => acc + g.conditions.length, 0)})` : 'Add filter'}
          </button>

          {showFilter && (
            <FilterBuilder
              groups={filterGroups}
              onChange={groups => { setFilterGroups(groups); setPage(1) }}
              onClose={() => setShowFilter(false)}
              onSaveView={() => { setShowFilter(false); setShowSaveModal(true) }}
              hasActiveFilters={hasActiveFilters}
            />
          )}
        </div>

        {/* Edit columns button */}
        <div ref={colBtnRef} className="relative">
          <button
            onClick={() => { setShowColMgr(v => !v); setShowFilter(false) }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition-all duration-150"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            Edit columns
          </button>

          {showColMgr && (
            <ColumnManager
              activeColumns={activeColumns}
              onChange={cols => setActiveColumns(cols)}
              onClose={() => setShowColMgr(false)}
            />
          )}
        </div>

        {/* Save view — update existing or create new */}
        <button
          onClick={async () => {
            if (activeViewId) { await updateView(); return }
            // If a view already exists for this stage, update it instead of creating duplicate
            const existingForStage = savedViews.find(v => v.stage_tab === (activeStage || null))
            if (existingForStage) {
              setActiveViewId(existingForStage.id)
              // Inline update (can't call updateView() yet since state hasn't flushed)
              setSavingView(true); setSaveError(null)
              try {
                const r = await fetch(`/api/cases/views?id=${existingForStage.id}`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ stage_tab: activeStage||null, columns: activeColumns, filters: filterGroups, sort_by: sortCol, sort_dir: sortDir }),
                })
                if (r.ok) {
                  const j = await r.json()
                  setSavedViews(prev => prev.map(v => v.id === existingForStage.id ? { ...v, ...j.view } : v))
                  setSaveConfirm(`Saved "${existingForStage.name}"`)
                  setTimeout(() => setSaveConfirm(null), 3000)
                } else { const e = await r.json().catch(()=>({})); setSaveError(e.error ?? 'Save failed') }
              } finally { setSavingView(false) }
              return
            }
            // Auto-save with stage name — no modal needed
            const stageLabels: Record<string,string> = {
              intake:'Intake', nurture:'Nurture', document_collection:'Doc Collection',
              attorney_review:'Attorney Review', info_needed:'Info Needed', sign_up:'Sign Up',
              retained:'Retained', settled:'Settled', dropped:'Dropped',
            }
            const name = stageLabels[activeStage] ?? 'My View'
            setSavingView(true)
            setSaveError(null)
            try {
              const res = await fetch('/api/cases/views', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name, is_team_preset: isAdmin,
                  stage_tab: activeStage || null,
                  columns: activeColumns, filters: filterGroups,
                  sort_by: sortCol, sort_dir: sortDir,
                }),
              })
              if (res.ok) {
                const json = await res.json()
                setSavedViews(prev => [...prev, json.view])
                setActiveViewId(json.view.id)
                setSaveConfirm(`Saved as "${name}"`)
                setTimeout(() => setSaveConfirm(null), 3000)
              } else {
                const err = await res.json().catch(() => ({}))
                setSaveError(err.error ?? `Save failed (${res.status})`)
              }
            } finally { setSavingView(false) }
          }}
          disabled={savingView}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition-all duration-150 disabled:opacity-40"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h8l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
          </svg>
          {savingView ? 'Saving…' : 'Save view'}
        </button>
        {saveConfirm && <span className="text-xs text-emerald-600 font-medium">{saveConfirm}</span>}
        {saveError   && <span className="text-xs text-red-500 font-medium">{saveError}</span>}
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
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
              <table className="w-full text-sm" style={{ minWidth: activeColumns.length * 80, tableLayout: 'fixed' }}>
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 group">
                    
                    {activeColumns.map(colId => {
                      const colDef  = ALL_COLUMNS.find(c => c.id === colId)
                      const sortKey = SORTABLE_COLS[colId]
                      const sortable = colDef?.sortable && !!sortKey
                      return (
                        <th
                          key={colId}
                          onClick={() => sortable && toggleSort(sortKey)}
                          className={`relative text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide select-none ${
                            sortable ? 'cursor-pointer hover:text-gray-700 transition-colors' : ''
                          }`}
                          style={{ width: colWidths[colId] ?? colDef?.width, minWidth: 50 }}
                        >
                          <span className="inline-flex items-center gap-0.5">
                            {colDef?.label ?? colId}
                            {sortable && (
                              <SortIcon col={sortKey} active={sortCol === sortKey} asc={sortDir === 'asc'} />
                            )}
                          </span>
                          {/* Resize handle */}
                          <span
                            onMouseDown={e => startResize(e, colId, colWidths[colId] ?? colDef?.width ?? 120)}
                            onClick={e => e.stopPropagation()}
                            className="absolute right-0 top-0 h-full w-3 flex items-center justify-center cursor-col-resize opacity-0 hover:opacity-100 group-hover:opacity-60 z-10"
                            style={{ userSelect: 'none' }}
                          >
                            <span className="w-px h-4 bg-gray-300 rounded" />
                          </span>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cases.map((c, idx) => (
                    <CaseRow
                      key={c.id}
                      c={c}
                      columns={activeColumns}
                      colWidths={colWidths}
                      isFlashed={flashedIds.has(c.id)}
                      isLastViewed={lastViewedId === c.hubspot_deal_id}
                      queueIds={cases.map(x => x.hubspot_deal_id)}
                      queueIdx={idx}
                      activeStage={activeStage}
                      onRef={lastViewedId === c.hubspot_deal_id
                        ? (el) => { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
                        : undefined
                      }
                    />
                  ))}
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

      {/* ── Save view modal ── */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="font-semibold text-gray-900 text-lg">Save View</h2>
            {saveError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>
            )}

            {/* Mode toggle */}
            {savedViews.filter(v => !v.is_team_preset || isAdmin).length > 0 && (
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                <button
                  onClick={() => setSaveMode('update')}
                  className={`flex-1 py-2 font-medium transition-colors ${saveMode === 'update' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Update existing
                </button>
                <button
                  onClick={() => setSaveMode('new')}
                  className={`flex-1 py-2 font-medium transition-colors ${saveMode === 'new' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Save as new
                </button>
              </div>
            )}

            {saveMode === 'update' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Choose view to update</label>
                <select
                  value={updateTargetId}
                  onChange={e => setUpdateTargetId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lemon-400 bg-white"
                >
                  {savedViews.filter(v => !v.is_team_preset || isAdmin).map(v => (
                    <option key={v.id} value={v.id}>{v.name}{v.is_team_preset ? ' (team)' : ''}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">View name</label>
                  <input
                    autoFocus
                    type="text"
                    value={newViewName}
                    onChange={e => setNewViewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveView()}
                    placeholder="e.g. My Attorney Review"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lemon-400"
                  />
                </div>
                {isAdmin && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveAsTeam}
                      onChange={e => setSaveAsTeam(e.target.checked)}
                      className="w-4 h-4 accent-lemon-400"
                    />
                    Save as team preset (visible to all staff)
                  </label>
                )}
              </>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setShowSaveModal(false); setNewViewName('') }}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (saveMode === 'update' && updateTargetId) {
                    const prevId = activeViewId
                    // Temporarily set activeViewId so updateView() targets the right one
                    setActiveViewId(updateTargetId)
                    setSavingView(true)
                    try {
                      const res = await fetch(`/api/cases/views?id=${updateTargetId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ stage_tab: activeStage || null, columns: activeColumns, filters: filterGroups, sort_by: sortCol, sort_dir: sortDir }),
                      })
                      if (res.ok) {
                        const json = await res.json()
                        setSavedViews(prev => prev.map(v => v.id === updateTargetId ? { ...v, ...json.view } : v))
                        setShowSaveModal(false)
                      }
                    } finally { setSavingView(false) }
                  } else {
                    saveView()
                  }
                }}
                disabled={saveMode === 'new' ? (!newViewName.trim() || savingView) : (!updateTargetId || savingView)}
                className="px-4 py-2 text-sm font-semibold bg-lemon-400 hover:bg-lemon-500 text-gray-900 rounded-lg transition-colors disabled:opacity-40"
              >
                {savingView ? 'Saving…' : saveMode === 'update' ? 'Update View' : 'Save View'}
              </button>
            </div>
          </div>
        </div>
      )}
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
