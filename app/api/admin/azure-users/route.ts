import { NextResponse } from 'next/server'

// Read-only Graph API query using existing SharePoint app credentials
// User.Read.All is already granted on aad6b8b9-2590-44c5-9e63-1b4b9ce7f869

const TENANT_ID     = process.env.SHAREPOINT_TENANT_ID!
const CLIENT_ID     = process.env.SHAREPOINT_CLIENT_ID!
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET!
const BEARER_TOKEN  = process.env.BACKFILL_IMPORT_TOKEN!

export async function GET(req: Request) {
  // Token-protected — same as other admin endpoints
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
      'https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName,jobTitle,department,accountEnabled&$top=200&$orderby=displayName',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    )
    const usersData = await usersRes.json()

    if (!usersRes.ok) {
      return NextResponse.json({ error: 'Graph API error', detail: usersData }, { status: 500 })
    }

    const users = (usersData.value ?? []).map((u: Record<string, unknown>) => ({
      name:       u.displayName,
      email:      u.mail ?? u.userPrincipalName,
      title:      u.jobTitle,
      department: u.department,
      enabled:    u.accountEnabled,
    }))

    return NextResponse.json({ count: users.length, users })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
