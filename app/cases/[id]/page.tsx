'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">{title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {children}
      </div>
    </div>
  )
}

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

  // Full content: use body if available, fall back to snippet
  const fullContent = comm.body || comm.snippet
  const hasContent = !!fullContent

  return (
    <div className={`px-6 py-4 transition-colors ${comm.needs_review ? 'border-l-4 border-l-yellow-400' : ''}`}>
      {/* Header row — always visible */}
      <div
        className="flex items-start justify-between gap-4 hover:bg-gray-50 -mx-6 px-6 py-1 rounded cursor-pointer"
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

            {/* Sender/recipient metadata */}
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

            {/* Collapsed preview */}
            {!expanded && comm.snippet && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2 max-w-2xl">{comm.snippet}</p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <p className="text-xs text-gray-400">{time}</p>
          {hasContent && (
            <span className="text-xs text-blue-500">{expanded ? '▲ collapse' : '▼ expand'}</span>
          )}
        </div>
      </div>

      {/* Expanded full content */}
      {expanded && (
        <div className="mt-3 ml-9 space-y-3">
          {fullContent && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                {comm.channel === 'call' ? 'Call Notes' : comm.channel === 'email' ? 'Email Body' : 'Content'}
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{fullContent}</p>
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

export default function CaseDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [caseData, setCaseData] = useState<CaseDetail | null>(null)
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

  useEffect(() => { loadComms(commChannel) }, [commChannel])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading case...</p>
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
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-5xl mx-auto flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
              <span>/</span>
              <a href="/cases" className="hover:text-gray-700">Cases</a>
              <span>/</span>
              <span className="text-gray-600">{clientName}</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{clientName}</h1>
              <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[c.case_status] ?? STATUS_COLORS.unknown}`}>
                {STATUS_LABELS[c.case_status] ?? c.case_status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{vehicle}</p>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <a
              href={`https://app.hubspot.com/contacts/47931752/deal/${c.hubspot_deal_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-orange-500 hover:text-orange-700 transition-colors"
            >
              View in HubSpot ↗
            </a>
            <button
              onClick={() => router.push('/cases' as never)}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              ← Back to queue
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-6 space-y-4">
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
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Notes</h2>
            {c.case_notes && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Case Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.case_notes}</p>
              </div>
            )}
            {c.internal_notes && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Internal Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.internal_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {c.tags && c.tags.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Tags</h2>
            <div className="flex flex-wrap gap-2">
              {c.tags.map(tag => (
                <span key={tag} className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Communications */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Communications</h2>
              {commTotal > 0 && (
                <span className="text-xs text-gray-400">{commTotal} total</span>
              )}
            </div>
            {/* Channel filter */}
            {commTotal > 0 && (
              <div className="flex gap-1">
                {[
                  { key: '', label: 'All' },
                  { key: 'call', label: `Calls${commCounts.call ? ` (${commCounts.call})` : ''}` },
                  { key: 'sms', label: `SMS${commCounts.sms ? ` (${commCounts.sms})` : ''}` },
                  { key: 'email', label: `Email${commCounts.email ? ` (${commCounts.email})` : ''}` },
                  { key: 'note', label: `Notes${commCounts.note ? ` (${commCounts.note})` : ''}` },
                ].filter(t => t.key === '' || commCounts[t.key])
                 .map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setCommChannel(tab.key)}
                    className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                      commChannel === tab.key
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {commsLoading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading communications...</div>
          ) : comms.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-gray-400 text-sm">No communications synced yet</p>
              <p className="text-gray-300 text-xs mt-1">Run sync-hubspot-comms.mjs --deal-id={c.hubspot_deal_id}</p>
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
