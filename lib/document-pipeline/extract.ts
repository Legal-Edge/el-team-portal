// ─────────────────────────────────────────────────────────────────────────────
// Document Pipeline — Extraction Stage
//
// Downloads the file from SharePoint and extracts raw text.
// Supported formats:
//   - PDF  → pdf-parse (text layer; no OCR)
//   - DOCX → mammoth (Word documents)
//   - TXT / plain text → decode buffer directly
//
// OCR for scanned PDFs is Phase 3 (Azure Document Intelligence).
//
// The extracted text is stored in document_files.extracted_text.
// Called immediately after ingest so the download_url (pre-auth, short-lived)
// is still valid.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, ExtractionResult, SharePointFile } from './types'

// Lazy imports — these are only loaded when actually needed
// (avoids loading binary parsers on cold starts that don't extract)
async function getPdfParse() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pdf-parse')
  return mod.default ?? mod
}

async function getMammoth() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('mammoth')
  return mod
}

const EXTRACTABLE_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword',                                                        // .doc (fallback)
  'text/plain',
  'text/csv',
])

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB — skip extraction for huge files

/**
 * Extract raw text from a SharePoint file.
 * Returns null if the file type is unsupported, too large, or extraction fails.
 */
export async function extractDocument(
  file: SharePointFile,
  _classification: ClassificationResult,
): Promise<ExtractionResult | null> {
  // Skip unsupported types
  const mime = file.mime_type ?? ''
  const ext  = (file.file_extension ?? '').toLowerCase()

  const isPdf   = mime === 'application/pdf'  || ext === 'pdf'
  const isDocx  = mime.includes('wordprocessingml') || ext === 'docx'
  const isText  = mime.startsWith('text/') || ext === 'txt' || ext === 'csv'

  if (!isPdf && !isDocx && !isText && !EXTRACTABLE_MIME_TYPES.has(mime)) {
    return null
  }

  // Skip files too large
  if (file.size_bytes && file.size_bytes > MAX_FILE_SIZE) {
    console.warn(`[extract] skipping ${file.name} — too large (${file.size_bytes} bytes)`)
    return null
  }

  // Resolve download URL — prefer pre-auth annotation, fall back to Graph content endpoint
  // (app-only credentials sometimes don't get @microsoft.graph.downloadUrl annotation)
  let downloadUrl = file.download_url
  if (!downloadUrl) {
    if (file.sharepoint_drive_id && file.sharepoint_item_id) {
      // Graph content endpoint returns 302 → actual download URL
      // We fetch with redirect:follow so the buffer lands directly
      downloadUrl = `https://graph.microsoft.com/v1.0/drives/${file.sharepoint_drive_id}/items/${file.sharepoint_item_id}/content`
    } else {
      console.warn(`[extract] skipping ${file.name} — no download_url and no drive/item IDs`)
      return null
    }
  }

  // Download file bytes
  let buffer: Buffer
  try {
    // For Graph content endpoint we need the bearer token
    const headers: Record<string, string> = {}
    if (downloadUrl.startsWith('https://graph.microsoft.com')) {
      const { getGraphToken } = await import('@/lib/sharepoint')
      headers['Authorization'] = `Bearer ${await getGraphToken()}`
    }
    const res = await fetch(downloadUrl, { headers })
    if (!res.ok) {
      console.error(`[extract] download failed for ${file.name}: ${res.status}`)
      return null
    }
    buffer = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error(`[extract] download error for ${file.name}:`, err)
    return null
  }

  // Parse
  let rawText = ''
  let method: ExtractionResult['method'] = 'text'

  try {
    if (isPdf) {
      const pdfParse = await getPdfParse()
      const parsed   = await pdfParse(buffer)
      rawText = parsed.text ?? ''
    } else if (isDocx) {
      const mammoth = await getMammoth()
      const result  = await mammoth.extractRawText({ buffer })
      rawText = result.value ?? ''
    } else if (isText) {
      rawText = buffer.toString('utf-8')
    }
  } catch (err) {
    console.error(`[extract] parse error for ${file.name}:`, err)
    return null
  }

  // Normalise whitespace
  rawText = rawText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  if (!rawText) {
    // Parsed but empty — likely a scanned PDF (no text layer); OCR needed (Phase 3)
    console.warn(`[extract] ${file.name} parsed but empty — likely scanned (needs OCR)`)
    return null
  }

  return {
    fields:     { raw_text: rawText },
    confidence: 1.0,
    method,
  }
}
