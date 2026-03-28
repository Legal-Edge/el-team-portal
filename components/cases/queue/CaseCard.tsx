'use client'

import React from 'react'
import type { CaseRecord } from './CaseRow'

const STATUS_LABELS: Record<string, string> = {
  intake:              'Intake',
  nurture:             'Nurture',
  document_collection: 'Doc Collection',
  attorney_review:     'Atty Review',
  info_needed:         'Info Needed',
  sign_up:             'Sign Up',
  retained:            'Retained',
  settled:             'Settled',
  dropped:             'Dropped',
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
}

const URGENCY_BORDER: Record<string, string> = {
  red:    'border-l-red-400',
  amber:  'border-l-amber-400',
  green:  'border-l-emerald-400',
  gray:   'border-l-gray-100',
}

function fmtRelative(d: string | null): string {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function urgencyColor(c: CaseRecord): string {
  if (c.case_status === 'dropped' || c.case_status === 'settled') return 'gray'
  const days = c.last_engagement_at ?? c.notes_last_updated ?? c.updated_at
  const d = Math.floor((Date.now() - new Date(days).getTime()) / (1000 * 60 * 60 * 24))
  if (d > 30) return 'red'
  if (d > 14) return 'amber'
  return 'green'
}

interface Props {
  c:           CaseRecord
  isFlashed:   boolean
  isLastViewed: boolean
  queueIds:    string[]
  queueIdx:    number
  activeStage: string
}

export function CaseCard({ c, isFlashed, isLastViewed, queueIds, queueIdx, activeStage }: Props) {
  const clientName = [c.client_first_name, c.client_last_name].filter(Boolean).join(' ') || 'Unknown'
  const vehicle    = [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || null
  const activity   = c.last_engagement_at ?? c.notes_last_updated ?? null
  const urgency    = URGENCY_BORDER[urgencyColor(c)]
  const cmName     = c.hubspot_properties?.['case_manager_name'] as string | undefined

  // Days in stage
  const enteredRaw = c.hubspot_properties?.['hs_v2_time_in_current_stage'] as string | undefined
  let daysInStage: number | null = null
  if (enteredRaw) {
    const ms = Date.now() - new Date(enteredRaw).getTime()
    daysInStage = isNaN(ms) ? null : Math.floor(ms / (1000 * 60 * 60 * 24))
  }

  function handleTap() {
    const returnParams = new URLSearchParams()
    if (activeStage) returnParams.set('status', activeStage)
    const returnUrl = '/cases' + (returnParams.toString() ? '?' + returnParams.toString() : '')
    sessionStorage.setItem('case_queue', JSON.stringify({ ids: queueIds, idx: queueIdx, returnUrl }))
    sessionStorage.setItem('last_viewed_case_id', c.hubspot_deal_id)
    window.open(`/cases/${c.hubspot_deal_id}`, '_blank')
  }

  const baseClass = isFlashed
    ? 'bg-lemon-400/10 border-l-lemon-400'
    : isLastViewed
    ? 'bg-blue-50/60 border-l-blue-400'
    : `bg-white ${urgency}`

  return (
    <button
      onClick={handleTap}
      className={`w-full text-left border-l-4 border-b border-gray-100 px-4 py-3.5 active:bg-gray-50 transition-colors ${baseClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: name + vehicle */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{clientName}</p>
          {vehicle && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{vehicle}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[c.case_status] ?? 'bg-gray-100 text-gray-500'}`}>
              {STATUS_LABELS[c.case_status] ?? c.case_status}
            </span>
            {c.state_jurisdiction && (
              <span className="text-xs text-gray-400">{c.state_jurisdiction}</span>
            )}
          </div>
        </div>

        {/* Right: activity + days in stage */}
        <div className="shrink-0 flex flex-col items-end gap-1 text-right">
          <span className="text-xs text-gray-400">{fmtRelative(activity)}</span>
          {daysInStage !== null && (
            <span className={`text-xs tabular-nums font-medium ${
              daysInStage > 30 ? 'text-red-500' :
              daysInStage > 14 ? 'text-amber-500' : 'text-gray-400'
            }`}>
              {daysInStage}d in stage
            </span>
          )}
          {cmName && (
            <span className="text-xs text-gray-400 truncate max-w-[100px]">{cmName}</span>
          )}
        </div>
      </div>
    </button>
  )
}
