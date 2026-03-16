/**
 * GET /api/doc-stats
 *
 * Aggregate document health KPIs from core.document_files
 * and core.case_document_checklist.
 * Used by DashboardLive for live document health cards.
 *
 * Returns:
 *   { missing_required, unclassified, needs_review, recent_uploads, fetched_at }
 */
import { NextResponse }  from 'next/server'
import { auth }          from '@/auth'
import { createClient }  from '@supabase/supabase-js'

export interface DocStats {
  missing_required: number   // required checklist items not yet received
  unclassified:     number   // documents not yet classified
  needs_review:     number   // classified but not reviewed
  recent_uploads:   number   // documents uploaded in last 24 hours
  fetched_at:       string
}

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // All "what is current?" queries go to operational state tables per architecture rule.
  // communications.needs_review and document_files.is_classified are DEPRECATED.
  const [missingReq, unclassified, needsReview, recentUploads] = await Promise.all([
    // Missing required docs → core.case_document_checklist (operational state)
    db.from('case_document_checklist')
      .select('*', { count: 'exact', head: true })
      .in('status', ['required', 'requested'])
      .eq('is_required', true)
      .eq('is_deleted', false),

    // Unclassified docs → core.document_review_state (operational state)
    db.from('document_review_state')
      .select('*', { count: 'exact', head: true })
      .eq('is_classified', false),

    // Classified but not reviewed → core.document_review_state (operational state)
    db.from('document_review_state')
      .select('*', { count: 'exact', head: true })
      .eq('is_classified', true)
      .eq('is_reviewed', false),

    // Recent uploads → core.document_files (file identity / history — asking "when uploaded?" is a history question)
    db.from('document_files')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since24h)
      .eq('is_deleted', false),
  ])

  const stats: DocStats = {
    missing_required: missingReq.count    ?? 0,
    unclassified:     unclassified.count  ?? 0,
    needs_review:     needsReview.count   ?? 0,
    recent_uploads:   recentUploads.count ?? 0,
    fetched_at:       new Date().toISOString(),
  }

  return NextResponse.json(stats)
}
