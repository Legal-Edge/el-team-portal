import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import DocumentQueueClient from './DocumentQueueClient'

export const metadata = { title: 'Document Queue' }

export default async function DocumentQueuePage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const serviceDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Initial data: sorted by needs-action first
  const { data: rows } = await serviceDb
    .schema('core')
    .from('documents_queue')
    .select('*')
    .order('review_sort',  { ascending: true })
    .order('created_at',   { ascending: false, nullsFirst: false })
    .limit(50)

  // Total count
  const { count: total } = await serviceDb
    .schema('core')
    .from('documents_queue')
    .select('*', { count: 'exact', head: true })

  // Attorneys for filter dropdown
  const { data: attorneys } = await serviceDb
    .schema('staff')
    .from('staff_users')
    .select('id, display_name')
    .eq('is_deleted', false)
    .eq('status', 'active')
    .in('primary_role_id',
      (await serviceDb
        .schema('staff')
        .from('staff_roles')
        .select('id')
        .in('role_name', ['attorney', 'admin', 'manager'])
        .then(r => r.data?.map(x => x.id) ?? [])
      )
    )
    .order('display_name', { ascending: true })

  // Distinct document types present in the queue for the filter dropdown
  const { data: docTypeRows } = await serviceDb
    .schema('core')
    .from('document_files')
    .select('document_type_code')
    .eq('is_deleted', false)
    .not('document_type_code', 'is', null)

  const docTypes = [...new Set(
    (docTypeRows ?? []).map(r => r.document_type_code).filter(Boolean)
  )].sort() as string[]

  return (
    <DocumentQueueClient
      initialRows={rows ?? []}
      initialTotal={total ?? 0}
      attorneys={attorneys ?? []}
      docTypes={docTypes}
    />
  )
}
