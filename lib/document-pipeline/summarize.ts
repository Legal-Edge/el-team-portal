// ─────────────────────────────────────────────────────────────────────────────
// Document Pipeline — Summary Stage (Phase 4 stub)
//
// Phase 1: no-op. Returns null so the pipeline continues cleanly.
// Phase 4: AI-generated staff-facing case summary.
//   Input:  case data + extracted evidence + qualification result
//   Output: human-readable summary of what the documents mean and what
//           happens next — e.g.:
//   "5 repair orders show the same transmission defect across 4 visits,
//    totalling 47 days in shop. Vehicle is within warranty. Manufacturer
//    was notified. Case meets lemon law threshold in TX.
//    Recommended next step: demand letter."
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtractionResult, QualificationResult } from './types'

/**
 * Generate an AI summary for a case after extraction and qualification.
 * Phase 1: stub — returns null.
 */
export async function summarizeCase(
  _case_id: string,
  _extraction: ExtractionResult | null,
  _qualification: QualificationResult | null,
): Promise<string | null> {
  // TODO Phase 4: compose case context and call LLM
  return null
}
