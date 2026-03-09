'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface CaseIntake {
  id: string
  case_id: string
  // Submission
  ela_intake: string | null
  intake_management: string | null
  intake_hubspot_qualifier: string | null
  intake_associate: string | null
  had_repairs: boolean | null
  paid_for_repairs: string | null
  repair_count: string | null
  // Vehicle supplement
  purchase_or_lease: string | null
  how_purchased: string | null
  vehicle_status: string | null
  // Problems
  problem_1_category: string | null
  problem_1_notes: string | null
  problem_1_repair_attempts: string | null
  problem_2_category: string | null
  problem_2_notes: string | null
  problem_2_repair_attempts: string | null
  problem_3_category: string | null
  problem_3_notes: string | null
  problem_3_repair_attempts: string | null
  problem_4_category: string | null
  problem_4_notes: string | null
  problem_4_repair_attempts: string | null
  repair_attempts: string | null
  last_repair_attempt_date: string | null
  // Additional
  in_shop_30_days: string | null
  contacted_manufacturer: string | null
  manufacturer_offer: string | null
  has_repair_documents: string | null
  refund_preference: string | null
}

interface Comm {
  id: string
  channel: string
  direction: string | null
  subject: string | null
  snippet: string | null
  body: string | null
  occurred_at: string | null
  duration_seconds: number | null
  outcome: string | null
  resolution_method: string | null
  needs_review: boolean
  review_reason: string | null
  hubspot_engagement_id: string
  sender_email: string | null
  sender_name: string | null
  recipient_emails: string[]
  from_number: string | null
  to_number: string | null
  recording_url: string | null
}

interface CaseDetail {
  id: string
  hubspot_deal_id: string
  client_first_name: string | null
  client_last_name: string | null
  client_email: string | null
  client_phone: string | null
  client_address: string | null
  vehicle_year: number | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_vin: string | null
  vehicle_mileage: number | null
  vehicle_purchase_date: string | null
  vehicle_purchase_price: number | null
  vehicle_is_new: boolean | null
  case_type: string | null
  case_status: string
  case_priority: string | null
  attorney_id: string | null
  paralegal_id: string | null
  state_jurisdiction: string | null
  filing_deadline: string | null
  statute_of_limitations: string | null
  estimated_value: number | null
  settlement_amount: number | null
  attorney_fees: number | null
  sharepoint_folder_url: string | null
  sharepoint_folder_title: string | null
  case_notes: string | null
  internal_notes: string | null
  tags: string[] | null
  intake_completed_at: string | null
  review_completed_at: string | null
  filed_at: string | null
  settled_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

const STATUS_LABELS: Record<string, string> = {
  intake:              'Intake',
  nurture:             'Nurture',
  document_collection: 'Document Collection',
  attorney_review:     'Attorney Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up',
  retained:            'Retained',
  settled:             'Settled',
  dropped:             'Dropped',
  unknown:             'Unknown',
}

const STATUS_COLORS: Record<string, string> = {
  intake:              'bg-blue-100 text-blue-700',
  nurture:             'bg-yellow-100 text-yellow-700',
  document_collection: 'bg-purple-100 text-purple-700',
  attorney_review:     'bg-indigo-100 text-indigo-700',
  info_needed:         'bg-orange-100 text-orange-700',
  sign_up:             'bg-teal-100 text-teal-700',
  retained:            'bg-green-100 text-green-700',
  settled:             'bg-emerald-100 text-emerald-700',
  dropped:             'bg-red-100 text-red-700',
  unknown:             'bg-gray-100 text-gray-500',
}

// ─── Shared field component ────────────────────────────────────────────────
function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>
        {value ?? <span className="text-gray-300 italic">—</span>}
      </p>
    </div>
  )
}

// ─── Standard section card ─────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-5">{title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {children}
      </div>
    </div>
  )
}

// ─── Accordion section — same card language as Section ────────────────────
function IntakeSection({
  title, icon, defaultOpen = false, children
}: {
  title: string
  icon: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base leading-none">{icon}</span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
        </div>
        {/* Chevron: right when closed, rotates down when open */}
        <span
          className={`text-gray-400 text-lg leading-none select-none inline-block transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>

      {open && (
        <>
          <div className="border-t border-gray-100" />
          <div className="px-6 py-5">
            {children}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Problem card inside Issues & Repair History ──────────────────────────
function IntakeProblem({ n, category, notes, attempts }: {
  n: number; category: string | null; notes: string | null; attempts: string | null
}) {
  if (!category && !notes) return null
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Problem {n}</p>
        {attempts && (
          <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
            {attempts} repair attempt{attempts !== '1' ? 's' : ''}
          </span>
        )}
      </div>
      {category && <p className="text-sm font-medium text-gray-900 mb-1">{category}</p>}
      {notes && <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{notes}</p>}
    </div>
  )
}

// ─── Communications ────────────────────────────────────────────────────────
const CHANNEL_ICON: Record<string, string> = {
  call: '📞', sms: '💬', email: '✉️', note: '📝', meeting: '📅', task: '✅', other: '•'
}
const DIRECTION_COLOR: Record<string, string> = {
  inbound: 'text-green-600', outbound: 'text-blue-600', unknown: 'text-gray-400'
}

function CommRow({ comm }: { comm: Comm }) {
  const [expanded, setExpanded] = useState(false)
  const icon = CHANNEL_ICON[comm.channel] ?? '•'
  const dirColor = DIRECTION_COLOR[comm.direction ?? 'unknown'] ?? 'text-gray-400'
  const time = comm.occurred_at
    ? new Date(comm.occurred_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—'
  const duration = comm.duration_seconds
    ? comm.duration_seconds >= 60
      ? `${Math.floor(comm.duration_seconds / 60)}m ${comm.duration_seconds % 60}s`
      : `${comm.duration_seconds}s`
    : null

  const fullContent = comm.body || comm.snippet
  const hasContent = !!fullContent

  return (
    <div className={`px-6 py-4 transition-colors ${comm.needs_review ? 'border-l-4 border-l-yellow-400' : ''}`}>
      {/* Header row */}
      <div
        className="flex items-start justify-between gap-4 cursor-pointer"
        onClick={() => hasContent && setExpanded(e => !e)}
      >
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-lg mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-medium uppercase ${dirColor}`}>
                {comm.direction ?? 'unknown'}
              </span>
              <span className="text-xs text-gray-400 capitalize">{comm.channel}</span>
              {comm.subject && (
                <span className="text-sm text-gray-800 font-medium">{comm.subject}</span>
              )}
              {duration && (
                <span className="text-xs text-gray-400">{duration}</span>
              )}
              {comm.needs_review && (
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">⚠ Review</span>
              )}
            </div>

            {(comm.sender_email || comm.recipient_emails?.length > 0) && (
              <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                {comm.sender_email && <span>From: {comm.sender_name ? `${comm.sender_name} <${comm.sender_email}>` : comm.sender_email}</span>}
                {comm.recipient_emails?.length > 0 && <span>To: {comm.recipient_emails.join(', ')}</span>}
              </div>
            )}
            {(comm.from_number || comm.to_number) && (
              <div className="text-xs text-gray-400 mt-0.5">
                {comm.from_number} → {comm.to_number}
              </div>
            )}

            {!expanded && comm.snippet && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2 max-w-2xl">{comm.snippet}</p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <p className="text-xs text-gray-400 whitespace-nowrap">{time}</p>
          {hasContent && (
            <span className={`text-xs text-gray-400 inline-block transition-transform duration-200 leading-none select-none ${expanded ? 'rotate-90' : ''}`}>›</span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 ml-9 space-y-3">
          {fullContent && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                {comm.channel === 'call' ? 'Call Notes' : comm.channel === 'email' ? 'Email Body' : 'Content'}
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{fullContent}</p>
            </div>
          )}
          {comm.recording_url && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Recording:</span>
              <a
                href={comm.recording_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                Listen ↗
              </a>
            </div>
          )}
          {comm.review_reason && (
            <p className="text-xs text-yellow-600">{comm.review_reason}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────
// ── Document layer types ──────────────────────────────────────

interface DocType {
  code: string
  label: string
  description: string | null
  is_required_default: boolean
  sort_order: number
}

interface ChecklistItem {
  id: string
  document_type_code: string
  status: 'required' | 'requested' | 'received' | 'under_review' | 'approved' | 'rejected' | 'waived'
  is_required: boolean
  requested_at: string | null
  received_at: string | null
  approved_at: string | null
  notes: string | null
  type: DocType | null
  files: CaseFile[]
}

interface CaseFile {
  id: string
  name: string
  file_extension: string | null
  size_bytes: number | null
  web_url: string | null
  document_type_code: string | null
  checklist_item_id: string | null
  is_classified: boolean
  classified_by: string | null
  classified_at: string | null
  classification_source: string | null
  created_at_source: string | null
  created_by: string | null
}

interface DocumentStats {
  total: number
  required: number
  requested: number
  received: number
  approved: number
  waived: number
  unclassified: number
}

const STATUS_ICON: Record<string, string> = {
  required:     '❌',
  requested:    '⏳',
  received:     '📄',
  under_review: '🔍',
  approved:     '✅',
  rejected:     '⚠️',
  waived:       '—',
}

const STATUS_BADGE: Record<string, string> = {
  required:     'bg-red-50 text-red-600',
  requested:    'bg-yellow-50 text-yellow-700',
  received:     'bg-blue-50 text-blue-700',
  under_review: 'bg-purple-50 text-purple-700',
  approved:     'bg-green-50 text-green-700',
  rejected:     'bg-orange-50 text-orange-700',
  waived:       'bg-gray-50 text-gray-400',
}

function formatBytes(bytes: number | null) {
  if (!bytes) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function DocumentsSection({
  caseId, sharePointUrl
}: {
  caseId: string
  sharePointUrl: string | null
}) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [unclassified, setUnclassified] = useState<CaseFile[]>([])
  const [docTypes, setDocTypes] = useState<DocType[]>([])
  const [stats, setStats] = useState<DocumentStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [classifying, setClassifying] = useState<string | null>(null) // file id being classified
  const [classifyType, setClassifyType] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/cases/${caseId}/documents`)
    if (res.ok) {
      const data = await res.json()
      setChecklist(data.checklist ?? [])
      setUnclassified(data.unclassified ?? [])
      setDocTypes(data.docTypes ?? [])
      setStats(data.stats ?? null)
    }
    setLoading(false)
  }, [caseId])

  useEffect(() => { load() }, [load])

  async function classify(fileId: string, typeCode: string) {
    setSaving(true)
    const res = await fetch(`/api/cases/${caseId}/documents/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, document_type_code: typeCode }),
    })
    setSaving(false)
    if (res.ok) {
      setClassifying(null)
      setClassifyType('')
      load()
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-400">Loading documents…</p>
      </div>
    )
  }

  const noData = checklist.length === 0 && unclassified.length === 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Documents</h2>
          {stats && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {stats.approved > 0   && <span className="text-green-600">✅ {stats.approved} approved</span>}
              {stats.received > 0   && <span className="text-blue-600">📄 {stats.received} received</span>}
              {stats.required > 0   && <span className="text-red-500">❌ {stats.required} missing</span>}
              {stats.unclassified > 0 && <span className="text-yellow-600">📎 {stats.unclassified} unclassified</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sharePointUrl && (
            <a
              href={sharePointUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Open folder ↗
            </a>
          )}
          <button
            onClick={load}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {noData ? (
        <div className="py-10 text-center">
          <p className="text-gray-400 text-sm">No document data yet</p>
          {sharePointUrl
            ? <p className="text-gray-300 text-xs mt-1">Run init-case-checklist + sync-sharepoint-docs to populate</p>
            : <p className="text-gray-300 text-xs mt-1">No SharePoint folder linked — check HubSpot deal</p>
          }
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {/* Checklist items */}
          {checklist.map(item => (
            <div key={item.id} className="px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-base mt-0.5 shrink-0">{STATUS_ICON[item.status] ?? '•'}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800">
                        {item.type?.label ?? item.document_type_code}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[item.status]}`}>
                        {item.status.replace('_', ' ')}
                      </span>
                      {item.is_required && item.status === 'required' && (
                        <span className="text-xs text-red-400">required</span>
                      )}
                    </div>
                    {item.type?.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{item.type.description}</p>
                    )}
                    {/* Linked files */}
                    {item.files.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {item.files.map(f => (
                          <div key={f.id} className="flex items-center gap-2 text-xs text-gray-500">
                            <span>📎</span>
                            <span className="truncate max-w-xs">{f.name}</span>
                            {f.size_bytes && <span className="text-gray-300">{formatBytes(f.size_bytes)}</span>}
                            {f.web_url && (
                              <a href={f.web_url} target="_blank" rel="noopener noreferrer"
                                className="text-blue-500 hover:underline shrink-0">
                                Open ↗
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {item.notes && (
                      <p className="text-xs text-gray-400 mt-1 italic">{item.notes}</p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 text-xs text-gray-300">
                  {item.received_at && <p>Received {new Date(item.received_at).toLocaleDateString()}</p>}
                  {item.approved_at && <p>Approved {new Date(item.approved_at).toLocaleDateString()}</p>}
                </div>
              </div>
            </div>
          ))}

          {/* Unclassified files */}
          {unclassified.length > 0 && (
            <div className="px-6 py-4 bg-yellow-50/40">
              <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-3">
                Unclassified Files ({unclassified.length})
              </p>
              <div className="space-y-3">
                {unclassified.map(f => (
                  <div key={f.id} className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-gray-700 font-medium min-w-0 truncate max-w-xs">{f.name}</span>
                    {f.size_bytes && <span className="text-xs text-gray-400">{formatBytes(f.size_bytes)}</span>}
                    {f.web_url && (
                      <a href={f.web_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline">Open ↗</a>
                    )}
                    {/* Classify action */}
                    {classifying === f.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                          value={classifyType}
                          onChange={e => setClassifyType(e.target.value)}
                        >
                          <option value="">Select type…</option>
                          {docTypes.map(t => (
                            <option key={t.code} value={t.code}>{t.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => classifyType && classify(f.id, classifyType)}
                          disabled={!classifyType || saving}
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-40"
                        >
                          {saving ? '…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setClassifying(null); setClassifyType('') }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setClassifying(f.id); setClassifyType('') }}
                        className="text-xs text-gray-500 border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                      >
                        Classify ▾
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CaseDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [caseData, setCaseData] = useState<CaseDetail | null>(null)
  const [intake, setIntake] = useState<CaseIntake | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [comms, setComms] = useState<Comm[]>([])
  const [commCounts, setCommCounts] = useState<Record<string, number>>({})
  const [commTotal, setCommTotal] = useState(0)
  const [commChannel, setCommChannel] = useState('')
  const [commsLoading, setCommsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/cases/${params.id}`)
      if (res.status === 404) { setNotFound(true); setLoading(false); return }
      if (res.ok) {
        const data = await res.json()
        setCaseData(data.case)
        setIntake(data.intake ?? null)
      }
      setLoading(false)
    }
    load()
  }, [params.id])

  const loadComms = useCallback(async (channel: string) => {
    setCommsLoading(true)
    const url = channel
      ? `/api/cases/${params.id}/comms?channel=${channel}`
      : `/api/cases/${params.id}/comms`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      setComms(data.comms)
      setCommCounts(data.counts)
      setCommTotal(data.total)
    }
    setCommsLoading(false)
  }, [params.id])

  useEffect(() => { loadComms(commChannel) }, [commChannel, loadComms])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading case…</p>
      </div>
    )
  }

  if (notFound || !caseData) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3">
        <p className="text-gray-700 font-medium">Case not found</p>
        <button onClick={() => router.push('/cases' as never)} className="text-sm text-blue-600 hover:underline">
          ← Back to queue
        </button>
      </div>
    )
  }

  const c = caseData
  const clientName = [c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || 'Unknown Client'
  const vehicle    = [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || 'Unknown Vehicle'

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-8 py-5 flex justify-between items-start">
          <div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
              <a href="/dashboard" className="hover:text-gray-600 transition-colors">Dashboard</a>
              <span>/</span>
              <a href="/cases" className="hover:text-gray-600 transition-colors">Cases</a>
              <span>/</span>
              <span className="text-gray-600">{clientName}</span>
            </div>
            {/* Title row */}
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{clientName}</h1>
              <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[c.case_status] ?? STATUS_COLORS.unknown}`}>
                {STATUS_LABELS[c.case_status] ?? c.case_status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{vehicle}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-1">
            {c.sharepoint_folder_url && (
              <a
                href={c.sharepoint_folder_url}
                target="_blank"
                rel="noopener noreferrer"
                title={c.sharepoint_folder_title ?? 'Open SharePoint Folder'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                📁 SharePoint ↗
              </a>
            )}
            <a
              href={`https://app.hubspot.com/contacts/47931752/deal/${c.hubspot_deal_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
            >
              HubSpot ↗
            </a>
            <button
              onClick={() => router.push('/cases' as never)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              ← Cases
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-5xl mx-auto px-8 py-6 space-y-3">

        {/* Client */}
        <Section title="Client">
          <Field label="First Name"  value={c.client_first_name} />
          <Field label="Last Name"   value={c.client_last_name} />
          <Field label="Email"       value={c.client_email} />
          <Field label="Phone"       value={c.client_phone} />
          <Field label="Address"     value={c.client_address} />
          <Field label="State"       value={c.state_jurisdiction} />
        </Section>

        {/* Vehicle */}
        <Section title="Vehicle">
          <Field label="Year"           value={c.vehicle_year} />
          <Field label="Make"           value={c.vehicle_make} />
          <Field label="Model"          value={c.vehicle_model} />
          <Field label="VIN"            value={c.vehicle_vin} mono />
          <Field label="Mileage"        value={c.vehicle_mileage ? c.vehicle_mileage.toLocaleString() + ' mi' : null} />
          <Field label="Condition"      value={c.vehicle_is_new === null ? null : c.vehicle_is_new ? 'New' : 'Used'} />
          <Field label="Purchase Date"  value={c.vehicle_purchase_date} />
          <Field label="Purchase Price" value={c.vehicle_purchase_price ? '$' + c.vehicle_purchase_price.toLocaleString() : null} />
        </Section>

        {/* Case */}
        <Section title="Case">
          <Field label="Status"      value={STATUS_LABELS[c.case_status] ?? c.case_status} />
          <Field label="Type"        value={c.case_type} />
          <Field label="Priority"    value={c.case_priority} />
          <Field label="Est. Value"  value={c.estimated_value ? '$' + c.estimated_value.toLocaleString() : null} />
          <Field label="Settlement"  value={c.settlement_amount ? '$' + c.settlement_amount.toLocaleString() : null} />
          <Field label="Atty Fees"   value={c.attorney_fees ? '$' + c.attorney_fees.toLocaleString() : null} />
          <Field label="Filing Deadline"  value={c.filing_deadline} />
          <Field label="SOL"              value={c.statute_of_limitations} />
          <Field label="HubSpot Deal ID"  value={c.hubspot_deal_id} mono />
        </Section>

        {/* Timeline */}
        <Section title="Timeline">
          <Field label="Created"          value={new Date(c.created_at).toLocaleString()} />
          <Field label="Updated"          value={new Date(c.updated_at).toLocaleString()} />
          <Field label="Intake Completed" value={c.intake_completed_at ? new Date(c.intake_completed_at).toLocaleDateString() : null} />
          <Field label="Review Completed" value={c.review_completed_at ? new Date(c.review_completed_at).toLocaleDateString() : null} />
          <Field label="Filed"            value={c.filed_at ? new Date(c.filed_at).toLocaleDateString() : null} />
          <Field label="Settled"          value={c.settled_at ? new Date(c.settled_at).toLocaleDateString() : null} />
          <Field label="Closed"           value={c.closed_at ? new Date(c.closed_at).toLocaleDateString() : null} />
        </Section>

        {/* Notes */}
        {(c.case_notes || c.internal_notes) && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</h2>
            {c.case_notes && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Case Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.case_notes}</p>
              </div>
            )}
            {c.internal_notes && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Internal Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.internal_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {c.tags && c.tags.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Tags</h2>
            <div className="flex flex-wrap gap-2">
              {c.tags.map(tag => (
                <span key={tag} className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── Intake Accordions ── */}

        {/* Intake Submission */}
        <IntakeSection title="Intake Submission" icon="📋">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <Field label="ELA Intake Status"  value={intake?.ela_intake} />
            <Field label="Intake Management"  value={intake?.intake_management} />
            <Field label="HubSpot Qualifier"  value={intake?.intake_hubspot_qualifier} />
            <Field label="Intake Associate"   value={intake?.intake_associate} />
            <Field label="Had Repairs"        value={intake?.had_repairs == null ? null : intake.had_repairs ? 'Yes' : 'No'} />
            <Field label="Paid for Repairs"   value={intake?.paid_for_repairs} />
            <Field label="Number of Repairs"  value={intake?.repair_count} />
          </div>
        </IntakeSection>

        {/* Vehicle Information */}
        <IntakeSection title="Vehicle Information" icon="🚗">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <Field label="Purchase or Lease"  value={intake?.purchase_or_lease} />
            <Field label="How Purchased"      value={intake?.how_purchased} />
            <Field label="Vehicle Status"     value={intake?.vehicle_status} />
          </div>
        </IntakeSection>

        {/* Issues & Repair History */}
        <IntakeSection title="Issues & Repair History" icon="🔧">
          {/* Problem cards — 2-column grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <IntakeProblem
              n={1}
              category={intake?.problem_1_category ?? null}
              notes={intake?.problem_1_notes ?? null}
              attempts={intake?.problem_1_repair_attempts ?? null}
            />
            <IntakeProblem
              n={2}
              category={intake?.problem_2_category ?? null}
              notes={intake?.problem_2_notes ?? null}
              attempts={intake?.problem_2_repair_attempts ?? null}
            />
            <IntakeProblem
              n={3}
              category={intake?.problem_3_category ?? null}
              notes={intake?.problem_3_notes ?? null}
              attempts={intake?.problem_3_repair_attempts ?? null}
            />
            <IntakeProblem
              n={4}
              category={intake?.problem_4_category ?? null}
              notes={intake?.problem_4_notes ?? null}
              attempts={intake?.problem_4_repair_attempts ?? null}
            />
          </div>

          {/* Summary fields */}
          {(intake?.repair_attempts || intake?.last_repair_attempt_date) && (
            <>
              <div className="border-t border-gray-100 mb-5" />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <Field label="Total Repair Attempts"    value={intake?.repair_attempts} />
                <Field label="Last Repair Attempt Date" value={intake?.last_repair_attempt_date} />
              </div>
            </>
          )}
        </IntakeSection>

        {/* Additional Information */}
        <IntakeSection title="Additional Information" icon="📄">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <Field label="Car in Shop 30+ Days"     value={intake?.in_shop_30_days} />
            <Field label="Contacted Manufacturer"   value={intake?.contacted_manufacturer} />
            <Field label="Manufacturer Offer"       value={intake?.manufacturer_offer} />
            <Field label="Has Repair Documents"     value={intake?.has_repair_documents} />
            <Field label="Refund Preference"        value={intake?.refund_preference} />
          </div>
        </IntakeSection>

        {/* ── Documents ── */}
        <DocumentsSection
          caseId={params.id as string}
          sharePointUrl={c.sharepoint_folder_url}
        />

        {/* ── Communications ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Comm header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Communications</h2>
              {commTotal > 0 && (
                <span className="text-xs text-gray-400 tabular-nums">{commTotal} total</span>
              )}
            </div>

            {/* Channel filter */}
            {commTotal > 0 && (
              <div className="flex gap-1 flex-wrap">
                {[
                  { key: '',      label: 'All' },
                  { key: 'call',  label: `Calls${commCounts.call  ? ` (${commCounts.call})`  : ''}` },
                  { key: 'sms',   label: `SMS${commCounts.sms    ? ` (${commCounts.sms})`    : ''}` },
                  { key: 'email', label: `Email${commCounts.email ? ` (${commCounts.email})` : ''}` },
                  { key: 'note',  label: `Notes${commCounts.note  ? ` (${commCounts.note})`  : ''}` },
                ]
                  .filter(t => t.key === '' || commCounts[t.key])
                  .map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setCommChannel(tab.key)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                        commChannel === tab.key
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Comm list */}
          {commsLoading ? (
            <div className="py-12 text-center text-gray-400 text-sm">Loading communications…</div>
          ) : comms.length === 0 ? (
            <div className="py-12 text-center space-y-1">
              <p className="text-gray-400 text-sm">No communications synced yet</p>
              <p className="text-gray-300 text-xs font-mono">sync-hubspot-comms.mjs --deal-id={c.hubspot_deal_id}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {comms.map(comm => (
                <CommRow key={comm.id} comm={comm} />
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
