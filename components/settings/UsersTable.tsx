'use client'

import { useState, useMemo, useCallback } from 'react'

export interface AzureUser {
  name:       string | null
  email:      string | null
  title:      string | null
  department: string | null
  enabled:    boolean
  blocked:    boolean
}

// ── Portal role inference ────────────────────────────────────────────────────

export type PortalRole = 'Admin' | 'Attorney' | 'Paralegal' | 'Case Manager' | 'Intake' | 'Support' | 'System'

export function inferPortalRole(title: string | null): { label: PortalRole; color: string } | null {
  if (!title) return null
  const t = title.toLowerCase()
  if (t === 'bot' || t.includes('integration') || t.includes('leads') || t.includes('noreply') || t.includes('admin') && t.includes('tech'))
    return { label: 'System',       color: 'bg-gray-100 text-gray-500' }
  if (t.includes('attorney') || t.includes('associate') || t.includes('clo') || t.includes('counsel'))
    return { label: 'Attorney',     color: 'bg-purple-50 text-purple-700' }
  if (t.includes('paralegal'))
    return { label: 'Paralegal',    color: 'bg-blue-50 text-blue-700' }
  if (t.includes('case manager') || t.includes('settlement') || t.includes('case summary') || t.includes('compliance'))
    return { label: 'Case Manager', color: 'bg-teal-50 text-teal-700' }
  if (t.includes('intake') || t.includes('document intake') || t.includes('document coordinator') || t.includes('document specialist') || t.includes('demand writer') || t.includes('quality control'))
    return { label: 'Intake',       color: 'bg-orange-50 text-orange-700' }
  if (t.includes('support') || t.includes('client success') || t.includes('client services') || t.includes('legal assistant') || t.includes('service support'))
    return { label: 'Support',      color: 'bg-sky-50 text-sky-700' }
  if (t.includes('ceo') || t.includes('cfo') || t.includes('cto') || t.includes('director') || t.includes('operations manager') || t.includes('marketing') || t.includes('it systems') || t.includes('ai assistant'))
    return { label: 'Admin',        color: 'bg-red-50 text-red-600' }
  return null
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string | null }) {
  const initials = (name ?? '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
  const palette  = ['bg-lemon-100 text-lemon-800','bg-purple-100 text-purple-800','bg-blue-100 text-blue-800','bg-teal-100 text-teal-800','bg-orange-100 text-orange-800','bg-pink-100 text-pink-800']
  const color    = palette[(name ?? '').charCodeAt(0) % palette.length]
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${color}`}>
      {initials}
    </div>
  )
}

// ── Delete confirmation ───────────────────────────────────────────────────────

function DeleteConfirm({ user, onConfirm, onCancel, loading }: {
  user:      AzureUser
  onConfirm: () => void
  onCancel:  () => void
  loading:   boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm mx-4 w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Remove portal access?</h3>
        <p className="text-sm text-gray-500 mb-1">
          <span className="font-medium text-gray-800">{user.name}</span> ({user.email}) will no longer be able to access the team portal.
        </p>
        <p className="text-xs text-gray-400 mb-5">Their Azure AD account is not affected.</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {loading ? 'Removing…' : 'Remove Access'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main UsersTable ───────────────────────────────────────────────────────────

const PAGE_OPTIONS = [25, 50, 100, 0] // 0 = all
const STATUS_OPTS  = ['all', 'active', 'disabled', 'blocked'] as const
type  StatusFilter = typeof STATUS_OPTS[number]

export function UsersTable({ users: initialUsers }: { users: AzureUser[] }) {
  const [users,       setUsers]       = useState<AzureUser[]>(initialUsers)
  const [search,      setSearch]      = useState('')
  const [statusF,     setStatusF]     = useState<StatusFilter>('all')
  const [titleF,      setTitleF]      = useState('')
  const [deptF,       setDeptF]       = useState('')
  const [roleF,       setRoleF]       = useState('')
  const [pageSize,    setPageSize]    = useState(25)
  const [page,        setPage]        = useState(1)
  const [deleteUser,  setDeleteUser]  = useState<AzureUser | null>(null)
  const [deleteLoad,  setDeleteLoad]  = useState(false)

  // Unique filter options
  const titles  = useMemo(() => Array.from(new Set(users.map(u => u.title).filter(Boolean))).sort() as string[], [users])
  const depts   = useMemo(() => Array.from(new Set(users.map(u => u.department).filter(Boolean))).sort() as string[], [users])
  const roles   = useMemo(() => {
    const set = new Set<string>()
    users.forEach(u => { const r = inferPortalRole(u.title); if (r) set.add(r.label) })
    return Array.from(set).sort()
  }, [users])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return users.filter(u => {
      if (q && !(u.name ?? '').toLowerCase().includes(q) && !(u.email ?? '').toLowerCase().includes(q) && !(u.title ?? '').toLowerCase().includes(q)) return false
      if (titleF && u.title !== titleF) return false
      if (deptF  && u.department !== deptF) return false
      if (roleF) {
        const r = inferPortalRole(u.title)
        if (!r || r.label !== roleF) return false
      }
      if (statusF === 'active')   return u.enabled && !u.blocked
      if (statusF === 'disabled') return !u.enabled
      if (statusF === 'blocked')  return u.blocked
      return true
    })
  }, [users, search, titleF, deptF, roleF, statusF])

  const totalPages = pageSize === 0 ? 1 : Math.ceil(filtered.length / pageSize)
  const paged      = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)

  const hasFilters = search || titleF || deptF || roleF || statusF !== 'all'

  function reset() {
    setSearch(''); setTitleF(''); setDeptF(''); setRoleF(''); setStatusF('all'); setPage(1)
  }
  function onSearchChange(v: string) { setSearch(v); setPage(1) }
  function onFilter(setter: (v: string) => void) { return (e: React.ChangeEvent<HTMLSelectElement>) => { setter(e.target.value); setPage(1) } }

  const handleDelete = useCallback(async () => {
    if (!deleteUser) return
    setDeleteLoad(true)
    try {
      await fetch('/api/admin/block-user', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? ''}`,
        },
        body: JSON.stringify({ email: deleteUser.email, name: deleteUser.name }),
      })
      setUsers(prev => prev.map(u =>
        u.email === deleteUser.email ? { ...u, blocked: true } : u
      ))
    } finally {
      setDeleteLoad(false)
      setDeleteUser(null)
    }
  }, [deleteUser])

  const Select = ({ value, onChange, placeholder, opts }: {
    value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    placeholder: string; opts: string[]
  }) => (
    <select
      value={value}
      onChange={onChange}
      className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400/50 bg-white text-gray-700 min-w-[140px]"
    >
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <>
      {deleteUser && (
        <DeleteConfirm
          user={deleteUser}
          onConfirm={handleDelete}
          onCancel={() => setDeleteUser(null)}
          loading={deleteLoad}
        />
      )}

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 space-y-3">
          {/* Row 1: search + status tabs */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search name, email, title…"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lemon-400/50"
              />
            </div>

            {/* Status filter */}
            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg">
              {STATUS_OPTS.map(s => (
                <button
                  key={s}
                  onClick={() => { setStatusF(s); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                    statusF === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <span className="text-xs text-gray-400 ml-auto shrink-0">
              {filtered.length} of {users.length}
            </span>
          </div>

          {/* Row 2: dropdown filters + page size */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={titleF}  onChange={onFilter(setTitleF)}  placeholder="All Job Titles"   opts={titles} />
            <Select value={deptF}   onChange={onFilter(setDeptF)}   placeholder="All Departments"  opts={depts}  />
            <Select value={roleF}   onChange={onFilter(setRoleF)}   placeholder="All Portal Roles" opts={roles}  />

            {hasFilters && (
              <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2">
                Clear filters
              </button>
            )}

            {/* Page size — pushed right */}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-400 shrink-0">Show</span>
              <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg">
                {PAGE_OPTIONS.map(n => (
                  <button
                    key={n}
                    onClick={() => { setPageSize(n); setPage(1) }}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      pageSize === n ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {n === 0 ? 'All' : n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Table — desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {['Name', 'Job Title', 'Department', 'Portal Role', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged.map(u => {
                const role = inferPortalRole(u.title)
                return (
                  <tr key={u.email} className={`hover:bg-gray-50/50 transition-colors ${u.blocked ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{u.name ?? '—'}</p>
                          <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap">{u.title ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap">{u.department ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-5 py-3.5">
                      {role
                        ? <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${role.color}`}>{role.label}</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-5 py-3.5">
                      {u.blocked ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Blocked
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                          {u.enabled ? 'Active' : 'Disabled'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {!u.blocked && (
                        <button
                          onClick={() => setDeleteUser(u)}
                          className="text-gray-300 hover:text-red-400 transition-colors"
                          title="Remove portal access"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
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
              <div key={u.email} className={`flex items-start gap-3 p-4 ${u.blocked ? 'opacity-50' : ''}`}>
                <Avatar name={u.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{u.name ?? '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
                    </div>
                    {!u.blocked && (
                      <button onClick={() => setDeleteUser(u)} className="text-gray-300 hover:text-red-400 shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {u.title && <span className="text-xs text-gray-500">{u.title}</span>}
                    {role && <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${role.color}`}>{role.label}</span>}
                    {u.blocked
                      ? <span className="text-xs font-medium text-red-500">Blocked</span>
                      : <span className={`text-xs font-medium ${u.enabled ? 'text-green-600' : 'text-gray-400'}`}>{u.enabled ? 'Active' : 'Disabled'}</span>
                    }
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {pageSize > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40">
            <p className="text-xs text-gray-400">
              Page {page} of {totalPages} · {filtered.length} results
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors">
                ← Prev
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors">
                Next →
              </button>
            </div>
          </div>
        )}

        {paged.length === 0 && (
          <div className="text-center py-12 text-sm text-gray-400">No users match your filters.</div>
        )}
      </div>
    </>
  )
}
