'use client'

import { useState, useEffect, useCallback } from 'react'
import type { IntelligenceReport, GuidanceChecklistItem } from '@/app/api/cases/[id]/intelligence/route'

// ── State FAQ data ─────────────────────────────────────────────────────────────

const STATE_FAQ: Record<string, { state: string; faqs: { q: string; a: string }[] }> = {
  TN: { state: 'Tennessee', faqs: [
    { q: 'Do I need a certain number of repairs to qualify?',
      a: 'There\'s no fixed number — what matters most is the pattern. Every time you bring your vehicle in for the same issue, it adds to your record. Even visits where the dealer couldn\'t find anything count. Once we have your service records, we\'ll be in a much better position to assess the case.' },
    { q: 'What if the dealership said they couldn\'t find anything wrong?',
      a: 'That actually works in your favor. When a dealership repeatedly fails to diagnose or fix a problem, that documented history is part of your case. Keep bringing the vehicle in and ask them to note every visit in writing.' },
    { q: 'What if my car has been in the shop for a long time?',
      a: 'Time in the shop matters. Extended periods where you don\'t have access to your vehicle are a key factor we track. Make sure the dealership documents the dates your car is with them.' },
    { q: 'What happens after I send in my service records?',
      a: 'Our attorneys will review your documents and reach out with their assessment and recommended next steps. We\'ll keep you updated the whole way.' },
  ]},
  CA: { state: 'California', faqs: [
    { q: 'How many visits do I need?',
      a: 'There\'s no magic number. The focus is on whether the manufacturer had a fair opportunity to fix the problem. Even one or two visits may be enough depending on the defect. Send us your service records and we\'ll take it from there.' },
    { q: 'What if the dealer couldn\'t find the problem?',
      a: 'That still counts. Every documented visit — even "no fault found" — builds your case. Keep going back and asking them to note every visit.' },
    { q: 'What happens after I provide my records?',
      a: 'Our attorneys will review your documents and reach out with findings and next steps. California has very strong consumer protection laws.' },
  ]},
}

const DEFAULT_FAQ = { state: 'your state', faqs: [
  { q: 'Do I need a certain number of repairs to qualify?',
    a: 'Not necessarily — federal law may apply with even a small number of visits, especially for serious defects. Once we have your service records, our attorneys will evaluate exactly where your case stands.' },
  { q: 'What if the dealer said they couldn\'t find anything?',
    a: 'Every documented visit counts, even when no fix was made. Keep bringing the vehicle in and ask for paperwork every time.' },
  { q: 'What happens after I provide my documents?',
    a: 'Our attorneys will review everything and reach out with their assessment and recommended next steps.' },
]}

// ── Template modal ─────────────────────────────────────────────────────────────

function TemplateModal({ item, onClose }: { item: GuidanceChecklistItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const t = item.template!
  function copy() {
    navigator.clipboard.writeText(t.body).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
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
            <p className="text-sm text-gray-400">{t.type === 'sms' ? '💬 Text message template' : '📞 Call script'}</p>
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
          <textarea readOnly value={t.body} rows={8}
            className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-xl p-4 resize-none focus:outline-none leading-relaxed" />
        </div>
        <div className="flex gap-2">
          <button onClick={copy} className="flex-1 bg-gray-900 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-gray-800 active:scale-[0.98] transition-all">
            {copied ? '✓ Copied' : 'Copy to clipboard'}
          </button>
          <button onClick={onClose} className="px-4 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all">Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Checklist card ─────────────────────────────────────────────────────────────

function ChecklistCard({ item, index, onOpen }: {
  item: GuidanceChecklistItem; index: number; onOpen: () => void
}) {
  const [open, setOpen] = useState(index === 0)
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50/50 transition-colors">
        <span className="shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center">{index + 1}</span>
        <span className="text-base shrink-0">{item.icon}</span>
        <span className="flex-1 text-sm font-semibold text-gray-900">{item.what}</span>
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-50">
          {item.note && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 flex items-start gap-2">
              <span className="text-amber-500 shrink-0 mt-0.5">⚖️</span>
              <p className="text-sm text-amber-800 leading-relaxed"><span className="font-semibold">Attorney note: </span>{item.note}</p>
            </div>
          )}
          <div className={item.note ? '' : 'pt-4'}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">How the client can provide it</p>
            <ol className="space-y-2">
              {item.how.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-xs font-semibold text-gray-500 flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="bg-green-50/80 border border-green-100 rounded-lg px-3.5 py-3 flex items-start gap-2">
            <span className="text-green-500 shrink-0 mt-0.5">→</span>
            <p className="text-sm text-green-800 leading-relaxed">{item.then}</p>
          </div>
          {item.template && (
            <button onClick={onOpen}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 active:scale-[0.98] transition-all">
              {item.template.type === 'sms' ? '💬' : '📞'} {item.template.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Communication timeline ─────────────────────────────────────────────────────

type TimelineEntry = IntelligenceReport['tier2_comms']['timeline'][number]

function CommTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries || entries.length === 0)
    return <p className="text-sm text-gray-400 italic">No prior communications on record.</p>

  const TYPE_ICON:  Record<string, string> = { CALL: '📞', NOTE: '📝', EMAIL: '✉️', TASK: '✅' }
  const TYPE_LABEL: Record<string, string> = { CALL: 'Call', NOTE: 'Note', EMAIL: 'Email', TASK: 'Task' }

  return (
    <div className="space-y-3">
      {entries.map((entry, i) => {
        const dateStr = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        return (
          <div key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-sm shrink-0">
                {TYPE_ICON[entry.type] ?? '•'}
              </div>
              {i < entries.length - 1 && <div className="w-px flex-1 bg-gray-100 mt-1" />}
            </div>
            <div className="flex-1 pb-3">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-semibold text-gray-700">
                  {TYPE_LABEL[entry.type] ?? entry.type}
                  {entry.direction === 'OUTBOUND' ? ' · Outbound' : entry.direction === 'INBOUND' ? ' · Inbound' : ''}
                </span>
                {entry.agent && <span className="text-xs text-gray-400">by {entry.agent}</span>}
                <span className="ml-auto text-xs text-gray-400 shrink-0">{dateStr}</span>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{entry.summary}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── FAQ section ────────────────────────────────────────────────────────────────

function FAQSection({ state }: { state: string | null }) {
  const [open, setOpen]       = useState(false)
  const [openIdx, setOpenIdx] = useState<Set<number>>(new Set())
  const data = (state && STATE_FAQ[state.toUpperCase()]) || DEFAULT_FAQ

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
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
              <button onClick={() => setOpenIdx(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n })}
                className="w-full flex items-start justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-50/30 transition-colors">
                <p className="text-sm font-medium text-gray-800 leading-relaxed">{faq.q}</p>
                <svg className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform duration-150 ${openIdx.has(i) ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {openIdx.has(i) && (
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

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { dealId: string; caseUUID: string | null }

export function GuidanceTab({ dealId }: Props) {
  const [report,     setReport]     = useState<IntelligenceReport | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [activeItem, setActiveItem] = useState<GuidanceChecklistItem | null>(null)

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

  const g  = report.guidance
  const t3 = report.tier3_docs
  const t2 = report.tier2_comms

  // Doc status — show service records OR repair orders depending on case state
  const repairStatus  = g._context.repair_status
  const primaryDocLabel = repairStatus === 'repairs_completed' ? 'Repair Orders' : 'Service Records'
  const primaryDocDone  = repairStatus === 'repairs_completed' ? t3.has_repair_orders : (t3.has_repair_orders || t3.doc_types.includes('service_record'))
  const showPurchaseAgmt = t3.has_purchase_agmt || report.attorney.specific_requests.some(r => /purchase|lease/i.test(r))

  return (
    <>
      {activeItem && <TemplateModal item={activeItem} onClose={() => setActiveItem(null)} />}
      <div className="space-y-5">

        {/* Stage goal */}
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3.5">
          <span className="text-yellow-500 text-lg shrink-0">🎯</span>
          <p className="flex-1 text-sm font-semibold text-yellow-900">{g.stage_goal}</p>
          <button onClick={load} className="shrink-0 text-yellow-500 hover:text-yellow-700 transition-colors" title="Refresh">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Situation */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Situation</p>
          <p className="text-sm text-gray-700 leading-relaxed">{g.situation}</p>
        </div>

        {/* Communication timeline */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Communication Summary</p>
          <CommTimeline entries={t2.timeline} />
        </div>

        {/* Document status */}
        <div className={`grid gap-2 ${showPurchaseAgmt ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className={`rounded-xl p-3.5 border text-center ${primaryDocDone ? 'bg-green-50 border-green-100' : 'bg-red-50/60 border-red-100'}`}>
            <p className="text-lg mb-1">{primaryDocDone ? '✅' : '🔧'}</p>
            <p className={`text-xs font-semibold ${primaryDocDone ? 'text-green-700' : 'text-red-600'}`}>{primaryDocLabel}</p>
            <p className={`text-xs mt-0.5 ${primaryDocDone ? 'text-green-500' : 'text-red-400'}`}>{primaryDocDone ? 'On file' : 'Missing'}</p>
          </div>
          {showPurchaseAgmt && (
            <div className={`rounded-xl p-3.5 border text-center ${t3.has_purchase_agmt ? 'bg-green-50 border-green-100' : 'bg-amber-50/60 border-amber-100'}`}>
              <p className="text-lg mb-1">{t3.has_purchase_agmt ? '✅' : '📋'}</p>
              <p className={`text-xs font-semibold ${t3.has_purchase_agmt ? 'text-green-700' : 'text-amber-700'}`}>Purchase Agreement</p>
              <p className={`text-xs mt-0.5 ${t3.has_purchase_agmt ? 'text-green-500' : 'text-amber-500 font-medium'}`}>
                {t3.has_purchase_agmt ? 'On file' : 'Requested by attorney'}
              </p>
            </div>
          )}
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">What&apos;s Needed</p>
          {g.checklist.length === 0 ? (
            <div className="bg-green-50 border border-green-100 rounded-xl p-5 text-center">
              <p className="text-sm font-semibold text-green-700">✅ All key items collected</p>
              <p className="text-xs text-green-600 mt-1">This case is ready for attorney review.</p>
            </div>
          ) : (
            g.checklist.map((item, i) => (
              <ChecklistCard key={item.id} item={item} index={i} onOpen={() => setActiveItem(item)} />
            ))
          )}
        </div>

        {/* Next steps */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Next Steps</p>
          <ol className="space-y-2.5">
            {g.next_steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                <span className="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
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
