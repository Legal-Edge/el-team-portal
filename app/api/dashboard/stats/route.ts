/**
 * GET /api/dashboard/stats
 *
 * Returns live KPI and pipeline stage counts for the dashboard.
 * Uses per-stage COUNT queries — never fetches rows, no pagination cap.
 * Called by DashboardLive.tsx whenever an SSE case event fires.
 * Session-protected.
 */

import { NextResponse }   from 'next/server'
import { getTeamSession } from '@/lib/session'
import { createClient }   from '@supabase/supabase-js'

const ALL_STAGES = [
  'intake', 'nurture', 'document_collection', 'attorney_review',
  'info_needed', 'sign_up', 'retained', 'settled',
]
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

  const db  = getCoreDb()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // One COUNT query per stage + 3 KPI queries — all in parallel, no row fetching
  const [kpiActive, kpiSettled, kpiPipeline, ...stageCounts] = await Promise.all([
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', ACTIVE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', 'settled').gte('closed_at', monthStart),
    db.from('cases').select('*', { count: 'exact', head: true }).neq('case_status', 'dropped'),
    ...ALL_STAGES.map(stage =>
      db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', stage)
    ),
  ])

  const byStage: Record<string, number> = {}
  ALL_STAGES.forEach((stage, i) => {
    byStage[stage] = stageCounts[i]?.count ?? 0
  })

  const topStage = Object.entries(byStage).sort((a, b) => b[1] - a[1])[0]

  return NextResponse.json({
    totalActive:   kpiActive.count   ?? 0,
    settledMonth:  kpiSettled.count  ?? 0,
    totalPipeline: kpiPipeline.count ?? 0,
    topStage:      topStage ? `${topStage[0]}: ${topStage[1]}` : '—',
    byStage,
    fetchedAt:     now.toISOString(),
  })
}
