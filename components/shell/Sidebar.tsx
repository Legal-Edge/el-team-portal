'use client'

import Link      from 'next/link'
import { usePathname } from 'next/navigation'
import type { TeamRole } from '@/lib/session'

// ─── Nav item definitions per role ────────────────────────────────────────

interface NavItem {
  label: string
  href:  string
  icon:  string
}

const NAV_ITEMS: Record<TeamRole, NavItem[]> = {
  admin: [
    { label: 'Dashboard',      href: '/dashboard',          icon: '▦' },
    { label: 'Cases',          href: '/cases',              icon: '⚖' },
    { label: 'Comms Inbox',    href: '/comms',              icon: '💬' },
    { label: 'Pipeline',       href: '/pipeline',           icon: '📊' },
    { label: 'Doc Queue',      href: '/docs/queue',         icon: '📂' },
    { label: 'Intake Triage',  href: '/intake',             icon: '📋' },
    { label: 'Admin',          href: '/admin',              icon: '⚙' },
  ],
  attorney: [
    { label: 'Dashboard',      href: '/dashboard',          icon: '▦' },
    { label: 'My Cases',       href: '/cases?assigned=me',  icon: '⚖' },
    { label: 'All Cases',      href: '/cases',              icon: '🗂' },
    { label: 'Comms Inbox',    href: '/comms',              icon: '💬' },
    { label: 'Documents',      href: '/docs',               icon: '📂' },
  ],
  manager: [
    { label: 'Dashboard',      href: '/dashboard',          icon: '▦' },
    { label: 'Cases',          href: '/cases',              icon: '⚖' },
    { label: 'Comms Inbox',    href: '/comms',              icon: '💬' },
    { label: 'Doc Queue',      href: '/docs/queue',         icon: '📂' },
    { label: 'Intake Triage',  href: '/intake',             icon: '📋' },
  ],
  staff: [
    { label: 'Dashboard',      href: '/dashboard',          icon: '▦' },
    { label: 'Cases',          href: '/cases',              icon: '⚖' },
    { label: 'Documents',      href: '/docs',               icon: '📂' },
  ],
}

const ROLE_COLORS: Record<TeamRole, string> = {
  admin:    'bg-red-100 text-red-700',
  attorney: 'bg-purple-100 text-purple-700',
  manager:  'bg-blue-100 text-blue-700',
  staff:    'bg-gray-100 text-gray-600',
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  role:        TeamRole
  displayName: string
  email:       string
}

// ─── Component ─────────────────────────────────────────────────────────────

export function Sidebar({ role, displayName, email }: SidebarProps) {
  const pathname  = usePathname()
  const navItems  = NAV_ITEMS[role] ?? NAV_ITEMS.staff

  function isActive(href: string) {
    const path = href.split('?')[0]
    if (path === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(path)
  }

  return (
    <aside className="w-60 shrink-0 h-screen flex flex-col bg-white border-r border-gray-100 select-none">

      {/* Top spacer — aligns with 64px global header */}
      <div className="h-16 shrink-0" />

      {/* Role label */}
      <div className="px-4 pb-3 pt-1">
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${ROLE_COLORS[role]}`}>
          {role}
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 overflow-y-auto space-y-0.5">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-100 group ${
              isActive(item.href)
                ? 'bg-primary-50 text-primary-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <span className={`text-base leading-none w-5 text-center ${
              isActive(item.href) ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-600'
            }`}>
              {item.icon}
            </span>
            {item.label}
            {/* Active indicator — left border via a pseudo-bar */}
            {isActive(item.href) && (
              <span className="ml-auto w-1 h-4 bg-primary-500 rounded-full" />
            )}
          </Link>
        ))}
      </nav>

      {/* Bottom — user info */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center gap-3">
          {/* Avatar circle */}
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0">
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
