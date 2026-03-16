'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { DocumentQueueRow } from '@/app/api/documents-queue/route'

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function fileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function classificationBadge(row: DocumentQueueRow) {
  if (!row.is_classified) return { text: 'Unclassified', cls: 'bg-gray-100 text-gray-500' }
  const src = row.classification_source ?? 'manual'
  const srcLabel = src === 'ai' ? 'AI' : src === 'rule' ? 'Rule' : src === 'auto' ? 'Auto' : 'Manual'
  return { text: `Classified · ${srcLabel}`, cls: 'bg-blue-50 text-blue-600' }
}

function reviewBadge(row: DocumentQueueRow) {
  if (!row.is_classified) return { text: 'Awaiting Classification', cls: 'bg-amber-100 text-amber-700' }
  if (!row.is_reviewed)   return { text: 'Needs Review',            cls: 'bg-orange-100 text-orange-700' }
  return                          { text: 'Reviewed',               cls: 'bg-green-100 text-green-700' }
}

function urgencyBorder(row: DocumentQueueRow): string {
  if (!row.is_classified)                       return 'border-l-[3px] border-l-gray-300'
  if (row.is_classified && !row.is_reviewed)    return 'border-l-[3px] border-l-amber-400'
  return                                               'border-l-[3px] border-l-green-400'
}

const SOURCE_ICON: Record<string, string> = {
  sharepoint:       '📁',
  portal_upload:    '⬆️',
  email_attachment: '✉️',
  staff_upload:     '👤',
}

const STAGE_LABELS: Record<string, string> = {
  intake:              'Intake',
  nurture:             'Nurture',
  document_collection: 'Doc Collection',
  attorney_review:     'Attorney Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up',
  retained:            'Retained',
  settled:             'Settled',
  dropped:             'Dropped',
}

const DOC_TYPE_LABELS: Record<string, string> = {
  repair_order:           'Repair Order',
  warranty_document:      'Warranty',
  purchase_contract:      'Purchase Contract',
  lease_agreement:        'Lease Agreement',
  manufacturer_correspondence: 'Mfr. Correspondence',
  dmv_registration:       'DMV Registration',
  insurance_document:     'Insurance',
  lemon_law_notice:       'Lemon Law Notice',
  settlement_agreement:   'Settlement',
  retainer_agreement:     'Retainer',
  power_of_attorney:      'Power of Attorney',
  other:                  'Other',
}

type ReviewFilter = 'all' | 'needs_action' | 'needs_review' | 'reviewed'
type ClassFilter  = 'all' | 'yes' | 'no'

const REVIEW_FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: 'all',          label: 'All'              },
  { id: 'needs_action', label: 'Needs Action'     },
  { id: 'needs_review', label: 'Needs Review'     },
  { id: 'reviewed',     label: 'Reviewed'         },
]

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  initialRows:  DocumentQueueRow[]
  initialTotal: number
  attorneys:    { id: string; display_name: string }[]
  docTypes:     string[]
}

export default function DocumentQueueClient({ initialRows, initialTotal, attorneys, docTypes }: Props) {
  const router = useRouter()

  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [classFilter,  setClassFilter]  = useState<ClassFilter>('all')
  const [docType,      setDocType]      = useState('')
  const [stage,        setStage]        = useState('')
  const [attorney,     setAttorney]     = useState('')
  const [rows,         setRows]         = useState<DocumentQueueRow[]>(initialRows)
  const [total,        setTotal]        = useState(initialTotal)
  const [page,         setPage]         = useState(1)
  const [loading,      setLoading]      = useState(false)
  const [hasMore,      setHasMore]      = useState(initialRows.length < initialTotal)
  const [actionRow,    setActionRow]    = useState<string | null>(null)

  const LIMIT = 50

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (opts: {
    reviewFilter?: ReviewFilter; classFilter?: ClassFilter
    docType?: string; stage?: string; attorney?: string
    page?: number; append?: boolean
  }) => {
    const rf = opts.reviewFilter ?? reviewFilter
    const cf = opts.classFilter  ?? classFilter
    const dt = opts.docType      ?? docType
    const s  = opts.stage        ?? stage
    const a  = opts.attorney     ?? attorney
    const p  = opts.page         ?? 1
    const ap = opts.append       ?? false

    // Map review filter tab to API params
    let reviewed  = ''
    let classified = cf === 'all' ? '' : cf
    if (rf === 'needs_action') { reviewed = 'no'; classified = 'no' }
    if (rf === 'needs_review') { reviewed = 'no'; classified = 'yes' }
    if (rf === 'reviewed')     { reviewed = 'yes' }

    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT), page: String(p),
        ...(reviewed   ? { reviewed }   : {}),
        ...(classified ? { classified } : {}),
        ...(dt ? { doc_type: dt } : {}),
        ...(s  ? { stage: s }     : {}),
        ...(a  ? { attorney: a }  : {}),
      })
      const res  = await fetch(`/api/documents-queue?${params}`)
      const json = await res.json()
      setRows(prev => ap ? [...prev, ...(json.rows ?? [])] : (json.rows ?? []))
      setTotal(json.total ?? 0)
      setHasMore((json.rows?.length ?? 0) === LIMIT)
    } finally {
      setLoading(false)
    }
  }, [reviewFilter, classFilter, docType, stage, attorney])

  // ── Filter handlers ──────────────────────────────────────────────────────

  function handleReviewFilter(rf: ReviewFilter) {
    setReviewFilter(rf); setPage(1)
    fetchRows({ reviewFilter: rf, classFilter, docType, stage, attorney, page: 1 })
  }
  function handleClassFilter(cf: ClassFilter) {
    setClassFilter(cf); setPage(1)
    fetchRows({ reviewFilter, classFilter: cf, docType, stage, attorney, page: 1 })
  }
  function handleDocType(dt: string) {
    setDocType(dt); setPage(1)
    fetchRows({ reviewFilter, classFilter, docType: dt, stage, attorney, page: 1 })
  }
  function handleStage(s: string) {
    setStage(s); setPage(1)
    fetchRows({ reviewFilter, classFilter, docType, stage: s, attorney, page: 1 })
  }
  function handleAttorney(a: string) {
    setAttorney(a); setPage(1)
    fetchRows({ reviewFilter, classFilter, docType, stage, attorney: a, page: 1 })
  }
  function loadMore() {
    const next = page + 1; setPage(next)
    fetchRows({ reviewFilter, classFilter, docType, stage, attorney, page: next, append: true })
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleAction(docId: string, action: 'classify' | 'approve') {
    setActionRow(docId)
    try {
      await fetch('/api/documents-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, action }),
      })
      // Refresh current view
      fetchRows({ reviewFilter, classFilter, docType, stage, attorney, page: 1 })
      setPage(1)
    } finally {
      setActionRow(null)
    }
  }

  // ── Summary counts ────────────────────────────────────────────────────────

  const unclassifiedCount = rows.filter(r => !r.is_classified).length
  const needsReviewCount  = rows.filter(r => r.is_classified && !r.is_reviewed).length

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Document Queue</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {total} document{total !== 1 ? 's' : ''}
            {unclassifiedCount > 0 && <span className="ml-2 text-gray-600 font-medium">· {unclassifiedCount} unclassified</span>}
            {needsReviewCount  > 0 && <span className="ml-2 text-amber-600 font-medium">· {needsReviewCount} needs review</span>}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-100 flex-wrap">

        {/* Review status tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {REVIEW_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => handleReviewFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all active:scale-95 ${
                reviewFilter === f.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Doc type */}
        <select
          value={docType}
          onChange={e => handleDocType(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
        >
          <option value="">All Types</option>
          {docTypes.map(dt => (
            <option key={dt} value={dt}>{DOC_TYPE_LABELS[dt] ?? dt}</option>
          ))}
        </select>

        {/* Stage */}
        <select
          value={stage}
          onChange={e => handleStage(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
        >
          <option value="">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Attorney */}
        {attorneys.length > 0 && (
          <select
            value={attorney}
            onChange={e => handleAttorney(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
          >
            <option value="">All Attorneys</option>
            {attorneys.map(a => (
              <option key={a.id} value={a.id}>{a.display_name}</option>
            ))}
          </select>
        )}

      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-sm text-gray-400">
            <span className="text-2xl mb-2">📂</span>
            No documents match this filter
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="w-1 px-0" />
                <th className="px-4 py-2.5 text-left font-medium">Client</th>
                <th className="px-4 py-2.5 text-left font-medium">Case</th>
                <th className="px-4 py-2.5 text-left font-medium">Stage</th>
                <th className="px-4 py-2.5 text-left font-medium">File</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-left font-medium">Classification</th>
                <th className="px-4 py-2.5 text-left font-medium">Review</th>
                <th className="px-4 py-2.5 text-left font-medium">Reviewer</th>
                <th className="px-4 py-2.5 text-left font-medium">Uploaded</th>
                <th className="px-4 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const cls    = classificationBadge(row)
                const rev    = reviewBadge(row)
                const border = urgencyBorder(row)
                const busy   = actionRow === row.doc_id

                return (
                  <tr
                    key={row.doc_id}
                    className={`hover:bg-gray-50 transition-colors ${border}`}
                  >
                    <td className="w-1 px-0" />

                    {/* Client */}
                    <td
                      className="px-4 py-3 cursor-pointer"
                      onClick={() => router.push(`/cases/${row.case_id}?tab=documents`)}
                    >
                      <div className="font-medium text-gray-900">
                        {row.client_full_name || 'Unknown'}
                      </div>
                      {row.client_phone && (
                        <div className="text-xs text-gray-400 mt-0.5">{row.client_phone}</div>
                      )}
                    </td>

                    {/* Case number */}
                    <td
                      className="px-4 py-3 text-gray-600 font-mono text-xs whitespace-nowrap cursor-pointer"
                      onClick={() => router.push(`/cases/${row.case_id}?tab=documents`)}
                    >
                      {row.case_number ?? row.hubspot_deal_id.slice(-6)}
                    </td>

                    {/* Stage */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        {STAGE_LABELS[row.case_status] ?? row.case_status}
                      </span>
                    </td>

                    {/* File */}
                    <td className="px-4 py-3 max-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{SOURCE_ICON[row.source] ?? '📄'}</span>
                        {row.web_url ? (
                          <a
                            href={row.web_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs truncate max-w-[160px]"
                            onClick={e => e.stopPropagation()}
                          >
                            {row.file_name}
                          </a>
                        ) : (
                          <span className="text-xs text-gray-600 truncate max-w-[160px]">{row.file_name}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{fileSize(row.size_bytes)}</div>
                    </td>

                    {/* Doc type */}
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {row.document_type_code
                        ? (DOC_TYPE_LABELS[row.document_type_code] ?? row.document_type_code)
                        : <span className="text-gray-300">—</span>
                      }
                    </td>

                    {/* Classification */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls.cls}`}>
                        {cls.text}
                      </span>
                      {row.classified_at && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {relativeTime(row.classified_at)}
                        </div>
                      )}
                    </td>

                    {/* Review status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rev.cls}`}>
                        {rev.text}
                      </span>
                      {row.review_notes && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[120px]" title={row.review_notes}>
                          {row.review_notes}
                        </div>
                      )}
                    </td>

                    {/* Reviewer */}
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {row.reviewed_by_name ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Upload time */}
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {relativeTime(row.created_at_source ?? row.synced_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex gap-2 items-center">
                        {!row.is_classified && (
                          <button
                            onClick={() => handleAction(row.doc_id, 'classify')}
                            disabled={busy}
                            className="text-xs px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            {busy ? '…' : 'Classify'}
                          </button>
                        )}
                        {row.is_classified && !row.is_reviewed && (
                          <button
                            onClick={() => handleAction(row.doc_id, 'approve')}
                            disabled={busy}
                            className="text-xs px-2.5 py-1 rounded-md bg-lemon-400 hover:bg-lemon-500 text-gray-900 font-medium transition-all active:scale-95 disabled:opacity-40"
                          >
                            {busy ? '…' : 'Approve'}
                          </button>
                        )}
                      </div>
                    </td>

                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="px-6 py-3 border-t border-gray-100">
          <button
            onClick={loadMore}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Loading…' : `Load more (${total - rows.length} remaining)`}
          </button>
        </div>
      )}

    </div>
  )
}
