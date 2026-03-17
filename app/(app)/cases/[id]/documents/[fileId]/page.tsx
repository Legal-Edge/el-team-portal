'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter }                   from 'next/navigation'
import Link                            from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────
interface FileItem {
  id: string; file_name: string; document_type_code: string | null
  type_label: string | null; is_classified: boolean
  ai_extraction: Record<string, unknown> | null; ai_extracted_at: string | null
  file_extension: string | null; size_bytes: number | null; web_url: string | null
  created_at_source: string | null; created_by_name: string | null
  modified_at_source: string | null
}

const SKIP_FIELDS = new Set(['doc_type','key_facts','key_dates'])
const TEXTAREA_FIELDS = new Set(['complaint','diagnosis','work_performed'])
const SELECT_FIELDS: Record<string, string[]> = {
  repair_status: ['completed','unable_to_duplicate','parts_on_order','customer_declined','other'],
}

// ── Sidebar file list ─────────────────────────────────────────────────────
function FileListItem({ file, active, onClick }: { file: FileItem; active: boolean; onClick: () => void }) {
  const isPdf = file.file_extension?.toLowerCase() === 'pdf' || file.file_name.toLowerCase().endsWith('.pdf')
  const hasExtraction = !!file.ai_extraction

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
        active ? 'bg-lemon-400/10 border-l-2 border-l-lemon-400' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-lg shrink-0 mt-0.5">{isPdf ? '📄' : '📎'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-800 leading-snug truncate">{file.file_name}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {file.type_label && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{file.type_label}</span>
            )}
            {isPdf && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${hasExtraction ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'}`}>
                {hasExtraction ? '✓ Extracted' : 'Not extracted'}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// ── Extraction panel (editable) ───────────────────────────────────────────
function ExtractionPanel({ file, onUpdated }: { file: FileItem; onUpdated: (updated: FileItem) => void }) {
  const [data,    setData]    = useState<Record<string, unknown> | null>(file.ai_extraction)
  const [original,setOriginal]= useState<Record<string, unknown> | null>(file.ai_extraction)
  const [edits,   setEdits]   = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [kbAdded, setKbAdded] = useState<string | null>(null)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    setData(file.ai_extraction); setOriginal(file.ai_extraction); setEdits({})
  }, [file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runExtraction(force = false) {
    setLoading(true); setError(false); setEdits({})
    const res  = await fetch(`/api/documents/${file.id}/analyze`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
    if (res.ok) {
      const d = await res.json()
      setData(d.extraction); setOriginal(d.extraction)
      onUpdated({ ...file, ai_extraction: d.extraction, ai_extracted_at: new Date().toISOString() })
    } else { setError(true) }
    setLoading(false)
  }

  async function saveCorrections() {
    if (!data) return
    setSaving(true); setSaved(false); setKbAdded(null)
    const corrected = { ...data, ...edits }
    const res = await fetch(`/api/documents/${file.id}/extraction`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrected, original }),
    })
    const result = await res.json()
    if (res.ok) {
      setData(corrected); setOriginal(corrected); setEdits({})
      setSaved(true)
      if (result.kb_rule_added) setKbAdded(result.kb_rule_added)
      onUpdated({ ...file, ai_extraction: corrected })
      setTimeout(() => setSaved(false), 4000)
    }
    setSaving(false)
  }

  const merged   = data ? { ...data, ...edits } : null
  const hasEdits = Object.keys(edits).length > 0
  const entries  = merged ? Object.entries(merged).filter(([k, v]) =>
    !SKIP_FIELDS.has(k) && v !== null && v !== undefined && v !== '' && !Array.isArray(v)
  ) : []

  // Not extracted
  if (!data && !loading) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-2xl">✦</div>
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-1">Not yet extracted</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Run Haiku to extract structured data — dates, mileage, complaint, repair status
        </p>
      </div>
      <button onClick={() => runExtraction(false)}
        className="text-sm px-6 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-700 active:scale-95 transition-all">
        Extract with Haiku
      </button>
      {error && <p className="text-xs text-red-500">Extraction failed. Try again.</p>}
    </div>
  )

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin" />
      <p className="text-xs text-center">Extracting with Haiku…<br /><span className="text-gray-300">~5 seconds</span></p>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0 border-b border-gray-100">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extraction</p>
          <p className="text-xs text-gray-300 mt-0.5">Claude Haiku · click any field to edit</p>
        </div>
        <button onClick={() => runExtraction(true)}
          className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-2.5 py-1 rounded-lg transition-colors">
          ↻ Re-run
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
        {entries.map(([key, val]) => {
          const isEdited  = key in edits
          const fieldVal  = String(val ?? '')
          const isBoolean = typeof (data?.[key]) === 'boolean'
          const isSelect  = key in SELECT_FIELDS
          const isTA      = TEXTAREA_FIELDS.has(key)

          return (
            <div key={key}
              className={`rounded-xl border px-3 py-2.5 transition-colors ${
                isEdited ? 'border-amber-300 bg-amber-50' : 'border-gray-100 bg-gray-50/50'
              }`}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-400 capitalize">{key.replace(/_/g, ' ')}</p>
                {isEdited && <span className="text-xs text-amber-500 font-medium">edited</span>}
              </div>
              {isBoolean ? (
                <select value={fieldVal}
                  onChange={e => setEdits(p => ({ ...p, [key]: e.target.value === 'true' }))}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none">
                  <option value="true">Yes</option><option value="false">No</option>
                </select>
              ) : isSelect ? (
                <select value={fieldVal}
                  onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none capitalize">
                  {SELECT_FIELDS[key].map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                </select>
              ) : isTA ? (
                <textarea value={fieldVal}
                  onChange={e => { setEdits(p => ({ ...p, [key]: e.target.value })); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px' }}
                  ref={el => { if (el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px' } }}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none resize-none leading-relaxed overflow-hidden" />
              ) : (
                <input type="text" value={fieldVal}
                  onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none" />
              )}
            </div>
          )
        })}
      </div>

      {/* Save bar */}
      <div className="px-5 py-4 shrink-0 border-t border-gray-100 space-y-2">
        {kbAdded && (
          <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
            ✓ Knowledge base updated: &quot;{kbAdded}&quot;
          </div>
        )}
        {saved && !kbAdded && <p className="text-xs text-green-600">✓ Corrections saved</p>}
        {hasEdits ? (
          <button onClick={saveCorrections} disabled={saving}
            className="w-full text-sm py-2.5 bg-amber-500 text-white rounded-xl hover:bg-amber-400 disabled:opacity-40 active:scale-95 transition-all font-medium">
            {saving ? 'Saving + Learning…' : 'Save Corrections'}
          </button>
        ) : (
          <p className="text-xs text-gray-300 text-center">Edit any field above to save corrections</p>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string; fileId: string }>
}) {
  const router = useRouter()
  const [caseId,   setCaseId]   = useState<string | null>(null)
  const [fileId,   setFileId]   = useState<string | null>(null)
  const [files,    setFiles]    = useState<FileItem[]>([])
  const [active,   setActive]   = useState<FileItem | null>(null)
  const [blobUrl,  setBlobUrl]  = useState<string | null>(null)
  const [pdfErr,   setPdfErr]   = useState(false)
  const [loading,  setLoading]  = useState(true)
  const prevBlobRef = useRef<string | null>(null)

  useEffect(() => {
    params.then(p => { setCaseId(p.id); setFileId(p.fileId) })
  }, [params])

  // Load all case files
  useEffect(() => {
    if (!caseId) return
    fetch(`/api/cases/${caseId}/documents`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setFiles(d.files ?? []); setLoading(false) })
  }, [caseId])

  // Set active file once files loaded
  useEffect(() => {
    if (!fileId || files.length === 0) return
    const f = files.find(f => f.id === fileId) ?? files[0]
    setActive(f)
  }, [fileId, files])

  // Load PDF blob when active changes
  useEffect(() => {
    if (!active) return
    const isPdf = active.file_extension?.toLowerCase() === 'pdf' || active.file_name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { setBlobUrl(null); return }

    setBlobUrl(null); setPdfErr(false)
    if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current)

    fetch(`/api/documents/${active.id}/view`, { credentials: 'include' })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => { const url = URL.createObjectURL(blob); prevBlobRef.current = url; setBlobUrl(url) })
      .catch(() => setPdfErr(true))
  }, [active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleFileSelect(f: FileItem) {
    setActive(f)
    router.replace(`/cases/${caseId}/documents/${f.id}` as never)
  }

  const isPdf   = active ? (active.file_extension?.toLowerCase() === 'pdf' || active.file_name.toLowerCase().endsWith('.pdf')) : false
  const pdfFiles = files.filter(f => f.file_extension?.toLowerCase() === 'pdf' || f.file_name.toLowerCase().endsWith('.pdf'))

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin mr-3" />
      Loading documents…
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Left sidebar: file list ─────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Back nav */}
        <div className="px-4 py-3 border-b border-gray-100 shrink-0">
          <Link href={`/cases/${caseId}` as never}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors">
            ← Back to Case
          </Link>
          <p className="text-xs font-semibold text-gray-700 mt-2">{files.length} Documents</p>
          <p className="text-xs text-gray-400">{pdfFiles.filter(f => f.ai_extraction).length}/{pdfFiles.length} PDFs extracted</p>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {files.map(f => (
            <FileListItem
              key={f.id}
              file={f}
              active={active?.id === f.id}
              onClick={() => handleFileSelect(f)}
            />
          ))}
        </div>
      </div>

      {/* ── Main: PDF + extraction ──────────────────────────────────── */}
      <div className="flex-1 flex min-w-0">

        {/* PDF viewer */}
        <div className="flex-1 bg-gray-100 flex flex-col min-w-0">
          {!active ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p className="text-sm">Select a document from the left</p>
            </div>
          ) : !isPdf ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400">
              <p className="text-sm font-medium text-gray-600">{active.file_name}</p>
              <p className="text-xs">This file type can&apos;t be previewed in-browser</p>
              {active.web_url && (
                <a href={active.web_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-500 hover:underline">Open in SharePoint ↗</a>
              )}
            </div>
          ) : pdfErr ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
              <p className="text-sm">Could not load PDF</p>
              {active.web_url && (
                <a href={active.web_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-500 hover:underline">Open in SharePoint ↗</a>
              )}
            </div>
          ) : !blobUrl ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin mr-3" />
              <p className="text-sm">Loading PDF…</p>
            </div>
          ) : (
            <iframe src={blobUrl} className="w-full h-full border-0" title={active.file_name} />
          )}
        </div>

        {/* Extraction panel */}
        <div className="w-80 shrink-0 bg-white border-l border-gray-200">
          {active && isPdf ? (
            <ExtractionPanel
              key={active.id}
              file={active}
              onUpdated={updated => {
                setActive(updated)
                setFiles(prev => prev.map(f => f.id === updated.id ? updated : f))
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-300 text-xs px-6 text-center">
              Extraction only available for PDF documents
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
