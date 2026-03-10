/**
 * SharePoint → Document Pipeline — Cron Trigger
 *
 * This script is the CRON TRIGGER ONLY. All document processing logic
 * lives in lib/document-pipeline/. This script:
 *   1. Authenticates with Microsoft Graph
 *   2. Lists files in SharePoint folders for the requested cases
 *   3. Calls processDocument() for each file — the canonical pipeline entry point
 *
 * Switching to webhooks later: replace this script with a webhook handler
 * at app/api/webhooks/sharepoint/route.ts. The processDocument() call is
 * identical — the trigger source doesn't matter.
 *
 * Usage (via tsx):
 *   npx tsx scripts/sync-sharepoint-docs.ts --deal-id=57782494293
 *   npx tsx scripts/sync-sharepoint-docs.ts --deal-ids=57782494293,57750922281
 *   npx tsx scripts/sync-sharepoint-docs.ts --all
 *   npx tsx scripts/sync-sharepoint-docs.ts --deal-id=57782494293 --dry-run
 *   npx tsx scripts/sync-sharepoint-docs.ts --deal-id=57782494293 --force
 */

import { createClient } from '@supabase/supabase-js'
import { processDocument } from '../lib/document-pipeline/pipeline'
import type { SharePointFile } from '../lib/document-pipeline/types'

// ── Env ───────────────────────────────────────────────────────────────────────

const TENANT_ID     = process.env.AZURE_AD_TENANT_ID     ?? '6c5c63d2-425b-4a52-8bad-8059713fb96e'
const CLIENT_ID     = process.env.AZURE_AD_CLIENT_ID     ?? 'aad6b8b9-2590-44c5-9e63-1b4b9ce7f869'
const CLIENT_SECRET = process.env.AZURE_AD_CLIENT_SECRET!
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing: AZURE_AD_CLIENT_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const dealIdArg   = args.find(a => a.startsWith('--deal-id='))?.split('=')[1]
const dealIdsArg  = args.find(a => a.startsWith('--deal-ids='))?.split('=')[1]
const allFlag     = args.includes('--all')
const dryRun      = args.includes('--dry-run')
const force       = args.includes('--force')

// ── Supabase ──────────────────────────────────────────────────────────────────

const coreDb = createClient(SUPABASE_URL, SUPABASE_KEY).schema('core')

// ── Microsoft Graph auth (client credentials / app-only) ──────────────────────

let _graphToken: string | null = null

async function getGraphToken(): Promise<string> {
  if (_graphToken) return _graphToken
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  )
  const data = await res.json()
  if (!data.access_token) throw new Error(`Graph auth failed: ${JSON.stringify(data)}`)
  _graphToken = data.access_token as string
  return _graphToken
}

async function graph(path: string) {
  const token = await getGraphToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph ${res.status} ${path}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

// ── SharePoint folder → file list ─────────────────────────────────────────────

function parseSharePointUrl(url: string) {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/^(\/sites\/[^/]+)(.*)/)
  if (!match) throw new Error(`Cannot parse SharePoint URL: ${url}`)
  const folderPath = decodeURIComponent(match[2])
    .replace(/^\/Shared Documents/, '')
    .replace(/^\//, '')
  return { hostname: parsed.hostname, sitePath: match[1], folderPath }
}

interface GraphFile {
  id: string
  name: string
  size: number
  file?: { mimeType: string }
  webUrl: string
  createdDateTime: string
  lastModifiedDateTime: string
  createdBy?: { user?: { displayName?: string } }
  lastModifiedBy?: { user?: { displayName?: string } }
}

async function listFolderFiles(
  sharePointUrl: string
): Promise<{ driveId: string; files: GraphFile[] }> {
  const { hostname, sitePath, folderPath } = parseSharePointUrl(sharePointUrl)
  const site  = await graph(`/sites/${hostname}:${sitePath}`)
  const drive = await graph(`/sites/${site.id}/drive`)
  const encodedPath = folderPath.split('/').map(s => encodeURIComponent(s)).join('/')
  const items = await graph(
    `/drives/${drive.id}/root:/${encodedPath}:/children?$top=100&$select=id,name,file,size,webUrl,createdDateTime,lastModifiedDateTime,createdBy,lastModifiedBy`
  )
  return {
    driveId: drive.id as string,
    files: (items.value ?? []).filter((i: any) => i.file) as GraphFile[],
  }
}

function graphFileToSharePointFile(f: GraphFile, driveId: string): SharePointFile {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : null
  return {
    sharepoint_item_id:  f.id,
    sharepoint_drive_id: driveId,
    name:                f.name,
    file_extension:      ext,
    size_bytes:          f.size ?? null,
    mime_type:           f.file?.mimeType ?? null,
    web_url:             f.webUrl ?? null,
    download_url:        null as null,
    created_at_source:   f.createdDateTime ?? null,
    modified_at_source:  f.lastModifiedDateTime ?? null,
    created_by:          f.createdBy?.user?.displayName ?? null,
    modified_by:         f.lastModifiedBy?.user?.displayName ?? null,
  }
}

// ── Sync one case ─────────────────────────────────────────────────────────────

interface CaseRow {
  id: string
  hubspot_deal_id: string
  sharepoint_folder_url: string | null
  sharepoint_folder_title: string | null
}

async function syncCase(caseRow: CaseRow) {
  if (!caseRow.sharepoint_folder_url) {
    console.log(`  ⚠ No SharePoint URL`)
    return
  }

  const label = caseRow.sharepoint_folder_title
    ?? caseRow.sharepoint_folder_url.split('/').pop()
    ?? caseRow.hubspot_deal_id

  console.log(`  📁 ${label}`)

  let driveId: string
  let files: GraphFile[]
  try {
    const result = await listFolderFiles(caseRow.sharepoint_folder_url)
    driveId = result.driveId
    files = result.files
  } catch (e: any) {
    console.error(`  ✗ Graph error: ${e.message}`)
    return
  }

  console.log(`  → ${files.length} file(s) found`)

  if (dryRun) {
    files.forEach(f => console.log(`    [dry-run] ${f.name} (${((f.size ?? 0) / 1024).toFixed(1)} KB)`))
    return
  }

  let synced = 0, skipped = 0, classified = 0, needsReview = 0

  for (const f of files) {
    const spFile = graphFileToSharePointFile(f, driveId)

    // ── This is the only call the trigger makes — the pipeline handles the rest
    const result = await processDocument({
      case_id:         caseRow.id,
      hubspot_deal_id: caseRow.hubspot_deal_id,
      file:            spFile,
      force,
    })

    if (result.action === 'skipped') {
      skipped++
    } else {
      synced++
      if (result.classification && result.classification.confidence >= 0.85) {
        classified++
        const icon = result.needs_review ? '⚠' : '✅'
        console.log(
          `    ${icon} ${f.name} → ${result.classification.document_type_code}` +
          ` (${(result.classification.confidence * 100).toFixed(0)}% ${result.classification.source})`
        )
      } else if (result.classification) {
        needsReview++
        console.log(
          `    ⚠ ${f.name} → ${result.classification.document_type_code}` +
          ` (low confidence: ${(result.classification.confidence * 100).toFixed(0)}% — queued for review)`
        )
      } else {
        needsReview++
        console.log(`    ❓ ${f.name} → unclassified`)
      }
    }

    await new Promise(r => setTimeout(r, 50))
  }

  const parts = [`synced: ${synced}`]
  if (skipped > 0) parts.push(`skipped: ${skipped} (unchanged)`)
  if (classified > 0) parts.push(`auto-classified: ${classified}`)
  if (needsReview > 0) parts.push(`needs review: ${needsReview}`)
  console.log(`  ↳ ${parts.join(' | ')}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!dealIdArg && !dealIdsArg && !allFlag) {
    console.error('Usage: --deal-id=<id>  |  --deal-ids=<id1,id2>  |  --all  [--dry-run]  [--force]')
    process.exit(1)
  }

  let cases: CaseRow[] = []

  if (dealIdArg) {
    const { data } = await coreDb
      .from('cases')
      .select('id,hubspot_deal_id,sharepoint_folder_url,sharepoint_folder_title')
      .eq('hubspot_deal_id', dealIdArg)
      .single()
    if (!data) { console.error('Case not found'); process.exit(1) }
    cases = [data as CaseRow]
  } else if (dealIdsArg) {
    const ids = dealIdsArg.split(',').map(s => s.trim())
    const { data } = await coreDb
      .from('cases')
      .select('id,hubspot_deal_id,sharepoint_folder_url,sharepoint_folder_title')
      .in('hubspot_deal_id', ids)
    cases = (data ?? []) as CaseRow[]
  } else {
    const { data } = await coreDb
      .from('cases')
      .select('id,hubspot_deal_id,sharepoint_folder_url,sharepoint_folder_title')
      .eq('is_deleted', false)
      .not('sharepoint_folder_url', 'is', null)
    cases = (data ?? []) as CaseRow[]
    console.log(`Found ${cases.length} cases with SharePoint URLs`)
  }

  if (dryRun) console.log('\n⚠ DRY RUN — no data will be written\n')
  if (force)  console.log('⚡ FORCE mode — re-processing all files regardless of modification status\n')

  for (const c of cases) {
    console.log(`\n▶  Deal ${c.hubspot_deal_id}`)
    await syncCase(c)
    await new Promise(r => setTimeout(r, 200))
  }

  console.log('\n✅ Done')
}

main().catch(e => { console.error(e); process.exit(1) })
