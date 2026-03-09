/**
 * HubSpot → core.communications Sync
 *
 * Phase 1: metadata only (channel, direction, occurred_at, subject, snippet)
 * Phase 2: full body/transcripts (future)
 *
 * Resolution priority:
 *   1. Engagement has deal association → direct case match (deterministic)
 *   2. Contact has exactly 1 active case → auto-attach
 *   3. Contact has multiple cases → closest case by created_at date
 *   4. Unresolvable → needs_review = true, never guessed
 *
 * Usage:
 *   node scripts/sync-hubspot-comms.mjs --deal-id=57785602325
 *   node scripts/sync-hubspot-comms.mjs --deal-ids=57785602325,57782704466
 */

import { createClient } from '@supabase/supabase-js'

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!HUBSPOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars'); process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const coreDb   = supabase.schema('core')

// ─── HubSpot API ───────────────────────────────────────────

async function hs(path) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HubSpot ${res.status} ${path}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function hsPost(path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`HubSpot POST ${res.status} ${path}`)
  return res.json()
}

// ─── Fetch engagements for a deal ─────────────────────────

async function fetchDealEngagements(dealId) {
  const engagementTypes = ['calls', 'emails', 'communications', 'notes', 'meetings', 'tasks']
  const all = []

  for (const type of engagementTypes) {
    try {
      const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/${type}`)
      const ids = (assoc?.results ?? []).map(r => r.id)
      if (!ids.length) continue

      // Fetch in batches of 10 with properties
      const props = getPropsForType(type)
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10)
        try {
          const data = await hsPost(`/crm/v3/objects/${type}/batch/read`, {
            properties: props,
            inputs: batch.map(id => ({ id }))
          })
          for (const obj of data.results ?? []) {
            all.push({ type, obj, resolvedByDeal: true })
          }
        } catch (e) {
          console.warn(`  Batch read failed for ${type}: ${e.message}`)
        }
        await delay(100)
      }
    } catch (e) {
      // Association might not exist for this type on this deal — skip
    }
  }

  return all
}

function getPropsForType(type) {
  const base = ['hs_timestamp', 'hs_createdate']
  switch (type) {
    case 'calls':          return [...base, 'hs_call_direction','hs_call_duration','hs_call_disposition','hs_call_title','hs_call_body','hs_call_status']
    case 'emails':         return [...base, 'hs_email_direction','hs_email_subject','hs_email_text','hs_email_status']
    case 'communications': return [...base, 'hs_communication_channel_type','hs_communication_body','hs_communication_logged_from']
    case 'notes':          return [...base, 'hs_note_body']
    case 'meetings':       return [...base, 'hs_meeting_title','hs_meeting_body','hs_meeting_outcome','hs_meeting_start_time']
    case 'tasks':          return [...base, 'hs_task_subject','hs_task_body','hs_task_status','hs_task_type']
    default:               return base
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Normalize engagement to comm row ─────────────────────

function normalizeEngagement(type, obj, caseId, caseContactId, hubspotContactId, hubspotDealId, resolutionMethod) {
  const p = obj.properties ?? {}
  const engId = String(obj.id)

  let channel = 'other'
  let direction = null
  let subject = null
  let snippet = null
  let durationSeconds = null
  let outcome = null
  let occurredAt = p.hs_timestamp ?? p.hs_createdate ?? null

  switch (type) {
    case 'calls':
      channel = 'call'
      direction = p.hs_call_direction?.toLowerCase() === 'inbound' ? 'inbound'
                : p.hs_call_direction?.toLowerCase() === 'outbound' ? 'outbound' : 'unknown'
      subject = p.hs_call_title ?? null
      snippet = p.hs_call_body ? p.hs_call_body.slice(0, 500) : null
      durationSeconds = p.hs_call_duration ? Math.round(parseInt(p.hs_call_duration) / 1000) : null
      outcome = p.hs_call_disposition ?? null
      break

    case 'emails':
      channel = 'email'
      direction = p.hs_email_direction?.toLowerCase().includes('inbound') ? 'inbound'
                : p.hs_email_direction?.toLowerCase().includes('outbound') ? 'outbound' : 'unknown'
      subject = p.hs_email_subject ?? null
      snippet = p.hs_email_text ? p.hs_email_text.slice(0, 500) : null
      break

    case 'communications':
      channel = 'sms'
      direction = p.hs_communication_logged_from?.toLowerCase().includes('client') ? 'inbound' : 'outbound'
      snippet = p.hs_communication_body ? p.hs_communication_body.slice(0, 500) : null
      break

    case 'notes':
      channel = 'note'
      snippet = p.hs_note_body ? p.hs_note_body.slice(0, 500) : null
      break

    case 'meetings':
      channel = 'meeting'
      subject = p.hs_meeting_title ?? null
      snippet = p.hs_meeting_body ? p.hs_meeting_body.slice(0, 500) : null
      outcome = p.hs_meeting_outcome ?? null
      occurredAt = p.hs_meeting_start_time ?? occurredAt
      break

    case 'tasks':
      channel = 'task'
      subject = p.hs_task_subject ?? null
      snippet = p.hs_task_body ? p.hs_task_body.slice(0, 500) : null
      outcome = p.hs_task_status ?? null
      break
  }

  return {
    case_id:                caseId,
    case_contact_id:        caseContactId ?? null,
    hubspot_engagement_id:  engId,
    hubspot_contact_id:     hubspotContactId ?? null,
    hubspot_deal_id:        hubspotDealId ?? null,
    channel,
    direction,
    subject,
    snippet,
    occurred_at:            occurredAt,
    duration_seconds:       durationSeconds,
    outcome,
    source_system:          'hubspot',
    resolution_method:      resolutionMethod,
    needs_review:           false,
    raw_metadata:           { type, properties: p },
    is_deleted:             false,
    updated_at:             new Date().toISOString(),
  }
}

// ─── Sync contacts for a case ──────────────────────────────

async function syncCaseContacts(caseId, dealId) {
  const assoc = await hs(`/crm/v3/objects/deals/${dealId}/associations/contacts`)
  const contactIds = (assoc?.results ?? []).map(r => r.id)

  if (!contactIds.length) {
    console.log('  No contacts associated with deal')
    return []
  }

  const contactRows = []
  for (let i = 0; i < contactIds.length; i++) {
    const cid = contactIds[i]
    try {
      const contact = await hs(`/crm/v3/objects/contacts/${cid}?properties=firstname,lastname,email,phone`)
      const cp = contact.properties ?? {}
      contactRows.push({
        case_id:             caseId,
        hubspot_contact_id:  cid,
        first_name:          cp.firstname ?? null,
        last_name:           cp.lastname ?? null,
        email:               cp.email ?? null,
        phone:               cp.phone ?? null,
        relationship:        i === 0 ? 'primary' : 'other',
        is_primary:          i === 0,
        is_deleted:          false,
        updated_at:          new Date().toISOString(),
      })
    } catch (e) {
      console.warn(`  Failed to fetch contact ${cid}: ${e.message}`)
    }
    await delay(100)
  }

  if (contactRows.length) {
    const { error } = await coreDb
      .from('case_contacts')
      .upsert(contactRows, { onConflict: 'case_id,hubspot_contact_id' })
    if (error) throw new Error(`case_contacts upsert: ${error.message}`)
    console.log(`  ${contactRows.length} contact(s) synced to case_contacts`)
  }

  return contactRows
}

// ─── Main sync for a single deal ──────────────────────────

async function syncDealComms(dealId) {
  // Look up case
  const { data: caseRow, error: caseErr } = await coreDb
    .from('cases')
    .select('id, hubspot_deal_id, client_first_name, client_last_name')
    .eq('hubspot_deal_id', String(dealId))
    .eq('is_deleted', false)
    .single()

  if (caseErr || !caseRow) {
    console.log(`  Deal ${dealId} not found in core.cases — sync it first`)
    return { ok: 0, err: 0, review: 0 }
  }

  console.log(`  Case: ${caseRow.client_first_name} ${caseRow.client_last_name} (${caseRow.id})`)

  // Sync contacts first
  const contacts = await syncCaseContacts(caseRow.id, dealId)

  // Build contact lookup map: hubspot_contact_id → case_contacts.id
  const { data: ccRows } = await coreDb
    .from('case_contacts')
    .select('id, hubspot_contact_id')
    .eq('case_id', caseRow.id)
  const contactMap = Object.fromEntries((ccRows ?? []).map(r => [r.hubspot_contact_id, r.id]))

  // Fetch all engagements via deal association
  console.log('  Fetching engagements via deal association...')
  const engagements = await fetchDealEngagements(dealId)
  console.log(`  ${engagements.length} engagements found`)

  if (!engagements.length) return { ok: 0, err: 0, review: 0 }

  // Normalize + upsert
  const rows = engagements.map(({ type, obj }) =>
    normalizeEngagement(
      type, obj,
      caseRow.id,
      null, // case_contact_id — would need association lookup per engagement; skip for phase 1
      null, // hubspot_contact_id — deal-level resolution doesn't need it
      String(dealId),
      'deal_association'
    )
  )

  let ok = 0, err = 0, review = 0
  // Upsert in batches
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50)
    const { error } = await coreDb
      .from('communications')
      .upsert(chunk, { onConflict: 'hubspot_engagement_id,source_system' })
    if (error) {
      console.error(`  Upsert error: ${error.message}`)
      err += chunk.length
    } else {
      ok += chunk.length
    }
  }

  return { ok, err, review }
}

// ─── CLI ──────────────────────────────────────────────────

const args = process.argv.slice(2)
const dealId  = args.find(a => a.startsWith('--deal-id='))?.split('=')[1]
const dealIds = args.find(a => a.startsWith('--deal-ids='))?.split('=')[1]?.split(',')

if (!dealId && !dealIds) {
  console.error('Usage: --deal-id=<id>  or  --deal-ids=<id1,id2,...>')
  process.exit(1)
}

const ids = dealId ? [dealId] : dealIds

let totalOk = 0, totalErr = 0, totalReview = 0

for (const id of ids) {
  console.log(`\n▶  Syncing comms for deal: ${id}`)
  console.log('─'.repeat(50))
  try {
    const { ok, err, review } = await syncDealComms(id)
    totalOk += ok; totalErr += err; totalReview += review
    console.log(`  ✅ ${ok} comms synced, ${err} errors, ${review} flagged for review`)
  } catch (e) {
    console.error(`  ❌ ${e.message}`)
    totalErr++
  }
  await delay(200)
}

const { count } = await coreDb.from('communications').select('*', { count: 'exact', head: true })
console.log(`\n${'─'.repeat(50)}`)
console.log(`Total synced: ${totalOk} | Errors: ${totalErr} | Flagged: ${totalReview}`)
console.log(`core.communications total: ${count}`)
