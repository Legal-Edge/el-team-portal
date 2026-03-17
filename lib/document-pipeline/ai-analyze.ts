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
  return { extraction: parseJson(text), model: EXTRACTION_MODEL }
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

export async function analyzeCaseDocuments(
  docs:        DocExtractionRecord[],
  caseContext: CaseContext,
): Promise<{ analysis: Record<string, unknown>; model: string }> {
  const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const stateLaw = getStateLaw(caseContext.state)
  const knowledge = await loadKnowledge('analysis', null)

  const docsSummary = docs.map((d, i) =>
    `Document ${i + 1} — ${d.file_name} (${d.document_type_code ?? 'other'}):\n${JSON.stringify(d.ai_extraction, null, 2)}`
  ).join('\n\n---\n\n')

  const systemPrompt = `You are an experienced lemon law attorney reviewing a case file.

Client: ${caseContext.client_name ?? 'unknown'}
Vehicle: ${caseContext.vehicle ?? 'unknown'}
State: ${caseContext.state ?? 'unknown'}
Applicable law: ${stateLaw}

Analyze the extracted document data below and return a JSON case analysis. Return ONLY valid JSON.${knowledge}`

  const userPrompt = `${docsSummary}

---

Based on all documents above, return this exact JSON:
{
  "case_strength": "strong" | "moderate" | "weak" | "insufficient_data",
  "case_strength_reason": string,
  "total_repair_attempts": number | null,
  "total_days_out_of_service": number | null,
  "date_range": { "first_repair": "YYYY-MM-DD" | null, "last_repair": "YYYY-MM-DD" | null },
  "unique_defects": string[],
  "recurring_defects": [{ "complaint": string, "attempts": number, "dates": string[] }],
  "qualifies_under_state_law": boolean | null,
  "qualifies_reason": string,
  "key_findings": string[],
  "recommended_next_steps": string[],
  "summary": string
}`

  const response = await client.messages.create({
    model:      ANALYSIS_MODEL,
    max_tokens: 1024,
    system:     systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
  return { analysis: parseJson(text), model: ANALYSIS_MODEL }
}
