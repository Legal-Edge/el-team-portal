/**
 * GET /api/cases/search?q={query}
 * Fuzzy search across client name, phone, email, VIN, deal ID.
 * Auth: authenticated session required.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }             from '@/lib/session'
import { createClient }               from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ results: [] })

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Search by multiple columns using ilike
  const { data, error } = await db
    .from('cases')
    .select('id, hubspot_deal_id, client_first_name, client_last_name, client_phone, client_email, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, case_status')
    .or([
      `client_first_name.ilike.%${q}%`,
      `client_last_name.ilike.%${q}%`,
      `client_email.ilike.%${q}%`,
      `client_phone.ilike.%${q}%`,
      `vehicle_vin.ilike.%${q}%`,
      `vehicle_make.ilike.%${q}%`,
      `vehicle_model.ilike.%${q}%`,
      `hubspot_deal_id.ilike.%${q}%`,
    ].join(','))
    .neq('case_status', 'dropped')
    .order('updated_at', { ascending: false })
    .limit(8)

  if (error) return NextResponse.json({ results: [] })

  const STATUS_LABELS: Record<string, string> = {
    intake: 'Intake', nurture: 'Nurture', document_collection: 'Doc Collection',
    attorney_review: 'Atty Review', info_needed: 'Info Needed', sign_up: 'Sign Up',
    retained: 'Retained', settled: 'Settled', dropped: 'Dropped',
  }

  const results = (data ?? []).map(c => ({
    id:         c.id,
    dealId:     c.hubspot_deal_id,
    clientName: [c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || 'Unknown',
    vehicle:    [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || '',
    status:     STATUS_LABELS[c.case_status] ?? c.case_status,
  }))

  return NextResponse.json({ results })
}
