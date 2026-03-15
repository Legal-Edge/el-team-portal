/**
 * PATCH /api/cases/[id]/intake-status
 *
 * Updates intake status for a case.
 * Supabase (core.case_state) is source of truth — HubSpot is a write-back side effect.
 *
 * Auth: session required; admin / attorney / manager only
 * Body: { status: IntakeStatus }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { auth }                      from '@/auth'
import { setIntakeStatus, INTAKE_STATUS } from '@/lib/pipelines/intake'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const ALLOWED_ROLES = new Set(['admin', 'attorney', 'manager'])
const VALID_STATUSES = new Set(Object.values(INTAKE_STATUS))

export async function PATCH(
  req:     NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has((session.user as { role?: string }).role ?? '')) {
    return NextResponse.json({ error: 'Forbidden — admin, attorney, or manager role required' }, { status: 403 })
  }

  const { id: hubspotDealId } = await params

  // Body
  let body: { status?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const newStatus = body.status
  if (!newStatus || !VALID_STATUSES.has(newStatus as never)) {
    return NextResponse.json({
      error: 'Invalid status',
      valid: [...VALID_STATUSES],
    }, { status: 400 })
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Resolve case UUID from hubspot_deal_id
  const { data: caseRow } = await client
    .schema('core')
    .from('cases')
    .select('id')
    .eq('hubspot_deal_id', hubspotDealId)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!caseRow?.id) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const { error } = await setIntakeStatus(
    client,
    caseRow.id,
    hubspotDealId,
    newStatus as import('@/lib/pipelines/intake').IntakeStatus,
    session.user.email ?? 'unknown',
  )

  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ ok: true, status: newStatus })
}
