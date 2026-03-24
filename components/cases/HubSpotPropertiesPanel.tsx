'use client'

import { useState } from 'react'

// ── Field group definitions ───────────────────────────────────────────────────
// Each group defines which HubSpot property keys to display and how to label them

interface FieldDef {
  key:    string    // HubSpot property name
  label:  string   // Display label
  format?: 'date' | 'currency' | 'ms_duration' | 'phone'
}

interface Group {
  id:     string
  label:  string
  icon:   string
  fields: FieldDef[]
  source: 'deal' | 'contact'
}

const GROUPS: Group[] = [
  {
    id: 'activity', label: 'Activity', icon: '⚡', source: 'deal',
    fields: [
      { key: 'notes_last_contacted',          label: 'Last Contacted',        format: 'date' },
      { key: 'notes_last_updated',            label: 'Last Activity',         format: 'date' },
      { key: 'notes_next_activity_date',      label: 'Next Activity',         format: 'date' },
      { key: 'num_contacted_notes',           label: 'Contact Attempts' },
      { key: 'num_notes',                     label: 'Total Activities' },
      { key: 'hs_v2_date_entered_current_stage', label: 'Entered Stage',      format: 'date' },
      { key: 'hs_v2_time_in_current_stage',   label: 'Time in Stage',         format: 'ms_duration' },
    ],
  },
  {
    id: 'nurture', label: 'Nurture', icon: '🌱', source: 'deal',
    fields: [
      { key: 'nurture__reason_',              label: 'Nurture Reason' },
      { key: 'nurture__notes_',               label: 'Nurture Notes' },
      { key: 'intake_hubspot_qualifier',      label: 'Qualifier' },
      { key: 'intake_automation_log',         label: 'Automation Log' },
    ],
  },
  {
    id: 'vehicle', label: 'Vehicle', icon: '🚗', source: 'deal',
    fields: [
      { key: 'vehicle_issues',                label: 'Vehicle Issues' },
      { key: 'summary_of_repairs',            label: 'Summary of Repairs' },
      { key: 'repair_attempts',               label: 'Repair Attempts' },
      { key: 'last_repair_attempt_date',      label: 'Last Repair Date',      format: 'date' },
      { key: 'total_days_out_of_service',     label: 'Days Out of Service' },
      { key: 'mileage_at_the_time_of_purchase__lease', label: 'Mileage at Purchase' },
      { key: 'facility_name_purchased__leased', label: 'Purchased At' },
      { key: 'purchase__lease_agreement_amount', label: 'Purchase Amount',    format: 'currency' },
      { key: 'purchase__lease_agreement_taxes',  label: 'Taxes',              format: 'currency' },
      { key: 'purchase__lease_agreement_rebate', label: 'Rebate',             format: 'currency' },
      { key: 'was_your_car_in_the_repair_shop_for_more_than_30_days_at_any_time_', label: 'In Shop 30+ Days' },
      { key: 'do_you_still_have_the_vehicle__or_have_you_sold__returned__or_traded_it_in_', label: 'Vehicle Status' },
    ],
  },
  {
    id: 'problems', label: 'Reported Problems', icon: '⚠️', source: 'deal',
    fields: [
      { key: 'most_common_problem__notes_',   label: 'Problem 1' },
      { key: 'most_common_problem_repair_attempts', label: 'Problem 1 Repairs' },
      { key: 'most_common_problem_status',    label: 'Problem 1 Status' },
      { key: 'second_common_problem__notes_', label: 'Problem 2' },
      { key: 'second_common_problem_repair_attempts', label: 'Problem 2 Repairs' },
      { key: 'third_common_problem__notes_',  label: 'Problem 3' },
      { key: 'third_common_problem_repair_attempts', label: 'Problem 3 Repairs' },
      { key: 'fourth_common_problem__notes_', label: 'Problem 4' },
      { key: 'have_you_had_any_repairs_done_to_your_vehicle_', label: 'Had Repairs' },
      { key: 'how_many_repairs_have_you_had_done_to_your_vehicle_', label: 'Repair Count' },
      { key: 'did_you_have_to_pay_for_the_repairs_', label: 'Paid for Repairs' },
    ],
  },
  {
    id: 'manufacturer', label: 'Manufacturer', icon: '🏭', source: 'deal',
    fields: [
      { key: 'have_you_or_the_dealership_contacted_the_manufacturer_of_your_vehicle_', label: 'Contacted Mfr' },
      { key: 'did_the_manufacturer_offer_a_solution_like_a_refund__exchange_or_additional_repair_coverage_', label: 'Mfr Offer' },
      { key: 'what_were_the_exact_terms_of_the_manufacturer_offer_', label: 'Offer Terms' },
    ],
  },
  {
    id: 'legal', label: 'Legal', icon: '⚖️', source: 'deal',
    fields: [
      { key: 'legal_strength__l__m__h_',      label: 'Case Strength' },
      { key: 'legal_issues___grounds',         label: 'Legal Issues' },
      { key: 'cause_of_action',                label: 'Cause of Action' },
      { key: 'statute',                        label: 'Statute' },
      { key: 'sol_deadline',                   label: 'SOL Deadline',          format: 'date' },
      { key: 'case_summary',                   label: 'Case Summary' },
      { key: 'attorney_comments',              label: 'Attorney Comments' },
      { key: 'attorney_review_decision',       label: 'Attorney Decision' },
      { key: 'case_preparation_questions',     label: 'Case Prep Questions' },
      { key: 'do_you_have_the_repair_documents__or_would_you_need_to_get_it_from_the_dealership_', label: 'Has Repair Docs' },
      { key: 'would_you_prefer_a_full_refund__or_keep_your_car_and_get_a_partial_refund_', label: 'Refund Preference' },
    ],
  },
  {
    id: 'financials', label: 'Financials', icon: '💰', source: 'deal',
    fields: [
      { key: 'amount',                         label: 'Deal Amount',           format: 'currency' },
      { key: 'estimated_damages',              label: 'Est. Damages',          format: 'currency' },
      { key: 'initial_demand_amount',          label: 'Initial Demand',        format: 'currency' },
      { key: 'pending_total_settlement_amount',label: 'Pending Settlement',    format: 'currency' },
      { key: 'forecasted_attorneys_fees',      label: 'Forecast Atty Fees',   format: 'currency' },
      { key: 'attorneys_fees',                 label: 'Final Atty Fees',       format: 'currency' },
      { key: 'settlement_type',                label: 'Settlement Type' },
    ],
  },
  {
    id: 'team', label: 'Team', icon: '👥', source: 'deal',
    fields: [
      { key: 'handling_attorney',              label: 'Handling Attorney' },
      { key: 'case_manager',                   label: 'Case Manager' },
      { key: 'paralegal',                      label: 'Paralegal' },
      { key: 'case_resolution_manager',        label: 'Resolution Manager' },
      { key: 'assistant_case_manager',         label: 'Assistant CM' },
      { key: 'intake_associate',               label: 'Intake Associate' },
      { key: 'hs_synced_deal_owner_name_and_email', label: 'Deal Owner' },
    ],
  },
  {
    id: 'contact', label: 'Contact Details', icon: '👤', source: 'contact',
    fields: [
      { key: 'firstname',                      label: 'First Name' },
      { key: 'lastname',                       label: 'Last Name' },
      { key: 'phone',                          label: 'Phone',                 format: 'phone' },
      { key: 'mobilephone',                    label: 'Mobile',                format: 'phone' },
      { key: 'email',                          label: 'Email' },
      { key: 'address',                        label: 'Address' },
      { key: 'city',                           label: 'City' },
      { key: 'state',                          label: 'State' },
      { key: 'zip',                            label: 'Zip' },
      { key: 'how_did_you_hear_about_us_',     label: 'Lead Source' },
      { key: 'hs_lead_status',                 label: 'Lead Status' },
    ],
  },
]

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtValue(val: unknown, format?: FieldDef['format']): string | null {
  if (val === null || val === undefined || val === '') return null
  const s = String(val).trim()
  if (!s) return null

  if (format === 'date') {
    const ms = /^\d{13}$/.test(s) ? parseInt(s) : NaN
    const d = ms ? new Date(ms) : new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (format === 'currency') {
    const n = parseFloat(s.replace(/,/g, ''))
    return isNaN(n) ? s : `$${n.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
  }
  if (format === 'ms_duration') {
    const ms = parseInt(s)
    if (isNaN(ms)) return s
    const days  = Math.floor(ms / 86_400_000)
    const hours = Math.floor((ms % 86_400_000) / 3_600_000)
    if (days > 0) return `${days}d ${hours}h`
    return `${hours}h`
  }
  if (format === 'phone') {
    const d = s.replace(/\D/g, '')
    if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
    if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  }
  return s
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  dealProps:    Record<string, unknown> | null
  contactProps: Record<string, unknown> | null
  syncedAt:     string | null
}

export function HubSpotPropertiesPanel({ dealProps, contactProps, syncedAt }: Props) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['activity', 'vehicle', 'problems']))

  function toggle(id: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (!dealProps) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
        No HubSpot data synced yet.{' '}
        <span className="text-xs">Trigger a sync by updating any field in HubSpot.</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {syncedAt && (
        <p className="text-xs text-gray-400 text-right">
          Last synced {new Date(syncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
      )}

      {GROUPS.map(group => {
        const source = group.source === 'deal' ? dealProps : contactProps
        if (!source) return null

        // Only show fields with values
        const populated = group.fields
          .map(f => ({ ...f, value: fmtValue(source[f.key], f.format) }))
          .filter(f => f.value)

        if (populated.length === 0) return null

        const isOpen = openGroups.has(group.id)

        return (
          <div key={group.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => toggle(group.id)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">{group.icon}</span>
                <span className="text-sm font-semibold text-gray-800">{group.label}</span>
                <span className="text-xs text-gray-400 font-normal">{populated.length} field{populated.length !== 1 ? 's' : ''}</span>
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className="px-5 pb-5 pt-1 border-t border-gray-50">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-3">
                  {populated.map(f => (
                    <div key={f.key}>
                      <p className="text-xs text-gray-400 mb-0.5">{f.label}</p>
                      <p className="text-sm text-gray-800 break-words">{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
