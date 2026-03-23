'use client'

import { useState, useMemo, useCallback, useTransition, useRef, useEffect } from 'react'
import { blockUserAction, assignRoleAction } from '@/lib/actions/users'
import { startImpersonationAction }          from '@/lib/actions/impersonation'
import { useRouter }                         from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AzureUser {
  name:       string | null
  email:      string | null
  title:      string | null
  department: string | null
  enabled:    boolean
  blocked:    boolean
}

export interface StaffRole {
  id:          string
  role_name:   string
  role_level:  number
  description: string | null
}

export interface StaffUserRecord {
  id:             string
  email:          string
  primary_role_id: string | null
  staff_roles:    { role_name: string } | null
}

// ── Role display config ───────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin:       'bg-red-50 text-red-600',
  attorney:    'bg-purple-50 text-purple-700',
  manager:     'bg-blue-50 text-blue-700',
  paralegal:   'bg-indigo-50 text-indigo-700',
  staff:       'bg-gray-100 text-gray-600',
}

const ROLE_LABELS: Record<string, string> = {
  admin:       'Admin',
  attorney:    'Attorney',
  manager:     'Manager',
  paralegal:   'Paralegal',
  staff:       'Staff',
}

// Fallback infer from job title when no explicit role assigned
export function inferPortalRole(title: string | null): { label: string; color: string } | null {
  if (!title) return null
  const t = title.toLowerCase()
  if (t === 'bot' || (t.includes('admin') && t.includes('tech')))
    return { label: 'System',    color: 'bg-gray-100 text-gray-500' }
  if (t.includes('attorney') || t.includes('associate') || t.includes('clo'))
    return { label: 'attorney',  color: ROLE_COLORS.attorney }
  if (t.includes('paralegal'))
    return { label: 'paralegal', color: ROLE_COLORS.paralegal }
  if (t.includes('case manager') || t.includes('settlement'))
    return { label: 'manager',   color: ROLE_COLORS.manager }
  if (t.includes('intake') || t.includes('document') || t.includes('demand'))
    return { label: 'staff',     color: ROLE_COLORS.staff }
  if (t.includes('ceo') || t.includes('cfo') || t.includes('cto') || t.includes('director'))
    return { label: 'admin',     color: ROLE_COLORS.admin }
  return null
}

// ── Avatar ────────────────────────────────────────────────────────────────────

export function Avatar({ name, size = 'md' }: { name: string | null; size?: 'sm' | 'md' }) {
  const initials = (name ?? '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
  const palette  = ['bg-lemon-100 text-lemon-800','bg-purple-100 text-purple-800','bg-blue-100 text-blue-800','bg-teal-100 text-teal-800','bg-orange-100 text-orange-800','bg-pink-100 text-pink-800']
  const color    = palette[(name ?? '').charCodeAt(0) % palette.length]
  const sz       = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs'
  return (
    <div className={`rounded-full flex items-center justify-center font-bold shrink-0 ${sz} ${color}`}>
      {initials}
    </div>
  )
}

// ── Inline role selector ──────────────────────────────────────────────────────

function RoleCell({ user, staffUser, roles, onRoleChange }: {
  user:         AzureUser
  staffUser:    StaffUserRecord | undefined
  roles:        StaffRole[]
  onRoleChange: (email: string, roleId: string, roleName: string) => void
}) {
  const [open,    setOpen]    = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [, startT] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const assignedRoleName = staffUser?.staff_roles?.role_name ?? null
  const color            = assignedRoleName ? (ROLE_COLORS[assignedRoleName] ?? 'bg-gray-100 text-gray-500') : 'bg-gray-50 text-gray-400'
  const label            = assignedRoleName ? (ROLE_LABELS[assignedRoleName] ?? assignedRoleName) : 'Assign role…'

  async function handleSelect(role: StaffRole) {
    if (!user.email) return
    setOpen(false)
    setSaving(true)
    setError(null)
    startT(async () => {
      const result = await assignRoleAction(user.email!, role.id)
      setSaving(false)
      if (result.success) {
        onRoleChange(user.email!, role.id, role.role_name)
      } else {
        setError(result.error ?? 'Failed to save')
      }
    })
  }

  if (!staffUser) {
    // User not in staff_users — not provisioned yet
    return (
      <span className="text-xs text-gray-300 italic">Not provisioned</span>
    )
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all
          ${color} ${saving ? 'opacity-50' : 'hover:opacity-80 cursor-pointer'}
          ${!assignedRoleName ? 'border border-dashed border-gray-300' : ''}`}
      >
        {saving ? '…' : label}
        {!saving && (
          <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {error && <p className="absolute top-full left-0 mt-1 text-xs text-red-500 whitespace-nowrap z-10">{error}</p>}

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 bg-white border border-gray-100 rounded-xl shadow-lg py-1 min-w-[160px]">
          {roles.map(role => {
            const isActive = role.role_name === assignedRoleName
            return (
              <button key={role.id} onClick={() => handleSelect(role)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left
                  ${isActive ? 'bg-gray-50' : ''}`}>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[role.role_name] ?? 'bg-gray-100 text-gray-500'}`}>
                  {ROLE_LABELS[role.role_name] ?? role.role_name}
                </span>
                {isActive && (
                  <svg className="w-3.5 h-3.5 text-green-500 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteConfirm({ user, onConfirm, onCancel, loading, error }: {
  user: AzureUser; onConfirm: () => void; onCancel: () => void; loading: boolean; error?: string | null
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm mx-4 w-full">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Remove portal access?</h3>
        <p className="text-sm text-gray-500 mb-1">
          <span className="font-medium text-gray-800">{user.name}</span> ({user.email}) will be removed from the team portal immediately.
        </p>
        <p className="text-xs text-gray-400 mb-3">Their Azure AD account is not affected.</p>
        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors">
            {loading ? 'Removing…' : 'Remove Access'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const PAGE_OPTIONS = [25, 50, 100, 0]
const STATUS_OPTS  = ['all', 'active', 'disabled'] as const
type  StatusFilter = typeof STATUS_OPTS[number]
const BLANK        = '__blank__'

interface Props {
  users:      AzureUser[]
  roles:      StaffRole[]
  staffUsers: StaffUserRecord[]
}

export function UsersTable({ users: initialUsers, roles, staffUsers: initialStaffUsers }: Props) {
  const [users,       setUsers]       = useState<AzureUser[]>(() => initialUsers.filter(u => !u.blocked))
  const [staffUsers,  setStaffUsers]  = useState<StaffUserRecord[]>(initialStaffUsers)
  const [search,      setSearch]      = useState('')
  const [statusF,     setStatusF]     = useState<StatusFilter>('all')
  const [titleF,      setTitleF]      = useState('')
  const [deptF,       setDeptF]       = useState('')
  const [roleF,       setRoleF]       = useState('')
  const [pageSize,    setPageSize]    = useState(25)
  const [page,        setPage]        = useState(1)
  const [deleteUser,  setDeleteUser]  = useState<AzureUser | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const [isPending,   startTransition] = useTransition()
  const router = useRouter()

  // Unique filter options
  const titles = useMemo(() => {
    const vals = Array.from(new Set(users.map(u => u.title))).sort((a, b) =>
      a === null ? 1 : b === null ? -1 : a.localeCompare(b))
    return vals.map(v => ({ value: v ?? BLANK, label: v ?? '(No Title)' }))
  }, [users])

  const depts = useMemo(() => {
    const vals = Array.from(new Set(users.map(u => u.department))).sort((a, b) =>
      a === null ? 1 : b === null ? -1 : a.localeCompare(b))
    return vals.map(v => ({ value: v ?? BLANK, label: v ?? '(No Department)' }))
  }, [users])

  const roleOpts = useMemo(() => {
    const set = new Set<string>()
    users.forEach(u => {
      const su = staffUsers.find(s => s.email?.toLowerCase() === u.email?.toLowerCase())
      set.add(su?.staff_roles?.role_name ?? BLANK)
    })
    return Array.from(set).sort().map(v => ({
      value: v,
      label: v === BLANK ? '(No Role)' : (ROLE_LABELS[v] ?? v),
    }))
  }, [users, staffUsers])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return users.filter(u => {
      if (q && !(u.name ?? '').toLowerCase().includes(q) && !(u.email ?? '').toLowerCase().includes(q) && !(u.title ?? '').toLowerCase().includes(q)) return false
      if (titleF && (titleF === BLANK ? u.title !== null : u.title !== titleF)) return false
      if (deptF  && (deptF  === BLANK ? u.department !== null : u.department !== deptF)) return false
      if (roleF) {
        const su    = staffUsers.find(s => s.email?.toLowerCase() === u.email?.toLowerCase())
        const rName = su?.staff_roles?.role_name ?? null
        if (roleF === BLANK ? rName !== null : rName !== roleF) return false
      }
      if (statusF === 'active')   return u.enabled
      if (statusF === 'disabled') return !u.enabled
      return true
    })
  }, [users, staffUsers, search, titleF, deptF, roleF, statusF])

  const totalPages = pageSize === 0 ? 1 : Math.ceil(filtered.length / pageSize)
  const paged      = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)
  const hasFilters = !!(search || titleF || deptF || roleF || statusF !== 'all')

  function reset() { setSearch(''); setTitleF(''); setDeptF(''); setRoleF(''); setStatusF('all'); setPage(1) }

  const handleDelete = useCallback(() => {
    if (!deleteUser?.email) return
    const target = deleteUser
    setDeleteError(null)
    startTransition(async () => {
      const result = await blockUserAction(target.email!, target.name)
      if (!result.success) { setDeleteError(result.error ?? 'Something went wrong'); return }
      setUsers(prev => prev.filter(u => u.email !== target.email))
      setDeleteUser(null)
    })
  }, [deleteUser])

  const handleImpersonate = useCallback((email: string) => {
    setImpersonating(email)
    startTransition(async () => {
      const result = await startImpersonationAction(email)
      setImpersonating(null)
      if (result.success) {
        router.push('/dashboard')
        router.refresh()
      } else {
        alert(result.error ?? 'Failed to start impersonation')
      }
    })
  }, [router])

  const handleRoleChange = useCallback((email: string, roleId: string, roleName: string) => {
    setStaffUsers(prev => prev.map(su =>
      su.email?.toLowerCase() === email.toLowerCase()
        ? { ...su, primary_role_id: roleId, staff_roles: { role_name: roleName } }
        : su
    ))
  }, [])

  const Sel = ({ value, onChange, placeholder, opts }: {
    value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    placeholder: string; opts: { value: string; label: string }[]
  }) => (
    <select value={value} onChange={onChange}
      className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400/50 bg-white text-gray-700 min-w-[150px]">
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )

  return (
    <>
      {deleteUser && (
        <DeleteConfirm user={deleteUser} onConfirm={handleDelete}
          onCancel={() => { setDeleteUser(null); setDeleteError(null) }}
          loading={isPending} error={deleteError} />
      )}

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Search name, email, title…" value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lemon-400/50" />
            </div>
            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg">
              {STATUS_OPTS.map(s => (
                <button key={s} onClick={() => { setStatusF(s); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${statusF === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {s}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400 ml-auto shrink-0">{filtered.length} of {users.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Sel value={titleF} onChange={e => { setTitleF(e.target.value); setPage(1) }} placeholder="All Job Titles"   opts={titles}   />
            <Sel value={deptF}  onChange={e => { setDeptF(e.target.value);  setPage(1) }} placeholder="All Departments"  opts={depts}    />
            <Sel value={roleF}  onChange={e => { setRoleF(e.target.value);  setPage(1) }} placeholder="All Portal Roles" opts={roleOpts} />
            {hasFilters && (
              <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2">Clear filters</button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-400 shrink-0">Show</span>
              <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg">
                {PAGE_OPTIONS.map(n => (
                  <button key={n} onClick={() => { setPageSize(n); setPage(1) }}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${pageSize === n ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
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
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged.map(u => {
                const su = staffUsers.find(s => s.email?.toLowerCase() === u.email?.toLowerCase())
                return (
                  <tr key={u.email} className="hover:bg-gray-50/50 transition-colors">
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
                      <RoleCell user={u} staffUser={su} roles={roles} onRoleChange={handleRoleChange} />
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {u.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        {su && su.staff_roles?.role_name !== 'admin' && (
                          <button
                            onClick={() => handleImpersonate(u.email!)}
                            disabled={impersonating === u.email}
                            className="text-xs text-gray-400 hover:text-blue-500 font-medium transition-colors disabled:opacity-40"
                            title="View portal as this user"
                          >
                            {impersonating === u.email ? '…' : 'View as'}
                          </button>
                        )}
                        <button onClick={() => setDeleteUser(u)} className="text-gray-300 hover:text-red-400 transition-colors" title="Remove portal access">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-gray-50">
          {paged.map(u => {
            const su = staffUsers.find(s => s.email?.toLowerCase() === u.email?.toLowerCase())
            return (
              <div key={u.email} className="flex items-start gap-3 p-4">
                <Avatar name={u.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{u.name ?? '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
                    </div>
                    <button onClick={() => setDeleteUser(u)} className="text-gray-300 hover:text-red-400 shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {u.title && <span className="text-xs text-gray-500">{u.title}</span>}
                    <RoleCell user={u} staffUser={su} roles={roles} onRoleChange={handleRoleChange} />
                    <span className={`text-xs font-medium ${u.enabled ? 'text-green-600' : 'text-gray-400'}`}>{u.enabled ? 'Active' : 'Disabled'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {pageSize > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40">
            <p className="text-xs text-gray-400">Page {page} of {totalPages} · {filtered.length} results</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors">Next →</button>
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
