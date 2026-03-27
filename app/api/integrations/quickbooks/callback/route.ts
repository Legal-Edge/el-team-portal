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
    // Exchange code for tokens (pass entitySlug so correct app credentials are used)
    const tokens = await exchangeCode(code, realmId, entitySlug)
    if (!tokens || !tokens.accessToken) {
      console.error('QB callback: empty token response')
      return NextResponse.redirect(new URL('/finance/connect?error=empty_tokens', req.url))
    }
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()

    const db = getFinanceDb()

    // Step 1: Update the existing pre-seeded entity row (matched by slug)
    const { error: updateError } = await db
      .from('qb_entities')
      .update({
        realm_id:         realmId,
        access_token:     tokens.accessToken,
        refresh_token:    tokens.refreshToken,
        token_expires_at: expiresAt,
        connected:        true,
        connected_at:     new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      })
      .eq('entity_slug', entitySlug)

    if (updateError) {
      console.error('QB callback DB update error:', JSON.stringify(updateError))
      const detail = encodeURIComponent(updateError.message || 'update failed')
      return NextResponse.redirect(new URL(`/finance/connect?error=db_error&detail=${detail}`, req.url))
    }

    // Step 2: Fetch the entity id
    const { data: entity, error: fetchError } = await db
      .from('qb_entities')
      .select('id')
      .eq('entity_slug', entitySlug)
      .single()

    if (fetchError || !entity) {
      console.error('QB callback DB fetch error:', JSON.stringify(fetchError))
      const detail = encodeURIComponent(fetchError?.message || 'entity not found after update')
      return NextResponse.redirect(new URL(`/finance/connect?error=db_error&detail=${detail}`, req.url))
    }

    // Step 3: Ensure sync state row exists
    await db.from('qb_sync_state').upsert({
      entity_id: entity.id,
      status:    'idle',
    }, { onConflict: 'entity_id', ignoreDuplicates: true })

    return NextResponse.redirect(new URL('/finance/connect?connected=' + entitySlug, req.url))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('QB callback token exchange error:', msg)
    // Surface the actual error in URL for debugging (safe — no tokens exposed)
    const errParam = encodeURIComponent(msg.slice(0, 200))
    return NextResponse.redirect(new URL(`/finance/connect?error=token_exchange&detail=${errParam}`, req.url))
  }
}
