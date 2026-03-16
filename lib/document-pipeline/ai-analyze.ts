// ─────────────────────────────────────────────────────────────────────────────
// AI Document Analyzer — Lemon Law Edition
//
// Sends a PDF to Claude with lemon-law-specific prompts.
// Output is structured JSON tailored to each document type.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic, { toFile } from '@anthropic-ai/sdk'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'

const MODEL = 'claude-sonnet-4-20250514'

// ── State lemon law thresholds (add more as needed) ───────────────────────
const STATE_LAW: Record<string, string> = {
  CA: 'California (Song-Beverly): 4 repair attempts for same defect, OR 2 attempts for safety defect, OR 30+ calendar days out of service — within 18 months or 18,000 miles (whichever first). Manufacturer must repurchase or replace.',
  TX: 'Texas: 4 repair attempts for same defect, OR 2 attempts for serious safety hazard, OR 30+ days out of service — within 24 months or 24,000 miles.',
  FL: 'Florida: 3 repair attempts for same defect, OR 15+ days out of service — within 24 months or 24,000 miles.',
  NY: 'New York: 4 repair attempts for same defect, OR 30+ days out of service — within 24 months or 18,000 miles.',
  WA: 'Washington: 4 repair attempts, OR 30+ days out of service — within 24 months or 24,000 miles.',
  IL: 'Illinois: 4 repair attempts, OR 30+ days out of service — within 12 months or 12,000 miles (whichever first).',
  AZ: 'Arizona: 4 repair attempts, OR 30+ days out of service — within 24 months or 24,000 miles.',
  CO: 'Colorado: 4 repair attempts, OR 30+ days out of service — within 1 year.',
  NJ: 'New Jersey: 3 repair attempts for same defect (or 1 attempt for life-threatening defect), OR 20+ days out of service — within 24 months or 18,000 miles.',
  GA: 'Georgia: 3 repair attempts for same defect, OR 30+ days out of service — within 24 months or 24,000 miles.',
  DEFAULT: 'Federal Magnuson-Moss Warranty Act: 3–4 reasonable repair attempts for same defect, or substantial time out of service. Many states have additional consumer protections.',
}

function getStateLaw(stateCode: string | null | undefined): string {
  const code = (stateCode ?? '').toUpperCase().trim()
  return STATE_LAW[code] ?? STATE_LAW.DEFAULT
}

// ── System prompt ─────────────────────────────────────────────────────────
function buildSystemPrompt(docType: string | null, caseContext: CaseContext): string {
  const law = getStateLaw(caseContext.state)
  return `You are an experienced lemon law attorney reviewing case documents for ${caseContext.client_name ?? 'a client'}.

Vehicle: ${caseContext.vehicle ?? 'unknown'}
State: ${caseContext.state ?? 'unknown'}
Applicable law: ${law}

Your task: analyze the attached document and return a JSON object with the fields below.
Be precise, factual, and highlight anything legally significant for a lemon law claim.
Do NOT include any text outside the JSON object.

${docType === 'repair_order' ? REPAIR_ORDER_SCHEMA : docType === 'purchase_agreement' ? PURCHASE_SCHEMA : GENERIC_SCHEMA}`
}

const REPAIR_ORDER_SCHEMA = `Return exactly this JSON shape (use null for missing fields):
{
  "doc_type": "repair_order",
  "dealer_name": string | null,
  "repair_date_in": "YYYY-MM-DD" | null,
  "repair_date_out": "YYYY-MM-DD" | null,
  "days_in_shop": number | null,
  "mileage_in": number | null,
  "mileage_out": number | null,
  "vehicle_info": string | null,
  "vin": string | null,
  "complaint": string,
  "diagnosis": string | null,
  "work_performed": string,
  "repair_status": "completed" | "unable_to_duplicate" | "parts_on_order" | "customer_declined" | "other",
  "warranty_repair": boolean | null,
  "lemon_law_flags": string[],
  "summary": string
}

lemon_law_flags examples: "unable to duplicate", "same complaint as prior RO", "safety-related defect", "extended time in shop", "parts unavailable".
summary: 1-2 sentence plain-English assessment of this RO's significance to the lemon law case.`

const PURCHASE_SCHEMA = `Return exactly this JSON shape (use null for missing fields):
{
  "doc_type": "purchase_agreement",
  "vehicle_year": number | null,
  "vehicle_make": string | null,
  "vehicle_model": string | null,
  "vin": string | null,
  "purchase_date": "YYYY-MM-DD" | null,
  "purchase_price": number | null,
  "is_lease": boolean,
  "warranty_type": string | null,
  "dealer_name": string | null,
  "lemon_law_flags": string[],
  "summary": string
}

summary: 1-2 sentence note on anything relevant (purchase date affects warranty window, lease vs buy affects remedy, etc.)`

const GENERIC_SCHEMA = `Return exactly this JSON shape (use null for missing fields):
{
  "doc_type": "other",
  "document_description": string,
  "key_dates": string[],
  "key_facts": string[],
  "lemon_law_flags": string[],
  "summary": string
}

summary: 1-2 sentence plain-English assessment of this document's significance to the lemon law case.`

// ── Case context passed to the analyzer ──────────────────────────────────
export interface CaseContext {
  client_name?: string | null
  vehicle?:     string | null
  state?:       string | null
}

// ── Main analysis function ────────────────────────────────────────────────
export async function analyzeDocument(
  pdfBytes:    ArrayBuffer,
  docType:     string | null,
  caseContext: CaseContext,
): Promise<{ summary: Record<string, unknown>; model: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const base64Pdf = Buffer.from(pdfBytes).toString('base64')
  const systemPrompt = buildSystemPrompt(docType, caseContext)

  const response = await client.beta.messages.create({
    model:      MODEL,
    max_tokens: 1024,
    system:     systemPrompt,
    messages: [{
      role:    'user',
      content: [
        {
          type:   'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
        } as BetaContentBlockParam,
        {
          type: 'text',
          text: 'Analyze this document and return the JSON.',
        } as BetaContentBlockParam,
      ],
    }],
    betas: ['pdfs-2024-09-25'],
  })

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}'

  // Extract JSON — Claude sometimes wraps in code fences
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text }

  return { summary: parsed, model: MODEL }
}
