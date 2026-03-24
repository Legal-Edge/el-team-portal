'use client'

import { useState, useEffect, useCallback } from 'react'
import type { IntelligenceReport } from '@/app/api/cases/[id]/intelligence/route'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChecklistItem {
  id:        string
  priority:  'critical' | 'high' | 'medium' | 'low'
  icon:      string
  what:      string           // What we need
  why:       string           // Why it matters (client-safe language)
  how:       string[]         // Steps client can take to provide it
  then:      string           // What happens next once received
  template?: {
    type:    'sms' | 'call'
    label:   string
    body:    string
  }
  done?:     boolean
}

interface GuidanceData {
  situation:  string           // Plain-English case summary
  checklist:  ChecklistItem[]  // Ordered action items
  next_steps: string[]         // What happens after checklist is complete
  stage_goal: string           // One-line goal for this stage
}

// ── Priority chip ──────────────────────────────────────────────────────────────

const PRIORITY_CHIP: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-yellow-100 text-yellow-700',
  low:      'bg-gray-100 text-gray-500',
}

// ── Template modal ─────────────────────────────────────────────────────────────

function TemplateModal({
  item,
  onClose,
}: {
  item: ChecklistItem
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const t = item.template!

  function copy() {
    navigator.clipboard.writeText(t.body).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{item.icon}</span>
                <h3 className="text-base font-semibold text-gray-900">{item.what}</h3>
              </div>
              <p className="text-sm text-gray-500">
                {t.type === 'sms' ? '💬 Text message template' : '📞 Call script'}
              </p>
            </div>
            <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Template body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Message</p>
              <button onClick={copy} className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1 transition-colors">
                {copied
                  ? <><svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg><span className="text-green-600">Copied!</span></>
                  : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>Copy</>
                }
              </button>
            </div>
            <textarea
              readOnly
              value={t.body}
              rows={7}
              className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-xl p-4 resize-none focus:outline-none leading-relaxed"
            />
          </div>

          {/* Footer */}
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="flex-1 bg-gray-900 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-gray-800 active:scale-[0.98] transition-all"
            >
              {copied ? '✓ Copied' : 'Copy to clipboard'}
            </button>
            <button
              onClick={onClose}
              className="px-4 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Checklist item card ────────────────────────────────────────────────────────

function ChecklistCard({
  item,
  index,
  onOpenTemplate,
}: {
  item:           ChecklistItem
  index:          number
  onOpenTemplate: (item: ChecklistItem) => void
}) {
  const [open, setOpen] = useState(!item.done && item.priority === 'critical')

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${
      item.done
        ? 'bg-gray-50/50 border-gray-100 opacity-60'
        : item.priority === 'critical'
          ? 'bg-white border-red-100'
          : item.priority === 'high'
            ? 'bg-white border-orange-100'
            : 'bg-white border-gray-100'
    }`}>
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50/50 transition-colors"
      >
        {/* Step number */}
        <span className={`shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
          item.done
            ? 'bg-green-100 text-green-600'
            : 'bg-gray-100 text-gray-500'
        }`}>
          {item.done ? '✓' : index + 1}
        </span>

        {/* Icon + label */}
        <span className="text-base shrink-0">{item.icon}</span>
        <span className="flex-1 text-sm font-semibold text-gray-900 text-left">{item.what}</span>

        {/* Priority chip */}
        {!item.done && (
          <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_CHIP[item.priority]}`}>
            {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
          </span>
        )}

        {/* Chevron */}
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-50">

          {/* Why we need it */}
          <div className="pt-4 space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Why we need it</p>
            <p className="text-sm text-gray-700 leading-relaxed">{item.why}</p>
          </div>

          {/* How client can provide it */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">How the client can provide it</p>
            <ol className="space-y-1.5 mt-1">
              {item.how.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* What happens next */}
          <div className="bg-green-50/70 border border-green-100 rounded-lg px-3.5 py-2.5 flex items-start gap-2">
            <span className="text-green-500 text-sm shrink-0 mt-0.5">→</span>
            <p className="text-sm text-green-800 leading-relaxed">{item.then}</p>
          </div>

          {/* Template button */}
          {item.template && (
            <button
              onClick={() => onOpenTemplate(item)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 active:scale-[0.98] transition-all"
            >
              {item.template.type === 'sms' ? '💬' : '📞'}
              {item.template.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Guidance builder ───────────────────────────────────────────────────────────

function buildNurtureGuidance(report: IntelligenceReport): GuidanceData {
  const { tier1_intake: t1, tier2_comms: t2, tier3_docs: t3 } = report
  const clientFirstName = report.case_id ? '' : ''  // resolved below
  const hp = {} as Record<string, unknown>           // props resolved server-side in report

  const vehicle       = t1.vehicle ?? 'their vehicle'
  const issuesSummary = t1.issues.length
    ? t1.issues.slice(0, 2).join(' and ')
    : 'reported vehicle issues'
  const repairCount   = t1.repair_count
  const state         = t1.state ?? 'their state'
  const daysInNurture = t2.days_since_contact !== null
    ? `${t2.days_since_contact} days`
    : null

  // ── Situation paragraph ────────────────────────────────────────────────────
  let situation = `This client has a ${vehicle}`
  if (issuesSummary) situation += ` with ${issuesSummary}`
  situation += '.'

  if (repairCount !== null && repairCount > 0) {
    situation += ` They've had ${repairCount} repair visit${repairCount !== 1 ? 's' : ''} with the dealership.`
  } else if (t2.key_facts.length > 0) {
    // Pull repair info from call facts
    const repairFact = t2.key_facts.find(f => f.toLowerCase().includes('shop') || f.toLowerCase().includes('repair'))
    if (repairFact) situation += ` ${repairFact}.`
  }

  if (t3.total_docs === 0) {
    situation += ' No documents have been provided yet.'
  } else {
    situation += ` ${t3.total_docs} document${t3.total_docs !== 1 ? 's' : ''} on file`
    if (t3.missing_critical.length > 0) situation += ` — still missing ${t3.missing_critical.join(', ').toLowerCase()}.`
    else situation += '.'
  }

  if (daysInNurture) {
    situation += ` Last contact was ${daysInNurture} ago.`
  }

  if (t2.call_summaries.length > 0) {
    // Add key context from last call
    const summary = t2.call_summaries[0]
    const holdLine = summary.split('\n').find(s => s.toLowerCase().includes('hold') || s.toLowerCase().includes('follow up'))
    if (holdLine) situation += ` Note from last call: ${holdLine.trim()}`
  }

  // ── Checklist items ────────────────────────────────────────────────────────
  const checklist: ChecklistItem[] = []

  // 1. Repair orders
  if (!t3.has_repair_orders) {
    checklist.push({
      id:       'repair_orders',
      priority: 'critical',
      icon:     '🔧',
      what:     'Repair orders from the dealership',
      why:      `Repair orders are the most important evidence in a Lemon Law case. Under the Magnuson-Moss Warranty Act (federal law), a manufacturer must be given a reasonable number of attempts to fix a defect — and even 1–2 repair visits can be enough if the problem is serious or significantly impacts the vehicle's use. The repair orders document exactly when the vehicle was in the shop, what the dealership inspected, and whether they were able to fix it. Without these, we cannot evaluate the strength of the claim or build the demand letter.`,
      how: [
        'Ask the client to take clear photos of each repair order and reply to your text message.',
        'If they don\'t have copies, they can call the dealership\'s service department and ask for copies of all service records for their vehicle. The dealer is required to provide these.',
        'If the repair orders are hard to read, ask for the front and back of each page.',
      ],
      then:     'Once repair orders are received, our attorneys will review the documents and assess the strength of the claim.',
      template: {
        type:  'sms',
        label: 'Send repair order request',
        body:  `Hi [Client Name]! This is [Your Name] from Easy Lemon. We're moving forward with your case and need one important document — your repair orders from the dealership.\n\nThese are the service records from each visit where you brought in your ${vehicle}. They show the date, the work done, and whether the issue was resolved.\n\nHere's how to get them:\n• You may already have copies from the dealership — just take a photo and reply to this text!\n• If not, call the dealership's service department and ask for copies of all service records tied to your vehicle. They're required to give them to you.\n\nOnce we have these, our attorneys will be able to review your case. Reply here or call us at (855) 435-3666 if you need help. 🍋`,
      },
    })
  }

  // 2. Purchase agreement
  if (!t3.has_purchase_agmt) {
    checklist.push({
      id:       'purchase_agreement',
      priority: 'high',
      icon:     '📋',
      what:     'Purchase or lease agreement',
      why:      `The purchase agreement confirms the vehicle details (year, make, model, VIN), the exact purchase date, and the price paid. Under both federal Magnuson-Moss law and state Lemon Law, the warranty period typically begins at the date of sale — so this document establishes the timeline of the claim. It also contains the warranty terms, which we need to confirm the defect falls within the coverage window.`,
      how: [
        'Ask the client to look for the paperwork they signed at the dealership when they bought or leased the vehicle.',
        'If they can\'t find it, they can contact the dealership\'s finance department and request a copy. They can also check their email for a digital copy sent at time of purchase.',
        'Take a photo of each page and reply to this text, or email it to us.',
      ],
      then:     'Once the purchase agreement is received, our attorneys will confirm the warranty period and finalize the claim timeline.',
      template: {
        type:  'sms',
        label: 'Send purchase agreement request',
        body:  `Hi [Client Name]! This is [Your Name] from Easy Lemon. Along with the repair orders, we also need a copy of your vehicle's purchase or lease agreement — the paperwork you signed at the dealership when you got your ${vehicle}.\n\nThis helps us confirm your warranty coverage and the purchase date for your claim.\n\nYou can:\n• Take a photo of the document and reply to this text\n• Check your email — dealers often send a digital copy at the time of purchase\n• Contact the dealership's finance department if you need a new copy\n\nReply here or call us at (855) 435-3666 with any questions! 🍋`,
      },
    })
  }

  // 3. Warranty documentation
  if (!t3.has_warranty) {
    checklist.push({
      id:       'warranty_docs',
      priority: 'medium',
      icon:     '📜',
      what:     'Manufacturer warranty documentation',
      why:      `The warranty booklet or warranty agreement confirms the coverage period and what types of defects are covered. This is used to establish that the vehicle's issues fall within the warranty window and that the manufacturer is responsible for the repairs. It also helps identify any extended warranty provisions that may benefit the client.`,
      how: [
        'The warranty booklet is usually in the vehicle\'s glove box with the owner\'s manual.',
        'If they can\'t find it, they can search the manufacturer\'s website using their VIN to look up their warranty coverage.',
        'A photo of the warranty card or booklet cover page is usually enough to start.',
      ],
      then:     'Warranty documentation will be reviewed by our attorneys alongside the repair orders to confirm coverage.',
    })
  }

  // 4. Follow up if overdue
  if (t2.days_since_contact !== null && t2.days_since_contact > 7) {
    const days = t2.days_since_contact
    checklist.push({
      id:       'follow_up',
      priority: days > 21 ? 'critical' : days > 14 ? 'high' : 'medium',
      icon:     '📞',
      what:     `Follow up — ${days} days since last contact`,
      why:      `This client hasn't been contacted in ${days} days. Staying in regular contact is essential during the Nurture stage — it keeps the client engaged and helps us collect the documents needed to move the case forward. Clients who don't hear from us regularly are more likely to disengage or assume their case is inactive.`,
      how: [
        'Send a check-in text to re-engage the client and remind them of any outstanding document requests.',
        'If they haven\'t responded to a previous text, try calling.',
        'Keep the tone warm and helpful — the goal is to make it easy for them to take the next step.',
      ],
      then:     'Once re-engaged, focus the conversation on collecting repair orders and any other outstanding documents.',
      template: {
        type:  'sms',
        label: 'Send check-in text',
        body:  `Hi [Client Name]! This is [Your Name] from Easy Lemon, just checking in on your case. We're still here and ready to move forward whenever you are.\n\nHave there been any updates with your ${vehicle}? Any new trips to the dealership or additional time in the shop? Every visit helps build your case.\n\nIf you've been able to get your repair records, feel free to reply with a photo. Otherwise, just let us know how things are going — we're happy to walk you through next steps. 🍋\n\n(855) 435-3666`,
      },
    })
  }

  // 5. Verify threshold
  if (repairCount !== null && repairCount >= 2 && t3.total_docs === 0) {
    checklist.push({
      id:       'verify_threshold',
      priority: 'medium',
      icon:     '⚖️',
      what:     'Confirm current repair count and days in shop',
      why:      `The client originally reported ${repairCount} repair visit${repairCount !== 1 ? 's' : ''}. Under federal Magnuson-Moss law, even a small number of repair attempts can be enough — especially for safety-related defects. Confirming the current count, and whether the vehicle has been in the shop for extended periods, helps us determine if the claim is ready to be filed now or if we should wait for one more qualifying repair.`,
      how: [
        'Ask the client directly: "Has your vehicle been back to the dealership since we last spoke?"',
        'Ask: "Do you know how many total days the vehicle has been at the shop across all visits?"',
        'Note their answers in HubSpot so the attorneys have the most current information.',
      ],
      then:     'If the threshold has been met, flag the case for attorney review. If not, continue monitoring and stay in contact.',
      template: {
        type:  'sms',
        label: 'Send threshold check text',
        body:  `Hi [Client Name]! This is [Your Name] from Easy Lemon. Quick update question — has your ${vehicle} been back to the dealership recently? And do you have a sense of how many total days it's been in the shop across all your visits?\n\nThis information helps us determine exactly where your case stands. The more visits and shop time on record, the stronger your claim. Reply here or call us at (855) 435-3666! 🍋`,
      },
    })
  }

  // ── Next steps ─────────────────────────────────────────────────────────────
  const nextSteps: string[] = []

  if (!t3.has_repair_orders) {
    nextSteps.push('Send the repair order request text and follow up within 3 days if no response.')
  }
  if (!t3.has_purchase_agmt) {
    nextSteps.push('Send the purchase agreement request alongside (or after) the repair order request.')
  }
  if (t3.has_repair_orders && t3.has_purchase_agmt) {
    nextSteps.push('All key documents are on file. Flag this case for attorney review.')
  }
  nextSteps.push('Once all documents are received, our attorneys will review them and determine the next course of action.')
  nextSteps.push('Keep the client informed — let them know their documents have been received and that an attorney is reviewing their case.')

  return {
    situation,
    checklist,
    next_steps: nextSteps,
    stage_goal: 'Collect the repair orders and purchase agreement needed for attorney review.',
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  dealId:   string
  caseUUID: string | null
}

export function GuidanceTab({ dealId, caseUUID }: Props) {
  const [report,       setReport]       = useState<IntelligenceReport | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [activeItem,   setActiveItem]   = useState<ChecklistItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/cases/${dealId}/intelligence`)
      if (!res.ok) throw new Error(`${res.status}`)
      setReport(await res.json())
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-5 bg-gray-100 rounded-lg w-32" />
      <div className="h-20 bg-gray-50 rounded-xl" />
      {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-50 rounded-xl" />)}
    </div>
  )

  if (error || !report) return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
      Could not load guidance.{' '}
      <button onClick={load} className="underline text-gray-600">Retry</button>
    </div>
  )

  const guidance   = buildNurtureGuidance(report)
  const t3         = report.tier3_docs
  const t2         = report.tier2_comms
  const critCount  = guidance.checklist.filter(i => i.priority === 'critical').length

  return (
    <>
      {activeItem && (
        <TemplateModal item={activeItem} onClose={() => setActiveItem(null)} />
      )}

      <div className="space-y-5">

        {/* Stage goal banner */}
        <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3.5">
          <span className="text-yellow-500 text-lg shrink-0">🎯</span>
          <div>
            <p className="text-xs font-semibold text-yellow-700 uppercase tracking-widest mb-0.5">Stage Goal</p>
            <p className="text-sm text-yellow-900 font-medium">{guidance.stage_goal}</p>
          </div>
          <button onClick={load} className="ml-auto shrink-0 text-yellow-500 hover:text-yellow-700 transition-colors" title="Refresh">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Situation summary */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Situation</p>
          <p className="text-sm text-gray-700 leading-relaxed">{guidance.situation}</p>

          {/* Last call summary if available */}
          {t2.call_summaries[0] && (
            <div className="mt-3 pt-3 border-t border-gray-50">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Last Call Note</p>
              <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
                {t2.call_summaries[0].slice(0, 300)}{t2.call_summaries[0].length > 300 ? '…' : ''}
              </p>
            </div>
          )}
        </div>

        {/* Document status bar */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Repair Orders',      done: t3.has_repair_orders, icon: '🔧' },
            { label: 'Purchase Agreement', done: t3.has_purchase_agmt, icon: '📋' },
            { label: 'Warranty Docs',      done: t3.has_warranty,      icon: '📜' },
          ].map(item => (
            <div key={item.label} className={`rounded-xl p-3 border text-center ${
              item.done
                ? 'bg-green-50 border-green-100'
                : 'bg-red-50/60 border-red-100'
            }`}>
              <p className="text-base mb-1">{item.done ? '✅' : item.icon}</p>
              <p className={`text-xs font-medium leading-tight ${item.done ? 'text-green-700' : 'text-red-600'}`}>
                {item.label}
              </p>
              <p className={`text-xs mt-0.5 ${item.done ? 'text-green-500' : 'text-red-400'}`}>
                {item.done ? 'On file' : 'Missing'}
              </p>
            </div>
          ))}
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
              What&apos;s Needed
            </p>
            {critCount > 0 && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                {critCount} critical item{critCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {guidance.checklist.length === 0 ? (
            <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
              <p className="text-sm font-semibold text-green-700">✅ All key items collected</p>
              <p className="text-xs text-green-600 mt-0.5">This case is ready for attorney review.</p>
            </div>
          ) : (
            guidance.checklist.map((item, i) => (
              <ChecklistCard
                key={item.id}
                item={item}
                index={i}
                onOpenTemplate={setActiveItem}
              />
            ))
          )}
        </div>

        {/* Next steps */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Next Steps</p>
          <ol className="space-y-2">
            {guidance.next_steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                <span className="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>

      </div>
    </>
  )
}
