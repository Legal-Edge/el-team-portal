'use client'

import Link        from 'next/link'
import { usePathname } from 'next/navigation'
import type { TeamRole } from '@/lib/session'

interface NavItem { label: string; href: string; icon: React.ReactNode }

function IconDashboard() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
}
function IconCases() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" /></svg>
}
function IconComms() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
}
function IconAdmin() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
}

const NAV_BY_ROLE: Record<TeamRole, NavItem[]> = {
  admin: [
    { label: 'Dashboard', href: '/dashboard',          icon: <IconDashboard /> },
    { label: 'Cases',     href: '/cases',              icon: <IconCases /> },
    { label: 'Admin',     href: '/admin/ai-knowledge', icon: <IconAdmin /> },
  ],
  attorney: [
    { label: 'Dashboard', href: '/dashboard',         icon: <IconDashboard /> },
    { label: 'My Cases',  href: '/cases?assigned=me', icon: <IconCases /> },
    { label: 'All Cases', href: '/cases',             icon: <IconCases /> },
  ],
  manager: [
    { label: 'Dashboard', href: '/dashboard', icon: <IconDashboard /> },
    { label: 'Cases',     href: '/cases',     icon: <IconCases /> },
    { label: 'Comms',     href: '/comms',     icon: <IconComms /> },
  ],
  paralegal: [
    { label: 'Dashboard', href: '/dashboard', icon: <IconDashboard /> },
    { label: 'Cases',     href: '/cases',     icon: <IconCases /> },
    { label: 'Comms',     href: '/comms',     icon: <IconComms /> },
  ],
  staff: [
    { label: 'Dashboard', href: '/dashboard', icon: <IconDashboard /> },
    { label: 'Cases',     href: '/cases',     icon: <IconCases /> },
    { label: 'Comms',     href: '/comms',     icon: <IconComms /> },
  ],
}

export function MobileNav({ role }: { role: TeamRole }) {
  const pathname = usePathname()
  const items    = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.staff

  function isActive(href: string) {
    const path = href.split('?')[0]
    if (path === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(path)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex md:hidden safe-bottom">
      {items.map(item => {
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors active:scale-95 ${
              active ? 'text-gray-900' : 'text-gray-400'
            }`}
          >
            <span className={active ? 'text-gray-900' : 'text-gray-400'}>{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
            {active && <span className="absolute bottom-0 w-8 h-0.5 bg-lemon-400 rounded-full" />}
          </Link>
        )
      })}
    </nav>
  )
}
