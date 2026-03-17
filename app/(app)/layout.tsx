import { redirect }          from 'next/navigation'
import { getTeamSession }    from '@/lib/session'
import { Sidebar }           from '@/components/shell/Sidebar'
import { Header }            from '@/components/shell/Header'
import { CommandPalette }    from '@/components/CommandPalette'
import { MobileNav }         from '@/components/shell/MobileNav'

/**
 * App shell layout — wraps all authenticated pages.
 * Redirects to /login if no session.
 * Desktop: fixed sidebar + header + scrollable content.
 * Mobile: header + scrollable content + fixed bottom nav.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getTeamSession()
  if (!session) redirect('/login')

  return (
    <div className="h-[100dvh] flex overflow-hidden bg-white">

      {/* Sidebar — desktop only */}
      <div className="hidden md:block">
        <Sidebar
          role={session.role}
          displayName={session.displayName}
          email={session.email}
        />
      </div>

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header
          role={session.role}
          displayName={session.displayName}
        />
        {/* Extra bottom padding on mobile so content isn't hidden behind bottom nav */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      <CommandPalette role={session.role} />

      {/* Mobile bottom nav */}
      <MobileNav role={session.role} />
    </div>
  )
}
