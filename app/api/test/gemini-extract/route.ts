// GET /api/test/gemini-extract?fileId=<document_files.id>
//
// Test endpoint — runs Gemini 2.5 Flash on a real SharePoint PDF
// and returns the raw response with zero post-processing.
// Use this to validate Gemini output before wiring into the main pipeline.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'
import { GoogleGenerativeAI } from '@google/generative-ai'

const DRIVE_ID = 'b!oTYerw9tj0KLIWLLGc_DzIZijDFxI1xNtMSGXezIVsUHL02cd1kmRra7r_dMei8k'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fileId = req.nextUrl.searchParams.get('fileId')
  if (!fileId) {
    return NextResponse.json({
      error: 'Pass ?fileId=<uuid> — find a document UUID from the Documents tab URL',
    }, { status: 400 })
  }

  // 1. Fetch file metadata from Supabase
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const { data: file } = await db
    .from('document_files')
    .select('id, file_name, sharepoint_item_id, sharepoint_drive_id, document_type_code')
    .eq('id', fileId)
    .single()

  if (!file?.sharepoint_item_id) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // 2. Fetch PDF bytes from SharePoint
  const driveId = file.sharepoint_drive_id ?? DRIVE_ID
  const token   = await getGraphToken()
  const pdfRes  = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${file.sharepoint_item_id}/content`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' }
  )
  if (!pdfRes.ok) {
    return NextResponse.json({ error: `SharePoint fetch failed: ${pdfRes.status}` }, { status: 502 })
  }
  const pdfBytes  = await pdfRes.arrayBuffer()
  const base64Pdf = Buffer.from(pdfBytes).toString('base64')
  const pdfSizeKB = Math.round(pdfBytes.byteLength / 1024)

  // 3. Run Gemini 2.5 Flash — raw, no schema, no post-processing
  if (!process.env.GOOGLE_AI_API_KEY) {
    return NextResponse.json({ error: 'GOOGLE_AI_API_KEY not set in Vercel env' }, { status: 500 })
  }

  const genAI  = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
  const gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

  const startMs = Date.now()

  let rawText      = ''
  let finishReason = ''
  let inputTokens  = 0
  let outputTokens = 0
  let geminiError  = ''

  try {
    const result = await gemini.generateContent({
      contents: [{
        role:  'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
          { text: 'Extract ALL text and structured data from this document. List every field you can read — dates, numbers, VIN, mileage, names, addresses, repair descriptions. Be thorough and complete.' },
        ],
      }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0 },
    })

    rawText      = result.response.text()
    finishReason = result.response.candidates?.[0]?.finishReason ?? 'unknown'
    inputTokens  = result.response.usageMetadata?.promptTokenCount ?? 0
    outputTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0
  } catch (e: unknown) {
    geminiError = e instanceof Error ? e.message : String(e)
  }

  const elapsedMs = Date.now() - startMs

  return NextResponse.json({
    meta: {
      file_name:     file.file_name,
      doc_type:      file.document_type_code,
      pdf_size_kb:   pdfSizeKB,
      model:         'gemini-2.5-flash',
      elapsed_ms:    elapsedMs,
      finish_reason: finishReason,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      raw_length:    rawText.length,
    },
    raw_response: rawText,
    error:        geminiError || null,
  })
}
