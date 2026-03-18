// GET /api/test/gemini-extract?fileId=<document_files.id>
//
// Test endpoint — uploads PDF to Gemini File API, runs extraction,
// returns raw response. Validates Gemini 2.5 Flash on real documents.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { getGraphToken } from '@/lib/sharepoint'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager } from '@google/generative-ai/server'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export const maxDuration = 120

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

  if (!process.env.GOOGLE_AI_API_KEY) {
    return NextResponse.json({ error: 'GOOGLE_AI_API_KEY not set in Vercel env' }, { status: 500 })
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
    return NextResponse.json({ error: 'File not found or missing sharepoint_item_id' }, { status: 404 })
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
  const pdfBuffer = Buffer.from(pdfBytes)
  const pdfSizeKB = Math.round(pdfBuffer.byteLength / 1024)

  // 3. Upload PDF to Gemini File API (handles large files properly)
  const apiKey      = process.env.GOOGLE_AI_API_KEY
  const fileManager = new GoogleAIFileManager(apiKey)
  const genAI       = new GoogleGenerativeAI(apiKey)

  // Write to /tmp — available in Vercel serverless
  const tmpPath = join(tmpdir(), `gemini-test-${Date.now()}.pdf`)
  writeFileSync(tmpPath, pdfBuffer)

  let uploadedFileUri  = ''
  let uploadedFileName = ''
  let rawText          = ''
  let finishReason     = ''
  let inputTokens      = 0
  let outputTokens     = 0
  let geminiError      = ''
  const startMs        = Date.now()

  try {
    // Upload to File API
    const uploadResult = await fileManager.uploadFile(tmpPath, {
      mimeType:    'application/pdf',
      displayName: file.file_name,
    })
    uploadedFileUri  = uploadResult.file.uri
    uploadedFileName = uploadResult.file.name
    console.log('[Gemini File API] uploaded:', uploadedFileUri)

    // Run extraction using file URI reference (not inline base64)
    const gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await gemini.generateContent({
      contents: [{
        role:  'user',
        parts: [
          { fileData: { mimeType: 'application/pdf', fileUri: uploadedFileUri } },
          { text: 'Extract ALL text and structured data from this document. List every field you can read — dates, numbers, VIN, mileage, names, addresses, repair descriptions, complaints, diagnoses. Be thorough and complete across all pages.' },
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
  } finally {
    // Clean up temp file
    try { unlinkSync(tmpPath) } catch {}
    // Delete from Gemini File API (files auto-expire after 48h but clean up anyway)
    if (uploadedFileName) {
      try { await fileManager.deleteFile(uploadedFileName) } catch {}
    }
  }

  const elapsedMs = Date.now() - startMs

  return NextResponse.json({
    meta: {
      file_name:     file.file_name,
      doc_type:      file.document_type_code,
      pdf_size_kb:   pdfSizeKB,
      model:         'gemini-2.5-flash (File API)',
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
