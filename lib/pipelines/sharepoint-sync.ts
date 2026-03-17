// ─────────────────────────────────────────────────────────────────────────────
// SharePoint Sync Pipeline
//
// Syncs files from a case's SharePoint folder into core.document_files.
// Called by:
//   - POST /api/webhooks/sharepoint  (real-time, per-changed-case)
//   - POST /api/admin/sharepoint/sync-case  (manual trigger per case)
//   - scripts/backfill-sharepoint.ts  (one-time historical backfill)
//
// Idempotent — safe to call multiple times for the same case.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveSharePointUrl,
  listCaseFiles,
  DOCUMENTS_DRIVE_ID,
} from '@/lib/sharepoint'
import { classifyDocument } from '@/lib/document-pipeline/classify'
import { AUTO_CLASSIFY_CONFIDENCE_THRESHOLD } from '@/lib/document-pipeline/types'

export interface SyncCaseFilesResult {
  caseId:          string
  driveItemId:     string | null
  filesFound:      number
  inserted:        number
  updated:         number
  skipped:         number
  errors:          number
  errorMessages:   string[]
}

// ── Resolve and store the SharePoint folder ID for a case ─────────────────────
export async function resolveCaseFolder(
  client: SupabaseClient,
  caseId: string,
  sharingUrl: string,
): Promise<{ driveItemId: string; driveId: string } | null> {
  const resolved = await resolveSharePointUrl(sharingUrl)
  if (!resolved) return null

  // Store the resolved item ID so the webhook can look it up later
  await client.schema('core')
    .from('cases')
    .update({
      sharepoint_drive_item_id: resolved.itemId,
      sharepoint_synced_at:     new Date().toISOString(),
    })
    .eq('id', caseId)

  return { driveItemId: resolved.itemId, driveId: resolved.driveId }
}

// ── Sync all files for a single case ─────────────────────────────────────────
export async function syncCaseFiles(
  client:      SupabaseClient,
  caseId:      string,
  driveItemId: string,
  driveId  = DOCUMENTS_DRIVE_ID,
): Promise<SyncCaseFilesResult> {
  const result: SyncCaseFilesResult = {
    caseId, driveItemId,
    filesFound: 0, inserted: 0, updated: 0, skipped: 0, errors: 0, errorMessages: [],
  }

  const db = client.schema('core')

  let files
  try {
    files = await listCaseFiles(driveItemId, driveId)
  } catch (err) {
    result.errors++
    result.errorMessages.push(`listCaseFiles: ${err}`)
    return result
  }

  result.filesFound = files.length
  const now = new Date().toISOString()

  for (const file of files) {
    try {
      // Check existing record
      const { data: existing } = await db
        .from('document_files')
        .select('id, modified_at_source, is_classified')
        .eq('case_id', caseId)
        .eq('sharepoint_item_id', file.sharepoint_item_id)
        .maybeSingle()

      if (existing) {
        const unchanged = existing.modified_at_source === file.modified_at_source

        // Re-classify if still unclassified (even if file hasn't changed)
        // Use !existing.is_classified (not === false) to catch null values from older rows
        if (unchanged && !existing.is_classified) {
          const reclassification = await classifyDocument(file.name, file.mime_type)
          const autoClassified = reclassification &&
            reclassification.confidence >= AUTO_CLASSIFY_CONFIDENCE_THRESHOLD
          if (autoClassified && reclassification) {
            await db.from('document_files').update({
              document_type_code:    reclassification.document_type_code,
              classification_source: reclassification.source,
              is_classified:         true,
              classified_at:         now,
              updated_at:            now,
            }).eq('id', existing.id)
            result.updated++
          } else {
            result.skipped++
          }
          continue
        }

        // Skip if unchanged and already classified
        if (unchanged) {
          result.skipped++
          continue
        }

        // File changed — update metadata, reset classification
        const { error: updateErr } = await db.from('document_files').update({
          file_name:          file.name,           // DB column is file_name
          file_extension:     file.file_extension,
          size_bytes:         file.size_bytes,
          mime_type:          file.mime_type,
          web_url:            file.web_url,
          download_url:       file.download_url,
          modified_at_source: file.modified_at_source,
          created_by_name:    file.created_by,
          modified_by_name:   file.modified_by,
          synced_at:          now,
          updated_at:         now,
          // Reset classification only if not manually classified
          ...(existing.is_classified === false ? {
            document_type_code:    null,
            classification_source: null,
            is_classified:         false,
          } : {}),
        }).eq('id', existing.id)
        if (updateErr) throw new Error(updateErr.message)
        result.updated++
        continue
      }

      // New file — classify and insert
      const classification = await classifyDocument(file.name, file.mime_type)
      const autoClassified = classification &&
        classification.confidence >= AUTO_CLASSIFY_CONFIDENCE_THRESHOLD

      // Find checklist item if classifiable
      let checklistItemId: string | null = null
      if (autoClassified && classification) {
        const { data: cli } = await db
          .from('case_document_checklist')
          .select('id, status')
          .eq('case_id', caseId)
          .eq('document_type_code', classification.document_type_code)
          .maybeSingle()

        if (cli) {
          checklistItemId = cli.id
          // Advance checklist item to 'received' if still pending
          if (['required', 'requested'].includes(cli.status)) {
            await db.from('case_document_checklist').update({
              status:      'received',
              received_at: now,
              updated_at:  now,
              updated_by:  `pipeline:${classification.source}`,
            }).eq('id', cli.id)
          }
        }
      }

      const { error: insertErr } = await db.from('document_files').insert({
        case_id:               caseId,
        sharepoint_item_id:    file.sharepoint_item_id,
        sharepoint_drive_id:   file.sharepoint_drive_id,
        source:                'sharepoint',
        file_name:             file.name,          // DB column is file_name
        file_extension:        file.file_extension,
        size_bytes:            file.size_bytes,
        mime_type:             file.mime_type,
        web_url:               file.web_url,
        download_url:          file.download_url,
        created_at_source:     file.created_at_source,
        modified_at_source:    file.modified_at_source,
        created_by_name:       file.created_by,
        modified_by_name:      file.modified_by,
        // Classification — classified_by is UUID FK; leave null for auto-classification
        document_type_code:    autoClassified ? classification!.document_type_code : null,
        classification_source: autoClassified ? classification!.source : null,
        is_classified:         autoClassified ?? false,
        classified_at:         autoClassified ? now : null,
        classified_by:         null,               // UUID FK — not applicable for pipeline
        checklist_item_id:     checklistItemId,
        // State
        is_deleted:  false,
        synced_at:   now,
        created_at:  now,
        updated_at:  now,
      })

      if (insertErr) throw new Error(insertErr.message)
      result.inserted++
    } catch (err) {
      result.errors++
      result.errorMessages.push(`${file.name}: ${err}`)
    }
  }

  // Update sharepoint_synced_at on the case
  await client.schema('core')
    .from('cases')
    .update({ sharepoint_synced_at: now })
    .eq('id', caseId)

  return result
}

// ── Full sync for a case: resolve URL → sync files ────────────────────────────
export async function syncCaseByUrl(
  client:      SupabaseClient,
  caseId:      string,
  sharingUrl:  string,
): Promise<SyncCaseFilesResult> {
  // Resolve folder if we don't have a driveItemId yet
  const folder = await resolveCaseFolder(client, caseId, sharingUrl)
  if (!folder) {
    return {
      caseId, driveItemId: null,
      filesFound: 0, inserted: 0, updated: 0, skipped: 0,
      errors: 1, errorMessages: ['Failed to resolve SharePoint sharing URL'],
    }
  }

  return syncCaseFiles(client, caseId, folder.driveItemId, folder.driveId)
}
