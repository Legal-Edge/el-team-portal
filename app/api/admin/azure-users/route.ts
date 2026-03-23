import { NextResponse }  from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const TENANT_ID     = process.env.SHAREPOINT_TENANT_ID!
const CLIENT_ID     = process.env.SHAREPOINT_CLIENT_ID!
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET!
const BEARER_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN!

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get access token
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          scope:         'https://graph.microsoft.com/.default',
          grant_type:    'client_credentials',
        }),
      }
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return NextResponse.json({ error: 'Token error', detail: tokenData }, { status: 500 })
    }

    // Query users — name, email, job title, department
    const usersRes = await fetch(
      'https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName,jobTitle,department,accountEnabled&$top=999&$orderby=displayName',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    )
    const usersData = await usersRes.json()
    if (!usersRes.ok) {
      return NextResponse.json({ error: 'Graph API error', detail: usersData }, { status: 500 })
    }

    // Get portal-blocked users from Supabase (graceful if table doesn't exist yet)
    let blockedEmails = new Set<string>()
    try {
      const { data: blocked } = await supabaseAdmin
        .from('portal_blocked_users')
        .select('email')
      blockedEmails = new Set((blocked ?? []).map((b: { email: string }) => b.email.toLowerCase()))
    } catch {
      // Table not yet created — treat as empty blocklist
    }

    const users = (usersData.value ?? []).map((u: Record<string, unknown>) => {
      const email = ((u.mail ?? u.userPrincipalName) as string | null)?.toLowerCase() ?? null
      return {
        name:       u.displayName,
        email,
        title:      u.jobTitle,
        department: u.department,
        enabled:    u.accountEnabled,
        blocked:    email ? blockedEmails.has(email) : false,
      }
    })

    return NextResponse.json({ count: users.length, users })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
