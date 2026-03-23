'use server'

import { getTeamSession } from '@/lib/session'
import { supabaseAdmin }  from '@/lib/supabase'

export async function blockUserAction(
  email: string,
  name:  string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getTeamSession()
    if (!session || session.role !== 'admin') {
      return { success: false, error: 'Unauthorized' }
    }

    const { error } = await supabaseAdmin
      .from('portal_blocked_users')
      .upsert(
        { email: email.toLowerCase(), name, blocked_by: session.email },
        { onConflict: 'email' }
      )

    if (error) {
      // Table likely doesn't exist yet — return clear message
      if (error.code === '42P01') {
        return { success: false, error: 'Migration not run. Please create the portal_blocked_users table in Supabase.' }
      }
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
