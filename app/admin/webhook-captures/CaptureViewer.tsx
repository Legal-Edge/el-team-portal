'use client'

import { useState, useEffect, useCallback } from 'react'

interface Capture {
  id:          string
  source:      string
  captured_at: string
  event_type:  string | null
  ip_address:  string | null
  headers:     Record<string, string> | null
  body:        Record<string, unknown> | null
  raw_body:    string | null
  notes:       string | null
}

type ViewTab = 'body' | 'headers' | 'raw'

export default function CaptureViewer({ initialCaptures }: { initialCaptures: Capture[] }) {
  const [captures, setCaptures] = useState<Capture[]>(initialCaptures)
  const [selected, setSelected] = useState<Capture | null>(initialCaptures[0] ?? null)
  const [view, setView]         = useState<ViewTab>('body')
  const [loading, setLoading]   = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/webhook-captures')
      const data = await res.json() as Capture[]
      setCaptures(data)
      if (!selected && data.length) setSelected(data[0])
    } finally {
      setLoading(false)
    }
  }, [selected])

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const fmt = (d: string) =>
    new Date(d).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })

  const eventBadge = (et: string | null) => {
    if (et === 'inbound')  return 'bg-green-100 text-green-700'
    if (et === 'outbound') return 'bg-blue-100 text-blue-700'
    return 'bg-gray-100 text-gray-600'
  }

  const bodyPreview = (c: Capture) => {
    if (c.body && typeof c.body === 'object') {
      const b = c.body as Record<string, unknown>
      return (String(b.body ?? b.text ?? b.message ?? '')).slice(0, 60)
    }
    return (c.raw_body ?? '').slice(0, 60)
  }

  const displayContent = () => {
    if (!selected) return ''
    if (view === 'headers') return JSON.stringify(selected.headers, null, 2)
    if (view === 'raw')     return selected.raw_body ?? '(empty)'
    return JSON.stringify(selected.body, null, 2) ?? selected.raw_body ?? '(empty)'
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">

      {/* ── Left panel ── */}
      <div className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-gray-800">Aloware Captures</h1>
            <p className="text-xs text-gray-400 mt-0.5">auto-refreshes every 5s</p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs text-blue-600 hover:underline disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {captures.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-2xl mb-2">📡</div>
            <p className="text-sm text-gray-500 font-medium">Waiting for payloads</p>
            <p className="text-xs text-gray-400 mt-1">Configure Aloware webhook URL and send a test SMS</p>
            <div className="mt-4 p-3 bg-gray-50 rounded text-xs text-left font-mono text-gray-500 break-all">
              https://team.easylemon.com/api/webhooks/aloware-test
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {captures.map(c => (
              <button
                key={c.id}
                onClick={() => { setSelected(c); setView('body') }}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                  selected?.id === c.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-medium ${eventBadge(c.event_type)}`}>
                    {c.event_type ?? 'unknown'}
                  </span>
                  <span className="text-xs text-gray-400">{fmt(c.captured_at)}</span>
                </div>
                <p className="text-xs text-gray-500 truncate font-mono">
                  {bodyPreview(c) || '(no body preview)'}
                </p>
                {c.notes && (
                  <p className="text-xs text-amber-600 mt-0.5">⚠ {c.notes}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">Select a capture to inspect</p>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-gray-500 truncate">{selected.id}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(selected.captured_at).toLocaleString()}
                  {selected.ip_address ? ` · ${selected.ip_address}` : ''}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                {(['body','headers','raw'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                      view === v
                        ? 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-4">
              <pre className="text-xs font-mono leading-relaxed bg-gray-900 text-green-300 rounded-lg p-5 overflow-auto whitespace-pre-wrap break-all min-h-48">
                {displayContent()}
              </pre>

              {/* Field map — only for body view */}
              {view === 'body' && selected.body && typeof selected.body === 'object' && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Top-level fields ({Object.keys(selected.body).length})
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(selected.body).map(([k, v]) => (
                      <div key={k} className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                        <p className="text-xs font-mono font-semibold text-blue-600">{k}</p>
                        <p className="text-xs text-gray-500 mt-0.5 break-all">
                          <span className="text-gray-300 mr-1">
                            {Array.isArray(v) ? 'array' : typeof v}
                          </span>
                          {v === null ? 'null' : typeof v === 'object'
                            ? JSON.stringify(v).slice(0, 80)
                            : String(v).slice(0, 80)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
