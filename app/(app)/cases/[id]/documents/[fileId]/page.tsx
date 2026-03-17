'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { use } from 'react'

interface FileItem {
  id: string
  file_name: string
  document_type_code: string | null
  type_label: string | null
  ai_extraction: Record<string, unknown> | null
  ai_extracted_at: string | null
  web_url: string | null
  is_classified: boolean
}

const SKIP_FIELDS = new Set(['doc_type','key_facts','key_dates'])
const TEXTAREA_FIELDS = new Set(['complaint','diagnosis','work_performed'])
const SELECT_FIELDS: Record<string, string[]> = {
  repair_status: ['completed','unable_to_duplicate','parts_on_order','customer_declined','other'],
}

export default function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string; fileId: string }>
}) {
  const { id: caseId, fileId } = use(params)
  const router = useRouter()

  const [files,      setFiles]      = useState<FileItem[]>([])
  const [caseName,   setCaseName]   = useState<string>('')
  const [blobUrl,    setBlobUrl]    = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(true)
  const [pdfErr,     setPdfErr]     = useState(false)

  // Extraction state
  const [extraction, setExtraction] = useState<Record<string, unknown> | null>(null)
  const [original,   setOriginal]   = useState<Record<string, unknown> | null>(null)
  const [edits,      setEdits]      = useState<Record<string, unknown>>({})
  const [extracting, setExtracting] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [kbAdded,    setKbAdded]    = useState<string | null>(null)

  const currentFile = files.find(f => f.id === fileId)

  // Load all case files for sidebar
  useEffect(() => {
    fetch(`/api/cases/${caseId}/documents`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.files) setFiles(d.files)
        if (d?.caseName) setCaseName(d.caseName)
      })
  }, [caseId])

  // Load PDF
  useEffect(() => {
    if (!fileId) return
    setPdfLoading(true); setPdfErr(false)
    let objectUrl: string
    fetch(`/api/documents/${fileId}/view`, { credentials: 'include' })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl) })
      .catch(() => setPdfErr(true))
      .finally(() => setPdfLoading(false))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fileId])

  // Load cached extraction
  useEffect(() => {
    if (!fileId) return
    setExtraction(null); setOriginal(null); setEdits({})
    fetch(`/api/documents/${fileId}/analyze`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cached_only: true }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.extraction) { setExtraction(d.extraction); setOriginal(d.extraction) } })
  }, [fileId])

  async function runExtraction(force = false) {
    setExtracting(true); setEdits({})
    fetch(`/api/documents/${fileId}/analyze`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setExtraction(d.extraction); setOriginal(d.extraction) })
      .finally(() => setExtracting(false))
  }

  async function saveCorrections() {
    if (!extraction) return
    setSaving(true); setSaved(false); setKbAdded(null)
    const corrected = { ...extraction, ...edits }
    const res = await fetch(`/api/documents/${fileId}/extraction`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrected, original }),
    })
    const result = await res.json()
    if (res.ok) {
      setExtraction(corrected); setOriginal(corrected); setEdits({})
      setSaved(true); if (result.kb_rule_added) setKbAdded(result.kb_rule_added)
      setTimeout(() => setSaved(false), 3000)
      // Refresh sidebar
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ai_extraction: corrected } : f))
    }
    setSaving(false)
  }

  const merged   = extraction ? { ...extraction, ...edits } : null
  const hasEdits = Object.keys(edits).length > 0
  const entries  = merged ? Object.entries(merged).filter(([k, v]) =>
    !SKIP_FIELDS.has(k) && v !== null && v !== undefined && v !== '' && !Array.isArray(v)
  ) : []

  const statusColors: Record<string, string> = {
    completed: 'bg-green-50 text-green-700 border-green-100',
    unable_to_duplicate: 'bg-red-50 text-red-700 border-red-100',
    parts_on_order: 'bg-amber-50 text-amber-700 border-amber-100',
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">

      {/* ── Left sidebar: file list ────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-gray-100 flex flex-col">
        {/* Back + case name */}
        <div className="px-4 py-3 border-b border-gray-100">
          <Link href={`/cases/${caseId}?tab=documents`}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors mb-2">
            ← Back to Case
          </Link>
          <p className="text-sm font-semibold text-gray-800 truncate">{caseName || 'Documents'}</p>
          <p className="text-xs text-gray-400 mt-0.5">{files.length} document{files.length !== 1 ? 's' : ''}</p>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto py-2">
          {files.map(f => {
            const isActive = f.id === fileId
            const isPdf    = f.file_name.toLowerCase().endsWith('.pdf')
            const hasExt   = !!f.ai_extraction
            return (
              <Link
                key={f.id}
                href={`/cases/${caseId}/documents/${f.id}`}
                className={`flex items-start gap-3 px-4 py-3 border-l-2 transition-colors ${
                  isActive
                    ? 'border-lemon-400 bg-lemon-400/5'
                    : 'border-transparent hover:bg-gray-50'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  <span className={`w-2 h-2 rounded-full block ${hasExt ? 'bg-green-400' : 'bg-gray-200'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-medium truncate ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
                    {f.file_name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {f.type_label && (
                      <span className="text-xs text-gray-400">{f.type_label}</span>
                    )}
                    {!isPdf && <span className="text-xs text-gray-300">non-PDF</span>}
                    {/* RO key facts */}
                    {f.document_type_code === 'repair_order' && f.ai_extraction && (() => {
                      const ex = f.ai_extraction
                      const status = ex.repair_status as string | null
                      return status ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded border text-xs ${statusColors[status] ?? 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                          {status.replace(/_/g, ' ')}
                        </span>
                      ) : null
                    })()}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Main: PDF + extraction ────────────────────────────────────────── */}
      <div className="flex flex-1 min-w-0">

        {/* PDF */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-100">
          {/* PDF header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white shrink-0">
            <p className="text-sm font-medium text-gray-800 truncate max-w-md">
              {currentFile?.file_name ?? 'Document'}
            </p>
            {currentFile?.web_url && (
              <a href={currentFile.web_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline shrink-0 ml-3">
                Open in SharePoint ↗
              </a>
            )}
          </div>

          {/* PDF body */}
          {pdfErr ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
              <p className="text-sm">Could not load PDF</p>
              {currentFile?.web_url && (
                <a href={currentFile.web_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-500 hover:underline">Open in SharePoint ↗</a>
              )}
            </div>
          ) : !blobUrl || pdfLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <div className="w-8 h-8 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin" />
                <p className="text-sm">Loading PDF…</p>
              </div>
            </div>
          ) : (
            <iframe src={blobUrl} className="flex-1 border-0" title={currentFile?.file_name ?? 'Document'} />
          )}
        </div>

        {/* Extraction panel */}
        <div className="w-80 shrink-0 flex flex-col bg-gray-50/30">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white shrink-0">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extraction</p>
              <p className="text-xs text-gray-300 mt-0.5">Claude Haiku</p>
            </div>
            {extraction && (
              <button onClick={() => runExtraction(true)} disabled={extracting}
                className="text-xs text-gray-400 hover:text-gray-600 border border-gray-100 hover:border-gray-200 px-2 py-1 rounded transition-colors disabled:opacity-40">
                {extracting ? '…' : '↻ Re-run'}
              </button>
            )}
          </div>

          {/* Not extracted */}
          {!extraction && !extracting && (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 px-6 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-lg">✦</div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Not yet extracted</p>
                <p className="text-xs text-gray-400">Extract structured fields from this document</p>
              </div>
              <button onClick={() => runExtraction(false)}
                className="text-sm px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 active:scale-95 transition-all">
                Extract with Haiku
              </button>
            </div>
          )}

          {/* Extracting spinner */}
          {extracting && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
              <div className="w-7 h-7 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin" />
              <p className="text-xs">Extracting…</p>
            </div>
          )}

          {/* Fields */}
          {extraction && !extracting && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {entries.map(([key, val]) => {
                const isEdited  = key in edits
                const fieldVal  = String(val ?? '')
                const isBoolean = typeof (extraction?.[key]) === 'boolean'
                const isSelect  = key in SELECT_FIELDS
                const isTA      = TEXTAREA_FIELDS.has(key)

                return (
                  <div key={key} className={`rounded-lg border px-3 py-2 transition-colors ${isEdited ? 'border-amber-300 bg-amber-50' : 'border-gray-100 bg-white'}`}>
                    <p className="text-xs text-gray-400 capitalize mb-1">
                      {key.replace(/_/g, ' ')}
                      {isEdited && <span className="ml-1.5 text-amber-500">edited</span>}
                    </p>
                    {isBoolean ? (
                      <select value={fieldVal}
                        onChange={e => setEdits(p => ({ ...p, [key]: e.target.value === 'true' }))}
                        className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none">
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : isSelect ? (
                      <select value={fieldVal}
                        onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
                        className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none capitalize">
                        {SELECT_FIELDS[key].map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                      </select>
                    ) : isTA ? (
                      <textarea value={fieldVal}
                        onChange={e => {
                          setEdits(p => ({ ...p, [key]: e.target.value }))
                          e.target.style.height = 'auto'
                          e.target.style.height = e.target.scrollHeight + 'px'
                        }}
                        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                        className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none resize-none overflow-hidden leading-relaxed" />
                    ) : (
                      <input type="text" value={fieldVal}
                        onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
                        className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none" />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Save bar */}
          {extraction && !extracting && (
            <div className="px-5 py-4 border-t border-gray-100 bg-white shrink-0 space-y-2">
              {kbAdded && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  ✓ KB updated: &quot;{kbAdded}&quot;
                </div>
              )}
              {saved && !kbAdded && <p className="text-xs text-green-600">✓ Corrections saved</p>}
              {hasEdits && (
                <button onClick={saveCorrections} disabled={saving}
                  className="w-full text-sm py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-400 disabled:opacity-40 active:scale-95 transition-all font-medium">
                  {saving ? 'Saving + Learning…' : 'Save Corrections'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
