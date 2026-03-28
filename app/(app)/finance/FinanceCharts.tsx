'use client'

import { useMemo } from 'react'
import {
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
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
  account_name:     string | null
  amount:           number | null
  transaction_date: string | null
  qb_transactions:  { vendor_name: string | null } | { vendor_name: string | null }[] | null
}

interface SettlementRow {
  revenue_date:   string
  attorneys_fees: number
  deal_name:      string | null
}

interface Props {
  lines:        ChartLine[]
  entityFilter: string
  settlements:  SettlementRow[]
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

// ─── Shared tooltip style ─────────────────────────────────────────────────────
const tooltipStyle = { borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 11 }

// ─── Line chart tooltip — hides $0 rows ──────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((p: any) => p.value > 0)
  if (!visible.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 text-xs min-w-[180px]">
      <p className="text-gray-400 font-medium mb-2 text-[11px]">{label}</p>
      {visible.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-gray-600">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
            {p.name || p.dataKey}
          </span>
          <span className="font-semibold text-gray-900 tabular-nums">{fmtFull(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Donut tooltip ────────────────────────────────────────────────────────────
function DonutTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  if (!p || !p.value) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-3 py-2 text-xs">
      <p className="text-gray-600 font-medium">{p.name}</p>
      <p className="text-gray-900 font-bold mt-0.5">{fmtFull(p.value)}</p>
    </div>
  )
}

// ─── Bar chart tooltip — hides $0 rows, sorts by value ───────────────────────
function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((p: any) => p.value > 0).sort((a: any, b: any) => b.value - a.value)
  if (!visible.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 text-xs min-w-[200px] max-h-60 overflow-y-auto">
      <p className="text-gray-400 font-medium mb-2 text-[11px]">{label}</p>
      {visible.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-gray-600 truncate">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.fill || p.color }} />
            <span className="truncate">{p.name || p.dataKey}</span>
          </span>
          <span className="font-semibold text-gray-900 tabular-nums flex-shrink-0">{fmtFull(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function FinanceCharts({ lines, entityFilter, settlements }: Props) {
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
        month:      monthLabel(m),
        'Legal Edge': Math.round(d.le),
        'RockPoint':  Math.round(d.rpl),
        'Expenses':   Math.round(d.le + d.rpl),
      }))
  }, [expLines])

  // ── Donut breakdown — normalize case, group small slices into "Other" ─────
  const donutData = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of expLines) {
      // Normalize: title-case the group name to deduplicate "Advertising & Marketing" vs "Advertising & marketing"
      const raw = l.expense_group || 'Other'
      const g   = raw.charAt(0).toUpperCase() + raw.slice(1)
      map.set(g, (map.get(g) || 0) + (l.amount || 0))
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0)
    const sorted = Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value: Math.round(value) }))

    // Group slices under 2% of total into "Other"
    const THRESHOLD = total * 0.02
    const main  = sorted.filter(d => d.value >= THRESHOLD)
    const small = sorted.filter(d => d.value < THRESHOLD)
    if (small.length > 0) {
      const otherTotal = small.reduce((s, d) => s + d.value, 0)
      main.push({ name: `Other (${small.length})`, value: Math.round(otherTotal) })
    }
    return main
  }, [expLines])

  const showBothEntities = entityFilter === 'all'

  // ── Revenue (settlements) ─────────────────────────────────────────────────
  const totalRevenue = useMemo(
    () => settlements.reduce((s, r) => s + (r.attorneys_fees || 0), 0),
    [settlements]
  )
  const netProfit  = totalRevenue - total
  const marginPct  = totalRevenue > 0 ? (netProfit / totalRevenue * 100) : 0

  // Monthly revenue for trend chart overlay
  const monthlyRevMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of settlements) {
      const m = s.revenue_date?.slice(0, 7)
      if (!m) continue
      map.set(m, (map.get(m) || 0) + (s.attorneys_fees || 0))
    }
    return map
  }, [settlements])

  // Merge monthly expense + revenue data
  const monthlyDataWithRevenue = useMemo(() => {
    // Collect all months present in either dataset
    const allMonths = new Set<string>()
    for (const d of monthlyData) allMonths.add(d.month)
    monthlyRevMap.forEach((_, m) => allMonths.add(monthLabel(m)))

    // Rebuild from expense data, add Revenue and Profit columns
    const expByMonth = new Map(monthlyData.map(d => [d.month, d]))
    // Build from raw months
    const rawMonths = new Set<string>()
    for (const l of expLines) { const m = l.transaction_date?.slice(0,7); if (m) rawMonths.add(m) }
    monthlyRevMap.forEach((_, m) => rawMonths.add(m))

    return Array.from(rawMonths)
      .sort()
      .map(m => {
        const label = monthLabel(m)
        const existing = expByMonth.get(label) || { month: label, 'Legal Edge': 0, 'RockPoint': 0, 'Expenses': 0 }
        const revenue  = Math.round(monthlyRevMap.get(m) || 0)
        const expenses = existing['Expenses'] as number
        return {
          ...existing,
          'Revenue':    revenue,
          'Net Profit': Math.round(revenue - expenses),
        }
      })
  }, [monthlyData, monthlyRevMap, expLines])

  // ── Marketing monthly stacked bar ─────────────────────────────────────────
  const mktLines = useMemo(
    () => expLines.filter(l => l.expense_group?.toLowerCase().includes('advertis') || l.expense_group?.toLowerCase().includes('marketing')),
    [expLines]
  )

  // Collect unique marketing sub-accounts (strip group prefix)
  const mktAccounts = useMemo(() => {
    const set = new Set<string>()
    for (const l of mktLines) {
      const raw = l.account_name || l.expense_group || 'Other'
      const grp = l.expense_group || ''
      const prefix = grp + ':'
      const name = raw.toLowerCase().startsWith(prefix.toLowerCase()) ? raw.slice(prefix.length).trim() : raw
      set.add(name)
    }
    return Array.from(set)
  }, [mktLines])

  const mktMonthlyData = useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const l of mktLines) {
      const m = l.transaction_date?.slice(0, 7)
      if (!m) continue
      const raw = l.account_name || l.expense_group || 'Other'
      const grp = l.expense_group || ''
      const prefix = grp + ':'
      const acct = raw.toLowerCase().startsWith(prefix.toLowerCase()) ? raw.slice(prefix.length).trim() : raw
      if (!map.has(m)) map.set(m, {})
      const e = map.get(m)!
      e[acct] = (e[acct] || 0) + (l.amount || 0)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, data]) => {
        const row: Record<string, string | number> = { month: monthLabel(m) }
        for (const acct of mktAccounts) row[acct] = Math.round(data[acct] || 0)
        return row
      })
  }, [mktLines, mktAccounts])

  // Colors for marketing sub-accounts
  const MKT_PALETTE = ['#FFD600','#1F2937','#3B82F6','#F59E0B','#10B981','#8B5CF6','#EF4444','#F97316','#6B7280','#34D399']

  // ── Top vendors ───────────────────────────────────────────────────────────
  const topVendors = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of expLines) {
      const txns = l.qb_transactions
      const vendor = (Array.isArray(txns) ? txns[0]?.vendor_name : txns?.vendor_name) || 'Unknown'
      map.set(vendor, (map.get(vendor) || 0) + (l.amount || 0))
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, value]) => ({ name: name.length > 22 ? name.slice(0, 22) + '\u2026' : name, fullName: name, value: Math.round(value) }))
  }, [expLines])

  return (
    <div className="space-y-5 mb-8">

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {totalRevenue > 0 ? (
          <>
            <KpiCard label="Revenue" value={fmtFull(totalRevenue)} sub="attorneys fees settled" color="#16A34A" />
            <KpiCard label="Total Expenses" value={fmtFull(total)} sub="selected period" />
            <KpiCard
              label="Net Profit"
              value={fmtFull(netProfit)}
              sub="revenue minus expenses"
              color={netProfit >= 0 ? '#16A34A' : '#EF4444'}
            />
            <KpiCard
              label="Margin"
              value={`${marginPct.toFixed(1)}%`}
              sub="net profit / revenue"
              color={marginPct >= 20 ? '#16A34A' : marginPct >= 0 ? '#B45309' : '#EF4444'}
            />
          </>
        ) : (
          <>
            <KpiCard label="Total Expenses" value={fmtFull(total)} sub="selected period" />
            <KpiCard
              label="vs Last Month"
              value={`${momPct >= 0 ? '+' : ''}${momPct.toFixed(1)}%`}
              sub={`${fmtFull(currMonthTotal)} this month`}
              color={momPct > 15 ? '#EF4444' : momPct < -5 ? '#10B981' : '#111827'}
            />
            <KpiCard label="Top Category" value={topGroup || '\u2014'} sub={topGroupAmt > 0 ? fmtFull(topGroupAmt) : undefined} />
            <KpiCard label="Marketing Share" value={`${mktPct.toFixed(1)}%`} sub="of total spend" color="#B45309" />
          </>
        )}
      </div>

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Monthly trend — 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-5">Monthly Expenses</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyDataWithRevenue} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
                dataKey={showBothEntities ? 'Expenses' : (entityFilter.toLowerCase().includes('legal edge') ? 'Legal Edge' : 'RockPoint')}
                stroke="#6B7280"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5 }}
                name="Expenses"
              />
              {totalRevenue > 0 && (
                <Line type="monotone" dataKey="Revenue" stroke="#16A34A" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              )}
              {totalRevenue > 0 && (
                <Line type="monotone" dataKey="Net Profit" stroke="#FFD600" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} strokeDasharray="4 2" />
              )}
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
                  <Tooltip content={DonutTooltip} />
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

      {/* ── Phase 2: Marketing breakdown + Top vendors ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Marketing stacked bar — 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Marketing Spend Breakdown</h3>
          <p className="text-xs text-gray-400 mb-5">Monthly by channel / account</p>
          {mktMonthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={mktMonthlyData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={BarTooltip} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {mktAccounts.map((acct, i) => (
                  <Bar key={acct} dataKey={acct} stackId="mkt" fill={MKT_PALETTE[i % MKT_PALETTE.length]} radius={i === mktAccounts.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">No marketing data for this period</div>
          )}
        </div>

        {/* Top vendors — 1/3 width */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Top Vendors</h3>
          <p className="text-xs text-gray-400 mb-5">By total spend</p>
          {topVendors.length > 0 ? (
            <div className="space-y-2.5">
              {topVendors.map((v, i) => {
                const pct = total > 0 ? (v.value / total * 100) : 0
                return (
                  <div key={v.fullName}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-700 truncate" title={v.fullName}>{v.name}</span>
                      <span className="text-gray-500 font-medium ml-2 flex-shrink-0">{fmtShort(v.value)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(pct * (100 / (topVendors[0]?.value > 0 ? topVendors[0].value / total * 100 : 1)), 100)}%`,
                          backgroundColor: i === 0 ? '#FFD600' : '#E5E7EB',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">No vendor data</div>
          )}
        </div>

      </div>
    </div>
  )
}
