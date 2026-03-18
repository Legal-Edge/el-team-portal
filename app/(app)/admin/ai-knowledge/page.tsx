'use client'
import { useEffect, useState } from 'react'

const CATEGORIES = [
  { value: 'extraction_rules',  label: 'Extraction Rules',   color: 'bg-blue-50 text-blue-600 border-blue-100' },
  { value: 'repair_codes',      label: 'Repair Codes',       color: 'bg-orange-50 text-orange-600 border-orange-100' },
  { value: 'analysis_rules',    label: 'Analysis Rules',     color: 'bg-purple-50 text-purple-600 border-purple-100' },
  { value: 'document_patterns', label: 'Document Patterns',  color: 'bg-green-50 text-green-600 border-green-100' },
  { value: 'state_overrides',   label: 'State Overrides',    color: 'bg-yellow-50 text-yellow-700 border-yellow-100' },
]
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]))

const DOC_TYPE_OPTIONS = [
  { value: '',                   label: 'All types' },
  { value: 'repair_order',       label: 'Repair Order' },
  { value: 'purchase_agreement', label: 'Purchase Agreement' },
  { value: 'vehicle_registration', label: 'Vehicle Registration' },
]

interface KbEntry {
  id:         string
  category:   string
  title:      string
  content:    string
  applies_to: string[]
  doc_types:  string[] | null
  is_active:  boolean
  sort_order: number
  created_at: string
  created_by: string | null
}

const BLANK = {
  category: 'extraction_rules', title: '', content: '',
  applies_to: ['extraction', 'analysis'], doc_types: [] as string[], sort_order: 0,
}

export default function AiKnowledgePage() {
  const [entries,   setEntries]   = useState<KbEntry[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadErr,   setLoadErr]   = useState<string | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)   // row id expanded for view
  const [editing,   setEditing]   = useState<string | null>(null)   // row id in edit mode
  const [addOpen,   setAddOpen]   = useState(false)
  const [form,      setForm]      = useState(BLANK)
  const [saving,    setSaving]    = useState(false)

  async function load() {
    setLoading(true); setLoadErr(null)
    try {
      const res  = await fetch('/api/admin/ai-knowledge', { credentials: 'include' })
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { setLoadErr(`Non-JSON (${res.status}): ${text.slice(0,200)}`); setLoading(false); return }
      if (!res.ok) { setLoadErr(`${res.status}: ${(data.error as string) ?? text}`); setLoading(false); return }
      setEntries((data.entries as KbEntry[]) ?? [])
    } catch (e) { setLoadErr(`Network error: ${String(e)}`) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function startAdd() { setForm(BLANK); setAddOpen(true); setEditing(null) }
  function startEdit(e: KbEntry) {
    setForm({ category: e.category, title: e.title, content: e.content,
              applies_to: e.applies_to, doc_types: e.doc_types ?? [], sort_order: e.sort_order })
    setEditing(e.id); setAddOpen(false); setExpanded(null)
  }
  function cancelForm() { setAddOpen(false); setEditing(null) }

  async function save() {
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    const body = { ...form, doc_types: form.doc_types.length > 0 ? form.doc_types : null }
    const url    = editing ? `/api/admin/ai-knowledge/${editing}` : '/api/admin/ai-knowledge'
    const method = editing ? 'PATCH' : 'POST'
    await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await load(); cancelForm(); setSaving(false)
  }

  async function toggleActive(e: KbEntry, ev: React.MouseEvent) {
    ev.stopPropagation()
    await fetch(`/api/admin/ai-knowledge/${e.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !e.is_active }),
    })
    await load()
  }

  async function deleteEntry(e: KbEntry, ev: React.MouseEvent) {
    ev.stopPropagation()
    if (!confirm(`Delete "${e.title}"?`)) return
    await fetch(`/api/admin/ai-knowledge/${e.id}`, { method: 'DELETE', credentials: 'include' })
    await load()
  }

  // Group + sort by category order
  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    entries: entries.filter(e => e.category === cat.value).sort((a, b) => a.sort_order - b.sort_order),
  })).filter(g => g.entries.length > 0)

  const totalActive = entries.filter(e => e.is_active).length

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">AI Knowledge Base</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Loading…' : `${totalActive} active rule${totalActive !== 1 ? 's' : ''} · injected into Gemini + Sonnet prompts`}
          </p>
        </div>
        <button onClick={startAdd}
          className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 active:scale-95 transition-all">
          + Add Rule
        </button>
      </div>

      {/* Error */}
      {loadErr && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <p className="text-sm font-medium text-red-700">Failed to load</p>
          <p className="text-xs text-red-500 mt-1 font-mono">{loadErr}</p>
        </div>
      )}

      {/* Add form */}
      {addOpen && (
        <RuleForm form={form} setForm={setForm} onSave={save} onCancel={cancelForm} saving={saving} isNew />
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin mr-3" />
          Loading…
        </div>
      )}

      {/* Grouped list */}
      {!loading && grouped.map(group => (
        <div key={group.value} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Group header */}
          <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${group.color}`}>
              {group.label}
            </span>
            <span className="text-xs text-gray-400">{group.entries.length} rule{group.entries.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-2 border-b border-gray-50">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Title</p>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide w-32 text-center">Stage</p>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide w-28 text-center">Doc Type</p>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide w-20 text-right">Actions</p>
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-50">
            {group.entries.map(entry => (
              <div key={entry.id}>
                {/* Row */}
                <div
                  className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-5 py-3 cursor-pointer transition-colors ${
                    entry.is_active ? 'hover:bg-gray-50' : 'opacity-40 hover:bg-gray-50'
                  } ${expanded === entry.id ? 'bg-gray-50' : ''}`}
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                >
                  {/* Title */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.is_active ? 'bg-green-400' : 'bg-gray-300'}`} />
                    <span className="text-sm font-medium text-gray-800 truncate">{entry.title}</span>
                    <span className="text-gray-300 text-xs">{expanded === entry.id ? '▴' : '▾'}</span>
                  </div>

                  {/* Stage badges */}
                  <div className="flex gap-1 w-32 justify-center">
                    {entry.applies_to.includes('extraction') && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">Gemini</span>
                    )}
                    {entry.applies_to.includes('analysis') && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100">Sonnet</span>
                    )}
                  </div>

                  {/* Doc type */}
                  <div className="w-28 text-center">
                    {entry.doc_types && entry.doc_types.length > 0
                      ? <span className="text-xs text-gray-500">{entry.doc_types[0].replace('_', ' ')}</span>
                      : <span className="text-xs text-gray-300">all types</span>
                    }
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 w-20 justify-end" onClick={e => e.stopPropagation()}>
                    <button onClick={() => startEdit(entry)}
                      className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-1 rounded transition-colors">
                      Edit
                    </button>
                    <button onClick={e => toggleActive(entry, e)}
                      className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-1 rounded transition-colors">
                      {entry.is_active ? 'Off' : 'On'}
                    </button>
                    <button onClick={e => deleteEntry(entry, e)}
                      className="text-xs text-red-400 hover:text-red-600 px-1.5 py-1 rounded transition-colors">
                      ✕
                    </button>
                  </div>
                </div>

                {/* Expanded: content view or edit form */}
                {expanded === entry.id && editing !== entry.id && (
                  <div className="px-5 pb-4 pt-1 bg-gray-50 border-t border-gray-100">
                    <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed font-mono text-xs bg-white border border-gray-100 rounded-lg p-4">
                      {entry.content}
                    </p>
                  </div>
                )}

                {/* Edit form inline */}
                {editing === entry.id && (
                  <div className="px-5 pb-5 pt-3 bg-gray-50 border-t border-gray-100">
                    <RuleForm form={form} setForm={setForm} onSave={save} onCancel={cancelForm} saving={saving} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!loading && entries.length === 0 && !addOpen && !loadErr && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No rules yet. Click &quot;Add Rule&quot; to create one.</p>
        </div>
      )}
    </div>
  )
}

// ── Shared form component ─────────────────────────────────────────────────
function RuleForm({
  form, setForm, onSave, onCancel, saving, isNew = false,
}: {
  form:     typeof BLANK & { doc_types: string[] }
  setForm:  (fn: (f: typeof form) => typeof form) => void
  onSave:   () => void
  onCancel: () => void
  saving:   boolean
  isNew?:   boolean
}) {
  return (
    <div className="space-y-4 bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700">{isNew ? 'New Rule' : 'Edit Rule'}</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Doc Type</label>
          <select value={form.doc_types[0] ?? ''}
            onChange={e => setForm(f => ({ ...f, doc_types: e.target.value ? [e.target.value] : [] }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400">
            {DOC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Title</label>
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Brief rule title…"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400" />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Rule Content</label>
        <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          placeholder="Instructions sent directly to Claude…"
          rows={6}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400 font-mono resize-y" />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-2 block">AI Stage</label>
        <div className="flex gap-4">
          {[{v:'extraction',l:'Gemini 2.5 Flash (Extraction)'},{v:'analysis',l:'Sonnet (Analysis)'}].map(opt => (
            <label key={opt.v} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.applies_to.includes(opt.v)}
                onChange={e => setForm(f => ({
                  ...f,
                  applies_to: e.target.checked ? [...f.applies_to, opt.v] : f.applies_to.filter(v => v !== opt.v),
                }))}
                className="accent-lemon-400" />
              <span className="text-sm text-gray-700">{opt.l}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-3 pt-1">
        <button onClick={onSave} disabled={saving || !form.title.trim() || !form.content.trim()}
          className="text-sm px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 active:scale-95 transition-all">
          {saving ? 'Saving…' : isNew ? 'Add Rule' : 'Save Changes'}
        </button>
        <button onClick={onCancel} className="text-sm px-4 py-2 text-gray-500 hover:text-gray-800 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}
