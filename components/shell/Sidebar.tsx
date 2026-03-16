'use client'

import Link             from 'next/link'
import { usePathname }  from 'next/navigation'
import { useState }     from 'react'
import type { TeamRole } from '@/lib/session'

// ── SVG icons ──────────────────────────────────────────────────────────────

function IconDashboard() { return <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg> }
function IconCases()     { return <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" /></svg> }
function IconComms()     { return <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg> }
function IconPipeline()  { return <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> }
function IconDocs()      { return <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg> }
function IconIntake()    { return <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg> }
function IconAdmin()     { return <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg> }

const ICONS: Record<string, React.ReactNode> = {
  dashboard:  <IconDashboard />,
  cases:      <IconCases />,
  'cases-me': <IconCases />,
  comms:      <IconComms />,
  pipeline:   <IconPipeline />,
  docs:       <IconDocs />,
  intake:     <IconIntake />,
  admin:      <IconAdmin />,
}

interface NavItem {
  label: string
  href:  string
  icon:  keyof typeof ICONS
}

const NAV_ITEMS: Record<TeamRole, NavItem[]> = {
  admin: [
    { label: 'Dashboard',  href: '/dashboard',  icon: 'dashboard' },
    { label: 'Cases',      href: '/cases',      icon: 'cases'     },
    { label: 'Comms',      href: '/comms',      icon: 'comms'     },
    { label: 'Documents',  href: '/documents',  icon: 'docs'      },
  ],
  attorney: [
    { label: 'Dashboard',  href: '/dashboard',         icon: 'dashboard' },
    { label: 'My Cases',   href: '/cases?assigned=me', icon: 'cases-me'  },
    { label: 'All Cases',  href: '/cases',             icon: 'cases'     },
    { label: 'Comms',      href: '/comms',             icon: 'comms'     },
    { label: 'Documents',  href: '/documents',         icon: 'docs'      },
  ],
  manager: [
    { label: 'Dashboard',  href: '/dashboard',  icon: 'dashboard' },
    { label: 'Cases',      href: '/cases',      icon: 'cases'     },
    { label: 'Comms',      href: '/comms',      icon: 'comms'     },
    { label: 'Documents',  href: '/documents',  icon: 'docs'      },
  ],
  staff: [
    { label: 'Dashboard',  href: '/dashboard',  icon: 'dashboard' },
    { label: 'Cases',      href: '/cases',      icon: 'cases'     },
    { label: 'Comms',      href: '/comms',      icon: 'comms'     },
    { label: 'Documents',  href: '/documents',  icon: 'docs'      },
  ],
}

const ROLE_COLORS: Record<TeamRole, string> = {
  admin:    'bg-red-50 text-red-600',
  attorney: 'bg-purple-50 text-purple-600',
  manager:  'bg-blue-50 text-blue-600',
  staff:    'bg-gray-100 text-gray-500',
}

const ROLE_LABELS: Record<TeamRole, string> = {
  admin:    'Admin',
  attorney: 'Attorney',
  manager:  'Manager',
  staff:    'Staff',
}

interface SidebarProps {
  role:        TeamRole
  displayName: string
  email:       string
}

export function Sidebar({ role, displayName, email }: SidebarProps) {
  const pathname = usePathname()
  const navItems = NAV_ITEMS[role] ?? NAV_ITEMS.staff
  const [hovered, setHovered] = useState(false)

  function isActive(href: string) {
    const path = href.split('?')[0]
    if (path === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(path)
  }

  // Outer shell: always w-14 in the flex layout — content area never shifts.
  // Inner panel: absolute, expands to w-60 on hover and overlays content.
  return (
    <aside className="w-14 shrink-0 h-screen relative z-30">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`absolute left-0 top-0 h-full flex flex-col bg-white border-r border-gray-100 select-none overflow-hidden transition-all duration-200 ease-in-out ${
          hovered ? 'w-60 shadow-lg shadow-gray-100' : 'w-14'
        }`}
      >
        {/* Spacer — aligns with 64px header */}
        <div className="h-16 shrink-0" />

        {/* Role indicator */}
        <div className="px-3.5 pb-3 pt-1 overflow-hidden">
          {hovered ? (
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${ROLE_COLORS[role]}`}>
              {ROLE_LABELS[role]}
            </span>
          ) : (
            <span className={`w-2 h-2 rounded-full inline-block ${ROLE_COLORS[role].split(' ')[0]}`} />
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden space-y-0.5 px-2">
          {navItems.map(item => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 active:scale-95 group ${
                  active
                    ? 'text-gray-900 bg-gray-50'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {/* Lemon left-bar active indicator */}
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-lemon-400 rounded-full" />
                )}
                <span className={`shrink-0 transition-colors duration-150 ${active ? 'text-gray-700' : 'text-gray-400 group-hover:text-gray-600'}`}>
                  {ICONS[item.icon]}
                </span>
                <span className={`whitespace-nowrap transition-all duration-200 ${hovered ? 'opacity-100' : 'opacity-0 w-0'}`}>
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Bottom user card */}
        <div className="p-3 border-t border-gray-100">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-lemon-400 flex items-center justify-center text-xs font-bold text-gray-900 shrink-0">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className={`min-w-0 transition-all duration-200 ${hovered ? 'opacity-100' : 'opacity-0 w-0'}`}>
              <p className="text-sm font-semibold text-gray-900 truncate whitespace-nowrap">{displayName}</p>
              <p className="text-xs text-gray-400 truncate whitespace-nowrap">{email}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
