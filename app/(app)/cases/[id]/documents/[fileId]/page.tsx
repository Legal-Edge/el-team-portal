'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams }  from 'next/navigation'
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

interface CaseInfo {
  client_first_name:  string | null
  client_last_name:   string | null
  case_number:        string | null
  hubspot_deal_id:    string | null
  vehicle_year:       number | null
  vehicle_make:       string | null
  vehicle_model:      string | null
  state_jurisdiction: string | null
}

// ── Doc group sort order ──────────────────────────────────────────────────
const GROUP_CODES: Record<string, number> = {
  repair_order: 0,
  purchase_agreement: 1, lease_agreement: 1, lease_order: 1,
  vehicle_registration: 2,
}
function sortedFiles(files: FileItem[]): FileItem[] {
  return [...files].sort((a, b) => {
    const aOrder = GROUP_CODES[a.document_type_code ?? ''] ?? 3
    const bOrder = GROUP_CODES[b.document_type_code ?? ''] ?? 3
    if (aOrder !== bOrder) return aOrder - bOrder
    // within same group sort by repair date or upload date
    const aDate = (a.ai_extraction?.repair_date_in as string) ?? a.created_at_source ?? ''
    const bDate = (b.ai_extraction?.repair_date_in as string) ?? b.created_at_source ?? ''
    return aDate.localeCompare(bDate)
  })
}

// ── Extraction field config ───────────────────────────────────────────────
const SKIP_FIELDS    = new Set(['doc_type', 'raw', 'vin_needs_review', '_validation'])
const TEXTAREA_FIELDS= new Set(['complaint','diagnosis','work_performed','document_description'])
const ARRAY_FIELDS   = new Set(['key_facts','key_dates','vehicle_info'])
const SELECT_FIELDS: Record<string, string[]> = {
  repair_status: ['completed','unable_to_duplicate','parts_on_order','customer_declined','other'],
}
const FIELD_LABEL: Record<string, string> = {
  repair_date_in: 'Date In', repair_date_out: 'Date Out', days_in_shop: 'Days in Shop',
  complaint: 'Complaint', diagnosis: 'Diagnosis', work_performed: 'Work Performed',
  repair_status: 'Repair Status', mileage_in: 'Mileage In', mileage_out: 'Mileage Out',
  warranty_repair: 'Warranty', ro_number: 'RO Number', dealer_name: 'Dealer / Shop',
  technician_name: 'Technician', key_facts: 'Key Facts', key_dates: 'Key Dates',
  document_description: 'Description', vin: 'VIN', vehicle_info: 'Vehicle Info',
}

// ── Sidebar file list item ────────────────────────────────────────────────
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
        <span className="text-base shrink-0 mt-0.5">{isPdf ? '📄' : '📎'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-800 leading-snug line-clamp-2 text-left">{file.file_name}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {file.type_label && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full leading-none">{file.type_label}</span>
            )}
            {isPdf && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full leading-none ${
                hasExtraction ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'
              }`}>
                {hasExtraction ? '✓ Extracted' : 'Not extracted'}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// ── Extraction panel ──────────────────────────────────────────────────────
function ExtractionPanel({ file, onUpdated }: { file: FileItem; onUpdated: (u: FileItem) => void }) {
  const [data,     setData]     = useState<Record<string, unknown> | null>(file.ai_extraction)
  const [original, setOriginal] = useState<Record<string, unknown> | null>(file.ai_extraction)
  const [edits,    setEdits]    = useState<Record<string, unknown>>({})
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [kbAdded,  setKbAdded]  = useState<string | null>(null)
  const [error,    setError]    = useState(false)

  useEffect(() => {
    setData(file.ai_extraction); setOriginal(file.ai_extraction); setEdits({})
  }, [file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runExtraction(force = false) {
    setLoading(true); setError(false); setEdits({})
    const res = await fetch(`/api/documents/${file.id}/analyze`, {
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
      setTimeout(() => { setSaved(false); setKbAdded(null) }, 5000)
    }
    setSaving(false)
  }

  // Detect raw/unparsed fallback
  const isRaw = data && 'raw' in data && Object.keys(data).length === 1

  const merged   = data ? { ...data, ...edits } : null
  const hasEdits = Object.keys(edits).length > 0

  // Build ordered field entries: structured fields first, then key_facts/key_dates
  const structuredEntries = merged
    ? Object.entries(merged).filter(([k, v]) =>
        !SKIP_FIELDS.has(k) && !ARRAY_FIELDS.has(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object'
      )
    : []
  const arrayEntries = merged
    ? Object.entries(merged).filter(([k, v]) =>
        ARRAY_FIELDS.has(k) && Array.isArray(v) && (v as unknown[]).length > 0
      )
    : []

  if (!data && !loading) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-2xl">✦</div>
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-1">Not yet extracted</p>
        <p className="text-xs text-gray-400 leading-relaxed">Run Gemini to extract structured data</p>
      </div>
      <button onClick={() => runExtraction(false)}
        className="text-sm px-6 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-700 active:scale-95 transition-all">
        Extract with Gemini
      </button>
      {error && <p className="text-xs text-red-500">Extraction failed. Try again.</p>}
    </div>
  )

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin" />
      <p className="text-xs text-center">Extracting with Gemini…<br /><span className="text-gray-300">~5 seconds</span></p>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between shrink-0 border-b border-gray-100">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extraction</p>
          <p className="text-xs text-gray-300 mt-0.5">Gemini 2.5 Flash · click any field to edit</p>
        </div>
        <button onClick={() => runExtraction(true)}
          className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-2.5 py-1 rounded-lg transition-colors">
          ↻ Re-run
        </button>
      </div>

      {/* Raw fallback — offer to re-run */}
      {isRaw && (
        <div className="mx-4 mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs font-medium text-amber-700 mb-1">Extraction needs re-run</p>
          <p className="text-xs text-amber-600 mb-3 leading-relaxed">
            The previous extraction returned unparsed output. Click Re-run to extract properly with current rules.
          </p>
          <button onClick={() => runExtraction(true)}
            className="text-xs px-4 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-400 active:scale-95 transition-all">
            ↻ Re-run Extraction
          </button>
        </div>
      )}

      {/* VIN needs review warning */}
      {!isRaw && Boolean(merged?.vin_needs_review) && (
        <div className="mx-4 mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-700 mb-1">⚠ VIN could not be read reliably</p>
          <p className="text-xs text-red-600 leading-relaxed">
            The extracted VIN failed validation. Please correct it manually below, or use the VIN from the vehicle registration.
          </p>
        </div>
      )}

      {/* Fields */}
      {!isRaw && (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">

          {/* Structured scalar fields */}
          {structuredEntries.map(([key, val]) => {
            const isEdited  = key in edits
            const fieldVal  = String(val ?? '')
            const isBoolean = typeof (data?.[key]) === 'boolean'
            const isSelect  = key in SELECT_FIELDS
            const isTA      = TEXTAREA_FIELDS.has(key)
            const label     = FIELD_LABEL[key] ?? key.replace(/_/g, ' ')

            return (
              <div key={key}
                className={`rounded-xl border px-3 py-2.5 transition-colors ${
                  isEdited ? 'border-amber-300 bg-amber-50' : 'border-gray-100 bg-gray-50/50'
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400 capitalize">{label}</p>
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

          {/* Array fields: key_facts, key_dates, vin, vehicle_info */}
          {arrayEntries.map(([key, val]) => {
            const items = val as string[]
            const label = FIELD_LABEL[key] ?? key.replace(/_/g, ' ')
            return (
              <div key={key} className="rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-2.5">
                <p className="text-xs text-gray-400 capitalize mb-2">{label}</p>
                <ul className="space-y-1">
                  {items.map((item, i) => (
                    <li key={i} className="text-xs text-gray-700 leading-relaxed flex gap-2">
                      <span className="text-gray-300 shrink-0">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {/* Save bar */}
      {!isRaw && (
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
      )}
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
  const [caseId,    setCaseId]    = useState<string | null>(null)
  const [fileId,    setFileId]    = useState<string | null>(null)
  const searchParams  = useSearchParams()
  const startInExtraction = searchParams.get('view') === 'extraction'

  const [files,     setFiles]     = useState<FileItem[]>([])
  const [caseInfo,  setCaseInfo]  = useState<CaseInfo | null>(null)
  const [active,      setActive]      = useState<FileItem | null>(null)
  const [blobUrl,     setBlobUrl]     = useState<string | null>(null)
  const [pdfErr,      setPdfErr]      = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [mobileView,  setMobileView]  = useState<'list' | 'extraction'>(startInExtraction ? 'extraction' : 'list')
  const prevBlobRef = useRef<string | null>(null)

  useEffect(() => {
    params.then(p => { setCaseId(p.id); setFileId(p.fileId) })
  }, [params])

  // Load case info + files in parallel
  useEffect(() => {
    if (!caseId) return
    Promise.all([
      fetch(`/api/cases/${caseId}/documents`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/cases/${caseId}`,           { credentials: 'include' }).then(r => r.json()),
    ]).then(([docsData, caseData]) => {
      setFiles(docsData.files ?? [])
      const c = caseData.case ?? caseData  // API wraps under 'case'
      setCaseInfo({
        client_first_name:  c.client_first_name  ?? null,
        client_last_name:   c.client_last_name   ?? null,
        case_number:        c.case_number         ?? null,
        hubspot_deal_id:    c.hubspot_deal_id     ?? null,
        vehicle_year:       c.vehicle_year        ?? null,
        vehicle_make:       c.vehicle_make        ?? null,
        vehicle_model:      c.vehicle_model       ?? null,
        state_jurisdiction: c.state_jurisdiction  ?? null,
      })
      setLoading(false)
    })
  }, [caseId])

  // Set active file
  useEffect(() => {
    if (!fileId || files.length === 0) return
    const f = files.find(f => f.id === fileId) ?? files[0]
    setActive(f)
  }, [fileId, files])

  // Load PDF blob
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
    setMobileView('extraction')
    router.replace(`/cases/${caseId}/documents/${f.id}` as never)
  }

  const isPdf    = active ? (active.file_extension?.toLowerCase() === 'pdf' || active.file_name.toLowerCase().endsWith('.pdf')) : false
  const pdfFiles = files.filter(f => f.file_extension?.toLowerCase() === 'pdf' || f.file_name.toLowerCase().endsWith('.pdf'))
  const sorted   = sortedFiles(files)
  const clientName = caseInfo
    ? `${caseInfo.client_first_name ?? ''} ${caseInfo.client_last_name ?? ''}`.trim()
    : null
  const vehicleStr = caseInfo
    ? [caseInfo.vehicle_year, caseInfo.vehicle_make, caseInfo.vehicle_model].filter(Boolean).join(' ')
    : null

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin mr-3" />
      Loading documents…
    </div>
  )

  // Compact header info line
  const headerMeta = [clientName, caseInfo?.state_jurisdiction, vehicleStr, caseInfo?.case_number ? `#${caseInfo.case_number}` : null]
    .filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Top header bar ─────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 md:px-6 py-2.5 md:py-3 flex items-center gap-3">

        {/* Mobile: back button changes based on view */}
        {mobileView === 'extraction' ? (
          <button
            onClick={() => setMobileView('list')}
            className="md:hidden flex items-center gap-1 text-sm font-semibold text-gray-600 active:text-gray-900 shrink-0"
          >
            ← Documents
          </button>
        ) : (
          <Link
            href={`/cases/${caseId}` as never}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors shrink-0 group"
          >
            <span className="group-hover:-translate-x-0.5 transition-transform inline-block">←</span>
            <span className="hidden md:inline">Back to Case</span>
            <span className="md:hidden">Case</span>
          </Link>
        )}

        <div className="w-px h-4 bg-gray-200 shrink-0" />

        {/* Single-line meta on mobile, wrapped on desktop */}
        <p className="text-xs text-gray-500 truncate flex-1 min-w-0">{headerMeta}</p>

        <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
          {files.length} docs · {pdfFiles.filter(f => f.ai_extraction).length}/{pdfFiles.length} extracted
        </span>

        {/* Mobile: show active file name when in extraction view */}
        {mobileView === 'extraction' && active && (
          <span className="text-xs text-gray-400 shrink-0 sm:hidden">{pdfFiles.filter(f => f.ai_extraction).length}/{pdfFiles.length} extracted</span>
        )}
      </div>

      {/* ── MOBILE: Single-pane view ────────────────────────────────── */}
      <div className="md:hidden flex flex-col flex-1 overflow-hidden">
        {mobileView === 'list' ? (
          /* File list */
          <div className="flex-1 overflow-y-auto bg-white">
            {sorted.map(f => (
              <FileListItem
                key={f.id}
                file={f}
                active={active?.id === f.id}
                onClick={() => handleFileSelect(f)}
              />
            ))}
          </div>
        ) : (
          /* Extraction panel + optional SharePoint link */
          <div className="flex-1 overflow-hidden flex flex-col bg-white">
            {/* File name + SharePoint link */}
            {active && (
              <div className="shrink-0 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-gray-700 truncate flex-1">{active.file_name}</p>
                {active.web_url && (
                  <a href={active.web_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline shrink-0">
                    View PDF ↗
                  </a>
                )}
              </div>
            )}
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
              <div className="flex items-center justify-center flex-1 text-gray-400 text-sm px-6 text-center">
                {!active ? 'Select a document' : 'Extraction only available for PDFs'}
              </div>
            )}

            {/* ── Mobile prev/next navigation bar ── */}
            {active && sorted.length > 1 && (() => {
              const idx  = sorted.findIndex(f => f.id === active.id)
              const prev = idx > 0 ? sorted[idx - 1] : null
              const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
              return (
                <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3 flex items-center justify-between gap-2">
                  <button
                    onClick={() => prev && handleFileSelect(prev)}
                    disabled={!prev}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
                      prev ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'
                    }`}
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-gray-400 font-medium tabular-nums">
                    {idx + 1} of {sorted.length}
                  </span>
                  <button
                    onClick={() => next && handleFileSelect(next)}
                    disabled={!next}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
                      next ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'
                    }`}
                  >
                    Next →
                  </button>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── DESKTOP: Three-column layout ────────────────────────────── */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">

        {/* Left sidebar — file list */}
        <div className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {sorted.map(f => (
              <FileListItem
                key={f.id}
                file={f}
                active={active?.id === f.id}
                onClick={() => handleFileSelect(f)}
              />
            ))}
          </div>
        </div>

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
        <div className="w-80 shrink-0 bg-white border-l border-gray-200 overflow-hidden flex flex-col">
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
