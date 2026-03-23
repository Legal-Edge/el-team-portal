'use client'

import { useState } from 'react'
import { UsersTable } from './UsersTable'
import { UsersInsights } from './UsersInsights'
import type { AzureUser } from './UsersTable'

type Tab = 'users' | 'insights'

export function UsersPageClient({ users, error }: { users: AzureUser[]; error: string | null }) {
  const [tab, setTab] = useState<Tab>('users')

  const active   = users.filter(u => u.enabled && !u.blocked).length
  const disabled = users.filter(u => !u.enabled).length
  const blocked  = users.filter(u => u.blocked).length
  const noTitle  = users.filter(u => !u.title).length

  if (error) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-red-600 text-sm">
        {error}
      </div>
    )
  }

  return (
    <>
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total Users',      value: users.length,  accent: false },
          { label: 'Active',           value: active,        accent: false },
          { label: 'Disabled',         value: disabled,      accent: disabled > 0 },
          { label: 'Portal Blocked',   value: blocked,       accent: blocked > 0 },
          { label: 'No Title',         value: noTitle,       accent: noTitle > 0 },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className={`text-xs mt-0.5 ${s.accent && s.value > 0 ? 'text-amber-500 font-medium' : 'text-gray-500'}`}>
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {(['users', 'insights'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-lg capitalize transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'users' ? `Users (${users.length})` : 'Insights'}
          </button>
        ))}
      </div>

      {tab === 'users'    ? <UsersTable    users={users} /> : null}
      {tab === 'insights' ? <UsersInsights users={users} /> : null}
    </>
  )
}
