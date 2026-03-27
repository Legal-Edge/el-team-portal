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

  // Split into 6-month chunks to avoid Vercel timeout (60s limit)
  function getDateChunks(start: string, end: string, monthsPerChunk = 6): Array<{ start: string; end: string }> {
    const chunks = []
    let current = new Date(start)
    const endDt  = new Date(end)
    while (current < endDt) {
      const chunkEnd = new Date(current)
      chunkEnd.setMonth(chunkEnd.getMonth() + monthsPerChunk)
      chunks.push({
        start: current.toISOString().split('T')[0],
        end:   (chunkEnd > endDt ? endDt : new Date(chunkEnd.getTime() - 86400000)).toISOString().split('T')[0],
      })
      current = chunkEnd
    }
    return chunks
  }

  const chunks = getDateChunks(startDate, endDate)
  const results = []

  for (const entity of entities) {
    let totalTxns = 0
    let totalLines = 0
    let success = true
    let errorMsg = ''

    for (const chunk of chunks) {
      try {
        const result = await syncEntity(entity.id, chunk.start, chunk.end)
        totalTxns  += result.transactionsSynced
        totalLines += result.lineItemsSynced
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Log but continue with other chunks
        console.error(`Sync chunk ${chunk.start}→${chunk.end} failed for ${entity.entity_name}:`, msg)
        errorMsg = msg
        success = false
      }
    }

    results.push({
      entityId:           entity.id,
      entityName:         entity.entity_name,
      success,
      transactionsSynced: totalTxns,
      lineItemsSynced:    totalLines,
      error:              errorMsg || undefined,
    })
  }

  return NextResponse.json({
    success:   results.every(r => r.success),
    startDate,
    endDate,
    results,
  })
}
