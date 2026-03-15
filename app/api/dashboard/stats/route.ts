/**
 * GET /api/dashboard/stats
 *
 * Returns live KPI and pipeline stage counts for the dashboard.
 * Called by DashboardLive.tsx whenever an SSE case event fires.
 * Session-protected.
 */

import { NextResponse }   from 'next/server'
import { getTeamSession } from '@/lib/session'
import { createClient }   from '@supabase/supabase-js'

const ACTIVE_STAGES = ['intake', 'nurture', 'document_collection', 'attorney_review', 'info_needed', 'sign_up', 'retained']

function getCoreDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')
}

export async function GET() {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getCoreDb()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [
    { count: totalActive },
    { count: settledMonth },
    { count: totalPipeline },
    { data: stageRows },
  ] = await Promise.all([
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', ACTIVE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', 'settled').gte('closed_at', monthStart),
    db.from('cases').select('*', { count: 'exact', head: true }).neq('case_status', 'dropped'),
    db.from('cases').select('case_status').neq('case_status', 'dropped'),
  ])

  const byStage: Record<string, number> = {}
  for (const r of stageRows ?? []) byStage[r.case_status] = (byStage[r.case_status] ?? 0) + 1

  const topStage = Object.entries(byStage).sort((a, b) => b[1] - a[1])[0]

  return NextResponse.json({
    totalActive:   totalActive   ?? 0,
    settledMonth:  settledMonth  ?? 0,
    totalPipeline: totalPipeline ?? 0,
    topStage:      topStage ? `${topStage[0]}: ${topStage[1]}` : '—',
    byStage,
    fetchedAt:     now.toISOString(),
  })
}
