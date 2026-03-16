'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient }                              from '@supabase/supabase-js'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalActive:   number
  settledMonth:  number
  totalPipeline: number
  byStage:       Record<string, number>
  fetchedAt:     string
}

interface CommsStats {
  awaiting:     number
  overdue:      number
  due_soon:     number
  unread_total: number
}

interface Props {
  initial: DashboardStats
}

// ── Stage config (matches HubSpot chart) ───────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'intake',              label: 'Intake',           color: 'bg-blue-300',    text: 'text-blue-800'    },
  { key: 'nurture',             label: 'Nurture',          color: 'bg-pink-300',    text: 'text-pink-800'    },
  { key: 'document_collection', label: 'Doc Collection',   color: 'bg-orange-300',  text: 'text-orange-800'  },
  { key: 'attorney_review',     label: 'Atty Review',      color: 'bg-indigo-300',  text: 'text-indigo-800'  },
  { key: 'info_needed',         label: 'Info Needed',      color: 'bg-amber-300',   text: 'text-amber-800'   },
  { key: 'sign_up',             label: 'Sign Up',          color: 'bg-teal-300',    text: 'text-teal-800'    },
  { key: 'retained',            label: 'Retained',         color: 'bg-green-500',   text: 'text-green-900'   },
  { key: 'settled',             label: 'Settled',          color: 'bg-emerald-700', text: 'text-emerald-100' },
]

// ── KPI Card ───────────────────────────────────────────────────────────────

function LiveKpiCard({
  label, value, accent, href, flash,
}: {
  label: string
  value: string | number
  accent?: string
  href?: string
  flash: boolean
}) {
  const inner = (
    <div className={`relative bg-white rounded-xl border p-5 shadow-card transition-all duration-300
      ${flash ? 'border-lemon-400 ring-2 ring-lemon-400/30' : 'border-gray-200'}
      ${href ? 'hover:-translate-y-0.5 hover:shadow-md cursor-pointer' : ''}`}>
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl ${accent ?? 'bg-lemon-400'}`} />
      <p className={`text-2xl font-bold text-gray-900 transition-all duration-300 ${flash ? 'scale-105' : 'scale-100'}`}>
        {value}
      </p>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mt-1">{label}</p>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

// ── Pipeline Bar Chart ─────────────────────────────────────────────────────

function PipelineChart({ byStage, flash }: { byStage: Record<string, number>; flash: boolean }) {
  const maxVal = Math.max(...PIPELINE_STAGES.map(s => byStage[s.key] ?? 0), 1)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-semibold text-gray-900">Pipeline by Stage</h2>
        {flash && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Updated
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="flex items-end gap-3 h-48">
        {PIPELINE_STAGES.map(stage => {
          const count = byStage[stage.key] ?? 0
          const pct   = maxVal > 0 ? (count / maxVal) * 100 : 0
          return (
            <div key={stage.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              {/* Count label */}
              <span className="text-xs font-semibold text-gray-700 tabular-nums">
                {count.toLocaleString()}
              </span>
              {/* Bar */}
              <div className="w-full flex items-end" style={{ height: '160px' }}>
                <div
                  className={`w-full rounded-t transition-all duration-500 ${stage.color}`}
                  style={{ height: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-3 mt-2">
        {PIPELINE_STAGES.map(stage => (
          <div key={stage.key} className="flex-1 min-w-0">
            <p className="text-center text-[10px] text-gray-400 leading-tight truncate" title={stage.label}>
              {stage.label}
            </p>
          </div>
        ))}
      </div>

      {/* Legend dots */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-gray-100">
        {PIPELINE_STAGES.map(stage => (
          <div key={stage.key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${stage.color}`} />
            <span className="text-[11px] text-gray-500">{stage.label} ({(byStage[stage.key] ?? 0).toLocaleString()})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function DashboardLive({ initial }: Props) {
  const [stats,      setStats]      = useState<DashboardStats>(initial)
  const [flash,      setFlash]      = useState(false)
  const [isLive,     setIsLive]     = useState(false)
  const [commsStats, setCommsStats] = useState<CommsStats | null>(null)
  const [commsFlash, setCommsFlash] = useState(false)
  const flashTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commsTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef                       = useRef<EventSource | null>(null)

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/stats')
      if (!res.ok) return
      const data: DashboardStats = await res.json()
      setStats(data)
      setFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(false), 2000)
    } catch { /* ignore */ }
  }, [])

  const refreshCommsStats = useCallback(async () => {
    try {
      const res = await fetch('/api/comms-stats')
      if (!res.ok) return
      const data: CommsStats = await res.json()
      setCommsStats(data)
      setCommsFlash(true)
      if (commsTimer.current) clearTimeout(commsTimer.current)
      commsTimer.current = setTimeout(() => setCommsFlash(false), 2000)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/cases/stream')
    esRef.current = es

    es.onopen = () => setIsLive(true)
    es.onerror = () => setIsLive(false)

    es.addEventListener('case', () => {
      // Any case change → refresh dashboard stats
      refreshStats()
    })

    return () => {
      es.close()
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [refreshStats])

  // Fetch comms stats on mount
  useEffect(() => { refreshCommsStats() }, [refreshCommsStats])

  // Supabase Realtime — live comms_state changes update dashboard KPIs
  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const ch = sb
      .channel('dashboard-comms-state')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'core', table: 'comms_state',
      }, () => { refreshCommsStats() })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [refreshCommsStats])

  return (
    <div className="space-y-6">
      {/* Live indicator */}
      <div className="flex items-center justify-end gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
        <span className="text-xs text-gray-400">{isLive ? 'Live' : 'Connecting…'}</span>
      </div>

      {/* Comms Health KPIs */}
      {commsStats && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Comms Health</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <LiveKpiCard
              label="Awaiting Response"
              value={commsStats.awaiting}
              accent={commsStats.awaiting > 0 ? 'bg-orange-400' : 'bg-gray-200'}
              href="/comms?filter=awaiting"
              flash={commsFlash}
            />
            <LiveKpiCard
              label="SLA Overdue"
              value={commsStats.overdue}
              accent={commsStats.overdue > 0 ? 'bg-red-400' : 'bg-gray-200'}
              href="/comms?filter=overdue"
              flash={commsFlash}
            />
            <LiveKpiCard
              label="Due Soon"
              value={commsStats.due_soon}
              accent={commsStats.due_soon > 0 ? 'bg-amber-400' : 'bg-gray-200'}
              href="/comms?filter=due_soon"
              flash={commsFlash}
            />
            <LiveKpiCard
              label="Unread Messages"
              value={commsStats.unread_total}
              accent={commsStats.unread_total > 0 ? 'bg-lemon-400' : 'bg-gray-200'}
              href="/comms"
              flash={commsFlash}
            />
          </div>
        </div>
      )}

      {/* Pipeline Chart */}
      <PipelineChart byStage={stats.byStage} flash={flash} />
    </div>
  )
}
