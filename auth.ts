import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"
import { createClient } from '@supabase/supabase-js'

function getStaffDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('staff')
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: { scope: "openid profile email User.Read" }
      }
    })
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false

      // Domain restriction
      const domain = user.email.split('@')[1]
      if (!['easylemon.com', 'rockpointgrowth.com'].includes(domain)) return false

      const staffDb = getStaffDb()
      const azureOid = (profile as any)?.oid ?? null
      const displayName = user.name ?? `${user.email.split('@')[0]}`

      try {
        const { data: staffUser } = await staffDb
          .from('staff_users')
          .select('id, status, is_deleted')
          .eq('email', user.email)
          .single()

        if (!staffUser) {
          // Unknown user — block access (staff must be pre-provisioned)
          console.warn(`Login blocked: ${user.email} not in staff.staff_users`)
          return false
        }

        if (staffUser.is_deleted || staffUser.status !== 'active') {
          console.warn(`Login blocked: ${user.email} is inactive or deleted`)
          return false
        }

        // Update Azure AD object ID, display name, last login, login count
        await staffDb
          .from('staff_users')
          .update({
            azure_ad_object_id: azureOid,
            display_name: displayName,
            last_login: new Date().toISOString(),
            login_count: (staffUser as any).login_count ?? 0 + 1,
            updated_at: new Date().toISOString()
          })
          .eq('email', user.email)

        return true
      } catch (error) {
        console.error('signIn error:', error)
        return false // Fail closed — no DB access = no login
      }
    },

    async session({ session }) {
      if (!session.user?.email) return session

      const staffDb = getStaffDb()

      try {
        // Fetch user + role in one query via foreign key join
        const { data: staffUser, error } = await staffDb
          .from('staff_users')
          .select(`
            id,
            email,
            first_name,
            last_name,
            display_name,
            status,
            time_zone,
            primary_role_id,
            staff_roles!primary_role_id (
              role_name,
              role_level,
              can_create_cases,
              can_edit_all_cases,
              can_delete_cases,
              can_access_financials,
              can_manage_staff,
              can_access_ai_tools,
              can_approve_settlements
            )
          `)
          .eq('email', session.user.email)
          .eq('status', 'active')
          .eq('is_deleted', false)
          .single()

        if (error || !staffUser) {
          console.error('session user lookup failed:', error)
          return session
        }

        const role = (staffUser as any).staff_roles

        // Enrich session with live identity + role data
        session.user.staffId = staffUser.id
        session.user.displayName = staffUser.display_name
          ?? `${staffUser.first_name} ${staffUser.last_name}`.trim()
        session.user.role = role?.role_name ?? 'staff'
        session.user.roleLevel = role?.role_level ?? 0
        session.user.permissions = {
          canCreateCases:       role?.can_create_cases ?? false,
          canEditAllCases:      role?.can_edit_all_cases ?? false,
          canDeleteCases:       role?.can_delete_cases ?? false,
          canAccessFinancials:  role?.can_access_financials ?? false,
          canManageStaff:       role?.can_manage_staff ?? false,
          canAccessAiTools:     role?.can_access_ai_tools ?? false,
          canApproveSettlements:role?.can_approve_settlements ?? false,
        }
        session.user.timeZone = staffUser.time_zone ?? 'America/Los_Angeles'
      } catch (error) {
        console.error('session enrichment error:', error)
      }

      return session
    }
  },

  pages: {
    signIn: '/login',
  }
})
