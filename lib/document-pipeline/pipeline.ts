// ─────────────────────────────────────────────────────────────────────────────
// Document Pipeline — Canonical Entry Point
//
// processDocument() is THE single function both cron and webhook paths call.
// Trigger source does not matter here — file metadata and case_id are all
// this function needs.
//
// Pipeline stages (Phase 1 active, 2-4 stubbed):
//   ingest → classify → [extract] → [qualify] → [summarize]
//
// Idempotency:
//   - Files are upserted by (case_id, sharepoint_item_id).
//   - If the file exists and modified_at_source is unchanged → skip (unless force=true).
//   - If modified → re-ingest and re-run all stages.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

// Using a flexible type since .schema() returns a PostgrestClient, not SupabaseClient
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
import { classifyDocument } from './classify'
import { extractDocument } from './extract'
import { qualifyCase } from './qualify'
import { summarizeCase } from './summarize'
import {
  AUTO_CLASSIFY_CONFIDENCE_THRESHOLD,
  type ProcessDocumentInput,
  type ProcessDocumentResult,
  type PipelineAction,
  type ClassificationResult,
} from './types'

// ── Supabase client factory ───────────────────────────────────────────────────

function getDb(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key).schema('core')
}

// ── Stage 1: Ingest — upsert file record ─────────────────────────────────────

async function ingestFile(
  db: Db,
  case_id: string,
  file: ProcessDocumentInput['file'],
  force: boolean,
): Promise<{ id: string; action: PipelineAction; alreadyClassified: boolean }> {
  // Check if this file already exists
  const { data: existing } = await db
    .from('document_files')
    .select('id, modified_at_source, is_classified, checklist_item_id')
    .eq('case_id', case_id)
    .eq('sharepoint_item_id', file.sharepoint_item_id)
    .single()

  if (existing && !force) {
    const unchanged =
      existing.modified_at_source === file.modified_at_source ||
      !file.modified_at_source

    if (unchanged) {
      return { id: existing.id, action: 'skipped', alreadyClassified: existing.is_classified }
    }
  }

  const payload = {
    case_id,
    sharepoint_item_id: file.sharepoint_item_id,
    sharepoint_drive_id: file.sharepoint_drive_id,
    name: file.name,
    file_extension: file.file_extension,
    size_bytes: file.size_bytes,
    mime_type: file.mime_type,
    web_url: file.web_url,
    download_url: file.download_url,
    created_at_source: file.created_at_source,
    modified_at_source: file.modified_at_source,
    created_by: file.created_by,
    modified_by: file.modified_by,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    // File changed — update metadata, reset classification so it re-runs
    const { data, error } = await db
      .from('document_files')
      .update({
        ...payload,
        // Reset classification so pipeline re-evaluates
        is_classified: false,
        checklist_item_id: null,
        document_type_code: null,
        classified_by: null,
        classified_at: null,
        classification_source: null,
      })
      .eq('id', existing.id)
      .select('id')
      .single()

    if (error) throw new Error(`ingest update failed: ${error.message}`)
    return { id: data.id, action: 'updated', alreadyClassified: false }
  }

  // New file
  const { data, error } = await db
    .from('document_files')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw new Error(`ingest insert failed: ${error.message}`)
  return { id: data.id, action: 'created', alreadyClassified: false }
}

// ── Stage 2: Classify — link file to checklist item ──────────────────────────

async function applyClassification(
  db: Db,
  case_id: string,
  document_id: string,
  classification: ClassificationResult,
): Promise<void> {
  const now = new Date().toISOString()

  // Find the checklist item for this doc type on this case
  const { data: checklistItem, error: clErr } = await db
    .from('case_document_checklist')
    .select('id, status')
    .eq('case_id', case_id)
    .eq('document_type_code', classification.document_type_code)
    .single()

  if (clErr || !checklistItem) {
    // No checklist item for this type — mark classified but don't link
    // (shouldn't happen if init-case-checklist ran, but handle gracefully)
    await db.from('document_files').update({
      is_classified: true,
      document_type_code: classification.document_type_code,
      classified_at: now,
      classified_by: `pipeline:${classification.source}`,
      classification_source: classification.source,
      updated_at: now,
    }).eq('id', document_id)
    return
  }

  // Link file to checklist item
  await db.from('document_files').update({
    checklist_item_id: checklistItem.id,
    document_type_code: classification.document_type_code,
    is_classified: true,
    classified_at: now,
    classified_by: `pipeline:${classification.source}`,
    classification_source: classification.source,
    updated_at: now,
  }).eq('id', document_id)

  // Advance checklist status to 'received' (only if it's still required/requested)
  if (['required', 'requested'].includes(checklistItem.status)) {
    await db.from('case_document_checklist').update({
      status: 'received',
      received_at: now,
      updated_at: now,
      updated_by: `pipeline:${classification.source}`,
    }).eq('id', checklistItem.id)
  }
}

// ── Canonical pipeline entry point ───────────────────────────────────────────

/**
 * Process a single document through the full pipeline.
 *
 * Called by:
 *   - scripts/sync-sharepoint-docs.ts (cron trigger)
 *   - app/api/webhooks/sharepoint/route.ts (future webhook trigger)
 *
 * Both callers pass the same ProcessDocumentInput shape. The pipeline
 * logic here is completely trigger-agnostic.
 */
export async function processDocument(
  input: ProcessDocumentInput,
): Promise<ProcessDocumentResult> {
  const { case_id, file, force = false } = input
  const db = getDb()

  const reviewReasons: string[] = []

  // ── Stage 1: Ingest ────────────────────────────────────────────────────────
  const { id: document_id, action, alreadyClassified } = await ingestFile(
    db, case_id, file, force,
  )

  if (action === 'skipped') {
    return {
      document_id,
      action: 'skipped',
      classification: null,
      extraction: null,
      qualification: null,
      summary: null,
      needs_review: false,
      review_reasons: [],
    }
  }

  // Don't reclassify if already manually classified (alreadyClassified=true only
  // when action=skipped, but guard here for safety)
  if (alreadyClassified && !force) {
    return {
      document_id,
      action,
      classification: null,
      extraction: null,
      qualification: null,
      summary: null,
      needs_review: false,
      review_reasons: [],
    }
  }

  // ── Stage 2: Classify ──────────────────────────────────────────────────────
  const classification = await classifyDocument(file.name, file.mime_type)

  if (!classification) {
    reviewReasons.push('No classification rule matched — manual review required')
  } else if (classification.confidence < AUTO_CLASSIFY_CONFIDENCE_THRESHOLD) {
    reviewReasons.push(
      `Classification confidence ${(classification.confidence * 100).toFixed(0)}% is below threshold — manual review recommended`,
    )
  }

  // Apply classification if confidence is sufficient
  if (classification && classification.confidence >= AUTO_CLASSIFY_CONFIDENCE_THRESHOLD) {
    await applyClassification(db, case_id, document_id, classification)
  } else if (classification) {
    // Low confidence — store the suggestion but don't auto-link
    const now = new Date().toISOString()
    await db.from('document_files').update({
      document_type_code: classification.document_type_code, // suggestion only
      classification_source: classification.source,
      updated_at: now,
    }).eq('id', document_id)
  }

  // ── Stage 3: Extract (Phase 2 stub) ───────────────────────────────────────
  const extraction = classification
    ? await extractDocument(file, classification)
    : null

  // ── Stage 4: Qualify (Phase 3 stub) ───────────────────────────────────────
  const qualification = await qualifyCase(case_id)

  // ── Stage 5: Summarize (Phase 4 stub) ─────────────────────────────────────
  const summary = await summarizeCase(case_id, extraction, qualification)

  return {
    document_id,
    action,
    classification,
    extraction,
    qualification,
    summary,
    needs_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
  }
}
