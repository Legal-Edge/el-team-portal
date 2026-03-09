import { auth, signOut } from '@/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card'

// Schema-qualified clients
function getCoreDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')
}

async function getDashboardStats() {
  const coreDb = getCoreDb()

  try {
    // Total cases
    const { count: totalCases, error: totalError } = await coreDb
      .from('cases')
      .select('*', { count: 'exact', head: true })

    if (totalError) console.error('total cases error:', totalError)

    // Active cases
    const { count: activeCases, error: activeError } = await coreDb
      .from('cases')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')

    if (activeError) console.error('active cases error:', activeError)

    // Cases in review
    const { count: reviewCases, error: reviewError } = await coreDb
      .from('cases')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'attorney_review')

    if (reviewError) console.error('review cases error:', reviewError)

    // Recent cases
    const { data: recentCases, error: recentError } = await coreDb
      .from('cases')
      .select('case_id, status, stage, created_at, hubspot_deal_id')
      .order('created_at', { ascending: false })
      .limit(10)

    if (recentError) console.error('recent cases error:', recentError)

    return {
      totalCases: totalCases ?? 0,
      activeCases: activeCases ?? 0,
      reviewCases: reviewCases ?? 0,
      recentCases: recentCases ?? []
    }
  } catch (error) {
    console.error('getDashboardStats error:', error)
    return {
      totalCases: 0,
      activeCases: 0,
      reviewCases: 0,
      recentCases: []
    }
  }
}

export default async function DashboardPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  const stats = await getDashboardStats()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-lemon-400 w-10 h-10 rounded-lg flex items-center justify-center">
                <span className="text-lg font-bold text-gray-900">EL</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">Team Portal</h1>
            </div>

            <div className="flex items-center gap-4">
              {session.user.role === 'admin' && (
                <a
                  href="/admin/integrations/hubspot"
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
                >
                  <span>⚙️</span> Integrations
                </a>
              )}
              <div className="text-sm">
                <span className="text-gray-600">Welcome, </span>
                <span className="font-semibold text-gray-900">
                  {session.user.displayName ?? session.user.name}
                </span>
                {session.user.role && (
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                    session.user.role === 'admin'
                      ? 'bg-red-100 text-red-700'
                      : session.user.role === 'attorney'
                      ? 'bg-purple-100 text-purple-700'
                      : session.user.role === 'manager'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {session.user.role}
                  </span>
                )}
              </div>
              <form action={async () => {
                "use server"
                await signOut()
              }}>
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Cases</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalCases}</p>
                </div>
                <div className="bg-blue-100 p-3 rounded-lg">
                  <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Active Cases</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.activeCases}</p>
                </div>
                <div className="bg-green-100 p-3 rounded-lg">
                  <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">In Review</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.reviewCases}</p>
                </div>
                <div className="bg-yellow-100 p-3 rounded-lg">
                  <svg className="w-6 h-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Cases */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Cases</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recentCases.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No cases found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Case ID</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Stage</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">HubSpot Deal</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentCases.map((c: any) => (
                      <tr key={c.case_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 font-mono text-xs text-gray-600">
                          {c.case_id?.slice(0, 8)}...
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                            {c.status ?? '—'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-sm">
                          {c.stage ?? '—'}
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-sm">
                          {c.hubspot_deal_id ?? '—'}
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-sm">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
