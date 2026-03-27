/**
 * GET /api/integrations/quickbooks/debug
 * Diagnostic endpoint — verifies credentials format + tests token endpoint reachability.
 * Admin only. REMOVE AFTER DEBUGGING.
 */

import { NextResponse }   from 'next/server'
import { getTeamSession } from '@/lib/session'

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

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

  // 1. Fetch Intuit OIDC discovery document to get the real token endpoint
  let discoveryTokenEndpoint = '(failed to fetch)'
  try {
    const disc = await fetch('https://developer.api.intuit.com/.well-known/openid_configuration', {
      cache: 'no-store'
    })
    const discJson = await disc.json()
    discoveryTokenEndpoint = discJson.token_endpoint || '(not in discovery doc)'
  } catch (err) {
    discoveryTokenEndpoint = `fetch error: ${err instanceof Error ? err.message : String(err)}`
  }

  // 2. Test hardcoded token endpoint
  let tokenEndpointStatus: number | string = 'unknown'
  let tokenEndpointBody = ''
  try {
    const basicAuth = Buffer.from(`${elClientId}:${elClientSecret}`).toString('base64')
    const res = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Accept':        'application/json',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code:         'test_dummy_code',
        redirect_uri: 'https://team.easylemon.com/api/integrations/quickbooks/callback',
      }).toString(),
    })
    tokenEndpointStatus = res.status
    tokenEndpointBody   = await res.text()
  } catch (err) {
    tokenEndpointStatus = `fetch error: ${err instanceof Error ? err.message : String(err)}`
  }

  // 3. Test discovery-derived endpoint if different
  let discoveryEndpointStatus: number | string = 'skipped (same URL)'
  let discoveryEndpointBody = ''
  if (discoveryTokenEndpoint !== QB_TOKEN_URL && !discoveryTokenEndpoint.startsWith('(')) {
    try {
      const basicAuth = Buffer.from(`${elClientId}:${elClientSecret}`).toString('base64')
      const res = await fetch(discoveryTokenEndpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Accept':        'application/json',
        },
        body: new URLSearchParams({
          grant_type:   'authorization_code',
          code:         'test_dummy_code',
          redirect_uri: 'https://team.easylemon.com/api/integrations/quickbooks/callback',
        }).toString(),
      })
      discoveryEndpointStatus = res.status
      discoveryEndpointBody   = await res.text()
    } catch (err) {
      discoveryEndpointStatus = `fetch error: ${err instanceof Error ? err.message : String(err)}`
    }
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
    discovery: {
      token_endpoint_from_intuit: discoveryTokenEndpoint,
      our_hardcoded_url:          QB_TOKEN_URL,
      match:                      discoveryTokenEndpoint === QB_TOKEN_URL,
    },
    hardcoded_url_test: {
      url:    QB_TOKEN_URL,
      status: tokenEndpointStatus,
      body:   tokenEndpointBody,
    },
    discovery_url_test: {
      status: discoveryEndpointStatus,
      body:   discoveryEndpointBody,
    },
    diagnosis: tokenEndpointStatus === 400
      ? 'ENDPOINT OK — wrong credentials or code (expected with dummy data)'
      : tokenEndpointStatus === 401
      ? 'ENDPOINT OK — wrong client ID or secret'
      : tokenEndpointStatus === 404
      ? 'PROBLEM: 404 from token endpoint — likely wrong credentials format or app not properly activated'
      : `Status ${tokenEndpointStatus}`,
  })
}
