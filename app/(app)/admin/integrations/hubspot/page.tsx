'use client'

import { useEffect, useState } from 'react'

interface Mapping {
  id: string
  case_column: string
  hs_object_type: string
  hs_property: string
  data_type: string
  transform: string | null
  fallback_hs_property: string | null
  fallback_value: string | null
  is_required: boolean
  is_active: boolean
  notes: string | null
}

interface Property {
  property_name: string
  label: string
  field_type: string
  is_custom: boolean
}

interface SyncLog {
  id: string
  sync_type: string
  status: string
  records_total: number
  records_synced: number
  records_failed: number
  error_message: string | null
  started_at: string
  completed_at: string | null
}

interface Stats {
  totalDealProps: number
  totalContactProps: number
  mappedFields: number
  unmappedDealProps: number
  unmappedContactProps: number
  lastPropertySync: string | null
  lastCaseSync: string | null
}

interface HubSpotData {
  mappings: Mapping[]
  dealProps: Property[]
  contactProps: Property[]
  syncLogs: SyncLog[]
  stats: Stats
}

export default function HubSpotIntegrationPage() {
  const [data, setData] = useState<HubSpotData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [activeTab, setActiveTab] = useState<'mappings' | 'deal_props' | 'contact_props' | 'logs'>('mappings')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/integrations/hubspot')
    if (res.ok) setData(await res.json())
    setLoading(false)
  }

  async function triggerSync() {
    setSyncing(true)
    await fetch('/api/admin/integrations/hubspot', { method: 'POST' })
    await load()
    setSyncing(false)
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading HubSpot integration data...</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-500">Failed to load integration data</p>
      </div>
    )
  }

  const mappedProps = new Set(data.mappings.map(m => `${m.hs_object_type}:${m.hs_property}`))

  const filteredDealProps = data.dealProps.filter(p =>
    !search || p.property_name.includes(search) || p.label.toLowerCase().includes(search.toLowerCase())
  )
  const filteredContactProps = data.contactProps.filter(p =>
    !search || p.property_name.includes(search) || p.label.toLowerCase().includes(search.toLowerCase())
  )

  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      success: 'bg-green-100 text-green-700',
      error:   'bg-red-100 text-red-700',
      running: 'bg-yellow-100 text-yellow-700',
    }
    return `inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] ?? 'bg-gray-100 text-gray-600'}`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
              <span>/</span>
              <span>Admin</span>
              <span>/</span>
              <span>HubSpot Integration</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">HubSpot Integration</h1>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {syncing ? 'Syncing...' : '↻ Sync Properties'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Mapped Fields',        value: data.stats.mappedFields,          color: 'text-blue-600'  },
            { label: 'Deal Properties',       value: data.stats.totalDealProps,        color: 'text-gray-900'  },
            { label: 'Unmapped Deal Props',   value: data.stats.unmappedDealProps,     color: 'text-yellow-600'},
            { label: 'Unmapped Contact Props',value: data.stats.unmappedContactProps,  color: 'text-yellow-600'},
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Last Sync Status */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex gap-8 text-sm">
          <div>
            <span className="text-gray-500">Last Property Sync: </span>
            <span className="font-medium text-gray-900">
              {data.stats.lastPropertySync
                ? new Date(data.stats.lastPropertySync).toLocaleString()
                : 'Never'}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Last Case Sync: </span>
            <span className="font-medium text-gray-900">
              {data.stats.lastCaseSync
                ? new Date(data.stats.lastCaseSync).toLocaleString()
                : 'Never'}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {[
            { key: 'mappings',      label: `Mapped Fields (${data.stats.mappedFields})`         },
            { key: 'deal_props',    label: `Deal Properties (${data.stats.totalDealProps})`     },
            { key: 'contact_props', label: `Contact Properties (${data.stats.totalContactProps})`},
            { key: 'logs',          label: `Sync Logs (${data.syncLogs.length})`                },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search bar for props tabs */}
        {(activeTab === 'deal_props' || activeTab === 'contact_props') && (
          <input
            type="text"
            placeholder="Search properties..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full mb-4 px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        )}

        {/* Tab: Mapped Fields */}
        {activeTab === 'mappings' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">core.cases column</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">HubSpot property</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Transform</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Fallback</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Req</th>
                </tr>
              </thead>
              <tbody>
                {data.mappings.map(m => (
                  <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-blue-700">{m.case_column}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs rounded-full font-medium ${
                        m.hs_object_type === 'deal' ? 'bg-purple-100 text-purple-700' : 'bg-cyan-100 text-cyan-700'
                      }`}>{m.hs_object_type}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{m.hs_property ?? <span className="text-gray-400 italic">hardcoded</span>}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{m.data_type}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.transform ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{m.fallback_hs_property ?? m.fallback_value ?? '—'}</td>
                    <td className="px-4 py-3">{m.is_required ? '✅' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab: Deal Properties */}
        {activeTab === 'deal_props' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Property Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Label</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDealProps.map(p => {
                  const isMapped = mappedProps.has(`deal:${p.property_name}`)
                  return (
                    <tr key={p.property_name} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.property_name}</td>
                      <td className="px-4 py-3 text-gray-900">{p.label}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{p.field_type}</td>
                      <td className="px-4 py-3">
                        {isMapped
                          ? <span className="inline-flex px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium">mapped</span>
                          : <span className="inline-flex px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">unmapped</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab: Contact Properties */}
        {activeTab === 'contact_props' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Property Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Label</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredContactProps.map(p => {
                  const isMapped = mappedProps.has(`contact:${p.property_name}`)
                  return (
                    <tr key={p.property_name} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.property_name}</td>
                      <td className="px-4 py-3 text-gray-900">{p.label}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{p.field_type}</td>
                      <td className="px-4 py-3">
                        {isMapped
                          ? <span className="inline-flex px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium">mapped</span>
                          : <span className="inline-flex px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">unmapped</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab: Sync Logs */}
        {activeTab === 'logs' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Synced</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Errors</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Started</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Completed</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.syncLogs.map(log => (
                  <tr key={log.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 font-mono text-xs">{log.sync_type}</td>
                    <td className="px-4 py-3"><span className={statusBadge(log.status)}>{log.status}</span></td>
                    <td className="px-4 py-3 text-gray-700">{log.records_synced ?? '—'}</td>
                    <td className="px-4 py-3 text-red-600">{log.records_failed || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(log.started_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{log.completed_at ? new Date(log.completed_at).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-red-500 text-xs max-w-xs truncate">{log.error_message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
