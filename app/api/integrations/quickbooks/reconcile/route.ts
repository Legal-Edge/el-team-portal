/**
 * POST /api/integrations/quickbooks/reconcile
 * Reconciles a date range by fetching all transaction IDs from QB
 * and deleting any DB records that no longer exist in QB.
 * Body: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { getTeamSession }            from '@/lib/session'
import { getTokensForEntity }        from '@/lib/quickbooks'

const QB_BASE_URL  = 'https://quickbooks.api.intuit.com/v3/company'
const QB_MINOR_VER = '65'

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

async function fetchQBIds(
  accessToken: string,
  realmId: string,
  type: string,
  startDate: string,
  endDate: string
): Promise<Set<string>> {
  const ids = new Set<string>()
  let pos = 1

  while (true) {
    const sql = `SELECT Id FROM ${type} WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${pos} MAXRESULTS 1000`
    const url = `${QB_BASE_URL}/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=${QB_MINOR_VER}`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) break
    const data = await res.json()
    const items: any[] = data?.QueryResponse?.[type] || []
    items.forEach((t: any) => ids.add(t.Id))
    if (items.length < 1000) break
    pos += 1000
  }

  return ids
}

export async function POST(req: NextRequest) {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { startDate, endDate } = await req.json()
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 })
  }

  const db = getFinanceDb()
  const { data: entities } = await db
    .from('qb_entities')
    .select('id, entity_name, entity_slug, realm_id')
    .eq('connected', true)

  if (!entities?.length) {
    return NextResponse.json({ error: 'No connected entities' }, { status: 400 })
  }

  const results: Record<string, any> = {}

  for (const entity of entities) {
    let accessToken: string
    try {
      const tokens = await getTokensForEntity(entity.id)
      accessToken = tokens.accessToken
    } catch (err) {
      results[entity.entity_name] = { error: 'Failed to get tokens' }
      continue
    }

    // Fetch all QB IDs for this period
    const qbIds = new Set<string>()
    for (const type of ['Purchase', 'JournalEntry', 'Bill', 'Check']) {
      const ids = await fetchQBIds(accessToken, entity.realm_id!, type, startDate, endDate)
      ids.forEach(id => qbIds.add(id))
    }

    // Get all DB transaction IDs for this period
    const { data: dbTxns } = await db
      .from('qb_transactions')
      .select('id, qb_transaction_id')
      .eq('entity_id', entity.id)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)

    const orphans = (dbTxns || []).filter(t => !qbIds.has(t.qb_transaction_id))

    let deleted = 0
    for (const orphan of orphans) {
      await db.from('qb_transaction_lines').delete().eq('transaction_id', orphan.id)
      await db.from('qb_transactions').delete().eq('id', orphan.id)
      deleted++
    }

    results[entity.entity_name] = {
      qbTransactions: qbIds.size,
      dbTransactions: (dbTxns || []).length,
      orphansRemoved: deleted,
    }

    console.log(`Reconcile ${entity.entity_name}: QB=${qbIds.size} DB=${dbTxns?.length} removed=${deleted}`)
  }

  return NextResponse.json({ ok: true, results })
}
