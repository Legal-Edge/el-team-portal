import { auth } from '@/auth'

export type TeamRole = 'admin' | 'attorney' | 'manager' | 'paralegal' | 'staff'

export type TeamSession = {
  staffId:     string
  email:       string
  displayName: string
  role:        TeamRole
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
 * Use this in all server components and API routes for consistent role enforcement.
 */
export async function getTeamSession(): Promise<TeamSession | null> {
  const session = await auth()
  if (!session?.user?.email) return null

  return {
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
}

/** Convenience: is the user an admin? */
export function isAdmin(session: TeamSession): boolean {
  return session.role === 'admin'
}

/** Convenience: can the user send SMS? (admin, attorney, manager) */
export function canSendSms(session: TeamSession): boolean {
  return ['admin', 'attorney', 'manager'].includes(session.role)
}
