import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read"
        }
      }
    })
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Only allow users from approved domains
      if (!user.email) return false
      
      const emailDomain = user.email.split('@')[1]
      const allowedDomains = ['easylemon.com', 'rockpointgrowth.com']
      
      if (!allowedDomains.includes(emailDomain)) {
        return false
      }
      
      // Check if user exists in staff_users table
      try {
        const { data: staffUser } = await supabase
          .from('staff_users')
          .select('*')
          .eq('email', user.email)
          .single()
        
        if (!staffUser) {
          // Create staff user record if doesn't exist
          await supabase
            .from('staff_users')
            .insert([
              {
                email: user.email,
                name: user.name || '',
                role: user.email === 'novaj@rockpointgrowth.com' ? 'admin' : 'staff',
                active: true
              }
            ])
        }
        
        return true
      } catch (error) {
        console.error('Error checking staff user:', error)
        return false
      }
    },
    async session({ session, token }) {
      if (session.user?.email) {
        try {
          const { data: staffUser } = await supabase
            .from('staff_users')
            .select('role, active')
            .eq('email', session.user.email)
            .single()
          
          if (staffUser) {
            session.user.role = staffUser.role
            session.user.active = staffUser.active
          }
        } catch (error) {
          console.error('Error fetching user role:', error)
        }
      }
      return session
    }
  },
  pages: {
    signIn: '/login',
  }
})