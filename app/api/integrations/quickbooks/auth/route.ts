/**
 * GET /api/integrations/quickbooks/auth?entity=legal-edge|rockpoint
 * Initiates QuickBooks OAuth flow for the given entity.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'
import { getAuthUrl }                from '@/lib/quickbooks'
import { createClient }              from '@supabase/supabase-js'

const ENTITY_NAMES: Record<string, string> = {
  'legal-edge': 'Legal Edge, LLC',
  'rockpoint':  'RockPoint Law, P.C.',
}

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

export async function GET(req: NextRequest) {
  // Admin only
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity || !ENTITY_NAMES[entity]) {
    return NextResponse.json({ error: 'Invalid entity. Use: legal-edge or rockpoint' }, { status: 400 })
  }

  // Ensure entity row exists in DB
  const db = getFinanceDb()
  await db.from('qb_entities').upsert(
    { entity_slug: entity, entity_name: ENTITY_NAMES[entity] },
    { onConflict: 'entity_slug', ignoreDuplicates: true }
  )

  const authUrl = getAuthUrl(entity)
  return NextResponse.redirect(authUrl)
}
