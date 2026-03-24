'use client'

import { useState, useEffect, useCallback } from 'react'
import type { IntelligenceReport } from '@/app/api/cases/[id]/intelligence/route'

// ── State law FAQ data ─────────────────────────────────────────────────────────

const STATE_LAW_FAQ: Record<string, { state: string; faqs: { q: string; a: string }[] }> = {
  TN: {
    state: 'Tennessee',
    faqs: [
      {
        q: 'Do I need a certain number of repairs to qualify?',
        a: 'Not necessarily. There\'s no magic number — what matters most is the pattern of the problem. Each time you bring your vehicle in for the same issue, it adds to your case. Once we have your repair records, we\'ll have a much clearer picture of where you stand and what your next steps are.',
      },
      {
        q: 'What if the dealership said they couldn\'t find anything wrong?',
        a: 'That can actually work in your favor. When a dealership repeatedly fails to diagnose or fix a problem, that history is documented in your repair orders — and it\'s an important part of your case. Bring your vehicle in and ask them to document every visit, even if they don\'t find anything.',
      },
      {
        q: 'What if I\'ve only been to the dealer once or twice?',
        a: 'That\'s a great start. Federal law (Magnuson-Moss Warranty Act) may apply even with a smaller number of visits, especially for serious or safety-related defects. Once we review your documents, we\'ll let you know exactly where your case stands.',
      },
      {
        q: 'What if my car has been in the shop for a long time?',
        a: 'Time in the shop is significant. Extended periods where you don\'t have access to your vehicle are a key factor in evaluating your case. Make sure you have a record of all the dates your car was at the dealership.',
      },
      {
        q: 'What happens after I send in my repair orders?',
        a: 'Our attorneys will review your documents and reach out with their assessment and next steps. We\'ll keep you informed every step of the way.',
      },
    ],
  },
  CA: {
    state: 'California',
    faqs: [
      {
        q: 'Do I need a certain number of repairs to qualify?',
        a: 'Not a fixed number — the focus is on whether the manufacturer had a reasonable opportunity to fix the problem. Even one or two repair visits may be enough depending on the severity of the defect. Send us your repair records and we\'ll take it from there.',
      },
      {
        q: 'What if the dealer couldn\'t find the problem?',
        a: 'That still counts. When a dealership repeatedly fails to identify or resolve a defect, that documented history strengthens your case. Every visit matters — keep bringing it in and asking them to note the concern.',
      },
      {
        q: 'What happens after I send in my repair orders?',
        a: 'Our attorneys will review your documents and reach out with their findings and next steps. California has strong consumer protection laws, and we\'ll make sure your case is evaluated fully.',
      },
    ],
  },
  FL: {
    state: 'Florida',
    faqs: [
      {
        q: 'How many repair attempts do I need?',
        a: 'There\'s no single answer — it depends on the nature of the defect and the history with your dealer. Even a small number of documented attempts may be enough. Once we see your repair orders, we\'ll be able to give you a clear picture.',
      },
      {
        q: 'What if the dealership kept the car for a long time?',
        a: 'That\'s very relevant. Extended time out of service is a key factor in Florida cases. Make sure all repair dates are documented — every day counts.',
      },
      {
        q: 'What happens once I provide my documents?',
        a: 'Our attorneys will review everything and reach out with next steps. Florida has strong Lemon Law protections, and we\'re here to make sure you get what you\'re owed.',
      },
    ],
  },
}

// Default FAQs for any state not specifically listed
const DEFAULT_FAQ = {
  state: 'your state',
  faqs: [
    {
      q: 'Do I need a certain number of repairs to qualify?',
      a: 'The exact requirements vary by state, but federal Magnuson-Moss law provides a baseline — and it can apply even with a small number of repair attempts, especially for serious defects. Once we have your repair records, our attorneys will evaluate exactly where your case stands.',
    },
    {
      q: 'What if the dealership said they couldn\'t find anything wrong?',
      a: 'That\'s actually part of the case. When a dealership documents a visit — even without a diagnosis — it creates a record. Keep bringing your vehicle in and asking them to note every concern.',
    },
    {
      q: 'What happens after I provide my documents?',
      a: 'Our attorneys will review your repair records and reach out with their assessment and recommended next steps. We\'ll keep you in the loop the whole way.',
    },
  ],
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChecklistItem {
  id:       string
  icon:     string
  what:     string
  how:      string[]
  then:     string
  note?:    string   // optional attorney-specific note
  template?: { type: 'sms' | 'call'; label: string; body: string }
}

// ── Template modal ─────────────────────────────────────────────────────────────

function TemplateModal({ item, onClose }: { item: ChecklistItem; onClose: () => void }) {
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
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-lg">{item.icon}</span>
              <h3 className="text-base font-semibold text-gray-900">{item.what}</h3>
            </div>
            <p className="text-sm text-gray-400">
              {t.type === 'sms' ? '💬 Text message template' : '📞 Call script'}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Message</p>
            <button onClick={copy} className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1">
              {copied
                ? <><svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg><span className="text-green-600">Copied!</span></>
                : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>Copy</>
              }
            </button>
          </div>
          <textarea
            readOnly value={t.body} rows={8}
            className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-xl p-4 resize-none focus:outline-none leading-relaxed"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={copy} className="flex-1 bg-gray-900 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-gray-800 active:scale-[0.98] transition-all">
            {copied ? '✓ Copied' : 'Copy to clipboard'}
          </button>
          <button onClick={onClose} className="px-4 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Checklist card ─────────────────────────────────────────────────────────────

function ChecklistCard({ item, index, onOpenTemplate }: {
  item: ChecklistItem; index: number; onOpenTemplate: (i: ChecklistItem) => void
}) {
  const [open, setOpen] = useState(index === 0)

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50/50 transition-colors"
      >
        <span className="shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center">
          {index + 1}
        </span>
        <span className="text-base shrink-0">{item.icon}</span>
        <span className="flex-1 text-sm font-semibold text-gray-900">{item.what}</span>
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-50">

          {/* Attorney note if present */}
          {item.note && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 flex items-start gap-2">
              <span className="text-amber-500 shrink-0 mt-0.5">⚖️</span>
              <p className="text-sm text-amber-800 leading-relaxed"><span className="font-semibold">Attorney note:</span> {item.note}</p>
            </div>
          )}

          {/* How to provide */}
          <div className={item.note ? '' : 'pt-4'}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">How the client can provide it</p>
            <ol className="space-y-2">
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
          <div className="bg-green-50/80 border border-green-100 rounded-lg px-3.5 py-3 flex items-start gap-2">
            <span className="text-green-500 shrink-0 mt-0.5">→</span>
            <p className="text-sm text-green-800 leading-relaxed">{item.then}</p>
          </div>

          {/* Template */}
          {item.template && (
            <button
              onClick={() => onOpenTemplate(item)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 active:scale-[0.98] transition-all"
            >
              {item.template.type === 'sms' ? '💬' : '📞'} {item.template.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── FAQ section ────────────────────────────────────────────────────────────────

function FAQSection({ state }: { state: string | null }) {
  const [open, setOpen] = useState(false)
  const [openItems, setOpenItems] = useState<Set<number>>(new Set())
  const data = (state && STATE_LAW_FAQ[state.toUpperCase()]) || DEFAULT_FAQ

  function toggleItem(i: number) {
    setOpenItems(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">❓</span>
          <span className="text-sm font-semibold text-gray-800">Client FAQs</span>
          <span className="text-xs text-gray-400">{data.state}</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-50 divide-y divide-gray-50">
          {data.faqs.map((faq, i) => (
            <div key={i}>
              <button
                onClick={() => toggleItem(i)}
                className="w-full flex items-start justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-50/30 transition-colors"
              >
                <p className="text-sm font-medium text-gray-800 leading-relaxed">{faq.q}</p>
                <svg className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform duration-150 ${openItems.has(i) ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {openItems.has(i) && (
                <div className="px-5 pb-4">
                  <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Communication summary builder ──────────────────────────────────────────────

function buildCommSummary(report: IntelligenceReport): string {
  const { tier2_comms: t2 } = report
  if (t2.total_engagements === 0) return 'No prior communications on record.'

  const parts: string[] = []

  if (t2.calls > 0) {
    parts.push(`${t2.calls} call${t2.calls !== 1 ? 's' : ''} on record.`)
  }
  if (t2.notes > 0) {
    parts.push(`${t2.notes} note${t2.notes !== 1 ? 's' : ''} logged.`)
  }

  // Add full call summaries (not truncated)
  if (t2.call_summaries.length > 0) {
    parts.push(...t2.call_summaries)
  }

  // Add notes content from engagement texts that aren't calls
  const noteTexts = (t2.all_engagement_texts ?? []).filter(t =>
    !t2.call_summaries.some(s => t.includes(s.slice(0, 50)))
  ).filter(t => t.length > 20).slice(0, 3)

  if (noteTexts.length > 0) {
    parts.push(...noteTexts)
  }

  return parts.join('\n\n')
}

// ── Main guidance builder ──────────────────────────────────────────────────────

function buildGuidance(report: IntelligenceReport): {
  situation:  string
  checklist:  ChecklistItem[]
  next_steps: string[]
  stage_goal: string
} {
  const { tier1_intake: t1, tier2_comms: t2, tier3_docs: t3, attorney } = report

  const vehicle     = t1.vehicle ?? 'their vehicle'
  const issues      = t1.issues
  const repairCount = t1.repair_count
  const nurtureNotes = t1.nurture_notes
  const nurtureReason = t1.nurture_reason

  // ── Situation — no follow-up timing ───────────────────────────────────────
  const situationParts: string[] = []

  let opening = `This client has a ${vehicle}`
  if (issues.length > 0) opening += ` with ${issues.slice(0, 2).join(' and ')}`
  opening += '.'
  situationParts.push(opening)

  if (repairCount !== null && repairCount > 0) {
    situationParts.push(`They have had ${repairCount} documented repair visit${repairCount !== 1 ? 's' : ''} with the dealership.`)
  }

  if (nurtureReason) situationParts.push(`Nurture reason: ${nurtureReason}.`)
  if (nurtureNotes)  situationParts.push(`Notes: ${nurtureNotes}.`)

  if (t3.has_repair_orders) {
    situationParts.push('Repair orders are on file.')
  } else {
    situationParts.push('No repair orders have been provided yet.')
  }

  // Attorney context
  if (attorney.review_decision) {
    situationParts.push(`Attorney decision: ${attorney.review_decision}.`)
  }
  if (attorney.nurture_decision) {
    situationParts.push(`Attorney guidance: ${attorney.nurture_decision}.`)
  }

  const situation = situationParts.join(' ')

  // ── Checklist ──────────────────────────────────────────────────────────────
  const checklist: ChecklistItem[] = []

  // 1. Repair orders — always first unless already on file
  if (!t3.has_repair_orders) {
    checklist.push({
      id:   'repair_orders',
      icon: '🔧',
      what: 'Repair orders from the dealership',
      how: [
        'If they have copies at home, take a clear photo of each page and reply to your text message.',
        'If they don\'t have copies, call the dealership\'s service department and ask for all service records associated with their vehicle. Dealers are required to provide these.',
        'Make sure to get records for every visit, even if the dealership said they couldn\'t find anything.',
      ],
      then: 'Once we receive the repair orders, our attorneys will review the documents and reach out with their assessment and recommended next steps.',
      template: {
        type:  'sms',
        label: 'Send repair record request',
        body:  `Hi [Client Name]! This is [Your Name] from Easy Lemon 🍋\n\nTo move your case forward, we need copies of your repair records — the paperwork from each time you brought your ${vehicle} into the dealership.\n\nHere's how to get them:\n\n1. If you have copies at home — take a photo and reply to this text!\n2. If not — call the dealership's service department and ask for copies of all service records for your vehicle.\n\nOnce we have these, our attorneys will review everything and get back to you with next steps. Reply here or call us at (855) 435-3666 if you have any questions!`,
      },
    })
  }

  // 2. Attorney-specifically requested documents
  if (attorney.specific_requests.length > 0) {
    for (const req of attorney.specific_requests) {
      const isPurchaseAgmt = /purchase|lease/i.test(req)
      checklist.push({
        id:   `atty_req_${req.replace(/\s+/g, '_').toLowerCase()}`,
        icon: '⚖️',
        what: req,
        note: attorney.clarification_needed || attorney.nurture_decision || undefined,
        how: isPurchaseAgmt
          ? [
              'Ask the client to locate the paperwork they signed at the dealership when they purchased or leased the vehicle.',
              'If they can\'t find it, they can contact the dealership\'s finance department for a copy, or check their email for a digital version.',
              'Take a photo of all pages and reply to your text message.',
            ]
          : [
              'Contact the client directly and explain what\'s needed.',
              'Ask them to take a photo and reply to your text message, or email it to us.',
            ],
        then: 'Once received, the attorney will be able to complete their review and determine next steps.',
        template: isPurchaseAgmt ? {
          type:  'sms',
          label: `Send ${req} request`,
          body:  `Hi [Client Name]! This is [Your Name] from Easy Lemon 🍋\n\nOur attorney reviewing your case has a quick follow-up request — they need a copy of your vehicle's purchase or lease agreement (the contract you signed at the dealership).\n\nYou can:\n1. Take a photo and reply to this text\n2. Contact the dealership's finance department if you need a new copy\n\nOnce we have this, your attorney will be able to finalize their review. Thank you! Reply or call us at (855) 435-3666 with any questions.`
        } : undefined,
      })
    }
  }

  // 3. Re-engagement if very overdue and no docs
  if (!t3.has_repair_orders && t2.days_since_contact !== null && t2.days_since_contact > 14) {
    checklist.push({
      id:   're_engage',
      icon: '📞',
      what: 'Re-engage the client',
      how: [
        'Send a warm check-in message to let them know their case is active and we\'re here to help.',
        'Keep the tone positive — remind them that every new repair visit strengthens their case.',
        'If they don\'t respond to a text within 2–3 days, follow up with a call.',
      ],
      then: 'Once re-engaged, focus the conversation on collecting their repair records.',
      template: {
        type:  'sms',
        label: 'Send check-in text',
        body:  `Hi [Client Name]! This is [Your Name] from Easy Lemon 🍋 Just checking in — we're still here and working on your case.\n\nHave there been any updates with your ${vehicle}? Any new trips to the dealership or additional time in the shop?\n\nEvery visit helps build your case. If you've been able to gather your repair records, feel free to reply with a photo. Otherwise, just let us know where things stand and we'll walk you through the next steps.\n\n(855) 435-3666`,
      },
    })
  }

  // ── Next steps ─────────────────────────────────────────────────────────────
  const nextSteps: string[] = []

  if (!t3.has_repair_orders) {
    nextSteps.push('Send the repair record request and follow up if no response after a few days.')
  }
  if (attorney.specific_requests.length > 0) {
    nextSteps.push(`Attorney has requested additional documentation: ${attorney.specific_requests.join(', ')}. Collect and submit.`)
  }
  nextSteps.push('Once the client provides their repair records, our attorneys will review the documents and determine the next course of action.')
  nextSteps.push('Let the client know when their documents have been received — keeping them informed goes a long way.')

  if (t3.has_repair_orders && attorney.specific_requests.length === 0) {
    nextSteps.length = 0
    nextSteps.push('Repair orders are on file. Flag this case for attorney review if not already done.')
    nextSteps.push('Let the client know their documents have been received and that an attorney is reviewing their case.')
  }

  return {
    situation,
    checklist,
    next_steps: nextSteps,
    stage_goal: t3.has_repair_orders && attorney.specific_requests.length === 0
      ? 'Documents received — ready for attorney review.'
      : 'Collect repair records so our attorneys can evaluate the case.',
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { dealId: string; caseUUID: string | null }

export function GuidanceTab({ dealId }: Props) {
  const [report,     setReport]     = useState<IntelligenceReport | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [activeItem, setActiveItem] = useState<ChecklistItem | null>(null)

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
      <div className="h-12 bg-yellow-50 rounded-xl" />
      <div className="h-24 bg-gray-50 rounded-xl" />
      {[1,2].map(i => <div key={i} className="h-14 bg-gray-50 rounded-xl" />)}
    </div>
  )

  if (error || !report) return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
      Could not load guidance. <button onClick={load} className="underline text-gray-600">Retry</button>
    </div>
  )

  const guidance   = buildGuidance(report)
  const commSummary = buildCommSummary(report)

  return (
    <>
      {activeItem && <TemplateModal item={activeItem} onClose={() => setActiveItem(null)} />}

      <div className="space-y-5">

        {/* Stage goal */}
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3.5">
          <span className="text-yellow-500 text-lg shrink-0">🎯</span>
          <p className="flex-1 text-sm font-semibold text-yellow-900">{guidance.stage_goal}</p>
          <button onClick={load} className="shrink-0 text-yellow-500 hover:text-yellow-700 transition-colors" title="Refresh">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Situation */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Situation</p>
          <p className="text-sm text-gray-700 leading-relaxed">{guidance.situation}</p>
        </div>

        {/* Communication summary */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Communication Summary</p>
          {commSummary === 'No prior communications on record.' ? (
            <p className="text-sm text-gray-400 italic">No prior communications on record.</p>
          ) : (
            <div className="space-y-3">
              {commSummary.split('\n\n').filter(Boolean).map((block, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed">{block}</p>
              ))}
            </div>
          )}
        </div>

        {/* Document status */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Repair Orders',      done: report.tier3_docs.has_repair_orders, icon: '🔧' },
            { label: 'Purchase Agreement', done: report.tier3_docs.has_purchase_agmt, icon: '📋',
              note: report.attorney.specific_requests.some(r => /purchase|lease/i.test(r)) ? 'Requested by attorney' : null },
          ].map(item => (
            <div key={item.label} className={`rounded-xl p-3.5 border text-center ${item.done ? 'bg-green-50 border-green-100' : 'bg-red-50/60 border-red-100'}`}>
              <p className="text-lg mb-1">{item.done ? '✅' : item.icon}</p>
              <p className={`text-xs font-semibold ${item.done ? 'text-green-700' : 'text-red-600'}`}>{item.label}</p>
              <p className={`text-xs mt-0.5 ${item.done ? 'text-green-500' : item.note ? 'text-amber-600 font-medium' : 'text-red-400'}`}>
                {item.done ? 'On file' : item.note ?? 'Missing'}
              </p>
            </div>
          ))}
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">What&apos;s Needed</p>
          {guidance.checklist.length === 0 ? (
            <div className="bg-green-50 border border-green-100 rounded-xl p-5 text-center">
              <p className="text-sm font-semibold text-green-700">✅ All key items collected</p>
              <p className="text-xs text-green-600 mt-1">This case is ready for attorney review.</p>
            </div>
          ) : (
            guidance.checklist.map((item, i) => (
              <ChecklistCard key={item.id} item={item} index={i} onOpenTemplate={setActiveItem} />
            ))
          )}
        </div>

        {/* Next steps */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Next Steps</p>
          <ol className="space-y-2.5">
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

        {/* FAQs */}
        <FAQSection state={report.tier1_intake.state} />

      </div>
    </>
  )
}
