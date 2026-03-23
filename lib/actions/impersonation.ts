'use server'

import { cookies }        from 'next/headers'
import { getTeamSession } from '@/lib/session'
import { supabaseAdmin }  from '@/lib/supabase'
import {
  IMPERSONATION_COOKIE,
  signImpersonationToken,
} from '@/lib/impersonation'

export async function startImpersonationAction(
  targetEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getTeamSession()
    if (!session || session.role !== 'admin') {
      return { success: false, error: 'Admin access required' }
    }

    // Look up target user
    const { data: targetUser, error } = await supabaseAdmin
      .schema('staff')
      .from('staff_users')
      .select(`
        id, email, display_name, status, is_deleted,
        staff_roles!primary_role_id(role_name)
      `)
      .eq('email', targetEmail.toLowerCase())
      .eq('is_deleted', false)
      .eq('status', 'active')
      .single()

    if (error || !targetUser) {
      return { success: false, error: 'User not found or inactive' }
    }

    const targetRole = (targetUser as any).staff_roles?.role_name ?? 'staff'

    // Block impersonating another admin
    if (targetRole === 'admin') {
      return { success: false, error: 'Cannot impersonate an admin account' }
    }

    // Sign the impersonation token
    const token = await signImpersonationToken({
      targetEmail:       targetUser.email,
      targetName:        (targetUser as any).display_name ?? targetEmail,
      targetRole,
      targetStaffId:     targetUser.id,
      impersonatorEmail: session.email,
    })

    // Set cookie (httpOnly, same-site, 2h)
    const jar = await cookies()
    jar.set(IMPERSONATION_COOKIE, token, {
      httpOnly:  true,
      sameSite:  'lax',
      secure:    process.env.NODE_ENV === 'production',
      maxAge:    60 * 60 * 2, // 2 hours
      path:      '/',
    })

    // Audit log
    try {
      await supabaseAdmin
        .schema('staff')
        .from('impersonation_log')
        .insert({
          impersonator_email: session.email,
          target_email:       targetUser.email,
          target_role:        targetRole,
          started_at:         new Date().toISOString(),
        })
    } catch {
      // Log table may not exist yet — non-fatal
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function stopImpersonationAction(): Promise<void> {
  const jar = await cookies()
  jar.delete(IMPERSONATION_COOKIE)
}
