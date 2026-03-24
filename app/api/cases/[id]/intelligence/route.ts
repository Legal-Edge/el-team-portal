/**
 * GET /api/cases/[id]/intelligence
 *
 * Case Intelligence Engine — aggregates all three evidence tiers and produces
 * structured agent guidance based on the current case stage.
 *
 * Evidence tiers (ascending reliability):
 *   Tier 1 — Intake claims (form/call — client self-reported, unverified)
 *   Tier 2 — Communications (phone/SMS/email — confirms or contradicts claims)
 *   Tier 3 — Documents (repair orders, purchase agreement — ground truth / evidence)
 *
 * Returns:
 *   - evidence_summary: what we know at each tier
 *   - gaps: what's missing or unconfirmed, ordered by priority
 *   - actions: specific agent actions with message templates
 *   - confidence: per-claim confidence level
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
  id:         string
  type:       string // CALL | NOTE | EMAIL | TASK
  body:       string
  callSummary?: string
  status?:    string
  duration?:  number
  direction?: string
  title?:     string
  createdAt:  number
}

async function fetchEngagements(dealId: string): Promise<HsEngagement[]> {
  const token = getHsToken()

  // Get association list
  const assocRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/engagements`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  if (!assocRes.ok) return []
  const assoc = await assocRes.json() as { results?: { id: string }[] }
  const ids = (assoc.results ?? []).map(r => r.id)
  if (!ids.length) return []

  // Fetch each engagement (v1 API has richest call data incl. callSummary)
  const engagements: HsEngagement[] = []
  for (const id of ids) {
    try {
      const res = await fetch(
        `https://api.hubapi.com/engagements/v1/engagements/${id}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
      )
      if (!res.ok) continue
      const data = await res.json() as {
        engagement?: { type?: string; createdAt?: number; activityType?: string }
        metadata?:   {
          body?: string; callSummary?: string; status?: string
          durationMilliseconds?: number; direction?: string; title?: string
        }
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

// ── Gap / Action types ────────────────────────────────────────────────────────

export interface EvidenceGap {
  id:          string
  priority:    'critical' | 'high' | 'medium' | 'low'
  category:    'document' | 'confirmation' | 'follow_up' | 'stage_advance'
  title:       string
  description: string
}

export interface AgentAction {
  id:           string
  type:         'sms' | 'call' | 'email' | 'internal' | 'advance_stage'
  priority:     number   // 1 = highest
  title:        string
  description:  string
  template?:    string  // pre-written message / script
  cta:          string  // button label
}

export interface IntelligenceReport {
  case_id:        string
  deal_id:        string
  stage:          string
  generated_at:   string

  // Three tiers
  tier1_intake: {
    vehicle:           string | null
    issues:            string[]
    repair_count:      number | null
    purchase_date:     string | null
    state:             string | null
    nurture_reason:    string | null
    nurture_notes:     string | null
  }
  tier2_comms: {
    total_engagements: number
    calls:             number
    notes:             number
    last_contact_at:   string | null
    days_since_contact:number | null
    call_summaries:    string[]
    key_facts:         string[]  // extracted from call bodies
  }
  tier3_docs: {
    total_docs:        number
    doc_types:         string[]
    has_repair_orders: boolean
    has_purchase_agmt: boolean
    has_warranty:      boolean
    missing_critical:  string[]
  }

  gaps:    EvidenceGap[]
  actions: AgentAction[]
}

// ── Stage-specific guidance builders ─────────────────────────────────────────

function buildNurtureGuidance(
  hp:     Record<string, unknown>,
  engagements: HsEngagement[],
  docTypes:    string[],
  clientName:  string,
  clientPhone: string | null,
): { gaps: EvidenceGap[]; actions: AgentAction[] } {

  const gaps:    EvidenceGap[]  = []
  const actions: AgentAction[]  = []

  const hasRepairOrders = docTypes.includes('repair_order')
  const hasPurchaseAgmt = docTypes.includes('purchase_agreement')
  const hasWarranty     = docTypes.includes('warranty')

  const lastContactedRaw = hp['notes_last_contacted'] ? String(hp['notes_last_contacted']) : null
  const lastContactedMs  = lastContactedRaw
    ? (/^\d{13}$/.test(lastContactedRaw) ? parseInt(lastContactedRaw) : new Date(lastContactedRaw).getTime())
    : null
  const daysSinceContact = lastContactedMs
    ? Math.floor((Date.now() - lastContactedMs) / 86_400_000)
    : null

  const contactAttempts = parseInt(String(hp['num_contacted_notes'] ?? '0')) || 0
  const repairCount     = parseInt(String(
    hp['how_many_repairs_have_you_had_done_to_your_vehicle_'] ??
    hp['repair_attempts'] ?? '0'
  )) || null
  const state           = String(hp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? 'TN').toUpperCase().slice(0, 2)

  // ── Gap: No repair orders ──────────────────────────────────────────────────
  if (!hasRepairOrders) {
    gaps.push({
      id:          'missing_repair_orders',
      priority:    'critical',
      category:    'document',
      title:       'Repair orders not on file',
      description: `No repair orders have been uploaded. These are the primary evidence for a Lemon Law claim — they prove ${repairCount ? `the ${repairCount} repair visit${repairCount !== 1 ? 's' : ''}` : 'the reported repair visits'} and establish the same-defect pattern.`,
    })

    const issues = extractIssuesFromProps(hp)
    const issueText = issues.length
      ? `"${issues[0]}"`
      : 'the reported vehicle issues'

    actions.push({
      id:          'request_repair_orders',
      type:        'sms',
      priority:    1,
      title:       'Request repair orders',
      description: 'Send a text asking the client to upload or forward all dealer repair orders.',
      template:    `Hi ${clientName}! This is [Your Name] from Easy Lemon. To move your case forward, we need copies of your repair orders from the dealership — the paperwork you received each time you brought your vehicle in for ${issueText}. You can take a photo and reply to this text, or ask the dealership for copies. Reply here if you have any questions!`,
      cta:         'Send Text',
    })
  }

  // ── Gap: No purchase agreement ─────────────────────────────────────────────
  if (!hasPurchaseAgmt) {
    gaps.push({
      id:          'missing_purchase_agreement',
      priority:    'high',
      category:    'document',
      title:       'Purchase agreement not on file',
      description: 'We need the purchase or lease agreement to confirm the vehicle details, purchase date, and price — all required for the demand letter.',
    })

    actions.push({
      id:          'request_purchase_agreement',
      type:        'sms',
      priority:    2,
      title:       'Request purchase agreement',
      description: 'Ask the client to upload their purchase or lease agreement.',
      template:    `Hi ${clientName}! This is [Your Name] from Easy Lemon. We also need a copy of your vehicle's purchase or lease agreement (the paperwork you signed at the dealership). You can take a photo and reply here, or we can request it from the dealership on your behalf. Let us know!`,
      cta:         'Send Text',
    })
  }

  // ── Gap: No warranty ──────────────────────────────────────────────────────
  if (!hasWarranty) {
    gaps.push({
      id:          'missing_warranty',
      priority:    'medium',
      category:    'document',
      title:       'Warranty documentation not on file',
      description: 'The manufacturer warranty confirms coverage period and is needed to establish the claim falls within the warranty window.',
    })
  }

  // ── Gap: Contact overdue ───────────────────────────────────────────────────
  if (daysSinceContact !== null && daysSinceContact > 7) {
    gaps.push({
      id:          'contact_overdue',
      priority:    daysSinceContact > 21 ? 'critical' : daysSinceContact > 14 ? 'high' : 'medium',
      category:    'follow_up',
      title:       `No contact in ${daysSinceContact} days`,
      description: `Last contact was ${daysSinceContact} days ago. Nurture clients can go cold quickly — a timely follow-up is critical to keep the case active.`,
    })

    actions.push({
      id:          'follow_up_contact',
      type:        'sms',
      priority:    hasRepairOrders && hasPurchaseAgmt ? 1 : 3,
      title:       `Follow up — ${daysSinceContact} days since last contact`,
      description: 'Check in on the client\'s case status and any new developments.',
      template:    `Hi ${clientName}! This is [Your Name] from Easy Lemon. Just checking in on your vehicle situation — have there been any updates with the dealership? Any new repairs or time the car has been in the shop? We're monitoring your case closely. Reply anytime or call us at (855) 435-3666.`,
      cta:         'Send Text',
    })
  } else if (daysSinceContact === null && contactAttempts === 0) {
    gaps.push({
      id:          'never_contacted',
      priority:    'critical',
      category:    'follow_up',
      title:       'Client has never been contacted',
      description: 'No contact attempts on record. This case needs immediate outreach.',
    })

    actions.push({
      id:          'initial_contact',
      type:        'call',
      priority:    1,
      title:       'Make initial contact',
      description: 'Call the client to introduce yourself and explain next steps.',
      template:    `Hi, may I speak with ${clientName}? ... This is [Your Name] from Easy Lemon. I'm reaching out about your potential Lemon Law case. I wanted to introduce myself and walk you through our next steps. Do you have a few minutes?`,
      cta:         'Call Client',
    })
  }

  // ── Action: Check 30-day threshold ────────────────────────────────────────
  if (repairCount !== null && repairCount >= 2) {
    actions.push({
      id:          'check_threshold',
      type:        'internal',
      priority:    2,
      title:       'Verify if threshold has been met',
      description: `${repairCount} repair ${repairCount !== 1 ? 'visits' : 'visit'} on record. ${state === 'TN' ? 'Tennessee requires 3 repairs for the same defect OR 30 days out of service.' : 'Check state law threshold.'} Confirm with the client whether additional visits have occurred since last contact.`,
      template:    `Hi ${clientName}! It's [Your Name] from Easy Lemon. Last time we spoke, your vehicle had been to the dealer a few times for the braking and transmission issues. Has it been back since? And do you know how many total days it's been in the shop? That helps us determine if you've met the Lemon Law threshold. Text or call us anytime!`,
      cta:         'Check Status',
    })
  }

  // ── Action: Advance to Document Collection if docs received ───────────────
  if (hasRepairOrders && hasPurchaseAgmt) {
    gaps.push({
      id:          'ready_to_advance',
      priority:    'low',
      category:    'stage_advance',
      title:       'Key documents on file — ready to review',
      description: 'Repair orders and purchase agreement are both uploaded. This case may be ready to advance to Attorney Review.',
    })
    actions.push({
      id:          'advance_stage',
      type:        'advance_stage',
      priority:    1,
      title:       'Move to Attorney Review',
      description: 'Key documents are on file. Move the case forward for attorney review.',
      cta:         'Advance Stage',
    })
  }

  return { gaps, actions }
}

// ── Helper: extract issue labels from HubSpot props ──────────────────────────

function extractIssuesFromProps(hp: Record<string, unknown>): string[] {
  const raw = [
    hp['most_common_problem__notes_'],
    hp['second_common_problem__notes_'],
    hp['third_common_problem__notes_'],
    hp['fourth_common_problem__notes_'],
  ].filter(Boolean).map(String)

  return raw.map(s => {
    let cleaned = s.replace(/^(most|second|third|fourth)\s+common\s+problem\s*:\s*/i, '')
    cleaned = cleaned.replace(/^\*\s*/u, '').replace(/^[\u{1F000}-\u{1FFFF}\u2600-\u27BF\uFE00-\uFE0F]+\s*/u, '')
    cleaned = cleaned.replace(/_?\s*repair attempts?[\s\S]*/i, '')
    cleaned = cleaned.replace(/:\s*\*_/g, ': ').replace(/^[*_.\s]+/, '').replace(/[*_.\s]+$/, '').trim()
    const colonIdx = cleaned.indexOf(':')
    return colonIdx > 0 ? cleaned.slice(0, colonIdx).trim() : cleaned
  }).filter(Boolean)
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: dealId } = await params

  // Fetch case from Supabase
  const { data: caseRow, error } = await supabaseAdmin
    .schema('core')
    .from('cases')
    .select('id, hubspot_deal_id, case_status, client_first_name, client_last_name, client_phone, hubspot_properties, hubspot_contact_properties')
    .eq('hubspot_deal_id', dealId)
    .single()

  if (error || !caseRow) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const caseUUID   = caseRow.id as string
  const hp         = (caseRow.hubspot_properties  as Record<string, unknown> | null) ?? {}
  const clientName = [caseRow.client_first_name, caseRow.client_last_name].filter(Boolean).join(' ') || 'there'
  const clientPhone = caseRow.client_phone as string | null

  // ── Tier 2: Fetch HubSpot engagements ─────────────────────────────────────
  const engagements = await fetchEngagements(dealId).catch(() => [] as HsEngagement[])
  const calls = engagements.filter(e => e.type === 'CALL')
  const notes = engagements.filter(e => e.type === 'NOTE')

  const callSummaries = calls
    .map(c => stripHtml(c.callSummary || c.body || ''))
    .filter(Boolean)
    .map(s => s.slice(0, 800))

  // Extract key facts from all engagement bodies
  const keyFacts: string[] = []
  for (const eng of engagements) {
    const text = stripHtml(eng.body || '')
    // Look for sentences with key lemon law signals
    const sentences = text.split(/[.\n]/).map(s => s.trim()).filter(s => s.length > 20 && s.length < 200)
    for (const s of sentences) {
      const lower = s.toLowerCase()
      if (lower.includes('repair') || lower.includes('shop') || lower.includes('days') ||
          lower.includes('threshold') || lower.includes('follow up') || lower.includes('document')) {
        if (!keyFacts.includes(s)) keyFacts.push(s)
        if (keyFacts.length >= 6) break
      }
    }
    if (keyFacts.length >= 6) break
  }

  // Last contact
  const lastContactedRaw = hp['notes_last_contacted'] ? String(hp['notes_last_contacted']) : null
  const lastContactedMs  = lastContactedRaw
    ? (/^\d{13}$/.test(lastContactedRaw) ? parseInt(lastContactedRaw) : new Date(lastContactedRaw).getTime())
    : (calls[0]?.createdAt ?? null)
  const lastContactAt  = lastContactedMs ? new Date(lastContactedMs).toISOString() : null
  const daysSinceContact = lastContactedMs ? Math.floor((Date.now() - lastContactedMs) / 86_400_000) : null

  // ── Tier 3: Fetch documents from Supabase ─────────────────────────────────
  const { data: docs } = await supabaseAdmin
    .schema('core')
    .from('document_files')
    .select('document_type_code, file_name')
    .eq('case_id', caseUUID)
    .eq('is_deleted', false)

  const docTypes    = [...new Set((docs ?? []).map(d => d.document_type_code).filter(Boolean))] as string[]
  const totalDocs   = docs?.length ?? 0
  const missingCritical: string[] = []
  if (!docTypes.includes('repair_order'))       missingCritical.push('Repair orders')
  if (!docTypes.includes('purchase_agreement')) missingCritical.push('Purchase agreement')
  if (!docTypes.includes('warranty'))           missingCritical.push('Warranty documentation')

  // ── Tier 1: Intake claims ─────────────────────────────────────────────────
  const vehicleYear  = String(hp['vehicle_year'] ?? hp['what_is_the_approximate_year_of_your_vehicle_'] ?? '')
  const vehicleMake  = String(hp['vehicle_make'] ?? hp['what_is_the_make_of_your_vehicle_'] ?? '')
  const vehicleModel = String(hp['vehicle_model'] ?? hp['what_is_the_model_of_your_vehicle_'] ?? '')
  const vehicleStr   = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ') || null

  const issues      = extractIssuesFromProps(hp)
  const repairCount = parseInt(String(hp['how_many_repairs_have_you_had_done_to_your_vehicle_'] ?? hp['repair_attempts'] ?? '')) || null
  const state       = String(hp['which_state_did_you_purchase_or_lease_your_vehicle_'] ?? '').slice(0, 2).toUpperCase() || null

  // ── Build stage-specific guidance ─────────────────────────────────────────
  const stage = String(caseRow.case_status)
  let gaps:    EvidenceGap[]  = []
  let actions: AgentAction[]  = []

  if (stage === 'nurture' || stage === 'intake' || stage === 'unknown') {
    const result = buildNurtureGuidance(hp, engagements, docTypes, clientName, clientPhone)
    gaps    = result.gaps
    actions = result.actions
  }
  // Additional stage handlers (attorney_review, document_collection, etc.) — future

  // Sort: gaps by priority weight, actions by priority number
  const PRIORITY_WEIGHT = { critical: 0, high: 1, medium: 2, low: 3 }
  gaps.sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority])
  actions.sort((a, b) => a.priority - b.priority)

  const report: IntelligenceReport = {
    case_id:      caseUUID,
    deal_id:      dealId,
    stage,
    generated_at: new Date().toISOString(),

    tier1_intake: {
      vehicle:        vehicleStr,
      issues,
      repair_count:   repairCount,
      purchase_date:  String(hp['purchase__lease_date'] ?? hp['when_did_you_purchase_or_lease_your_vehicle_'] ?? '') || null,
      state,
      nurture_reason: hp['nurture__reason_'] ? String(hp['nurture__reason_']) : null,
      nurture_notes:  hp['nurture__notes_']  ? String(hp['nurture__notes_'])  : null,
    },
    tier2_comms: {
      total_engagements: engagements.length,
      calls:             calls.length,
      notes:             notes.length,
      last_contact_at:   lastContactAt,
      days_since_contact: daysSinceContact,
      call_summaries:    callSummaries,
      key_facts:         keyFacts,
    },
    tier3_docs: {
      total_docs:        totalDocs,
      doc_types:         docTypes,
      has_repair_orders: docTypes.includes('repair_order'),
      has_purchase_agmt: docTypes.includes('purchase_agreement'),
      has_warranty:      docTypes.includes('warranty'),
      missing_critical:  missingCritical,
    },

    gaps,
    actions,
  }

  return NextResponse.json(report)
}
