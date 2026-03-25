/**
 * AI-powered guidance synthesis for the Case Intelligence Engine.
 *
 * Feeds all available case signals (HubSpot properties, timeline, documents)
 * into Claude and gets back structured, actionable guidance.
 *
 * Falls back to deterministic guidance if the AI call fails.
 */

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

// ── Stage display names ───────────────────────────────────────────────────────
const STAGE_LABELS: Record<string, string> = {
  intake:              'Intake / Getting Started',
  nurture:             'Nurture / Action Needed',
  document_collection: 'Document Collection',
  attorney_review:     'Attorney Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up / Approved',
  retained:            'Retained / Active Case',
  settled:             'Settled',
  dropped:             'Dropped / Closed',
}

// ── HubSpot property groups per stage ────────────────────────────────────────
// We pull ALL non-empty props, but these are surfaced with friendly labels
// so Claude understands what it's looking at.

const PROP_LABELS: Record<string, string> = {
  // Universal
  nurture__reason_:                                               'Nurture reason',
  nurture__notes_:                                                'Nurture notes (staff)',
  notes_last_contacted:                                           'Last contacted',
  hs_v2_time_in_current_stage:                                    'Entered current stage',
  client_follow_up_attempts:                                      'Follow-up attempts',
  case_manager:                                                   'Case manager',
  current_case_lead:                                              'Case lead',
  case_summary:                                                   'Case summary',
  case_summary_overview__ai_:                                     'AI case overview',
  case_summary_attorney_decision__ai_:                            'AI attorney decision',
  case_summary_case_rating__ai_:                                  'AI case rating',
  case_summary_problems_reported__ai_:                            'AI problems reported',
  // Vehicle
  vehicle_year:                                                   'Vehicle year',
  vehicle_make:                                                   'Vehicle make',
  vehicle_model:                                                  'Vehicle model',
  what_is_the_approximate_year_of_your_vehicle_:                  'Vehicle year (intake)',
  what_is_the_make_of_your_vehicle_:                              'Vehicle make (intake)',
  what_is_the_model_of_your_vehicle_:                             'Vehicle model (intake)',
  // Intake
  el_app_status:                                                  'App status (intake)',
  // Nurture / qualification
  most_common_problem__notes_:                                    'Most common problem',
  second_most_common_problem__notes_:                             'Second problem',
  third_most_common_problem__notes_:                              'Third problem',
  have_you_had_any_repairs_done_to_your_vehicle_:                 'Repairs done (Y/N)',
  how_many_times_has_your_vehicle_been_repaired_for_the_issue_:   'Repair count',
  which_state_did_you_purchase_or_lease_your_vehicle_:            'State',
  // Document collection
  document_collection_status:                                     'Document collection status',
  document_collection_notes:                                      'Document collection notes',
  client_submitted_docs:                                          'Client submitted docs',
  do_you_have_the_repair_documents__or_would_you_need_to_get_it_from_the_dealership_: 'Has repair docs?',
  // Attorney review
  attorney_review_decision:                                       'Attorney review decision',
  attorney_review_clarification_needed__notes_:                   'Attorney: clarification needed',
  attorney_review_clarification_provided__notes_:                 'Attorney: clarification provided',
  attorney_review_nurture_decision__notes_:                       'Attorney: nurture decision',
  attorney_review__repairs_needed___instruct_pc_client_comment:   'Attorney: repairs needed note',
  attorney_nurture_instructions__ai_:                             'Attorney AI instructions',
  attorney_review_drop_decision__notes_:                          'Attorney: drop decision notes',
  attorney_comments:                                              'Attorney comments',
  case_preparation_questions:                                     'Case prep questions',
  // Legal / retained stage
  current_legal_stage:                                            'Current legal stage',
  date___demand_sent:                                             'Demand sent date',
  date___demand_approved:                                         'Demand approved date',
  date___settled:                                                 'Settled date',
  date___release_signed:                                          'Release signed date',
  demand_paralegal:                                               'Demand paralegal',
  claims_rep_full_name:                                           'Claims rep name',
  claims_rep_phone_number:                                        'Claims rep phone',
  claims_rep_email_address:                                       'Claims rep email',
  arbitration_management:                                         'Arbitration management',
  // Settlement
  c__total_settlement_amount:                                     'Total settlement amount',
  calculator___total_settlement_amount:                           'Calculator settlement amount',
  // Sign up
  closed_won_reason:                                              'Closed won reason',
  closed_lost_reason:                                             'Closed lost reason',
  // Drop
  buyback_denial_reason:                                          'Buyback denial reason',
  // Manufacturer
  did_the_manufacturer_offer_a_solution_like_a_refund__exchange_or_additional_repair_coverage_: 'Manufacturer offered solution?',
}

export interface SynthesisInput {
  stage:         string
  stageLabel:    string
  daysInStage:   number | null
  clientName:    string
  vehicle:       string
  state:         string
  stateLawSummary: string

  // HubSpot props — all non-empty, with friendly labels
  hubspotContext: { label: string; value: string }[]

  // Timeline — recent engagements summary
  timeline: {
    type:      string
    date:      string
    direction?: string
    agent?:    string
    summary:   string
  }[]
  daysSinceContact: number | null

  // Documents on file
  documents: {
    name:       string
    type:       string | null
    extracted:  boolean
  }[]
  missingCritical: string[]
}

export interface SynthesisOutput {
  stage_goal:  string
  situation:   string
  checklist: {
    id:       string
    icon:     string
    what:     string
    how:      string[]
    then:     string
    note?:    string
    template?: {
      type:  'sms' | 'call'
      label: string
      body:  string
    }
  }[]
  next_steps:  string[]
}

/**
 * Build the structured context object from raw case data.
 * Called by the intelligence route; result is passed to synthesizeGuidance().
 */
export function buildSynthesisInput(params: {
  stage:           string
  caseRow:         { client_first_name?: string | null; client_last_name?: string | null }
  hp:              Record<string, unknown>
  engagements:     { type: string; createdAt: number; callSummary?: string; body?: string; direction?: string }[]
  docFiles:        { file_name: string; document_type_code: string | null; extracted_text?: string | null }[]
  docTypes:        string[]
  daysSinceContact: number | null
  stateLawSummary: string
}): SynthesisInput {
  const { stage, caseRow, hp, engagements, docFiles, daysSinceContact, stateLawSummary } = params

  const firstName  = String(caseRow.client_first_name ?? 'Client')
  const lastName   = String(caseRow.client_last_name  ?? '')
  const clientName = [firstName, lastName].filter(Boolean).join(' ')

  const yr      = String(hp['vehicle_year']  ?? hp['what_is_the_approximate_year_of_your_vehicle_'] ?? '')
  const mk      = String(hp['vehicle_make']  ?? hp['what_is_the_make_of_your_vehicle_']  ?? '')
  const mdl     = String(hp['vehicle_model'] ?? hp['what_is_the_model_of_your_vehicle_'] ?? '')
  const vehicle = [yr, mk, mdl].filter(Boolean).join(' ') || 'their vehicle'

  const stateRaw = String(hp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? hp['state'] ?? '')
  const state    = stateRaw.length === 2 ? stateRaw.toUpperCase() : stateRaw.slice(0, 2).toUpperCase() || 'TN'

  // Days in current stage
  const enteredStageRaw = hp['hs_v2_time_in_current_stage'] ? String(hp['hs_v2_time_in_current_stage']) : null
  const enteredStageMs  = enteredStageRaw ? new Date(enteredStageRaw).getTime() : null
  const daysInStage     = enteredStageMs && !isNaN(enteredStageMs)
    ? Math.floor((Date.now() - enteredStageMs) / 86_400_000)
    : null

  // Build HubSpot context — label all non-empty known props
  const hubspotContext: { label: string; value: string }[] = []
  for (const [key, label] of Object.entries(PROP_LABELS)) {
    const val = hp[key]
    if (val !== null && val !== undefined && val !== '' && val !== false) {
      hubspotContext.push({ label, value: String(val).slice(0, 500) })
    }
  }

  // Timeline — last 15 engagements, summarized
  function stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(p|div|h[1-6]|li)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  }

  const timeline = engagements
    .filter(e => e.type !== 'TASK' && e.type !== 'MEETING')
    .slice(0, 15)
    .map(e => {
      const summary = e.type === 'CALL'
        ? (stripHtml(e.callSummary || e.body || '').slice(0, 600) || 'Call completed.')
        : stripHtml(e.body || '').slice(0, 400) || `${e.type} logged.`
      const agent = stripHtml(e.body || '').match(/^([A-Z][a-z]+ [A-Z][a-z]+)/)?.[1]
      return {
        type:      e.type,
        date:      new Date(e.createdAt).toISOString(),
        direction: e.direction,
        agent,
        summary,
      }
    })

  // Documents
  const documents = docFiles.map(f => ({
    name:      f.file_name,
    type:      f.document_type_code,
    extracted: !!(f.extracted_text && f.extracted_text.length > 0),
  }))

  const hasROs  = params.docTypes.includes('repair_order')
  const hasPA   = params.docTypes.includes('purchase_agreement')
  const missingCritical: string[] = []
  if (!hasROs) missingCritical.push('Repair orders')
  if (!hasPA)  missingCritical.push('Purchase or lease agreement')

  return {
    stage,
    stageLabel:       STAGE_LAWS_LABEL[stage] ?? stage,
    daysInStage,
    clientName,
    vehicle,
    state,
    stateLawSummary,
    hubspotContext,
    timeline,
    daysSinceContact,
    documents,
    missingCritical,
  }
}

const STAGE_LAWS_LABEL: Record<string, string> = STAGE_LABELS

/**
 * Call Claude to synthesize guidance from the case context.
 * Returns structured JSON output matching SynthesisOutput.
 */
export async function synthesizeGuidance(input: SynthesisInput): Promise<SynthesisOutput> {
  const {
    stage, stageLabel, daysInStage, clientName, vehicle, state, stateLawSummary,
    hubspotContext, timeline, daysSinceContact, documents, missingCritical,
  } = input

  // Format timeline for prompt
  const timelineStr = timeline.length === 0
    ? 'No recorded communications.'
    : timeline.map(t => {
        const date = new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const dir  = t.direction ? ` (${t.direction})` : ''
        const agent = t.agent ? ` — ${t.agent}` : ''
        return `[${date}] ${t.type}${dir}${agent}: ${t.summary}`
      }).join('\n')

  // Format HubSpot properties for prompt
  const hsStr = hubspotContext.length === 0
    ? 'No custom HubSpot properties populated.'
    : hubspotContext.map(h => `${h.label}: ${h.value}`).join('\n')

  // Format documents
  const docsStr = documents.length === 0
    ? 'No documents on file.'
    : documents.map(d => `- ${d.name} [${d.type ?? 'unclassified'}]${d.extracted ? ' (text extracted)' : ''}`).join('\n')

  const contactStr = daysSinceContact !== null
    ? `${daysSinceContact} days ago`
    : 'Unknown'

  const stageTimeStr = daysInStage !== null
    ? `${daysInStage} day${daysInStage !== 1 ? 's' : ''}`
    : 'unknown'

  const prompt = `You are a senior lemon law case manager at Easy Lemon / RockPoint Law. You are analyzing a case and generating actionable guidance for the team member managing this case.

## Case Overview
- Client: ${clientName}
- Vehicle: ${vehicle}
- State: ${state}
- Current Stage: ${stageLabel}
- Time in current stage: ${stageTimeStr}
- Last contact: ${contactStr}

## State Law Context
${stateLawSummary}

## HubSpot Case Properties
${hsStr}

## Recent Communications (Timeline)
${timelineStr}

## Documents on File
${docsStr}
${missingCritical.length > 0 ? `\nMissing critical documents: ${missingCritical.join(', ')}` : ''}

---

Based on ALL the above information, generate precise, actionable guidance for the case manager.

You MUST respond with valid JSON only — no markdown, no explanation, just the JSON object.

The JSON must match this exact structure:
{
  "stage_goal": "One sentence: the specific goal for this case right now based on its actual current state",
  "situation": "2-3 sentences synthesizing where this case actually stands right now. Be specific — reference actual HubSpot field values, timeline events, and documents on file. Do NOT be generic.",
  "checklist": [
    {
      "id": "unique_snake_case_id",
      "icon": "emoji",
      "what": "Clear action title",
      "how": ["Step 1", "Step 2", "Step 3"],
      "then": "What happens after this is done",
      "note": "optional: verbatim attorney note or important flag if applicable",
      "template": {
        "type": "sms",
        "label": "Button label",
        "body": "Full SMS template text"
      }
    }
  ],
  "next_steps": ["Immediate action 1", "Immediate action 2"]
}

Rules:
- Checklist items must be ordered by priority (most urgent first)
- Maximum 5 checklist items — only include what actually matters for THIS case right now
- SMS templates must be warm, professional, and reference the client's actual vehicle
- "situation" must be specific to THIS case — use actual data from HubSpot properties and timeline
- "stage_goal" must reflect the ACTUAL current state, not a generic stage description
- If an attorney has left instructions or notes, those MUST appear as the first checklist item
- If the case has been in stage for more than 7 days with no recent contact, flag that as urgent
- If there are missing critical documents, they must be in the checklist
- Do not fabricate information — only reference what's in the provided data
- SMS template body must start with the client's first name ("Hi ${clientName.split(' ')[0]}!")
- Return ONLY the JSON object — no markdown fences, no commentary`

  const response = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  // Strip markdown fences if Claude adds them despite instructions
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  const parsed = JSON.parse(cleaned) as SynthesisOutput
  return parsed
}
