import { NextResponse }  from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BEARER_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { id, ...fields } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const allowed = ['first_name', 'last_name', 'display_name', 'status']
  const update  = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)))

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  update.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .schema('staff')
    .from('staff_users')
    .update(update)
    .eq('id', id)
    .select('id, email, first_name, last_name, display_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, user: data })
}
