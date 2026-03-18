'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter, useSearchParams }    from 'next/navigation'
import { createClient as sbCreate }                  from '@supabase/supabase-js'
import TasksSection                                  from '@/components/case/TasksSection'

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
// Sanitize literal \n / \r\n sequences stored by HubSpot as escaped text
function cleanStr(v: string | null | undefined): string | null {
  if (!v) return null
  return v.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').trim() || null
}
// Apply cleanStr to all string fields on a case or intake object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanRecord<T extends Record<string, any>>(obj: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = { ...obj }
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') {
      result[key] = cleanStr(result[key]) ?? result[key]
    }
  }
  return result as T
}

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
  file_name: string
  file_extension: string | null
  size_bytes: number | null
  web_url: string | null
  document_type_code: string | null
  type_label: string | null
  is_classified: boolean
  classified_at: string | null
  classification_source: string | null
  created_at_source: string | null
  modified_at_source: string | null
  created_by_name: string | null
  modified_by_name: string | null
  ai_extraction:      Record<string, unknown> | null
  ai_extracted_at:    string | null
}

interface DocumentStats {
  total: number
  required: number
  requested: number
  received: number
  approved: number
  waived: number
  unclassified: number
  docs_needed: number
}

interface DocumentCollection {
  documents_needed:       string[]
  collection_status:      string | null
  collection_notes:       string | null
  promise_date:           string | null
  synced_from_hubspot_at: string | null
}

interface SharePointInfo {
  has_url:    boolean
  file_url:   string | null
  synced_at:  string | null
  file_count: number
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
            <div key={f.id} className="flex flex-col gap-0.5 py-1">
              <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
                <span className="shrink-0">📎</span>
                <span className="font-medium truncate max-w-xs">{f.file_name}</span>
                {f.size_bytes && <span className="text-gray-300 shrink-0">{formatBytes(f.size_bytes)}</span>}
                {f.web_url && (
                  <a href={f.web_url} target="_blank" rel="noopener noreferrer"
                    className="text-blue-500 hover:underline shrink-0"
                    onClick={e => e.stopPropagation()}>
                    Open ↗
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3 ml-5 text-xs text-gray-400 flex-wrap">
                {f.created_at_source && (
                  <span>Uploaded {new Date(f.created_at_source).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                )}
                {f.created_by_name && (
                  <span>by {f.created_by_name}</span>
                )}
                {f.modified_at_source && f.modified_at_source !== f.created_at_source && (
                  <span className="text-gray-300">· Modified {new Date(f.modified_at_source).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                )}
              </div>
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

// ── Collection status badge colours ────────────────────────────────────────
const COLLECTION_STATUS_BADGE: Record<string, string> = {
  'Requested - Awaiting Upload':      'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Received \u2013 Pending Review/Upload': 'bg-blue-50 text-blue-700 border-blue-200',
  'New Document Promise Date':        'bg-purple-50 text-purple-700 border-purple-200',
  'Vehicle in Repair / In Shop':      'bg-orange-50 text-orange-700 border-orange-200',
  'No Answer / Missed Promise Date':  'bg-red-50 text-red-700 border-red-200',
  'Missing Documents':                'bg-red-50 text-red-700 border-red-200',
  'Blurry/Illegible Documents':       'bg-orange-50 text-orange-700 border-orange-200',
  'Dealership Refused to Provide Docs': 'bg-red-50 text-red-700 border-red-200',
  'Dealership Refused to Take Vehicle': 'bg-red-50 text-red-700 border-red-200',
  'Client Traveling':                 'bg-gray-50 text-gray-600 border-gray-200',
}

// ── Stage 2: Case-level Sonnet analysis panel ─────────────────────────────

interface AnalysisResult {
  decision?:               string
  confidence?:             string
  cause_of_action?:        string
  case_strength?:          string
  summary?:                string
  total_repair_attempts?:  number
  total_days_out_of_service?: number
  meets_state_threshold?:  boolean
  meets_federal_threshold?: boolean
  state_law?:              string
  state_statute?:          string
  nurture_reason?:         string
  drop_reason?:            string
  retain_signals?:         string[]
  risk_factors?:           string[]
  clarification_needed?:   string[]
  recurring_defects?:      Array<{ complaint: string; attempts: number; dates: string[] }>
  key_findings?:           string[]
  attorney_notes?:         string
  engine_missing_data?:    string[]
}

const STRENGTH_STYLE: Record<string, string> = {
  strong:            'bg-green-50 border-green-200 text-green-700',
  moderate:          'bg-yellow-50 border-yellow-200 text-yellow-700',
  weak:              'bg-orange-50 border-orange-200 text-orange-700',
  insufficient_data: 'bg-gray-50 border-gray-200 text-gray-500',
}

interface RepairStats {
  visits: number
  totalDays: number
  utdCount: number
  firstDate: string | null
  lastDate: string | null
  extractedAll: number
  totalFiles: number
}

function CaseAnalysisPanel({ caseId, repairStats, onSwitchToDocuments }: { caseId: string; repairStats?: RepairStats; onSwitchToDocuments?: () => void }) {
  const [analysis,      setAnalysis]      = useState<AnalysisResult | null>(null)
  const [analyzedAt,    setAnalyzedAt]    = useState<string | null>(null)
  const [filesAnalyzed, setFilesAnalyzed] = useState<number>(0)
  const [filesPending,  setFilesPending]  = useState<string[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [detailsOpen,   setDetailsOpen]   = useState(false)
  const [signalsOpen,   setSignalsOpen]   = useState(true)

  async function runAnalysis(force = false) {
    setLoading(true); setError(null)
    const res = await fetch(`/api/cases/${caseId}/ai-analyze`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error ?? 'Analysis failed'); return }
    setAnalysis(data.analysis)
    setAnalyzedAt(data.analyzed_at ?? null)
    setFilesAnalyzed(data.files_analyzed ?? 0)
    setFilesPending(data.files_pending ?? [])
    // reset
  }

  // Auto-load cached analysis on mount
  useEffect(() => { runAnalysis(false) }, [caseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const strength = analysis?.case_strength

  function formatAnalyzedAt(ts: string | null) {
    if (!ts) return null
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  }

  const DECISION_STYLE: Record<string, { bg: string; border: string; barBg: string; text: string; label: string; icon: string }> = {
    retain:               { bg: 'bg-green-50',  border: 'border-green-200', barBg: 'bg-green-500', text: 'text-green-700',  label: 'Retain',              icon: '✓' },
    nurture:              { bg: 'bg-amber-50',  border: 'border-amber-200', barBg: 'bg-amber-500', text: 'text-amber-700',  label: 'Nurture',             icon: '◷' },
    drop:                 { bg: 'bg-red-50',    border: 'border-red-200',   barBg: 'bg-red-500',   text: 'text-red-700',    label: 'Drop',                icon: '✕' },
    clarification_needed: { bg: 'bg-blue-50',   border: 'border-blue-200',  barBg: 'bg-blue-500',  text: 'text-blue-700',   label: 'Clarification Needed', icon: '?' },
  }
  const COA_LABEL: Record<string, string> = {
    both:            'State Lemon Law + Magnuson-Moss',
    state_lemon_law: 'State Lemon Law',
    magnuson_moss:   'Federal Magnuson-Moss',
  }

  const dec   = analysis?.decision
  const style = dec ? (DECISION_STYLE[dec] ?? DECISION_STYLE.clarification_needed) : null

  return (
    <div className="space-y-4">

      {/* ── DECISION CARD (top, always first) ──────────────────────────── */}
      <div className={`rounded-xl border-2 overflow-hidden ${style ? `${style.border} ${style.bg}` : 'border-gray-200 bg-white'}`}>

        {/* Header row */}
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            {style && dec ? (
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${style.barBg}`}>
                <span className="text-white text-xl font-bold">{style.icon}</span>
              </div>
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                <span className="text-gray-400 text-lg">✦</span>
              </div>
            )}
            <div className="min-w-0">
              {style && dec ? (
                <>
                  <p className={`text-lg font-bold ${style.text}`}>{style.label}</p>
                  {analysis?.cause_of_action && (
                    <p className="text-xs text-gray-500 mt-0.5">{COA_LABEL[analysis.cause_of_action] ?? analysis.cause_of_action}</p>
                  )}
                </>
              ) : (
                <p className="text-sm font-semibold text-gray-700">✦ AI Analysis</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {analysis?.confidence && style && (
              <span className={`hidden sm:inline text-xs font-medium px-2.5 py-1 rounded-full border ${style.border} ${style.text} bg-white`}>
                {analysis.confidence} confidence
              </span>
            )}
            {onSwitchToDocuments && (
              <button
                onClick={onSwitchToDocuments}
                className="text-xs px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors active:scale-95"
              >
                View Documents
              </button>
            )}
            <button
              onClick={() => runAnalysis(true)}
              disabled={loading}
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors active:scale-95"
            >
              {loading ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                  {analysis ? 'Analyzing…' : 'Loading…'}
                </span>
              ) : analysis ? '↻ Re-analyze' : 'Analyze'}
            </button>
          </div>
        </div>

        {/* Stats strip — merged repair summary + threshold (no duplication) */}
        {(repairStats || analysis) && (
          <div className="border-t border-black/5 px-5 py-3 flex items-center gap-6 flex-wrap">
            {(repairStats?.visits ?? analysis?.total_repair_attempts) != null && (
              <div className="text-center">
                <p className={`text-xl font-bold ${style?.text ?? 'text-gray-800'}`}>
                  {repairStats?.visits ?? analysis?.total_repair_attempts}
                </p>
                <p className="text-xs text-gray-400">Repair Visits</p>
              </div>
            )}
            {(repairStats?.totalDays ?? analysis?.total_days_out_of_service) != null && (
              <div className="text-center">
                <p className={`text-xl font-bold ${style?.text ?? 'text-gray-800'}`}>
                  {repairStats?.totalDays ?? analysis?.total_days_out_of_service}
                </p>
                <p className="text-xs text-gray-400">Days OOS</p>
              </div>
            )}
            {repairStats && repairStats.utdCount > 0 && (
              <div className="text-center">
                <p className="text-xl font-bold text-red-600">{repairStats.utdCount}</p>
                <p className="text-xs text-gray-400">UTD Visits</p>
              </div>
            )}
            {repairStats?.firstDate && repairStats?.lastDate && (
              <div className="text-center hidden sm:block">
                <p className="text-xs font-medium text-gray-600">{repairStats.firstDate} – {repairStats.lastDate}</p>
                <p className="text-xs text-gray-400">Date Range</p>
              </div>
            )}
            {(analysis?.meets_state_threshold != null || analysis?.meets_federal_threshold != null) && (
              <div className="text-center ml-auto">
                <p className={`text-xl font-bold ${(analysis.meets_state_threshold ?? false) || (analysis.meets_federal_threshold ?? false) ? 'text-green-600' : 'text-gray-400'}`}>
                  {(analysis.meets_state_threshold ?? false) || (analysis.meets_federal_threshold ?? false) ? '✓' : '✗'}
                </p>
                <p className="text-xs text-gray-400">Meets Threshold</p>
              </div>
            )}
            {repairStats && (
              <div className="w-full mt-1">
                <div className="w-full h-1 bg-black/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${style?.barBg ?? 'bg-gray-400'}`}
                    style={{ width: repairStats.totalFiles > 0 ? `${(repairStats.extractedAll / repairStats.totalFiles) * 100}%` : '0%' }} />
                </div>
                <p className="text-xs mt-1 opacity-60">{repairStats.extractedAll}/{repairStats.totalFiles} docs extracted</p>
              </div>
            )}
          </div>
        )}

        {/* Decision detail — signals / reason inside the decision card */}
        {analysis && dec && (
          <div className="border-t border-black/5 px-5 py-3">
            {dec === 'retain' && (analysis.retain_signals ?? []).length > 0 && (
              <ul className="space-y-1">
                {(analysis.retain_signals ?? []).map((s, i) => (
                  <li key={i} className="text-xs text-green-700 flex gap-2"><span className="shrink-0">✓</span>{s}</li>
                ))}
              </ul>
            )}
            {dec === 'nurture' && Boolean(analysis.nurture_reason) && (
              <p className="text-xs text-amber-700">{analysis.nurture_reason}</p>
            )}
            {dec === 'drop' && Boolean(analysis.drop_reason) && (
              <p className="text-xs text-red-700">{analysis.drop_reason}</p>
            )}
            {dec === 'clarification_needed' && (analysis.clarification_needed ?? []).length > 0 && (
              <ul className="space-y-1">
                {(analysis.clarification_needed ?? []).map((s, i) => (
                  <li key={i} className="text-xs text-blue-700 flex gap-2"><span className="shrink-0">·</span>{String(s ?? '')}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Pending docs warning ────────────────────────────────────────── */}
      {!loading && filesPending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-amber-700">
            {filesPending.length} doc{filesPending.length !== 1 ? 's' : ''} not yet extracted — re-analyze after opening {filesPending.length === 1 ? 'it' : 'them'}
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* ── Attorney Notes (most actionable — always shown first) ───────── */}
      {analysis?.attorney_notes && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Attorney Notes</p>
          <ul className="space-y-2">
            {analysis.attorney_notes.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).filter((s: string) => s.trim().length > 10).map((line: string, i: number) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-700">
                <span className="shrink-0 text-lemon-500 mt-0.5">→</span>
                <span>{line.trim()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Signals & Risks (collapsible, open by default) ──────────────── */}
      {analysis && ((analysis.risk_factors ?? []).length > 0 || (analysis.retain_signals ?? []).length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            onClick={() => setSignalsOpen(o => !o)}
          >
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Signals &amp; Risk Factors</p>
            <span className="text-gray-400 text-xs">{signalsOpen ? '▴' : '▾'}</span>
          </button>
          {signalsOpen && (
            <div className="border-t border-gray-100 px-5 py-4 grid md:grid-cols-2 gap-4">
              {(analysis.retain_signals ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-green-600 mb-2">Retain Signals</p>
                  <ul className="space-y-1.5">
                    {(analysis.retain_signals ?? []).map((s, i) => (
                      <li key={i} className="text-xs text-gray-600 flex gap-1.5"><span className="text-green-500 shrink-0">✓</span>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(analysis.risk_factors ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-600 mb-2">Risk Factors</p>
                  <ul className="space-y-1.5">
                    {(analysis.risk_factors ?? []).map((f, i) => (
                      <li key={i} className="text-xs text-gray-600 flex gap-1.5"><span className="text-amber-400 shrink-0">⚠</span>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Details (collapsible, collapsed by default) ──────────────────── */}
      {analysis && ((analysis.recurring_defects ?? []).length > 0 || (analysis.key_findings ?? []).length > 0 || analysis.summary) && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            onClick={() => setDetailsOpen(o => !o)}
          >
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Case Details</p>
            <span className="text-gray-400 text-xs">{detailsOpen ? '▴' : '▾'}</span>
          </button>
          {detailsOpen && (
            <div className="border-t border-gray-100 px-5 py-4 space-y-4">
              {/* Summary */}
              {analysis.summary && (
                <p className="text-sm text-gray-700 leading-relaxed bg-lemon-400/10 border border-lemon-400/20 rounded-lg px-4 py-3">{analysis.summary}</p>
              )}
              {/* Recurring defects */}
              {(analysis.recurring_defects ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recurring Defects</p>
                  <div className="space-y-2">
                    {(analysis.recurring_defects ?? []).map((d, i) => (
                      <div key={i} className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                        <span className="text-red-500 font-bold text-sm shrink-0">{d.attempts}×</span>
                        <div>
                          <p className="text-sm text-gray-800 font-medium">{d.complaint}</p>
                          {d.dates?.length > 0 && <p className="text-xs text-gray-400 mt-0.5">{d.dates.join(' · ')}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Key findings */}
              {(analysis.key_findings ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Key Findings</p>
                  <ul className="space-y-1.5">
                    {(analysis.key_findings ?? []).map((f, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="text-lemon-500 shrink-0 mt-0.5">→</span>{f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Footer: state law + missing data ─────────────────────────────── */}
      {analysis && (analysis.state_law || (analysis.engine_missing_data ?? []).length > 0) && (
        <div className="space-y-2">
          {analysis.state_law && (
            <p className="text-xs text-gray-400 px-1">
              Applied: <span className="font-medium">{analysis.state_law}</span>
              {analysis.state_statute && <> · {analysis.state_statute}</>}
              {analyzedAt && <> · Last analyzed {formatAnalyzedAt(analyzedAt)}</>}
            </p>
          )}
          {(analysis.engine_missing_data ?? []).length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-amber-700">Missing data — confidence may be affected</p>
                {onSwitchToDocuments && (
                  <button
                    onClick={onSwitchToDocuments}
                    className="text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 transition-colors"
                  >
                    View Documents →
                  </button>
                )}
              </div>
              <ul className="space-y-1.5">
                {(analysis.engine_missing_data ?? []).map((m, i) => (
                  <li key={i}>
                    {onSwitchToDocuments ? (
                      <button
                        onClick={onSwitchToDocuments}
                        className="text-xs text-amber-700 flex gap-2 w-full text-left hover:text-amber-900 group transition-colors"
                      >
                        <span className="shrink-0 mt-0.5">·</span>
                        <span className="group-hover:underline underline-offset-2">{m}</span>
                        <span className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </button>
                    ) : (
                      <span className="text-xs text-amber-600 flex gap-2"><span>·</span>{m}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// ── Document groups shown in the Files panel ───────────────────────────────
const DOC_GROUPS = [
  { key: 'repair_orders',  label: 'Repair Orders',              alwaysShow: true,  codes: ['repair_order'] },
  { key: 'purchase_lease', label: 'Purchase / Lease Agreement', alwaysShow: true,  codes: ['purchase_agreement','lease_agreement','lease_order'] },
  { key: 'vehicle_reg',    label: 'Vehicle Registration',       alwaysShow: true,  codes: ['vehicle_registration'] },
  { key: 'other',          label: 'Other Documents',            alwaysShow: false, codes: null },
] as const

// Maps HubSpot documents_needed values → group key
const DOCS_NEEDED_GROUP: Record<string, string> = {
  // Repair Orders
  'Additional Repair Order Documents': 'repair_orders',
  // Purchase / Lease
  'Purchase/Lease Contract':                         'purchase_lease',
  'Purchase Agreement/Buyer\'s Order':               'purchase_lease',
  'Lease Order':                                     'purchase_lease',
  'Security Agreement/Loan Purchase Agreement':      'purchase_lease',
  'Auth to Release Loan/Lease Information':          'purchase_lease',
  'Lienholder Information Request Form':             'purchase_lease',
  'Loan/Account Information':                        'purchase_lease',
  'Payoff Quote':                                    'purchase_lease',
  // Vehicle Registration
  'Vehicle Registration':                            'vehicle_reg',
  'Vehicle Title':                                   'vehicle_reg',
  'Odometer Statement Form':                         'vehicle_reg',
  // Everything else → 'other' (handled as default)
}

// ── AI Analysis Tab ───────────────────────────────────────────────────────
// Sort order matching Documents tab
const AI_GROUP_ORDER: Record<string, number> = {
  repair_order: 0,
  purchase_agreement: 1, lease_agreement: 1, lease_order: 1,
  vehicle_registration: 2,
}
const STATUS_STYLE: Record<string, string> = {
  completed:           'bg-green-50 text-green-700 border-green-100',
  unable_to_duplicate: 'bg-red-50 text-red-700 border-red-100',
  parts_on_order:      'bg-amber-50 text-amber-700 border-amber-100',
  other:               'bg-gray-50 text-gray-500 border-gray-100',
}

function AIDocRow({ f, caseId }: { f: CaseFile; caseId: string }) {
  const ex      = f.ai_extraction as Record<string, unknown> | null
  const dateIn  = ex?.repair_date_in  as string | null
  const dateOut = ex?.repair_date_out as string | null
  const days    = ex?.days_in_shop    as number | null
  const status  = ex?.repair_status   as string | null
  const isUnclassified = !f.is_classified
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const cardBase = isUnclassified ? 'border-amber-100 bg-amber-50/30' : 'border-gray-100 bg-white'

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-all duration-150 cursor-pointer
        ${cardBase}
        hover:-translate-y-0.5 hover:shadow-md hover:border-gray-300 hover:bg-gray-50
        active:translate-y-0 active:shadow-sm`}
      onClick={() => { window.location.href = `/cases/${caseId}/documents/${f.id}` }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm text-gray-800 font-medium truncate max-w-xs">{f.file_name}</span>
          {f.type_label && !isUnclassified && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">{f.type_label}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && (
            <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[status] ?? STATUS_STYLE.other}`}>
              {status.replace(/_/g, ' ')}
            </span>
          )}
          {ex ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />Extracted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />Not extracted
            </span>
          )}
        </div>
      </div>
      {ex && dateIn && (
        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
            {fmtDate(dateIn)}{dateOut ? ` – ${fmtDate(dateOut)}` : ''}
          </span>
          {days != null && (
            <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
              {days} day{days !== 1 ? 's' : ''} in shop
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap mt-1.5">
        {f.created_at_source && (
          <span>Uploaded {new Date(f.created_at_source).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        )}
        {f.created_by_name && <span>by {f.created_by_name}</span>}
      </div>

    </div>
  )
}

function AIAnalysisTab({ caseId, caseUUID, onSwitchToDocuments }: { caseId: string; caseUUID: string | null; onSwitchToDocuments?: () => void }) {
  const [files,   setFiles]   = useState<CaseFile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/cases/${caseId}/documents`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setFiles(d.files ?? []); setLoading(false) })
  }, [caseId])

  const ros       = files.filter(f => f.document_type_code === 'repair_order' && f.ai_extraction)
  const extracted = ros.map(f => f.ai_extraction as Record<string, unknown>)
  const totalDays = extracted.reduce((s, e) => s + ((e.days_in_shop as number) ?? 0), 0)
  const utdCount  = extracted.filter(e => e.repair_status === 'unable_to_duplicate').length
  const dates     = extracted.flatMap(e => [e.repair_date_in as string, e.repair_date_out as string]).filter(Boolean).sort()
  const firstDate = dates[0]              ? new Date(dates[0]              + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const lastDate  = dates[dates.length-1] ? new Date(dates[dates.length-1] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const extractedAll = files.filter(f => f.ai_extraction).length
  const pdfFiles  = files
    .filter(f => f.file_extension?.toLowerCase() === 'pdf' || f.file_name.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => {
      const ao = AI_GROUP_ORDER[a.document_type_code ?? ''] ?? 3
      const bo = AI_GROUP_ORDER[b.document_type_code ?? ''] ?? 3
      if (ao !== bo) return ao - bo
      const ad = (a.ai_extraction?.repair_date_in as string) ?? a.created_at_source ?? ''
      const bd = (b.ai_extraction?.repair_date_in as string) ?? b.created_at_source ?? ''
      return ad.localeCompare(bd)
    })
  const unextracted = pdfFiles.filter(f => !f.ai_extraction)

  const repairStats: RepairStats = {
    visits:       ros.length,
    totalDays,
    utdCount,
    firstDate,
    lastDate,
    extractedAll,
    totalFiles:   files.length,
  }

  return (
    <CaseAnalysisPanel caseId={caseId} repairStats={files.length > 0 ? repairStats : undefined} onSwitchToDocuments={onSwitchToDocuments} />
  )
}

function DocumentsSection({
  caseId,
}: {
  caseId: string
}) {
  const router = useRouter()
  const [files,       setFiles]       = useState<CaseFile[]>([])
  const [docTypes,    setDocTypes]    = useState<DocType[]>([])
  const [collection,  setCollection]  = useState<DocumentCollection | null>(null)
  const [sharepoint,  setSharepoint]  = useState<SharePointInfo | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [syncing,     setSyncing]     = useState(false)
  const [classifying, setClassifying] = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/cases/${caseId}/documents`)
    if (res.ok) {
      const data = await res.json()
      setFiles(data.files          ?? [])
      setDocTypes(data.docTypes    ?? [])
      setCollection(data.collection ?? null)
      setSharepoint(data.sharepoint ?? null)
    }
    setLoading(false)
  }, [caseId])

  useEffect(() => { load() }, [load])

  async function triggerSync() {
    setSyncing(true)
    try {
      const res  = await fetch('/api/admin/sharepoint/sync-case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('[sync-case] error:', data)
        alert(`Sync failed: ${data.error ?? res.status}`)
      }
    } catch (e) {
      console.error('[sync-case] fetch error:', e)
      alert('Sync request failed — check console for details')
    }
    await load()
    setSyncing(false)
  }

  async function classify(fileId: string, typeCode: string) {
    setSaving(true)
    const res = await fetch(`/api/cases/${caseId}/documents/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, document_type_code: typeCode }),
    })
    setSaving(false)
    if (res.ok) { setClassifying(null); load() }
  }

  const [bulkExtracting, setBulkExtracting] = useState<string | null>(null) // group key or 'all'
  const [bulkProgress,   setBulkProgress]   = useState<{ done: number; total: number } | null>(null)

  async function bulkExtract(types: string[] | null) {
    const key = types ? types[0] : 'all'
    setBulkExtracting(key)
    setBulkProgress(null)
    try {
      const body: Record<string, unknown> = {}
      if (types) body.types = types
      const res  = await fetch(`/api/cases/${caseId}/documents/bulk-extract`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { alert(`Bulk extract failed: ${data.error ?? res.status}`); return }
      setBulkProgress({ done: data.extracted ?? 0, total: data.total ?? 0 })
      await load()
    } catch (e) {
      alert(`Bulk extract error: ${String(e)}`)
    } finally {
      setBulkExtracting(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">Loading documents…</p>
      </div>
    )
  }

  // Group files by section
  const PURCHASE_LEASE_CODES: string[] = ['purchase_agreement','lease_agreement','lease_order']
  const NAMED_CODES: string[] = ['repair_order','purchase_agreement','lease_agreement','lease_order','vehicle_registration']
  const groupedFiles: Record<string, CaseFile[]> = {
    repair_orders:  files.filter(f => f.document_type_code === 'repair_order'),
    purchase_lease: files.filter(f => PURCHASE_LEASE_CODES.includes(f.document_type_code ?? '')),
    vehicle_reg:    files.filter(f => f.document_type_code === 'vehicle_registration'),
    other:          files.filter(f => !f.document_type_code || !NAMED_CODES.includes(f.document_type_code)),
  }

  // Map documents_needed items to their group
  const docsNeeded: string[] = collection?.documents_needed ?? []
  const neededByGroup: Record<string, string[]> = { repair_orders: [], purchase_lease: [], vehicle_reg: [], other: [] }
  for (const doc of docsNeeded) {
    const groupKey = DOCS_NEEDED_GROUP[doc] ?? 'other'
    neededByGroup[groupKey].push(doc)
  }

  const unclassifiedCount = files.filter(f => !f.is_classified).length

  const collectionStatusBadge = collection?.collection_status
    ? (COLLECTION_STATUS_BADGE[collection.collection_status] ?? 'bg-gray-50 text-gray-600 border-gray-200')
    : null
  const hasDocsNeeded = (collection?.documents_needed ?? []).length > 0

  return (
    <div className="space-y-4">

      {/* ── PDF Viewer Modal ──────────────────────────────────────────── */}
      {/* Hidden upload input */}
      <input ref={uploadRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0]
          if (!file) return
          setUploading(true)
          const fd = new FormData(); fd.append('file', file); fd.append('case_id', caseId)
          await fetch(`/api/cases/${caseId}/documents/upload`, { method: 'POST', body: fd, credentials: 'include' })
          await load(); setUploading(false)
          if (uploadRef.current) uploadRef.current.value = ''
        }} />

      {/* ── HubSpot Collection Status Card ─────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Collection Status</h2>
          <div className="flex items-center gap-3">
            {sharepoint?.file_url && (
              <a href={sharepoint.file_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline">
                Open SharePoint folder ↗
              </a>
            )}
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors active:scale-95"
            >
              {uploading ? '↑ Uploading…' : '↑ Upload'}
            </button>
            <button
              onClick={triggerSync}
              disabled={syncing || !sharepoint?.has_url}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors active:scale-95"
              title={!sharepoint?.has_url ? 'No SharePoint folder on this case' : 'Pull latest files from SharePoint'}
            >
              {syncing ? '⟳ Syncing…' : '⟳ Sync files'}
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">

            {/* Status */}
            <div>
              <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">Status</p>
              {collection?.collection_status ? (
                <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${collectionStatusBadge}`}>
                  {collection.collection_status}
                </span>
              ) : (
                <span className="text-sm text-gray-300">—</span>
              )}
            </div>

            {/* Promise date */}
            <div>
              <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">Promise Date</p>
              {collection?.promise_date ? (
                <p className="text-sm font-medium text-gray-800">
                  {new Date(collection.promise_date + 'T12:00:00').toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric'
                  })}
                </p>
              ) : (
                <span className="text-sm text-gray-300">—</span>
              )}
            </div>

            {/* SharePoint sync info */}
            <div>
              <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">SharePoint Files</p>
              <p className="text-sm text-gray-700">
                {sharepoint?.file_count ?? 0} file{(sharepoint?.file_count ?? 0) !== 1 ? 's' : ''}
                {unclassifiedCount > 0 && (
                  <span className="ml-2 text-xs text-amber-600">· {unclassifiedCount} unclassified</span>
                )}
              </p>
              {sharepoint?.synced_at && (
                <p className="text-xs text-gray-300 mt-0.5">
                  Synced {new Date(sharepoint.synced_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                </p>
              )}
            </div>
          </div>

          {/* Notes */}
          {collection?.collection_notes && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{collection.collection_notes}</p>
            </div>
          )}
        </div>
      </div>



      {/* ── Grouped Files ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Files</h2>
            <span className="text-xs text-gray-400">{files.length} total</span>
            {unclassifiedCount > 0 && (
              <span className="text-xs text-amber-600">· {unclassifiedCount} need classification</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const unextractedPdfs = files.filter(f =>
                !f.ai_extraction &&
                (f.file_name.toLowerCase().endsWith('.pdf')) &&
                ['repair_order','purchase_agreement','lease_agreement','lease_order','vehicle_registration'].includes(f.document_type_code ?? '')
              )
              if (unextractedPdfs.length === 0) return null
              return (
                <button
                  onClick={() => bulkExtract(null)}
                  disabled={bulkExtracting !== null}
                  className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors active:scale-95 flex items-center gap-1.5"
                  title={`Extract ${unextractedPdfs.length} unextracted document${unextractedPdfs.length !== 1 ? 's' : ''}`}
                >
                  {bulkExtracting === 'all' || (bulkExtracting && bulkProgress == null) ? (
                    <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" /> Extracting…</>
                  ) : (
                    <>✦ Extract All ({unextractedPdfs.length})</>
                  )}
                </button>
              )
            })()}
            {bulkProgress && (
              <span className="text-xs text-green-600 font-medium">✓ {bulkProgress.done}/{bulkProgress.total} extracted</span>
            )}
            <button onClick={load} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">↻</button>
          </div>
        </div>

        {files.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-gray-400 text-sm">No files synced yet</p>
            <p className="text-gray-300 text-xs mt-1">
              {sharepoint?.has_url ? 'Click "Sync files" above to pull from SharePoint' : 'No SharePoint folder linked on this case'}
            </p>
          </div>
        ) : (<>


          <div className="divide-y divide-gray-100">
            {DOC_GROUPS.map(group => {
              const groupFiles  = groupedFiles[group.key] ?? []
              const neededItems = neededByGroup[group.key] ?? []
              const hasFiles    = groupFiles.length > 0
              const hasNeeded   = neededItems.length > 0

              // Skip Other if nothing to show
              if (!group.alwaysShow && !hasFiles && !hasNeeded) return null

              // Section status
              const sectionStatus = hasFiles
                ? 'received'
                : hasNeeded
                  ? 'missing'
                  : group.alwaysShow ? 'empty' : 'empty'

              return (
                <div key={group.key} className="px-6 py-5">
                  {/* Section header */}
                  <div className="flex items-center gap-2 mb-3">
                    {sectionStatus === 'received' && <span className="text-green-500 text-sm">✓</span>}
                    {sectionStatus === 'missing'  && <span className="text-red-400 text-sm">!</span>}
                    {sectionStatus === 'empty'    && <span className="text-gray-300 text-sm">○</span>}
                    <h3 className={`text-xs font-semibold uppercase tracking-wide ${
                      sectionStatus === 'missing' ? 'text-red-500' : 'text-gray-600'
                    }`}>{group.label}</h3>
                    {hasFiles && <span className="text-xs text-gray-300">{groupFiles.length} file{groupFiles.length !== 1 ? 's' : ''}</span>}
                    {sectionStatus === 'missing' && (
                      <span className="text-xs font-medium text-red-500 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Missing</span>
                    )}
                    {/* Per-group extract button */}
                    {(() => {
                      const unextracted = groupFiles.filter(f =>
                        !f.ai_extraction && f.file_name.toLowerCase().endsWith('.pdf')
                      )
                      if (unextracted.length === 0 || !group.codes) return null
                      const typeCodes = [...group.codes] as string[]
                      const isRunning = bulkExtracting === typeCodes[0]
                      return (
                        <button
                          onClick={() => bulkExtract(typeCodes)}
                          disabled={bulkExtracting !== null}
                          className="ml-auto text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-40 transition-colors active:scale-95 flex items-center gap-1"
                        >
                          {isRunning ? (
                            <><span className="w-2.5 h-2.5 border border-gray-400/40 border-t-gray-600 rounded-full animate-spin" /> Extracting…</>
                          ) : (
                            <>✦ Extract {unextracted.length}</>
                          )}
                        </button>
                      )
                    })()}
                  </div>

                  {/* Documents needed items for this section */}
                  {hasNeeded && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {neededItems.map((doc, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                          <span className="text-amber-400">▲</span> {doc}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Files list */}
                  {hasFiles ? (
                    <div className="space-y-2">
                      {groupFiles.map(f => (
                        <FileRow
                          key={f.id}
                          f={f}
                          docTypes={docTypes}
                          classifying={classifying}
                          saving={saving}
                          caseId={caseId}
                          onView={() => router.push(`/cases/${caseId}/documents/${f.id}` as never)}
                          onStartClassify={() => setClassifying(f.id)}
                          onCancelClassify={() => setClassifying(null)}
                          onSave={async (code: string) => {
                            setSaving(true)
                            const res = await fetch(`/api/cases/${caseId}/documents/classify`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ file_id: f.id, document_type_code: code }),
                            })
                            setSaving(false)
                            if (res.ok) { setClassifying(null); load() }
                          }}
                        />
                      ))}
                    </div>
                  ) : group.alwaysShow ? (
                    <p className="text-xs text-gray-300 italic pl-1">No documents received yet</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </>)}
      </div>
    </div>
  )
}

// ── Stage 1: Per-doc extraction panel (Gemini 2.5 Flash) — manual trigger + editable ─
const SKIP_FIELDS = new Set(['doc_type','key_facts','key_dates'])
const TEXTAREA_FIELDS = new Set(['complaint','diagnosis','work_performed','key_facts'])
const SELECT_FIELDS: Record<string, string[]> = {
  repair_status: ['completed','unable_to_duplicate','parts_on_order','customer_declined','other'],
}

function DocExtractionPanel({ fileId }: { fileId: string }) {
  const [data,      setData]      = useState<Record<string, unknown> | null>(null)
  const [original,  setOriginal]  = useState<Record<string, unknown> | null>(null)
  const [edits,     setEdits]     = useState<Record<string, unknown>>({})
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [kbAdded,   setKbAdded]   = useState<string | null>(null)
  const [error,     setError]     = useState(false)

  // Load cached extraction on mount (no auto-extract)
  useEffect(() => {
    fetch(`/api/documents/${fileId}/analyze`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cached_only: true }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.extraction) { setData(d.extraction); setOriginal(d.extraction) } })
      .catch(() => {})
  }, [fileId])

  async function runExtraction(force = false) {
    setLoading(true); setError(false); setEdits({})
    fetch(`/api/documents/${fileId}/analyze`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setData(d.extraction); setOriginal(d.extraction) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  async function saveCorrections() {
    if (!data) return
    setSaving(true); setSaved(false); setKbAdded(null)
    const corrected = { ...data, ...edits }
    const res = await fetch(`/api/documents/${fileId}/extraction`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrected, original }),
    })
    const result = await res.json()
    if (res.ok) {
      setData(corrected); setOriginal(corrected); setEdits({})
      setSaved(true)
      if (result.kb_rule_added) setKbAdded(result.kb_rule_added)
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  const merged     = data ? { ...data, ...edits } : null
  const hasEdits   = Object.keys(edits).length > 0
  const entries    = merged ? Object.entries(merged).filter(([k, v]) =>
    !SKIP_FIELDS.has(k) && v !== null && v !== undefined && v !== '' && !Array.isArray(v)
  ) : []

  // ── Render: not yet extracted
  if (!data && !loading) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-lg">✦</div>
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">Not yet extracted</p>
        <p className="text-xs text-gray-400">Run Gemini to extract structured data from this document</p>
      </div>
      <button onClick={() => runExtraction(false)}
        className="text-sm px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 active:scale-95 transition-all">
        Extract with Gemini
      </button>
      {error && <p className="text-xs text-red-500">Extraction failed. Try again.</p>}
    </div>
  )

  // ── Render: loading
  if (loading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 px-6">
      <div className="w-7 h-7 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin" />
      <p className="text-xs text-center">Extracting with Gemini…<br/><span className="text-gray-300">~5 seconds</span></p>
    </div>
  )

  // ── Render: extracted + editable
  return (
    <div className="h-full overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Document Extraction</p>
          <p className="text-xs text-gray-300 mt-0.5">Gemini 2.5 Flash · click any field to edit</p>
        </div>
        <button onClick={() => runExtraction(true)} title="Re-extract"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded border border-gray-100 hover:border-gray-200">
          ↻ Re-run
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 px-5 pb-3 space-y-3">
        {entries.map(([key, val]) => {
          const isEdited  = key in edits
          const fieldVal  = String(val ?? '')
          const isBoolean = typeof (data?.[key]) === 'boolean'
          const isSelect  = key in SELECT_FIELDS
          const isTA      = TEXTAREA_FIELDS.has(key)

          return (
            <div key={key} className={`rounded-lg border px-3 py-2 transition-colors ${isEdited ? 'border-amber-300 bg-amber-50' : 'border-gray-100 bg-gray-50/50'}`}>
              <p className="text-xs text-gray-400 capitalize mb-1">{key.replace(/_/g, ' ')}{isEdited && <span className="ml-1.5 text-amber-500 text-xs">edited</span>}</p>
              {isBoolean ? (
                <select
                  value={fieldVal}
                  onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value === 'true' }))}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : isSelect ? (
                <select
                  value={fieldVal}
                  onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none capitalize">
                  {SELECT_FIELDS[key].map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                </select>
              ) : isTA ? (
                <textarea
                  value={fieldVal}
                  onChange={e => {
                    setEdits(prev => ({ ...prev, [key]: e.target.value }))
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                  }}
                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none resize-none leading-relaxed overflow-hidden" />
              ) : (
                <input
                  type="text"
                  value={fieldVal}
                  onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                  className="text-sm text-gray-800 font-medium bg-transparent w-full focus:outline-none" />
              )}
            </div>
          )
        })}
      </div>

      {/* Save bar */}
      <div className="px-5 pb-5 pt-2 shrink-0 space-y-2">
        {kbAdded && (
          <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
            ✓ Knowledge base updated: &quot;{kbAdded}&quot;
          </div>
        )}
        {saved && !kbAdded && (
          <p className="text-xs text-green-600">✓ Corrections saved</p>
        )}
        {hasEdits && (
          <button onClick={saveCorrections} disabled={saving}
            className="w-full text-sm py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-400 disabled:opacity-40 active:scale-95 transition-all font-medium">
            {saving ? 'Saving + Learning…' : 'Save Corrections'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── PDF Viewer Modal ───────────────────────────────────────────────────────
// Fetches the PDF as a blob client-side → object URL → bypasses frame-ancestors CSP
function DocViewerModal({
  fileId,
  fileName,
  webUrl,
  docType,
  onClose,
}: {
  fileId:   string
  fileName: string
  webUrl:   string | null
  docType:  string | null
  onClose:  () => void
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState(false)

  useEffect(() => {
    let objectUrl: string
    fetch(`/api/documents/${fileId}/view`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then(blob => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl) })
      .catch(() => setLoadErr(true))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fileId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex flex-col bg-white w-full h-full max-w-7xl mx-auto my-6 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0 bg-white">
          <p className="text-sm font-medium text-gray-800 truncate max-w-lg">{fileName}</p>
          <div className="flex items-center gap-3 shrink-0">
            {webUrl && (
              <a href={webUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline">Open in SharePoint ↗</a>
            )}
            <button onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-xl leading-none transition-colors px-1"
              aria-label="Close">✕</button>
          </div>
        </div>

        {/* Body — PDF left, AI analysis right */}
        <div className="flex flex-1 min-h-0">
          {/* PDF viewer */}
          <div className="flex-1 min-w-0 border-r border-gray-100">
            {loadErr ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400">
                <p className="text-sm">Could not load document.</p>
                {webUrl && (
                  <a href={webUrl} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-500 hover:underline">Open in SharePoint ↗</a>
                )}
              </div>
            ) : !blobUrl ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3 text-gray-400">
                  <div className="w-8 h-8 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin" />
                  <p className="text-sm">Loading document…</p>
                </div>
              </div>
            ) : (
              <iframe src={blobUrl} className="w-full h-full border-0" title={fileName} />
            )}
          </div>

          {/* Stage 1: per-doc extraction panel */}
          <div className="w-80 shrink-0 bg-gray-50/50 border-l border-gray-100">
            <DocExtractionPanel fileId={fileId} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Classify dropdown ────────────────────────────────────────────────────────
function ClassifyDropdown({
  docTypes,
  saving,
  onSelect,
  onCancel,
}: {
  docTypes: DocType[]
  saving: boolean
  onSelect: (code: string) => void
  onCancel: () => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(
    () => [...docTypes].sort((a, b) => a.label.localeCompare(b.label)),
    [docTypes]
  )

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onCancel()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onCancel])

  return (
    <div ref={wrapperRef} className="relative" onClick={e => e.stopPropagation()}>
      <div className="absolute left-0 top-0 w-64 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden" style={{ zIndex: 9999 }}>
        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500">Select document type</p>
          <button onClick={e => { e.stopPropagation(); onCancel() }} className="text-gray-300 hover:text-gray-500 text-lg leading-none">×</button>
        </div>
        <div className="max-h-64 overflow-y-auto overscroll-contain">
          {sorted.map(t => (
            <button
              key={t.code}
              disabled={saving}
              onClick={e => { e.stopPropagation(); onSelect(t.code) }}
              className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-lemon-400/10 hover:text-gray-900 transition-colors disabled:opacity-40 border-b border-gray-50 last:border-0"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Shared file row used inside each group ──────────────────────────────────
// ── Extraction status badge ────────────────────────────────────────────────
function ExtractionBadge({ file }: { file: CaseFile }) {
  if (!file.ai_extraction) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-100">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />Not extracted
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-100">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />Extracted
    </span>
  )
}

// ── Key facts inline from extraction ─────────────────────────────────────
function ExtractionFacts({ file }: { file: CaseFile }) {
  const ex = file.ai_extraction
  if (!ex || file.document_type_code !== 'repair_order') return null

  const dateIn   = ex.repair_date_in  as string | null
  const dateOut  = ex.repair_date_out as string | null
  const days     = ex.days_in_shop    as number | null
  const status   = ex.repair_status   as string | null
  const warranty = ex.warranty_repair as boolean | null

  const fmtDate  = (d: string) => {
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const statusColors: Record<string, string> = {
    completed:          'bg-green-50 text-green-700 border-green-100',
    unable_to_duplicate:'bg-red-50 text-red-700 border-red-100',
    parts_on_order:     'bg-amber-50 text-amber-700 border-amber-100',
    other:              'bg-gray-50 text-gray-600 border-gray-100',
  }

  return (
    <div className="flex items-center gap-2 flex-wrap mt-1.5">
      {dateIn && dateOut && (
        <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
          {fmtDate(dateIn)} – {fmtDate(dateOut)}
        </span>
      )}
      {days != null && (
        <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
          {days} day{days !== 1 ? 's' : ''} in shop
        </span>
      )}
      {status && (
        <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[status] ?? statusColors.other}`}>
          {status.replace(/_/g, ' ')}
        </span>
      )}
      {warranty === true && (
        <span className="text-xs text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">warranty</span>
      )}
    </div>
  )
}

function FileRow({
  f, docTypes, classifying, saving, caseId,
  onView, onStartClassify, onCancelClassify, onSave,
}: {
  f: CaseFile
  docTypes: DocType[]
  classifying: string | null
  saving: boolean
  caseId: string
  onView: () => void
  onStartClassify: () => void
  onCancelClassify: () => void
  onSave: (code: string) => void
}) {
  const isUnclassified = !f.is_classified
  const isPdf = f.file_extension?.toLowerCase() === 'pdf' || f.file_name.toLowerCase().endsWith('.pdf')

  const cardBase = isUnclassified ? 'border-amber-100 bg-amber-50/30' : 'border-gray-100 bg-white'
  const cardInteractive = isPdf
    ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-gray-300 hover:bg-gray-50 active:translate-y-0 active:shadow-sm'
    : ''

  const isClassifyingThis = classifying === f.id

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-all duration-150 ${cardBase} ${cardInteractive}`}
      style={{ position: 'relative', zIndex: isClassifyingThis ? 50 : undefined }}
      onClick={isPdf && !isClassifyingThis ? onView : undefined}
      role={isPdf && !isClassifyingThis ? 'button' : undefined}
    >
      {/* Name + badges */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm text-gray-800 font-medium truncate max-w-xs">{f.file_name}</span>
          {f.type_label && !isUnclassified && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">{f.type_label}</span>
          )}
          {f.size_bytes && <span className="text-xs text-gray-300 shrink-0">{formatBytes(f.size_bytes)}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExtractionBadge file={f} />
          {!isPdf && f.web_url && (
            <a href={f.web_url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs text-blue-500 hover:underline shrink-0">Open ↗</a>
          )}
        </div>
      </div>

      {/* Extracted key facts */}
      <ExtractionFacts file={f} />

      {/* Metadata */}
      <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap mt-1.5">
        {f.created_at_source && (
          <span>Uploaded {new Date(f.created_at_source).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        )}
        {f.created_by_name && <span>by {f.created_by_name}</span>}
        {f.modified_at_source && f.modified_at_source !== f.created_at_source && (
          <span className="text-gray-300">· Modified {new Date(f.modified_at_source).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        )}
      </div>
      {/* Classify control — only for unclassified */}
      {isUnclassified && (
        <div className="relative" onClick={e => e.stopPropagation()}>
          {classifying === f.id ? (
            <ClassifyDropdown
              docTypes={docTypes}
              saving={saving}
              onSelect={onSave}
              onCancel={onCancelClassify}
            />
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onStartClassify() }}
              className="text-xs text-amber-700 border border-amber-200 bg-amber-50 px-3 py-1 rounded-lg hover:bg-amber-100 transition-colors active:scale-95"
            >
              Classify ▾
            </button>
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
  const [staffId,   setStaffId]   = useState<string | null>(null)
  const [staffName, setStaffName] = useState<string | null>(null)
  const [caseUUID,  setCaseUUID]  = useState<string | null>(null)

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

  // ── Unified timeline state ────────────────────────────────────────────────
  type TimelineSource = 'event' | 'comm' | 'note'
  type TimelineFilter = 'all' | 'notes' | 'comms' | 'events'
  interface TimelineItem {
    source:       TimelineSource; id: string; ts: string; item_type: string
    body:         string | null;  author_ref: string | null; author_name: string | null
    visibility:   string;         is_pinned: boolean; payload: Record<string, unknown> | null
    direction:    'inbound' | 'outbound' | null
    needs_review: boolean
  }
  const [timelineItems,     setTimelineItems]     = useState<TimelineItem[]>([])
  const [timelineLoading,   setTimelineLoading]   = useState(false)
  const [timelineHasMore,   setTimelineHasMore]   = useState(false)
  const [timelineCursor,    setTimelineCursor]     = useState<string | null>(null)
  const [timelineFilter,    setTimelineFilter]     = useState<TimelineFilter>('all')
  const [seenIds,           setSeenIds]            = useState<Set<string>>(new Set())
  const [newItemIds,        setNewItemIds]          = useState<Set<string>>(new Set())
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as 'overview' | 'comms' | 'documents' | 'ai' | 'intake' | 'tasks') ?? 'overview'
  const [activeTab, setActiveTab] = useState<'overview' | 'comms' | 'documents' | 'ai' | 'intake' | 'tasks'>(initialTab)

  const switchTab = (tab: 'overview' | 'comms' | 'documents' | 'ai' | 'intake' | 'tasks') => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    if (tab === 'overview') {
      url.searchParams.delete('tab')
    } else {
      url.searchParams.set('tab', tab)
    }
    router.replace(url.pathname + (url.search || ''), { scroll: false })
  }
  const [taskCount, setTaskCount] = useState(0)
  const [staffList, setStaffList] = useState<{ id: string; display_name: string }[]>([])
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

  async function loadTimeline(opts?: { cursor?: string | null; append?: boolean }) {
    if (!params.id) return
    const cursor = opts?.cursor ?? null
    const append = opts?.append ?? false
    if (!append) setTimelineLoading(true)
    try {
      const urlParams = new URLSearchParams({ limit: '50' })
      if (cursor) urlParams.set('before_ts', cursor)
      const res = await fetch(`/api/cases/${params.id}/timeline?${urlParams}`)
      if (!res.ok) return
      const d = await res.json()
      const newItems: TimelineItem[] = d.items ?? []
      if (append) {
        setTimelineItems(prev => {
          const ids = new Set(prev.map(i => i.id))
          return [...prev, ...newItems.filter(i => !ids.has(i.id))]
        })
        setSeenIds(prev => { const next = new Set(prev); newItems.forEach(i => next.add(i.id)); return next })
      } else {
        setTimelineItems(newItems)
        setSeenIds(new Set(newItems.map(i => i.id)))
      }
      setTimelineHasMore(d.has_more ?? false)
      setTimelineCursor(d.next_cursor ?? null)
    } finally {
      setTimelineLoading(false)
    }
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
        setNoteBody(''); setNoteType('general'); setNoteVisibility('internal')
        setNotePinned(false); setShowNoteForm(false)
        loadTimeline()   // refresh full timeline
      }
    } finally { setNoteSaving(false) }
  }

  async function handleTogglePin(noteId: string, currentPinned: boolean) {
    const newPinned = !currentPinned
    setTimelineItems(prev => prev.map(i => i.id === noteId ? { ...i, is_pinned: newPinned } : i))
    try {
      const res = await fetch(`/api/cases/${params.id}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: newPinned }),
      })
      if (!res.ok) {
        setTimelineItems(prev => prev.map(i => i.id === noteId ? { ...i, is_pinned: currentPinned } : i))
      } else {
        setTimelineItems(prev =>
          [...prev.map(i => i.id === noteId ? { ...i, is_pinned: newPinned } : i)]
            .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || new Date(b.ts).getTime() - new Date(a.ts).getTime())
        )
      }
    } catch {
      setTimelineItems(prev => prev.map(i => i.id === noteId ? { ...i, is_pinned: currentPinned } : i))
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
        setCaseData(data.case ? cleanRecord(data.case) : null)
        setIntake(data.intake ? cleanRecord(data.intake) : null)
        setIntakeStatus(data.intakeStatus ?? null)
        setUserRole(data.userRole ?? 'staff')
        setStaffId(data.staffId ?? null)
        setStaffName(data.staffName ?? null)
        setCaseUUID(data.case?.id ?? null)

        // Fetch open task count for tab badge
        const taskRes = await fetch(`/api/cases/${params.id}/tasks`)
        if (taskRes.ok) {
          const taskData = await taskRes.json()
          const open = (taskData.tasks ?? []).filter(
            (t: { task_status: string }) =>
              t.task_status === 'open' || t.task_status === 'in_progress' || t.task_status === 'blocked'
          ).length
          setTaskCount(open)
        }

        // Fetch staff list for task assignee dropdown
        const staffRes = await fetch('/api/staff')
        if (staffRes.ok) {
          const staffData = await staffRes.json()
          setStaffList(staffData.staff ?? [])
        }
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
        setCaseData(prev => prev ? cleanRecord({ ...prev, ...payload.new! }) : cleanRecord(payload.new!))
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
  // Load unified timeline when comms tab opens
  useEffect(() => {
    if (activeTab === 'comms' && timelineItems.length === 0 && !timelineLoading) loadTimeline()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // ── Supabase Realtime — live timeline updates ─────────────────────────────
  // Subscribes once the case UUID is known. Listens for INSERTs on
  // core.communications, core.events, and core.timeline_notes, filtered
  // by case_id. Visibility rules applied client-side before inserting.
  useEffect(() => {
    if (!caseUUID) return
    let sb: ReturnType<typeof sbCreate> | null = null
    try {
      const { createClient: sbCreate2 } = require('@supabase/supabase-js')
      sb = sbCreate2(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    } catch (e) { console.warn('[Realtime] Supabase client init failed:', e); return }
    if (!sb) return
    const ELEVATED = ['admin', 'attorney', 'manager']

    function flashItem(id: string) {
      setNewItemIds(prev => new Set(prev).add(id))
      setTimeout(() => setNewItemIds(prev => { const n = new Set(prev); n.delete(id); return n }), 3000)
    }

    function prependItem(item: TimelineItem) {
      setSeenIds(prev => { if (prev.has(item.id)) return prev; return new Set(prev).add(item.id) })
      setTimelineItems(prev => {
        if (prev.find(i => i.id === item.id)) return prev
        return [item, ...prev]
      })
      flashItem(item.id)
    }

    let ch: ReturnType<typeof sb.channel> | null = null
    try { ch = sb
      .channel(`case-timeline-${caseUUID}`)

      // ── New communications ──
      .on('postgres_changes', {
        event: 'INSERT', schema: 'core', table: 'communications',
        filter: `case_id=eq.${caseUUID}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const r = payload.new
        const isInternal = Boolean(r.is_internal)
        if (isInternal && !ELEVATED.includes(userRole)) return  // visibility gate
        prependItem({
          source: 'comm', id: r.id as string, ts: r.occurred_at as string,
          item_type:   r.channel as string,
          body:        (r.snippet ?? r.body ?? null) as string | null,
          author_ref:  (r.from_number ?? r.sender_email ?? null) as string | null,
          author_name: null,
          visibility:  isInternal ? 'internal' : 'public',
          is_pinned:   false,
          payload:     null,
          direction:   (r.direction ?? null) as TimelineItem['direction'],
          needs_review: Boolean(r.needs_review),
        })
      })

      // ── New events ──
      .on('postgres_changes', {
        event: 'INSERT', schema: 'core', table: 'events',
        filter: `case_id=eq.${caseUUID}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const r = payload.new
        prependItem({
          source: 'event', id: String(r.id), ts: r.occurred_at as string,
          item_type:    r.event_type as string,
          body:         null,
          author_ref:   (r.actor ?? null) as string | null,
          author_name:  null,
          visibility:   'internal',
          is_pinned:    false,
          payload:      (r.payload ?? null) as Record<string, unknown> | null,
          direction:    null,
          needs_review: false,
        })
      })

      // ── New timeline notes ──
      .on('postgres_changes', {
        event: 'INSERT', schema: 'core', table: 'timeline_notes',
        filter: `case_id=eq.${caseUUID}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const r = payload.new
        const vis = r.visibility as string
        // Visibility gate
        if (vis === 'restricted' && !ELEVATED.includes(userRole)) return
        if (vis === 'private' && r.author_id !== staffId) return
        prependItem({
          source: 'note', id: r.id as string, ts: r.created_at as string,
          item_type:    r.note_type as string,
          body:         r.body as string,
          author_ref:   r.author_id as string,
          author_name:  r.author_id === staffId ? (staffName ?? 'Me') : null,
          visibility:   vis,
          is_pinned:    Boolean(r.is_pinned),
          payload:      null,
          direction:    null,
          needs_review: false,
        })
      })

      .subscribe()
    } catch (e) { console.warn('[Realtime] case timeline subscription failed:', e) }

    return () => { try { if (ch) sb.removeChannel(ch) } catch { /* ignore */ } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseUUID])

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
    { id: 'ai',         label: '✦ AI Analysis' },
    { id: 'tasks',      label: `Tasks${taskCount > 0 ? ` (${taskCount})` : ''}` },
    { id: 'intake',     label: 'Intake'     },
  ] as const

  return (
    <div className="p-4 md:p-8 max-w-screen-xl mx-auto">

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
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── Left: tabs + content ── */}
        <div className="flex-1 min-w-0">

          {/* Tab bar */}
          <div className="flex gap-0 border-b border-gray-100 mb-5 overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
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
          {activeTab === 'comms' && (() => {
            // ── Derived timeline data ────────────────────────────────────────
            const pinnedItems   = timelineItems.filter(i => i.source === 'note' && i.is_pinned)
            const filteredItems = timelineItems.filter(i => {
              if (i.source === 'note' && i.is_pinned) return false  // shown in pinned section
              if (timelineFilter === 'notes')  return i.source === 'note'
              if (timelineFilter === 'comms')  return i.source === 'comm'
              if (timelineFilter === 'events') return i.source === 'event'
              return true
            })
            const itemCounts = {
              notes:  timelineItems.filter(i => i.source === 'note').length,
              comms:  timelineItems.filter(i => i.source === 'comm').length,
              events: timelineItems.filter(i => i.source === 'event').length,
            }

            // ── Item rendering config ────────────────────────────────────────
            const ITEM_ICON: Record<string, string> = {
              // Events
              'case.created': '🎉', 'case.stage_changed': '➡️', 'case.updated': '✏️',
              'document.uploaded': '📄', 'document.classified': '🏷️', 'document.reviewed': '✅',
              'intake.submitted': '📋', 'intake.step_completed': '✔️',
              'sms.received': '💬', 'sms.sent': '💬', 'call.completed': '📞', 'call.missed': '📵',
              'voicemail.received': '📨', 'email.received': '✉️', 'email.sent': '✉️',
              // Comms
              sms: '💬', call: '📞', email: '✉️',
              // Note types
              general: '📝', call_summary: '📞', verbal_update: '💬',
              attorney_note: '⚖️', case_manager_note: '📋', milestone: '🏁',
              client_communication: '👤', intake_note: '📝',
            }
            const ITEM_COLOR: Record<string, string> = {
              event: 'bg-amber-50 text-amber-700',
              comm:  'bg-gray-100 text-gray-600',
              note:  'bg-blue-50 text-blue-700',
            }
            const VIS_CFG: Record<string, { label: string; cls: string }> = {
              public:     { label: 'Public',     cls: 'bg-green-50 text-green-700'  },
              internal:   { label: 'Internal',   cls: 'bg-blue-50 text-blue-700'    },
              restricted: { label: 'Restricted', cls: 'bg-orange-50 text-orange-700'},
              private:    { label: 'Private',    cls: 'bg-purple-50 text-purple-700'},
            }
            const EVENT_LABEL: Record<string, string> = {
              'case.created': 'Case Created', 'case.stage_changed': 'Stage Changed',
              'case.updated': 'Case Updated', 'document.uploaded': 'Document Uploaded',
              'document.classified': 'Doc Classified', 'document.reviewed': 'Doc Reviewed',
              'intake.submitted': 'Intake Submitted', 'intake.step_completed': 'Step Completed',
              'sms.received': 'SMS Received', 'sms.sent': 'SMS Sent',
              'call.completed': 'Call Completed', 'call.missed': 'Missed Call',
              'voicemail.received': 'Voicemail', 'email.received': 'Email Received', 'email.sent': 'Email Sent',
            }

            // ── Phone formatter ──────────────────────────────────────────────
            function formatPhone(raw: string | null): string {
              if (!raw) return ''
              const d = raw.replace(/\D/g, '')
              if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
              if (d.length === 10)                  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
              return raw
            }

            // ── Item renderer ────────────────────────────────────────────────
            function renderItem(item: TimelineItem) {
              const isNew    = newItemIds.has(item.id)
              const icon     = ITEM_ICON[item.item_type] ?? (item.source === 'event' ? '⚡' : item.source === 'comm' ? '💬' : '📝')
              const vis      = VIS_CFG[item.visibility]
              const pinCan   = (canManageNotes || staffId === item.author_ref) && item.source === 'note'

              // Direction styling for comms
              const isInbound  = item.source === 'comm' && item.direction === 'inbound'
              const isOutbound = item.source === 'comm' && item.direction === 'outbound'
              const dirBorder  = isInbound  ? 'border-l-2 border-l-blue-300'
                               : isOutbound ? 'border-l-2 border-l-gray-200'
                               : item.is_pinned ? 'border-l-2 border-l-yellow-400'
                               : ''

              // Author display
              const rawAuthor  = item.source === 'note'
                ? (item.author_name ?? 'Unknown')
                : item.source === 'comm'
                  ? (item.item_type === 'sms' || item.item_type === 'call'
                      ? formatPhone(item.author_ref)
                      : (item.author_ref ?? ''))
                  : (item.author_ref ?? '')

              // Type label
              const typeLabel = item.source === 'event'
                ? (EVENT_LABEL[item.item_type] ?? item.item_type)
                : item.source === 'comm'
                  ? item.item_type.toUpperCase()
                  : (NOTE_TYPE_LABELS[item.item_type] ?? item.item_type)

              // Comm source color: inbound=blue, outbound=gray, note=blue, event=amber
              const srcColor = item.source === 'comm'
                ? (isInbound ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600')
                : (ITEM_COLOR[item.source] ?? 'bg-gray-100 text-gray-500')

              return (
                <div
                  key={item.id}
                  className={`px-6 py-4 group transition-colors ${
                    isNew ? 'bg-lemon-400/10' : 'hover:bg-gray-50'
                  } ${dirBorder}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="shrink-0 mt-0.5 text-lg leading-none">{icon}</div>

                    <div className="flex-1 min-w-0">
                      {/* Badge row */}
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        {item.is_pinned && <span className="text-yellow-500 text-xs font-medium">📌</span>}
                        {isNew && <span className="text-xs font-semibold text-lemon-600 bg-lemon-400/20 px-1.5 py-0.5 rounded">NEW</span>}

                        {/* Direction for comms */}
                        {item.source === 'comm' && item.direction && (
                          <span className={`text-xs font-medium ${isInbound ? 'text-blue-500' : 'text-gray-400'}`}>
                            {isInbound ? '← Inbound' : '→ Outbound'}
                          </span>
                        )}

                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${srcColor}`}>
                          {typeLabel}
                        </span>

                        {/* Visibility badge (notes only) */}
                        {vis && item.source === 'note' && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${vis.cls}`}>
                            {vis.label}
                          </span>
                        )}

                        {/* Needs review flag */}
                        {item.needs_review && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                            ⚠ Needs Review
                          </span>
                        )}
                      </div>

                      {/* Body */}
                      {item.body && (
                        <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{item.body}</p>
                      )}
                      {!item.body && item.source === 'event' && item.payload && (
                        <p className="text-xs text-gray-400 font-mono truncate">
                          {JSON.stringify(item.payload).slice(0, 120)}
                        </p>
                      )}

                      {/* Meta */}
                      <p className="mt-1.5 text-xs text-gray-400">
                        {rawAuthor && <span className="mr-1.5 font-medium text-gray-500">{rawAuthor} ·</span>}
                        {fmtNoteTime(item.ts)}
                      </p>
                    </div>

                    {/* Pin toggle */}
                    {pinCan && (
                      <button
                        onClick={() => handleTogglePin(item.id, item.is_pinned)}
                        title={item.is_pinned ? 'Unpin' : 'Pin'}
                        className="opacity-0 group-hover:opacity-100 shrink-0 text-gray-300 hover:text-yellow-500 transition-all mt-0.5"
                      >
                        {item.is_pinned ? '📌' : '☆'}
                      </button>
                    )}
                  </div>
                </div>
              )
            }

            return (
              <div className="bg-white rounded-xl border border-gray-100 shadow-card overflow-hidden">

                {/* ── Timeline header ── */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
                  {/* Filter tabs */}
                  <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                    {([
                      { id: 'all',    label: `All (${timelineItems.length})` },
                      { id: 'notes',  label: `Notes${itemCounts.notes  ? ` (${itemCounts.notes})`  : ''}` },
                      { id: 'comms',  label: `Comms${itemCounts.comms  ? ` (${itemCounts.comms})`  : ''}` },
                      { id: 'events', label: `Events${itemCounts.events ? ` (${itemCounts.events})` : ''}` },
                    ] as { id: typeof timelineFilter; label: string }[]).map(f => (
                      <button
                        key={f.id}
                        onClick={() => setTimelineFilter(f.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all active:scale-95 ${
                          timelineFilter === f.id
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  {/* Add note + refresh */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadTimeline()}
                      className="text-gray-400 hover:text-gray-600 transition-colors text-sm"
                      title="Refresh timeline"
                    >↻</button>
                    <button
                      onClick={() => { setShowNoteForm(v => !v); setNoteError(null) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-lemon-400 hover:bg-lemon-500 text-gray-900 transition-all active:scale-95"
                    >
                      {showNoteForm ? '✕ Cancel' : '+ Add Note'}
                    </button>
                  </div>
                </div>

                {/* ── Add Note form ── */}
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
                          {canManageNotes && <option value="restricted">Restricted</option>}
                          <option value="private">Private (only me)</option>
                        </select>
                      </div>
                      <div className="flex items-end pb-2">
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                          <input type="checkbox" checked={notePinned} onChange={e => setNotePinned(e.target.checked)} className="w-3.5 h-3.5 accent-yellow-400" />
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
                      <button onClick={() => { setShowNoteForm(false); setNoteBody(''); setNoteError(null) }} className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
                      <button onClick={handleCreateNote} disabled={noteSaving || !noteBody.trim()} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition-all active:scale-95">
                        {noteSaving ? 'Saving…' : 'Save Note'}
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Pinned notes (always visible at top when filter = all|notes) ── */}
                {pinnedItems.length > 0 && (timelineFilter === 'all' || timelineFilter === 'notes') && (
                  <div className="border-b border-yellow-100 bg-yellow-50/40">
                    <p className="px-6 pt-3 pb-1 text-xs font-semibold text-yellow-600 uppercase tracking-widest">📌 Pinned</p>
                    <div className="divide-y divide-yellow-100">
                      {pinnedItems.map(item => renderItem(item))}
                    </div>
                  </div>
                )}

                {/* ── Main timeline feed ── */}
                {timelineLoading ? (
                  <div className="py-12 text-center text-gray-400 text-sm">Loading timeline…</div>
                ) : filteredItems.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-sm">
                    {timelineFilter === 'all' ? 'No timeline activity yet' : `No ${timelineFilter} found`}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {filteredItems.map(item => renderItem(item))}
                  </div>
                )}

                {/* ── Load more ── */}
                {timelineHasMore && (
                  <div className="px-6 py-3 border-t border-gray-100">
                    <button
                      onClick={() => loadTimeline({ cursor: timelineCursor, append: true })}
                      disabled={timelineLoading}
                      className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                    >
                      {timelineLoading ? 'Loading…' : 'Load older items'}
                    </button>
                  </div>
                )}

                {/* ── SMS Compose ── */}
                {userCanSms && (timelineFilter === 'all' || timelineFilter === 'comms') && (
                  <SmsCompose caseId={params.id as string} onSent={() => loadTimeline()} />
                )}

              </div>
            )
          })()}

          {/* ── Documents tab ── */}
          {activeTab === 'documents' && (
            <DocumentsSection
              caseId={params.id as string}
            />
          )}

          {/* ── AI Analysis tab ── */}
          {activeTab === 'ai' && (
            <AIAnalysisTab caseId={params.id as string} caseUUID={caseUUID} onSwitchToDocuments={() => switchTab('documents')} />
          )}

          {/* ── Tasks tab ── */}
          {activeTab === 'tasks' && (
            <TasksSection
              caseSlug={params.id as string}
              caseUUID={caseUUID}
              staffId={staffId}
              userRole={userRole}
              staffList={staffList}
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
        <div className="w-full lg:w-64 lg:shrink-0 lg:sticky top-6 space-y-4">

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
                onClick={() => switchTab('comms')}
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
