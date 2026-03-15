'use client'
export default function CaptureViewer({ captures, initialCaptures }: { captures?: unknown[]; initialCaptures?: unknown[] }) {
  captures = captures ?? initialCaptures ?? []
  return (
    <div className="space-y-3">
      {captures.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">No webhook captures yet</p>
      ) : (
        captures.map((c: any) => (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-gray-500">{c.source} — {c.event_type}</span>
              <span className="text-xs text-gray-400">{c.received_at ? new Date(c.received_at).toLocaleString() : '—'}</span>
            </div>
            <pre className="text-xs text-gray-700 bg-gray-50 rounded p-3 overflow-x-auto max-h-48">
              {JSON.stringify(c.payload, null, 2)}
            </pre>
          </div>
        ))
      )}
    </div>
  )
}
