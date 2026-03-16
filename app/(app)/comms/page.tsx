import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import CommsInboxClient from './CommsInboxClient'

export const metadata = { title: 'Comms Inbox' }

export default async function CommsInboxPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const serviceDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Initial data fetch — sorted by urgency then response deadline
  const { data: rows } = await serviceDb
    .schema('core')
    .from('comms_inbox')
    .select('*')
    .order('sla_sort',        { ascending: true })
    .order('response_due_at', { ascending: true,  nullsFirst: false })
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .limit(50)

  // Attorneys for filter dropdown
  const { data: attorneys } = await serviceDb
    .schema('staff')
    .from('staff_users')
    .select('id, display_name')
    .eq('is_deleted', false)
    .eq('status', 'active')
    .in('primary_role_id',
      // Get attorney + admin + manager role IDs
      (await serviceDb
        .schema('staff')
        .from('staff_roles')
        .select('id')
        .in('role_name', ['attorney', 'admin', 'manager'])
        .then(r => r.data?.map(x => x.id) ?? [])
      )
    )
    .order('display_name', { ascending: true })

  // Count for total (separate count query)
  const { count: total } = await serviceDb
    .schema('core')
    .from('comms_inbox')
    .select('*', { count: 'exact', head: true })

  return (
    <CommsInboxClient
      initialRows={rows ?? []}
      initialTotal={total ?? 0}
      attorneys={attorneys ?? []}
    />
  )
}
