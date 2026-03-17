// GET  /api/admin/ai-knowledge — list all entries
// POST /api/admin/ai-knowledge — create entry

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')
}

async function requireAdmin(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return null
  const superAdmins = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map(e => e.trim())
  const db = adminDb()
  const { data: staff } = await db.from('staff_users' as never).select('role').eq('email', session.user.email).single() as { data: { role: string } | null }
  if (superAdmins.includes(session.user.email) || staff?.role === 'admin') return session
  return null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = adminDb()
  const { data } = await db
    .from('ai_knowledge_base')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
  return NextResponse.json({ entries: data ?? [] })
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json()
  const db = adminDb()
  const { data, error } = await db.from('ai_knowledge_base').insert({
    category:   body.category,
    title:      body.title,
    content:    body.content,
    applies_to: body.applies_to ?? ['extraction', 'analysis'],
    doc_types:  body.doc_types ?? null,
    sort_order: body.sort_order ?? 0,
    is_active:  true,
    created_by: admin.user?.email,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ entry: data })
}
