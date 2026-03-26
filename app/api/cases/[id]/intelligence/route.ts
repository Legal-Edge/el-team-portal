/**
 * GET /api/cases/[id]/intelligence
 *
 * Case Intelligence Engine
 *
 * Evidence tiers (ascending reliability):
 *   Tier 1 — Intake claims (form/call, client self-reported)
 *   Tier 2 — Communications (calls, SMS, notes — confirms/contradicts claims)
 *   Tier 3 — Documents (service records, purchase agreement — ground truth)
 *
 * Guidance generation is fully server-side. The client renders, not reasons.
 * Key principle: nurture_reason drives the primary action. Everything else is context.
 */

import { NextRequest, NextResponse }                     from 'next/server'
import { getTeamSession }                                from '@/lib/session'
import { supabaseAdmin }                                 from '@/lib/supabase'
import { STATE_LAWS, FEDERAL_LAW }                       from '@/lib/lemon-law/states'
import { buildSynthesisInput, synthesizeGuidance }       from '@/lib/intelligence/synthesize'

function buildStateLawSummary(stateCode: string): string {
  const law = STATE_LAWS[stateCode?.toUpperCase()] ?? null
  if (!law) return FEDERAL_LAW.keyNuances ?? 'Federal Magnuson-Moss applies — reasonable repair attempts standard.'
  return `${law.name} (${law.statute}): ${law.repairAttempts} repair attempts for same defect (${law.safetyAttempts} for safety), OR ${law.daysOOS}+ days out of service — within ${law.windowMonths} months/${law.windowMiles.toLocaleString()} miles. Remedies: ${law.remedies}.${law.keyNuances ? ' ' + law.keyNuances : ''}`
}

// ── HubSpot engagements fetcher ───────────────────────────────────────────────

function getHsToken() {
  const t = process.env.HUBSPOT_ACCESS_TOKEN
  if (!t) throw new Error('HUBSPOT_ACCESS_TOKEN not set')
  return t
}

interface HsEngagement {
  id:          string
  type:        string
  body:        string
  callSummary?: string
  status?:     string
  duration?:   number
  direction?:  string
  title?:      string
  createdAt:   number
}

async function fetchEngagements(dealId: string): Promise<HsEngagement[]> {
  const token = getHsToken()
  const assocRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/engagements`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  if (!assocRes.ok) return []
  const assoc = await assocRes.json() as { results?: { id: string }[] }
  const ids = (assoc.results ?? []).map(r => r.id)
  if (!ids.length) return []

  const engagements: HsEngagement[] = []
  for (const id of ids) {
    try {
      const res = await fetch(
        `https://api.hubapi.com/engagements/v1/engagements/${id}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
      )
      if (!res.ok) continue
      const data = await res.json() as {
        engagement?: { type?: string; createdAt?: number }
        metadata?:   { body?: string; callSummary?: string; status?: string; durationMilliseconds?: number; direction?: string; title?: string }
      }
      const e = data.engagement ?? {}
      const m = data.metadata   ?? {}
      engagements.push({
        id,
        type:        e.type ?? 'UNKNOWN',
        body:        m.body ?? '',
        callSummary: m.callSummary ?? '',
        status:      m.status ?? '',
        duration:    m.durationMilliseconds,
        direction:   m.direction,
        title:       m.title,
        createdAt:   e.createdAt ?? 0,
      })
    } catch { /* skip */ }
  }
  return engagements.sort((a, b) => b.createdAt - a.createdAt)
}

// ── HTML stripper ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Shared types (exported for client component use) ─────────────────────────

export interface GuidanceChecklistItem {
  id:        string
  icon:      string
  what:      string       // What is needed
  how:       string[]     // How the client provides it
  then:      string       // What happens after
  note?:     string       // Attorney-specific note if applicable
  template?: {
    type:  'sms' | 'call'
    label: string
    body:  string
  }
}

export interface IntelligenceReport {
  case_id:      string
  deal_id:      string
  stage:        string
  generated_at: string
  client_name:  string

  tier1_intake: {
    vehicle:        string | null
    issues:         string[]
    repair_count:   number | null
    purchase_date:  string | null
    state:          string | null
    nurture_reason: string | null
    nurture_notes:  string | null
  }
  tier2_comms: {
    total_engagements:  number
    calls:              number
    notes:              number
    last_contact_at:    string | null
    days_since_contact: number | null
    timeline: {
      id:         string
      type:       string
      date:       string
      direction?: string
      agent?:     string
      summary:    string
    }[]
    call_summaries: string[]
    key_facts:      string[]
  }
  tier3_docs: {
    total_docs:        number
    doc_types:         string[]
    has_repair_orders: boolean
    has_purchase_agmt: boolean
    missing_critical:  string[]
  }
  attorney: {
    clarification_needed: string | null
    nurture_decision:     string | null
    repairs_needed_note:  string | null
    ai_instructions:      string | null
    review_decision:      string | null
    specific_requests:    string[]
  }

  // Server-generated guidance — fully context-aware
  guidance: {
    stage_goal:  string
    situation:   string
    checklist:   GuidanceChecklistItem[]
    next_steps:  string[]
    faqs:        { q: string; a: string }[]
    // Internal flags used during generation (helps with debugging)
    _context: {
      repair_status:             'no_visits' | 'visits_no_repairs' | 'repairs_completed'
      nurture_scenario:          string
      last_call_key_points:      string[]
      attorney_has_instructions: boolean
    }
  }
}

// ── Case state resolver ───────────────────────────────────────────────────────
// Resolves contradictions in the data before guidance is generated

interface CaseState {
  vehicle:         string
  firstName:       string
  state:           string
  // Repair status — resolved from multiple contradictory fields
  repair_status:   'no_visits' | 'visits_no_repairs' | 'repairs_completed'
  visit_count:     number           // dealer visits (may not equal completed repairs)
  repair_count:    number           // actual completed repairs
  issues:          string[]
  // Nurture context
  nurture_reason:  string
  nurture_notes:   string
  // Primary scenarios (can have multiple true)
  waiting_manufacturer: boolean
  waiting_threshold:    boolean
  waiting_more_repairs: boolean
  has_service_records:  boolean     // service visit docs (even "no fault found")
  has_repair_orders:    boolean     // formal repair orders (repairs actually completed)
  has_purchase_agmt:    boolean
  // Last call context
  last_call_summary:    string
  last_call_agent_told: string      // what the agent told the client on last call
  last_call_client_told: string     // what the client said
  days_since_contact:   number | null
  attorney_requests:    string[]
}

function resolveCaseState(
  hp:          Record<string, unknown>,
  engagements: HsEngagement[],
  docTypes:    string[],
  clientName:  string,
): CaseState {
  const firstName = (clientName.split(' ')[0]) || 'there'

  // ── Vehicle ───────────────────────────────────────────────────────────────
  const yr    = String(hp['vehicle_year']  ?? hp['what_is_the_approximate_year_of_your_vehicle_'] ?? '')
  const mk    = String(hp['vehicle_make']  ?? hp['what_is_the_make_of_your_vehicle_']  ?? '')
  const mdl   = String(hp['vehicle_model'] ?? hp['what_is_the_model_of_your_vehicle_'] ?? '')
  const vehicle = [yr, mk, mdl].filter(Boolean).join(' ') || 'their vehicle'

  // ── State ─────────────────────────────────────────────────────────────────
  const stateRaw = String(hp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? hp['state'] ?? '')
  const state = stateRaw.length === 2
    ? stateRaw.toUpperCase()
    : stateRaw.slice(0, 2).toUpperCase() || 'TN'

  // ── Repair status resolution ──────────────────────────────────────────────
  // Three sources, often contradictory:
  //   1. have_you_had_any_repairs_done = "No" (binary — has actual repair work been done)
  //   2. most_common_problem__notes_ contains "Repair Attempts: 3x" (dealer visits, incl. "no fault found")
  //   3. nurture__notes_ = "NO REPAIRS" (staff-entered, most reliable)
  const repairsDoneAnswer = String(hp['have_you_had_any_repairs_done_to_your_vehicle_'] ?? '').toLowerCase()
  const nurtureNotes      = String(hp['nurture__notes_'] ?? '').toLowerCase()
  const hasCompletedRepairs = repairsDoneAnswer === 'yes' || repairsDoneAnswer.includes('yes')
  const explicitlyNoRepairs = repairsDoneAnswer === 'no'
    || nurtureNotes.includes('no repair')
    || nurtureNotes.includes('no repairs')

  // Parse visit count from problem notes ("Repair Attempts: 3x" = 3 dealer visits)
  let visitCount = 0
  const problemFields = [
    'most_common_problem__notes_', 'second_common_problem__notes_',
    'third_common_problem__notes_', 'fourth_common_problem__notes_',
  ]
  for (const field of problemFields) {
    const val = String(hp[field] ?? '')
    const match = val.match(/repair attempts?:\s*(\d+)/i)
    if (match) {
      visitCount = Math.max(visitCount, parseInt(match[1]))
    }
  }
  // Also check direct repair count field
  const directRepairCount = parseInt(String(hp['repair_attempts'] ?? hp['how_many_repairs_have_you_had_done_to_your_vehicle_'] ?? '0')) || 0

  const repairCount = hasCompletedRepairs ? Math.max(visitCount, directRepairCount) : 0
  const repair_status: CaseState['repair_status'] = explicitlyNoRepairs
    ? (visitCount > 0 ? 'visits_no_repairs' : 'no_visits')
    : hasCompletedRepairs
      ? 'repairs_completed'
      : visitCount > 0 ? 'visits_no_repairs' : 'no_visits'

  // ── Issues extraction ─────────────────────────────────────────────────────
  const issues: string[] = []
  for (const field of problemFields) {
    const raw = String(hp[field] ?? '')
    if (!raw) continue
    let s = raw.replace(/^(most|second|third|fourth)\s+common\s+problem\s*:\s*/i, '')
    s = s.replace(/^\*\s*/u, '').replace(/^[\u{1F000}-\u{1FFFF}\u2600-\u27BF\uFE00-\uFE0F]+\s*/u, '')
    s = s.replace(/_?\s*repair attempts?[\s\S]*/i, '')
    s = s.replace(/:\s*\*_/g, ': ').replace(/^[*_.\s]+/, '').replace(/[*_.\s]+$/, '').trim()
    const colonIdx = s.indexOf(':')
    const label = colonIdx > 0 ? s.slice(0, colonIdx).trim() : s
    if (label && !issues.includes(label)) issues.push(label)
  }

  // ── Nurture scenario detection ────────────────────────────────────────────
  const nurtureReason = String(hp['nurture__reason_'] ?? '')
  const nurtureReasonL = nurtureReason.toLowerCase()

  const waiting_manufacturer = /manufacturer|manuf\b/i.test(nurtureReasonL)
  const waiting_threshold    = /30.?day|threshold|days? (in|out|at)|time/i.test(nurtureReasonL)
  const waiting_more_repairs = /repair|visit|shop|attempt/i.test(nurtureReasonL)

  // ── Document status ───────────────────────────────────────────────────────
  // "service_record" or "repair_order" — service records include "no fault found" visits
  const has_service_records = docTypes.some(t => t === 'service_record' || t === 'repair_order')
  const has_repair_orders   = docTypes.includes('repair_order')
  const has_purchase_agmt   = docTypes.includes('purchase_agreement')

  // ── Last call extraction ──────────────────────────────────────────────────
  const calls = engagements.filter(e => e.type === 'CALL')
  const lastCall = calls[0]
  let last_call_summary    = ''
  let last_call_agent_told = ''
  let last_call_client_told = ''

  if (lastCall) {
    const bodyText = stripHtml(lastCall.body || '')
    const summaryText = stripHtml(lastCall.callSummary || '')

    // Extract agent action items from call body
    const agentActionMatch = bodyText.match(/agent.{0,20}action items?.{0,500}?(?=\n\n|\n[A-Z]|customer action|$)/i)
    if (agentActionMatch) last_call_agent_told = agentActionMatch[0].replace(/\n+/g, ' ').trim().slice(0, 400)

    // Extract what happened on the call
    const summaryLines = summaryText.split('\n').map(l => l.trim()).filter(l =>
      l.length > 20 &&
      !/^(summary|key notes?|topics?|call summary|reasons?|solutions?|pitches?|actions? taken|compliance|disposition|outcomes?|agent action|customer action|questions?)/i.test(l)
    )
    last_call_summary = summaryLines.slice(0, 4).join(' ').slice(0, 500)

    // Pull customer action items
    const custActionMatch = bodyText.match(/customer.{0,20}action items?.{0,500}?(?=\n\n|\n[A-Z]|agent action|$)/i)
    if (custActionMatch) last_call_client_told = custActionMatch[0].replace(/\n+/g, ' ').trim().slice(0, 400)
  }

  // ── Days since contact ────────────────────────────────────────────────────
  const lastContactedRaw = hp['notes_last_contacted'] ? String(hp['notes_last_contacted']) : null
  const lastContactedMs  = lastContactedRaw
    ? (/^\d{13}$/.test(lastContactedRaw) ? parseInt(lastContactedRaw) : new Date(lastContactedRaw).getTime())
    : (calls[0]?.createdAt ?? null)
  const days_since_contact = lastContactedMs
    ? Math.floor((Date.now() - lastContactedMs) / 86_400_000) : null

  // ── Attorney requests ─────────────────────────────────────────────────────
  const attyText = [
    hp['attorney_review_clarification_needed__notes_'],
    hp['attorney_review_nurture_decision__notes_'],
    hp['attorney_review__repairs_needed___instruct_pc_client_comment'],
    hp['attorney_nurture_instructions__ai_'],
  ].filter(Boolean).map(String).join('\n')

  const attorney_requests: string[] = []
  if (/purchase|lease agreement|sales contract/i.test(attyText)) attorney_requests.push('Purchase or lease agreement')
  if (/photo|video|picture/i.test(attyText))                      attorney_requests.push('Photos or video of defect')
  if (/manufacturer.*correspondence|letter from/i.test(attyText)) attorney_requests.push('Manufacturer correspondence')

  return {
    vehicle, firstName, state,
    repair_status, visit_count: visitCount, repair_count: repairCount,
    issues, nurture_reason: nurtureReason, nurture_notes: nurtureNotes,
    waiting_manufacturer, waiting_threshold, waiting_more_repairs,
    has_service_records, has_repair_orders, has_purchase_agmt,
    last_call_summary, last_call_agent_told, last_call_client_told,
    days_since_contact, attorney_requests,
  }
}

// ── Guidance generator ────────────────────────────────────────────────────────
// Takes resolved case state → produces fully accurate, context-specific guidance

function generateGuidance(
  cs:    CaseState,
  stage: string,
  atty: {
    clarification_needed: string | null
    nurture_decision:     string | null
    repairs_needed_note:  string | null
    ai_instructions:      string | null
    review_decision:      string | null
  },
  hp: Record<string, unknown>,
): IntelligenceReport['guidance'] {

  const { vehicle, firstName } = cs
  const checklist: GuidanceChecklistItem[] = []
  const next_steps: string[] = []

  // ── Situation paragraph ───────────────────────────────────────────────────
  const situationParts: string[] = []
  let opening = `${firstName} has a ${vehicle}`
  if (cs.issues.length > 0) opening += ` with ${cs.issues.slice(0, 2).join(' and ')}`
  opening += '.'
  situationParts.push(opening)

  // Vehicle repair status detail
  if (cs.repair_status === 'repairs_completed' && cs.repair_count > 0) {
    situationParts.push(`${cs.repair_count} repair attempt${cs.repair_count !== 1 ? 's' : ''} completed at the dealership.`)
  } else if (cs.repair_status === 'visits_no_repairs') {
    situationParts.push('Vehicle has been to the dealership but no repairs have been completed.')
  } else if (cs.repair_status === 'no_visits') {
    situationParts.push('No documented dealer visits yet.')
  }

  const situation = situationParts.filter(Boolean).join(' ')

  // ── STAGE: INTAKE ─────────────────────────────────────────────────────────
  if (stage === 'intake') {
    const elAppStatus  = hp['el_app_status'] ? String(hp['el_app_status']) : null
    const batchNeeded  = elAppStatus?.startsWith('intake_batch_') && elAppStatus?.endsWith('_needed')
    const underReview  = elAppStatus === 'intake_under_review'
    const batchNum     = batchNeeded ? elAppStatus?.match(/batch_(\d+)/)?.[1] : null

    const stage_goal = underReview
      ? 'Intake form is under review. Verify all submitted information before routing.'
      : batchNeeded
        ? `Client needs to complete intake form — currently on Batch ${batchNum ?? '?'}.`
        : 'Confirm intake questionnaire is complete and route to appropriate stage.'

    if (!underReview) {
      checklist.push({
        id:   'complete_intake',
        icon: '📋',
        what: batchNeeded
          ? `Follow up — client hasn\'t finished intake (Batch ${batchNum ?? '?'} needed)`
          : 'Confirm intake questionnaire is complete',
        how: [
          `Check the client portal to see where ${firstName} is in the intake form.`,
          `If they\'re stuck, send the follow-up SMS below or call (855) 435-3666 and walk them through it.`,
          'All 7 steps must be complete before routing to the next stage.',
        ],
        then: 'Once intake is complete, route to Nurture or disqualify.',
        template: {
          type:  'sms',
          label: 'Send intake follow-up',
          body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nWe noticed you started your case evaluation but haven\'t finished yet — it only takes a few minutes to complete.\n\nFinish here: https://app.easylemon.com\n\nOnce it\'s done, our team will review everything and reach out with next steps. Any questions? Call or text (855) 435-3666 anytime!`,
        },
      })
    }

    if (underReview) {
      checklist.push({
        id:   'review_intake',
        icon: '🔍',
        what: 'Review submitted intake information',
        how: [
          'Open the client portal and review all submitted intake data.',
          'Verify vehicle year, make, model, mileage, and reported issues.',
          'Check repair history and state for eligibility.',
          `If information is complete, route ${firstName} to Nurture.`,
          'If information is missing or unclear, contact the client before routing.',
        ],
        then: `Route to Nurture if complete. Contact ${firstName} if clarification is needed.`,
      })
    }

    next_steps.push(underReview
      ? 'Review intake data and route to Nurture if complete.'
      : `Follow up with ${firstName} to complete the intake form.`)

    return {
      stage_goal, situation, checklist, next_steps,
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'intake', last_call_key_points: [], attorney_has_instructions: false },
    }
  }

  // ── STAGE: DOCUMENT COLLECTION ────────────────────────────────────────────
  if (stage === 'document_collection') {
    const hasROs        = cs.has_repair_orders
    const hasPA         = cs.has_purchase_agmt
    const missingDocs: string[] = []
    if (!hasROs) missingDocs.push('Repair orders')
    if (!hasPA)  missingDocs.push('Purchase or lease agreement')

    const docCollectionStatus  = hp['document_collection_status']  ? String(hp['document_collection_status'])  : null
    const docPromiseDate        = hp['document_promise_date']        ? String(hp['document_promise_date'])        : null
    const clientHasRepairDocsAns = hp['do_you_have_the_repair_documents__or_would_you_need_to_get_it_from_the_dealership_']
      ? String(hp['do_you_have_the_repair_documents__or_would_you_need_to_get_it_from_the_dealership_']) : null
    const clientNeedsDealerDocs = clientHasRepairDocsAns
      ? /dealer|dealership/i.test(clientHasRepairDocsAns) : false
    const clientHasDocsAtHome   = clientHasRepairDocsAns
      ? /have|yes|at home|i have/i.test(clientHasRepairDocsAns) && !clientNeedsDealerDocs : false

    // Promise date flag
    const promiseDateFlag = (() => {
      if (!docPromiseDate) return null
      const d = new Date(docPromiseDate)
      if (isNaN(d.getTime())) return null
      const past = d < new Date()
      return past
        ? `⚠️ Promise date passed: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : `📅 Promise date: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    })()

    const statusLine = docCollectionStatus ? `Status: ${docCollectionStatus}.` : ''
    const stage_goal = missingDocs.length === 0
      ? 'All required documents appear to be on file. Confirm with the attorney team before routing to Attorney Review.'
      : `Collect missing documents: ${missingDocs.join(', ')}.${statusLine ? ' ' + statusLine : ''}`

    if (!hasROs) {
      const repairDocsHow = clientNeedsDealerDocs
        ? [
            `${firstName} indicated they need to get the repair documents from the dealership.`,
            'Ask them to call the dealership\'s service department and request copies of all service records.',
            'Most dealerships can provide these within 1–2 business days.',
            'They can take a clear photo of each page and reply to your text.',
          ]
        : clientHasDocsAtHome
          ? [
              `${firstName} indicated they have the repair documents at home but hasn\'t uploaded them yet.`,
              'Follow up and ask them to take a clear photo of each page and reply to your text.',
              'Documents just need to be legible — photos work perfectly.',
            ]
          : [
              `Ask ${firstName} to pull the paperwork from each time the ${vehicle} was serviced.`,
              'These should show the date, complaint, diagnosis, and work performed.',
              'If they don\'t have copies, the dealership\'s service department can provide them.',
              'A clear photo replied to your text message works perfectly.',
              ...(promiseDateFlag ? [promiseDateFlag] : []),
            ]

      const repairDocsSms = clientNeedsDealerDocs
        ? `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nTo move your case forward, we need the repair records from your dealership. Since the dealer has them on file, the easiest way is to:\n\n1. Call the dealership\'s service department\n2. Ask for copies of all service records for your ${vehicle}\n3. Take a photo and reply to this text, or have them email you a PDF\n\nThey\'re required to provide these — it usually takes 1–2 days. Once we have them, our attorneys can review everything! 🍋 (855) 435-3666`
        : `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nTo move your case forward, we need copies of the repair paperwork from your dealership visits — the paperwork from each time your ${vehicle} was in for service.\n\nIf you have them at home, just take a photo and reply to this text! If not, call the dealership\'s service department and ask for copies of all service records.\n\nOnce we have these, our attorneys will review everything and reach out with next steps. 🍋\n\n(855) 435-3666`

      checklist.push({
        id:   'collect_repair_orders',
        icon: '📄',
        what: clientNeedsDealerDocs
          ? 'Repair orders — client needs to request from dealership'
          : clientHasDocsAtHome
            ? 'Repair orders — client has them, needs to upload'
            : 'Repair orders from all completed dealer visits',
        how:  repairDocsHow,
        then: 'Once repair orders are received, our attorneys can begin their review.',
        template: { type: 'sms', label: 'Request repair orders', body: repairDocsSms },
      })
    }

    if (!hasPA) {
      checklist.push({
        id:   'collect_purchase_agreement',
        icon: '🤝',
        what: 'Purchase or lease agreement',
        how: [
          `Ask ${firstName} for the contract they signed when they got the ${vehicle}.`,
          'This is usually a multi-page document from the finance department.',
          'If they don\'t have it, the dealership\'s finance department can provide a copy.',
        ],
        then: 'Required for attorney review and for calculating the buyback value.',
        template: {
          type:  'sms',
          label: 'Request purchase agreement',
          body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nOur team needs a copy of your vehicle\'s purchase or lease agreement — the contract you signed when you got your ${vehicle}.\n\n1. If you have it at home, take a photo and reply to this text\n2. If not, contact the dealership\'s finance department — they can provide a copy\n\nOnce we have it, your attorney can finalize their review. Thanks! (855) 435-3666`,
        },
      })
    }

    if (missingDocs.length === 0) {
      checklist.push({
        id:   'confirm_docs_complete',
        icon: '✅',
        what: 'Confirm document set is complete and route to Attorney Review',
        how: [
          'Verify all repair orders and purchase agreement are on file in SharePoint.',
          'Confirm documents are legible and cover all reported repair visits.',
          'Route to Attorney Review in HubSpot.',
        ],
        then: 'Attorney will be assigned and begin their review within 24–48 hours.',
      })
      next_steps.push('Documents appear complete — route to Attorney Review.')
    } else {
      next_steps.push(`Outstanding: ${missingDocs.join(', ')}. Follow up with ${firstName} to collect.`)
    }

    return {
      stage_goal, situation, checklist, next_steps,
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'document_collection', last_call_key_points: [], attorney_has_instructions: false },
    }
  }

  // ── STAGE: ATTORNEY REVIEW ────────────────────────────────────────────────
  if (stage === 'attorney_review') {
    const handlingAttorney  = hp['handling_attorney']              ? String(hp['handling_attorney'])              : null
    const causeOfAction     = hp['cause_of_action']                ? String(hp['cause_of_action'])                : null
    const attorneyComments  = hp['attorney_comments']              ? String(hp['attorney_comments'])              : null
    const aiAnalysisSummary = hp['case_summary_attorney_decision__ai_']
      ? String(hp['case_summary_attorney_decision__ai_']).slice(0, 200) + (String(hp['case_summary_attorney_decision__ai_']).length > 200 ? '…' : '')
      : null

    const hasInstructions = !!(atty.clarification_needed || atty.repairs_needed_note || atty.ai_instructions || atty.nurture_decision)

    // Build enriched situation with attorney-specific fields
    const attyContextLines = [
      handlingAttorney  ? `Assigned to: ${handlingAttorney}` : null,
      causeOfAction     ? `Cause of action: ${causeOfAction}` : null,
      aiAnalysisSummary ? `AI Analysis: ${aiAnalysisSummary}` : null,
    ].filter(Boolean)

    const stage_goal = hasInstructions
      ? 'Attorney has flagged action items. Complete the requests below before the case can move forward.'
      : atty.review_decision
        ? `Attorney decision: ${atty.review_decision}. Follow up with the client on next steps.`
        : [
            'Case is with the attorney. Monitor for instructions and maintain client communication.',
            ...attyContextLines,
          ].join(' | ')

    if (attorneyComments) {
      checklist.push({
        id:   'attorney_comments',
        icon: '💬',
        what: 'Attorney comments on file',
        how:  [attorneyComments],
        then: 'Review and act on attorney comments as needed.',
      })
    }

    if (atty.ai_instructions) {
      checklist.push({
        id:   'attorney_instructions',
        icon: '⚖️',
        what: 'Attorney instructions',
        how:  [atty.ai_instructions],
        then: 'Complete attorney\'s instructions and update HubSpot notes.',
        note: atty.ai_instructions,
      })
    }

    if (atty.clarification_needed) {
      checklist.push({
        id:   'attorney_clarification',
        icon: '❓',
        what: 'Attorney needs clarification',
        how: [
          `Attorney note: "${atty.clarification_needed}"`,
          `Contact ${firstName} to get this information, then log the response in HubSpot notes.`,
        ],
        then: 'Relay the clarification back to the attorney team.',
        note: atty.clarification_needed,
        template: {
          type:  'sms',
          label: 'Request clarification from client',
          body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nOur attorney reviewing your case has a quick question about your ${vehicle}. Could you give us a call at (855) 435-3666 when you get a chance? It\'ll only take a moment and will help us move your case forward. Thanks! 🍋`,
        },
      })
    }

    if (atty.repairs_needed_note) {
      checklist.push({
        id:   'attorney_repairs_needed',
        icon: '🔧',
        what: 'Attorney: additional repair visits needed',
        how: [
          `Attorney note: "${atty.repairs_needed_note}"`,
          `Let ${firstName} know they need to continue taking the vehicle to the dealer for documented repair visits.`,
          'Encourage them to request written service records from every visit.',
        ],
        then: 'Once the additional visits are documented, the case can re-enter attorney review.',
        template: {
          type:  'sms',
          label: 'Inform client — more visits needed',
          body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nOur attorney has reviewed your case and wants to see a few more documented visits to the dealership before we can proceed. Each time you bring in the ${vehicle}, make sure to get the paperwork.\n\nOnce you\'ve had another visit or two, reach out and we\'ll continue building your case. Any questions? Call (855) 435-3666 anytime! 🍋`,
        },
      })
    }

    if (atty.nurture_decision) {
      checklist.push({
        id:   'attorney_nurture_decision',
        icon: '📋',
        what: 'Attorney nurture decision to action',
        how: [
          `Attorney decision: "${atty.nurture_decision}"`,
          'Review the decision and take the appropriate follow-up action.',
          'Update HubSpot stage if required.',
        ],
        then: 'Document the action taken in HubSpot notes.',
        note: atty.nurture_decision,
      })
    }

    if (!hasInstructions && atty.review_decision) {
      checklist.push({
        id:   'communicate_decision',
        icon: '📞',
        what: `Communicate attorney decision to ${firstName}`,
        how: [
          `Attorney decision: ${atty.review_decision}`,
          `Call or text ${firstName} to explain next steps based on this decision.`,
          'Log the conversation in HubSpot.',
        ],
        then: 'Update case stage based on the decision and client response.',
      })
    }

    if (!hasInstructions && !atty.review_decision) {
      checklist.push({
        id:   'client_checkin',
        icon: '💬',
        what: 'Maintain client communication while under review',
        how: [
          `Check in with ${firstName} to let them know their case is being reviewed.`,
          'Attorney review typically takes 24–48 hours.',
          `If ${cs.days_since_contact !== null && cs.days_since_contact > 3 ? `it\'s been ${cs.days_since_contact} days since last contact — ` : ''}a quick check-in is appropriate.`,
        ],
        then: 'Attorney will provide instructions or a decision. Monitor HubSpot for updates.',
        template: {
          type:  'sms',
          label: 'Attorney review check-in',
          body:  `Hi ${firstName}! Just a quick update — your case documents are currently under review by our attorneys. We\'ll reach out as soon as they have their assessment ready. In the meantime, if you have any questions don\'t hesitate to call us at (855) 435-3666. Thanks for your patience! 🍋`,
        },
      })
    }

    next_steps.push(hasInstructions
      ? 'Complete attorney\'s action items and update HubSpot notes.'
      : atty.review_decision
        ? `Follow up with ${firstName} on attorney decision: ${atty.review_decision}`
        : 'Monitor for attorney instructions. Check in with client if >3 days since last contact.')

    return {
      stage_goal, situation, checklist, next_steps,
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'attorney_review', last_call_key_points: [], attorney_has_instructions: hasInstructions },
    }
  }

  // ── STAGE: INFO NEEDED ────────────────────────────────────────────────────
  if (stage === 'info_needed') {
    const infoNeeded    = atty.clarification_needed || atty.ai_instructions
    const infoProvided  = hp['attorney_review_clarification_provided__notes_']
      ? String(hp['attorney_review_clarification_provided__notes_']) : null
    const clientResponded = !!infoProvided

    const stage_goal = clientResponded && infoNeeded
      ? `Client has responded to attorney's request. Route case back to Attorney Review.`
      : infoNeeded
        ? `Attorney needs specific information before the review can continue: ${infoNeeded.slice(0, 120)}${infoNeeded.length > 120 ? '…' : ''}`
        : `Get missing information from ${firstName} so the attorney review can continue.`

    checklist.push({
      id:   'get_missing_info',
      icon: '❓',
      what: clientResponded
        ? 'Client has provided clarification'
        : infoNeeded ? 'Get attorney-requested information from client' : 'Identify and collect missing information',
      how: [
        ...(infoNeeded ? [`Attorney requested: "${infoNeeded}"`] : [`Review the case notes for what information is outstanding.`]),
        ...(infoProvided ? [`Client provided: "${infoProvided}"`] : [
          `Contact ${firstName} directly — call is faster than SMS for specific questions.`,
          'Log the response in HubSpot notes immediately after the call.',
        ]),
      ],
      then: clientResponded
        ? 'Route case back to Attorney Review — attorney has the information they need.'
        : 'Once the information is received and logged, route back to Attorney Review.',
      ...(!clientResponded ? { template: {
        type:  'sms' as const,
        label: 'Request missing information',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nOur attorney has a quick question about your case that we need your help with. Could you give us a call at (855) 435-3666 when you get a chance? It\'s a quick question and will help us move forward. Thanks! 🍋`,
      }} : {}),
    })

    if (clientResponded) {
      checklist.push({
        id:   'route_back_to_review',
        icon: '↩️',
        what: 'Route case back to Attorney Review',
        how: [
          'Client has provided the requested information.',
          'Update HubSpot stage to Attorney Review.',
          'Notify the handling attorney that clarification has been provided.',
        ],
        then: 'Attorney will complete their review with the new information.',
      })
      next_steps.push(`Client responded. Route ${firstName}'s case back to Attorney Review.`)
    } else {
      next_steps.push(`Get missing information from ${firstName}, log in HubSpot, and route back to Attorney Review.`)
    }

    return {
      stage_goal, situation, checklist, next_steps,
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'info_needed', last_call_key_points: [], attorney_has_instructions: true },
    }
  }

  // ── STAGE: SIGN UP (closedwon — client approved, needs retainer) ──────────
  if (stage === 'sign_up') {
    const stage_goal = `${firstName} has been approved. Get the retainer agreement signed so the case can move to active litigation.`

    checklist.push({
      id:   'send_retainer',
      icon: '✍️',
      what: 'Send retainer agreement via PandaDoc',
      how: [
        'Go to PandaDoc and send the retainer agreement to the client\'s email address.',
        `Confirm ${firstName}'s email address is correct in HubSpot before sending.`,
        'Set a follow-up reminder for 24 hours if not signed.',
      ],
      then: 'Once signed, the case moves to active litigation and a demand letter can be prepared.',
    })

    checklist.push({
      id:   'retainer_followup',
      icon: '📬',
      what: `Follow up if retainer hasn\'t been signed`,
      how: [
        `If PandaDoc shows the retainer is still unsigned after 24 hours, contact ${firstName}.`,
        'Send the SMS template below or call to walk them through signing.',
        'PandaDoc link is included in their original email — they can sign from any device.',
      ],
      then: 'Once retainer is signed, update HubSpot to Retained.',
      template: {
        type:  'sms',
        label: 'Retainer follow-up',
        body:  `Hi ${firstName}! Great news — your lemon law case has been approved by our attorneys! 🍋\n\nThe last step is signing your retainer agreement, which we sent to your email. It only takes a minute to sign on any device.\n\nIf you have any questions or can\'t find the email, give us a call at (855) 435-3666 and we\'ll help right away. We\'re excited to get your case moving!`,
      },
    })

    next_steps.push(`Send retainer via PandaDoc. Follow up with ${firstName} within 24 hours if not signed.`)

    return {
      stage_goal, situation, checklist, next_steps,
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'sign_up', last_call_key_points: [], attorney_has_instructions: false },
    }
  }

  // ── STAGE: RETAINED (active case) ─────────────────────────────────────────
  if (stage === 'retained') {
    const stage_goal = `${firstName}\'s case is active. Monitor demand letter progress and maintain regular client communication.`

    checklist.push({
      id:   'case_status_check',
      icon: '⚖️',
      what: 'Check current case status',
      how: [
        'Review Filevine for the current demand/litigation status.',
        'Check if a demand letter has been sent and if the manufacturer has responded.',
        `If ${cs.days_since_contact !== null && cs.days_since_contact > 7 ? `it\'s been ${cs.days_since_contact} days since last contact — a check-in is overdue` : 'last contact was recent'}.`,
      ],
      then: 'Log any updates in HubSpot and keep the client informed.',
    })

    checklist.push({
      id:   'client_update',
      icon: '💬',
      what: 'Provide client status update',
      how: [
        `${firstName} should be updated on case progress at least every 2 weeks.`,
        'Call is preferred — gives the client a chance to ask questions.',
        'Log the conversation in HubSpot after the call.',
      ],
      then: 'Client should always know the current status and expected next steps.',
      template: {
        type:  'sms',
        label: 'Active case check-in',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nJust checking in on your case — we\'re actively working on it and wanted to give you an update. Give us a call at (855) 435-3666 when you have a moment and we\'ll walk you through where things stand. Thanks! 🍋`,
      },
    })

    next_steps.push('Review case status in Filevine. Provide client update if >7 days since last contact.')

    return {
      stage_goal, situation, checklist, next_steps,
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'retained', last_call_key_points: [], attorney_has_instructions: false },
    }
  }

  // ── STAGE: SETTLED ────────────────────────────────────────────────────────
  if (stage === 'settled') {
    const stage_goal = `${firstName}\'s case has been resolved. Complete settlement documentation and close the file.`

    checklist.push({
      id:   'settlement_docs',
      icon: '📑',
      what: 'Confirm settlement documentation is complete',
      how: [
        'Verify settlement agreement is signed and on file.',
        'Confirm disbursement has been processed.',
        'Upload all final documents to SharePoint.',
      ],
      then: 'Case can be fully closed once documentation is complete.',
    })

    checklist.push({
      id:   'client_closeout',
      icon: '🎉',
      what: 'Complete client closeout',
      how: [
        `Call ${firstName} to confirm they\'ve received their settlement.`,
        'Request a review or referral if the client is satisfied.',
        'Log final notes in HubSpot and mark case closed.',
      ],
      then: 'Case is fully resolved.',
    })

    next_steps.push('Complete settlement documentation and close the file in HubSpot.')

    return {
      stage_goal, situation, checklist, next_steps,
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'settled', last_call_key_points: [], attorney_has_instructions: false },
    }
  }

  // ── STAGE: DROPPED ────────────────────────────────────────────────────────
  if (stage === 'dropped') {
    return {
      stage_goal:  'Case is closed.',
      situation,
      checklist:   [],
      next_steps:  [],
      faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
      _context: { repair_status: cs.repair_status, nurture_scenario: 'dropped', last_call_key_points: [], attorney_has_instructions: false },
    }
  }

  // ── STAGE: NURTURE (default — most complex scenario logic) ────────────────
  const nurture_scenario_var = (() => {
    if (cs.waiting_manufacturer)                                         return 'waiting_manufacturer'
    if (cs.waiting_threshold)                                            return 'waiting_threshold'
    if (cs.waiting_more_repairs && cs.repair_status !== 'repairs_completed') return 'waiting_more_repairs'
    if (cs.has_service_records && cs.attorney_requests.length === 0)     return 'docs_received'
    return 'standard'
  })()

  let stage_goal = ''
  const nurture_scenario = nurture_scenario_var

  if (cs.waiting_manufacturer) {
    stage_goal = 'Follow up to check whether the client has heard from the manufacturer, and confirm the status of any recent dealer visits.'
  } else if (cs.waiting_threshold) {
    stage_goal = "Monitor the client\'s dealer visits and time in the shop to determine when the Lemon Law threshold has been reached."
  } else if (cs.waiting_more_repairs && cs.repair_status !== 'repairs_completed') {
    stage_goal = 'Stay in contact while the client continues to document dealer visits. Collect service records from each visit.'
  } else if (cs.has_service_records && cs.attorney_requests.length === 0) {
    stage_goal = 'Service records are on file. This case is ready for attorney review.'
  } else {
    stage_goal = 'Collect service records from all dealer visits so our attorneys can evaluate the case.'
  }

  // 1. MANUFACTURER FOLLOW-UP
  if (cs.waiting_manufacturer) {
    checklist.push({
      id:   'manufacturer_followup',
      icon: '🏭',
      what: 'Follow up on manufacturer contact',
      how: [
        `Ask ${firstName} directly: "Have you heard anything back from the manufacturer about your vehicle?"`,
        'If yes — find out what was offered, when they received it, and whether they accepted or declined.',
        'If no — encourage them to contact the manufacturer directly, and let them know we will continue monitoring the case.',
        'Log the outcome in HubSpot notes.',
      ],
      then: `Once we know the manufacturer\'s position, our attorneys will factor that into the case assessment.`,
      template: {
        type:  'sms',
        label: 'Send manufacturer check-in',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nWe wanted to check in on your ${vehicle}. Have you heard anything back from the manufacturer yet? If so, we\'d love to know what they said.\n\nAlso — has your car been back to the dealership since we last spoke? Any new visits are important for us to track.\n\nReply anytime or call us at (855) 435-3666 — we\'re here!`,
      },
    })
  }

  // 2. SERVICE RECORDS (visits, no repairs)
  if (!cs.has_service_records && cs.repair_status === 'visits_no_repairs') {
    checklist.push({
      id:   'service_records',
      icon: '🔧',
      what: 'Service records from each dealer visit',
      how: [
        `Ask ${firstName} to request copies of all service records from the dealership\'s service department — this includes every visit, even the ones where the dealership said they couldn\'t find anything.`,
        'These records document the dates the vehicle was brought in, what the dealership inspected, and whether or not a diagnosis was made.',
        `${firstName} can call the service department and ask: "Can I get copies of all service records for my vehicle?" Dealers are required to provide these.`,
        'They can take a photo of each record and reply to your text.',
      ],
      then: 'Once we have service records from all visits, our attorneys will review them and reach out with their assessment.',
      template: {
        type:  'sms',
        label: 'Send service records request',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nTo continue building your case, we need copies of the paperwork from your dealership visits — even the ones where they said they couldn\'t find the issue. These service records document every time you brought your ${vehicle} in, which is exactly what we need.\n\nHere\'s how to get them:\n1. Call the dealership\'s service department and ask for copies of all service records for your vehicle\n2. Or if you have any paperwork from your visits at home, take a photo and reply to this text\n\nEvery visit counts — even when the dealership couldn\'t diagnose the problem. Once we have these, our attorneys will take a look and let you know next steps. Reply here or call us at (855) 435-3666 anytime! 🍋`,
      },
    })
  }

  // 3. FIRST VISIT (no visits yet)
  if (!cs.has_service_records && cs.repair_status === 'no_visits') {
    checklist.push({
      id:   'first_visit',
      icon: '🔧',
      what: 'Encourage first documented dealer visit',
      how: [
        `Ask ${firstName} whether the vehicle is still experiencing the reported issues.`,
        'If the issue is still happening, encourage them to bring the vehicle to the dealer as soon as possible and ask for a written service record.',
        'Every dealer visit — even one where the dealership says "no fault found" — creates a documented record that helps the case.',
        'Ask them to save all paperwork and send you a photo after each visit.',
      ],
      then: 'Once a service record is on file, our attorneys can begin evaluating the case.',
      template: {
        type:  'sms',
        label: 'Send first visit encouragement',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nJust checking in — is your ${vehicle} still having issues? If so, we\'d encourage you to bring it to the dealership as soon as you can and ask them to document the visit in writing.\n\nEven if they say they can\'t find anything, that paperwork matters for your case. After each visit, save the documents and feel free to send us a photo by replying to this text.\n\nWe\'re here to help! Call us at (855) 435-3666 with any questions.`,
      },
    })
  }

  // 4. REPAIR ORDERS (repairs completed)
  if (cs.repair_status === 'repairs_completed' && !cs.has_repair_orders) {
    checklist.push({
      id:   'repair_orders',
      icon: '📄',
      what: 'Repair orders from completed repairs',
      how: [
        `Ask ${firstName} for copies of the paperwork from each completed repair visit.`,
        'If they have copies at home, a photo replied to your text is perfect.',
        'If not, they can call the service department and request copies.',
      ],
      then: 'Once repair orders are on file, our attorneys will review the documentation and reach out with next steps.',
      template: {
        type:  'sms',
        label: 'Send repair order request',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nTo move your case forward, we need copies of the repair paperwork from your dealership visits — the service records from each time your ${vehicle} was in for repairs.\n\nIf you have them at home, just take a photo and reply to this text! If not, you can call the dealership\'s service department and request copies. Once we have these, our attorneys will review everything and reach out with next steps. 🍋\n\n(855) 435-3666`,
      },
    })
  }

  // 5. PURCHASE AGREEMENT (attorney requested)
  if (cs.attorney_requests.includes('purchase_agreement') && !cs.has_purchase_agmt) {
    checklist.push({
      id:   'purchase_agreement',
      icon: '🤝',
      what: 'Purchase or lease agreement',
      how: [
        `Ask ${firstName} for the contract signed when purchasing the ${vehicle}.`,
        'This is a multi-page document from the dealership\'s finance department.',
        'If they don\'t have it, the finance department can provide a copy.',
      ],
      then: 'Once the purchase agreement is on file, the attorney review can continue.',
      template: {
        type:  'sms',
        label: 'Send purchase agreement request',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nOur attorney reviewing your case has requested a copy of your vehicle\'s purchase or lease agreement — the contract you signed at the dealership when you got your ${vehicle}.\n\n1. If you have it at home, take a photo and reply to this text\n2. If not, contact the dealership\'s finance department — they can provide a copy\n\nOnce we have this, your attorney can finalize their review. Thanks so much! Reply or call (855) 435-3666 anytime.`,
      },
    })
  }

  // 6. DOCS RECEIVED — ready for review
  if (cs.has_service_records && cs.attorney_requests.length === 0) {
    next_steps.push('Service records are on file. Confirm the case is flagged for attorney review.')
  }

  return {
    stage_goal,
    situation,
    checklist,
    next_steps,
    faqs: generateFAQs(stage, cs.state, vehicle, firstName, cs),
    _context: {
      repair_status:             cs.repair_status,
      nurture_scenario,
      last_call_key_points:      cs.last_call_summary ? [cs.last_call_summary] : [],
      attorney_has_instructions: cs.attorney_requests.length > 0,
    },
  }
}


// ── Stage-aware FAQ generator ─────────────────────────────────────────────────
// FAQs are written for the CASE MANAGER reading the guidance tab — they answer
// the questions clients most commonly ask at each stage so staff can respond
// accurately and confidently. State law data is injected where relevant.

function generateFAQs(
  stage:     string,
  stateCode: string,
  vehicle:   string,
  firstName: string,
  cs:        CaseState,
): { q: string; a: string }[] {

  const law      = STATE_LAWS[stateCode.toUpperCase()] ?? null
  const stateName = law?.name ?? 'your state'
  const attempts  = law?.repairAttempts  ?? FEDERAL_LAW.repairAttempts
  const safetyAtt = law?.safetyAttempts  ?? FEDERAL_LAW.safetyAttempts
  const daysOOS   = law?.daysOOS         ?? FEDERAL_LAW.daysOOS
  const windowMo  = law?.windowMonths    ?? 24
  const windowMi  = law?.windowMiles     ?? 24000
  const remedies  = law?.remedies        ?? FEDERAL_LAW.remedies
  const nuances   = law?.keyNuances      ?? ''
  const statute   = law?.statute         ?? FEDERAL_LAW.statute

  // ── INTAKE ───────────────────────────────────────────────────────────────
  if (stage === 'intake') return [
    {
      q: `Does ${firstName}'s car qualify for lemon law?`,
      a: `Under ${stateName} law (${statute}), a vehicle qualifies if it has a substantial defect covered by warranty that the manufacturer failed to fix after ${attempts} repair attempt${attempts !== 1 ? 's' : ''} (${safetyAtt} for safety defects), or if the vehicle was out of service for ${daysOOS}+ cumulative days — all within ${windowMo} months or ${windowMi.toLocaleString()} miles of purchase. Federal law (Magnuson-Moss) may also apply and covers the entire warranty period. We evaluate both automatically.`,
    },
    {
      q: 'What if they only had one or two visits?',
      a: `${attempts > 2 ? `${stateName} typically requires ${attempts} attempts for the same defect` : `${stateName} may qualify with fewer attempts`}, but federal law applies a "reasonable number" standard — sometimes 1–2 visits are enough for serious safety defects. The severity of the issue matters. Even visits where the dealer found nothing count toward the record. Get all service records and let the attorneys evaluate.`,
    },
    {
      q: "Is this actually free?",
      a: "Yes. Easy Lemon and RockPoint Law work on contingency — no fees unless we win. Under lemon law statutes, the manufacturer pays attorney fees if the client prevails. The client pays nothing out of pocket at any point.",
    },
    {
      q: "How long does the process take?",
      a: "Once we have service records, attorney review takes 24–48 hours. If we have a strong case, demand letters typically get a manufacturer response within 30–60 days. Many cases settle in 60–90 days total. Complex cases or litigation can take longer.",
    },
    {
      q: `What if ${firstName} is still making car payments?`,
      a: "They should continue making payments while the case is active — stopping payments can harm their credit and create complications. A successful lemon law case can result in a full buyback that pays off their loan balance, so continued payments protect both their credit and their legal position.",
    },
  ]

  // ── NURTURE ───────────────────────────────────────────────────────────────
  if (stage === 'nurture') return [
    {
      q: `How many repair visits does ${firstName} need in ${stateName}?`,
      a: `${stateName} law (${statute}) requires ${attempts} repair attempt${attempts !== 1 ? 's' : ''} for the same defect, or ${safetyAtt} attempt${safetyAtt !== 1 ? 's' : ''} for a safety defect, within ${windowMo} months or ${windowMi.toLocaleString()} miles of purchase. Federal law also applies simultaneously and uses a "reasonable number" standard — courts typically agree ${attempts >= 4 ? '3–4' : '2–3'} is sufficient.${nuances ? ` Note: ${nuances}` : ''}`,
    },
    {
      q: "What if the dealer said they couldn't find anything wrong?",
      a: `That's actually helpful for the case. Every visit — including "no fault found" visits — counts as a documented repair attempt. The key is the written record showing ${firstName} brought the vehicle in and reported the defect. "Couldn't diagnose" or "unable to reproduce" entries are legitimate documentation.`,
    },
    {
      q: `Does ${vehicle} need to be in the shop right now?`,
      a: "No. The vehicle can be in their possession while the case is being built. What matters is the historical repair record. However, if the issue is still happening, we do encourage them to continue taking it to the dealer — each additional documented visit strengthens the case.",
    },
    {
      q: "What happens after we get the service records?",
      a: "Our attorneys review the records and evaluate the pattern of defects, repair attempts, and time in the shop against both state and federal lemon law thresholds. They'll determine the strength of the case and what remedy to pursue — repurchase, replacement, or cash settlement.",
    },
    {
      q: `What remedies is ${firstName} entitled to?`,
      a: `Under ${stateName} law: ${remedies}. In a repurchase, the manufacturer refunds the full purchase price minus a "reasonable use" deduction for miles driven before the first repair visit. Most clients choose the repurchase. Attorney fees are also recovered from the manufacturer.`,
    },
  ]

  // ── DOCUMENT COLLECTION ───────────────────────────────────────────────────
  if (stage === 'document_collection') return [
    {
      q: `What documents does ${firstName} actually need to provide?`,
      a: `The two most important documents are: (1) Repair orders from every dealership visit — even visits where the dealer said they couldn't find anything. (2) The purchase or lease agreement from when ${firstName} bought the ${vehicle}. These two documents are the foundation of the case.`,
    },
    {
      q: `What if ${firstName} doesn't have their service records?`,
      a: `They don't need to have them at home. The dealership's service department is required to maintain records of every visit. ${firstName} can call the service department and ask for copies of all service records for their vehicle — they must provide them. It usually takes 1–2 business days.`,
    },
    {
      q: "What if some repair visits were at different dealerships?",
      a: "Records from every authorized dealership count — visits don't have to be at the same location. They should collect records from each dealership they visited. All visits for the same defect are counted together regardless of which dealer performed the work.",
    },
    {
      q: "Can they just take a photo of the documents?",
      a: "Yes — a clear photo of each page is perfect. They can text photos directly to us. The documents just need to be legible and show the date, vehicle information, and what was done (or attempted). PDFs from the dealership also work.",
    },
    {
      q: "What if the purchase agreement can't be found?",
      a: "The dealership's finance department keeps a copy of every purchase agreement on file. If they contact the finance department and reference the date of purchase and vehicle VIN, they can get a copy within a few days. Their lender (if they financed) may also have a copy.",
    },
  ]

  // ── ATTORNEY REVIEW ───────────────────────────────────────────────────────
  if (stage === 'attorney_review') return [
    {
      q: `What are the attorneys actually reviewing?`,
      a: `They're evaluating: (1) whether the defect qualifies under ${stateName} law or federal law, (2) the number and pattern of repair attempts vs. the statutory threshold (${attempts} attempts or ${daysOOS}+ days out of service), (3) whether the defect is still within the warranty window (${windowMo} months/${windowMi.toLocaleString()} miles), and (4) the strength of the documentation. They also calculate the potential buyback value.`,
    },
    {
      q: "How long does attorney review take?",
      a: "Typically 24–48 hours for straightforward cases. If the attorney needs additional information or has questions about the repair history, it may take slightly longer. We'll reach out as soon as there's an update.",
    },
    {
      q: "Will the attorney contact the client directly?",
      a: "Not at this stage. Our case managers handle all client communication during the review. Once the attorney completes their assessment, we'll relay the findings and next steps to the client.",
    },
    {
      q: `What are ${firstName}'s chances?`,
      a: `We only submit cases to attorney review when we believe there's a viable claim — so the fact that we're here is a positive signal. Qualification depends on the specific repair history vs. the legal threshold. Once the attorney finishes, we'll have a clear picture of the path forward.`,
    },
    {
      q: "What if the attorney needs more information?",
      a: "If the attorney needs clarification or additional documents, the case will move to 'Info Needed' status and we'll reach out to the client with specific requests. This is normal and doesn't mean the case is weak — it just means we need one more piece to complete the evaluation.",
    },
  ]

  // ── INFO NEEDED ───────────────────────────────────────────────────────────
  if (stage === 'info_needed') return [
    {
      q: "Does 'Info Needed' mean there's a problem with the case?",
      a: `Not at all. It means our attorney is actively engaged and identified a specific question or document they need before completing the review. This is a normal part of the process — it usually means the attorney sees something worth clarifying before making a determination.`,
    },
    {
      q: `How quickly does ${firstName} need to respond?`,
      a: "The faster we can get the requested information, the faster the attorney can complete their review. We'd encourage a response within 1–2 business days to keep the case moving. If there's a delay, just let us know — cases don't expire.",
    },
    {
      q: "What typically gets requested at this stage?",
      a: "Most common requests: (1) clarification about a specific repair visit, (2) a missing service record from one visit, (3) the purchase or lease agreement, or (4) details about the nature of the defect. It's usually one specific item, not a large document request.",
    },
    {
      q: "What happens after the information is provided?",
      a: "The case goes back to attorney review with the new information. The attorney typically completes their assessment within 24–48 hours of receiving what they requested.",
    },
  ]

  // ── SIGN UP ───────────────────────────────────────────────────────────────
  if (stage === 'sign_up') return [
    {
      q: "Is there anything to pay upfront?",
      a: "Absolutely not. RockPoint Law works on contingency — there are no upfront fees, no hourly charges, and no costs to the client at any point. If we win, attorney fees are paid by the manufacturer under lemon law statutes. If for any reason the case doesn't succeed, the client owes nothing.",
    },
    {
      q: "What exactly is the retainer agreement?",
      a: `It's an agreement authorizing RockPoint Law to represent ${firstName} in their lemon law claim. It confirms the contingency fee arrangement (no win, no fee), gives the firm authority to contact the manufacturer and dealership on the client's behalf, and outlines how the case will be handled. It's standard for lemon law representation.`,
    },
    {
      q: "What if they change their mind after signing?",
      a: "The retainer can be canceled — clients can withdraw from representation at any time before a settlement is reached. However, once a demand letter has been sent or formal legal action started, there may be case costs to consider. In practice, very few clients withdraw once the case is underway.",
    },
    {
      q: "What happens after they sign?",
      a: `Once the retainer is signed, RockPoint Law becomes the client's legal representative. The next step is preparing and sending a formal demand letter to the manufacturer. Manufacturers typically respond within 30–60 days. Most cases resolve in 60–90 days total — often without going to court.`,
    },
    {
      q: `What will ${firstName} actually get out of this?`,
      a: `Under ${stateName} law, the likely outcome is a vehicle repurchase — the manufacturer buys back the ${vehicle} at the full purchase price minus a mileage deduction for use before the first repair visit. Or they may offer a cash settlement or replacement vehicle. Attorney fees are also recovered. Most clients walk away debt-free on the vehicle.`,
    },
  ]

  // ── RETAINED ─────────────────────────────────────────────────────────────
  if (stage === 'retained') return [
    {
      q: "How long will the case take from here?",
      a: "Once a demand letter is sent, manufacturers typically respond within 30–60 days. Settlement negotiations can take another 2–8 weeks. Total timeline from demand to settlement: typically 60–120 days. Cases that go to arbitration or litigation take longer — 6–18 months — but most settle before that.",
    },
    {
      q: "What's happening with the case right now?",
      a: "RockPoint Law is either preparing or has sent a formal demand letter to the manufacturer. The letter outlines the legal violations, the evidence, and the remedy requested. Once sent, we're in a negotiation phase — the manufacturer has the opportunity to respond with a settlement offer.",
    },
    {
      q: `Should ${firstName} keep driving the ${vehicle}?`,
      a: "Yes — they should continue using the vehicle normally unless there's a safety concern. Continuing to drive it doesn't affect the legal claim. They should document any new issues or dealer visits, but they don't need to stop driving or return the vehicle until a settlement is reached.",
    },
    {
      q: "What if the manufacturer makes a low offer?",
      a: "Our attorneys will negotiate. A first offer is rarely the best offer. RockPoint Law will counter with the appropriate legal remedy — which under lemon law is typically a full repurchase. The firm won't recommend a settlement that isn't in the client's best interest.",
    },
    {
      q: "Does the client need to do anything right now?",
      a: "Just stay reachable. If the manufacturer or our attorneys need information during negotiations, we'll reach out. The client shouldn't communicate directly with the manufacturer or dealership about the legal claim — all contact should go through RockPoint Law.",
    },
  ]

  // ── SETTLED ──────────────────────────────────────────────────────────────
  if (stage === 'settled') return [
    {
      q: "When will the settlement funds be received?",
      a: "After the settlement agreement is signed, disbursement typically takes 2–4 weeks. The manufacturer processes the buyback or settlement payment, the lender (if any) is paid off, and the remaining funds go to the client. The firm will coordinate the logistics.",
    },
    {
      q: "Is there anything the client needs to do?",
      a: "For a vehicle repurchase: they'll need to sign the settlement agreement (if not done), return the vehicle at the agreed date/location, and provide the title and keys. RockPoint Law will walk them through each step. For a cash settlement, it's simpler — just sign and wait for the check.",
    },
    {
      q: "What about their existing car loan?",
      a: "In a repurchase, the manufacturer pays the lender directly to satisfy the outstanding loan balance. Any remaining amount (equity) goes to the client. If the loan balance exceeds the settlement amount, the gap is usually negotiated as part of the settlement terms.",
    },
    {
      q: "Could they have gotten more?",
      a: "RockPoint Law negotiates to the maximum legally recoverable amount under applicable law. The settlement reflects the full statutory remedy available. Any additional amount would require litigation with uncertain outcome — the firm won't recommend holdout that isn't in the client's interest.",
    },
  ]

  // ── DROPPED / DEFAULT ─────────────────────────────────────────────────────
  return []
}

// ── Timeline builder ──────────────────────────────────────────────────────────

function buildTimeline(engagements: HsEngagement[]): IntelligenceReport['tier2_comms']['timeline'] {
  function extractShortSummary(eng: HsEngagement): string {
    if (eng.type === 'NOTE') {
      return stripHtml(eng.body || '').trim().slice(0, 300) || 'Note logged.'
    }
    if (eng.type === 'CALL') {
      const raw  = eng.callSummary || eng.body || ''
      const text = stripHtml(raw).trim()
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 15)
      const meaningful = lines.filter(l =>
        !/^(summary|key notes?|topics? discussed|call summary|lemon law details|reason for|solutions|pitches|actions taken|compliance|call disposition|call outcomes?|agent action|customer action|customer questions?)/i.test(l)
      )
      return meaningful.slice(0, 3).join(' ').slice(0, 400) || 'Call completed.'
    }
    return stripHtml(eng.body || '').slice(0, 200) || `${eng.type} logged.`
  }

  function extractAgent(eng: HsEngagement): string | undefined {
    const match = stripHtml(eng.body || '').match(/^([A-Z][a-z]+ [A-Z][a-z]+)/)
    return match ? match[1] : undefined
  }

  return engagements
    .filter(e => e.type !== 'TASK')
    .map(e => ({
      id:        e.id,
      type:      e.type,
      date:      e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString(),
      direction: e.direction,
      agent:     extractAgent(e),
      summary:   extractShortSummary(e),
    }))
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: dealId } = await params

  const { data: caseRow, error } = await supabaseAdmin
    .schema('core')
    .from('cases')
    .select('id, hubspot_deal_id, case_status, client_first_name, client_last_name, client_phone, hubspot_properties, hubspot_contact_properties')
    .eq('hubspot_deal_id', dealId)
    .single()

  if (error || !caseRow) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const caseUUID   = caseRow.id as string
  const hp         = (caseRow.hubspot_properties as Record<string, unknown> | null) ?? {}
  const clientName = [caseRow.client_first_name, caseRow.client_last_name].filter(Boolean).join(' ') || 'Client'

  // ── Tier 2: Engagements ───────────────────────────────────────────────────
  const engagements = await fetchEngagements(dealId).catch(() => [] as HsEngagement[])
  const calls = engagements.filter(e => e.type === 'CALL')
  const notes = engagements.filter(e => e.type === 'NOTE')

  const callSummaries = calls
    .map(c => stripHtml(c.callSummary || c.body || ''))
    .filter(Boolean).map(s => s.slice(0, 800))

  const keyFacts: string[] = []
  for (const eng of engagements) {
    const text = stripHtml(eng.body || '')
    const sentences = text.split(/[.\n]/).map(s => s.trim()).filter(s => s.length > 20 && s.length < 200)
    for (const s of sentences) {
      const l = s.toLowerCase()
      if (l.includes('repair') || l.includes('shop') || l.includes('days') || l.includes('threshold')) {
        if (!keyFacts.includes(s)) keyFacts.push(s)
        if (keyFacts.length >= 6) break
      }
    }
    if (keyFacts.length >= 6) break
  }

  const lastContactedRaw = hp['notes_last_contacted'] ? String(hp['notes_last_contacted']) : null
  const lastContactedMs  = lastContactedRaw
    ? (/^\d{13}$/.test(lastContactedRaw) ? parseInt(lastContactedRaw) : new Date(lastContactedRaw).getTime())
    : (calls[0]?.createdAt ?? null)
  const lastContactAt    = lastContactedMs ? new Date(lastContactedMs).toISOString() : null
  const daysSinceContact = lastContactedMs ? Math.floor((Date.now() - lastContactedMs) / 86_400_000) : null

  // ── Tier 3: Documents ─────────────────────────────────────────────────────
  const { data: docs } = await supabaseAdmin
    .schema('core').from('document_files')
    .select('document_type_code, file_name, extracted_text')
    .eq('case_id', caseUUID).eq('is_deleted', false)

  const docTypes  = [...new Set((docs ?? []).map(d => d.document_type_code).filter(Boolean))] as string[]
  const totalDocs = docs?.length ?? 0

  // ── Tier 1: Intake ────────────────────────────────────────────────────────
  const yr    = String(hp['vehicle_year']  ?? hp['what_is_the_approximate_year_of_your_vehicle_'] ?? '')
  const mk    = String(hp['vehicle_make']  ?? hp['what_is_the_make_of_your_vehicle_']  ?? '')
  const mdl   = String(hp['vehicle_model'] ?? hp['what_is_the_model_of_your_vehicle_'] ?? '')
  const vehicleStr = [yr, mk, mdl].filter(Boolean).join(' ') || null

  // ── Attorney fields ───────────────────────────────────────────────────────
  const attyClariNeeded  = hp['attorney_review_clarification_needed__notes_']  ? String(hp['attorney_review_clarification_needed__notes_'])  : null
  const attyNurtureDecis = hp['attorney_review_nurture_decision__notes_']       ? String(hp['attorney_review_nurture_decision__notes_'])       : null
  const attyRepairsNote  = hp['attorney_review__repairs_needed___instruct_pc_client_comment'] ? String(hp['attorney_review__repairs_needed___instruct_pc_client_comment']) : null
  const attyAiInstruct   = hp['attorney_nurture_instructions__ai_']             ? String(hp['attorney_nurture_instructions__ai_'])             : null
  const attyDecision     = hp['attorney_review_decision']                       ? String(hp['attorney_review_decision'])                       : null

  // ── Resolve case state (deterministic) ────────────────────────────────────
  const caseState = resolveCaseState(hp, engagements, docTypes, clientName)

  // ── AI guidance synthesis (Claude — Nurture only) ────────────────────────
  // Only run for Nurture stage: complex multi-signal reasoning justifies LLM cost.
  // All other stages use deterministic rule-based guidance (instant, no LLM cost).
  const stage           = String(caseRow.case_status)
  const stateLawSummary = buildStateLawSummary(caseState.state)
  let aiGuidance: Awaited<ReturnType<typeof synthesizeGuidance>> | null = null

  if (stage === 'nurture') {
    try {
      const synthInput = buildSynthesisInput({
        stage,
        caseRow: { client_first_name: caseRow.client_first_name, client_last_name: caseRow.client_last_name },
        hp,
        engagements,
        docFiles: (docs ?? []) as { file_name: string; document_type_code: string | null; extracted_text?: string | null }[],
        docTypes,
        daysSinceContact: (() => {
          const lastContacted = hp['notes_last_contacted'] ? String(hp['notes_last_contacted']) : null
          const ms = lastContacted
            ? (/^\d{13}$/.test(lastContacted) ? parseInt(lastContacted) : new Date(lastContacted).getTime())
            : (engagements[0]?.createdAt ?? null)
          return ms ? Math.floor((Date.now() - ms) / 86_400_000) : null
        })(),
        stateLawSummary,
      })
      aiGuidance = await synthesizeGuidance(synthInput)
    } catch (err) {
      console.error('[intelligence] AI synthesis failed, falling back to deterministic:', err)
    }
  }

  // ── Deterministic guidance (fallback) ────────────────────────────────────
  const deterministicGuidance = generateGuidance(
    caseState,
    stage,
    {
      clarification_needed: attyClariNeeded,
      nurture_decision:     attyNurtureDecis,
      repairs_needed_note:  attyRepairsNote,
      ai_instructions:      attyAiInstruct,
      review_decision:      attyDecision,
    },
    hp,
  )

  // Merge: AI guidance is primary; deterministic fills in faqs and _context
  const guidance = aiGuidance
    ? {
        ...aiGuidance,
        faqs:     deterministicGuidance.faqs,
        _context: deterministicGuidance._context,
      }
    : deterministicGuidance

  const missingCritical: string[] = []
  if (!caseState.has_service_records && !caseState.has_repair_orders) {
    missingCritical.push(caseState.repair_status === 'repairs_completed' ? 'Repair orders' : 'Service records')
  }

  const report: IntelligenceReport = {
    case_id:      caseUUID,
    deal_id:      dealId,
    stage:        String(caseRow.case_status),
    generated_at: new Date().toISOString(),
    client_name:  clientName,

    tier1_intake: {
      vehicle:        vehicleStr,
      issues:         caseState.issues,
      repair_count:   caseState.repair_status === 'repairs_completed' ? caseState.repair_count : null,
      purchase_date:  String(hp['purchase__lease_date'] ?? '') || null,
      state:          caseState.state,
      nurture_reason: hp['nurture__reason_'] ? String(hp['nurture__reason_']) : null,
      nurture_notes:  hp['nurture__notes_']  ? String(hp['nurture__notes_'])  : null,
    },
    tier2_comms: {
      total_engagements:  engagements.length,
      calls:              calls.length,
      notes:              notes.length,
      last_contact_at:    lastContactAt,
      days_since_contact: daysSinceContact,
      timeline:           buildTimeline(engagements),
      call_summaries:     callSummaries,
      key_facts:          keyFacts,
    },
    tier3_docs: {
      total_docs:        totalDocs,
      doc_types:         docTypes,
      has_repair_orders: caseState.has_repair_orders,
      has_purchase_agmt: caseState.has_purchase_agmt,
      missing_critical:  missingCritical,
    },
    attorney: {
      clarification_needed: attyClariNeeded,
      nurture_decision:     attyNurtureDecis,
      repairs_needed_note:  attyRepairsNote,
      ai_instructions:      attyAiInstruct,
      review_decision:      attyDecision,
      specific_requests:    caseState.attorney_requests,
    },
    guidance,
  }

  return NextResponse.json(report)
}
