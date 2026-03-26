'use client'

import { useEffect, useState } from 'react'
import { useSearchParams }      from 'next/navigation'
import Link                     from 'next/link'

interface SyncState {
  status:        string | null
  last_synced_at: string | null
  records_synced: number | null
  error_message:  string | null
}

interface QBEntity {
  id:            string
  entity_name:   string
  entity_slug:   string
  realm_id:      string | null
  connected:     boolean
  connected_at:  string | null
  qb_sync_state: SyncState[] | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Not connected
    </span>
  )
}

export default function QBConnectPage() {
  const searchParams = useSearchParams()
  const [entities, setEntities]   = useState<QBEntity[]>([])
  const [loading, setLoading]     = useState(true)
  const [syncing, setSyncing]     = useState<string | null>(null)
  const [message, setMessage]     = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Show feedback from OAuth callback
  useEffect(() => {
    const connected = searchParams.get('connected')
    const error     = searchParams.get('error')
    if (connected) {
      setMessage({ type: 'success', text: `QuickBooks connected successfully!` })
    } else if (error) {
      const msgs: Record<string, string> = {
        denied:         'Authorization was denied.',
        missing_params: 'Missing OAuth parameters.',
        invalid_state:  'Invalid OAuth state.',
        db_error:       'Database error saving connection.',
        token_exchange: 'Failed to exchange authorization code.',
      }
      setMessage({ type: 'error', text: msgs[error] || `OAuth error: ${error}` })
    }
  }, [searchParams])

  async function loadStatus() {
    setLoading(true)
    try {
      const res  = await fetch('/api/integrations/quickbooks/status')
      const data = await res.json()
      setEntities(data.entities || [])
    } catch {
      setMessage({ type: 'error', text: 'Failed to load connection status.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, [])

  async function handleSync(entityId: string) {
    setSyncing(entityId)
    setMessage(null)
    try {
      const res  = await fetch('/api/integrations/quickbooks/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ entityId }),
      })
      const data = await res.json()
      if (data.success) {
        const r = data.results?.[0]
        setMessage({ type: 'success', text: `Sync complete — ${r?.transactionsSynced ?? 0} transactions, ${r?.lineItemsSynced ?? 0} line items.` })
        loadStatus()
      } else {
        setMessage({ type: 'error', text: data.results?.[0]?.error || 'Sync failed.' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Sync request failed.' })
    } finally {
      setSyncing(null)
    }
  }

  async function handleDisconnect(entityId: string, entityName: string) {
    if (!confirm(`Disconnect ${entityName}? This will remove stored tokens but keep synced data.`)) return
    try {
      const res  = await fetch('/api/integrations/quickbooks/disconnect', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ entityId }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: `${entityName} disconnected.` })
        loadStatus()
      }
    } catch {
      setMessage({ type: 'error', text: 'Disconnect failed.' })
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
          <Link href="/finance" className="hover:text-gray-600">Finance</Link>
          <span>/</span>
          <span className="text-gray-600">QuickBooks Connections</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">QuickBooks Integration</h1>
        <p className="text-sm text-gray-500 mt-1">Connect your QuickBooks accounts to sync income and expense data.</p>
      </div>

      {/* Feedback banner */}
      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Entity cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-40 bg-gray-50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {entities.map(entity => {
            const syncState = entity.qb_sync_state?.[0] || null
            const isSyncing = syncing === entity.id || syncState?.status === 'running'

            return (
              <div key={entity.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      {/* QB logo icon */}
                      <div className="w-8 h-8 rounded-lg bg-[#2CA01C] flex items-center justify-center shrink-0">
                        <span className="text-white text-xs font-bold">QB</span>
                      </div>
                      <h2 className="font-semibold text-gray-900">{entity.entity_name}</h2>
                      <StatusBadge connected={entity.connected} />
                    </div>
                    {entity.connected && entity.realm_id && (
                      <p className="text-xs text-gray-400 ml-11">Realm ID: {entity.realm_id}</p>
                    )}
                  </div>
                </div>

                {/* Sync info */}
                {entity.connected && (
                  <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-gray-400 text-xs mb-0.5">Last synced</p>
                      <p className="text-gray-700 font-medium">{formatDate(syncState?.last_synced_at || null)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs mb-0.5">Records synced</p>
                      <p className="text-gray-700 font-medium">{syncState?.records_synced?.toLocaleString() ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs mb-0.5">Sync status</p>
                      <p className={`font-medium capitalize ${
                        syncState?.status === 'error' ? 'text-red-600' :
                        syncState?.status === 'running' ? 'text-blue-600' :
                        syncState?.status === 'completed' ? 'text-green-600' : 'text-gray-500'
                      }`}>
                        {syncState?.status || 'Never synced'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Error message */}
                {syncState?.error_message && (
                  <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    {syncState.error_message}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-4 flex items-center gap-2">
                  {entity.connected ? (
                    <>
                      <button
                        onClick={() => handleSync(entity.id)}
                        disabled={!!isSyncing}
                        className="px-4 py-2 bg-[#FFD600] hover:bg-[#F5C800] text-gray-900 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSyncing ? 'Syncing…' : 'Sync Now'}
                      </button>
                      <a
                        href={`/api/integrations/quickbooks/auth?entity=${entity.entity_slug}`}
                        className="px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                      >
                        Reconnect
                      </a>
                      <button
                        onClick={() => handleDisconnect(entity.id, entity.entity_name)}
                        className="px-4 py-2 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition-colors ml-auto"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <a
                      href={`/api/integrations/quickbooks/auth?entity=${entity.entity_slug}`}
                      className="px-4 py-2 bg-[#FFD600] hover:bg-[#F5C800] text-gray-900 text-sm font-medium rounded-lg transition-colors"
                    >
                      Connect to QuickBooks
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sync all */}
      {entities.some(e => e.connected) && !loading && (
        <div className="mt-6 pt-6 border-t border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Sync all companies</p>
            <p className="text-xs text-gray-400">Pulls 2 years of transactions from both QB accounts</p>
          </div>
          <button
            onClick={() => entities.filter(e => e.connected).forEach(e => handleSync(e.id))}
            disabled={!!syncing}
            className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync All'}
          </button>
        </div>
      )}
    </div>
  )
}
