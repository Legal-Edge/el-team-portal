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
import { extractDocument }  from '@/lib/document-pipeline/extract'
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

        // File changed (or re-uploaded after deletion) — update metadata + restore if deleted
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
          is_deleted:         false,               // restore if previously soft-deleted
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

        // Re-extract text for changed file
        void runExtraction(db, existing.id, file)

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

      // Extract text for new file (fire-and-forget — don't block the sync loop)
      const { data: newRow } = await db
        .from('document_files')
        .select('id')
        .eq('case_id', caseId)
        .eq('sharepoint_item_id', file.sharepoint_item_id)
        .maybeSingle()
      if (newRow?.id) void runExtraction(db, newRow.id, file)

      result.inserted++
    } catch (err) {
      result.errors++
      result.errorMessages.push(`${file.name}: ${err}`)
    }
  }

  // ── Stale file cleanup ────────────────────────────────────────────────────
  // Any document_files row for this case whose sharepoint_item_id is NOT in
  // the current SharePoint listing was deleted in SharePoint — mark is_deleted.
  const currentItemIds = new Set(files.map(f => f.sharepoint_item_id))

  const { data: existingRows } = await db
    .from('document_files')
    .select('id, sharepoint_item_id')
    .eq('case_id', caseId)
    .eq('is_deleted', false)

  const staleIds = (existingRows ?? [])
    .filter(r => !currentItemIds.has(r.sharepoint_item_id))
    .map(r => r.id)

  if (staleIds.length > 0) {
    await db
      .from('document_files')
      .update({ is_deleted: true, updated_at: now })
      .in('id', staleIds)
    console.log(`[sharepoint-sync] soft-deleted ${staleIds.length} stale file(s) for case ${caseId}`)
  }

  // Touch hubspot_synced_at to trigger SSE stream → live UI refresh in Documents tab
  // Also update sharepoint_synced_at for tracking
  await client.schema('core')
    .from('cases')
    .update({
      sharepoint_synced_at: now,
      hubspot_synced_at:    now,   // fires Supabase Realtime → SSE → DocumentsSection reload
    })
    .eq('id', caseId)

  return result
}

// ── Text extraction helper ────────────────────────────────────────────────────
// Fire-and-forget: downloads the file and stores extracted_text on the DB row.
// Called after insert/update; doesn't block the sync loop.

async function runExtraction(
  db:          ReturnType<SupabaseClient['schema']>,
  documentId:  string,
  file:        Parameters<typeof extractDocument>[0],
): Promise<void> {
  try {
    // We need a stub classification to call extractDocument (method dispatch only)
    const stubClassification = {
      document_type_code:  'unknown',
      confidence:           1.0,
      source:               'rule' as const,
    }
    const result = await extractDocument(file, stubClassification)
    if (!result) return  // unsupported format or empty

    const rawText = typeof result.fields.raw_text === 'string'
      ? result.fields.raw_text
      : null
    if (!rawText) return

    await db.from('document_files').update({
      extracted_text: rawText,
      updated_at:     new Date().toISOString(),
    }).eq('id', documentId)

    console.log(`[sharepoint-sync] extracted text for ${documentId} (${rawText.length} chars)`)
  } catch (err) {
    console.error(`[sharepoint-sync] extraction error for ${documentId}:`, err)
  }
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
