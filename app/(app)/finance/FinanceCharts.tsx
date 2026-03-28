'use client'

import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'

// ─── Color palette ────────────────────────────────────────────────────────────
const GROUP_COLORS: Record<string, string> = {
  'Advertising & Marketing':      '#FFD600',
  'Advertising & marketing':      '#FFD600',
  'Payroll Expenses':             '#1F2937',
  'Payroll expenses':             '#1F2937',
  'General Business Expenses':    '#3B82F6',
  'General business expenses':    '#3B82F6',
  'Utilities':                    '#F59E0B',
  'Office Expenses':              '#10B981',
  'Office expenses':              '#10B981',
  'Legal & Accounting Services':  '#8B5CF6',
  'Legal & Professional Fees':    '#8B5CF6',
  'Fees':                         '#6B7280',
  'Insurance':                    '#9CA3AF',
  'Travel':                       '#EF4444',
  'Meals & Entertainment':        '#F97316',
  'Taxes paid':                   '#D1D5DB',
  'Employee benefits':            '#A78BFA',
  'Rent':                         '#34D399',
}

function groupColor(name: string, idx: number): string {
  return GROUP_COLORS[name] || `hsl(${(idx * 53) % 360}, 55%, 55%)`
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toLocaleString()}`
}

function fmtFull(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-')
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[parseInt(m) - 1]} '${y.slice(2)}`
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ChartLine {
  id:               string
  entity_name:      string | null
  expense_group:    string | null
  amount:           number | null
  transaction_date: string | null
}

interface Props {
  lines:        ChartLine[]
  entityFilter: string
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color,
}: {
  label:  string
  value:  string
  sub?:   string
  color?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-bold truncate" style={{ color: color || '#111827' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

// ─── Shared tooltip formatter (avoid inline type annotation in JSX) ──────────
const tooltipFmt = (v: unknown) => fmtFull(Number(v))
const tooltipStyle = { borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 11 }

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 text-xs">
      <p className="text-gray-500 font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 justify-between">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
            <span className="text-gray-600">{p.dataKey}</span>
          </span>
          <span className="font-semibold text-gray-900 ml-4">{fmtFull(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function FinanceCharts({ lines, entityFilter }: Props) {
  // Exclude reimbursements
  const expLines = useMemo(
    () => lines.filter(l => l.expense_group !== 'Reimbursement' && (l.amount || 0) > 0),
    [lines]
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const total = useMemo(() => expLines.reduce((s, l) => s + (l.amount || 0), 0), [expLines])

  const { currMonthTotal, prevMonthTotal } = useMemo(() => {
    const now  = new Date()
    const curr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const pd   = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prev = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`
    let c = 0, p = 0
    for (const l of expLines) {
      const m = l.transaction_date?.slice(0, 7)
      if (m === curr) c += (l.amount || 0)
      if (m === prev) p += (l.amount || 0)
    }
    return { currMonthTotal: c, prevMonthTotal: p }
  }, [expLines])

  const momPct = prevMonthTotal > 0
    ? (currMonthTotal - prevMonthTotal) / prevMonthTotal * 100
    : 0

  const { topGroup, topGroupAmt } = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of expLines) {
      const g = l.expense_group || 'Other'
      map.set(g, (map.get(g) || 0) + (l.amount || 0))
    }
    let tg = '', ta = 0
    map.forEach((v, k) => { if (v > ta) { ta = v; tg = k } })
    return { topGroup: tg, topGroupAmt: ta }
  }, [expLines])

  const mktPct = useMemo(() => {
    const mkt = expLines
      .filter(l => l.expense_group?.toLowerCase().includes('advertis') || l.expense_group?.toLowerCase().includes('marketing'))
      .reduce((s, l) => s + (l.amount || 0), 0)
    return total > 0 ? (mkt / total * 100) : 0
  }, [expLines, total])

  // ── Monthly trend ─────────────────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const map = new Map<string, { le: number; rpl: number }>()
    for (const l of expLines) {
      const m = l.transaction_date?.slice(0, 7)
      if (!m) continue
      if (!map.has(m)) map.set(m, { le: 0, rpl: 0 })
      const e = map.get(m)!
      if (l.entity_name?.toLowerCase().includes('legal edge')) e.le += (l.amount || 0)
      else e.rpl += (l.amount || 0)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, d]) => ({
        month:          monthLabel(m),
        'Legal Edge':   Math.round(d.le),
        'RockPoint':    Math.round(d.rpl),
        'Total':        Math.round(d.le + d.rpl),
      }))
  }, [expLines])

  // ── Donut breakdown ───────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of expLines) {
      const g = l.expense_group || 'Other'
      map.set(g, (map.get(g) || 0) + (l.amount || 0))
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
  }, [expLines])

  const showBothEntities = entityFilter === 'all'

  return (
    <div className="space-y-5 mb-8">

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Expenses"
          value={fmtFull(total)}
          sub="selected period"
        />
        <KpiCard
          label="vs Last Month"
          value={`${momPct >= 0 ? '+' : ''}${momPct.toFixed(1)}%`}
          sub={`${fmtFull(currMonthTotal)} this month`}
          color={momPct > 15 ? '#EF4444' : momPct < -5 ? '#10B981' : '#111827'}
        />
        <KpiCard
          label="Top Category"
          value={topGroup || '\u2014'}
          sub={topGroupAmt > 0 ? fmtFull(topGroupAmt) : undefined}
        />
        <KpiCard
          label="Marketing Share"
          value={`${mktPct.toFixed(1)}%`}
          sub="of total spend"
          color="#B45309"
        />
      </div>

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Monthly trend — 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-5">Monthly Expenses</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={fmtShort}
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip content={ChartTooltip} />
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />
              {showBothEntities && (
                <Line
                  type="monotone"
                  dataKey="Legal Edge"
                  stroke="#1F2937"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
              {showBothEntities && (
                <Line
                  type="monotone"
                  dataKey="RockPoint"
                  stroke="#9CA3AF"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
              <Line
                type="monotone"
                dataKey={showBothEntities ? 'Total' : (entityFilter.toLowerCase().includes('legal edge') ? 'Legal Edge' : 'RockPoint')}
                stroke="#FFD600"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Expense group donut — 1/3 width */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">By Category</h3>
          <div className="flex flex-col items-center">
            <div className="relative">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={entry.name} fill={groupColor(entry.name, i)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={tooltipFmt} contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs text-gray-400">Total</span>
                <span className="text-sm font-bold text-gray-900">{fmtShort(total)}</span>
              </div>
            </div>
            {/* Legend */}
            <div className="w-full mt-3 space-y-1.5">
              {donutData.slice(0, 7).map((item, i) => (
                <div key={item.name} className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: groupColor(item.name, i) }}
                    />
                    <span className="text-gray-600 truncate">{item.name}</span>
                  </div>
                  <span className="text-gray-500 font-medium flex-shrink-0">{fmtShort(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
