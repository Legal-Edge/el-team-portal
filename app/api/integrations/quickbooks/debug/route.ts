/**
 * GET /api/integrations/quickbooks/debug
 * Diagnostic endpoint — verifies credentials format + tests token endpoint reachability.
 * Admin only. REMOVE AFTER DEBUGGING.
 */

import { NextResponse }   from 'next/server'
import { getTeamSession } from '@/lib/session'

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/op/v2/tokens'

export async function GET() {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const elClientId     = process.env.EL_QUICKBOOKS_CLIENT_ID   || '(not set)'
  const elClientSecret = process.env.EL_QUICKBOOKS_CLIENT_SECRET || '(not set)'
  const rplClientId    = process.env.RPL_QUICKBOOKS_CLIENT_ID   || '(not set)'
  const rplClientSecret = process.env.RPL_QUICKBOOKS_CLIENT_SECRET || '(not set)'
  const redirectUri    = process.env.QUICKBOOKS_REDIRECT_URI    || '(not set — using hardcoded fallback)'

  // Test if token endpoint is reachable (POST with dummy data — will get 400, not 404)
  let tokenEndpointStatus: number | string = 'unknown'
  let tokenEndpointBody = ''
  try {
    const basicAuth = Buffer.from(`${elClientId}:${elClientSecret}`).toString('base64')
    const res = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Accept':        'application/json',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code:         'test_dummy_code',
        redirect_uri: 'https://team.easylemon.com/api/integrations/quickbooks/callback',
      }),
    })
    tokenEndpointStatus = res.status
    tokenEndpointBody   = await res.text()
  } catch (err) {
    tokenEndpointStatus = `fetch error: ${err instanceof Error ? err.message : String(err)}`
  }

  return NextResponse.json({
    credentials: {
      el_client_id_prefix:      elClientId.slice(0, 8) + '...',
      el_client_id_length:      elClientId.length,
      el_client_secret_length:  elClientSecret.length,
      rpl_client_id_prefix:     rplClientId.slice(0, 8) + '...',
      rpl_client_id_length:     rplClientId.length,
      rpl_client_secret_length: rplClientSecret.length,
      redirect_uri:             redirectUri,
    },
    token_endpoint_test: {
      url:    QB_TOKEN_URL,
      status: tokenEndpointStatus,
      body:   tokenEndpointBody,
      // If status=400 → endpoint is reachable, credentials may be wrong
      // If status=404 → endpoint URL is wrong OR credentials are not recognized
      // If status=401 → wrong client ID/secret
    },
  })
}
