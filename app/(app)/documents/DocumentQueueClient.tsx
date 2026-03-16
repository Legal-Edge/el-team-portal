'use client'

import { useState, useCallback } from 'react'
import { useRouter }             from 'next/navigation'
import type { DocumentQueueRow } from '@/app/api/documents-queue/route'

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  < 1)  return 'Just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024)    return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ── Badge config ───────────────────────────────────────────────────────────

function statusBadge(row: DocumentQueueRow): { text: string; cls: string; dot: string } {
  if (!row.is_classified && !row.is_reviewed)
    return { text: 'Needs Classification', cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400'   }
  if (row.is_classified && !row.is_reviewed)
    return { text: 'Needs Review',         cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400'  }
  return   { text: 'Reviewed',             cls: 'bg-green-100 text-green-700', dot: 'bg-green-500'  }
}

const CHECKLIST_BADGE: Record<string, { text: string; cls: string }> = {
  required:     { text: 'Required',     cls: 'bg-red-50 text-red-700'    },
  requested:    { text: 'Requested',    cls: 'bg-orange-50 text-orange-700' },
  received:     { text: 'Received',     cls: 'bg-blue-50 text-blue-700'  },
  under_review: { text: 'Under Review', cls: 'bg-amber-50 text-amber-700'},
  approved:     { text: 'Approved',     cls: 'bg-green-50 text-green-700'},
  rejected:     { text: 'Rejected',     cls: 'bg-red-50 text-red-700'   },
  waived:       { text: 'Waived',       cls: 'bg-gray-100 text-gray-500' },
}

function urgencyBorder(row: DocumentQueueRow): string {
  if (!row.is_classified && row.case_status === 'document_collection')
    return 'border-l-[3px] border-l-red-400'
  if (!row.is_classified)
    return 'border-l-[3px] border-l-gray-300'
  if (row.is_classified && !row.is_reviewed)
    return 'border-l-[3px] border-l-amber-400'
  return   'border-l-[3px] border-l-green-400'
}

// ── Lookup tables ──────────────────────────────────────────────────────────

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

const STAGE_COLORS: Record<string, string> = {
  intake:              'bg-blue-50 text-blue-700',
  nurture:             'bg-yellow-50 text-yellow-700',
  document_collection: 'bg-purple-50 text-purple-700',
  attorney_review:     'bg-indigo-50 text-indigo-700',
  info_needed:         'bg-orange-50 text-orange-700',
  sign_up:             'bg-teal-50 text-teal-700',
  retained:            'bg-green-50 text-green-700',
  settled:             'bg-emerald-50 text-emerald-700',
  dropped:             'bg-red-50 text-red-700',
}

export const DOC_TYPE_OPTIONS: { code: string; label: string }[] = [
  { code: 'repair_order',                label: 'Repair Order'              },
  { code: 'warranty_document',           label: 'Warranty Document'         },
  { code: 'purchase_contract',           label: 'Purchase Contract'         },
  { code: 'lease_agreement',             label: 'Lease Agreement'           },
  { code: 'manufacturer_correspondence', label: 'Manufacturer Correspondence'},
  { code: 'dmv_registration',            label: 'DMV Registration'          },
  { code: 'insurance_document',          label: 'Insurance Document'        },
  { code: 'lemon_law_notice',            label: 'Lemon Law Notice'          },
  { code: 'settlement_agreement',        label: 'Settlement Agreement'      },
  { code: 'retainer_agreement',          label: 'Retainer Agreement'        },
  { code: 'power_of_attorney',           label: 'Power of Attorney'         },
  { code: 'other',                       label: 'Other'                     },
]

const DOC_TYPE_LABELS = Object.fromEntries(DOC_TYPE_OPTIONS.map(o => [o.code, o.label]))

// ── Filter config ──────────────────────────────────────────────────────────

type ReviewFilter = 'all' | 'needs_action' | 'needs_review' | 'reviewed'

const REVIEW_FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: 'all',          label: 'All'          },
  { id: 'needs_action', label: 'Needs Action' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'reviewed',     label: 'Reviewed'     },
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
  const [docType,      setDocType]      = useState('')
  const [stage,        setStage]        = useState('')
  const [attorney,     setAttorney]     = useState('')
  const [rows,         setRows]         = useState<DocumentQueueRow[]>(initialRows)
  const [total,        setTotal]        = useState(initialTotal)
  const [page,         setPage]         = useState(1)
  const [loading,      setLoading]      = useState(false)
  const [hasMore,      setHasMore]      = useState(initialRows.length < initialTotal)

  // Inline action states
  const [classifyingRow, setClassifyingRow] = useState<string | null>(null)
  const [classifyType,   setClassifyType]   = useState('')
  const [rejectingRow,   setRejectingRow]   = useState<string | null>(null)
  const [rejectNotes,    setRejectNotes]    = useState('')
  const [actionBusy,     setActionBusy]     = useState<string | null>(null)

  const LIMIT = 50

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (opts: {
    reviewFilter?: ReviewFilter
    docType?: string; stage?: string; attorney?: string
    page?: number;   append?: boolean
  }) => {
    const rf = opts.reviewFilter ?? reviewFilter
    const dt = opts.docType      ?? docType
    const s  = opts.stage        ?? stage
    const a  = opts.attorney     ?? attorney
    const p  = opts.page         ?? 1
    const ap = opts.append       ?? false

    let reviewed   = ''
    let classified = ''
    if (rf === 'needs_action') { reviewed = 'no'; classified = 'no'  }
    if (rf === 'needs_review') { reviewed = 'no'; classified = 'yes' }
    if (rf === 'reviewed')     { reviewed = 'yes' }

    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT), page: String(p),
        ...(reviewed   ? { reviewed }   : {}),
        ...(classified ? { classified } : {}),
        ...(dt ? { doc_type: dt } : {}),
        ...(s  ? { stage: s }    : {}),
        ...(a  ? { attorney: a } : {}),
      })
      const res  = await fetch(`/api/documents-queue?${params}`)
      const json = await res.json()
      setRows(prev => ap ? [...prev, ...(json.rows ?? [])] : (json.rows ?? []))
      setTotal(json.total ?? 0)
      setHasMore((json.rows?.length ?? 0) === LIMIT)
    } finally {
      setLoading(false)
    }
  }, [reviewFilter, docType, stage, attorney])

  // ── Filter handlers ──────────────────────────────────────────────────────

  function handleReviewFilter(rf: ReviewFilter) {
    setReviewFilter(rf); setPage(1)
    fetchRows({ reviewFilter: rf, docType, stage, attorney, page: 1 })
  }
  function handleDocType(dt: string) {
    setDocType(dt); setPage(1)
    fetchRows({ reviewFilter, docType: dt, stage, attorney, page: 1 })
  }
  function handleStage(s: string) {
    setStage(s); setPage(1)
    fetchRows({ reviewFilter, docType, stage: s, attorney, page: 1 })
  }
  function handleAttorney(a: string) {
    setAttorney(a); setPage(1)
    fetchRows({ reviewFilter, docType, stage, attorney: a, page: 1 })
  }
  function loadMore() {
    const next = page + 1; setPage(next)
    fetchRows({ reviewFilter, docType, stage, attorney, page: next, append: true })
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function submitClassify(docId: string) {
    if (!classifyType) return
    setActionBusy(docId)
    try {
      await fetch('/api/documents-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, action: 'classify', document_type_code: classifyType }),
      })
      setClassifyingRow(null); setClassifyType('')
      fetchRows({ reviewFilter, docType, stage, attorney, page: 1 }); setPage(1)
    } finally {
      setActionBusy(null)
    }
  }

  async function submitApprove(docId: string) {
    setActionBusy(docId)
    try {
      await fetch('/api/documents-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, action: 'approve' }),
      })
      fetchRows({ reviewFilter, docType, stage, attorney, page: 1 }); setPage(1)
    } finally {
      setActionBusy(null)
    }
  }

  async function submitReject(docId: string) {
    setActionBusy(docId)
    try {
      await fetch('/api/documents-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, action: 'reject', review_notes: rejectNotes }),
      })
      setRejectingRow(null); setRejectNotes('')
      fetchRows({ reviewFilter, docType, stage, attorney, page: 1 }); setPage(1)
    } finally {
      setActionBusy(null)
    }
  }

  // ── Summary counts ────────────────────────────────────────────────────────

  const unclassCount   = rows.filter(r => !r.is_classified).length
  const needsRevCount  = rows.filter(r => r.is_classified && !r.is_reviewed).length
  const alarmCount     = rows.filter(r => !r.is_classified && r.case_status === 'document_collection').length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Document Queue</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-gray-500">{total.toLocaleString()} document{total !== 1 ? 's' : ''}</span>
            {alarmCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                🔴 {alarmCount} doc-collection alarm{alarmCount !== 1 ? 's' : ''}
              </span>
            )}
            {unclassCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                {unclassCount} unclassified
              </span>
            )}
            {needsRevCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                {needsRevCount} awaiting review
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 flex-wrap">

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
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <span className="text-2xl">📂</span>
            <span className="text-sm text-gray-400">No documents match this filter</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                <th className="w-[3px] px-0" />
                <th className="px-4 py-3 text-left font-medium">Client &amp; Case</th>
                <th className="px-4 py-3 text-left font-medium">File</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Checklist</th>
                <th className="px-4 py-3 text-left font-medium">Uploaded</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const badge   = statusBadge(row)
                const border  = urgencyBorder(row)
                const busy    = actionBusy === row.doc_id
                const chk     = row.checklist_status ? CHECKLIST_BADGE[row.checklist_status] : null
                const isClassifying = classifyingRow === row.doc_id
                const isRejecting   = rejectingRow   === row.doc_id

                return (
                  <tr key={row.doc_id} className={`hover:bg-gray-50 transition-colors ${border}`}>
                    <td className="w-[3px] px-0" />

                    {/* Client + Case */}
                    <td
                      className="px-4 py-3 cursor-pointer min-w-[160px]"
                      onClick={() => router.push(`/cases/${row.hubspot_deal_id}?tab=documents`)}
                    >
                      <div className="font-medium text-gray-900 text-sm leading-tight">
                        {row.client_full_name?.trim() || <span className="text-gray-300 italic text-xs">Unknown</span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-xs font-mono text-gray-400">
                          {row.case_number ?? row.hubspot_deal_id.slice(-6)}
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium ${STAGE_COLORS[row.case_status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STAGE_LABELS[row.case_status] ?? row.case_status}
                        </span>
                      </div>
                      {row.client_phone && (
                        <div className="text-xs text-gray-400 mt-0.5">{row.client_phone}</div>
                      )}
                    </td>

                    {/* File */}
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="flex items-start gap-1.5">
                        <span className="text-base shrink-0 mt-0.5">{SOURCE_ICON[row.source] ?? '📄'}</span>
                        <div className="min-w-0">
                          <div
                            className="text-xs text-gray-800 truncate leading-snug"
                            title={row.file_name}
                          >
                            {row.file_name}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {row.document_type_code && (
                              <span className="text-[10px] text-blue-600 font-medium">
                                {DOC_TYPE_LABELS[row.document_type_code] ?? row.document_type_code}
                              </span>
                            )}
                            {fileSize(row.size_bytes) && (
                              <span className="text-[10px] text-gray-400">{fileSize(row.size_bytes)}</span>
                            )}
                          </div>
                          {row.web_url && (
                            <a
                              href={row.web_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-500 hover:text-blue-700 mt-0.5 transition-colors"
                            >
                              ↗ Open in SharePoint
                            </a>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dot}`} />
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                          {badge.text}
                        </span>
                      </div>
                      {row.is_reviewed && row.reviewed_by_name && (
                        <div className="text-[10px] text-gray-400 mt-1 ml-3">
                          by {row.reviewed_by_name}
                          {row.reviewed_at && <span className="ml-1">· {relativeTime(row.reviewed_at)}</span>}
                        </div>
                      )}
                      {row.is_classified && !row.is_reviewed && row.classified_at && (
                        <div className="text-[10px] text-gray-400 mt-1 ml-3">
                          classified {relativeTime(row.classified_at)}
                        </div>
                      )}
                      {row.review_notes && (
                        <div
                          className="text-[10px] text-gray-500 mt-1 ml-3 italic truncate max-w-[140px]"
                          title={row.review_notes}
                        >
                          &ldquo;{row.review_notes}&rdquo;
                        </div>
                      )}
                    </td>

                    {/* Checklist expectation */}
                    <td className="px-4 py-3">
                      {chk ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${chk.cls}`}>
                          {chk.text}
                        </span>
                      ) : (
                        <span className="text-gray-200 text-xs">—</span>
                      )}
                    </td>

                    {/* Uploaded */}
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {relativeTime(row.created_at_source ?? row.synced_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 min-w-[180px]">

                      {/* ── Inline Classify form ── */}
                      {isClassifying ? (
                        <div className="flex flex-col gap-1.5">
                          <select
                            value={classifyType}
                            onChange={e => setClassifyType(e.target.value)}
                            autoFocus
                            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-lemon-400"
                          >
                            <option value="">Pick type…</option>
                            {DOC_TYPE_OPTIONS.map(o => (
                              <option key={o.code} value={o.code}>{o.label}</option>
                            ))}
                          </select>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => submitClassify(row.doc_id)}
                              disabled={!classifyType || busy}
                              className="text-xs px-2.5 py-1 rounded-md bg-lemon-400 hover:bg-lemon-500 text-gray-900 font-medium transition-all active:scale-95 disabled:opacity-40"
                            >
                              {busy ? '…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => { setClassifyingRow(null); setClassifyType('') }}
                              className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>

                      /* ── Inline Reject form ── */
                      ) : isRejecting ? (
                        <div className="flex flex-col gap-1.5">
                          <input
                            type="text"
                            placeholder="Rejection reason (optional)"
                            value={rejectNotes}
                            onChange={e => setRejectNotes(e.target.value)}
                            autoFocus
                            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => submitReject(row.doc_id)}
                              disabled={busy}
                              className="text-xs px-2.5 py-1 rounded-md bg-red-500 hover:bg-red-600 text-white font-medium transition-all active:scale-95 disabled:opacity-40"
                            >
                              {busy ? '…' : 'Reject'}
                            </button>
                            <button
                              onClick={() => { setRejectingRow(null); setRejectNotes('') }}
                              className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>

                      /* ── Normal action buttons ── */
                      ) : (
                        <div className="flex gap-2 items-center flex-wrap">
                          {/* Classify — shown when not classified */}
                          {!row.is_classified && (
                            <button
                              onClick={() => { setClassifyingRow(row.doc_id); setClassifyType(row.document_type_code ?? '') }}
                              disabled={busy}
                              className="text-xs px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-all active:scale-95 disabled:opacity-40"
                            >
                              Classify
                            </button>
                          )}
                          {/* Approve — shown when classified but not reviewed */}
                          {row.is_classified && !row.is_reviewed && (
                            <button
                              onClick={() => submitApprove(row.doc_id)}
                              disabled={busy}
                              className="text-xs px-2.5 py-1 rounded-md bg-lemon-400 hover:bg-lemon-500 text-gray-900 font-medium transition-all active:scale-95 disabled:opacity-40"
                            >
                              {busy ? '…' : 'Approve'}
                            </button>
                          )}
                          {/* Reject — shown when classified but not reviewed */}
                          {row.is_classified && !row.is_reviewed && (
                            <button
                              onClick={() => setRejectingRow(row.doc_id)}
                              disabled={busy}
                              className="text-xs px-2.5 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 font-medium transition-all active:scale-95 disabled:opacity-40"
                            >
                              Reject
                            </button>
                          )}
                          {/* Already reviewed */}
                          {row.is_reviewed && (
                            <span className="text-xs text-gray-400 italic">Done</span>
                          )}
                        </div>
                      )}
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
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={loadMore}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Loading…' : `Load more · ${(total - rows.length).toLocaleString()} remaining`}
          </button>
          <span className="text-xs text-gray-400">
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
          </span>
        </div>
      )}

    </div>
  )
}
