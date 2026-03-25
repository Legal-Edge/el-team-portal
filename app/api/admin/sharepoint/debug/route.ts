// GET /api/admin/sharepoint/debug
// Diagnostic endpoint: lists subscriptions (with status field), delta link state,
// recent webhook log entries, and drive accessibility.
//
// KEY FIELD: subscription.status
//   "enabled"  → notifications are being delivered ✓
//   "warning"  → delivery failed recently; Graph is retrying
//   "disabled" → Graph stopped delivering; subscription must be renewed/recreated
//
// If status is "warning" or "disabled", recreate the subscription using
// POST /api/admin/sharepoint/subscribe-case with the affected case_id.

import { NextRequest, NextResponse }          from 'next/server'
import { createClient }                       from '@supabase/supabase-js'
import { listSubscriptions, getGraphToken, DOCUMENTS_DRIVE_ID } from '@/lib/sharepoint'

const TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${TOKEN}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const db = supabase.schema('core')

  try {
    const graphToken = await getGraphToken()

    // ── All subscriptions (includes status field) ─────────────────────────
    const allSubs = await listSubscriptions()
    const ours    = allSubs.filter(s => s.clientState === 'el-team-portal')

    // ── Direct lookup of the stored subscription ID ───────────────────────
    const { data: stateRow } = await db
      .from('sync_state')
      .select('value')
      .eq('key', 'sharepoint_subscription_id')
      .maybeSingle()
    const storedSubId = (stateRow?.value as string) ?? 'none'

    let directSub: Record<string, unknown> = { error: 'no subscription ID stored' }
    if (storedSubId !== 'none') {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${storedSubId}`,
        { headers: { Authorization: `Bearer ${graphToken}` } }
      )
      directSub = res.ok
        ? await res.json()
        : { httpStatus: res.status, error: await res.text() }
    }

    // ── Delta link state ──────────────────────────────────────────────────
    const { data: deltaRow } = await db
      .from('sync_state')
      .select('value, updated_at')
      .eq('key', 'sharepoint_drive_delta_link')
      .maybeSingle()

    // ── Drive root accessibility ──────────────────────────────────────────
    const driveRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${DOCUMENTS_DRIVE_ID}/root?$select=id,name,webUrl`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    )
    const driveRoot = driveRes.ok ? await driveRes.json() : { error: driveRes.status }

    // ── Recent webhook log entries ────────────────────────────────────────
    const { data: recentLogs } = await db
      .from('sync_log')
      .select('triggered_at, deals_seen, notes')
      .eq('sync_type', 'webhook')
      .like('notes', 'sharepoint_notification:%')
      .order('triggered_at', { ascending: false })
      .limit(10)

    // ── Recent delta cron runs ────────────────────────────────────────────
    const { data: deltaCronLogs } = await db
      .from('sync_log')
      .select('triggered_at, deals_seen, deals_synced, status, notes')
      .eq('sync_type', 'cron_delta')
      .order('triggered_at', { ascending: false })
      .limit(5)

    return NextResponse.json({
      // ─── Subscription health ────────────────────────────────────────────
      subscription: {
        stored_id:    storedSubId,
        status:       (directSub as { status?: string }).status ?? 'unknown',
        resource:     (directSub as { resource?: string }).resource ?? null,
        expiresAt:    (directSub as { expirationDateTime?: string }).expirationDateTime ?? null,
        direct_raw:   directSub,
        all_ours:     ours.map(s => ({
          id:       s.id,
          resource: s.resource,
          status:   s.status ?? 'unknown',
          expires:  s.expirationDateTime,
        })),
        diagnosis: ours.length === 0
          ? '⚠️  No active subscription — call POST /api/admin/sharepoint/subscribe-case'
          : ours.some(s => s.status === 'disabled')
            ? '🔴 Subscription DISABLED — Graph stopped delivering. Recreate subscription.'
            : ours.some(s => s.status === 'warning')
              ? '🟡 Subscription WARNING — delivery failing. Renew or recreate.'
              : '🟢 Subscription enabled — delivery should work',
      },

      // ─── Delta query state ──────────────────────────────────────────────
      delta: {
        hasLink:    !!deltaRow?.value,
        updatedAt:  (deltaRow as { updated_at?: string } | null)?.updated_at ?? null,
        linkPrefix: deltaRow?.value ? (deltaRow.value as string).slice(0, 80) + '…' : null,
        note:       deltaRow?.value
          ? 'Delta tracking active — cron will detect changes on next run'
          : '⚠️  No delta link — trigger GET /api/admin/cron/sharepoint-delta once to initialize',
      },

      // ─── Drive access ───────────────────────────────────────────────────
      driveRoot,

      // ─── Recent delivery log ────────────────────────────────────────────
      webhookLog: (recentLogs ?? []).map(l => ({
        at:    l.triggered_at,
        count: l.deals_seen,
        body:  (l as { notes?: string }).notes?.replace('sharepoint_notification: ', '').slice(0, 200),
      })),

      deltaCronLog: (deltaCronLogs ?? []).map(l => ({
        at:     l.triggered_at,
        status: l.status,
        notes:  l.notes,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
