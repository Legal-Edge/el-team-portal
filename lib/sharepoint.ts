// ─────────────────────────────────────────────────────────────────────────────
// SharePoint Graph API Client
//
// Handles auth, folder resolution, file listing, and change subscriptions
// for the Legal SharePoint site. Server-side only — never runs in browser.
//
// Azure app: Easy Lemon Team Portal (aad6b8b9-2590-44c5-9e63-1b4b9ce7f869)
// Site:      rockpointgrowth.sharepoint.com/sites/Legal
// Drive:     Documents (b!oTYe...ei8k)
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_ID  = process.env.SHAREPOINT_TENANT_ID!
const CLIENT_ID  = process.env.SHAREPOINT_CLIENT_ID!
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET!

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const DOCUMENTS_DRIVE_ID =
  'b!oTYerw9tj0KLIWLLGc_DzIZijDFxI1xNtMSGXezIVsUHL02cd1kmRra7r_dMei8k'

// ── Token cache (module-level, reused across requests in same runtime) ────────
let _cachedToken: { value: string; expiresAt: number } | null = null

export async function getGraphToken(): Promise<string> {
  const now = Date.now()
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) {
    return _cachedToken.value
  }

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

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`SharePoint auth failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  _cachedToken = {
    value:     data.access_token,
    expiresAt: now + data.expires_in * 1000,
  }
  return _cachedToken.value
}

async function graphGet<T>(path: string): Promise<T> {
  const token = await getGraphToken()
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph API ${path}: ${res.status} ${err.slice(0, 200)}`)
  }
  return res.json()
}

// ── Resolve a SharePoint URL to a driveItem ───────────────────────────────────
// Handles two URL formats in use:
//
//   1. Sharing link:  https://rockpointgrowth.sharepoint.com/:f:/s/Legal/EjpdAB...
//      → resolved via /shares/{base64url-shareId}/driveItem
//
//   2. Direct path:   https://rockpointgrowth.sharepoint.com/sites/Legal/Shared%20Documents/Lemon%20Law/...
//      → resolved via /drives/{driveId}/root:/{relative-path}
//
export async function resolveSharePointUrl(sharingUrl: string): Promise<{
  driveId: string
  itemId:  string
  name:    string
  webUrl:  string
} | null> {
  try {
    // ── Format 1: sharing link (/:/s/ or /:f:/s/) ────────────────────────────
    if (sharingUrl.includes('/:') && sharingUrl.includes(':/s/')) {
      const encoded = Buffer.from(sharingUrl).toString('base64url')
      const shareId = `u!${encoded}`
      const item = await graphGet<{
        id: string
        name: string
        webUrl: string
        parentReference: { driveId: string }
      }>(`/shares/${shareId}/driveItem`)

      return {
        driveId: item.parentReference?.driveId ?? DOCUMENTS_DRIVE_ID,
        itemId:  item.id,
        name:    item.name,
        webUrl:  item.webUrl,
      }
    }

    // ── Format 2: direct path (/sites/Legal/Shared%20Documents/...) ──────────
    const SHARED_DOCS_MARKER = '/Shared Documents/'
    const decoded = decodeURIComponent(sharingUrl)
    const markerIdx = decoded.indexOf(SHARED_DOCS_MARKER)
    if (markerIdx !== -1) {
      const relativePath = decoded.slice(markerIdx + SHARED_DOCS_MARKER.length)
      const encodedPath  = relativePath.split('/').map(encodeURIComponent).join('/')
      const item = await graphGet<{
        id: string
        name: string
        webUrl: string
        parentReference: { driveId: string }
      }>(`/drives/${DOCUMENTS_DRIVE_ID}/root:/${encodedPath}`)

      return {
        driveId: item.parentReference?.driveId ?? DOCUMENTS_DRIVE_ID,
        itemId:  item.id,
        name:    item.name,
        webUrl:  item.webUrl,
      }
    }

    console.error('[sharepoint] resolveSharePointUrl: unrecognised URL format:', sharingUrl)
    return null
  } catch (err) {
    console.error('[sharepoint] resolveSharePointUrl error:', err)
    return null
  }
}

// ── File metadata returned from Graph API ─────────────────────────────────────
export interface SharePointFileInfo {
  sharepoint_item_id:   string
  sharepoint_drive_id:  string
  name:                 string
  file_extension:       string | null
  size_bytes:           number | null
  mime_type:            string | null
  web_url:              string | null
  download_url:         string | null
  created_at_source:    string | null
  modified_at_source:   string | null
  created_by:           string | null
  modified_by:          string | null
}

// ── List all files in a case folder ──────────────────────────────────────────
export async function listCaseFiles(
  driveItemId: string,
  driveId = DOCUMENTS_DRIVE_ID,
): Promise<SharePointFileInfo[]> {
  const files: SharePointFileInfo[] = []

  // Note: @microsoft.graph.downloadUrl is an annotation returned automatically
  // for file items — do NOT include it in $select or it breaks the clause
  let path = `/drives/${driveId}/items/${driveItemId}/children` +
    `?$select=id,name,file,size,webUrl,createdDateTime,lastModifiedDateTime,createdBy,lastModifiedBy` +
    `&$top=200`

  while (path) {
    const page = await graphGet<{
      value: Array<{
        id: string
        name: string
        file?: { mimeType: string }
        size?: number
        webUrl?: string
        '@microsoft.graph.downloadUrl'?: string
        createdDateTime?: string
        lastModifiedDateTime?: string
        createdBy?: { user?: { displayName?: string } }
        lastModifiedBy?: { user?: { displayName?: string } }
        folder?: object
      }>
      '@odata.nextLink'?: string
    }>(path.startsWith('/') ? path : path.replace(GRAPH_BASE, ''))

    for (const item of page.value) {
      // Skip sub-folders
      if (item.folder) continue

      const ext = item.name.includes('.')
        ? item.name.split('.').pop()?.toLowerCase() ?? null
        : null

      files.push({
        sharepoint_item_id:  item.id,
        sharepoint_drive_id: driveId,
        name:                item.name,
        file_extension:      ext,
        size_bytes:          item.size ?? null,
        mime_type:           item.file?.mimeType ?? null,
        web_url:             item.webUrl ?? null,
        download_url:        item['@microsoft.graph.downloadUrl'] ?? null,
        created_at_source:   item.createdDateTime ?? null,
        modified_at_source:  item.lastModifiedDateTime ?? null,
        created_by:          item.createdBy?.user?.displayName ?? null,
        modified_by:         item.lastModifiedBy?.user?.displayName ?? null,
      })
    }

    const next = page['@odata.nextLink']
    path = next ? next.replace(GRAPH_BASE, '') : ''
  }

  return files
}

// ── Webhook subscription management ──────────────────────────────────────────

export interface GraphSubscription {
  id:                 string
  resource:           string
  expirationDateTime: string
  clientState:        string
}

const WEBHOOK_ENDPOINT = 'https://team.easylemon.com/api/webhooks/sharepoint'
// Subscriptions expire after 4,320 min (3 days) — cron renews before expiry
const EXPIRY_MINUTES   = 4300

export async function createDriveSubscription(
  driveId  = DOCUMENTS_DRIVE_ID,
  clientState = 'el-team-portal',
): Promise<GraphSubscription> {
  const token = await getGraphToken()
  const expiry = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString()

  const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType:           'created,updated,deleted',
      notificationUrl:      WEBHOOK_ENDPOINT,
      resource:             `/drives/${driveId}/root`,
      expirationDateTime:   expiry,
      clientState,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`createDriveSubscription: ${res.status} ${err.slice(0, 300)}`)
  }

  return res.json()
}

export async function renewSubscription(
  subscriptionId: string,
): Promise<GraphSubscription> {
  const token  = await getGraphToken()
  const expiry = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString()

  const res = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expirationDateTime: expiry }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`renewSubscription: ${res.status} ${err.slice(0, 300)}`)
  }

  return res.json()
}

export async function listSubscriptions(): Promise<GraphSubscription[]> {
  const data = await graphGet<{ value: GraphSubscription[] }>('/subscriptions')
  return data.value ?? []
}

export { DOCUMENTS_DRIVE_ID }
