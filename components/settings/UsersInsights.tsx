'use client'

import { useMemo } from 'react'
import type { AzureUser } from './UsersTable'
import { inferPortalRole } from './UsersTable'

function BarRow({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-52 text-sm text-gray-700 truncate shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold text-gray-900 w-8 text-right shrink-0">{count}</span>
    </div>
  )
}

function InsightCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  )
}

export function UsersInsights({ users }: { users: AzureUser[] }) {
  const active = users.filter(u => u.enabled && !u.blocked)

  // By Department
  const byDept = useMemo(() => {
    const counts: Record<string, number> = {}
    active.forEach(u => {
      const d = u.department ?? 'Unassigned'
      counts[d] = (counts[d] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [active])

  // By Job Title (top 20)
  const byTitle = useMemo(() => {
    const counts: Record<string, number> = {}
    active.forEach(u => {
      const t = u.title ?? 'No Title'
      counts[t] = (counts[t] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20)
  }, [active])

  // By Portal Role
  const byRole = useMemo(() => {
    const counts: Record<string, number> = {}
    active.forEach(u => {
      const r = inferPortalRole(u.title)
      const label = r?.label ?? 'Unassigned'
      counts[label] = (counts[label] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [active])

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

  const maxDept  = Math.max(...byDept.map(([,c]) => c),  1)
  const maxTitle = Math.max(...byTitle.map(([,c]) => c), 1)
  const maxRole  = Math.max(...byRole.map(([,c]) => c),  1)

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Active Users',    value: active.length },
          { label: 'Departments',     value: byDept.filter(([d]) => d !== 'Unassigned').length },
          { label: 'Unique Titles',   value: byTitle.length },
          { label: 'Portal Roles',    value: byRole.filter(([r]) => r !== 'Unassigned').length },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <InsightCard title="Users by Portal Role">
          {byRole.map(([label, count]) => (
            <BarRow key={label} label={label} count={count} max={maxRole}
              color={ROLE_COLORS[label] ?? 'bg-lemon-400'} />
          ))}
        </InsightCard>

        <InsightCard title="Users by Department">
          {byDept.map(([dept, count]) => (
            <BarRow key={dept} label={dept} count={count} max={maxDept}
              color={DEPT_COLORS[dept] ?? 'bg-lemon-400'} />
          ))}
        </InsightCard>
      </div>

      {/* Full-width job title breakdown */}
      <InsightCard title="Users by Job Title (top 20)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {byTitle.map(([title, count]) => (
            <BarRow key={title} label={title} count={count} max={maxTitle} color="bg-lemon-400" />
          ))}
        </div>
      </InsightCard>
    </div>
  )
}
