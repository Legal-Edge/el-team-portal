// ─────────────────────────────────────────────────────────────────────────────
// Document Pipeline — Shared Types
//
// These types flow through every stage: ingest → classify → extract →
// qualify → summarize. Both cron (scripts/sync-sharepoint-docs.ts) and the
// future SharePoint webhook route import from here.
// ─────────────────────────────────────────────────────────────────────────────

// ── File metadata as received from SharePoint Graph API ──────────────────────
export interface SharePointFile {
  sharepoint_item_id: string
  sharepoint_drive_id: string
  name: string
  file_extension: string | null
  size_bytes: number | null
  mime_type: string | null
  web_url: string | null
  download_url: string | null
  created_at_source: string | null
  modified_at_source: string | null
  created_by: string | null
  modified_by: string | null
}

// ── Input to processDocument() — the canonical pipeline entry point ───────────
export interface ProcessDocumentInput {
  /** Supabase case UUID */
  case_id: string
  /** HubSpot deal ID — for logging and context */
  hubspot_deal_id: string
  /** File metadata from SharePoint */
  file: SharePointFile
  /**
   * Force reprocessing even if the file hasn't changed.
   * Use for reruns and debugging; cron and webhooks should NOT set this.
   */
  force?: boolean
}

// ── Per-stage results ─────────────────────────────────────────────────────────

export type ClassificationSource = 'rule' | 'ai' | 'manual'

export interface ClassificationResult {
  document_type_code: string
  confidence: number          // 0–1
  source: ClassificationSource
  matched_pattern?: string    // debug: which rule matched
}

/** Phase 2 — PDF text extraction and structured field parsing */
export interface ExtractionResult {
  fields: Record<string, unknown>
  confidence: number
  method: 'text' | 'ocr' | 'ai'
}

/** Phase 3 — Lemon law qualification scoring */
export interface QualificationResult {
  flags: string[]             // e.g. ['same_defect_2x', 'in_shop_30_days']
  score: number               // 0–1
  meets_threshold: boolean
}

// ── Pipeline result returned from processDocument() ──────────────────────────
export type PipelineAction = 'created' | 'updated' | 'skipped'

export interface ProcessDocumentResult {
  document_id: string
  action: PipelineAction
  classification: ClassificationResult | null
  extraction: ExtractionResult | null     // Phase 2
  qualification: QualificationResult | null // Phase 3
  summary: string | null                  // Phase 4
  needs_review: boolean
  review_reasons: string[]
}

// ── Review thresholds ─────────────────────────────────────────────────────────
/** Minimum classification confidence to auto-link without staff review */
export const AUTO_CLASSIFY_CONFIDENCE_THRESHOLD = 0.85
