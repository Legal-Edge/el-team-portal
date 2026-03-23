import { NextResponse }   from 'next/server'
import { supabaseAdmin }  from '@/lib/supabase'

const BEARER_TOKEN = process.env.BACKFILL_IMPORT_TOKEN!

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, name, reason } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('portal_blocked_users')
    .upsert({ email: email.toLowerCase(), name, reason }, { onConflict: 'email' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('portal_blocked_users')
    .delete()
    .eq('email', email.toLowerCase())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
