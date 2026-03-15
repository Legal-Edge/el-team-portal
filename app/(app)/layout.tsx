import { redirect }          from 'next/navigation'
import { getTeamSession }    from '@/lib/session'
import { Sidebar }           from '@/components/shell/Sidebar'
import { Header }            from '@/components/shell/Header'
import { CommandPalette }    from '@/components/CommandPalette'

/**
 * App shell layout — wraps all authenticated pages.
 * Redirects to /login if no session.
 * Renders: fixed header + fixed sidebar + scrollable content area.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getTeamSession()
  if (!session) redirect('/login')

  return (
    <div className="h-screen flex overflow-hidden bg-white">

      {/* Fixed 240px sidebar */}
      <Sidebar
        role={session.role}
        displayName={session.displayName}
        email={session.email}
      />

      {/* Right column: header + content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Fixed 64px header */}
        <Header
          role={session.role}
          displayName={session.displayName}
        />

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Command palette — client, floats above everything */}
      <CommandPalette role={session.role} />
    </div>
  )
}
