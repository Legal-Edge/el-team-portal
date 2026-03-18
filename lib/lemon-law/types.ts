// Shared types for the lemon law analysis engine

export type Decision = 'retain' | 'nurture' | 'drop' | 'clarification_needed'
export type CauseOfAction = 'state_lemon_law' | 'magnuson_moss' | 'both'
export type Confidence = 'high' | 'medium' | 'low'

export interface StateLaw {
  name:           string
  statute:        string
  repairAttempts: number          // same defect threshold
  safetyAttempts: number          // safety defect threshold
  daysOOS:        number          // cumulative days out of service
  windowMonths:   number          // warranty window months from delivery
  windowMiles:    number          // warranty window mileage from delivery
  usedCovered:    boolean         // does this state cover used vehicles?
  leaseCovered:   boolean
  noticeRequired: boolean
  arbitrationRequired: boolean
  remedies:       string
  keyNuances:     string
}

export interface DefectGroup {
  category:   string              // e.g. "transmission", "electrical", "brakes"
  complaints: string[]            // raw complaint strings from ROs
  attempts:   number              // # of RO visits for this defect
  dates:      string[]            // repair_date_in for each attempt
  isSafety:   boolean             // qualifies as safety defect
}

export interface RepairRecord {
  file_name:      string
  repair_date_in: string | null
  repair_date_out: string | null
  days_in_shop:   number | null
  complaint:      string | null
  diagnosis:      string | null
  work_performed: string | null
  mileage_in:     number | null
  is_warranty:    boolean         // true if warranty-covered repair
}

export interface EngineInput {
  state:          string | null
  purchase_date:  string | null   // YYYY-MM-DD
  vehicle_year:   number | null
  vehicle_make:   string | null
  new_or_used:    'new' | 'used' | 'certified' | null
  purchase_lease: 'purchase' | 'lease' | null
  repairs:        RepairRecord[]
  mileage_at_intake: number | null  // current mileage from intake form
}

export interface QualificationResult {
  // Deterministic engine output
  total_repair_attempts:   number
  total_days_oos:          number
  defect_groups:           DefectGroup[]
  safety_defects:          string[]
  max_attempts_per_defect: number
  within_state_window:     boolean | null   // null = cannot determine (missing purchase date)
  state_law:               StateLaw | null
  
  // Threshold checks
  meets_state_repair_threshold:   boolean
  meets_state_safety_threshold:   boolean
  meets_state_oos_threshold:      boolean
  meets_federal_threshold:        boolean
  
  // Decision
  decision:                Decision
  confidence:              Confidence
  confidence_score:        number
  cause_of_action:         CauseOfAction | null
  
  // Attorney-facing output
  retain_signals:          string[]
  risk_factors:            string[]
  nurture_reason:          string | null
  drop_reason:             string | null
  clarification_needed:    string[]
  missing_data:            string[]
}
