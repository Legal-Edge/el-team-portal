// PATCH /api/documents/[fileId]/extraction
// Saves manually corrected extraction fields and triggers KB auto-learning

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const ANALYSIS_MODEL = 'claude-sonnet-4-20250514'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fileId } = await params
  const { corrected, original } = await req.json()
  // corrected = full updated extraction object
  // original  = original AI extraction (before edits)

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  // Fetch current file for context
  const { data: file } = await db
    .from('document_files')
    .select('id, file_name, document_type_code, ai_extraction')
    .eq('id', fileId)
    .single()

  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  // Save corrected extraction
  const { error: updateErr } = await db.from('document_files').update({
    ai_extraction:    corrected,
    ai_extracted_at:  new Date().toISOString(), // keep timestamp fresh
  }).eq('id', fileId)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Auto-generate KB rule from corrections (async, non-blocking)
  let kbRule: { title: string; content: string } | null = null
  try {
    kbRule = await generateKbRule(original, corrected, file.document_type_code, file.file_name)
    if (kbRule) {
      // Insert into knowledge base
      await db.from('ai_knowledge_base').insert({
        category:   'extraction_rules',
        title:      kbRule.title,
        content:    kbRule.content,
        applies_to: ['extraction'],
        doc_types:  file.document_type_code ? [file.document_type_code] : null,
        sort_order: 500,
        is_active:  true,
        created_by: `auto-correction:${session.user?.email ?? 'staff'}`,
      })
    }
  } catch (e) {
    console.error('[extraction PATCH] KB rule generation failed:', e)
  }

  return NextResponse.json({ ok: true, kb_rule_added: kbRule ? kbRule.title : null })
}

// ── Auto-generate a KB rule from the correction ───────────────────────────
async function generateKbRule(
  original: Record<string, unknown>,
  corrected: Record<string, unknown>,
  docType: string | null,
  fileName: string,
): Promise<{ title: string; content: string } | null> {
  // Find changed fields
  const changes: string[] = []
  for (const key of Object.keys(corrected)) {
    if (String(corrected[key]) !== String(original?.[key] ?? '')) {
      changes.push(`Field "${key}": AI extracted "${original?.[key] ?? 'null'}" → corrected to "${corrected[key]}"`)
    }
  }
  if (changes.length === 0) return null

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `A staff member corrected AI extraction errors on a ${docType ?? 'document'} (file: ${fileName}).

Corrections made:
${changes.join('\n')}

Write a concise knowledge base rule to help the AI avoid this mistake in the future.
Return ONLY valid JSON with exactly these two fields:
{
  "title": "short rule title (max 60 chars)",
  "content": "clear rule explanation that will be injected into the AI prompt"
}`

  const response = await client.messages.create({
    model:      ANALYSIS_MODEL,
    max_tokens: 300,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text  = response.content.find(b => b.type === 'text')?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return { title: String(parsed.title), content: String(parsed.content) }
  } catch { return null }
}
