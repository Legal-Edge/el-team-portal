// PATCH /api/admin/ai-knowledge/[entryId] — update entry
// DELETE /api/admin/ai-knowledge/[entryId] — delete entry

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')
}

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.email) return null
  const superAdmins = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map(e => e.trim())
  const db = adminDb()
  const { data: staff } = await db.from('staff_users' as never).select('role').eq('email', session.user.email).single() as { data: { role: string } | null }
  if (superAdmins.includes(session.user.email) || staff?.role === 'admin') return session
  return null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { entryId } = await params
  const body = await req.json()
  const db = adminDb()
  const { data, error } = await db.from('ai_knowledge_base').update({
    ...body,
    updated_at: new Date().toISOString(),
  }).eq('id', entryId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ entry: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { entryId } = await params
  const db = adminDb()
  const { error } = await db.from('ai_knowledge_base').delete().eq('id', entryId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
