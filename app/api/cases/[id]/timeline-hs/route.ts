/**
 * GET /api/cases/[id]/timeline-hs
 *
 * Returns HubSpot engagements (calls, notes, emails, tasks) for a deal
 * as timeline-compatible items, with Aloware AI call summaries included.
 *
 * The client merges these with the Supabase timeline, deduplicating by
 * engagement_id against existing comm records.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTeamSession }            from '@/lib/session'

function getHsToken() {
  const t = process.env.HUBSPOT_ACCESS_TOKEN
  if (!t) throw new Error('HUBSPOT_ACCESS_TOKEN not set')
  return t
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export interface HsTimelineItem {
  id:            string   // "hs_<engagement_id>"
  engagement_id: string   // raw HubSpot engagement ID
  source:        'hubspot'
  item_type:     'call' | 'note' | 'email' | 'task' | 'meeting'
  ts:            string   // ISO timestamp
  body:          string | null
  call_summary:  string | null   // Aloware AI summary (calls only)
  direction:     'inbound' | 'outbound' | null
  duration_ms:   number | null
  author_ref:    string | null
  author_name:   string | null
  status:        string | null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTeamSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: dealId } = await params
  const token = getHsToken()

  // Fetch association: deal → engagements
  const assocRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/engagements`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  if (!assocRes.ok) return NextResponse.json({ items: [] })
  const assoc = await assocRes.json() as { results?: { id: string }[] }
  const ids   = (assoc.results ?? []).map(r => r.id)
  if (!ids.length) return NextResponse.json({ items: [] })

  const items: HsTimelineItem[] = []

  for (const engId of ids) {
    try {
      const res = await fetch(
        `https://api.hubapi.com/engagements/v1/engagements/${engId}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) continue

      const data = await res.json() as {
        engagement?: {
          type?: string; createdAt?: number
          ownerId?: number; ownerEmail?: string
        }
        metadata?: {
          body?:                 string
          callSummary?:          string
          status?:               string
          durationMilliseconds?: number
          direction?:            string
          title?:                string
          toNumber?:             string
          fromNumber?:           string
        }
      }

      const e   = data.engagement ?? {}
      const m   = data.metadata   ?? {}
      const raw = (e.type ?? '').toUpperCase()

      const item_type: HsTimelineItem['item_type'] =
        raw === 'CALL'    ? 'call'    :
        raw === 'NOTE'    ? 'note'    :
        raw === 'EMAIL'   ? 'email'   :
        raw === 'TASK'    ? 'task'    :
        raw === 'MEETING' ? 'meeting' : 'note'

      const bodyText    = m.body        ? stripHtml(m.body).slice(0, 4000)  : null
      const summaryText = m.callSummary ? stripHtml(m.callSummary).slice(0, 3000) : null

      const direction: HsTimelineItem['direction'] =
        m.direction === 'OUTBOUND' ? 'outbound' :
        m.direction === 'INBOUND'  ? 'inbound'  : null

      items.push({
        id:            `hs_${engId}`,
        engagement_id: engId,
        source:        'hubspot',
        item_type,
        ts:            e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString(),
        body:          bodyText,
        call_summary:  summaryText,
        direction,
        duration_ms:   m.durationMilliseconds ?? null,
        author_ref:    e.ownerEmail ?? null,
        author_name:   null,
        status:        m.status ?? null,
      })
    } catch { /* skip */ }
  }

  // Sort newest first
  items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  return NextResponse.json({ items })
}
