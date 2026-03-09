'use client'

import { useEffect, useState, useCallback } from 'react'
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

  useEffect(() => { load(activeStatus, search, page) }, [activeStatus, page])

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
              <span>/</span>
              <span>Cases</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              Case Queue
              {total > 0 && <span className="ml-2 text-sm font-normal text-gray-500">({total} total)</span>}
            </h1>
          </div>
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            ← Dashboard
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-6">
        {/* Search */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, vehicle, deal ID..."
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1); load(activeStatus, '', 1) }}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900"
            >
              Clear
            </button>
          )}
        </form>

        {/* Status filter tabs */}
        <div className="flex gap-1 flex-wrap mb-4">
          <button
            onClick={() => selectStatus('')}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              activeStatus === ''
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-400'
            }`}
          >
            All ({total})
          </button>
          {Object.entries(stageCounts)
            .sort(([,a],[,b]) => b - a)
            .map(([status, count]) => (
            <button
              key={status}
              onClick={() => selectStatus(status)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                activeStatus === status
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-400'
              }`}
            >
              {STATUS_LABELS[status] ?? status} ({count})
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading cases...</div>
          ) : cases.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">No cases found</p>
              {search && <p className="text-gray-400 text-xs mt-1">Try a different search term</p>}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Vehicle</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">State</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Mileage</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Value</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Synced</th>
                </tr>
              </thead>
              <tbody>
                {cases.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => { window.location.href = `/cases/${c.hubspot_deal_id}` }}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {[c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || <span className="text-gray-400 italic">Unknown</span>}
                      </div>
                      {c.client_email && <div className="text-xs text-gray-400 mt-0.5">{c.client_email}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">
                        {[c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || <span className="text-gray-400 italic">—</span>}
                      </div>
                      {c.vehicle_is_new !== null && (
                        <div className="text-xs text-gray-400 mt-0.5">{c.vehicle_is_new ? 'New' : 'Used'}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[c.case_status] ?? STATUS_COLORS.unknown}`}>
                        {STATUS_LABELS[c.case_status] ?? c.case_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.state_jurisdiction ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.vehicle_mileage ? c.vehicle_mileage.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.estimated_value ? '$' + c.estimated_value.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">
              Page {page} of {totalPages} · {total} total cases
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-400 transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-400 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
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
