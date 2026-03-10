// ─────────────────────────────────────────────────────────────────────────────
// Document Pipeline — Extraction Stage (Phase 2 stub)
//
// Phase 1: no-op. Returns null so the pipeline continues cleanly.
// Phase 2: PDF text extraction → per-type field parsing.
//   - Repair order  → repair date, mileage, symptoms, work performed, days in shop
//   - Purchase agreement → purchase date, price, new/used, dealer
//   - Warranty doc  → coverage start, expiry, scope
//   - Client ID     → name validation
// Phase 3: OCR via Azure Document Intelligence for scanned/image PDFs.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, ExtractionResult, SharePointFile } from './types'

/**
 * Extract structured fields from a document.
 * Phase 1: stub — returns null.
 */
export async function extractDocument(
  _file: SharePointFile,
  _classification: ClassificationResult,
): Promise<ExtractionResult | null> {
  // TODO Phase 2: implement per document_type_code
  return null
}
