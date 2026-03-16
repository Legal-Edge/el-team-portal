'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

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
  is_internal: boolean
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

// ── SMS Compose box ────────────────────────────────────────────────────────
function SmsCompose({ caseId, onSent }: { caseId: string; onSent: () => void }) {
  const [text, setText]       = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const MAX = 160

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases/${caseId}/sms`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Send failed')
      } else {
        setText('')
        // Webhook captures the outbound — refresh comms after short delay
        setTimeout(onSent, 2500)
      }
    } catch {
      setError('Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
      <div className="flex items-end gap-3">
        <div className="flex-1 relative">
          <textarea
            value={text}
            onChange={e => setText(e.target.value.slice(0, MAX))}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Send an SMS to client…"
            rows={2}
            className="w-full text-sm rounded-xl border border-gray-200 bg-white px-4 py-2.5 pr-16 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
          />
          <span className={`absolute bottom-2.5 right-3 text-xs tabular-nums ${
            text.length > MAX * 0.9 ? 'text-orange-400' : 'text-gray-300'
          }`}>
            {text.length}/{MAX}
          </span>
        </div>
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
    </div>
  )
}

// ── SMS bubble renderer ────────────────────────────────────────────────────
function SmsBubble({ comm }: { comm: Comm }) {
  const isOutbound = comm.direction === 'outbound'
  const time = comm.occurred_at
    ? new Date(comm.occurred_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : '—'

  return (
    <div className={`px-6 py-2 flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-sm flex flex-col ${isOutbound ? 'items-end' : 'items-start'} gap-0.5`}>

        {/* Bubble */}
        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isOutbound
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-gray-100 text-gray-800 rounded-bl-md'
        }`}>
          {comm.body || comm.snippet || '—'}
        </div>

        {/* Meta — time + phone */}
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-gray-400">{time}</span>
          {comm.from_number && (
            <span className="text-xs text-gray-300">
              {isOutbound ? comm.from_number : comm.from_number}
            </span>
          )}
          {comm.needs_review && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">⚠ Review</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Standard card renderer (calls, emails, notes, tasks) ───────────────────
function CommCard({ comm }: { comm: Comm }) {
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
  const hasContent  = !!fullContent

  return (
    <div className={`px-6 py-4 transition-colors ${
      comm.is_internal    ? 'bg-purple-50/40 border-l-4 border-l-purple-300' :
      comm.needs_review   ? 'border-l-4 border-l-yellow-400' : ''
    }`}>
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
              {comm.is_internal && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">🔒 Internal</span>
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
            {(comm.from_number || comm.to_number) && comm.channel !== 'sms' && (
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
              <a href={comm.recording_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline">Listen ↗</a>
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

// ── CommRow — routes to correct renderer by channel ────────────────────────
function CommRow({ comm }: { comm: Comm }) {
  if (comm.channel === 'sms') return <SmsBubble comm={comm} />
  return <CommCard comm={comm} />
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

// ── is_required + status → visual state ──────────────────────────────────
// ALARM  = is_required=true  AND status not yet satisfied
// ACTIVE = status has real activity (received/review/approved) regardless of is_required
// SILENT = is_required=false AND status has no activity (slot exists, not required now)

type RowDisplay = 'alarm' | 'active' | 'silent'

function rowDisplay(item: ChecklistItem): RowDisplay {
  const satisfied = ['received', 'under_review', 'approved', 'waived'].includes(item.status)
  if (satisfied) return 'active'
  if (item.is_required) return 'alarm'
  return 'silent'
}

// Icon reflects status activity — NOT is_required
const STATUS_ICON: Record<string, string> = {
  required:     '○',   // no-activity state; alarm driven by is_required, not this icon
  requested:    '⏳',
  received:     '📄',
  under_review: '🔍',
  approved:     '✅',
  rejected:     '⚠️',
  waived:       '—',
}

// Badge colour reflects status activity
const STATUS_BADGE: Record<string, string> = {
  required:     'bg-gray-100 text-gray-500',      // neutral — not alarming by default
  requested:    'bg-yellow-50 text-yellow-700',
  received:     'bg-blue-50 text-blue-700',
  under_review: 'bg-purple-50 text-purple-700',
  approved:     'bg-green-50 text-green-700',
  rejected:     'bg-orange-50 text-orange-700',
  waived:       'bg-gray-50 text-gray-400',
}

// Human-readable status labels that don't leak the stored value to staff
const STATUS_LABEL: Record<string, string> = {
  required:     'not started',
  requested:    'requested',
  received:     'received',
  under_review: 'under review',
  approved:     'approved',
  rejected:     'rejected',
  waived:       'waived',
}

function formatBytes(bytes: number | null) {
  if (!bytes) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─── Collapsible checklist row ─────────────────────────────────────────────
function ChecklistRow({ item }: { item: ChecklistItem }) {
  const display = rowDisplay(item)
  const [expanded, setExpanded] = useState(item.files.length > 0)
  const hasFiles = item.files.length > 0

  // Row-level visual treatment
  const rowBg =
    display === 'alarm'  ? 'bg-red-50/40' :
    display === 'silent' ? 'bg-gray-50/30' :
    ''

  // Icon: alarm rows get the ❌, others use status-based icon
  const icon =
    display === 'alarm'
      ? '❌'
      : STATUS_ICON[item.status] ?? '○'

  // Label: never show the raw stored value 'required' — show 'not started' instead
  const statusLabel = STATUS_LABEL[item.status] ?? item.status.replace('_', ' ')

  // Badge: alarm rows get red; others use status-based color
  const badgeClass =
    display === 'alarm'
      ? 'bg-red-100 text-red-700'
      : STATUS_BADGE[item.status] ?? 'bg-gray-100 text-gray-500'

  // Silent rows (not required, no activity) are visually de-emphasized
  const labelClass = display === 'silent' ? 'text-gray-400' : 'text-gray-800'

  return (
    <div className={`px-6 py-3.5 ${rowBg}`}>
      <div
        className={`flex items-center justify-between gap-4 ${hasFiles ? 'cursor-pointer select-none' : ''}`}
        onClick={() => hasFiles && setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className="text-sm shrink-0 w-5 text-center">{icon}</span>

          <span className={`text-sm font-medium ${labelClass}`}>
            {item.type?.label ?? item.document_type_code}
          </span>

          {/* Status badge — uses human label, never leaks stored 'required' value */}
          {display !== 'silent' && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
              {statusLabel}
            </span>
          )}

          {/* Required tag — only when is_required=true and not yet satisfied */}
          {display === 'alarm' && (
            <span className="text-xs font-medium text-red-500">required this stage</span>
          )}

          {/* File count chip */}
          {hasFiles && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
              {item.files.length} file{item.files.length !== 1 ? 's' : ''}
            </span>
          )}

          {/* Silent rows: soft label so staff know the slot is available */}
          {display === 'silent' && !hasFiles && (
            <span className="text-xs text-gray-300">available if needed</span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right text-xs text-gray-300">
            {item.received_at && <p>{new Date(item.received_at).toLocaleDateString()}</p>}
            {item.approved_at && <p>Approved {new Date(item.approved_at).toLocaleDateString()}</p>}
          </div>
          {hasFiles && (
            <span
              className={`text-gray-400 text-lg leading-none inline-block transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            >
              ›
            </span>
          )}
        </div>
      </div>

      {/* Expanded file list */}
      {expanded && hasFiles && (
        <div className="mt-2.5 ml-8 space-y-1.5">
          {item.files.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs text-gray-500">
              <span className="shrink-0">📎</span>
              <span className="truncate max-w-sm">{f.name}</span>
              {f.size_bytes && <span className="text-gray-300 shrink-0">{formatBytes(f.size_bytes)}</span>}
              {f.web_url && (
                <a
                  href={f.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline shrink-0"
                  onClick={e => e.stopPropagation()}
                >
                  Open ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {item.notes && (
        <p className="text-xs text-gray-400 mt-1 ml-8 italic">{item.notes}</p>
      )}
    </div>
  )
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
  const [classifying, setClassifying] = useState<string | null>(null)
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

  // Build a map of doc type → how many files are already linked (for classify dropdown hints)
  const fileCountByType: Record<string, number> = {}
  checklist.forEach(item => {
    if (item.files.length > 0) fileCountByType[item.document_type_code] = item.files.length
  })

  // The type label the user is about to classify into (for the inline hint)
  const selectedTypeItem = classifyType
    ? checklist.find(i => i.document_type_code === classifyType)
    : null
  const selectedTypeExistingCount = selectedTypeItem?.files.length ?? 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Documents</h2>
          {stats && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {stats.approved > 0     && <span className="text-green-600">✅ {stats.approved} approved</span>}
              {stats.received > 0     && <span className="text-blue-600">📄 {stats.received} received</span>}
              {/* Only alarm rows count as missing — is_required=true and not satisfied */}
              {checklist.filter(i => rowDisplay(i) === 'alarm').length > 0 && (
                <span className="text-red-500">❌ {checklist.filter(i => rowDisplay(i) === 'alarm').length} missing</span>
              )}
              {stats.unclassified > 0 && <span className="text-yellow-600">📎 {stats.unclassified} unclassified</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sharePointUrl && (
            <a href={sharePointUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline">
              Open folder ↗
            </a>
          )}
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
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
        <div className="divide-y divide-gray-100">

          {/* Checklist items */}
          {checklist.map(item => (
            <ChecklistRow key={item.id} item={item} />
          ))}

          {/* Unclassified files */}
          {unclassified.length > 0 && (
            <div className="px-6 py-5 bg-amber-50/50">
              {/* Section header with explanation */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  Unclassified Files ({unclassified.length})
                </p>
                <p className="text-xs text-amber-600/80 mt-0.5">
                  Link each file to a document type. Multiple files can belong to the same type — e.g. several repair orders all link to Repair Orders.
                </p>
              </div>

              <div className="space-y-3">
                {unclassified.map(f => (
                  <div key={f.id} className="rounded-lg bg-white border border-amber-100 px-4 py-3">
                    {/* File info row */}
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <span className="text-sm text-gray-800 font-medium min-w-0 truncate max-w-sm">{f.name}</span>
                      {f.size_bytes && <span className="text-xs text-gray-400 shrink-0">{formatBytes(f.size_bytes)}</span>}
                      {f.web_url && (
                        <a href={f.web_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline shrink-0">
                          Open ↗
                        </a>
                      )}
                    </div>

                    {/* Classify action */}
                    {classifying === f.id ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white flex-1 min-w-[180px]"
                            value={classifyType}
                            onChange={e => setClassifyType(e.target.value)}
                          >
                            <option value="">Select document type…</option>
                            {docTypes.map(t => {
                              const existing = fileCountByType[t.code] ?? 0
                              return (
                                <option key={t.code} value={t.code}>
                                  {t.label}{existing > 0 ? ` (${existing} already linked)` : ''}
                                </option>
                              )
                            })}
                          </select>
                          <button
                            onClick={() => classifyType && classify(f.id, classifyType)}
                            disabled={!classifyType || saving}
                            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg disabled:opacity-40 shrink-0"
                          >
                            {saving ? 'Saving…' : 'Link file'}
                          </button>
                          <button
                            onClick={() => { setClassifying(null); setClassifyType('') }}
                            className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                          >
                            Cancel
                          </button>
                        </div>
                        {/* Contextual hint when an already-linked type is selected */}
                        {selectedTypeExistingCount > 0 && classifyType && (
                          <p className="text-xs text-blue-600">
                            ↳ Will add to {selectedTypeItem?.type?.label ?? classifyType} — already has {selectedTypeExistingCount} file{selectedTypeExistingCount !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => { setClassifying(f.id); setClassifyType('') }}
                        className="text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
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
  const [canSeeInternal, setCanSeeInternal] = useState(false)
  const [userCanSms, setUserCanSms] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [statusFlash, setStatusFlash] = useState(false)
  const [intakeStatus, setIntakeStatus] = useState<string | null>(null)
  const [intakeSaving, setIntakeSaving] = useState(false)
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('staff')
  const [staffId, setStaffId] = useState<string | null>(null)

  // ── Notes state ──────────────────────────────────────────────────────────
  interface TimelineNote {
    id: string; note_type: string; visibility: string; body: string
    is_pinned: boolean; created_at: string; author_id: string
    author_name: string; is_mine: boolean
  }
  const [notes, setNotes] = useState<TimelineNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteBody, setNoteBody] = useState('')
  const [noteType, setNoteType] = useState('general')
  const [noteVisibility, setNoteVisibility] = useState('internal')
  const [notePinned, setNotePinned] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as 'overview' | 'comms' | 'documents' | 'intake') ?? 'overview'
  const [activeTab, setActiveTab] = useState<'overview' | 'comms' | 'documents' | 'intake'>(initialTab)
  const esRef = useRef<EventSource | null>(null)

  // ── Intake status transitions ────────────────────────────────────────────
  const INTAKE_STATUS_LABELS: Record<string, string> = {
    not_started:            'Not Started',
    intake_batch_1_needed:  'Batch 1 Needed',
    intake_batch_2_needed:  'Batch 2 Needed',
    intake_batch_3_needed:  'Batch 3 Needed',
    intake_batch_4_needed:  'Batch 4 Needed',
    intake_batch_5_needed:  'Batch 5 Needed',
    intake_batch_6_needed:  'Batch 6 Needed',
    intake_batch_7_needed:  'Batch 7 Needed',
    intake_under_review:    'Under Review',
    intake_docs_needed:     'Docs Needed',
    intake_attorney_review: 'Attorney Review',
    intake_case_approved:   'Case Approved',
    legal_case_active:      'Case Active',
    legal_case_resolved:    'Case Resolved',
  }
  const ALL_INTAKE_STATUSES = Object.keys(INTAKE_STATUS_LABELS)
  // Staff-controlled transitions (what can be selected from current status)
  const TRANSITIONS: Record<string, string[]> = {
    not_started:            ['intake_under_review'],
    intake_batch_1_needed:  ['intake_under_review'],
    intake_batch_2_needed:  ['intake_under_review'],
    intake_batch_3_needed:  ['intake_under_review'],
    intake_batch_4_needed:  ['intake_under_review'],
    intake_batch_5_needed:  ['intake_under_review'],
    intake_batch_6_needed:  ['intake_under_review'],
    intake_batch_7_needed:  ['intake_under_review'],
    intake_under_review:    ['intake_docs_needed', 'intake_attorney_review'],
    intake_docs_needed:     ['intake_under_review', 'intake_attorney_review'],
    intake_attorney_review: ['intake_case_approved', 'intake_docs_needed'],
    intake_case_approved:   ['legal_case_active'],
    legal_case_active:      ['legal_case_resolved'],
    legal_case_resolved:    [],
  }
  const INTAKE_STATUS_COLOR: Record<string, string> = {
    not_started:            'bg-gray-100 text-gray-500',
    intake_under_review:    'bg-blue-50 text-blue-700',
    intake_docs_needed:     'bg-orange-50 text-orange-700',
    intake_attorney_review: 'bg-purple-50 text-purple-700',
    intake_case_approved:   'bg-green-50 text-green-700',
    legal_case_active:      'bg-emerald-50 text-emerald-700',
    legal_case_resolved:    'bg-gray-100 text-gray-500',
  }
  function intakeBadgeColor(status: string): string {
    if (status.startsWith('intake_batch_')) return 'bg-yellow-50 text-yellow-700'
    return INTAKE_STATUS_COLOR[status] ?? 'bg-gray-100 text-gray-500'
  }

  const canUpdateIntake = ['admin', 'attorney', 'manager'].includes(userRole)
  const allowedTransitions = intakeStatus
    ? (userRole === 'admin' ? ALL_INTAKE_STATUSES.filter(s => s !== intakeStatus) : (TRANSITIONS[intakeStatus] ?? []))
    : []

  // ── Notes helpers ────────────────────────────────────────────────────────
  const NOTE_TYPE_LABELS: Record<string, string> = {
    general: 'General', call_summary: 'Call Summary', verbal_update: 'Verbal Update',
    attorney_note: 'Attorney Note', case_manager_note: 'Case Manager Note',
    milestone: 'Milestone', client_communication: 'Client Communication', intake_note: 'Intake Note',
  }
  const VISIBILITY_CONFIG: Record<string, { label: string; cls: string; icon: string }> = {
    public:     { label: 'Public',     cls: 'bg-green-50 text-green-700',  icon: '🌐' },
    internal:   { label: 'Internal',   cls: 'bg-blue-50 text-blue-700',    icon: '👥' },
    restricted: { label: 'Restricted', cls: 'bg-orange-50 text-orange-700', icon: '🔒' },
    private:    { label: 'Private',    cls: 'bg-purple-50 text-purple-700', icon: '👤' },
  }
  function fmtNoteTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000)
    if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`; return `${d}d ago`
  }

  async function loadNotes() {
    if (!params.id) return
    setNotesLoading(true)
    try {
      const res = await fetch(`/api/cases/${params.id}/notes`)
      if (res.ok) { const d = await res.json(); setNotes(d.notes ?? []) }
    } finally { setNotesLoading(false) }
  }

  async function handleCreateNote() {
    if (!noteBody.trim()) return
    setNoteSaving(true); setNoteError(null)
    try {
      const res = await fetch(`/api/cases/${params.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_type: noteType, visibility: noteVisibility, body: noteBody, is_pinned: notePinned }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setNoteError(e.error ?? 'Failed to create note')
      } else {
        const d = await res.json()
        setNotes(prev => [d.note, ...prev])
        setNoteBody(''); setNoteType('general'); setNoteVisibility('internal')
        setNotePinned(false); setShowNoteForm(false)
      }
    } finally { setNoteSaving(false) }
  }

  async function handleTogglePin(noteId: string, currentPinned: boolean) {
    const newPinned = !currentPinned
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, is_pinned: newPinned } : n))
    try {
      const res = await fetch(`/api/cases/${params.id}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: newPinned }),
      })
      if (!res.ok) setNotes(prev => prev.map(n => n.id === noteId ? { ...n, is_pinned: currentPinned } : n))
      else setNotes(prev => [...prev].sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)))
    } catch {
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, is_pinned: currentPinned } : n))
    }
  }

  const canManageNotes = ['admin', 'attorney', 'manager'].includes(userRole)

  async function handleIntakeStatusChange(newStatus: string) {
    if (!caseData || !newStatus || newStatus === intakeStatus) return
    const prev = intakeStatus
    setIntakeStatus(newStatus)   // optimistic
    setIntakeSaving(true)
    setIntakeError(null)
    try {
      const res = await fetch(`/api/cases/${caseData.hubspot_deal_id}/intake-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setIntakeStatus(prev)   // revert
        setIntakeError(err.error ?? 'Failed to update intake status')
      }
    } catch {
      setIntakeStatus(prev)
      setIntakeError('Network error — status not saved')
    } finally {
      setIntakeSaving(false)
    }
  }

  // Update tab title when client name loads
  useEffect(() => {
    if (!caseData) return
    const name = [caseData.client_first_name, caseData.client_last_name].filter(Boolean).join(' ') || 'Unknown Client'
    document.title = `${name} | Team Portal`
    return () => { document.title = 'Team Portal' }
  }, [caseData])

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/cases/${params.id}`)
      if (res.status === 404) { setNotFound(true); setLoading(false); return }
      if (res.ok) {
        const data = await res.json()
        setCaseData(data.case)
        setIntake(data.intake ?? null)
        setIntakeStatus(data.intakeStatus ?? null)
        setUserRole(data.userRole ?? 'staff')
        setStaffId(data.staffId ?? null)
      }
      setLoading(false)
    }
    load()
  }, [params.id])

  // SSE subscription — live updates for this specific case
  useEffect(() => {
    if (!params.id) return
    const es = new EventSource(`/api/cases/stream?id=${params.id}`)
    esRef.current = es

    es.addEventListener('connected', () => setIsLive(true))
    es.onerror = () => setIsLive(false)

    es.addEventListener('case', (e: MessageEvent) => {
      const payload = JSON.parse(e.data) as { type: string; new: CaseDetail | null }
      if (payload.type === 'UPDATE' && payload.new) {
        setCaseData(prev => prev ? { ...prev, ...payload.new! } : payload.new)
        setStatusFlash(true)
        setTimeout(() => setStatusFlash(false), 1500)
      }
    })

    return () => { es.close(); setIsLive(false) }
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
      setCanSeeInternal(data.canSeeInternal ?? false)
      // Staff can't send SMS (enforced server-side too; this is just UI gating)
      setUserCanSms(data.canSeeInternal ?? false)
    }
    setCommsLoading(false)
  }, [params.id])

  useEffect(() => { loadComms(commChannel) }, [commChannel, loadComms])
  // Load notes when comms tab opens (or on initial mount)
  useEffect(() => {
    if (activeTab === 'comms' && notes.length === 0 && !notesLoading) loadNotes()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

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

  function fmtDate(d: string | null) {
    if (!d) return null
    const [y, m, day] = d.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const TABS = [
    { id: 'overview',   label: 'Overview'   },
    { id: 'comms',      label: `Comms${commTotal > 0 ? ` (${commTotal})` : ''}` },
    { id: 'documents',  label: 'Documents'  },
    { id: 'intake',     label: 'Intake'     },
  ] as const

  return (
    <div className="p-8 max-w-screen-xl mx-auto">

      {/* ── Page header ── */}
      <div className="mb-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-3">
          <a href="/cases" className="hover:text-gray-600 transition-colors">← Cases</a>
          <span>/</span>
          <span className="text-gray-600">{clientName}</span>
        </div>

        {/* Title + status */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-gray-900">{clientName}</h1>
          <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full transition-all duration-700 ${
            statusFlash
              ? 'bg-yellow-100 text-yellow-800 ring-2 ring-yellow-300'
              : STATUS_COLORS[c.case_status] ?? STATUS_COLORS.unknown
          }`}>
            {STATUS_LABELS[c.case_status] ?? c.case_status}
          </span>
          <span className={`inline-flex items-center gap-1 text-xs transition-all duration-500 ${isLive ? 'text-emerald-500' : 'text-gray-300'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            {isLive ? 'Live' : ''}
          </span>
        </div>
        <p className="text-sm text-gray-400 mt-1">{vehicle}</p>
      </div>

      {/* ── Two-column layout ── */}
      <div className="flex gap-6 items-start">

        {/* ── Left: tabs + content ── */}
        <div className="flex-1 min-w-0">

          {/* Tab bar */}
          <div className="flex gap-0 border-b border-gray-100 mb-5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 -mb-px border-b-2 ${
                  activeTab === tab.id
                    ? 'text-gray-900 border-lemon-400'
                    : 'text-gray-400 border-transparent hover:text-gray-700 hover:border-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Overview tab ── */}
          {activeTab === 'overview' && (
            <div className="space-y-4">

              {/* Client + Vehicle side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Client card */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5 space-y-3">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Client</h3>
                  <div className="space-y-2.5">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Name</p>
                      <p className="text-sm font-medium text-gray-900">{clientName}</p>
                    </div>
                    {c.client_phone && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Phone</p>
                        <a href={`tel:${c.client_phone}`} className="text-sm font-medium text-gray-900 hover:text-lemon-500 transition-colors">
                          {c.client_phone}
                        </a>
                      </div>
                    )}
                    {c.client_email && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Email</p>
                        <a href={`mailto:${c.client_email}`} className="text-sm text-gray-900 hover:text-lemon-500 transition-colors truncate block">
                          {c.client_email}
                        </a>
                      </div>
                    )}
                    {c.state_jurisdiction && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">State</p>
                        <p className="text-sm text-gray-900">{c.state_jurisdiction}</p>
                      </div>
                    )}
                    {c.client_address && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Address</p>
                        <p className="text-sm text-gray-900">{c.client_address}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Vehicle card */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5 space-y-3">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Vehicle</h3>
                  <div className="space-y-2.5">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Vehicle</p>
                      <p className="text-sm font-medium text-gray-900">{vehicle || '—'}</p>
                    </div>
                    {c.vehicle_vin && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">VIN</p>
                        <p className="text-sm font-mono text-gray-900">{c.vehicle_vin}</p>
                      </div>
                    )}
                    {c.vehicle_mileage && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Mileage</p>
                        <p className="text-sm text-gray-900">{c.vehicle_mileage.toLocaleString()} mi</p>
                      </div>
                    )}
                    {c.vehicle_is_new !== null && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Condition</p>
                        <p className="text-sm text-gray-900">{c.vehicle_is_new ? 'New' : 'Used'}</p>
                      </div>
                    )}
                    {c.vehicle_purchase_date && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Purchase Date</p>
                        <p className="text-sm text-gray-900">{fmtDate(c.vehicle_purchase_date)}</p>
                      </div>
                    )}
                    {c.vehicle_purchase_price && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Purchase Price</p>
                        <p className="text-sm text-gray-900">${c.vehicle_purchase_price.toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Case details */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Case Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                  <Field label="Type"           value={c.case_type} />
                  <Field label="Priority"       value={c.case_priority} />
                  <Field label="Est. Value"     value={c.estimated_value ? '$' + c.estimated_value.toLocaleString() : null} />
                  <Field label="Settlement"     value={c.settlement_amount ? '$' + c.settlement_amount.toLocaleString() : null} />
                  <Field label="Attorney Fees"  value={c.attorney_fees ? '$' + c.attorney_fees.toLocaleString() : null} />
                  <Field label="Filing Deadline" value={fmtDate(c.filing_deadline)} />
                  <Field label="SOL"            value={fmtDate(c.statute_of_limitations)} />
                  <Field label="HubSpot Deal"   value={c.hubspot_deal_id} mono />
                </div>
              </div>

              {/* Timeline */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Timeline</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                  <Field label="Created"          value={fmtDate(c.created_at)} />
                  <Field label="Last Updated"     value={fmtDate(c.updated_at)} />
                  <Field label="Intake Completed" value={fmtDate(c.intake_completed_at)} />
                  <Field label="Review Completed" value={fmtDate(c.review_completed_at)} />
                  <Field label="Filed"            value={fmtDate(c.filed_at)} />
                  <Field label="Settled"          value={fmtDate(c.settled_at)} />
                  <Field label="Closed"           value={fmtDate(c.closed_at)} />
                </div>
              </div>

              {/* Notes */}
              {(c.case_notes || c.internal_notes) && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5 space-y-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Notes</h3>
                  {c.case_notes && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Case Notes</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.case_notes}</p>
                    </div>
                  )}
                  {c.internal_notes && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Internal Notes</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.internal_notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Tags */}
              {c.tags && c.tags.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {c.tags.map(tag => (
                      <span key={tag} className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Comms tab ── */}
          {activeTab === 'comms' && (
            <>
            {/* ── Timeline Notes ── */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden">
              {/* Notes header */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Notes</span>
                  {notes.length > 0 && <span className="text-xs text-gray-400 tabular-nums">{notes.length}</span>}
                </div>
                <button
                  onClick={() => { setShowNoteForm(v => !v); setNoteError(null) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-lemon-400 hover:bg-lemon-500 text-gray-900 transition-all active:scale-95"
                >
                  <span>{showNoteForm ? '✕ Cancel' : '+ Add Note'}</span>
                </button>
              </div>

              {/* Add Note form */}
              {showNoteForm && (
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 font-medium block mb-1">Type</label>
                      <select
                        value={noteType}
                        onChange={e => setNoteType(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
                      >
                        {Object.entries(NOTE_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 font-medium block mb-1">Visibility</label>
                      <select
                        value={noteVisibility}
                        onChange={e => setNoteVisibility(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400"
                      >
                        <option value="internal">Internal (team)</option>
                        <option value="public">Public</option>
                        {canManageNotes && <option value="restricted">Restricted (admin/attorney/manager)</option>}
                        <option value="private">Private (only me)</option>
                      </select>
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={notePinned}
                          onChange={e => setNotePinned(e.target.checked)}
                          className="w-3.5 h-3.5 accent-yellow-400"
                        />
                        Pin
                      </label>
                    </div>
                  </div>
                  <textarea
                    value={noteBody}
                    onChange={e => setNoteBody(e.target.value)}
                    placeholder="Write a note…"
                    rows={3}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-lemon-400 resize-none"
                  />
                  {noteError && <p className="text-xs text-red-500">{noteError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setShowNoteForm(false); setNoteBody(''); setNoteError(null) }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateNote}
                      disabled={noteSaving || !noteBody.trim()}
                      className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition-all active:scale-95"
                    >
                      {noteSaving ? 'Saving…' : 'Save Note'}
                    </button>
                  </div>
                </div>
              )}

              {/* Notes list */}
              {notesLoading ? (
                <div className="py-8 text-center text-gray-400 text-sm">Loading notes…</div>
              ) : notes.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">No notes yet</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {notes.map(note => {
                    const vis   = VISIBILITY_CONFIG[note.visibility] ?? VISIBILITY_CONFIG.internal
                    const pinCan = canManageNotes || note.is_mine
                    return (
                      <div
                        key={note.id}
                        className={`px-6 py-4 group transition-colors hover:bg-gray-50 ${note.is_pinned ? 'border-l-2 border-l-yellow-400' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Badges row */}
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              {note.is_pinned && (
                                <span className="text-yellow-500 text-xs font-medium">📌 Pinned</span>
                              )}
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                {NOTE_TYPE_LABELS[note.note_type] ?? note.note_type}
                              </span>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${vis.cls}`}>
                                <span>{vis.icon}</span>
                                {vis.label}
                              </span>
                            </div>
                            {/* Body */}
                            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{note.body}</p>
                            {/* Meta */}
                            <p className="mt-2 text-xs text-gray-400">
                              {note.author_name} · {fmtNoteTime(note.created_at)}
                            </p>
                          </div>
                          {/* Pin toggle */}
                          {pinCan && (
                            <button
                              onClick={() => handleTogglePin(note.id, note.is_pinned)}
                              title={note.is_pinned ? 'Unpin' : 'Pin'}
                              className="opacity-0 group-hover:opacity-100 shrink-0 text-gray-300 hover:text-yellow-500 transition-all"
                            >
                              {note.is_pinned ? '📌' : '☆'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Communications ── */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden">
              {/* Comm header */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Communications</span>
                  {commTotal > 0 && <span className="text-xs text-gray-400 tabular-nums">{commTotal} total</span>}
                  {canSeeInternal && <span className="text-xs text-purple-500 font-medium">🔒 = internal only</span>}
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
                          className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-150 active:scale-95 ${
                            commChannel === tab.key
                              ? 'bg-lemon-400 text-gray-900'
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
                <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
              ) : comms.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-gray-400 text-sm">No communications synced yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {comms.map(comm => <CommRow key={comm.id} comm={comm} />)}
                </div>
              )}
              {/* SMS compose */}
              {userCanSms && commCounts.sms > 0 && (commChannel === '' || commChannel === 'sms') && (
                <SmsCompose caseId={params.id as string} onSent={() => loadComms(commChannel)} />
              )}
            </div>
            </>
          )}

          {/* ── Documents tab ── */}
          {activeTab === 'documents' && (
            <DocumentsSection
              caseId={params.id as string}
              sharePointUrl={c.sharepoint_folder_url}
            />
          )}

          {/* ── Intake tab ── */}
          {activeTab === 'intake' && (
            <div className="space-y-3">
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
              <IntakeSection title="Vehicle Information" icon="🚗">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                  <Field label="Purchase or Lease" value={intake?.purchase_or_lease} />
                  <Field label="How Purchased"     value={intake?.how_purchased} />
                  <Field label="Vehicle Status"    value={intake?.vehicle_status} />
                </div>
              </IntakeSection>
              <IntakeSection title="Issues & Repair History" icon="🔧">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                  <IntakeProblem n={1} category={intake?.problem_1_category ?? null} notes={intake?.problem_1_notes ?? null} attempts={intake?.problem_1_repair_attempts ?? null} />
                  <IntakeProblem n={2} category={intake?.problem_2_category ?? null} notes={intake?.problem_2_notes ?? null} attempts={intake?.problem_2_repair_attempts ?? null} />
                  <IntakeProblem n={3} category={intake?.problem_3_category ?? null} notes={intake?.problem_3_notes ?? null} attempts={intake?.problem_3_repair_attempts ?? null} />
                  <IntakeProblem n={4} category={intake?.problem_4_category ?? null} notes={intake?.problem_4_notes ?? null} attempts={intake?.problem_4_repair_attempts ?? null} />
                </div>
                {(intake?.repair_attempts || intake?.last_repair_attempt_date) && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-5 border-t border-gray-100 pt-5">
                    <Field label="Total Repair Attempts"    value={intake?.repair_attempts} />
                    <Field label="Last Repair Attempt Date" value={intake?.last_repair_attempt_date} />
                  </div>
                )}
              </IntakeSection>
              <IntakeSection title="Additional Information" icon="📄">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                  <Field label="Car in Shop 30+ Days"   value={intake?.in_shop_30_days} />
                  <Field label="Contacted Manufacturer" value={intake?.contacted_manufacturer} />
                  <Field label="Manufacturer Offer"     value={intake?.manufacturer_offer} />
                  <Field label="Has Repair Documents"   value={intake?.has_repair_documents} />
                  <Field label="Refund Preference"      value={intake?.refund_preference} />
                </div>
              </IntakeSection>
            </div>
          )}
        </div>

        {/* ── Right: sticky sidebar ── */}
        <div className="w-64 shrink-0 sticky top-6 space-y-4">

          {/* Status card */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Case Status</p>
            <span className={`inline-flex px-3 py-1 text-sm font-medium rounded-full transition-all duration-700 ${
              statusFlash
                ? 'bg-yellow-100 text-yellow-800 ring-2 ring-yellow-300'
                : STATUS_COLORS[c.case_status] ?? STATUS_COLORS.unknown
            }`}>
              {STATUS_LABELS[c.case_status] ?? c.case_status}
            </span>
            <div className="mt-3 space-y-1.5 text-xs text-gray-400">
              <div className="flex justify-between">
                <span>Added</span>
                <span className="text-gray-600">{fmtDate(c.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span>Updated</span>
                <span className="text-gray-600">{fmtDate(c.updated_at)}</span>
              </div>
              {c.filed_at && (
                <div className="flex justify-between">
                  <span>Filed</span>
                  <span className="text-gray-600">{fmtDate(c.filed_at)}</span>
                </div>
              )}
              {c.settled_at && (
                <div className="flex justify-between">
                  <span>Settled</span>
                  <span className="text-gray-600">{fmtDate(c.settled_at)}</span>
                </div>
              )}
              {c.closed_at && (
                <div className="flex justify-between">
                  <span>Closed</span>
                  <span className="text-gray-600">{fmtDate(c.closed_at)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Intake Status */}
          {intakeStatus && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Intake Status</p>
              <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full ${intakeBadgeColor(intakeStatus)}`}>
                {INTAKE_STATUS_LABELS[intakeStatus] ?? intakeStatus}
              </span>

              {canUpdateIntake && allowedTransitions.length > 0 && (
                <div className="mt-3">
                  <select
                    value=""
                    disabled={intakeSaving}
                    onChange={e => { if (e.target.value) handleIntakeStatusChange(e.target.value) }}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-lemon-400 disabled:opacity-50"
                  >
                    <option value="">
                      {intakeSaving ? 'Saving…' : 'Move to…'}
                    </option>
                    {allowedTransitions.map(s => (
                      <option key={s} value={s}>{INTAKE_STATUS_LABELS[s] ?? s}</option>
                    ))}
                  </select>
                </div>
              )}

              {intakeError && (
                <p className="mt-2 text-xs text-red-500">{intakeError}</p>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</p>
            <div className="space-y-2">
              {c.client_phone && (
                <a
                  href={`tel:${c.client_phone}`}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 hover:bg-lemon-400/20 hover:text-gray-900 transition-all duration-150 active:scale-95"
                >
                  <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
                  Call client
                </a>
              )}
              {c.client_email && (
                <a
                  href={`mailto:${c.client_email}`}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 hover:bg-lemon-400/20 hover:text-gray-900 transition-all duration-150 active:scale-95"
                >
                  <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                  Email client
                </a>
              )}
              <a
                href={`https://app.hubspot.com/contacts/47931752/deal/${c.hubspot_deal_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 hover:bg-orange-50 hover:text-orange-700 transition-all duration-150 active:scale-95"
              >
                <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                Open in HubSpot
              </a>
              {c.sharepoint_folder_url && (
                <a
                  href={c.sharepoint_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 transition-all duration-150 active:scale-95"
                >
                  <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
                  SharePoint folder
                </a>
              )}
              <button
                onClick={() => setActiveTab('comms')}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-all duration-150 active:scale-95"
              >
                <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                View comms {commTotal > 0 && `(${commTotal})`}
              </button>
            </div>
          </div>

          {/* Case meta */}
          {(c.estimated_value || c.case_type || c.case_priority) && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-card p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Details</p>
              <div className="space-y-2 text-xs">
                {c.estimated_value && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Est. Value</span>
                    <span className="font-semibold text-gray-900">${c.estimated_value.toLocaleString()}</span>
                  </div>
                )}
                {c.settlement_amount && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Settlement</span>
                    <span className="font-semibold text-emerald-700">${c.settlement_amount.toLocaleString()}</span>
                  </div>
                )}
                {c.case_type && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Type</span>
                    <span className="text-gray-700">{c.case_type}</span>
                  </div>
                )}
                {c.case_priority && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Priority</span>
                    <span className="text-gray-700">{c.case_priority}</span>
                  </div>
                )}
                {c.state_jurisdiction && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">State</span>
                    <span className="text-gray-700">{c.state_jurisdiction}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
