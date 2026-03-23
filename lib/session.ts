import { auth }    from '@/auth'
import { cookies } from 'next/headers'
import { IMPERSONATION_COOKIE, verifyImpersonationToken } from '@/lib/impersonation'

export type TeamRole = 'admin' | 'attorney' | 'manager' | 'case_manager' | 'paralegal' | 'intake' | 'support' | 'staff'

export type TeamSession = {
  staffId:      string
  email:        string
  displayName:  string
  role:         TeamRole
  impersonating?: {
    email:             string
    name:              string
    role:              TeamRole
    impersonatorEmail: string
  }
  permissions: {
    canCreateCases:        boolean
    canEditAllCases:       boolean
    canDeleteCases:        boolean
    canAccessFinancials:   boolean
    canManageStaff:        boolean
    canAccessAiTools:      boolean
    canApproveSettlements: boolean
  }
  timeZone: string
}

/**
 * Fetch and validate the current team session from NextAuth.
 * Returns null if unauthenticated.
 * If an impersonation cookie is present and valid, the returned session reflects
 * the target user's role/identity while preserving the real admin identity.
 */
export async function getTeamSession(): Promise<TeamSession | null> {
  const session = await auth()
  if (!session?.user?.email) return null

  const teamSession: TeamSession = {
    staffId:     session.user.staffId     ?? '',
    email:       session.user.email,
    displayName: session.user.displayName ?? session.user.name ?? session.user.email,
    role:        (session.user.role       ?? 'staff') as TeamRole,
    permissions: {
      canCreateCases:        session.user.permissions?.canCreateCases        ?? false,
      canEditAllCases:       session.user.permissions?.canEditAllCases       ?? false,
      canDeleteCases:        session.user.permissions?.canDeleteCases        ?? false,
      canAccessFinancials:   session.user.permissions?.canAccessFinancials   ?? false,
      canManageStaff:        session.user.permissions?.canManageStaff        ?? false,
      canAccessAiTools:      session.user.permissions?.canAccessAiTools      ?? false,
      canApproveSettlements: session.user.permissions?.canApproveSettlements ?? false,
    },
    timeZone: session.user.timeZone ?? 'America/Los_Angeles',
  }

  // ── Impersonation overlay ────────────────────────────────────────────────
  // Only applies when the real user is an admin
  if (teamSession.role === 'admin') {
    try {
      const jar   = await cookies()
      const token = jar.get(IMPERSONATION_COOKIE)?.value
      if (token) {
        const imp = await verifyImpersonationToken(token)
        if (imp) {
          // Overlay the target user's identity onto the session
          return {
            ...teamSession,
            staffId:     imp.targetStaffId,
            email:       imp.targetEmail,
            displayName: imp.targetName,
            role:        imp.targetRole as TeamRole,
            impersonating: {
              email:             imp.targetEmail,
              name:              imp.targetName,
              role:              imp.targetRole as TeamRole,
              impersonatorEmail: imp.impersonatorEmail,
            },
            // Grant full permissions for "view as" — we want to see exactly what they see
            permissions: {
              canCreateCases:        ['admin','attorney','manager'].includes(imp.targetRole),
              canEditAllCases:       ['admin','attorney','manager','case_manager'].includes(imp.targetRole),
              canDeleteCases:        imp.targetRole === 'admin',
              canAccessFinancials:   ['admin','attorney','manager'].includes(imp.targetRole),
              canManageStaff:        ['admin','manager'].includes(imp.targetRole),
              canAccessAiTools:      ['admin','attorney','manager','paralegal','case_manager'].includes(imp.targetRole),
              canApproveSettlements: ['admin','attorney'].includes(imp.targetRole),
            },
          }
        }
      }
    } catch {
      // Impersonation cookie parse failure — ignore, return real session
    }
  }

  return teamSession
}

/** Convenience: is the user an admin? */
export function isAdmin(session: TeamSession): boolean {
  return session.role === 'admin'
}

/** Convenience: can the user send SMS? (admin, attorney, manager) */
export function canSendSms(session: TeamSession): boolean {
  return ['admin', 'attorney', 'manager', 'case_manager', 'support'].includes(session.role)
}
