import { redirect }               from 'next/navigation'
import { getTeamSession }         from '@/lib/session'
import { Sidebar }                from '@/components/shell/Sidebar'
import { Header }                 from '@/components/shell/Header'
import { CommandPalette }         from '@/components/CommandPalette'
import { MobileNav }              from '@/components/shell/MobileNav'
import { ImpersonationBanner }    from '@/components/shell/ImpersonationBanner'

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
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-white">
      {session.impersonating && (
        <ImpersonationBanner
          name={session.impersonating.name}
          role={session.impersonating.role}
          impersonatorEmail={session.impersonating.impersonatorEmail}
        />
      )}
      <div className="flex flex-1 overflow-hidden">

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
    </div>
  )
}
