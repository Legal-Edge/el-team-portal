// ─────────────────────────────────────────────────────────────────────────────
// Document Pipeline — Classification Stage
//
// Rule-based classification covers ~90% of lemon law document names.
// AI fallback stub is wired for Phase 2 expansion.
//
// Design intent: this module is stateless and pure. Pass in a filename,
// get back a ClassificationResult (or null if unclassifiable).
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult } from './types'

interface ClassificationRule {
  /** Regex tested against the lowercased filename (without extension) */
  pattern: RegExp
  code: string
  confidence: number
  /** Human-readable description of why this rule matched — for debugging */
  label: string
}

// Rules are ordered highest-confidence first.
// When multiple rules match, the first one wins.
const RULES: ClassificationRule[] = [
  // ── Repair Orders ──────────────────────────────────────────────────────────
  // "RO" as a standalone word, or "repair order(s)" in full
  {
    pattern: /\bro\b|\brepair[\s_-]?orders?\b/i,
    code: 'repair_order',
    confidence: 0.97,
    label: 'Repair order keyword',
  },

  // ── Purchase / Lease Agreement ────────────────────────────────────────────
  {
    pattern: /lease[\s_-]?agreement|purchase[\s_-]?agreement|sales[\s_-]?contract|bill[\s_-]?of[\s_-]?sale|retail[\s_-]?installment/i,
    code: 'purchase_agreement',
    confidence: 0.97,
    label: 'Purchase or lease agreement keyword',
  },

  // ── Warranty Documentation ────────────────────────────────────────────────
  {
    pattern: /warranty|new[\s_-]?vehicle[\s_-]?limited[\s_-]?warranty/i,
    code: 'warranty_doc',
    confidence: 0.95,
    label: 'Warranty keyword',
  },

  // ── Odometer Disclosure ───────────────────────────────────────────────────
  {
    pattern: /odometer/i,
    code: 'odometer_disclosure',
    confidence: 0.97,
    label: 'Odometer keyword',
  },

  // ── Client ID / Driver's License ──────────────────────────────────────────
  {
    pattern: /driver[\s_'-]?s[\s_-]?licen|driver[\s_-]?license|\bdl\b|photo[\s_-]?id|client[\s_-]?id|identification|license[\s_-]?plate.*id|plate\s+number.*licen/i,
    code: 'client_id',
    confidence: 0.93,
    label: 'Client ID / license keyword',
  },

  // ── Diagnostic Report ─────────────────────────────────────────────────────
  {
    pattern: /diagnostic|fault[\s_-]?code|dtc|scan[\s_-]?report/i,
    code: 'diagnostic_report',
    confidence: 0.93,
    label: 'Diagnostic report keyword',
  },

  // ── Loaner / Rental Records ───────────────────────────────────────────────
  {
    pattern: /loaner|loaner[\s_-]?vehicle|rental[\s_-]?agreement/i,
    code: 'loaner_records',
    confidence: 0.93,
    label: 'Loaner vehicle keyword',
  },

  // ── Payment / Repair Invoices ─────────────────────────────────────────────
  {
    pattern: /receipt|payment[\s_-]?record|repair[\s_-]?invoice|out[\s_-]?of[\s_-]?pocket/i,
    code: 'payment_records',
    confidence: 0.90,
    label: 'Payment record keyword',
  },

  // ── Photos of Defects ─────────────────────────────────────────────────────
  {
    pattern: /photo|picture|image|defect[\s_-]?photo|damage[\s_-]?photo/i,
    code: 'photos',
    confidence: 0.85,
    label: 'Photo keyword',
  },

  // ── Manufacturer Correspondence ───────────────────────────────────────────
  // Match known manufacturer names + generic "corporate" / "manufacturer"
  {
    pattern: /manufacturer[\s_-]?letter|manufacturer[\s_-]?correspondence|from[\s_-]?(gm|ford|bmw|toyota|honda|mazda|hyundai|kia|volkswagen|vw|stellantis|fca|chrysler|dodge|jeep|ram|nissan|subaru|volvo|mercedes|audi|lexus|acura|infiniti|cadillac|chevrolet|chevy|buick|gmc)/i,
    code: 'manufacturer_correspondence',
    confidence: 0.88,
    label: 'Manufacturer correspondence keyword',
  },

  // ── Dealer Correspondence ─────────────────────────────────────────────────
  {
    pattern: /dealer[\s_-]?letter|dealer[\s_-]?correspondence|from[\s_-]?dealer|dealership[\s_-]?response/i,
    code: 'dealer_correspondence',
    confidence: 0.88,
    label: 'Dealer correspondence keyword',
  },
]

// ── Rule-based classifier ─────────────────────────────────────────────────────

/**
 * Classify a file by its name using pattern matching.
 * Returns null if no rule matched with sufficient signal.
 */
export function classifyByRules(filename: string): ClassificationResult | null {
  // Strip path and extension; lowercase for matching
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase()

  for (const rule of RULES) {
    const match = base.match(rule.pattern)
    if (match) {
      return {
        document_type_code: rule.code,
        confidence: rule.confidence,
        source: 'rule',
        matched_pattern: rule.label,
      }
    }
  }

  return null
}

// ── AI fallback classifier (Phase 2 stub) ─────────────────────────────────────

/**
 * Classify using an AI model when rule-based classification fails or is
 * below the confidence threshold.
 *
 * Phase 2: implement using OpenAI / Anthropic with filename + first-page text.
 * Phase 1: returns null — file lands in unclassified queue for staff review.
 */
export async function classifyByAI(
  _filename: string,
  _mimeType: string | null,
): Promise<ClassificationResult | null> {
  // TODO Phase 2: extract first-page text from PDF and send to LLM with
  // the document type catalog. Return structured ClassificationResult.
  return null
}

// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Classify a file — rule-based first, AI fallback if rules produce no result.
 */
export async function classifyDocument(
  filename: string,
  mimeType: string | null,
): Promise<ClassificationResult | null> {
  const ruleResult = classifyByRules(filename)
  if (ruleResult) return ruleResult

  // Rule-based produced no match — try AI
  return classifyByAI(filename, mimeType)
}
