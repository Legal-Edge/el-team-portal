/**
 * GET /api/cases/stream
 * GET /api/cases/stream?id={hubspot_deal_id}
 *
 * Server-Sent Events endpoint — streams core.cases Realtime updates to authenticated clients.
 * Uses service role key server-side so no anon RLS exposure.
 * Auth: NextAuth session required (Option B SSE proxy pattern).
 *
 * Events emitted:
 *   event: connected   — initial handshake
 *   event: case        — INSERT / UPDATE / DELETE on core.cases
 *   : heartbeat        — comment line every 20s to keep connection alive
 *
 * Vercel: function stays alive while stream is open (up to maxDuration).
 * EventSource auto-reconnects when the function closes.
 */

import { NextRequest }    from 'next/server'
import { getTeamSession } from '@/lib/session'
import { createClient }   from '@supabase/supabase-js'

export const dynamic    = 'force-dynamic'
export const maxDuration = 55  // just under 60s Vercel hobby limit; EventSource reconnects automatically

export async function GET(req: NextRequest) {
  // Auth gate — no session, no stream
  const session = await getTeamSession()
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const caseId = searchParams.get('id') ?? null   // optional: hubspot_deal_id filter

  const encoder = new TextEncoder()

  // Supabase service-role client — bypasses RLS; auth is enforced above at the Next.js layer
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Controller already closed — client disconnected
        }
      }

      function heartbeat() {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer)
        }
      }

      // Initial handshake
      send('connected', { status: 'connected', caseId, staffId: session.staffId })

      // Build Realtime filter
      const pgFilter = caseId
        ? { event: '*' as const, schema: 'core', table: 'cases', filter: `hubspot_deal_id=eq.${caseId}` }
        : { event: '*' as const, schema: 'core', table: 'cases' }

      const channelName = caseId
        ? `cases-sse-${session.staffId}-${caseId}`
        : `cases-sse-${session.staffId}`

      // Subscribe to core.cases via Realtime (service role — sees all rows)
      supabase
        .channel(channelName)
        .on('postgres_changes', pgFilter, (payload) => {
          send('case', {
            type:    payload.eventType,
            new:     payload.eventType !== 'DELETE' ? payload.new : null,
            old:     payload.eventType !== 'INSERT' ? payload.old : null,
            caseId:  caseId,
          })
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            send('connected', { status: 'subscribed' })
          }
        })

      // Subscribe to core.document_files — send 'docs' event when files change.
      // Service role bypasses RLS so this works regardless of anon permissions.
      // Resolves case UUID from hubspot_deal_id to filter by case_id.
      if (caseId) {
        supabase.schema('core').from('cases').select('id')
          .eq('hubspot_deal_id', caseId).maybeSingle()
          .then(({ data }) => {
            if (!data?.id) return
            const caseUUID = data.id
            supabase
              .channel(`docs-sse-${session.staffId}-${caseUUID}`)
              .on('postgres_changes', {
                event:  '*',
                schema: 'core',
                table:  'document_files',
                filter: `case_id=eq.${caseUUID}`,
              }, (payload) => {
                send('docs', { type: payload.eventType, caseId })
              })
              .subscribe()
          })
      }

      // Keepalive — prevents Vercel / load-balancer from closing idle connections
      heartbeatTimer = setInterval(heartbeat, 20_000)
    },

    cancel() {
      // Client disconnected — clean up
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      // Supabase channels are cleaned up when the client GCs
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',     // disable nginx buffering
    },
  })
}
