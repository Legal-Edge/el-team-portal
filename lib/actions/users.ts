'use server'

import { getTeamSession } from '@/lib/session'
import { supabaseAdmin }  from '@/lib/supabase'
import { redirect }       from 'next/navigation'

export async function blockUserAction(email: string, name: string | null) {
  const session = await getTeamSession()
  if (!session || session.role !== 'admin') redirect('/login')

  const { error } = await supabaseAdmin
    .from('portal_blocked_users')
    .upsert(
      { email: email.toLowerCase(), name, blocked_by: session.email },
      { onConflict: 'email' }
    )

  if (error) throw new Error(error.message)
}
