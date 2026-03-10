// ─────────────────────────────────────────────────────────────────────────────
// Document Pipeline — Qualification Stage (Phase 3 stub)
//
// Phase 1: no-op. Returns null so the pipeline continues cleanly.
// Phase 3: runs lemon law criteria against all accumulated case evidence.
//   Flags:
//   - same_defect_2x         → same defect repaired 2+ times under warranty
//   - in_shop_30_days        → cumulative days in shop ≥ 30
//   - within_lemon_law_window → within 18 months / 18k miles
//   - manufacturer_notified  → manufacturer was contacted
// ─────────────────────────────────────────────────────────────────────────────

import type { QualificationResult } from './types'

/**
 * Run lemon law qualification logic for a case.
 * Phase 1: stub — returns null.
 */
export async function qualifyCase(
  _case_id: string,
): Promise<QualificationResult | null> {
  // TODO Phase 3: query core.case_document_evidence for all extracted data
  // and evaluate against lemon law thresholds by state_jurisdiction
  return null
}
