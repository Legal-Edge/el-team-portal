// ─────────────────────────────────────────────────────────────────────────────
// SharePoint Drive Delta Sync
//
// Uses the Microsoft Graph delta query API to detect changed drive items and
// sync only the affected case folders — far more efficient than full re-scans.
//
// Flow:
//   1. Read `sharepoint_drive_delta_link` from core.sync_state
//   2. No link → initialize with `?token=latest` (anchors to "now", no items returned)
//   3. With link → GET {deltaLink} → list changed items → find case folders → sync
//   4. Store new deltaLink for next run
//
// Called by:
//   - POST /api/webhooks/sharepoint (when a Graph notification fires)
//   - GET  /api/admin/cron/sharepoint-delta (every ~1 minute via Vercel cron)
//
// Why delta beats full-rescan:
//   - Graph drive notifications are NOT reliable for SharePoint (known MS issue)
//   - Full-rescan cron re-syncs every case every 90s regardless of changes
//   - Delta queries are surgical: only changed items, minimal API calls
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getDriveDelta,
  DeltaLinkExpiredError,
  DOCUMENTS_DRIVE_ID,
  getGraphToken,
} from './sharepoint'
import { syncCaseFiles } from './pipelines/sharepoint-sync'

const GRAPH_BASE      = 'https://graph.microsoft.com/v1.0'
const DELTA_LINK_KEY  = 'sharepoint_drive_delta_link'
// Cap on Graph API parent-lookup calls per delta run (avoids rate limits)
const MAX_PARENT_LOOKUPS = 20

export interface DeltaSyncResult {
  initialized:  boolean
  changedItems: number
  casesFound:   number
  casesSynced:  number
  errors:       number
  newDeltaLink: string | null
  durationMs:   number
}

/**
 * Main entry point — run a full delta sync cycle.
 *
 * Safe to call concurrently: the worst case is two runs processing the same
 * changes (idempotent syncCaseFiles handles that).
 */
export async function runDeltaSync(
  client:  SupabaseClient,
  driveId = DOCUMENTS_DRIVE_ID,
): Promise<DeltaSyncResult> {
  const t0 = Date.now()
  const db  = client.schema('core')

  // ── Read stored deltaLink ─────────────────────────────────────────────────
  const { data: deltaRow } = await db
    .from('sync_state')
    .select('value')
    .eq('key', DELTA_LINK_KEY)
    .maybeSingle()

  const storedDeltaLink = (deltaRow?.value as string | null) ?? null

  try {
    const { items, deltaLink: newDeltaLink, initialized } =
      await getDriveDelta(storedDeltaLink, driveId)

    // Persist new deltaLink immediately — even on empty result sets
    if (newDeltaLink) {
      await db.from('sync_state').upsert(
        { key: DELTA_LINK_KEY, value: newDeltaLink, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
    }

    if (initialized) {
      console.log('[sharepoint-delta] initialized delta tracking from "latest" position')
      return { initialized: true, changedItems: 0, casesFound: 0, casesSynced: 0, errors: 0, newDeltaLink, durationMs: Date.now() - t0 }
    }

    if (items.length === 0) {
      return { initialized: false, changedItems: 0, casesFound: 0, casesSynced: 0, errors: 0, newDeltaLink, durationMs: Date.now() - t0 }
    }

    console.log(`[sharepoint-delta] ${items.length} changed item(s) detected`)

    // ── Identify affected case folders ────────────────────────────────────
    // Changed files have parentReference.id = their containing folder ID.
    // Case folders are stored in cases.sharepoint_drive_item_id.
    //
    // Layout possibilities:
    //   /CaseFolder/file.pdf         → parentReference.id = CaseFolder.id  ✓ direct match
    //   /CaseFolder/SubFolder/file   → parentReference.id = SubFolder.id   → need grandparent lookup

    const directParentIds = new Set<string>()
    for (const item of items) {
      if (item.parentReference?.id) directParentIds.add(item.parentReference.id)
    }

    // Direct match: parent IS the case folder
    const casesToSync = new Map<string, string>()   // caseId → driveItemId
    const unmatchedParentIds: string[] = []

    if (directParentIds.size > 0) {
      const { data: directCases } = await db
        .from('cases')
        .select('id, sharepoint_drive_item_id')
        .in('sharepoint_drive_item_id', [...directParentIds])
        .eq('is_deleted', false)

      const matchedIds = new Set<string>()
      for (const c of directCases ?? []) {
        if (c.sharepoint_drive_item_id) {
          casesToSync.set(c.id, c.sharepoint_drive_item_id)
          matchedIds.add(c.sharepoint_drive_item_id)
        }
      }

      // Collect unmatched parents (sub-folders) for grandparent lookup
      for (const pid of directParentIds) {
        if (!matchedIds.has(pid)) unmatchedParentIds.push(pid)
      }
    }

    // Grandparent lookup: fetch parent of sub-folders to find case root
    if (unmatchedParentIds.length > 0) {
      const token = await getGraphToken()
      const grandparentIds = new Set<string>()
      const toFetch = unmatchedParentIds.slice(0, MAX_PARENT_LOOKUPS)

      await Promise.allSettled(
        toFetch.map(async pid => {
          try {
            const res = await fetch(
              `${GRAPH_BASE}/drives/${driveId}/items/${pid}?$select=id,parentReference`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            if (res.ok) {
              const item = await res.json()
              if (item.parentReference?.id) grandparentIds.add(item.parentReference.id as string)
            }
          } catch {
            // best-effort
          }
        })
      )

      if (grandparentIds.size > 0) {
        const { data: gpCases } = await db
          .from('cases')
          .select('id, sharepoint_drive_item_id')
          .in('sharepoint_drive_item_id', [...grandparentIds])
          .eq('is_deleted', false)

        for (const c of gpCases ?? []) {
          if (c.sharepoint_drive_item_id) casesToSync.set(c.id, c.sharepoint_drive_item_id)
        }
      }
    }

    console.log(`[sharepoint-delta] syncing ${casesToSync.size} case(s)`)

    // ── Sync each affected case ───────────────────────────────────────────
    let casesSynced = 0
    let errors      = 0

    for (const [caseId, driveItemId] of casesToSync) {
      try {
        await syncCaseFiles(client, caseId, driveItemId, driveId)
        casesSynced++
        console.log(`[sharepoint-delta] synced case ${caseId}`)
      } catch (err) {
        errors++
        console.error(`[sharepoint-delta] sync error for case ${caseId}:`, err)
      }
    }

    return {
      initialized:  false,
      changedItems: items.length,
      casesFound:   casesToSync.size,
      casesSynced,
      errors,
      newDeltaLink,
      durationMs:   Date.now() - t0,
    }
  } catch (err) {
    if (err instanceof DeltaLinkExpiredError) {
      // Clear the expired link — next run will reinitialize from latest
      console.warn('[sharepoint-delta] deltaLink expired — clearing for reinitialization')
      await db.from('sync_state').upsert(
        { key: DELTA_LINK_KEY, value: null, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
      return {
        initialized:  false,
        changedItems: 0,
        casesFound:   0,
        casesSynced:  0,
        errors:       1,
        newDeltaLink: null,
        durationMs:   Date.now() - t0,
      }
    }
    throw err
  }
}
