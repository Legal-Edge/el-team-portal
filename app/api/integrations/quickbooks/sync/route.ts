/**
 * POST /api/integrations/quickbooks/sync
 * Triggers a full sync for one or all connected QB entities.
 *
 * Body: { entityId?: string, startDate?: string, endDate?: string }
 * Defaults: last 2 years of transactions
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'
import { syncEntity }                from '@/lib/quickbooks'
import { createClient }              from '@supabase/supabase-js'

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

export async function POST(req: NextRequest) {
  try {
  // Admin only
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { entityId?: string; startDate?: string; endDate?: string } = {}
  try {
    body = await req.json()
  } catch { /* empty body is fine */ }

  const now      = new Date()
  const endDate  = body.endDate   || now.toISOString().split('T')[0]
  // Default: full history from 2015 (covers all likely QB data)
  const startDate = body.startDate || '2015-01-01'

  const db = getFinanceDb()

  // Get target entities
  let entitiesQuery = db.from('qb_entities').select('id, entity_name').eq('connected', true)
  if (body.entityId) {
    entitiesQuery = entitiesQuery.eq('id', body.entityId) as typeof entitiesQuery
  }

  const { data: entities, error } = await entitiesQuery
  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  if (!entities || entities.length === 0) {
    return NextResponse.json({ error: 'No connected QB entities found' }, { status: 404 })
  }

  const results = []

  for (const entity of entities) {
    try {
      const result = await syncEntity(entity.id, startDate, endDate)
      results.push({
        entityId:   entity.id,
        entityName: entity.entity_name,
        success:    true,
        ...result,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        entityId:   entity.id,
        entityName: entity.entity_name,
        success:    false,
        error:      msg,
      })
    }
  }

  return NextResponse.json({
    success:   results.every(r => r.success),
    startDate,
    endDate,
    results,
  })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('QB sync route unhandled error:', msg)
    return NextResponse.json({ success: false, error: msg, results: [] }, { status: 500 })
  }
}
