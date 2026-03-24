/**
 * lib/hubspot/sync-engagements.ts
 *
 * Syncs ALL HubSpot engagements for a case into core.hubspot_engagements.
 * Sources:
 *   1. Engagements directly associated with the deal
 *   2. Engagements on each associated contact record
 *
 * Deduplicates by engagement_id — same engagement may appear on both deal
 * and contact, but is stored once.
 *
 * Contact color assignment is deterministic per case — first contact seen
 * gets color[0], second gets color[1], etc. — so badges are stable across
 * resyncs.
 */

import { SupabaseClient } from '@supabase/supabase-js'

function getToken() {
  const t = process.env.HUBSPOT_ACCESS_TOKEN
  if (!t) throw new Error('HUBSPOT_ACCESS_TOKEN not set')
  return t
}

// Stable color palette for contact avatars (index = contact order)
export const CONTACT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EF4444', // red
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#84CC16', // lime
]

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim()
}

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── HubSpot API helpers ───────────────────────────────────────────────────────

interface HsContactInfo {
  contactId:  string
  name:       string
  initials:   string
  color:      string
  role:       string     // "Primary", "Co-buyer", "Spouse", etc.
  email:      string | null
  phone:      string | null
}

interface HsEngagementRow {
  engagement_id:    string
  case_id:          string
  deal_id:          string
  contact_id:       string | null
  contact_name:     string | null
  contact_initials: string | null
  contact_color:    string | null
  contact_role:     string | null
  engagement_type:  string
  direction:        string | null
  occurred_at:      string
  body:             string | null
  call_summary:     string | null
  duration_ms:      number | null
  author_email:     string | null
  metadata:         Record<string, unknown>
  synced_at:        string
}

/** Fetch all contacts associated with a deal (v4 API for association labels) */
async function fetchDealContacts(dealId: string, token: string): Promise<HsContactInfo[]> {
  // v4 gives us association labels (Primary, Co-buyer, etc.)
  const res = await fetch(
    `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  if (!res.ok) return []
  const data = await res.json() as {
    results?: {
      toObjectId: number
      associationTypes?: { label?: string; category?: string }[]
    }[]
  }

  const contacts: HsContactInfo[] = []
  const results = data.results ?? []

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const contactId = String(r.toObjectId)

    // Resolve association label
    const labelRaw = r.associationTypes?.find(t => t.label)?.label ?? ''
    const role = labelRaw || (i === 0 ? 'Primary' : 'Contact')

    // Fetch contact properties
    try {
      const cRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,mobilephone`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
      )
      if (!cRes.ok) continue
      const cData = await cRes.json() as { properties?: Record<string, string | null> }
      const p = cData.properties ?? {}
      const firstName = p.firstname ?? ''
      const lastName  = p.lastname  ?? ''
      const fullName  = [firstName, lastName].filter(Boolean).join(' ') || `Contact ${i + 1}`
      contacts.push({
        contactId,
        name:     fullName,
        initials: toInitials(fullName),
        color:    CONTACT_COLORS[i % CONTACT_COLORS.length],
        role,
        email:    p.email ?? null,
        phone:    p.phone ?? p.mobilephone ?? null,
      })
    } catch { /* skip */ }
  }

  return contacts
}

/** Fetch all HubSpot owners and return ownerId → full name map */
async function fetchOwnerMap(token: string): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  try {
    const res = await fetch(
      'https://api.hubapi.com/crm/v3/owners/?limit=100',
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return map
    const data = await res.json() as { results?: { id: number; firstName?: string; lastName?: string; email?: string }[] }
    for (const o of data.results ?? []) {
      const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || String(o.id)
      map.set(o.id, name)
    }
  } catch { /* ignore — agent names will be blank */ }
  return map
}

/** Fetch engagement IDs associated with an object (deal or contact) */
async function fetchEngagementIds(objectType: 'deals' | 'contacts', objectId: string, token: string): Promise<string[]> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/${objectType}/${objectId}/associations/engagements`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  if (!res.ok) return []
  const data = await res.json() as { results?: { id: string }[] }
  return (data.results ?? []).map(r => r.id)
}

/** Fetch a single engagement's details */
async function fetchEngagement(engId: string, token: string) {
  const res = await fetch(
    `https://api.hubapi.com/engagements/v1/engagements/${engId}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
  )
  if (!res.ok) return null
  return res.json() as Promise<{
    engagement?: { type?: string; createdAt?: number; ownerId?: number }
    metadata?: {
      body?:                 string
      html?:                 string   // HubSpot sometimes puts email HTML here
      text?:                 string   // plain text fallback
      callSummary?:          string
      status?:               string
      durationMilliseconds?: number
      direction?:            string
      toNumber?:             string
      fromNumber?:           string
      subject?:              string
      from?:                 { email?: string; firstName?: string; lastName?: string }
      to?:                   { email?: string; firstName?: string; lastName?: string }[]
    }
    associations?: { contactIds?: number[] }
  }>
}

// ── Aloware note classifier ───────────────────────────────────────────────────
// Aloware logs SMS, voicemails, and missed calls as HubSpot NOTE engagements.
// We detect the pattern from the body and reclassify + extract clean content.

interface AlowareNote {
  type:      'sms' | 'voicemail' | 'call_missed' | 'note'
  direction: 'inbound' | 'outbound' | null
  body:      string   // cleaned — just the message content, not the metadata header
  phone:     string | null
  agentName: string | null
}

function classifyAlowareNote(raw: string): AlowareNote {
  const text    = raw ?? ''
  const lower   = text.toLowerCase()

  // Extract phone number
  const phoneMatch = text.match(/\+?1?\s*[\(\-]?(\d{3})[\)\-\s]?(\d{3})[\-\s]?(\d{4})/)
  const phone = phoneMatch ? phoneMatch[0].replace(/\s+/g, '') : null

  // Extract agent name — appears at start of line before "(Browser / Apps)" or "has ..."
  // e.g. "Alicia Delgado (Browser / Apps) has sent an SMS to..."
  // e.g. "Erin Hernandez has made an outbound call..."
  const agentMatch = text.match(/^([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)\s*(?:\([^)]+\))?\s+has\s/m)
  const agentName  = agentMatch ? agentMatch[1].trim() : null

  // Extract message body (after "Message:\n")
  const msgMatch = text.match(/message:\s*\n?([\s\S]+)/i)
  const cleanBody = msgMatch ? msgMatch[1].trim() : text.replace(/^[\s\S]*?\n\n/, '').trim()

  if (/has sent an sms to/i.test(text) || /sent.*sms/i.test(lower)) {
    return { type: 'sms', direction: 'outbound', body: cleanBody || text, phone, agentName }
  }
  if (/has received an sms/i.test(text) || /received.*sms/i.test(lower) || /incoming.*sms/i.test(lower)) {
    return { type: 'sms', direction: 'inbound', body: cleanBody || text, phone, agentName }
  }
  // Check voicemail BEFORE missed call — "no answer left VM" is a voicemail, not a missed call
  // Voicemail = we called out and left a message (outbound)
  if (/left\s+vm\b|left\s+a\s+voicemail|voicemail\s+left|left\s+voicemail|vm\s+left/i.test(text)) {
    return { type: 'voicemail', direction: 'outbound', body: cleanBody || text, phone, agentName }
  }
  // Voicemail received = client left us a voicemail (inbound)
  if (/voicemail\s+received|received\s+voicemail/i.test(text)) {
    return { type: 'voicemail', direction: 'inbound', body: cleanBody || text, phone, agentName }
  }
  // Missed call = client called us and we missed it (inbound)
  if (/missed\s+a\s+call|missed\s+call/i.test(text)) {
    return { type: 'call_missed', direction: 'inbound', body: cleanBody || text, phone, agentName }
  }
  // No answer (without VM) = we called, they didn't pick up (outbound)
  if (/no\s+answer/i.test(text)) {
    return { type: 'call_missed', direction: 'outbound', body: cleanBody || text, phone, agentName }
  }

  return { type: 'note', direction: null, body: text, phone: null, agentName }
}

// ── Main sync function ────────────────────────────────────────────────────────

export interface SyncResult {
  upserted:  number
  skipped:   number
  errors:    string[]
  contacts:  { id: string; name: string; role: string }[]
}

export async function syncEngagements(
  supabase: SupabaseClient,
  caseId:   string,
  dealId:   string,
): Promise<SyncResult> {
  const token  = getToken()
  const result: SyncResult = { upserted: 0, skipped: 0, errors: [], contacts: [] }

  // 0. Fetch HubSpot owner map (ownerId → full name) for agent resolution
  const ownerMap = await fetchOwnerMap(token)

  // 1. Fetch all associated contacts
  const contacts = await fetchDealContacts(dealId, token)
  result.contacts = contacts.map(c => ({ id: c.contactId, name: c.name, role: c.role }))

  // Build contact lookup maps
  const contactById = new Map<string, HsContactInfo>()
  for (const c of contacts) contactById.set(c.contactId, c)

  // 2. Collect all engagement IDs: from deal + all contacts
  const allEngIdSources: { engId: string; contactId: string | null }[] = []
  const seenEngIds = new Set<string>()

  // Deal engagements
  const dealEngIds = await fetchEngagementIds('deals', dealId, token)
  for (const engId of dealEngIds) {
    if (!seenEngIds.has(engId)) {
      seenEngIds.add(engId)
      allEngIdSources.push({ engId, contactId: null })
    }
  }

  // Contact engagements
  for (const contact of contacts) {
    const contactEngIds = await fetchEngagementIds('contacts', contact.contactId, token)
    for (const engId of contactEngIds) {
      if (!seenEngIds.has(engId)) {
        seenEngIds.add(engId)
        allEngIdSources.push({ engId, contactId: contact.contactId })
      }
    }
  }

  // 3. Fetch and upsert each engagement
  const rows: HsEngagementRow[] = []

  for (const { engId, contactId } of allEngIdSources) {
    try {
      const data = await fetchEngagement(engId, token)
      if (!data) { result.skipped++; continue }

      const e = data.engagement ?? {}
      const m = data.metadata   ?? {}
      const rawType = (e.type ?? '').toUpperCase()

      // Skip tasks and meetings — not useful in the timeline
      if (rawType === 'TASK' || rawType === 'MEETING') { result.skipped++; continue }

      // For emails try body → html → text in order; strip HTML from whichever has content
      const emailRaw = rawType === 'EMAIL'
        ? (m.body || m.html || m.text || null)
        : m.body
      const rawBodyText = emailRaw ? stripHtml(emailRaw).replace(/\s{3,}/g, '\n\n').trim().slice(0, 8000) : null
      const summaryText = m.callSummary ? stripHtml(m.callSummary).slice(0, 4000) : null

      // For emails, build body from subject + body content
      let bodyText: string | null = rawBodyText
      if (rawType === 'EMAIL') {
        const subject = m.subject ? `Subject: ${m.subject}` : null
        bodyText = [subject, rawBodyText].filter(Boolean).join('\n\n') || null
      }

      // Classify NOTE engagements — Aloware logs SMS/voicemail/missed calls as NOTEs
      let engType      = rawType === 'CALL' ? 'CALL' : rawType === 'EMAIL' ? 'EMAIL' : 'NOTE'
      let alowareDirection: 'inbound' | 'outbound' | null = null
      let alowareAgent: string | null = null
      let cleanBody: string | null = bodyText

      if (engType === 'NOTE' && bodyText) {
        const classified = classifyAlowareNote(bodyText)
        if (classified.type !== 'note') {
          engType          = classified.type.toUpperCase()   // SMS | VOICEMAIL | CALL_MISSED
          alowareDirection = classified.direction
          alowareAgent     = classified.agentName
          cleanBody        = classified.body
        }
      }

      // Resolve which contact this belongs to
      // If we have a contactId from the source, use it
      // Otherwise check the engagement's own association data
      let resolvedContactId = contactId
      if (!resolvedContactId && data.associations?.contactIds?.length) {
        const firstContactId = String(data.associations.contactIds[0])
        if (contactById.has(firstContactId)) resolvedContactId = firstContactId
      }
      const contact = resolvedContactId ? contactById.get(resolvedContactId) : null

      const direction = m.direction?.toLowerCase() === 'outbound' ? 'outbound'
        : m.direction?.toLowerCase() === 'inbound' ? 'inbound' : null

      rows.push({
        engagement_id:    engId,
        case_id:          caseId,
        deal_id:          dealId,
        contact_id:       resolvedContactId ?? null,
        contact_name:     contact?.name     ?? null,
        contact_initials: contact?.initials ?? null,
        contact_color:    contact?.color    ?? null,
        contact_role:     contact?.role     ?? null,
        engagement_type:  engType,
        direction:        alowareDirection ?? direction,
        occurred_at:      e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString(),
        body:             cleanBody,
        call_summary:     summaryText,
        duration_ms:      m.durationMilliseconds ?? null,
        // Agent name: prefer Aloware body extraction, fall back to HubSpot ownerId
        author_email:     alowareAgent ?? (e.ownerId ? (ownerMap.get(e.ownerId) ?? null) : null),
        metadata:         { type: e.type, status: m.status, toNumber: m.toNumber, fromNumber: m.fromNumber, subject: m.subject ?? null },
        synced_at:        new Date().toISOString(),
      })
    } catch (err) {
      result.errors.push(`eng ${engId}: ${(err as Error).message}`)
    }
  }

  // 4. Batch upsert
  if (rows.length > 0) {
    const { error } = await supabase
      .schema('core')
      .from('hubspot_engagements')
      .upsert(rows, { onConflict: 'engagement_id' })
    if (error) {
      result.errors.push(`upsert: ${error.message}`)
    } else {
      result.upserted = rows.length
    }
  }

  return result
}

/** Upsert a single engagement by ID — used by the webhook handler */
export async function upsertEngagementById(
  supabase:    SupabaseClient,
  engId:       string,
  dealId:      string,
  caseId:      string,
  contactInfo: HsContactInfo | null,
): Promise<void> {
  const token = getToken()
  const data  = await fetchEngagement(engId, token)
  if (!data) return

  const e = data.engagement ?? {}
  const m = data.metadata   ?? {}
  const rawType = (e.type ?? '').toUpperCase()
  if (rawType === 'TASK' || rawType === 'MEETING') return

  const engType   = rawType === 'CALL' ? 'CALL' : rawType === 'EMAIL' ? 'EMAIL' : 'NOTE'
  const direction = m.direction?.toLowerCase() === 'outbound' ? 'outbound'
    : m.direction?.toLowerCase() === 'inbound' ? 'inbound' : null
  const bodyText    = m.body        ? stripHtml(m.body).slice(0, 5000)  : null
  const summaryText = m.callSummary ? stripHtml(m.callSummary).slice(0, 4000) : null

  await supabase.schema('core').from('hubspot_engagements').upsert({
    engagement_id:    engId,
    case_id:          caseId,
    deal_id:          dealId,
    contact_id:       contactInfo?.contactId ?? null,
    contact_name:     contactInfo?.name      ?? null,
    contact_initials: contactInfo?.initials  ?? null,
    contact_color:    contactInfo?.color     ?? null,
    contact_role:     contactInfo?.role      ?? null,
    engagement_type:  engType,
    direction,
    occurred_at:      e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString(),
    body:             bodyText,
    call_summary:     summaryText,
    duration_ms:      m.durationMilliseconds ?? null,
    author_email:     null,
    metadata:         { type: e.type, status: m.status, toNumber: m.toNumber, fromNumber: m.fromNumber },
    synced_at:        new Date().toISOString(),
  }, { onConflict: 'engagement_id' })
}
