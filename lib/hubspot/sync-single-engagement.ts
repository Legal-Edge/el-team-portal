/**
 * syncSingleEngagement
 *
 * Called by the webhook handler when a single call/note/email/communication
 * event fires. Fetches the activity, resolves its associated deal → case UUID,
 * classifies it (Aloware patterns, direction, agent name) and upserts into
 * core.hubspot_engagements.
 *
 * Uses the same classification logic as sync-engagements.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Re-use shared logic from sync-engagements ─────────────────────────────────
// (inline key helpers to avoid circular deps)

const CONTACT_COLORS = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4','#EC4899','#84CC16']
const INTERNAL_DOMAINS = ['easylemon.com', 'rockpointlaw.com', 'rockpointgrowth.com']

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

function classifyAlowareNote(raw: string) {
  const text  = raw ?? ''
  const lower = text.toLowerCase()
  const phoneMatch = text.match(/\+?1?\s*[\(\-]?(\d{3})[\)\-\s]?(\d{3})[\-\s]?(\d{4})/)
  const phone      = phoneMatch ? phoneMatch[0].replace(/\s+/g, '') : null
  const agentMatch = text.match(/^([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)\s*(?:\([^)]+\))?\s+has\s/m)
  const agentName  = agentMatch ? agentMatch[1].trim() : null
  const msgMatch   = text.match(/message:\s*\n?([\s\S]+)/i)
  const cleanBody  = msgMatch ? msgMatch[1].trim() : text.replace(/^[\s\S]*?\n\n/, '').trim()

  if (/has sent an sms to/i.test(text) || /sent.*sms/i.test(lower))
    return { type: 'sms', direction: 'outbound' as const, body: cleanBody || text, phone, agentName }
  if (/has received an sms/i.test(text) || /received.*sms/i.test(lower) || /incoming.*sms/i.test(lower))
    return { type: 'sms', direction: 'inbound' as const, body: cleanBody || text, phone, agentName }
  if (/left\s+vm\b|left\s+a\s+voicemail|voicemail\s+left|left\s+voicemail|vm\s+left/i.test(text))
    return { type: 'voicemail', direction: 'outbound' as const, body: cleanBody || text, phone, agentName }
  if (/voicemail\s+received|received\s+voicemail/i.test(text))
    return { type: 'voicemail', direction: 'inbound' as const, body: cleanBody || text, phone, agentName }
  if (/missed\s+a\s+call|missed\s+call/i.test(text))
    return { type: 'call_missed', direction: 'inbound' as const, body: cleanBody || text, phone, agentName }
  if (/no\s+answer/i.test(text))
    return { type: 'call_missed', direction: 'outbound' as const, body: cleanBody || text, phone, agentName }
  return { type: 'note', direction: null, body: text, phone: null, agentName }
}

// ── HubSpot API helpers ───────────────────────────────────────────────────────

function getToken(): string {
  const t = process.env.HUBSPOT_ACCESS_TOKEN
  if (!t) throw new Error('HUBSPOT_ACCESS_TOKEN not set')
  return t
}

async function hsGet(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    signal:  AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  return res.json()
}

/** Map webhook objectType → v1 engagement type string */
const OBJECT_TYPE_MAP: Record<string, string> = {
  notes:          'NOTE',
  calls:          'CALL',
  emails:         'EMAIL',
  communications: 'NOTE',   // Aloware SMS in conversation threads
}

/** Find the HubSpot deal ID associated with an activity object */
async function findDealIdForActivity(objectId: string, objectType: string): Promise<string | null> {
  const data = await hsGet(`/crm/v3/objects/${objectType}/${objectId}/associations/deals`)
  const results = (data?.results as Array<{ id: string }>) ?? []
  return results[0]?.id ?? null
}

/** Fetch owner name from HubSpot users API */
async function getOwnerName(ownerId: number | undefined): Promise<string | null> {
  if (!ownerId) return null
  const data = await hsGet(`/crm/v3/owners/${ownerId}`)
  if (!data) return null
  const p = data as { firstName?: string; lastName?: string; email?: string }
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || (p.email ?? null)
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function syncSingleEngagement(
  supabase:   SupabaseClient,
  objectId:   string,
  objectType: string,   // 'notes' | 'calls' | 'emails' | 'communications'
): Promise<{ result: string; error?: string }> {

  const token = getToken()

  // 1. Find associated deal
  const dealId = await findDealIdForActivity(objectId, objectType)
  if (!dealId) return { result: 'no_deal', error: 'No associated deal found' }

  // 2. Find case UUID in Supabase
  const { data: caseRow } = await supabase
    .schema('core')
    .from('cases')
    .select('id')
    .eq('hubspot_deal_id', dealId)
    .single()
  if (!caseRow?.id) return { result: 'no_case', error: `Deal ${dealId} not in core.cases` }

  const caseId = caseRow.id as string

  // 3. Fetch engagement details via v1 API (IDs are compatible)
  const engData = await hsGet(`/engagements/v1/engagements/${objectId}`)
  if (!engData) return { result: 'fetch_failed', error: `Could not fetch engagement ${objectId}` }

  const e = (engData.engagement ?? {}) as Record<string, unknown>
  const m = (engData.metadata   ?? {}) as Record<string, unknown>
  const rawType = String(e.type ?? OBJECT_TYPE_MAP[objectType] ?? 'NOTE').toUpperCase()

  // Skip tasks and meetings
  if (rawType === 'TASK' || rawType === 'MEETING') return { result: 'skipped' }

  // 4. Build body text
  const emailRaw    = rawType === 'EMAIL' ? (String(m.body || m.html || m.text || '') || null) : (m.body ? String(m.body) : null)
  const rawBodyText = emailRaw ? stripHtml(emailRaw).replace(/\s{3,}/g, '\n\n').trim().slice(0, 8000) : null
  const summaryText = m.callSummary ? stripHtml(String(m.callSummary)).slice(0, 4000) : null
  const ownerId     = e.ownerId as number | undefined

  // 5. Classify type + direction
  let engType      = rawType === 'CALL' ? 'CALL' : rawType === 'EMAIL' ? 'EMAIL' : 'NOTE'
  let direction:   'inbound' | 'outbound' | null = null
  let cleanBody:   string | null = rawBodyText
  let agentName:   string | null = null

  if (rawType === 'EMAIL') {
    const fromEmail = (m.from as Record<string, string> | undefined)?.email ?? ''
    direction = INTERNAL_DOMAINS.some(d => fromEmail.toLowerCase().endsWith(`@${d}`)) ? 'outbound'
      : fromEmail ? 'inbound' : null
    const subject = m.subject ? `Subject: ${m.subject}` : null
    cleanBody = [subject, rawBodyText].filter(Boolean).join('\n\n') || null
    agentName = (m.from as Record<string, string> | undefined)
      ? [[((m.from as Record<string,string>).firstName)], [(m.from as Record<string,string>).lastName]].flat().filter(Boolean).join(' ') || null
      : null
  } else if (rawType === 'CALL') {
    direction = String(m.direction ?? '').toLowerCase() === 'outbound' ? 'outbound'
      : String(m.direction ?? '').toLowerCase() === 'inbound'  ? 'inbound' : null
    agentName = await getOwnerName(ownerId)
  } else if (engType === 'NOTE' && rawBodyText) {
    const classified = classifyAlowareNote(rawBodyText)
    if (classified.type !== 'note') {
      engType   = classified.type.toUpperCase()
      direction = classified.direction
      cleanBody = classified.body
      agentName = classified.agentName
    }
    if (!agentName) agentName = await getOwnerName(ownerId)
  }

  if (!agentName) agentName = await getOwnerName(ownerId)

  // 6. Resolve contact (best-effort — use first associated contact)
  let contactId:       string | null = null
  let contactName:     string | null = null
  let contactInitials: string | null = null
  let contactColor:    string | null = null
  let contactRole:     string | null = null

  const contactAssoc = (engData.associations as Record<string, unknown>)?.contactIds
  if (Array.isArray(contactAssoc) && contactAssoc.length > 0) {
    contactId = String(contactAssoc[0])
    // Look up contact name in our DB
    const { data: contact } = await supabase
      .schema('core')
      .from('hubspot_engagements')
      .select('contact_name, contact_initials, contact_color, contact_role')
      .eq('case_id', caseId)
      .eq('contact_id', contactId)
      .limit(1)
      .single()
    if (contact) {
      contactName     = contact.contact_name
      contactInitials = contact.contact_initials
      contactColor    = contact.contact_color
      contactRole     = contact.contact_role
    } else {
      // Fallback: check primary case contact info
      contactColor = CONTACT_COLORS[0]
    }
  }

  // 7. Upsert to core.hubspot_engagements
  const row = {
    engagement_id:    objectId,
    case_id:          caseId,
    deal_id:          dealId,
    contact_id:       contactId,
    contact_name:     contactName,
    contact_initials: contactInitials,
    contact_color:    contactColor,
    contact_role:     contactRole,
    engagement_type:  engType,
    direction,
    occurred_at:      e.createdAt ? new Date(e.createdAt as number).toISOString() : new Date().toISOString(),
    body:             cleanBody,
    call_summary:     summaryText,
    duration_ms:      (m.durationMilliseconds as number | undefined) ?? null,
    author_email:     agentName,
    metadata:         {
      type: e.type, status: m.status,
      toNumber: m.toNumber, fromNumber: m.fromNumber,
      subject: m.subject ?? null,
      emailFrom: m.from ?? null, emailTo: m.to ?? null,
    },
    synced_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .schema('core')
    .from('hubspot_engagements')
    .upsert(row, { onConflict: 'engagement_id' })

  if (error) return { result: 'upsert_failed', error: error.message }

  console.log(`[webhook] upserted ${engType} engagement ${objectId} → case ${caseId}`)
  return { result: 'ok' }
}
