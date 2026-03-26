/**
 * POST /api/integrations/quickbooks/disconnect
 * Disconnects a QB entity (clears tokens, sets connected=false).
 * Body: { entityId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'
import { createClient }              from '@supabase/supabase-js'

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

export async function POST(req: NextRequest) {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { entityId } = await req.json()
  if (!entityId) return NextResponse.json({ error: 'entityId required' }, { status: 400 })

  const db = getFinanceDb()
  const { error } = await db.from('qb_entities').update({
    connected:        false,
    access_token:     null,
    refresh_token:    null,
    token_expires_at: null,
    updated_at:       new Date().toISOString(),
  }).eq('id', entityId)

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })

  return NextResponse.json({ success: true })
}
