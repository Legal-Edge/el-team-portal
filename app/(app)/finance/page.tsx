import { redirect }        from 'next/navigation'
import { getTeamSession }  from '@/lib/session'
import { createClient }    from '@supabase/supabase-js'
import { FinanceClient }   from './FinanceClient'
import type { Metadata }   from 'next'

export const metadata: Metadata = { title: 'Finance' }

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

export default async function FinancePage() {
  const session = await getTeamSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/cases')

  const db = getFinanceDb()

  // Load entities + sync state
  const { data: entities } = await db
    .from('qb_entities')
    .select('id, entity_name, entity_slug, connected, qb_sync_state(status, last_synced_at, records_synced)')
    .order('entity_name')

  // Load all synced expense transaction lines (up to 10k rows)
  const { data: lines } = await db
    .from('qb_transaction_lines')
    .select(`
      id, entity_name, expense_group, account_name, fully_qualified_name,
      account_type, amount, transaction_date, description,
      qb_transactions!inner (vendor_name, doc_number, transaction_type)
    `)
    .eq('account_type', 'Expense')
    .order('transaction_date', { ascending: false })
    .limit(10000)

  return (
    <FinanceClient
      entities={entities ?? []}
      initialLines={lines ?? []}
    />
  )
}
