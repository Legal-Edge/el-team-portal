// GET /api/admin/sharepoint/debug
// Lists active Graph subscriptions + tests the webhook URL is reachable

import { NextRequest, NextResponse }         from 'next/server'
import { listSubscriptions, getGraphToken, DOCUMENTS_DRIVE_ID } from '@/lib/sharepoint'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${TOKEN}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const subs = await listSubscriptions()
    const ours = subs.filter(s => s.clientState === 'el-team-portal')

    // Also fetch the case folder to confirm we can read it
    const graphToken = await getGraphToken()
    const driveRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${DOCUMENTS_DRIVE_ID}/root?$select=id,name,webUrl`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    )
    const driveRoot = driveRes.ok ? await driveRes.json() : { error: driveRes.status }

    // Check the case folder
    const folderRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${DOCUMENTS_DRIVE_ID}/items/01KNE7SA4BWULREMGCM5A3FFHISUU2B2GD/children?$select=id,name,file,lastModifiedDateTime`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    )
    const folderContents = folderRes.ok ? await folderRes.json() : { error: folderRes.status }

    // Try to fetch the last-created subscription directly by ID
    const LAST_SUB_ID = '326283b9-991c-4ed7-83a1-b879352b6c69'
    const directRes = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${LAST_SUB_ID}`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    )
    const directSub = directRes.ok
      ? await directRes.json()
      : { status: directRes.status, error: await directRes.text() }

    return NextResponse.json({
      subscriptions: {
        total:   subs.length,
        ours:    ours.map(s => ({
          id:          s.id,
          resource:    s.resource,
          expiresAt:   s.expirationDateTime,
          clientState: s.clientState,
        })),
        direct_lookup: {
          id:        LAST_SUB_ID,
          found:     directRes.ok,
          expiresAt: directSub.expirationDateTime ?? null,
          status:    directSub.status ?? 'ok',
          error:     directSub.error ?? null,
        },
      },
      driveRoot,
      caseFolder: {
        id: '01KNE7SA4BWULREMGCM5A3FFHISUU2B2GD',
        files: folderContents.value ?? folderContents,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
