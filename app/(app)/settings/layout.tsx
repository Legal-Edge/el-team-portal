import { redirect }       from 'next/navigation'
import { getTeamSession } from '@/lib/session'
import { SettingsSidebar } from '@/components/settings/SettingsSidebar'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getTeamSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/dashboard')

  return (
    <div className="flex h-full">
      <SettingsSidebar />
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
