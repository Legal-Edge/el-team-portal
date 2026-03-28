'use client'

import { useState, useMemo }   from 'react'
import Link                    from 'next/link'
import { FinanceCharts }       from './FinanceCharts'
import type { Settlement }     from './page'

type Period = '1m' | '3m' | '12m' | 'all'

const PERIOD_LABELS: Record<Period, string> = {
  '1m':  'This Month',
  '3m':  'Last 3 Mo',
  '12m': 'Last 12 Mo',
  'all': 'All Time',
}

function getPeriodStart(p: Period): string | null {
  if (p === 'all') return null
  const now = new Date()
  if (p === '1m') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const d = new Date(now)
  if (p === '3m')  d.setMonth(d.getMonth() - 3)
  if (p === '12m') d.setMonth(d.getMonth() - 12)
  return d.toISOString().split('T')[0]
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

// ─── Date presets ─────────────────────────────────────────────────────────────

const now = new Date()

const DATE_PRESETS = [
  { label: 'This month',    start: new Date(now.getFullYear(), now.getMonth(), 1) },
  { label: 'Last month',    start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0) },
  { label: 'This quarter',  start: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1) },
  { label: 'YTD',           start: new Date(now.getFullYear(), 0, 1) },
  { label: 'Last 12 mo',    start: new Date(now.getFullYear(), now.getMonth() - 11, 1) },
  { label: 'All time',      start: new Date(2000, 0, 1) },
]

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
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
  const [datePreset, setDatePreset]       = useState('Last 12 mo')
  const [customStart, setCustomStart]     = useState('')
  const [customEnd, setCustomEnd]         = useState('')
  const [grouped, setGrouped]             = useState(false)
  const [syncing, setSyncing]             = useState(false)
  const [syncMsg, setSyncMsg]             = useState<string | null>(null)
  const [period, setPeriod]               = useState<Period>('3m')

  // ── Date bounds ──────────────────────────────────────────────────────────────
  const { filterStart, filterEnd } = useMemo(() => {
    if (datePreset === 'Custom') {
      return { filterStart: customStart, filterEnd: customEnd || toDateStr(now) }
    }
    const preset = DATE_PRESETS.find(p => p.label === datePreset)
    return {
      filterStart: preset ? toDateStr(preset.start) : '',
      filterEnd:   preset?.end ? toDateStr(preset.end) : toDateStr(now),
    }
  }, [datePreset, customStart, customEnd])

  // ── Unique groups ──────────────────────────────────────────────────────────
  const allGroups = useMemo(() => {
    const groups = new Set<string>()
    initialLines.forEach(l => { if (l.expense_group) groups.add(l.expense_group) })
    return Array.from(groups).sort()
  }, [initialLines])

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return initialLines.filter(l => {
      if (entityFilter !== 'all' && l.entity_name !== entityFilter) return false
      if (groupFilter  !== 'all' && l.expense_group !== groupFilter) return false
      if (filterStart && l.transaction_date < filterStart) return false
      if (filterEnd   && l.transaction_date > filterEnd)   return false
      return true
    })
  }, [initialLines, entityFilter, groupFilter, filterStart, filterEnd])

  // ── Chart lines: period + entity filtered (no group/search — charts show full picture) ──
  const chartLines = useMemo(() => {
    const periodStart = getPeriodStart(period)
    return initialLines.filter(l => {
      if (entityFilter !== 'all' && l.entity_name !== entityFilter) return false
      if (periodStart && l.transaction_date && l.transaction_date < periodStart) return false
      return true
    })
  }, [initialLines, entityFilter, period])

  // ── Settlements filtered by period (revenue always from RockPoint) ────────
  const chartSettlements = useMemo(() => {
    const periodStart = getPeriodStart(period)
    return settlements.filter(s => {
      if (periodStart && s.revenue_date < periodStart) return false
      return true
    })
  }, [settlements, period])

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
          {/* Period toggle for charts */}
          {hasData && (
            <div className="flex items-center gap-1 mb-6 bg-gray-50 rounded-xl p-1 w-fit">
              {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    period === p
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          )}

          {/* Charts — driven by period + entity filter */}
          {hasData && (
            <FinanceCharts lines={chartLines} entityFilter={entityFilter} settlements={chartSettlements} />
          )}

          {/* Filters */}
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

            {/* Date preset */}
            <select
              value={datePreset}
              onChange={e => setDatePreset(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]"
            >
              {DATE_PRESETS.map(p => (
                <option key={p.label}>{p.label}</option>
              ))}
              <option value="Custom">Custom range</option>
            </select>

            {datePreset === 'Custom' && (
              <>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]" />
                <span className="text-gray-400 text-sm">to</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]" />
              </>
            )}

            {/* Group filter */}
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD600]"
            >
              <option value="all">All groups</option>
              {allGroups.map(g => <option key={g}>{g}</option>)}
            </select>

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
