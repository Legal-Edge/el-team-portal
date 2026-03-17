// ─────────────────────────────────────────────────────────────────────────────
// Two-Stage AI Document Analysis Pipeline
//
// Stage 1 — Haiku extraction (per document, runs on first open, cached)
//   extractDocument(pdfBytes, docType) → structured JSON
//
// Stage 2 — Sonnet case analysis (on demand, reads cached extractions)
//   analyzeCaseDocuments(extractions[], caseContext) → case-level findings
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { createClient } from '@supabase/supabase-js'

export const EXTRACTION_MODEL = 'claude-haiku-4-5'
export const ANALYSIS_MODEL   = 'claude-sonnet-4-20250514'

import { runLemonLawEngine } from '../lemon-law/engine'
import type { EngineInput, RepairRecord } from '../lemon-law/types'

// ── State lemon law thresholds ────────────────────────────────────────────
const STATE_LAW: Record<string, string> = {
  CA: 'California (Song-Beverly): 4 repair attempts for same defect, OR 2 for safety defect, OR 30+ days out of service — within 18 months/18,000 miles.',
  TX: 'Texas: 4 repair attempts, OR 2 for serious safety hazard, OR 30+ days out of service — within 24 months/24,000 miles.',
  FL: 'Florida: 3 repair attempts, OR 15+ days out of service — within 24 months/24,000 miles.',
  NY: 'New York: 4 repair attempts, OR 30+ days out of service — within 24 months/18,000 miles.',
  WA: 'Washington: 4 repair attempts, OR 30+ days out of service — within 24 months/24,000 miles.',
  IL: 'Illinois: 4 repair attempts, OR 30+ days out of service — within 12 months/12,000 miles.',
  AZ: 'Arizona: 4 repair attempts, OR 30+ days out of service — within 24 months/24,000 miles.',
  CO: 'Colorado: 4 repair attempts, OR 30+ days out of service — within 1 year.',
  NJ: 'New Jersey: 3 repair attempts (1 for life-threatening defect), OR 20+ days out of service — within 24 months/18,000 miles.',
  GA: 'Georgia: 3 repair attempts, OR 30+ days out of service — within 24 months/24,000 miles.',
  DEFAULT: 'Federal Magnuson-Moss: 3–4 reasonable repair attempts for same defect, or substantial time out of service.',
}

function getStateLaw(state?: string | null) {
  return STATE_LAW[(state ?? '').toUpperCase().trim()] ?? STATE_LAW.DEFAULT
}

// ── Knowledge base loader ─────────────────────────────────────────────────
interface KbEntry { title: string; content: string }

async function loadKnowledge(
  stage:   'extraction' | 'analysis',
  docType: string | null,
): Promise<string> {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ).schema('core')

    const { data } = await db
      .from('ai_knowledge_base')
      .select('title, content')
      .eq('is_active', true)
      .contains('applies_to', [stage])
      .or(docType ? `doc_types.is.null,doc_types.cs.{"${docType}"}` : 'doc_types.is.null')
      .order('sort_order', { ascending: true })

    if (!data || data.length === 0) return ''
    return '\n\n## KNOWLEDGE BASE — RULES TO FOLLOW:\n' +
      (data as KbEntry[]).map(e => `### ${e.title}\n${e.content}`).join('\n\n')
  } catch {
    return '' // non-blocking if KB unavailable
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────
function parseJson(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/)
  try { return match ? JSON.parse(match[0]) : { raw: text } }
  catch { return { raw: text } }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — Haiku extraction
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPTS: Record<string, string> = {
  repair_order: `Extract the following fields from this repair order. Return ONLY valid JSON, no other text.
{
  "doc_type": "repair_order",
  "ro_number": string | null,
  "dealer_name": string | null,
  "repair_date_in": "YYYY-MM-DD" | null,
  "repair_date_out": "YYYY-MM-DD" | null,
  "days_in_shop": number | null,
  "mileage_in": number | null,
  "mileage_out": number | null,
  "vin": string | null,
  "complaint": string | null,
  "diagnosis": string | null,
  "work_performed": string | null,
  "repair_status": "completed" | "unable_to_duplicate" | "parts_on_order" | "customer_declined" | "other",
  "warranty_repair": boolean | null,
  "labor_hours": number | null
}`,

  purchase_agreement: `Extract the following fields from this purchase or lease agreement. Return ONLY valid JSON, no other text.
{
  "doc_type": "purchase_agreement",
  "dealer_name": string | null,
  "purchase_date": "YYYY-MM-DD" | null,
  "vehicle_year": number | null,
  "vehicle_make": string | null,
  "vehicle_model": string | null,
  "vin": string | null,
  "purchase_price": number | null,
  "is_lease": boolean,
  "monthly_payment": number | null,
  "warranty_type": string | null,
  "down_payment": number | null
}`,

  vehicle_registration: `Extract the following fields from this vehicle registration. Return ONLY valid JSON, no other text.
{
  "doc_type": "vehicle_registration",
  "registration_date": "YYYY-MM-DD" | null,
  "expiration_date": "YYYY-MM-DD" | null,
  "vehicle_year": number | null,
  "vehicle_make": string | null,
  "vehicle_model": string | null,
  "vin": string | null,
  "license_plate": string | null,
  "registered_state": string | null,
  "owner_name": string | null
}`,

  default: `Extract all key facts from this document. Return ONLY valid JSON, no other text.
{
  "doc_type": "other",
  "document_description": string,
  "key_dates": string[],
  "key_facts": string[],
  "vin": string | null,
  "vehicle_info": string | null,
  "dealer_name": string | null
}`,
}

export async function extractDocument(
  pdfBytes: ArrayBuffer,
  docType:  string | null,
): Promise<{ extraction: Record<string, unknown>; model: string }> {
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt    = EXTRACTION_PROMPTS[docType ?? ''] ?? EXTRACTION_PROMPTS.default
  const base64Pdf = Buffer.from(pdfBytes).toString('base64')
  const knowledge = await loadKnowledge('extraction', docType)

  const response = await client.beta.messages.create({
    model:      EXTRACTION_MODEL,
    max_tokens: 800,
    system:     `You are a document extraction assistant for a lemon law firm. Extract structured data from legal/automotive documents. Return ONLY valid JSON.${knowledge}`,
    messages: [{
      role:    'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } } as BetaContentBlockParam,
        { type: 'text', text: prompt } as BetaContentBlockParam,
      ],
    }],
    betas: ['pdfs-2024-09-25'],
  })

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
  const extraction = parseJson(text)

  // ── VIN validation + targeted re-prompt ─────────────────────────────────
  // VIN must be exactly 17 chars, no I/O/Q. If Haiku returns an invalid VIN,
  // do a targeted second call asking only for the VIN to avoid character misreads.
  const vinRaw = extraction.vin
  if (vinRaw && typeof vinRaw === 'string') {
    const vinClean = vinRaw.replace(/\s/g, '').toUpperCase()
    const VIN_RE   = /^[A-HJ-NPR-Z0-9]{17}$/
    if (!VIN_RE.test(vinClean)) {
      // Invalid VIN — re-prompt specifically for VIN only
      console.warn(`[AI] VIN validation failed: "${vinRaw}" — re-prompting`)
      try {
        const vinRetry = await client.beta.messages.create({
          model:      EXTRACTION_MODEL,
          max_tokens: 100,
          system:     'You are a VIN extraction assistant. Return ONLY the raw 17-character VIN number, nothing else. No JSON, no labels, just the 17 characters.',
          messages: [{
            role:    'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } } as BetaContentBlockParam,
              { type: 'text', text: 'What is the Vehicle Identification Number (VIN) on this document? Return ONLY the 17-character VIN, nothing else.' } as BetaContentBlockParam,
            ],
          }],
          betas: ['pdfs-2024-09-25'],
        })
        const vinResult = vinRetry.content.find(b => b.type === 'text')?.text?.trim().replace(/\s/g, '').toUpperCase() ?? ''
        if (VIN_RE.test(vinResult)) {
          extraction.vin = vinResult
          console.log(`[AI] VIN re-prompt succeeded: "${vinResult}"`)
        } else {
          // Still invalid — null it out and flag for manual review
          console.warn(`[AI] VIN re-prompt also invalid: "${vinResult}" — setting null`)
          extraction.vin = null
          extraction.vin_needs_review = true
        }
      } catch (e) {
        console.error('[AI] VIN re-prompt failed:', e)
        extraction.vin = null
        extraction.vin_needs_review = true
      }
    } else {
      extraction.vin = vinClean  // normalize to uppercase
    }
  }

  return { extraction, model: EXTRACTION_MODEL }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 — Sonnet case analysis
// ─────────────────────────────────────────────────────────────────────────────

export interface CaseContext {
  client_name?: string | null
  vehicle?:     string | null
  state?:       string | null
}

export interface DocExtractionRecord {
  file_name:          string
  document_type_code: string | null
  ai_extraction:      Record<string, unknown>
}

export interface CaseInputContext extends CaseContext {
  purchase_date?:     string | null
  vehicle_year?:      number | null
  vehicle_make?:      string | null
  new_or_used?:       string | null
  purchase_lease?:    string | null
  mileage_at_intake?: number | null
}

export async function analyzeCaseDocuments(
  docs:        DocExtractionRecord[],
  caseContext: CaseInputContext,
): Promise<{ analysis: Record<string, unknown>; model: string }> {
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const knowledge = await loadKnowledge('analysis', null)

  // ── Stage 2a: Run deterministic lemon law engine ───────────────────────
  const repairs: RepairRecord[] = docs
    .filter(d => d.document_type_code === 'repair_order')
    .map(d => {
      const e = d.ai_extraction
      const daysRaw = e.days_in_shop
      const milRaw  = e.mileage_in
      return {
        file_name:       d.file_name,
        repair_date_in:  (e.repair_date_in  as string | null) ?? null,
        repair_date_out: (e.repair_date_out as string | null) ?? null,
        days_in_shop:    typeof daysRaw === 'number' ? daysRaw : null,
        complaint:       (e.complaint       as string | null) ?? null,
        diagnosis:       (e.diagnosis       as string | null) ?? null,
        work_performed:  (e.work_performed  as string | null) ?? null,
        mileage_in:      typeof milRaw === 'number' ? milRaw : null,
        is_warranty:     true,  // assume warranty unless explicitly noted otherwise
      }
    })

  const engineInput: EngineInput = {
    state:            caseContext.state ?? null,
    purchase_date:    caseContext.purchase_date ?? null,
    vehicle_year:     caseContext.vehicle_year ?? null,
    vehicle_make:     caseContext.vehicle_make ?? null,
    new_or_used:      (caseContext.new_or_used as EngineInput['new_or_used']) ?? null,
    purchase_lease:   (caseContext.purchase_lease as EngineInput['purchase_lease']) ?? null,
    repairs,
    mileage_at_intake: caseContext.mileage_at_intake ?? null,
  }

  const engineResult = runLemonLawEngine(engineInput)

  // ── Stage 2b: Sonnet writes the attorney narrative ────────────────────
  const stateLawText = engineResult.state_law
    ? `${engineResult.state_law.name} (${engineResult.state_law.statute}): ${engineResult.state_law.repairAttempts} attempts / ${engineResult.state_law.safetyAttempts} safety / ${engineResult.state_law.daysOOS} days OOS / ${engineResult.state_law.windowMonths}mo or ${engineResult.state_law.windowMiles.toLocaleString()} miles`
    : 'Federal Magnuson-Moss Warranty Act (15 U.S.C. §2301)'

  const engineSummary = JSON.stringify({
    decision:                   engineResult.decision,
    confidence:                 engineResult.confidence,
    cause_of_action:            engineResult.cause_of_action,
    max_attempts_per_defect:    engineResult.max_attempts_per_defect,
    total_days_oos:             engineResult.total_days_oos,
    within_state_window:        engineResult.within_state_window,
    meets_state_repair:         engineResult.meets_state_repair_threshold,
    meets_state_safety:         engineResult.meets_state_safety_threshold,
    meets_state_oos:            engineResult.meets_state_oos_threshold,
    meets_federal:              engineResult.meets_federal_threshold,
    defect_groups:              engineResult.defect_groups.map(g => ({
      category: g.category, attempts: g.attempts, isSafety: g.isSafety
    })),
    safety_defects:             engineResult.safety_defects,
    retain_signals:             engineResult.retain_signals,
    risk_factors:               engineResult.risk_factors,
    missing_data:               engineResult.missing_data,
  }, null, 2)

  const docsSummary = docs.map((d, i) =>
    `Document ${i + 1} — ${d.file_name} (${d.document_type_code ?? 'other'}):\n${JSON.stringify(d.ai_extraction, null, 2)}`
  ).join('\n\n---\n\n')

  const systemPrompt = `You are an experienced lemon law attorney writing a pre-litigation case analysis memo for a lemon law firm.

Client: ${caseContext.client_name ?? 'unknown'}
Vehicle: ${caseContext.vehicle ?? 'unknown'}
State: ${caseContext.state ?? 'unknown'}
Applicable law: ${stateLawText}

The deterministic analysis engine has already made the RETAIN/NURTURE/DROP decision based on hard rules.
Your job is to write the attorney narrative that explains and supports that decision.
Return ONLY valid JSON.${knowledge}`

  const userPrompt = `ENGINE DECISION (DO NOT CHANGE):
${engineSummary}

EXTRACTED DOCUMENTS:
${docsSummary}

---

Write the attorney memo. Return this exact JSON:
{
  "decision": "${engineResult.decision}",
  "confidence": "${engineResult.confidence}",
  "cause_of_action": ${engineResult.cause_of_action ? `"${engineResult.cause_of_action}"` : 'null'},
  "case_strength": "strong" | "moderate" | "weak" | "insufficient_data",
  "summary": "2-3 sentence plain English summary of the case for the handling attorney",
  "total_repair_attempts": number | null,
  "total_days_out_of_service": number | null,
  "date_range": { "first_repair": "YYYY-MM-DD" | null, "last_repair": "YYYY-MM-DD" | null },
  "recurring_defects": [{ "complaint": string, "attempts": number, "dates": string[] }],
  "retain_signals": string[],
  "risk_factors": string[],
  "nurture_reason": string | null,
  "drop_reason": string | null,
  "clarification_needed": string[],
  "key_findings": string[],
  "attorney_notes": "Draft language for the handling attorney — what to say to the client, what to watch for, what the next step should be"
}`

  const response = await client.messages.create({
    model:      ANALYSIS_MODEL,
    max_tokens: 1500,
    system:     systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
  const sonnetAnalysis = parseJson(text)

  // Merge engine decision (authoritative) with Sonnet narrative
  return {
    analysis: {
      ...sonnetAnalysis,
      // Engine values always override Sonnet for decision fields
      decision:               engineResult.decision,
      confidence:             engineResult.confidence,
      cause_of_action:        engineResult.cause_of_action,
      engine_retain_signals:  engineResult.retain_signals,
      engine_risk_factors:    engineResult.risk_factors,
      engine_missing_data:    engineResult.missing_data,
      state_law:              engineResult.state_law?.name ?? null,
      state_statute:          engineResult.state_law?.statute ?? null,
      meets_state_threshold:  engineResult.meets_state_repair_threshold || engineResult.meets_state_safety_threshold || engineResult.meets_state_oos_threshold,
      meets_federal_threshold: engineResult.meets_federal_threshold,
    },
    model: ANALYSIS_MODEL,
  }
}
