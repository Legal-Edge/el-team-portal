'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

/**
 * Invisible client component — subscribes to Supabase Realtime on the
 * finance.qb_transaction_lines table and silently refreshes the server
 * component data when a new transaction lands via webhook.
 *
 * Uses router.refresh() (Next.js App Router) so only server-side data
 * re-fetches; no full page reload.
 */
export function FinanceRealtimeSync() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const channel = supabase
      .channel('finance-realtime')
      .on('postgres_changes', { event: '*', schema: 'finance', table: 'qb_transaction_lines' }, () => {
        router.refresh()
      })
      .on('postgres_changes', { event: '*', schema: 'finance', table: 'settlements' }, () => {
        router.refresh()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])

  return null // renders nothing
}
