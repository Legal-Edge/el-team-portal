/**
 * GET /api/integrations/quickbooks/status
 * Returns connection status for all QB entities + last sync info.
 */

import { NextResponse }  from 'next/server'
import { getTeamSession } from '@/lib/session'
import { createClient }   from '@supabase/supabase-js'

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

export async function GET() {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getFinanceDb()

  const { data: entities, error } = await db
    .from('qb_entities')
    .select(`
      id, entity_name, entity_slug, realm_id,
      connected, connected_at, token_expires_at,
      qb_sync_state (
        status, last_synced_at, records_synced,
        error_message, started_at, completed_at
      )
    `)
    .order('entity_name')

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })

  return NextResponse.json({ entities })
}
