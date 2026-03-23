import { NextResponse }  from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BEARER_TOKEN    = process.env.BACKFILL_IMPORT_TOKEN!
const DEFAULT_ROLE_ID = '5ed767f1-1442-404b-a440-25aa81c6d2b1'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Try inserting one test record
  const testEmail = `_test_provision_${Date.now()}@test.internal`

  const { data, error } = await supabaseAdmin
    .schema('staff')
    .from('staff_users')
    .insert({
      email:           testEmail,
      first_name:      'Test',
      last_name:       'User',
      display_name:    'Test User',
      primary_role_id: DEFAULT_ROLE_ID,
      status:          'active',
    })
    .select('id, email')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message, code: error.code, hint: error.hint, details: error.details })
  }

  // Clean up test record
  await supabaseAdmin.schema('staff').from('staff_users').delete().eq('email', testEmail)

  return NextResponse.json({ success: true, inserted: data })
}
