/**
 * Safe Supabase Realtime wrapper.
 * WebSocket connections fail on iOS Safari with "The operation is insecure"
 * when in certain security contexts. This wrapper catches those errors
 * gracefully so they never crash the app.
 */
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

export function createRealtimeClient(): SupabaseClient | null {
  try {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  } catch (e) {
    console.warn('[Realtime] Failed to create Supabase client:', e)
    return null
  }
}

export function safeSubscribe(
  channel: RealtimeChannel,
  onStatus?: (status: string) => void
): RealtimeChannel {
  try {
    channel.subscribe((status, err) => {
      if (err) console.warn('[Realtime] subscription error:', err)
      onStatus?.(status)
    })
  } catch (e) {
    console.warn('[Realtime] subscribe() threw:', e)
  }
  return channel
}

export function safeRemoveChannel(
  client: SupabaseClient | null,
  channel: RealtimeChannel | null
) {
  if (!client || !channel) return
  try { client.removeChannel(channel) } catch { /* ignore */ }
}
