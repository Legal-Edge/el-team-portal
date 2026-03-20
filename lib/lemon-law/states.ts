import type { StateLaw } from './types'

// All 50 states + DC lemon law thresholds
// Sources: state statutes, lemon-law-research.md
// ⚠️ Verify against current statutes before relying on these values

export const STATE_LAWS: Record<string, StateLaw> = {
  AL: { name:'Alabama', statute:'Ala. Code §8-20A-1', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:true, remedies:'Repurchase or replacement; attorney fees', keyNuances:'Mileage deduction on repurchase. Requires direct manufacturer notice.' },
  AK: { name:'Alaska', statute:'Alaska Stat. §45.45.300', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or refund; attorney fees', keyNuances:'Short 1-year/12K window.' },
  AZ: { name:'Arizona', statute:'Ariz. Rev. Stat. §44-1261', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Manufacturer has 30 days to cure after final attempt.' },
  AR: { name:'Arkansas', statute:'Ark. Code Ann. §4-90-401', repairAttempts:4, safetyAttempts:4, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or refund; attorney fees', keyNuances:'No specific safety defect provision.' },
  CA: { name:'California', statute:'Cal. Civ. Code §1793.22 (Tanner Act)', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:18, windowMiles:18000, usedCovered:true, leaseCovered:true, noticeRequired:false, arbitrationRequired:false, remedies:'Full restitution or replacement; mandatory attorney fees; civil penalty up to 2×', keyNuances:'Strongest law in the nation. Notice required only if manufacturer disclosed requirement. Reasonable use deduction = (miles at first repair / 120,000) × purchase price. Covers used vehicles still under original warranty.' },
  CO: { name:'Colorado', statute:'Colo. Rev. Stat. §42-10-101', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:999999, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'No mileage cap — 1 year only.' },
  CT: { name:'Connecticut', statute:'Conn. Gen. Stat. §42-179', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Has secret warranty law.' },
  DE: { name:'Delaware', statute:'Del. Code Ann. tit. 6 §5001', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'15-day cure period after notice.' },
  DC: { name:'District of Columbia', statute:'D.C. Code §50-503', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:24, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; treble damages for willful violations', keyNuances:'Treble damages available.' },
  FL: { name:'Florida', statute:'Fla. Stat. §681.10', repairAttempts:3, safetyAttempts:1, daysOOS:15, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase; attorney fees; up to $10K civil penalty', keyNuances:'Only 15 days OOS needed. State arbitration board mandatory before suit. 10-day cure period.' },
  GA: { name:'Georgia', statute:'Ga. Code Ann. §10-1-780', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts. 7-day cure period.' },
  HI: { name:'Hawaii', statute:'Haw. Rev. Stat. §481I-1', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; consequential damages', keyNuances:'Covers leased vehicles. Consequential damages available.' },
  ID: { name:'Idaho', statute:'Idaho Code §48-901', repairAttempts:4, safetyAttempts:4, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'No explicit safety defect provision.' },
  IL: { name:'Illinois', statute:'815 ILCS 380/1', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Shortest window — 12 months/12K miles. Must exhaust manufacturer arbitration.' },
  IN: { name:'Indiana', statute:'Ind. Code §24-5-13-1', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:18, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Final cure opportunity required after notice.' },
  IA: { name:'Iowa', statute:'Iowa Code §322G.1', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts.' },
  KS: { name:'Kansas', statute:'Kan. Stat. Ann. §50-645', repairAttempts:4, safetyAttempts:4, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'No safety defect provision. Short 1yr/12K window.' },
  KY: { name:'Kentucky', statute:'Ky. Rev. Stat. Ann. §367.840', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Short window 1yr/12K.' },
  LA: { name:'Louisiana', statute:'La. Rev. Stat. Ann. §51:1941', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'30-day cure period after notice (long). Short 1yr/12K window.' },
  ME: { name:'Maine', statute:'Me. Rev. Stat. Ann. tit. 10 §1161', repairAttempts:3, safetyAttempts:1, daysOOS:15, windowMonths:36, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'3-year window (longest). Only 15 days OOS. Only 3 attempts.' },
  MD: { name:'Maryland', statute:'Md. Code Ann., Com. Law §14-1501', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:18, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Secret warranty law. Must attempt arbitration.' },
  MA: { name:'Massachusetts', statute:'Mass. Gen. Laws ch. 90 §7N½', repairAttempts:3, safetyAttempts:1, daysOOS:15, windowMonths:12, windowMiles:15000, usedCovered:true, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; punitive damages up to 3×', keyNuances:'Punitive damages up to 3×. Used vehicle coverage. 15-day OOS.' },
  MI: { name:'Michigan', statute:'Mich. Comp. Laws §257.1401', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Short window 1yr/12K. Must exhaust manufacturer arbitration.' },
  MN: { name:'Minnesota', statute:'Minn. Stat. §325F.665', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:24, windowMiles:18000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; $25K civil penalty for willful violations', keyNuances:'$25K civil penalty for willful violations.' },
  MS: { name:'Mississippi', statute:'Miss. Code Ann. §63-17-151', repairAttempts:3, safetyAttempts:1, daysOOS:15, windowMonths:12, windowMiles:15000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'15-day OOS. Only 3 attempts. Short 1yr/15K window.' },
  MO: { name:'Missouri', statute:'Mo. Rev. Stat. §407.560', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:18, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Standard provisions.' },
  MT: { name:'Montana', statute:'Mont. Code Ann. §61-4-501', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:24, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Standard provisions.' },
  NE: { name:'Nebraska', statute:'Neb. Rev. Stat. §60-2701', repairAttempts:4, safetyAttempts:2, daysOOS:40, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'40-day OOS threshold (higher — less consumer-friendly). Short window.' },
  NV: { name:'Nevada', statute:'Nev. Rev. Stat. §597.600', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:18000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'18K miles despite 1yr time limit.' },
  NH: { name:'New Hampshire', statute:'N.H. Rev. Stat. Ann. §357-D:1', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts.' },
  NJ: { name:'New Jersey', statute:'N.J. Stat. Ann. §56:12-29', repairAttempts:3, safetyAttempts:1, daysOOS:20, windowMonths:24, windowMiles:18000, usedCovered:true, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Full repurchase or replacement; mandatory attorney fees', keyNuances:'20-day OOS. Used/leased covered. Reasonable use = (miles at first repair / 100,000) × price.' },
  NM: { name:'New Mexico', statute:'N.M. Stat. Ann. §57-16A-1', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Short 1yr/12K window.' },
  NY: { name:'New York', statute:'N.Y. Gen. Bus. Law §198-a', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:24, windowMiles:18000, usedCovered:true, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; AG civil penalties', keyNuances:'Used vehicle law §198-b. State arbitration available. Reasonable use deduction.' },
  NC: { name:'North Carolina', statute:'N.C. Gen. Stat. §20-351', repairAttempts:4, safetyAttempts:2, daysOOS:20, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; $500/day civil penalty', keyNuances:'20-day OOS. Daily civil penalty for non-compliance.' },
  ND: { name:'North Dakota', statute:'N.D. Cent. Code §51-07-16', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts. Short window.' },
  OH: { name:'Ohio', statute:'Ohio Rev. Code Ann. §1345.71', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:18000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase + incidental damages; attorney fees', keyNuances:'Only 3 attempts after manufacturer notification. 18K miles.' },
  OK: { name:'Oklahoma', statute:'Okla. Stat. tit. 15 §901', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Short 1yr/12K window.' },
  OR: { name:'Oregon', statute:'Or. Rev. Stat. §646A.400', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Short window. Covers leased.' },
  PA: { name:'Pennsylvania', statute:'73 Pa. Stat. Ann. §1951', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts. Short 1yr/12K window. 30-day cure period after notice.' },
  RI: { name:'Rhode Island', statute:'R.I. Gen. Laws §31-5.2-1', repairAttempts:4, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:15000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'15K miles.' },
  SC: { name:'South Carolina', statute:'S.C. Code Ann. §56-28-10', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts. Short window.' },
  SD: { name:'South Dakota', statute:'S.D. Codified Laws §32-6D-1', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Short window.' },
  TN: { name:'Tennessee', statute:'Tenn. Code Ann. §55-24-101', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Short 1yr/12K window.' },
  TX: { name:'Texas', statute:'Tex. Occ. Code §2301.601', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase; attorney fees; $10K civil penalty', keyNuances:'Must file with Texas DMV before lawsuit. Covers leased vehicles.' },
  UT: { name:'Utah', statute:'Utah Code Ann. §13-20-1', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:18000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'18K miles despite 1yr time limit.' },
  VT: { name:'Vermont', statute:'Vt. Stat. Ann. tit. 9 §4170', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:36, windowMiles:18000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; punitive damages', keyNuances:'3-year window (tied for longest). Only 3 attempts. Punitive damages available.' },
  VA: { name:'Virginia', statute:'Va. Code Ann. §59.1-207.9', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:18, windowMiles:18000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:true, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Secret warranty law. Must exhaust state arbitration. Only 3 attempts.' },
  WA: { name:'Washington', statute:'Wash. Rev. Code §19.118.005', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:24, windowMiles:24000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees; triple damages for willful violation', keyNuances:'Covers vehicles up to 19K lbs GVWR. Triple damages for willful violations.' },
  WV: { name:'West Virginia', statute:'W. Va. Code §46A-6A-1', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts. Short window.' },
  WI: { name:'Wisconsin', statute:'Wis. Stat. §218.0171', repairAttempts:4, safetyAttempts:2, daysOOS:30, windowMonths:12, windowMiles:15000, usedCovered:false, leaseCovered:true, noticeRequired:true, arbitrationRequired:false, remedies:'2× purchase price OR replacement; attorney fees', keyNuances:'2× purchase price remedy — strongest financial remedy in the nation. Secret warranty law.' },
  WY: { name:'Wyoming', statute:'Wyo. Stat. Ann. §40-17-101', repairAttempts:3, safetyAttempts:1, daysOOS:30, windowMonths:12, windowMiles:12000, usedCovered:false, leaseCovered:false, noticeRequired:true, arbitrationRequired:false, remedies:'Replacement or repurchase; attorney fees', keyNuances:'Only 3 attempts. Short window.' },
}

export const FEDERAL_LAW: StateLaw = {
  name: 'Federal Magnuson-Moss Warranty Act',
  statute: '15 U.S.C. §2301 et seq.',
  repairAttempts: 4,       // FTC guidance / court consensus
  safetyAttempts: 2,       // courts apply lower threshold for safety defects
  daysOOS: 30,             // FTC guidance
  windowMonths: 999,       // entire warranty period
  windowMiles: 999999,     // entire warranty period
  usedCovered: true,
  leaseCovered: true,
  noticeRequired: false,   // no formal notice required by statute
  arbitrationRequired: false,
  remedies: 'Repair, replacement, or refund; mandatory attorney fees if consumer prevails (15 U.S.C. §2310(d)(2))',
  keyNuances: 'No specific attempt count defined — "reasonable number" standard. Courts typically apply 3-4 same-defect attempts or 30+ days OOS. Consumer may pursue BOTH state and federal claims simultaneously. Attorney fees provision creates strong settlement leverage.',
}

export function getStateLaw(stateCode: string | null): StateLaw | null {
  if (!stateCode) return null
  const normalized = stateCode.trim().toUpperCase()
  // Handle full state names
  const byName = Object.values(STATE_LAWS).find(
    s => s.name.toUpperCase() === normalized
  )
  return STATE_LAWS[normalized] ?? byName ?? null
}

// Safety defect keywords — any complaint containing these triggers lower threshold
export const SAFETY_KEYWORDS = [
  'brake', 'brakes', 'brake failure', 'no brakes', 'brake fade', 'brake fluid',
  'steering', 'loss of steering', 'power steering', 'steering failure',
  'stall', 'stalls', 'engine stall', 'stall while driving', 'stalling',
  'fire', 'smoke', 'burning smell', 'fuel leak', 'catching fire',
  'airbag', 'air bag', 'seatbelt', 'seat belt', 'restraint',
  'acceleration', 'unintended acceleration', 'throttle', 'runaway',
  'rollaway', 'rolls away', 'park pawl',
  'transmission slip', 'loss of power while driving',
  'electrical failure', 'sudden stop', 'loss of control',
  'engine shutdown', 'shutdown while driving',
]

export function isSafetyDefect(complaint: string): boolean {
  const lower = complaint.toLowerCase()
  return SAFETY_KEYWORDS.some(k => lower.includes(k))
}

// Defect categories for grouping
export const DEFECT_CATEGORIES: Record<string, string[]> = {
  transmission:   ['transmission','shifting','shift','gear','gearbox','cvt','torque converter','clutch','slipping','shudder','jerk'],
  engine:         ['engine','motor','oil','coolant','overheating','misfir','cylinder','piston','timing','knock','tick','rattle','stall','crank','start'],
  electrical:     ['electrical','battery','alternator','wiring','short circuit','module','ecm','tcm','bcm','fuse','relay','sensor','computer','infotainment','display','screen','camera','radio','navigation',
                  // ADAS / driver-assist systems are electronic in nature — same defect category
                  'collision warning','collision avoidance','forward collision','lane departure','lane keeping','lane assist',
                  'blind spot','adas','driver assist','driver assistance','adaptive cruise','parking sensor','backup camera',
                  'warning light','warning system','warning message','malfunction indicator','check system',
                  'automatic emergency','auto brake','auto stop'],
  brakes:         ['brake','brakes','abs','caliper','rotor','pad','brake fluid','brake line'],
  steering:       ['steering','power steering','rack','pinion','alignment','pull','drift','wander'],
  suspension:     ['suspension','shock','strut','spring','control arm','sway bar','bushing','bearing','wheel','axle','cv joint'],
  hvac:           ['ac','air conditioning','heat','hvac','blower','compressor','refrigerant','climate','fan','defrost'],
  fuel:           ['fuel','gas','tank','pump','injector','fuel line','fuel leak','fuel smell'],
  exhaust:        ['exhaust','catalytic','muffler','emission','dpf','regen'],
  body:           ['door','window','lock','latch','hinge','panel','paint','rust','seal','leak','water','rattle','noise','squeak','creak','trim','body'],
  safety_system:  ['airbag','seatbelt','srs','tpms','abs','stability','traction control','collision','lane','blind spot'],
}

export function categorizeDefect(complaint: string): string {
  const lower = complaint.toLowerCase()
  for (const [category, keywords] of Object.entries(DEFECT_CATEGORIES)) {
    if (keywords.some(k => lower.includes(k))) return category
  }
  return 'other'
}
