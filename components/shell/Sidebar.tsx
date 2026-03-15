'use client'

import Link           from 'next/link'
import { usePathname } from 'next/navigation'
import type { TeamRole } from '@/lib/session'

interface NavItem {
  label: string
  href:  string
  icon:  string
}

const NAV_ITEMS: Record<TeamRole, NavItem[]> = {
  admin: [
    { label: 'Dashboard',     href: '/dashboard',         icon: '▦' },
    { label: 'Cases',         href: '/cases',             icon: '⚖' },
    { label: 'Comms Inbox',   href: '/comms',             icon: '💬' },
    { label: 'Pipeline',      href: '/pipeline',          icon: '📊' },
    { label: 'Doc Queue',     href: '/docs/queue',        icon: '📂' },
    { label: 'Intake Triage', href: '/intake',            icon: '📋' },
    { label: 'Admin',         href: '/admin',             icon: '⚙' },
  ],
  attorney: [
    { label: 'Dashboard',     href: '/dashboard',         icon: '▦' },
    { label: 'My Cases',      href: '/cases?assigned=me', icon: '⚖' },
    { label: 'All Cases',     href: '/cases',             icon: '🗂' },
    { label: 'Comms Inbox',   href: '/comms',             icon: '💬' },
    { label: 'Documents',     href: '/docs',              icon: '📂' },
  ],
  manager: [
    { label: 'Dashboard',     href: '/dashboard',         icon: '▦' },
    { label: 'Cases',         href: '/cases',             icon: '⚖' },
    { label: 'Comms Inbox',   href: '/comms',             icon: '💬' },
    { label: 'Doc Queue',     href: '/docs/queue',        icon: '📂' },
    { label: 'Intake Triage', href: '/intake',            icon: '📋' },
  ],
  staff: [
    { label: 'Dashboard',     href: '/dashboard',         icon: '▦' },
    { label: 'Cases',         href: '/cases',             icon: '⚖' },
    { label: 'Documents',     href: '/docs',              icon: '📂' },
  ],
}

const ROLE_COLORS: Record<TeamRole, string> = {
  admin:    'bg-red-50 text-red-600',
  attorney: 'bg-purple-50 text-purple-600',
  manager:  'bg-blue-50 text-blue-600',
  staff:    'bg-gray-100 text-gray-500',
}

interface SidebarProps {
  role:        TeamRole
  displayName: string
  email:       string
}

export function Sidebar({ role, displayName, email }: SidebarProps) {
  const pathname = usePathname()
  const navItems = NAV_ITEMS[role] ?? NAV_ITEMS.staff

  function isActive(href: string) {
    const path = href.split('?')[0]
    if (path === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(path)
  }

  return (
    <aside className="w-60 shrink-0 h-screen flex flex-col bg-white border-r border-gray-100 select-none">

      {/* Spacer — aligns with 64px header */}
      <div className="h-16 shrink-0" />

      {/* Role pill */}
      <div className="px-4 pb-3 pt-1">
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${ROLE_COLORS[role]}`}>
          {role}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 overflow-y-auto space-y-0.5">
        {navItems.map(item => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-100 group ${
                active
                  ? 'text-gray-900 bg-gray-50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {/* Yellow left-border indicator — same as referral portal's underline */}
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-lemon-400 rounded-full" />
              )}
              <span className={`text-base w-5 text-center ${active ? 'text-gray-700' : 'text-gray-400 group-hover:text-gray-600'}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom user */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-lemon-400 flex items-center justify-center text-xs font-bold text-gray-900 shrink-0">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
            <p className="text-xs text-gray-400 truncate">{email}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
