import { createClient } from '@supabase/supabase-js'

// Create Supabase client for client-side operations
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
)

// Create Supabase client with service role for server-side operations
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  {
    db: { schema: 'core' } // Try core schema first, fall back to public
  }
)

// Type definitions for our database tables
export interface Deal {
  id: string
  dealname: string | null
  dealstage: string | null
  el_app_status: string | null
  hubspot_owner_email: string | null
  phone: string | null
  email: string | null
  createdate: string | null
  closedate: string | null
  amount: string | null
  what_is_the_approximate_year_of_your_vehicle_: string | null
  what_is_the_make_of_your_vehicle_: string | null
  what_is_the_model_of_your_vehicle_: string | null
  // Add other fields as needed
}

export interface StaffUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'staff'
  active: boolean
  created_at: string
}