// ─────────────────────────────────────────────────────────────────────────────
// SOL (Statute of Limitations) Calculator
//
// State Lemon Law SOL  = purchase_date + state window (months), capped by mileage
// Magnuson-Moss SOL    = purchase_date + 4 years (federal)
//
// If purchase_date is unknown, estimate from vehicle_year (July 1 of that year)
// Basis: 'facts' | 'estimated'
// ─────────────────────────────────────────────────────────────────────────────

import { getStateLaw } from './states'

export type SOLBasis = 'facts' | 'estimated' | 'unknown'

export interface SOLResult {
  state_sol_date:       string | null   // ISO date YYYY-MM-DD
  federal_sol_date:     string | null   // ISO date YYYY-MM-DD
  basis:                SOLBasis
  confidence_score:     number          // 0–100
  estimated_purchase:   string | null   // the date used for calculation
  state_window_months:  number | null
  state_window_miles:   number | null
  days_until_state_sol: number | null   // negative = already expired
  days_until_fed_sol:   number | null
  state_sol_expired:    boolean
  federal_sol_expired:  boolean
  state_sol_urgent:     boolean         // < 90 days
  federal_sol_urgent:   boolean         // < 90 days
  state_name:           string | null
  notes:                string[]
}

export function calculateSOL(params: {
  purchase_date:  string | null | undefined
  vehicle_year:   number | null | undefined
  state:          string | null | undefined
  current_mileage?: number | null
}): SOLResult {
  const { purchase_date, vehicle_year, state, current_mileage } = params
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const notes: string[] = []

  // ── 1. Determine anchor date + basis ──────────────────────────────────────
  let anchorDate:   Date | null = null
  let basis:        SOLBasis    = 'unknown'
  let confidence                = 0
  let estimatedPurchase: string | null = null

  if (purchase_date) {
    anchorDate = new Date(purchase_date)
    if (!isNaN(anchorDate.getTime())) {
      basis      = 'facts'
      confidence = 90
      estimatedPurchase = purchase_date
    } else {
      anchorDate = null
    }
  }

  if (!anchorDate && vehicle_year) {
    // Estimate: July 1 of vehicle year (mid-year conservative)
    anchorDate    = new Date(`${vehicle_year}-07-01`)
    basis         = 'estimated'
    confidence    = 55
    estimatedPurchase = `${vehicle_year}-07-01`
    notes.push(`Purchase date estimated as July 1, ${vehicle_year} — provide purchase agreement for accurate SOL`)
  }

  if (!anchorDate) {
    return {
      state_sol_date:       null,
      federal_sol_date:     null,
      basis:                'unknown',
      confidence_score:     0,
      estimated_purchase:   null,
      state_window_months:  null,
      state_window_miles:   null,
      days_until_state_sol: null,
      days_until_fed_sol:   null,
      state_sol_expired:    false,
      federal_sol_expired:  false,
      state_sol_urgent:     false,
      federal_sol_urgent:   false,
      state_name:           null,
      notes:                ['Cannot calculate SOL — no purchase date or vehicle year available'],
    }
  }

  // ── 2. State Lemon Law SOL ────────────────────────────────────────────────
  const stateLaw       = state ? getStateLaw(state.toUpperCase()) : null
  let stateSolDate:    Date | null = null
  let stateWindowMonths: number | null = null
  let stateWindowMiles:  number | null = null

  if (stateLaw) {
    stateWindowMonths = stateLaw.windowMonths
    stateWindowMiles  = stateLaw.windowMiles

    stateSolDate = new Date(anchorDate)
    stateSolDate.setMonth(stateSolDate.getMonth() + Number(stateWindowMonths))

    // If mileage cap already passed, SOL is effectively expired regardless of date
    if (current_mileage && stateWindowMiles < 999999 && current_mileage > stateWindowMiles) {
      notes.push(`Mileage (${current_mileage.toLocaleString()} mi) exceeds state window (${stateWindowMiles.toLocaleString()} mi) — state lemon law window may be closed`)
      confidence = Math.max(confidence - 10, 0)
    }

    if (basis === 'facts') confidence = Math.min(confidence + 5, 99)
  } else {
    notes.push(`State "${state}" not recognized — state SOL could not be calculated`)
    confidence = Math.max(confidence - 20, 0)
  }

  // ── 3. Magnuson-Moss (federal) SOL ───────────────────────────────────────
  // 4 years from purchase date
  const fedSolDate = new Date(anchorDate)
  fedSolDate.setFullYear(fedSolDate.getFullYear() + 4)  // always a literal 4 — safe

  // ── 4. Days until each SOL ───────────────────────────────────────────────
  const msPerDay = 1000 * 60 * 60 * 24

  const daysUntilState = stateSolDate
    ? Math.round((stateSolDate.getTime() - today.getTime()) / msPerDay)
    : null

  const daysUntilFed = Math.round((fedSolDate.getTime() - today.getTime()) / msPerDay)

  // ── 5. Urgency flags ─────────────────────────────────────────────────────
  const STATE_URGENT_DAYS   = 90
  const FEDERAL_URGENT_DAYS = 90

  const stateSolExpired  = daysUntilState !== null && daysUntilState < 0
  const fedSolExpired    = daysUntilFed < 0
  const stateSolUrgent   = daysUntilState !== null && daysUntilState >= 0 && daysUntilState <= STATE_URGENT_DAYS
  const fedSolUrgent     = daysUntilFed >= 0 && daysUntilFed <= FEDERAL_URGENT_DAYS

  if (stateSolExpired) notes.push('⚠ State lemon law window may have expired')
  if (fedSolExpired)   notes.push('⚠ Federal Magnuson-Moss window may have expired')
  if (stateSolUrgent && !stateSolExpired) notes.push(`⚠ State SOL expires in ${daysUntilState} days`)
  if (fedSolUrgent && !fedSolExpired)     notes.push(`⚠ Federal SOL expires in ${daysUntilFed} days`)

  // Cap confidence if expired (we're estimating based on purchase date)
  if (basis === 'estimated' && (stateSolExpired || fedSolExpired)) {
    confidence = Math.max(confidence - 15, 10)
    notes.push('Expiration based on estimated purchase date — confirm with actual documents')
  }

  const toISO = (d: Date) => d.toISOString().split('T')[0]

  return {
    state_sol_date:       stateSolDate ? toISO(stateSolDate) : null,
    federal_sol_date:     toISO(fedSolDate),
    basis,
    confidence_score:     Math.max(0, Math.min(99, confidence)),
    estimated_purchase:   estimatedPurchase,
    state_window_months:  stateWindowMonths,
    state_window_miles:   stateWindowMiles,
    days_until_state_sol: daysUntilState,
    days_until_fed_sol:   daysUntilFed,
    state_sol_expired:    stateSolExpired,
    federal_sol_expired:  fedSolExpired,
    state_sol_urgent:     stateSolUrgent,
    federal_sol_urgent:   fedSolUrgent,
    state_name:           stateLaw?.name ?? null,
    notes,
  }
}
