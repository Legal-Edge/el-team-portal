// POST /api/admin/sharepoint/subscribe
// DEPRECATED — global drive subscription replaced by per-case folder subscriptions.
// Use /api/admin/sharepoint/subscribe-case instead.

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    deprecated: true,
    message: 'Use /api/admin/sharepoint/subscribe-case with { case_id } instead. Per-case folder subscriptions replaced the global drive subscription.',
  }, { status: 410 })
}
