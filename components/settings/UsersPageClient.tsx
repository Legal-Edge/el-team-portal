'use client'

import { useState } from 'react'
import { UsersTable }    from './UsersTable'
import { UsersInsights } from './UsersInsights'
import type { AzureUser, StaffRole, StaffUserRecord } from './UsersTable'

type Tab = 'users' | 'insights'

interface Props {
  users:        AzureUser[]
  error:        string | null
  roles:        StaffRole[]
  staffUsers:   StaffUserRecord[]
  canEditRoles: boolean
}

export function UsersPageClient({ users, error, roles, staffUsers, canEditRoles }: Props) {
  const [tab, setTab] = useState<Tab>('users')

  const active = users.filter(u => u.enabled && !u.blocked).length

  if (error) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-red-600 text-sm">{error}</div>
    )
  }

  return (
    <>
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-2 gap-4 mb-6 w-fit">
        {[
          { label: 'Total Users', value: users.length },
          { label: 'Active',      value: active },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4 min-w-[140px]">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs mt-0.5 text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {(['users', 'insights'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-lg capitalize transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'users' ? `Users (${users.length})` : 'Insights'}
          </button>
        ))}
      </div>

      {tab === 'users'    && <UsersTable    users={users} roles={roles} staffUsers={staffUsers} canEditRoles={canEditRoles} />}
      {tab === 'insights' && <UsersInsights users={users} staffUsers={staffUsers} />}
    </>
  )
}
