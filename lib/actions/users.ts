'use server'

import { getTeamSession } from '@/lib/session'
import { supabaseAdmin }  from '@/lib/supabase'

// Block a user from portal access (portal-only, Azure account unaffected)
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

// The only email allowed to assign/edit portal roles
const ROLE_EDITOR_EMAIL = process.env.PORTAL_OWNER_EMAIL ?? 'novaj@rockpointgrowth.com'

// Assign a portal role to a staff user
export async function assignRoleAction(
  email:  string,
  roleId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getTeamSession()
    if (!session) return { success: false, error: 'Unauthorized' }

    // Role editing is restricted to the portal owner account
    // Check real identity even during impersonation
    const realEmail = session.impersonating?.impersonatorEmail ?? session.email
    if (realEmail.toLowerCase() !== ROLE_EDITOR_EMAIL.toLowerCase()) {
      return { success: false, error: 'Only the portal owner can assign roles' }
    }

    const { error } = await supabaseAdmin
      .schema('staff')
      .from('staff_users')
      .update({ primary_role_id: roleId, updated_at: new Date().toISOString() })
      .eq('email', email.toLowerCase())
      .eq('is_deleted', false)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
