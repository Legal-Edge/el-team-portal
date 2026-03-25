'use client'

import React from 'react'
import { ALL_COLUMNS } from '@/lib/cases/column-defs'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CaseRecord {
  id:                  string
  hubspot_deal_id:     string
  case_number:         string | null
  client_first_name:   string | null
  client_last_name:    string | null
  client_email:        string | null
  client_phone:        string | null
  vehicle_year:        number | null
  vehicle_make:        string | null
  vehicle_model:       string | null
  vehicle_mileage:     number | null
  vehicle_is_new:      boolean | null
  state_jurisdiction:  string | null
  case_status:         string
  case_priority:       string | null
  estimated_value:     number | null
  notes_last_updated:  string | null
  created_at:          string
  updated_at:          string
  hubspot_properties:  Record<string, string | null> | null
  comms_state?: {
    sla_status:        string
    unread_count:      number
    awaiting_response: boolean
    response_due_at:   string | null
  } | null
  doc_state?: {
    total_docs:       number
    unclassified:     number
    needs_review:     number
    missing_required: number
  } | null
}

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

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  const now   = new Date()
  const days  = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysSince(d: string | null): number | null {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
}

function urgencyClass(c: CaseRecord): string {
  if (c.case_status === 'dropped' || c.case_status === 'settled') return 'border-l-gray-100'
  const days = daysSince(c.notes_last_updated ?? c.updated_at)
  if (days === null) return 'border-l-gray-100'
  if (days > 30) return 'border-l-red-400'
  if (days > 14) return 'border-l-amber-400'
  return 'border-l-emerald-400'
}

function getHpValue(c: CaseRecord, key: string): string | null {
  if (!c.hubspot_properties) return null
  return c.hubspot_properties[key] ?? null
}

function getCellValue(c: CaseRecord, colId: string): React.ReactNode {
  const colDef = ALL_COLUMNS.find(col => col.id === colId)
  if (!colDef) return null
  const { field, type } = colDef
  const isHp = field.startsWith('hp.')
  const hpKey = isHp ? field.slice(3) : null

  const raw = isHp && hpKey
    ? getHpValue(c, hpKey)
    : (c as unknown as Record<string, unknown>)[field] as string | null ?? null

  switch (colId) {
    case 'case_number':
      return raw
        ? <span className="font-mono text-xs text-gray-600">{String(raw)}</span>
        : <span className="text-gray-300">—</span>

    case 'client':
      return (
        <div>
          <div className="font-medium text-gray-900 leading-tight truncate max-w-[150px]">
            {[c.client_first_name, c.client_last_name].filter(Boolean).join(' ')
              || <span className="text-gray-300 italic text-xs">Unknown</span>}
          </div>
          {c.client_phone && (
            <a
              href={`tel:${c.client_phone}`}
              onClick={e => e.stopPropagation()}
              className="text-xs text-gray-400 hover:text-lemon-500 transition-colors block truncate max-w-[150px]"
            >
              {c.client_phone}
            </a>
          )}
        </div>
      )

    case 'vehicle':
      return (
        <div className="truncate max-w-[150px] text-gray-700">
          {[c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')
            || <span className="text-gray-300">—</span>}
        </div>
      )

    case 'state':
      return <span className="text-gray-700">{c.state_jurisdiction ?? <span className="text-gray-300">—</span>}</span>

    case 'stage':
      return (
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${STATUS_COLORS[c.case_status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABELS[c.case_status] ?? c.case_status}
        </span>
      )

    case 'case_manager':
      return raw ? <span className="text-gray-700 truncate max-w-[130px] block">{String(raw)}</span> : <span className="text-gray-300">—</span>

    case 'days_in_stage': {
      if (!raw) return <span className="text-gray-300">—</span>
      // HP stores ms, convert to days
      const ms = parseFloat(String(raw))
      const days = isNaN(ms) ? null : Math.floor(ms / (1000 * 60 * 60 * 24))
      return days !== null
        ? <span className={`tabular-nums ${days > 30 ? 'text-red-500 font-medium' : days > 14 ? 'text-amber-500' : 'text-gray-600'}`}>{days}d</span>
        : <span className="text-gray-300">—</span>
    }

    case 'last_activity': {
      const activity = c.notes_last_updated ?? c.updated_at
      const days = daysSince(activity)
      return (
        <span className={`text-xs tabular-nums ${
          days !== null && days > 30 ? 'text-red-500 font-medium' :
          days !== null && days > 14 ? 'text-amber-500 font-medium' : 'text-gray-500'
        }`}>
          {fmtDate(activity)}
        </span>
      )
    }

    case 'settlement_amount': {
      const n = raw ? parseFloat(String(raw)) : null
      return n
        ? <span className="tabular-nums text-gray-700">${n.toLocaleString()}</span>
        : <span className="text-gray-300">—</span>
    }

    case 'demand_sent':
    case 'settled_date':
      return raw ? <span className="text-gray-600 text-xs tabular-nums">{fmtDate(String(raw))}</span> : <span className="text-gray-300">—</span>

    default:
      return raw
        ? <span className="text-gray-700 truncate block max-w-[130px]">{String(raw)}</span>
        : <span className="text-gray-300">—</span>
  }
}

interface Props {
  c: CaseRecord
  columns: string[]
  isFlashed: boolean
  isLastViewed: boolean
  queueIds: string[]
  queueIdx: number
  activeStage: string
  onRef?: (el: HTMLTableRowElement | null) => void
}

export function CaseRow({ c, columns, isFlashed, isLastViewed, queueIds, queueIdx, activeStage, onRef }: Props) {
  function handleClick() {
    const returnParams = new URLSearchParams()
    if (activeStage) returnParams.set('status', activeStage)
    const returnUrl = '/cases' + (returnParams.toString() ? '?' + returnParams.toString() : '')
    sessionStorage.setItem('case_queue', JSON.stringify({ ids: queueIds, idx: queueIdx, returnUrl }))
    sessionStorage.setItem('last_viewed_case_id', c.hubspot_deal_id)
    window.open(`/cases/${c.hubspot_deal_id}`, '_blank')
  }

  const rowClass = isFlashed
    ? 'bg-lemon-400/10 border-l-lemon-400'
    : isLastViewed
    ? 'bg-blue-50/60 border-l-blue-400'
    : `hover:bg-gray-50 ${urgencyClass(c)}`

  return (
    <tr
      ref={onRef}
      onClick={handleClick}
      className={`cursor-pointer transition-all duration-500 border-l-4 h-11 ${rowClass}`}
    >
      <td className="w-0 p-0" />
      {columns.map(colId => (
        <td
          key={colId}
          className="px-3 py-2.5 text-sm first:pl-5 last:pr-5 align-middle"
          style={{ width: ALL_COLUMNS.find(c => c.id === colId)?.width }}
        >
          {getCellValue(c, colId)}
        </td>
      ))}
    </tr>
  )
}
