'use client'

import { useState, useMemo, useRef, useEffect as useLayoutEffect } from 'react'
import Link                    from 'next/link'
import { FinanceCharts }       from './FinanceCharts'
import type { Settlement }     from './page'

type Period =
  | 'this_month' | 'last_month'
  | 'last_3m'
  | 'this_quarter' | 'last_quarter'
  | 'ytd' | 'last_year'
  | 'all' | 'custom'

const PERIOD_LABELS: Record<Period, string> = {
  this_month:   'This Month',
  last_month:   'Last Month',
  last_3m:      'Last 3 Months',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  ytd:          'This Year So Far',
  last_year:    'Last Year',
  all:          'All Time',
  custom:       'Custom Range',
}

function getPeriodRange(
  p: Period,
  customStart?: string,
  customEnd?: string,
): { start: string | null; end: string | null } {
  const now   = new Date()
  const today = now.toISOString().split('T')[0]
  const y     = now.getFullYear()
  const m     = now.getMonth() // 0-indexed

  const iso = (d: Date) => d.toISOString().split('T')[0]

  switch (p) {
    case 'this_month':
      return { start: iso(new Date(y, m, 1)),   end: today }
    case 'last_month':
      return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) }
    case 'last_3m': {
      const d = new Date(now); d.setMonth(m - 3)
      return { start: iso(d), end: today }
    }
    case 'this_quarter': {
      const q = Math.floor(m / 3)
      return { start: iso(new Date(y, q * 3, 1)), end: today }
    }
    case 'last_quarter': {
      const q = Math.floor(m / 3)
      const lq = q === 0 ? 3 : q - 1
      const ly = q === 0 ? y - 1 : y
      return { start: iso(new Date(ly, lq * 3, 1)), end: iso(new Date(ly, lq * 3 + 3, 0)) }
    }
    case 'ytd':
      return { start: iso(new Date(y, 0, 1)), end: today }
    case 'last_year':
      return { start: iso(new Date(y - 1, 0, 1)), end: iso(new Date(y - 1, 11, 31)) }
    case 'all':
      return { start: null, end: null }
    case 'custom':
      return { start: customStart || null, end: customEnd || today }
  }
}

// Keep backward-compat helper used in useEffect for funnel metrics
function getPeriodStart(p: Period, customStart?: string): string | null {
  return getPeriodRange(p, customStart).start
}

/** Strip the expense group prefix from account name when redundant.
 *  "Utilities:Phone Service" + group "Utilities" → "Phone Service"
 *  "Advertising & Marketing" + group "Advertising & Marketing" → unchanged */
function displayAccount(accountName: string | null, expenseGroup: string | null): string {
  if (!accountName) return '\u2014'
  if (!expenseGroup) return accountName
  const prefix = expenseGroup + ':'
  if (accountName.toLowerCase().startsWith(prefix.toLowerCase())) {
    return accountName.slice(prefix.length).trim()
  }
  return accountName
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Entity {
  id:            string
  entity_name:   string
  entity_slug:   string
  connected:     boolean
  qb_sync_state: { status: string; last_synced_at: string | null; records_synced: number | null }[] | null
}

interface TransactionLine {
  id:                   string
  entity_name:          string
  expense_group:        string | null
  account_name:         string | null
  fully_qualified_name: string | null
  account_type:         string | null
  amount:               number
  transaction_date:     string
  description:          string | null
  qb_transactions:      { vendor_name: string | null; doc_number: string | null; transaction_type: string } | { vendor_name: string | null; doc_number: string | null; transaction_type: string }[] | null
}

interface Props {
  entities:     Entity[]
  initialLines: TransactionLine[]
  settlements:  Settlement[]
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ─── Custom period dropdown ───────────────────────────────────────────────────
function PeriodSelector({
  value, onChange,
}: {
  value:    Period
  onChange: (p: Period) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useLayoutEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative select-none">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-medium transition-all ${
          open
            ? 'bg-white border-gray-300 shadow-sm'
            : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
        } text-gray-800 cursor-pointer`}
      >
        {/* Calendar icon */}
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <rect x="3" y="4" width="18" height="18" rx="3" />
          <path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
        </svg>
        <span className="min-w-[100px]">{PERIOD_LABELS[value]}</span>
        {/* Chevron */}
        <svg
          className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 w-48 bg-white border border-gray-100 rounded-xl shadow-xl py-1 overflow-hidden">
          {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([val, label], i) => {
            const isSelected = val === value
            const isDivider  = i > 0 && (val === 'this_quarter' || val === 'ytd' || val === 'all' || val === 'custom')
            return (
              <div key={val}>
                {isDivider && <div className="my-1 border-t border-gray-100" />}
                <button
                  type="button"
                  onClick={() => { onChange(val); setOpen(false) }}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors text-left ${
                    isSelected
                      ? 'bg-gray-50 text-gray-900 font-semibold'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {label}
                  {isSelected && (
                    <svg className="w-3.5 h-3.5 text-[#FFD600] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function fmt(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount)
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

function exportCSV(rows: TransactionLine[]) {
  const headers = ['Entity', 'Expense Group', 'Account', 'Date', 'Vendor', 'Description', 'Doc #', 'Amount']
  const csvRows = rows.map(r => [
    r.entity_name,
    r.expense_group || '',
    r.account_name || '',
    r.transaction_date,
    (Array.isArray(r.qb_transactions) ? r.qb_transactions[0]?.vendor_name : r.qb_transactions?.vendor_name) || '',
    r.description || '',
    (Array.isArray(r.qb_transactions) ? r.qb_transactions[0]?.doc_number : r.qb_transactions?.doc_number) || '',
    r.amount.toFixed(2),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

  const csv  = [headers.join(','), ...csvRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `finance-export-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FinanceClient({ entities, initialLines, settlements }: Props) {
  const [entityFilter, setEntityFilter]   = useState('all')
  const [groupFilter, setGroupFilter]     = useState('all')
  const [searchQuery, setSearchQuery]     = useState('')
  const [period, setPeriod]               = useState<Period>('this_month')
  const [customStart, setCustomStart]     = useState('')
  const [customEnd, setCustomEnd]         = useState('')
  const [grouped, setGrouped]             = useState(false)
  const [syncing, setSyncing]             = useState(false)
  const [syncMsg, setSyncMsg]             = useState<string | null>(null)

  // ── Date bounds (unified — drives both charts and table) ─────────────────
  const { filterStart, filterEnd } = useMemo(() => {
    const { start, end } = getPeriodRange(period, customStart, customEnd)
    return { filterStart: start || '', filterEnd: end || '' }
  }, [period, customStart, customEnd])

  // ── Unique groups ──────────────────────────────────────────────────────────
  const allGroups = useMemo(() => {
    const groups = new Set<string>()
    initialLines.forEach(l => { if (l.expense_group) groups.add(l.expense_group) })
    return Array.from(groups).sort()
  }, [initialLines])

  // ── Filtered rows (table) ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return initialLines.filter(l => {
      if (entityFilter !== 'all' && l.entity_name !== entityFilter) return false
      if (groupFilter  !== 'all' && l.expense_group !== groupFilter) return false
      if (filterStart && l.transaction_date < filterStart) return false
      if (filterEnd   && l.transaction_date > filterEnd)   return false
      if (q) {
        const vendor = (Array.isArray(l.qb_transactions) ? l.qb_transactions[0]?.vendor_name : l.qb_transactions?.vendor_name) || ''
        const haystack = [l.expense_group, l.account_name, l.description, vendor].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [initialLines, entityFilter, groupFilter, filterStart, filterEnd, searchQuery])

  // ── Chart lines: unified period + entity (no group/search filter) ─────────
  const chartLines = useMemo(() => {
    return initialLines.filter(l => {
      if (entityFilter !== 'all' && l.entity_name !== entityFilter) return false
      if (filterStart && l.transaction_date < filterStart) return false
      if (filterEnd   && l.transaction_date > filterEnd)   return false
      return true
    })
  }, [initialLines, entityFilter, filterStart, filterEnd])

  // ── Settlements filtered by unified period ────────────────────────────────
  const chartSettlements = useMemo(() => {
    return settlements.filter(s => {
      if (filterStart && s.revenue_date < filterStart) return false
      if (filterEnd   && s.revenue_date > filterEnd)   return false
      return true
    })
  }, [settlements, filterStart, filterEnd])

  // ── Summary (Reimbursements are intercompany transfers — excluded from totals) ──
  const totalAmount = useMemo(
    () => filtered.reduce((s, r) => r.expense_group === 'Reimbursement' ? s : s + (r.amount || 0), 0),
    [filtered]
  )
  const reimbursementTotal = useMemo(
    () => filtered.reduce((s, r) => r.expense_group === 'Reimbursement' ? s + (r.amount || 0) : s, 0),
    [filtered]
  )

  // ── Grouped view ──────────────────────────────────────────────────────────
  const groupedData = useMemo(() => {
    if (!grouped) return null
    const map = new Map<string, { rows: TransactionLine[]; total: number }>()
    for (const row of filtered) {
      const key = `${row.entity_name} | ${row.expense_group || 'Uncategorized'}`
      if (!map.has(key)) map.set(key, { rows: [], total: 0 })
      const entry = map.get(key)!
      entry.rows.push(row)
      entry.total += row.amount || 0
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total)
  }, [filtered, grouped])

  // ── Sync handler ──────────────────────────────────────────────────────────
  async function handleSyncAll() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const endDate   = new Date().toISOString().split('T')[0]
      const startObj  = new Date(); startObj.setDate(startObj.getDate() - 90)
      const startDate = startObj.toISOString().split('T')[0]
      const res  = await fetch('/api/integrations/quickbooks/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ startDate, endDate }),
      })
      if (!res.ok) {
        setSyncMsg(`Sync failed (HTTP ${res.status}). Try again in a moment.`)
        return
      }
      const data = await res.json()
      if (data.success) {
        setSyncMsg('Sync complete — data updated.')
      } else {
        setSyncMsg('Sync finished with errors. Check QB Connections for details.')
      }
    } catch {
      setSyncMsg('Sync request failed.')
    } finally {
      setSyncing(false)
    }
  }

  const connectedCount  = entities.filter(e => e.connected).length
  const hasData         = initialLines.length > 0

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Finance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Income &amp; expenses from QuickBooks</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/finance/connect"
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            QB Connections
            {connectedCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">{connectedCount}</span>
            )}
          </Link>
          {connectedCount > 0 && (
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className="px-3 py-2 text-sm bg-[#FFD600] hover:bg-[#F5C800] text-gray-900 font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          )}
          {hasData && (
            <button
              onClick={() => exportCSV(filtered)}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 border border-gray-200 rounded-lg transition-colors"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Sync message */}
      {syncMsg && (
        <div className="mb-4 px-4 py-3 bg-blue-50 text-blue-700 text-sm rounded-lg border border-blue-200">
          {syncMsg}
        </div>
      )}

      {/* No connection state */}
      {connectedCount === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">📊</span>
          </div>
          <h3 className="text-base font-medium text-gray-900 mb-1">No QuickBooks accounts connected</h3>
          <p className="text-sm text-gray-500 mb-4">Connect your QB accounts to start syncing financial data.</p>
          <Link
            href="/finance/connect"
            className="inline-flex px-4 py-2 bg-[#FFD600] hover:bg-[#F5C800] text-gray-900 text-sm font-medium rounded-lg transition-colors"
          >
            Connect QuickBooks
          </Link>
        </div>
      )}

      {/* Filters + data */}
      {connectedCount > 0 && (
        <>
          {/* ── Unified period selector (controls charts + table) ──────── */}
          {hasData && (
            <div className="flex flex-wrap items-center gap-3 mb-6">
              {/* Period dropdown — custom styled */}
              <PeriodSelector value={period} onChange={setPeriod} />

              {/* Custom date inputs — shown only when Custom is selected */}
              {period === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={customStart}
                    onChange={e => setCustomStart(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]"
                  />
                  <span className="text-gray-400 text-sm">→</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]"
                  />
                </div>
              )}

              {/* Active date range badge */}
              {period !== 'custom' && filterStart && (
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-500 font-medium tabular-nums">
                  <span className="text-gray-300">|</span>
                  {filterStart}
                  <span className="text-gray-300">→</span>
                  {filterEnd && filterEnd !== new Date().toISOString().split('T')[0] ? filterEnd : 'today'}
                </span>
              )}
            </div>
          )}

          {/* Charts — driven by unified period + entity filter */}
          {hasData && (
            <FinanceCharts lines={chartLines} entityFilter={entityFilter} settlements={chartSettlements} />
          )}

          {/* ── Table filters ────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Entity filter */}
            <select
              value={entityFilter}
              onChange={e => setEntityFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]"
            >
              <option value="all">All entities</option>
              {entities.map(e => (
                <option key={e.id} value={e.entity_name}>{e.entity_name}</option>
              ))}
            </select>

            {/* Group filter */}
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]"
            >
              <option value="all">All groups</option>
              {allGroups.map(g => <option key={g}>{g}</option>)}
            </select>

            {/* Search */}
            <input
              type="text"
              placeholder="Search vendor, account, description…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600] min-w-[220px]"
            />

            {/* Grouped toggle */}
            <button
              onClick={() => setGrouped(!grouped)}
              className={`text-sm px-3 py-2 rounded-lg border transition-colors ${
                grouped ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Group by Entity/Group
            </button>
          </div>

          {/* Summary bar */}
          {hasData && (
            <div className="mb-4 flex items-center gap-6 px-4 py-3 bg-gray-50 rounded-xl text-sm flex-wrap">
              <div>
                <span className="text-gray-500">Showing</span>{' '}
                <span className="font-semibold text-gray-900">{filtered.length.toLocaleString()}</span>{' '}
                <span className="text-gray-500">line items</span>
              </div>
              <div>
                <span className="text-gray-500">Total Expenses</span>{' '}
                <span className="font-semibold text-gray-900">{fmt(totalAmount)}</span>
              </div>
              {reimbursementTotal > 0 && (
                <div title="Intercompany transfers (RockPoint → Legal Edge) — excluded from total">
                  <span className="text-gray-400">Reimbursements</span>{' '}
                  <span className="font-medium text-gray-400 line-through">{fmt(reimbursementTotal)}</span>
                </div>
              )}
            </div>
          )}

          {/* No data yet */}
          {!hasData && (
            <div className="text-center py-12 text-sm text-gray-500">
              No data yet — click <strong>Sync Now</strong> to pull transactions from QuickBooks.
            </div>
          )}

          {/* Grouped view */}
          {grouped && groupedData && hasData && (
            <div className="space-y-4">
              {groupedData.map(([key, { rows, total }]) => {
                const [entityName, groupName] = key.split(' | ')
                return (
                  <div key={key} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <div>
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{entityName}</span>
                        <span className="mx-2 text-gray-300">›</span>
                        <span className="text-sm font-medium text-gray-900">{groupName}</span>
                      </div>
                      <div className="text-sm font-semibold text-gray-900">{fmt(total)}</div>
                    </div>
                    <Table rows={rows} />
                  </div>
                )
              })}
            </div>
          )}

          {/* Flat table */}
          {!grouped && hasData && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <Table rows={filtered} showEntity />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Table component ──────────────────────────────────────────────────────────

function Table({ rows, showEntity }: { rows: TransactionLine[]; showEntity?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
            {showEntity && <th className="px-4 py-3 font-medium">Entity</th>}
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Expense Group</th>
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 font-medium">Vendor</th>
            <th className="px-4 py-3 font-medium">Description</th>
            <th className="px-4 py-3 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isR = row.expense_group === 'Reimbursement'
            const rowCls = isR
              ? 'border-b border-gray-50 hover:bg-gray-50 transition-colors opacity-50'
              : (i % 2 === 0
                  ? 'border-b border-gray-50 hover:bg-gray-50 transition-colors'
                  : 'border-b border-gray-50 hover:bg-gray-50 transition-colors bg-gray-50/40')
            const amtCls = isR
              ? 'px-4 py-3 text-right font-medium whitespace-nowrap text-gray-400 line-through'
              : 'px-4 py-3 text-right font-medium whitespace-nowrap text-gray-900'
            return (
            <tr key={row.id} className={rowCls}>
              {showEntity && (
                <td className="px-4 py-3 text-gray-700 font-medium whitespace-nowrap">{row.entity_name}</td>
              )}
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(row.transaction_date)}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {isR
                  ? <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Reimbursement</span>
                  : <span className="text-gray-600">{row.expense_group || '\u2014'}</span>
                }
              </td>
              <td className="px-4 py-3 text-gray-600">
                <span title={row.fully_qualified_name || undefined}>{displayAccount(row.account_name, row.expense_group)}</span>
              </td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{(Array.isArray(row.qb_transactions) ? row.qb_transactions[0]?.vendor_name : row.qb_transactions?.vendor_name) || '\u2014'}</td>
              <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{row.description || '\u2014'}</td>
              <td className={amtCls}>{fmt(row.amount)}</td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
