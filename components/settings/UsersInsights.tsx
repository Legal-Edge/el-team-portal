'use client'

import { useMemo, useState } from 'react'
import type { AzureUser }    from './UsersTable'
import { inferPortalRole, Avatar } from './UsersTable'

// ── Segment user popup ────────────────────────────────────────────────────────

function SegmentModal({ label, users, onClose }: {
  label: string; users: AzureUser[]; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">{label}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{users.length} user{users.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* User list */}
        <div className="overflow-y-auto divide-y divide-gray-50">
          {users.map(u => {
            const role = inferPortalRole(u.title)
            return (
              <div key={u.email} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={u.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.name ?? '—'}</p>
                  <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
                </div>
                {role && (
                  <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${role.color}`}>
                    {role.label}
                  </span>
                )}
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${u.enabled ? 'bg-green-400' : 'bg-gray-300'}`} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Bar row (clickable) ───────────────────────────────────────────────────────

function BarRow({ label, count, max, color, users, onSelect }: {
  label: string; count: number; max: number; color: string
  users: AzureUser[]; onSelect: (label: string, users: AzureUser[]) => void
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <button
      onClick={() => onSelect(label, users)}
      className="w-full flex items-center gap-3 py-2 rounded-lg hover:bg-gray-50 px-2 -mx-2 transition-colors group text-left"
    >
      <span className="w-52 text-sm text-gray-700 truncate shrink-0 group-hover:text-gray-900">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold text-gray-900 w-8 text-right shrink-0">{count}</span>
    </button>
  )
}

function InsightCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-[10px] text-gray-400">Click a row to see users</span>
      </div>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  Admin:          'bg-red-400',
  Attorney:       'bg-purple-400',
  Paralegal:      'bg-blue-400',
  'Case Manager': 'bg-teal-400',
  Intake:         'bg-orange-400',
  Support:        'bg-sky-400',
  System:         'bg-gray-300',
  Unassigned:     'bg-gray-200',
}

const DEPT_COLORS: Record<string, string> = {
  Legal:       'bg-purple-400',
  Intake:      'bg-orange-400',
  Operations:  'bg-blue-400',
  Finance:     'bg-teal-400',
  Marketing:   'bg-pink-400',
  Technology:  'bg-indigo-400',
  Executive:   'bg-red-400',
}

export function UsersInsights({ users }: { users: AzureUser[] }) {
  const [modal, setModal] = useState<{ label: string; users: AzureUser[] } | null>(null)
  const active = users.filter(u => u.enabled && !u.blocked)

  // By Role
  const byRole = useMemo(() => {
    const map = new Map<string, AzureUser[]>()
    active.forEach(u => {
      const key = inferPortalRole(u.title)?.label ?? 'Unassigned'
      map.set(key, [...(map.get(key) ?? []), u])
    })
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [active])

  // By Department
  const byDept = useMemo(() => {
    const map = new Map<string, AzureUser[]>()
    active.forEach(u => {
      const key = u.department ?? 'Unassigned'
      map.set(key, [...(map.get(key) ?? []), u])
    })
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [active])

  // By Job Title (top 20)
  const byTitle = useMemo(() => {
    const map = new Map<string, AzureUser[]>()
    active.forEach(u => {
      const key = u.title ?? 'No Title'
      map.set(key, [...(map.get(key) ?? []), u])
    })
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 20)
  }, [active])

  const maxRole  = Math.max(...byRole.map(([,u]) => u.length),  1)
  const maxDept  = Math.max(...byDept.map(([,u]) => u.length),  1)
  const maxTitle = Math.max(...byTitle.map(([,u]) => u.length), 1)

  const select = (label: string, users: AzureUser[]) => setModal({ label, users })

  return (
    <>
      {modal && (
        <SegmentModal label={modal.label} users={modal.users} onClose={() => setModal(null)} />
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Active Users',  value: active.length },
          { label: 'Departments',   value: byDept.filter(([d]) => d !== 'Unassigned').length },
          { label: 'Unique Titles', value: byTitle.length },
          { label: 'Portal Roles',  value: byRole.filter(([r]) => r !== 'Unassigned').length },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <InsightCard title="Users by Portal Role">
          {byRole.map(([label, us]) => (
            <BarRow key={label} label={label} count={us.length} max={maxRole}
              color={ROLE_COLORS[label] ?? 'bg-lemon-400'} users={us} onSelect={select} />
          ))}
        </InsightCard>

        <InsightCard title="Users by Department">
          {byDept.map(([dept, us]) => (
            <BarRow key={dept} label={dept} count={us.length} max={maxDept}
              color={DEPT_COLORS[dept] ?? 'bg-lemon-400'} users={us} onSelect={select} />
          ))}
        </InsightCard>
      </div>

      {/* Full-width job title */}
      <InsightCard title="Users by Job Title (top 20)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {byTitle.map(([title, us]) => (
            <BarRow key={title} label={title} count={us.length} max={maxTitle}
              color="bg-lemon-400" users={us} onSelect={select} />
          ))}
        </div>
      </InsightCard>
    </>
  )
}
