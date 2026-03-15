import { createClient }   from '@supabase/supabase-js'
import CaptureViewer      from './CaptureViewer'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getCaptures() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data, error } = await supabase
    .schema('infrastructure' as never)
    .from('webhook_captures')
    .select('*')
    .eq('source', 'aloware')
    .order('captured_at', { ascending: false })
    .limit(50)

  if (error) console.error('[webhook-captures]', error.message)
  return data ?? []
}

export default async function WebhookCapturesPage() {
  const captures = await getCaptures()
  return <CaptureViewer initialCaptures={captures} />
}
