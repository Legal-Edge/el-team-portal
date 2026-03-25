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

import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'
import { supabaseAdmin }             from '@/lib/supabase'

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

    const stage_goal = missingDocs.length === 0
      ? 'All required documents appear to be on file. Confirm with the attorney team before routing to Attorney Review.'
      : `Collect missing documents: ${missingDocs.join(', ')}.`

    if (!hasROs) {
      checklist.push({
        id:   'collect_repair_orders',
        icon: '📄',
        what: 'Repair orders from all completed dealer visits',
        how: [
          `Ask ${firstName} to pull the paperwork from each time the ${vehicle} was serviced.`,
          'These should show the date, complaint, diagnosis, and work performed.',
          'If they don\'t have copies, the dealership\'s service department can provide them.',
          'A clear photo replied to your text message works perfectly.',
        ],
        then: 'Once repair orders are received, our attorneys can begin their review.',
        template: {
          type:  'sms',
          label: 'Request repair orders',
          body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nTo move your case forward, we need copies of the repair paperwork from your dealership visits — the paperwork from each time your ${vehicle} was in for service.\n\nIf you have them at home, just take a photo and reply to this text! If not, call the dealership\'s service department and ask for copies of all service records.\n\nOnce we have these, our attorneys will review everything and reach out with next steps. 🍋\n\n(855) 435-3666`,
        },
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
      _context: { repair_status: cs.repair_status, nurture_scenario: 'document_collection', last_call_key_points: [], attorney_has_instructions: false },
    }
  }

  // ── STAGE: ATTORNEY REVIEW ────────────────────────────────────────────────
  if (stage === 'attorney_review') {
    const hasInstructions = !!(atty.clarification_needed || atty.repairs_needed_note || atty.ai_instructions || atty.nurture_decision)
    const stage_goal = hasInstructions
      ? 'Attorney has flagged action items. Complete the requests below before the case can move forward.'
      : atty.review_decision
        ? `Attorney decision: ${atty.review_decision}. Follow up with the client on next steps.`
        : 'Case is with the attorney. Monitor for instructions and maintain client communication.'

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
      _context: { repair_status: cs.repair_status, nurture_scenario: 'attorney_review', last_call_key_points: [], attorney_has_instructions: hasInstructions },
    }
  }

  // ── STAGE: INFO NEEDED ────────────────────────────────────────────────────
  if (stage === 'info_needed') {
    const infoNeeded = atty.clarification_needed || atty.ai_instructions
    const stage_goal = infoNeeded
      ? `Attorney needs specific information before the review can continue: ${infoNeeded.slice(0, 120)}...`
      : `Get missing information from ${firstName} so the attorney review can continue.`

    checklist.push({
      id:   'get_missing_info',
      icon: '❓',
      what: infoNeeded ? 'Get attorney-requested information from client' : 'Identify and collect missing information',
      how: infoNeeded
        ? [
            `Attorney has requested: "${infoNeeded}"`,
            `Contact ${firstName} directly — call is faster than SMS for specific questions.`,
            'Log the response in HubSpot notes immediately after the call.',
          ]
        : [
            `Review the case notes for what information is outstanding.`,
            `Contact ${firstName} and ask directly.`,
            'Document the answer in HubSpot.',
          ],
      then: 'Once the information is received and logged, route back to Attorney Review.',
      template: {
        type:  'sms',
        label: 'Request missing information',
        body:  `Hi ${firstName}! This is [Your Name] from Easy Lemon 🍋\n\nOur attorney has a quick question about your case that we need your help with. Could you give us a call at (855) 435-3666 when you get a chance? It\'s a quick question and will help us move forward. Thanks! 🍋`,
      },
    })

    next_steps.push(`Get missing information from ${firstName}, log in HubSpot, and route back to Attorney Review.`)

    return {
      stage_goal, situation, checklist, next_steps,
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
    _context: {
      repair_status:             cs.repair_status,
      nurture_scenario,
      last_call_key_points:      cs.last_call_summary ? [cs.last_call_summary] : [],
      attorney_has_instructions: cs.attorney_requests.length > 0,
    },
  }
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
    .select('document_type_code, file_name')
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

  // ── Resolve case state and generate guidance ──────────────────────────────
  const caseState = resolveCaseState(hp, engagements, docTypes, clientName)
  const guidance  = generateGuidance(
    caseState,
    String(caseRow.case_status),
    {
      clarification_needed: attyClariNeeded,
      nurture_decision:     attyNurtureDecis,
      repairs_needed_note:  attyRepairsNote,
      ai_instructions:      attyAiInstruct,
      review_decision:      attyDecision,
    },
    hp,
  )

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
