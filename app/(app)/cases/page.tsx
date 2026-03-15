'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

interface Case {
  id: string
  hubspot_deal_id: string
  client_first_name: string | null
  client_last_name: string | null
  client_email: string | null
  client_phone: string | null
  vehicle_year: number | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_mileage: number | null
  vehicle_is_new: boolean | null
  state_jurisdiction: string | null
  case_status: string
  case_priority: string | null
  estimated_value: number | null
  created_at: string
  updated_at: string
}

const STATUS_LABELS: Record<string, string> = {
  intake:              'Intake',
  nurture:             'Nurture',
  document_collection: 'Documents',
  attorney_review:     'Attorney Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up',
  retained:            'Retained',
  settled:             'Settled',
  dropped:             'Dropped',
  unknown:             'Unknown',
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

function CasesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [cases, setCases] = useState<Case[]>([])
  const [total, setTotal] = useState(0)
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [activeStatus, setActiveStatus] = useState(searchParams.get('status') ?? '')
  const [page, setPage] = useState(1)
  const [isLive, setIsLive] = useState(false)
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set())
  const esRef = useRef<EventSource | null>(null)

  const load = useCallback(async (status: string, q: string, p: number) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p) })
    if (status) params.set('status', status)
    if (q)      params.set('search', q)
    const res = await fetch(`/api/cases?${params}`)
    if (res.ok) {
      const data = await res.json()
      setCases(data.cases)
      setTotal(data.total)
      setStageCounts(data.stageCounts)
    }
    setLoading(false)
  }, [])

  useEffect(() => { document.title = 'Cases | 🍋 Team Portal — Easy Lemon' }, [])
  useEffect(() => { load(activeStatus, search, page) }, [activeStatus, page])

  // SSE subscription — live case updates
  useEffect(() => {
    function connect() {
      const es = new EventSource('/api/cases/stream')
      esRef.current = es

      es.addEventListener('connected', () => setIsLive(true))
      es.onerror = () => { setIsLive(false) }

      es.addEventListener('case', (e: MessageEvent) => {
        const payload = JSON.parse(e.data) as {
          type: 'INSERT' | 'UPDATE' | 'DELETE'
          new: Case | null
          old: Case | null
        }

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
    return () => {
      esRef.current?.close()
      setIsLive(false)
    }
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    load(activeStatus, search, 1)
  }

  function selectStatus(s: string) {
    setActiveStatus(s)
    setPage(1)
  }

  const totalPages = Math.ceil(total / 25)

  const allStatuses = Object.keys(STATUS_LABELS).filter(
    s => stageCounts[s] || s === ''
  )

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-5">

      {/* Page title row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">
            Case Queue
          </h1>
          {total > 0 && (
            <span className="text-sm font-normal text-gray-400">
              {total.toLocaleString()} cases
            </span>
          )}
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium transition-all duration-500 ${isLive ? 'text-emerald-600' : 'text-gray-300'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            {isLive ? 'Live' : 'Connecting…'}
          </span>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, vehicle, deal ID…"
          className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lemon-400 focus:border-lemon-400 focus:bg-white transition-all"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-lemon-400 hover:bg-lemon-500 text-gray-900 text-sm font-semibold rounded-lg transition-all duration-150 active:scale-95"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); setPage(1); load(activeStatus, '', 1) }}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all duration-150 active:scale-95"
          >
            Clear
          </button>
        )}
      </form>

      {/* Status filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => selectStatus('')}
          className={`px-3.5 py-1.5 text-sm rounded-lg font-medium transition-all duration-150 active:scale-95 ${
            activeStatus === ''
              ? 'bg-lemon-400 text-gray-900 border border-lemon-500'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          All ({total.toLocaleString()})
        </button>
        {Object.entries(stageCounts)
          .sort(([,a],[,b]) => b - a)
          .map(([status, count]) => (
          <button
            key={status}
            onClick={() => selectStatus(status)}
            className={`px-3.5 py-1.5 text-sm rounded-lg font-medium transition-all duration-150 active:scale-95 ${
              activeStatus === status
                ? 'bg-lemon-400 text-gray-900 border border-lemon-500'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {STATUS_LABELS[status] ?? status} ({count.toLocaleString()})
          </button>
        ))}
        </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-card">
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : cases.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">No cases found</p>
              {search && <p className="text-gray-400 text-xs mt-1">Try a different search term</p>}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Client</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Vehicle</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">State</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Mileage</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Value</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cases.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => { window.location.href = `/cases/${c.hubspot_deal_id}` }}
                    className={`cursor-pointer transition-all duration-500 border-l-2 ${
                      flashedIds.has(c.id)
                        ? 'bg-lemon-400/10 border-l-lemon-400'
                        : 'hover:bg-gray-50 border-l-transparent hover:border-l-gray-200'
                    }`}
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {[c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || <span className="text-gray-300 italic">Unknown</span>}
                      </div>
                      {c.client_email && <div className="text-xs text-gray-400 mt-0.5">{c.client_email}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-gray-900">
                        {[c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || <span className="text-gray-300">—</span>}
                      </div>
                      {c.vehicle_is_new !== null && (
                        <div className="text-xs text-gray-400 mt-0.5">{c.vehicle_is_new ? 'New' : 'Used'}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[c.case_status] ?? STATUS_COLORS.unknown}`}>
                        {STATUS_LABELS[c.case_status] ?? c.case_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 text-sm">{c.state_jurisdiction ?? '—'}</td>
                    <td className="px-6 py-4 text-gray-600 text-sm tabular-nums">
                      {c.vehicle_mileage ? c.vehicle_mileage.toLocaleString() : '—'}
                    </td>
                    <td className="px-6 py-4 text-gray-600 text-sm tabular-nums">
                      {c.estimated_value ? '$' + c.estimated_value.toLocaleString() : '—'}
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-xs tabular-nums">
                      {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            Page {page} of {totalPages} · {total.toLocaleString()} cases
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3.5 py-1.5 text-sm font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-300 hover:bg-gray-50 transition-all duration-150 active:scale-95"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3.5 py-1.5 text-sm font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-300 hover:bg-gray-50 transition-all duration-150 active:scale-95"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CasesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400 text-sm">Loading...</div>}>
      <CasesContent />
    </Suspense>
  )
}
