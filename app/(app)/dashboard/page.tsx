import { redirect }       from 'next/navigation'
import { getTeamSession } from '@/lib/session'
import { createClient }   from '@supabase/supabase-js'
import { KpiCard }        from '@/components/KpiCard'
import Link               from 'next/link'

function getCoreDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')
}

// ─── Stage groupings ───────────────────────────────────────────────────────

const ACTIVE_STAGES = ['intake', 'nurture', 'document_collection', 'attorney_review', 'info_needed', 'sign_up', 'retained']
const INTAKE_STAGES  = ['intake', 'nurture']

// ─── Stats per role ────────────────────────────────────────────────────────

async function getAdminStats() {
  const db = getCoreDb()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [{ count: totalActive }, { count: settledMonth }, { count: totalPipeline }] = await Promise.all([
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', ACTIVE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', 'settled').gte('settled_at', monthStart),
    db.from('cases').select('*', { count: 'exact', head: true }).neq('case_status', 'dropped'),
  ])

  const { data: stageRows } = await db.from('cases').select('case_status').neq('case_status', 'dropped')
  const byStage: Record<string, number> = {}
  for (const r of stageRows ?? []) byStage[r.case_status] = (byStage[r.case_status] ?? 0) + 1

  const topStage = Object.entries(byStage).sort((a, b) => b[1] - a[1])[0]

  return { totalActive: totalActive ?? 0, settledMonth: settledMonth ?? 0, totalPipeline: totalPipeline ?? 0, topStage: topStage ? `${topStage[0]}: ${topStage[1]}` : '—' }
}

async function getAttorneyStats(staffId: string) {
  const db = getCoreDb()
  const now = new Date()
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const [{ count: myActive }, { count: dueSoon }, { count: needsReview }] = await Promise.all([
    db.from('cases').select('*', { count: 'exact', head: true }).eq('attorney_id', staffId).in('case_status', ACTIVE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).eq('attorney_id', staffId).lte('filing_deadline', weekEnd).gte('filing_deadline', now.toISOString()),
    db.from('communications').select('*', { count: 'exact', head: true }).eq('needs_review', true).eq('is_deleted', false),
  ])

  return { myActive: myActive ?? 0, dueSoon: dueSoon ?? 0, needsReview: needsReview ?? 0 }
}

async function getManagerStats() {
  const db = getCoreDb()
  const [{ count: totalCases }, { count: intakePending }, { count: commsReview }] = await Promise.all([
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', ACTIVE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', INTAKE_STAGES),
    db.from('communications').select('*', { count: 'exact', head: true }).eq('needs_review', true).eq('is_deleted', false),
  ])

  return { totalCases: totalCases ?? 0, intakePending: intakePending ?? 0, commsReview: commsReview ?? 0 }
}

async function getStaffStats() {
  const db = getCoreDb()
  const [{ count: totalCases }, { count: intakePending }, { count: reviewPending }] = await Promise.all([
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', ACTIVE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', INTAKE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', 'attorney_review'),
  ])

  return { totalCases: totalCases ?? 0, intakePending: intakePending ?? 0, reviewPending: reviewPending ?? 0 }
}

// ─── Recent activity (all roles) ──────────────────────────────────────────

async function getRecentActivity() {
  const db = getCoreDb()
  const { data } = await db
    .from('cases')
    .select('id, hubspot_deal_id, client_first_name, client_last_name, case_status, updated_at')
    .in('case_status', ACTIVE_STAGES)
    .order('updated_at', { ascending: false })
    .limit(10)

  return data ?? []
}

// ─── Stage badge (minimal, no dep on case detail) ─────────────────────────

const STATUS_LABELS: Record<string, string> = {
  intake:              'Intake',
  nurture:             'Nurture',
  document_collection: 'Doc Collection',
  attorney_review:     'Atty Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up',
  retained:            'Retained',
  settled:             'Settled',
  dropped:             'Dropped',
}

const STATUS_COLORS: Record<string, string> = {
  intake:              'bg-blue-50 text-blue-700',
  nurture:             'bg-yellow-50 text-yellow-700',
  document_collection: 'bg-purple-50 text-purple-700',
  attorney_review:     'bg-indigo-50 text-indigo-700',
  info_needed:         'bg-orange-50 text-orange-700',
  sign_up:             'bg-teal-50 text-teal-700',
  retained:            'bg-green-50 text-green-700',
  settled:             'bg-emerald-50 text-emerald-700',
  dropped:             'bg-red-50 text-red-700',
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await getTeamSession()
  if (!session) redirect('/login')

  // Greeting time (PST)
  const hour = new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' })
  const greeting = Number(hour) < 12 ? 'Good morning' : Number(hour) < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = session.displayName.split(' ')[0]

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles'
  })

  // Load data in parallel
  const [activity, adminStats, attorneyStats, managerStats, staffStats] = await Promise.all([
    getRecentActivity(),
    session.role === 'admin'    ? getAdminStats()                      : null,
    session.role === 'attorney' ? getAttorneyStats(session.staffId)    : null,
    session.role === 'manager'  ? getManagerStats()                    : null,
    session.role === 'staff'    ? getStaffStats()                      : null,
  ])

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{greeting}, {firstName}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{today} · Los Angeles</p>
      </div>

      {/* ── KPI Cards ── */}
      {session.role === 'admin' && adminStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Active Cases"   value={adminStats.totalActive}   accent="bg-primary-500"  href="/cases" />
          <KpiCard label="Settled This Month"   value={adminStats.settledMonth}  accent="bg-emerald-500" />
          <KpiCard label="Total Pipeline"       value={adminStats.totalPipeline} accent="bg-indigo-400" />
          <KpiCard label="Top Stage"            value={adminStats.topStage}      accent="bg-amber-400" />
        </div>
      )}

      {session.role === 'attorney' && attorneyStats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard label="My Active Cases"      value={attorneyStats.myActive}     accent="bg-primary-500"  href="/cases?assigned=me" />
          <KpiCard label="Due This Week"        value={attorneyStats.dueSoon}      accent={attorneyStats.dueSoon > 0 ? 'bg-red-500' : 'bg-green-500'} />
          <KpiCard label="Comms Needing Review" value={attorneyStats.needsReview}  accent="bg-amber-400"    href="/comms" />
        </div>
      )}

      {session.role === 'manager' && managerStats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard label="Active Cases"         value={managerStats.totalCases}    accent="bg-primary-500"  href="/cases" />
          <KpiCard label="Intake Pending"       value={managerStats.intakePending} accent="bg-amber-400"    href="/intake" />
          <KpiCard label="Comms to Review"      value={managerStats.commsReview}   accent="bg-orange-400"   href="/comms" />
        </div>
      )}

      {session.role === 'staff' && staffStats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard label="Active Cases"         value={staffStats.totalCases}      accent="bg-primary-500" href="/cases" />
          <KpiCard label="Intake Pending"       value={staffStats.intakePending}   accent="bg-amber-400"   href="/cases?status=intake" />
          <KpiCard label="In Attorney Review"   value={staffStats.reviewPending}   accent="bg-indigo-400"  href="/cases?status=attorney_review" />
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/cases"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm">
            ⚖ Case Queue
          </Link>
          {session.role !== 'staff' && (
            <Link href="/comms"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm">
              💬 Comms Inbox
            </Link>
          )}
          {(session.role === 'admin' || session.role === 'manager') && (
            <>
              <Link href="/intake"
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm">
                📋 Intake Triage
              </Link>
              <Link href="/docs/queue"
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm">
                📂 Doc Queue
              </Link>
            </>
          )}
          {session.role === 'admin' && (
            <Link href="/pipeline"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm">
              📊 Pipeline Report
            </Link>
          )}
          <kbd className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 border border-primary-200 rounded-lg text-sm font-medium text-primary-700">
            ⌘K Command Palette
          </kbd>
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Case Activity</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {activity.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No recent activity</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Stage</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {activity.map(c => {
                  const name = [c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || 'Unknown'
                  const updated = c.updated_at
                    ? new Date(c.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                    : '—'
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{name}</td>
                      <td className="px-6 py-3.5">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[c.case_status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABELS[c.case_status] ?? c.case_status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-gray-400">{updated}</td>
                      <td className="px-6 py-3.5 text-right">
                        <Link
                          href={`/cases/${c.hubspot_deal_id}`}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  )
}
