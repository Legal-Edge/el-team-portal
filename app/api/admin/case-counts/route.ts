/**
 * GET /api/admin/case-counts
 * Returns core.cases counts by case_status + total.
 * Uses parallel COUNT queries — efficient at any scale.
 * Protected by BACKFILL_IMPORT_TOKEN.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

const IMPORT_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const STATUSES = [
  'intake', 'nurture', 'document_collection', 'attorney_review',
  'info_needed', 'sign_up', 'retained', 'settled', 'dropped', 'unknown',
]

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (token !== IMPORT_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Run all counts in parallel
  const results = await Promise.all(
    STATUSES.map(async (status) => {
      const { count, error } = await db
        .schema('core')
        .from('cases')
        .select('*', { count: 'exact', head: true })
        .eq('case_status', status)
      return { status, count: error ? -1 : (count ?? 0) }
    })
  )

  // Total
  const { count: total } = await db
    .schema('core')
    .from('cases')
    .select('*', { count: 'exact', head: true })

  const by_status: Record<string, number> = {}
  for (const r of results) by_status[r.status] = r.count

  return NextResponse.json({ total: total ?? 0, by_status })
}
