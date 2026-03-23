'use client'

import Link            from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  {
    section: 'Account Management',
    items: [
      { label: 'Users & Teams', href: '/settings/users' },
    ],
  },
]

export function SettingsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 h-full border-r border-gray-100 bg-white">
      {/* Header */}
      <div className="px-5 py-5 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Settings</h2>
      </div>

      {/* Nav */}
      <nav className="py-4 px-3 space-y-5">
        {NAV.map(group => (
          <div key={group.section}>
            <p className="px-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {group.section}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
