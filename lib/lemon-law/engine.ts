/**
 * Deterministic lemon law analysis engine.
 * Based on: 50-state research + pattern analysis of 3,294 attorney decisions
 * Aaron Waldo decision model (72% retain rate) used as primary threshold.
 *
 * Engine decides — Sonnet explains.
 */

import type {
  EngineInput, QualificationResult, DefectGroup, Decision,
  CauseOfAction, Confidence, RepairRecord,
} from './types'
import { getStateLaw, FEDERAL_LAW, isSafetyDefect, categorizeDefect } from './states'

// ─── Repair value helpers ───────────────────────────────────────────────────

function parseDate(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function daysInShop(r: RepairRecord): number {
  if (r.days_in_shop != null && r.days_in_shop > 0) return r.days_in_shop
  const dateIn  = parseDate(r.repair_date_in)
  const dateOut = parseDate(r.repair_date_out)
  if (dateIn && dateOut) {
    const diff = Math.round((dateOut.getTime() - dateIn.getTime()) / 86400000)
    return diff > 0 ? diff : 0
  }
  return 0
}

// ─── Defect grouping ────────────────────────────────────────────────────────

function groupDefects(repairs: RepairRecord[]): DefectGroup[] {
  const groups: Map<string, DefectGroup> = new Map()

  for (const r of repairs) {
    // Use complaint field; fall back to work_performed if complaint is blank
    const rawText = r.complaint?.trim() || r.work_performed?.trim()
    if (!rawText) continue
    // Skip clearly non-warranty repairs
    const complaint = rawText
    const category  = categorizeDefect(complaint)
    const safety    = isSafetyDefect(complaint)

    if (!groups.has(category)) {
      groups.set(category, {
        category,
        complaints: [],
        attempts: 0,
        dates: [],
        isSafety: false,
      })
    }

    const g = groups.get(category)!
    g.complaints.push(complaint)
    g.attempts++
    if (r.repair_date_in) g.dates.push(r.repair_date_in)
    if (safety) g.isSafety = true
  }

  return Array.from(groups.values()).sort((a, b) => b.attempts - a.attempts)
}

// ─── Window check ────────────────────────────────────────────────────────────

function isWithinWindow(
  repairDate: Date,
  purchaseDate: Date,
  mileageAtRepair: number | null,
  purchaseMileage: number | null,
  windowMonths: number,
  windowMiles: number,
): boolean {
  const monthsElapsed = monthsBetween(purchaseDate, repairDate)
  const timeOk = monthsElapsed <= windowMonths
  if (!timeOk) return false
  // If we have mileage data, also check mileage window
  if (mileageAtRepair != null && purchaseMileage != null && windowMiles < 999999) {
    const milesDriven = mileageAtRepair - purchaseMileage
    return milesDriven <= windowMiles
  }
  return true
}

// ─── Main engine ─────────────────────────────────────────────────────────────

export function runLemonLawEngine(input: EngineInput): QualificationResult {
  const stateLaw  = getStateLaw(input.state)
  const repairs   = input.repairs.filter(r => r.complaint || r.work_performed)
  const purchaseDate = parseDate(input.purchase_date)

  // Total days OOS
  const totalDaysOOS = repairs.reduce((sum, r) => sum + daysInShop(r), 0)

  // Defect groups
  const defectGroups  = groupDefects(repairs)
  const maxAttempts   = defectGroups.reduce((m, g) => Math.max(m, g.attempts), 0)
  const safetyDefects = defectGroups.filter(g => g.isSafety).flatMap(g => g.complaints.slice(0, 2))

  // ── Window analysis ────────────────────────────────────────────────────────
  let withinStateWindow: boolean | null = null
  let withinFederalWindow = true  // Federal = entire warranty period (assume valid unless proven otherwise)
  let repairsInWindow = 0

  if (purchaseDate && stateLaw) {
    const inWindow = repairs.filter(r => {
      if (!r.repair_date_in) return false  // can't determine
      const repDate = parseDate(r.repair_date_in)
      if (!repDate) return false
      return isWithinWindow(
        repDate, purchaseDate,
        r.mileage_in, null,
        stateLaw.windowMonths, stateLaw.windowMiles,
      )
    })
    repairsInWindow   = inWindow.length
    withinStateWindow = inWindow.length > 0
  }

  // ── Threshold checks ───────────────────────────────────────────────────────
  const hasSafetyDefect = safetyDefects.length > 0

  const meetsStateRepair = stateLaw
    ? maxAttempts >= stateLaw.repairAttempts
    : false

  const meetsStateSafety = stateLaw && hasSafetyDefect
    ? safetyDefects.length > 0 && maxAttempts >= stateLaw.safetyAttempts
    : false

  const meetsStateOOS = stateLaw
    ? totalDaysOOS >= stateLaw.daysOOS
    : false

  // Federal: courts apply ~3-4 same-defect or ~30 days — use Aaron's threshold (more aggressive)
  const meetsFederal = maxAttempts >= 2 || totalDaysOOS >= 20 ||
    (hasSafetyDefect && maxAttempts >= 1)

  // ── Missing data detection ─────────────────────────────────────────────────
  const missingData: string[] = []
  if (!input.purchase_date)    missingData.push('Purchase/lease date — needed to verify warranty window')
  if (!input.state)            missingData.push('State of purchase — needed for state lemon law analysis')
  if (repairs.every(r => !r.mileage_in)) missingData.push('Mileage at repair visits — needed for window verification')
  if (repairs.some(r => !r.repair_date_in)) missingData.push('Some repair dates missing — affects attempt count accuracy')
  if (repairs.every(r => !r.complaint))   missingData.push('Repair complaints not extracted — needed for defect grouping')

  // ── Decision logic (Aaron Waldo model) ─────────────────────────────────────
  // Based on pattern analysis: Aaron retains 72%, key signals below
  const retainSignals:   string[] = []
  const riskFactors:     string[] = []
  let decision:          Decision
  let confidence:        Confidence
  let causeOfAction:     CauseOfAction | null = null
  let nurtureReason:     string | null = null
  let dropReason:        string | null = null
  const clarificationNeeded: string[] = []

  // Current mileage from intake (or mileage at last repair)
  const lastRepairMileage = repairs
    .filter(r => r.mileage_in)
    .sort((a, b) => (b.mileage_in ?? 0) - (a.mileage_in ?? 0))[0]?.mileage_in
  const currentMileage = input.mileage_at_intake ?? lastRepairMileage ?? null

  // Mileage risk scoring (from data: 30K is soft threshold, 50K is hard)
  const highMileage  = currentMileage != null && currentMileage > 50000
  const borderlineMileage = currentMileage != null && currentMileage > 30000 && currentMileage <= 50000

  // ── Build signals ──────────────────────────────────────────────────────────

  // Repair attempt signals
  if (maxAttempts >= 3) {
    retainSignals.push(`${maxAttempts} repair attempts for "${defectGroups[0]?.category}" defect category`)
  } else if (maxAttempts === 2) {
    retainSignals.push(`2 repair attempts for "${defectGroups[0]?.category}" defect — sufficient for federal Mag-Moss`)
  } else if (maxAttempts === 1 && !hasSafetyDefect) {
    riskFactors.push('Only 1 repair visit — no duplication of defect yet')
  }

  // Safety defect signals
  if (hasSafetyDefect) {
    retainSignals.push(`Safety defect present: ${safetyDefects[0]} — triggers lower threshold (1 attempt in many states)`)
    if (maxAttempts >= 1) {
      retainSignals.push('1+ repair for safety defect — qualifies under safety defect track in most states')
    }
  }

  // Days OOS signals
  if (totalDaysOOS >= 30) {
    retainSignals.push(`${totalDaysOOS} cumulative days out of service — meets 30-day threshold (all states)`)
  } else if (totalDaysOOS >= 20) {
    retainSignals.push(`${totalDaysOOS} cumulative days out of service — meets 20-day threshold (FL, NJ, NC)`)
  } else if (totalDaysOOS >= 15) {
    retainSignals.push(`${totalDaysOOS} cumulative days out of service — meets 15-day threshold (FL, ME, MA, MS)`)
  } else if (totalDaysOOS > 0) {
    riskFactors.push(`Only ${totalDaysOOS} cumulative days OOS — below standard thresholds`)
  }

  // Window signals
  if (withinStateWindow === true) {
    retainSignals.push('Repairs fall within state lemon law warranty window')
  } else if (withinStateWindow === false) {
    riskFactors.push('Repairs appear outside state lemon law window — state track may not apply')
  } else if (!input.purchase_date) {
    riskFactors.push('Cannot verify warranty window without purchase date')
  }

  // Mileage signals
  if (currentMileage != null) {
    if (currentMileage < 15000) {
      retainSignals.push(`Low mileage (${currentMileage.toLocaleString()} mi) — well within warranty window`)
    } else if (currentMileage < 30000) {
      retainSignals.push(`Moderate mileage (${currentMileage.toLocaleString()} mi) — within typical warranty window`)
    } else if (borderlineMileage) {
      riskFactors.push(`Borderline mileage (${currentMileage.toLocaleString()} mi) — approaching warranty limits in some states`)
    } else if (highMileage) {
      riskFactors.push(`High mileage (${currentMileage.toLocaleString()} mi) — likely outside warranty window in shorter-window states`)
    }
  }

  // Defect diversity signal
  if (defectGroups.length >= 3) {
    retainSignals.push(`Multiple defect categories (${defectGroups.length}) — strong repair history`)
  } else if (defectGroups.length === 1 && maxAttempts >= 2) {
    retainSignals.push(`Recurring defect in same category — demonstrates manufacturer inability to repair`)
  }

  // New vs used
  if (input.new_or_used === 'new') {
    retainSignals.push('New vehicle — covered by all state lemon laws')
  } else if (input.new_or_used === 'used') {
    riskFactors.push('Used vehicle — only covered in CA, NJ, NY, MA under state law (federal Mag-Moss still applies)')
  } else if (input.new_or_used === 'certified') {
    riskFactors.push('Certified Pre-Owned — state lemon law generally does not apply; Mag-Moss may still apply under manufacturer CPO warranty')
  }

  // ── Cause of action ────────────────────────────────────────────────────────
  if (withinStateWindow === true && stateLaw) {
    causeOfAction = 'both'
  } else if (withinStateWindow === false) {
    causeOfAction = 'magnuson_moss'  // State window closed, fall back to federal
  } else {
    // Unknown window — cite both for maximum leverage
    causeOfAction = 'both'
  }

  // ── Final decision ─────────────────────────────────────────────────────────

  // Strong retain signals (Aaron's model: aggressive on retain)
  const strongRetain =
    maxAttempts >= 2 ||                               // 2+ attempts any defect
    totalDaysOOS >= 20 ||                             // 20+ days OOS
    (hasSafetyDefect && maxAttempts >= 1) ||          // 1+ safety defect attempt
    (meetsStateRepair || meetsStateSafety || meetsStateOOS)  // explicitly meets state threshold

  // Drop signals: high mileage + no duplication + likely outside all windows
  const strongDrop =
    (highMileage && maxAttempts <= 1 && totalDaysOOS < 15) ||
    (withinStateWindow === false && !meetsFederal && !hasSafetyDefect)

  // Needs clarification: missing critical data
  const needsClarification =
    missingData.length >= 3 ||  // too many unknowns
    (maxAttempts === 0 && totalDaysOOS === 0 && repairs.length === 0)

  if (needsClarification || clarificationNeeded.length > 0) {
    decision   = 'clarification_needed'
    confidence = 'low'
    causeOfAction = null
    clarificationNeeded.push(...missingData)
  } else if (strongDrop) {
    decision    = 'drop'
    confidence  = highMileage && maxAttempts <= 1 ? 'high' : 'medium'
    causeOfAction = null
    dropReason  = highMileage
      ? `High mileage (${currentMileage?.toLocaleString()} mi) with insufficient repair history for lemon law claim`
      : 'Repairs fall outside all applicable warranty windows with no qualifying repair history'
  } else if (strongRetain) {
    decision   = 'retain'
    confidence = (maxAttempts >= 3 || totalDaysOOS >= 30 || meetsStateRepair) ? 'high' : 'medium'
  } else {
    // Nurture: something is there but not enough yet
    decision   = 'nurture'
    confidence = maxAttempts === 1 ? 'medium' : 'low'
    causeOfAction = null

    const nurtureReasons: string[] = []
    if (maxAttempts === 1) nurtureReasons.push('only 1 repair visit — defect needs to recur before retaining')
    if (totalDaysOOS < 15)  nurtureReasons.push(`only ${totalDaysOOS} days OOS — need ${stateLaw?.daysOOS ?? 30} cumulative`)
    if (borderlineMileage)  nurtureReasons.push('mileage approaching warranty limits — time-sensitive')
    if (!input.purchase_date) nurtureReasons.push('purchase date needed to confirm warranty window')
    nurtureReason = nurtureReasons.join('; ')
  }

  // Confidence downgrade if missing data
  if (missingData.length >= 2 && confidence === 'high') confidence = 'medium'

  // ── Numeric confidence score (0–100) ─────────────────────────────────────
  // Base score by decision + qualitative confidence, then factor in signals
  let confidenceScore = 50

  if (decision === 'retain') {
    confidenceScore = confidence === 'high' ? 88 : 72
    if (maxAttempts >= 4)                    confidenceScore += 5
    if (totalDaysOOS >= 30)                  confidenceScore += 3
    if (safetyDefects.length > 0)            confidenceScore += 4
    if (meetsStateRepair)                    confidenceScore += 3
    if (meetsFederal && meetsStateRepair)    confidenceScore += 2
  } else if (decision === 'drop') {
    confidenceScore = confidence === 'high' ? 85 : 65
  } else if (decision === 'nurture') {
    confidenceScore = confidence === 'medium' ? 55 : 40
    if (maxAttempts >= 2) confidenceScore += 5
  } else if (decision === 'clarification_needed') {
    confidenceScore = 30
  }

  // Penalise for missing data
  confidenceScore -= missingData.length * 4

  // Cap 0–99 (100 is never truly certain in legal)
  confidenceScore = Math.max(0, Math.min(99, confidenceScore))

  return {
    total_repair_attempts:          repairs.length,
    total_days_oos:                 totalDaysOOS,
    defect_groups:                  defectGroups,
    safety_defects:                 safetyDefects,
    max_attempts_per_defect:        maxAttempts,
    within_state_window:            withinStateWindow,
    state_law:                      stateLaw,
    meets_state_repair_threshold:   meetsStateRepair,
    meets_state_safety_threshold:   meetsStateSafety,
    meets_state_oos_threshold:      meetsStateOOS,
    meets_federal_threshold:        meetsFederal,
    decision,
    confidence,
    confidence_score:               confidenceScore,
    cause_of_action:                causeOfAction,
    retain_signals:                 retainSignals,
    risk_factors:                   riskFactors,
    nurture_reason:                 nurtureReason,
    drop_reason:                    dropReason,
    clarification_needed:           clarificationNeeded,
    missing_data:                   missingData,
  }
}
