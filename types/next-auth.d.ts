import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      staffId?: string
      displayName?: string
      role?: string
      roleLevel?: number
      timeZone?: string
      permissions?: {
        canCreateCases: boolean
        canEditAllCases: boolean
        canDeleteCases: boolean
        canAccessFinancials: boolean
        canManageStaff: boolean
        canAccessAiTools: boolean
        canApproveSettlements: boolean
      }
    } & DefaultSession["user"]
  }
}
