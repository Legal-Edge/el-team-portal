export interface ColumnDef {
  id: string
  label: string
  field: string  // 'client_first_name' or 'hp.nurture__reason_'
  width: number
  sortable: boolean
  type: 'text' | 'date' | 'badge' | 'number' | 'phone' | 'days'
  stageDefault?: string[]
}

export const ALL_COLUMNS: ColumnDef[] = [
  { id: 'case_number',        label: 'Deal ID',         field: 'hubspot_deal_id',                     width: 120, sortable: false, type: 'text'   },
  { id: 'client',             label: 'Client',           field: 'client_first_name',                   width: 160, sortable: true,  type: 'text'   },
  { id: 'vehicle',            label: 'Vehicle',          field: 'vehicle_year',                        width: 160, sortable: false, type: 'text'   },
  { id: 'state',              label: 'State',            field: 'state_jurisdiction',                  width: 60,  sortable: true,  type: 'text'   },
  { id: 'stage',              label: 'Stage',            field: 'case_status',                         width: 120, sortable: true,  type: 'badge'  },
  { id: 'case_manager',       label: 'Case Manager',     field: 'hp.case_manager',                     width: 140, sortable: false, type: 'text'   },
  { id: 'days_in_stage',      label: 'Days in Stage',    field: 'hp.hs_v2_time_in_current_stage',      width: 110, sortable: false, type: 'days'   },
  { id: 'last_activity',      label: 'Last Activity',    field: 'notes_last_updated',                  width: 110, sortable: true,  type: 'date'   },
  { id: 'nurture_reason',     label: 'Nurture Reason',   field: 'hp.nurture__reason_',                 width: 160, sortable: false, type: 'text',   stageDefault: ['nurture'] },
  { id: 'follow_up_attempts', label: 'Follow-up',        field: 'hp.client_follow_up_attempts',        width: 100, sortable: false, type: 'text',   stageDefault: ['nurture'] },
  { id: 'doc_status',         label: 'Doc Status',       field: 'hp.document_collection_status',       width: 130, sortable: false, type: 'text',   stageDefault: ['document_collection'] },
  { id: 'review_decision',    label: 'Review Decision',  field: 'hp.attorney_review_decision',         width: 140, sortable: false, type: 'text',   stageDefault: ['attorney_review'] },
  { id: 'legal_stage',        label: 'Legal Stage',      field: 'hp.current_legal_stage',              width: 140, sortable: false, type: 'text',   stageDefault: ['retained'] },
  { id: 'demand_sent',        label: 'Demand Sent',      field: 'hp.date___demand_sent',               width: 110, sortable: false, type: 'date',   stageDefault: ['retained'] },
  { id: 'settlement_amount',  label: 'Settlement',       field: 'hp.c__total_settlement_amount',       width: 110, sortable: false, type: 'number', stageDefault: ['settled'] },
  { id: 'settled_date',       label: 'Settled Date',     field: 'hp.date___settled',                   width: 110, sortable: false, type: 'date',   stageDefault: ['settled'] },
]

export const DEFAULT_COLUMNS = [
  'case_number', 'client', 'vehicle', 'state', 'stage', 'case_manager', 'days_in_stage', 'last_activity',
]

export function getDefaultColumnsForStage(stage: string): string[] {
  const stageSpecific = ALL_COLUMNS
    .filter(c => c.stageDefault?.includes(stage))
    .map(c => c.id)
  return [...DEFAULT_COLUMNS.filter(c => c !== 'stage'), ...stageSpecific]
}

// ── Filter types ──────────────────────────────────────────────────────────────

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'is_any_of'
  | 'is_none_of'
  | 'is_known'
  | 'is_unknown'
  | 'greater_than'
  | 'less_than'

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is:           'is',
  is_not:       'is not',
  contains:     'contains',
  not_contains: 'does not contain',
  is_any_of:    'is any of',
  is_none_of:   'is none of',
  is_known:     'is known',
  is_unknown:   'is unknown',
  greater_than: 'is greater than',
  less_than:    'is less than',
}

export interface FilterCondition {
  id: string
  field: string        // column .field or 'hp.xxx'
  fieldLabel: string
  operator: FilterOperator
  value: string        // comma-separated for any_of / none_of
}

export interface FilterGroup {
  id: string
  logic: 'AND' | 'OR'
  conditions: FilterCondition[]
}

export interface CaseView {
  id: string
  name: string
  owner_id: string | null
  is_team_preset: boolean
  stage_tab: string | null
  columns: string[]
  filters: FilterGroup[]
  sort_by: string
  sort_dir: 'asc' | 'desc'
  position: number
}

// Searchable field list for filter builder (core + common HP fields)
export interface FilterField {
  id: string      // the `field` value used in FilterCondition
  label: string
  group: string
}

export const FILTER_FIELDS: FilterField[] = [
  // Core fields
  { id: 'case_status',       label: 'Stage',         group: 'Case' },
  { id: 'case_number',       label: 'Case #',        group: 'Case' },
  { id: 'state_jurisdiction',label: 'State',         group: 'Case' },
  { id: 'case_priority',     label: 'Priority',      group: 'Case' },
  { id: 'estimated_value',   label: 'Est. Value',    group: 'Case' },
  { id: 'notes_last_updated',label: 'Last Activity', group: 'Case' },
  { id: 'created_at',        label: 'Date Created',  group: 'Case' },
  // Client
  { id: 'client_first_name', label: 'First Name',    group: 'Client' },
  { id: 'client_last_name',  label: 'Last Name',     group: 'Client' },
  { id: 'client_email',      label: 'Email',         group: 'Client' },
  { id: 'client_phone',      label: 'Phone',         group: 'Client' },
  // Vehicle
  { id: 'vehicle_year',      label: 'Year',          group: 'Vehicle' },
  { id: 'vehicle_make',      label: 'Make',          group: 'Vehicle' },
  { id: 'vehicle_model',     label: 'Model',         group: 'Vehicle' },
  // HubSpot properties
  { id: 'hp.case_manager',                   label: 'Case Manager',          group: 'HubSpot' },
  { id: 'hp.nurture__reason_',               label: 'Nurture Reason',        group: 'HubSpot' },
  { id: 'hp.client_follow_up_attempts',      label: 'Follow-up Attempts',    group: 'HubSpot' },
  { id: 'hp.document_collection_status',     label: 'Doc Collection Status', group: 'HubSpot' },
  { id: 'hp.attorney_review_decision',       label: 'Atty Review Decision',  group: 'HubSpot' },
  { id: 'hp.current_legal_stage',            label: 'Legal Stage',           group: 'HubSpot' },
  { id: 'hp.date___demand_sent',             label: 'Demand Sent',           group: 'HubSpot' },
  { id: 'hp.c__total_settlement_amount',     label: 'Settlement Amount',     group: 'HubSpot' },
  { id: 'hp.date___settled',                 label: 'Settled Date',          group: 'HubSpot' },
  { id: 'hp.hs_v2_time_in_current_stage',    label: 'Days in Stage',         group: 'HubSpot' },
  { id: 'hp.dealname',                       label: 'Deal Name',             group: 'HubSpot' },
  { id: 'hp.vin',                            label: 'VIN',                   group: 'HubSpot' },
  { id: 'hp.lemon_law_state',                label: 'Lemon Law State',       group: 'HubSpot' },
]
