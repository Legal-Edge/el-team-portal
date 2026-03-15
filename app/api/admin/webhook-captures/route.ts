import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTeamSession, isAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getTeamSession()
  if (!session)          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

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

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
