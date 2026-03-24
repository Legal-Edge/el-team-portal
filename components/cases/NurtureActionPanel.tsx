'use client'

import { useState, useEffect, useCallback } from 'react'
import type { IntelligenceReport, EvidenceGap, AgentAction } from '@/app/api/cases/[id]/intelligence/route'

// ── Priority badge ─────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  high:     'bg-orange-100 text-orange-700 border border-orange-200',
  medium:   'bg-yellow-100 text-yellow-700 border border-yellow-200',
  low:      'bg-gray-100 text-gray-500 border border-gray-200',
}
const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
}

// ── Tier indicator ─────────────────────────────────────────────────────────────
function TierBadge({ tier, label }: { tier: 1 | 2 | 3; label: string }) {
  const styles = [
    'bg-gray-100 text-gray-500',
    'bg-blue-100 text-blue-700',
    'bg-green-100 text-green-700',
  ]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${styles[tier - 1]}`}>
      <span>T{tier}</span>
      <span className="opacity-60">·</span>
      <span>{label}</span>
    </span>
  )
}

// ── SMS Template modal ─────────────────────────────────────────────────────────
function TemplateModal({ action, onClose }: { action: AgentAction; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    if (!action.template) return
    navigator.clipboard.writeText(action.template).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">

        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{action.title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{action.description}</p>
          </div>
          <button onClick={onClose} className="shrink-0 p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {action.template && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                {action.type === 'call' ? 'Call Script' : action.type === 'sms' ? 'Message Template' : 'Script'}
              </p>
              <button
                onClick={copy}
                className="text-xs font-medium text-brand-lemon hover:text-yellow-500 transition-colors flex items-center gap-1"
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
            <textarea
              readOnly
              value={action.template}
              rows={6}
              className="w-full text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-3.5 resize-none focus:outline-none leading-relaxed font-[inherit]"
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={copy} className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-gray-800 active:scale-95 transition-all">
            {copied ? '✓ Copied to clipboard' : 'Copy message'}
          </button>
          <button onClick={onClose} className="px-4 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-xl border border-gray-200 hover:bg-gray-50 transition-all">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Gap card ───────────────────────────────────────────────────────────────────
function GapCard({ gap }: { gap: EvidenceGap }) {
  const icons: Record<string, string> = {
    document: '📄', follow_up: '📞', confirmation: '✓', stage_advance: '→',
  }
  return (
    <div className={`flex gap-3 p-3.5 rounded-xl border ${
      gap.priority === 'critical' ? 'bg-red-50/60 border-red-100' :
      gap.priority === 'high'     ? 'bg-orange-50/60 border-orange-100' :
      gap.priority === 'medium'   ? 'bg-yellow-50/60 border-yellow-100' :
                                    'bg-gray-50/60 border-gray-100'
    }`}>
      <span className="text-base shrink-0 mt-0.5">{icons[gap.category] ?? '•'}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <p className="text-sm font-semibold text-gray-800">{gap.title}</p>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLES[gap.priority]}`}>
            {PRIORITY_LABELS[gap.priority]}
          </span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">{gap.description}</p>
      </div>
    </div>
  )
}

// ── Action card ────────────────────────────────────────────────────────────────
function ActionCard({ action, onOpen }: { action: AgentAction; onOpen: () => void }) {
  const typeIcons: Record<string, string> = {
    sms: '💬', call: '📞', email: '✉️', internal: '🔍', advance_stage: '➡️',
  }
  const typeColors: Record<string, string> = {
    sms:           'bg-blue-600 hover:bg-blue-700 text-white',
    call:          'bg-green-600 hover:bg-green-700 text-white',
    email:         'bg-purple-600 hover:bg-purple-700 text-white',
    internal:      'bg-gray-600 hover:bg-gray-700 text-white',
    advance_stage: 'bg-brand-lemon hover:bg-yellow-400 text-gray-900',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">
        {typeIcons[action.type] ?? '•'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 mb-0.5">{action.title}</p>
        <p className="text-xs text-gray-500 leading-relaxed">{action.description}</p>
      </div>
      {action.template && (
        <button
          onClick={onOpen}
          className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95 ${typeColors[action.type] ?? typeColors.internal}`}
        >
          {action.cta}
        </button>
      )}
    </div>
  )
}

// ── Evidence tier summary ──────────────────────────────────────────────────────
function EvidenceSummary({ report }: { report: IntelligenceReport }) {
  const { tier1_intake: t1, tier2_comms: t2, tier3_docs: t3 } = report

  const t1Complete = Boolean(t1.vehicle && t1.issues.length > 0)
  const t2Active   = t2.total_engagements > 0
  const t3Complete = t3.has_repair_orders && t3.has_purchase_agmt

  return (
    <div className="grid grid-cols-3 gap-2">
      {/* Tier 1 */}
      <div className={`rounded-xl p-3.5 border ${t1Complete ? 'bg-gray-50 border-gray-100' : 'bg-yellow-50/60 border-yellow-100'}`}>
        <div className="flex items-center gap-1.5 mb-2">
          <TierBadge tier={1} label="Intake" />
          <span className="ml-auto text-base">{t1Complete ? '✓' : '⚠️'}</span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          {t1.vehicle ? `${t1.vehicle}` : 'Vehicle unconfirmed'}
          {t1.issues.length > 0 && <><br />{t1.issues.length} issue{t1.issues.length !== 1 ? 's' : ''} reported</>}
          {t1.repair_count !== null && <><br />{t1.repair_count} repair{t1.repair_count !== 1 ? 's' : ''} claimed</>}
        </p>
      </div>

      {/* Tier 2 */}
      <div className={`rounded-xl p-3.5 border ${t2Active ? 'bg-blue-50/60 border-blue-100' : 'bg-yellow-50/60 border-yellow-100'}`}>
        <div className="flex items-center gap-1.5 mb-2">
          <TierBadge tier={2} label="Comms" />
          <span className="ml-auto text-base">{t2Active ? '✓' : '⚠️'}</span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          {t2.calls > 0 ? `${t2.calls} call${t2.calls !== 1 ? 's' : ''}` : 'No calls'}
          {t2.notes > 0 && <>, {t2.notes} note{t2.notes !== 1 ? 's' : ''}</>}
          {t2.days_since_contact !== null && (
            <><br /><span className={t2.days_since_contact > 14 ? 'text-orange-600 font-medium' : ''}>{t2.days_since_contact}d since contact</span></>
          )}
        </p>
      </div>

      {/* Tier 3 */}
      <div className={`rounded-xl p-3.5 border ${t3Complete ? 'bg-green-50/60 border-green-100' : 'bg-red-50/60 border-red-100'}`}>
        <div className="flex items-center gap-1.5 mb-2">
          <TierBadge tier={3} label="Documents" />
          <span className="ml-auto text-base">{t3Complete ? '✓' : '🔴'}</span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          {t3.total_docs > 0 ? `${t3.total_docs} file${t3.total_docs !== 1 ? 's' : ''} on file` : 'No documents'}
          {t3.missing_critical.length > 0 && (
            <><br /><span className="text-red-600 font-medium">Missing: {t3.missing_critical.slice(0, 2).join(', ')}</span></>
          )}
        </p>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

interface Props {
  dealId:    string
  caseUUID:  string | null
}

export function NurtureActionPanel({ dealId, caseUUID }: Props) {
  const [report,  setReport]  = useState<IntelligenceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<AgentAction | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases/${dealId}/intelligence`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setReport(data)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <p className="text-sm font-semibold text-gray-700">Analyzing case…</p>
        </div>
        {[1,2,3].map(i => (
          <div key={i} className="h-16 bg-gray-50 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
        <p className="text-sm text-gray-400">Could not load intelligence report. <button onClick={load} className="text-gray-600 underline">Retry</button></p>
      </div>
    )
  }

  const criticalGaps = report.gaps.filter(g => g.priority === 'critical').length
  const callSummary  = report.tier2_comms.call_summaries[0]

  return (
    <>
      {activeAction && (
        <TemplateModal action={activeAction} onClose={() => setActiveAction(null)} />
      )}

      <div className="space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🎯</span>
            <h3 className="text-sm font-semibold text-gray-900">Agent Guidance</h3>
            {criticalGaps > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {criticalGaps} critical
              </span>
            )}
          </div>
          <button
            onClick={load}
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Evidence tier summary */}
        <EvidenceSummary report={report} />

        {/* Last call summary */}
        {callSummary && (
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-blue-700 uppercase tracking-widest">Last Call Summary</span>
              {report.tier2_comms.days_since_contact !== null && (
                <span className="text-xs text-blue-500">{report.tier2_comms.days_since_contact}d ago</span>
              )}
            </div>
            <p className="text-xs text-blue-900 leading-relaxed line-clamp-4">{callSummary}</p>
          </div>
        )}

        {/* Gaps */}
        {report.gaps.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Evidence Gaps</p>
            {report.gaps.map(gap => <GapCard key={gap.id} gap={gap} />)}
          </div>
        )}

        {/* Actions */}
        {report.actions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Actions</p>
            {report.actions.map(action => (
              <ActionCard
                key={action.id}
                action={action}
                onOpen={() => setActiveAction(action)}
              />
            ))}
          </div>
        )}

      </div>
    </>
  )
}
