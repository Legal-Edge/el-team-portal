'use client'

import { useState, useMemo } from 'react'

interface AzureUser {
  name:       string | null
  email:      string | null
  title:      string | null
  department: string | null
  enabled:    boolean
}

// Role badge config — maps job title keywords to portal role labels
function inferPortalRole(title: string | null): { label: string; color: string } | null {
  if (!title) return null
  const t = title.toLowerCase()
  if (t.includes('attorney') || t.includes('associate') || t.includes('clo'))
    return { label: 'Attorney',     color: 'bg-purple-50 text-purple-700' }
  if (t.includes('paralegal'))
    return { label: 'Paralegal',    color: 'bg-blue-50 text-blue-700' }
  if (t.includes('case manager') || t.includes('settlement coordinator'))
    return { label: 'Case Manager', color: 'bg-teal-50 text-teal-700' }
  if (t.includes('intake') || t.includes('document intake') || t.includes('document coordinator'))
    return { label: 'Intake',       color: 'bg-orange-50 text-orange-700' }
  if (t.includes('support') || t.includes('client success') || t.includes('legal assistant') || t.includes('client services'))
    return { label: 'Support',      color: 'bg-gray-100 text-gray-600' }
  if (t.includes('admin') || t.includes('ceo') || t.includes('cfo') || t.includes('cto') || t.includes('director') || t.includes('manager') || t.includes('operations'))
    return { label: 'Admin',        color: 'bg-red-50 text-red-600' }
  return null
}

function Avatar({ name }: { name: string | null }) {
  const initials = (name ?? '?')
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()

  const colors = [
    'bg-lemon-100 text-lemon-800',
    'bg-purple-100 text-purple-800',
    'bg-blue-100 text-blue-800',
    'bg-teal-100 text-teal-800',
    'bg-orange-100 text-orange-800',
    'bg-pink-100 text-pink-800',
  ]
  const color = colors[(name ?? '').charCodeAt(0) % colors.length]

  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${color}`}>
      {initials}
    </div>
  )
}

const PAGE_SIZE = 25

export function UsersTable({ users }: { users: AzureUser[] }) {
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState<'all' | 'active' | 'disabled'>('all')
  const [page,       setPage]       = useState(1)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return users.filter(u => {
      const matchSearch =
        !q ||
        (u.name  ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.title ?? '').toLowerCase().includes(q)
      const matchFilter =
        filter === 'all'      ? true :
        filter === 'active'   ? u.enabled :
        !u.enabled
      return matchSearch && matchFilter
    })
  }, [users, search, filter])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleSearch(val: string) {
    setSearch(val)
    setPage(1)
  }
  function handleFilter(val: typeof filter) {
    setFilter(val)
    setPage(1)
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-gray-100">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lemon-400/50"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg">
          {(['all', 'active', 'disabled'] as const).map(f => (
            <button
              key={f}
              onClick={() => handleFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                filter === f
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <span className="text-xs text-gray-400 ml-auto shrink-0">
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table — desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Job Title</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Department</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Portal Role</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paged.map(u => {
              const role = inferPortalRole(u.title)
              return (
                <tr key={u.email} className="hover:bg-gray-50/50 transition-colors">
                  {/* Name + email */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{u.name ?? '—'}</p>
                        <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600">{u.title ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-5 py-3.5 text-gray-600">{u.department ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-5 py-3.5">
                    {role ? (
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${role.color}`}>
                        {role.label}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {u.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-gray-50">
        {paged.map(u => {
          const role = inferPortalRole(u.title)
          return (
            <div key={u.email} className="flex items-start gap-3 p-4">
              <Avatar name={u.name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-gray-900 truncate">{u.name ?? '—'}</p>
                  <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium ${u.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${u.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    {u.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate mt-0.5">{u.email ?? '—'}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {u.title && <span className="text-xs text-gray-500">{u.title}</span>}
                  {role && (
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${role.color}`}>
                      {role.label}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40">
          <p className="text-xs text-gray-400">
            Page {page} of {totalPages} · {filtered.length} results
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {paged.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">
          No users match your search.
        </div>
      )}
    </div>
  )
}
