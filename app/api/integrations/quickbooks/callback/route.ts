/**
 * GET /api/integrations/quickbooks/callback
 * Handles OAuth callback from QuickBooks.
 * QB redirects here with: ?code=...&state=...&realmId=...
 */

import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode }              from '@/lib/quickbooks'
import { createClient }              from '@supabase/supabase-js'

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const code    = searchParams.get('code')
  const state   = searchParams.get('state')
  const realmId = searchParams.get('realmId')
  const error   = searchParams.get('error')

  // Handle user-denied
  if (error) {
    console.error('QB OAuth error:', error)
    return NextResponse.redirect(new URL('/finance/connect?error=denied', req.url))
  }

  if (!code || !state || !realmId) {
    return NextResponse.redirect(new URL('/finance/connect?error=missing_params', req.url))
  }

  // Decode entity slug from state
  let entitySlug: string
  try {
    entitySlug = Buffer.from(state, 'base64').toString('utf8')
  } catch {
    return NextResponse.redirect(new URL('/finance/connect?error=invalid_state', req.url))
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCode(code, realmId)
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()

    const db = getFinanceDb()

    // Upsert entity with tokens + realm ID
    const { data: entity, error: dbError } = await db
      .from('qb_entities')
      .upsert({
        entity_slug:      entitySlug,
        realm_id:         realmId,
        access_token:     tokens.accessToken,
        refresh_token:    tokens.refreshToken,
        token_expires_at: expiresAt,
        connected:        true,
        connected_at:     new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'entity_slug' })
      .select('id')
      .single()

    if (dbError || !entity) {
      console.error('QB callback DB error:', dbError)
      return NextResponse.redirect(new URL('/finance/connect?error=db_error', req.url))
    }

    // Ensure sync state row exists
    await db.from('qb_sync_state').upsert({
      entity_id: entity.id,
      status:    'idle',
    }, { onConflict: 'entity_id', ignoreDuplicates: true })

    return NextResponse.redirect(new URL('/finance/connect?connected=' + entitySlug, req.url))
  } catch (err) {
    console.error('QB callback error:', err)
    return NextResponse.redirect(new URL('/finance/connect?error=token_exchange', req.url))
  }
}
