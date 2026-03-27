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

  // Paginate through all expense lines (PostgREST caps at 1000/request)
  const allLines: any[] = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await db
      .from('qb_transaction_lines')
      .select(`
        id, entity_name, expense_group, account_name, fully_qualified_name,
        account_type, amount, transaction_date, description,
        qb_transactions!inner (vendor_name, doc_number, transaction_type)
      `)
      // Include all P&L-relevant lines — exclude only pure balance sheet items (assets, liabilities, equity)
      .in('account_type', ['Expense', 'Other Expense', 'Cost of Goods Sold', 'Credit Card', 'Bank', 'Other Income'])
      .gt('amount', 0)
      .order('transaction_date', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error || !data || data.length === 0) break
    allLines.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }

  const lines = allLines

  return (
    <FinanceClient
      entities={entities ?? []}
      initialLines={lines ?? []}
    />
  )
}
