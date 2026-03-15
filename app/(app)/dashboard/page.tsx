import { redirect }        from 'next/navigation'
import { getTeamSession }  from '@/lib/session'
import { createClient }    from '@supabase/supabase-js'
import { KpiCard }         from '@/components/KpiCard'
import { DashboardLive }   from '@/components/DashboardLive'
import type { Metadata }   from 'next'

export const metadata: Metadata = { title: 'Dashboard' }
import Link                from 'next/link'

function getCoreDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')
}

// ─── Stage groupings ───────────────────────────────────────────────────────

const ALL_STAGES    = ['intake', 'nurture', 'document_collection', 'attorney_review', 'info_needed', 'sign_up', 'retained', 'settled']
const ACTIVE_STAGES = ['intake', 'nurture', 'document_collection', 'attorney_review', 'info_needed', 'sign_up', 'retained']
const INTAKE_STAGES = ['intake', 'nurture']

// ─── Stats per role ────────────────────────────────────────────────────────

async function getAdminStats() {
  const db = getCoreDb()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // Per-stage COUNT queries — never fetch rows, no 1000-row pagination cap
  const [kpiActive, kpiSettled, kpiPipeline, ...stageCounts] = await Promise.all([
    db.from('cases').select('*', { count: 'exact', head: true }).in('case_status', ACTIVE_STAGES),
    db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', 'settled').gte('closed_at', monthStart),
    db.from('cases').select('*', { count: 'exact', head: true }).neq('case_status', 'dropped'),
    ...ALL_STAGES.map(stage =>
      db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', stage)
    ),
  ])

  const byStage: Record<string, number> = {}
  ALL_STAGES.forEach((stage, i) => { byStage[stage] = stageCounts[i]?.count ?? 0 })

  return {
    totalActive:   kpiActive.count   ?? 0,
    settledMonth:  kpiSettled.count  ?? 0,
    totalPipeline: kpiPipeline.count ?? 0,
    byStage,
    fetchedAt:     new Date().toISOString(),
  }
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

      {/* ── Admin: Live KPIs + Pipeline Chart ── */}
      {session.role === 'admin' && adminStats && (
        <DashboardLive initial={adminStats} />
      )}

      {session.role === 'attorney' && attorneyStats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard label="My Active Cases"      value={attorneyStats.myActive}     accent="bg-lemon-400"   href="/cases?assigned=me" />
          <KpiCard label="Due This Week"        value={attorneyStats.dueSoon}      accent={attorneyStats.dueSoon > 0 ? 'bg-red-400' : 'bg-emerald-400'} />
          <KpiCard label="Comms Needing Review" value={attorneyStats.needsReview}  accent="bg-amber-400"   href="/comms" />
        </div>
      )}

      {session.role === 'manager' && managerStats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard label="Active Cases"         value={managerStats.totalCases}    accent="bg-lemon-400"  href="/cases" />
          <KpiCard label="Intake Pending"       value={managerStats.intakePending} accent="bg-amber-400"   href="/intake" />
          <KpiCard label="Comms to Review"      value={managerStats.commsReview}   accent="bg-orange-400"  href="/comms" />
        </div>
      )}

      {session.role === 'staff' && staffStats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard label="Active Cases"         value={staffStats.totalCases}      accent="bg-lemon-400"  href="/cases" />
          <KpiCard label="Intake Pending"       value={staffStats.intakePending}   accent="bg-amber-400"   href="/cases?status=intake" />
          <KpiCard label="In Attorney Review"   value={staffStats.reviewPending}   accent="bg-gray-300"    href="/cases?status=attorney_review" />
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { href: '/cases',      label: 'Case Queue',      show: true },
            { href: '/comms',      label: 'Comms Inbox',     show: session.role !== 'staff' },
            { href: '/intake',     label: 'Intake Triage',   show: session.role === 'admin' || session.role === 'manager' },
            { href: '/docs/queue', label: 'Doc Queue',       show: session.role === 'admin' || session.role === 'manager' },
            { href: '/pipeline',   label: 'Pipeline Report', show: session.role === 'admin' },
          ].filter(a => a.show).map(a => (
            <Link key={a.href} href={a.href}
              className="inline-flex items-center px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-150 active:scale-95 shadow-card">
              {a.label}
            </Link>
          ))}
          <kbd className="inline-flex items-center gap-1.5 px-4 py-2 bg-lemon-400/10 border border-lemon-400/30 rounded-lg text-sm font-medium text-gray-600">
            <span className="font-mono">⌘K</span> Command Palette
          </kbd>
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Recent Case Activity</h2>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-card">
          {activity.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No recent activity</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Client</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Stage</th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
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
                          className="text-xs text-gray-500 hover:text-gray-900 font-medium transition-colors"
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
