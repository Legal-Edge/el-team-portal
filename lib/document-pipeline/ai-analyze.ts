// ─────────────────────────────────────────────────────────────────────────────
// Two-Stage AI Document Analysis Pipeline
//
// Stage 1 — Claude Sonnet extraction (per document, cached)
//   extractDocument(pdfBytes, docType) → structured JSON + validation flags
//
// Stage 2 — Sonnet case analysis (on demand, reads cached extractions)
//   analyzeCaseDocuments(extractions[], caseContext) → case-level findings
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager } from '@google/generative-ai/server'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

export const EXTRACTION_MODEL = 'gemini-2.5-flash'
export const ANALYSIS_MODEL   = 'claude-sonnet-4-20250514'

import { runLemonLawEngine } from '../lemon-law/engine'
import { calculateSOL } from '../lemon-law/sol'
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
  // Remove ALL markdown code fence markers (Gemini wraps in ```json ... ```)
  const clean = text.replace(/```(?:json|JSON)?\s*/g, '').trim()
  // Try direct parse
  try { return JSON.parse(clean) }
  catch { /* fall through */ }
  // Fallback: find first { ... } block
  const match = clean.match(/\{[\s\S]*\}/)
  try { return match ? JSON.parse(match[0]) : { raw: text } }
  catch { return { raw: text } }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — Haiku extraction
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPTS: Record<string, string> = {
  repair_order: `Extract the following fields from this repair order. Return ONLY valid JSON, no other text.

IMPORTANT field definitions:
- "complaint": The customer's stated concern/problem. Look for labels like "Customer Concern", "Customer States", "CS:", "Complaint", "Problem", "Concern". Extract the full complaint text as a single string. Never return null if any customer concern text exists anywhere on the document.
- "diagnosis": What the technician found after inspection. Labels: "Cause", "Diagnosis", "Tech Notes", "Found", "Technician Comments".
- "work_performed": What was actually done to the vehicle. Labels: "Correction", "Work Performed", "Repair", "Labor".
- "repair_status": Set to "unable_to_duplicate" if technician found no issue, "completed" if repair was made.

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

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION LAYER — deterministic, zero cost, runs after every extraction
// ─────────────────────────────────────────────────────────────────────────────

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

// ISO 3779 VIN checksum — returns true if check digit is valid
function isValidVinChecksum(vin: string): boolean {
  const TRANSLITERATION: Record<string, number> = {
    A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,
    J:1,K:2,L:3,M:4,N:5,  P:7,  R:9,
    S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9,
    '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
  }
  const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]
  const sum = vin.split('').reduce((acc, ch, i) => acc + (TRANSLITERATION[ch] ?? 0) * WEIGHTS[i], 0)
  const remainder = sum % 11
  const expected  = remainder === 10 ? 'X' : String(remainder)
  return vin[8] === expected
}

interface ValidationFlags {
  vin_valid:          boolean | null   // null = no VIN to validate
  vin_checksum_valid: boolean | null
  dates_valid:        boolean | null
  mileage_valid:      boolean | null
  needs_review:       boolean
  review_reasons:     string[]
}

function validateExtraction(
  extraction: Record<string, unknown>,
  docType:    string | null,
): ValidationFlags {
  const flags: ValidationFlags = {
    vin_valid:          null,
    vin_checksum_valid: null,
    dates_valid:        null,
    mileage_valid:      null,
    needs_review:       false,
    review_reasons:     [],
  }

  // ── VIN ────────────────────────────────────────────────────────────────
  const vin = extraction.vin
  if (vin && typeof vin === 'string') {
    const vinClean = vin.replace(/\s/g, '').toUpperCase()
    flags.vin_valid = VIN_RE.test(vinClean)
    if (!flags.vin_valid) {
      flags.needs_review = true
      flags.review_reasons.push(`VIN format invalid: "${vin}" (must be 17 alphanumeric chars, no I/O/Q)`)
    } else {
      flags.vin_checksum_valid = isValidVinChecksum(vinClean)
      if (!flags.vin_checksum_valid) {
        flags.needs_review = true
        flags.review_reasons.push(`VIN checksum failed: "${vinClean}" — likely 1 character misread`)
      }
    }
  }

  // ── Dates ──────────────────────────────────────────────────────────────
  if (docType === 'repair_order') {
    const dateIn  = extraction.repair_date_in
    const dateOut = extraction.repair_date_out
    const MIN_DATE = new Date('2000-01-01').getTime()
    const MAX_DATE = new Date('2035-01-01').getTime()

    let datesOk = true
    const dateInParsed  = dateIn  ? new Date(dateIn  as string) : null
    const dateOutParsed = dateOut ? new Date(dateOut as string) : null

    if (dateInParsed && (isNaN(dateInParsed.getTime()) || dateInParsed.getTime() < MIN_DATE || dateInParsed.getTime() > MAX_DATE)) {
      datesOk = false
      flags.review_reasons.push(`repair_date_in out of range: "${dateIn}"`)
    }
    if (dateOutParsed && (isNaN(dateOutParsed.getTime()) || dateOutParsed.getTime() < MIN_DATE || dateOutParsed.getTime() > MAX_DATE)) {
      datesOk = false
      flags.review_reasons.push(`repair_date_out out of range: "${dateOut}"`)
    }
    if (dateInParsed && dateOutParsed && !isNaN(dateInParsed.getTime()) && !isNaN(dateOutParsed.getTime()) && dateOutParsed < dateInParsed) {
      datesOk = false
      flags.review_reasons.push(`repair_date_out is before repair_date_in`)
    }
    flags.dates_valid = datesOk
    if (!datesOk) flags.needs_review = true
  }

  // ── Mileage ────────────────────────────────────────────────────────────
  if (docType === 'repair_order') {
    const milIn  = extraction.mileage_in
    const milOut = extraction.mileage_out
    let milOk = true

    if (milIn !== null && milIn !== undefined && (typeof milIn !== 'number' || milIn < 0 || milIn > 300000)) {
      milOk = false
      flags.review_reasons.push(`mileage_in out of range: "${milIn}"`)
    }
    if (milOut !== null && milOut !== undefined && (typeof milOut !== 'number' || milOut < 0 || milOut > 300000)) {
      milOk = false
      flags.review_reasons.push(`mileage_out out of range: "${milOut}"`)
    }
    if (typeof milIn === 'number' && typeof milOut === 'number' && milOut < milIn) {
      milOk = false
      flags.review_reasons.push(`mileage_out (${milOut}) is less than mileage_in (${milIn})`)
    }
    flags.mileage_valid = milOk
    if (!milOk) flags.needs_review = true
  }

  return flags
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — Gemini 2.5 Flash extraction (File API)
// ─────────────────────────────────────────────────────────────────────────────

export async function extractDocument(
  pdfBytes: ArrayBuffer,
  docType:  string | null,
): Promise<{ extraction: Record<string, unknown>; model: string }> {
  const apiKey      = process.env.GOOGLE_AI_API_KEY!
  const fileManager = new GoogleAIFileManager(apiKey)
  const genAI       = new GoogleGenerativeAI(apiKey)
  const prompt      = EXTRACTION_PROMPTS[docType ?? ''] ?? EXTRACTION_PROMPTS.default
  const pdfBuffer   = Buffer.from(pdfBytes)
  const knowledge   = await loadKnowledge('extraction', docType)

  // Upload PDF via File API (handles large files; inline base64 truncates)
  const tmpPath = join(tmpdir(), `el-extract-${Date.now()}.pdf`)
  writeFileSync(tmpPath, pdfBuffer)

  let uploadedFileName = ''
  try {
    const upload = await fileManager.uploadFile(tmpPath, {
      mimeType:    'application/pdf',
      displayName: `extract-${Date.now()}.pdf`,
    })
    uploadedFileName = upload.file.name

    const gemini = genAI.getGenerativeModel({
      model:             EXTRACTION_MODEL,
      systemInstruction: `You are a document extraction assistant for a lemon law firm. Extract structured data from legal/automotive documents. Return ONLY valid JSON — no markdown fences, no explanation.${knowledge}`,
    })

    const result = await gemini.generateContent({
      contents: [{
        role:  'user',
        parts: [
          { fileData: { mimeType: 'application/pdf', fileUri: upload.file.uri } },
          { text: prompt },
        ],
      }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generationConfig: {
        maxOutputTokens: 8192,
        temperature:     1,
        thinkingConfig:  { thinkingBudget: 0 },  // disable thinking — frees full token budget for output
      } as any,
    })

    const finishReason = result.response.candidates?.[0]?.finishReason
    const text         = result.response.text()
    console.log('[Gemini] finish:', finishReason, '| raw length:', text.length, '| first 300:', text.slice(0, 300))
    const extraction = parseJson(text)
    console.log('[Gemini] parsed:', Object.keys(extraction).length, 'fields | hasRaw:', 'raw' in extraction, '| keys:', Object.keys(extraction).join(', '))

    // ── VIN normalisation + format check ──────────────────────────────────
    const vinRaw = extraction.vin
    if (vinRaw && typeof vinRaw === 'string') {
      const vinClean = vinRaw.replace(/[\s-]/g, '').toUpperCase()
      if (VIN_RE.test(vinClean)) {
        extraction.vin = vinClean
      } else {
        console.warn(`[Gemini] VIN format invalid: "${vinRaw}" — re-prompting`)
        try {
          const retryResult = await gemini.generateContent({
            contents: [{
              role:  'user',
              parts: [
                { fileData: { mimeType: 'application/pdf', fileUri: upload.file.uri } },
                { text: 'What is the Vehicle Identification Number (VIN)? Return ONLY the 17-character VIN, nothing else.' },
              ],
            }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            generationConfig: { maxOutputTokens: 30, temperature: 1, thinkingConfig: { thinkingBudget: 0 } } as any,
          })
          const vinResult = retryResult.response.text().trim().replace(/[\s-]/g, '').toUpperCase()
          if (VIN_RE.test(vinResult)) {
            extraction.vin = vinResult
            console.log(`[Gemini] VIN re-prompt succeeded: "${vinResult}"`)
          } else {
            console.warn(`[Gemini] VIN re-prompt also invalid: "${vinResult}" — flagging for review`)
            extraction.vin = null
            extraction.vin_needs_review = true
          }
        } catch (e) {
          console.error('[Gemini] VIN re-prompt error:', e)
          extraction.vin = null
          extraction.vin_needs_review = true
        }
      }
    }

    // ── Validation layer ────────────────────────────────────────────────────
    const validation = validateExtraction(extraction, docType)
    extraction._validation = validation

    if (validation.needs_review) {
      console.warn(`[Validation] Document needs review — ${validation.review_reasons.join('; ')}`)
    }

    return { extraction, model: EXTRACTION_MODEL }
  } finally {
    // Clean up temp file + Gemini File API entry
    try { unlinkSync(tmpPath) } catch {}
    if (uploadedFileName) {
      try { await fileManager.deleteFile(uploadedFileName) } catch {}
    }
  }
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

  // Calculate SOL dates (deterministic — no AI needed)
  const solResult = calculateSOL({
    purchase_date:   caseContext.purchase_date,
    vehicle_year:    caseContext.vehicle_year,
    state:           caseContext.state,
    current_mileage: engineInput.mileage_at_intake ?? null,
  })

  // ── SOL override: if state SOL expired, drop state theory from cause of action ──
  let resolvedCauseOfAction = engineResult.cause_of_action
  const solRiskFactors: string[] = []

  if (solResult.basis !== 'unknown' && solResult.state_sol_expired) {
    // State SOL has passed — client can no longer file a state lemon law claim
    if (resolvedCauseOfAction === 'both' || resolvedCauseOfAction === 'state_lemon_law') {
      resolvedCauseOfAction = engineResult.meets_federal_threshold ? 'magnuson_moss' : null
      solRiskFactors.push(
        `State lemon law SOL expired ${solResult.state_sol_date} — state claim no longer fileable; ${
          engineResult.meets_federal_threshold
            ? 'Magnuson-Moss federal claim still available (4-year window open)'
            : 'federal Mag-Moss threshold not met — evaluate carefully'
        }`
      )
    }
  }

  if (solResult.basis !== 'unknown' && solResult.federal_sol_expired) {
    solRiskFactors.push(`Federal Magnuson-Moss SOL also expired ${solResult.federal_sol_date} — both claims may be time-barred`)
  }

  if (solResult.state_sol_urgent && !solResult.state_sol_expired) {
    solRiskFactors.push(`State lemon law SOL expires in ${solResult.days_until_state_sol} days (${solResult.state_sol_date}) — file urgently`)
  }

  // Merge engine decision (authoritative) with Sonnet narrative
  return {
    analysis: {
      ...sonnetAnalysis,
      // Engine values always override Sonnet for decision fields
      decision:               engineResult.decision,
      confidence:             engineResult.confidence,
      confidence_score:       engineResult.confidence_score,
      cause_of_action:        resolvedCauseOfAction,
      engine_retain_signals:  engineResult.retain_signals,
      engine_risk_factors:    [...engineResult.risk_factors, ...solRiskFactors],
      engine_missing_data:    engineResult.missing_data,
      state_law:              engineResult.state_law?.name ?? null,
      state_statute:          engineResult.state_law?.statute ?? null,
      meets_state_threshold:  engineResult.meets_state_repair_threshold || engineResult.meets_state_safety_threshold || engineResult.meets_state_oos_threshold,
      meets_federal_threshold: engineResult.meets_federal_threshold,
      // SOL dates
      sol:                    solResult,
    },
    model: ANALYSIS_MODEL,
  }
}
