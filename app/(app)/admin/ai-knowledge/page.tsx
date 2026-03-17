'use client'
import { useEffect, useState } from 'react'

const CATEGORIES = [
  { value: 'extraction_rules', label: 'Extraction Rules' },
  { value: 'repair_codes',     label: 'Repair Codes' },
  { value: 'analysis_rules',   label: 'Analysis Rules' },
  { value: 'document_patterns',label: 'Document Patterns' },
  { value: 'state_overrides',  label: 'State Overrides' },
]

const APPLIES_OPTIONS = [
  { value: 'extraction', label: 'Extraction (Haiku)' },
  { value: 'analysis',   label: 'Analysis (Sonnet)' },
]

const DOC_TYPE_OPTIONS = [
  { value: '',                  label: 'All document types' },
  { value: 'repair_order',      label: 'Repair Orders' },
  { value: 'purchase_agreement',label: 'Purchase Agreements' },
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

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]))

export default function AiKnowledgePage() {
  const [entries,  setEntries]  = useState<KbEntry[]>([])
  const [loading,  setLoading]  = useState(true)
  const [loadErr,  setLoadErr]  = useState<string | null>(null)
  const [adding,   setAdding]   = useState(false)
  const [editing,  setEditing]  = useState<KbEntry | null>(null)
  const [saving,   setSaving]   = useState(false)

  const [form, setForm] = useState({
    category:   'extraction_rules',
    title:      '',
    content:    '',
    applies_to: ['extraction', 'analysis'],
    doc_types:  [] as string[],
    sort_order: 0,
  })

  async function load() {
    setLoading(true); setLoadErr(null)
    try {
      const res = await fetch('/api/admin/ai-knowledge', { credentials: 'include' })
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { setLoadErr(`Non-JSON response (${res.status}): ${text.slice(0,200)}`); setLoading(false); return }
      if (!res.ok) { setLoadErr(`${res.status}: ${(data.error as string) ?? text}`); setLoading(false); return }
      setEntries((data.entries as KbEntry[]) ?? [])
    } catch (e) {
      setLoadErr(`Network error: ${String(e)}`)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function resetForm() {
    setForm({ category: 'extraction_rules', title: '', content: '', applies_to: ['extraction','analysis'], doc_types: [], sort_order: 0 })
    setAdding(false); setEditing(null)
  }

  function startEdit(entry: KbEntry) {
    setEditing(entry)
    setAdding(false)
    setForm({
      category:   entry.category,
      title:      entry.title,
      content:    entry.content,
      applies_to: entry.applies_to,
      doc_types:  entry.doc_types ?? [],
      sort_order: entry.sort_order,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save() {
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    const body = { ...form, doc_types: form.doc_types.length > 0 ? form.doc_types : null }
    const url  = editing ? `/api/admin/ai-knowledge/${editing.id}` : '/api/admin/ai-knowledge'
    const method = editing ? 'PATCH' : 'POST'
    await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await load(); resetForm(); setSaving(false)
  }

  async function toggleActive(entry: KbEntry) {
    await fetch(`/api/admin/ai-knowledge/${entry.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !entry.is_active }),
    })
    await load()
  }

  async function deleteEntry(entry: KbEntry) {
    if (!confirm(`Delete "${entry.title}"?`)) return
    await fetch(`/api/admin/ai-knowledge/${entry.id}`, { method: 'DELETE', credentials: 'include' })
    await load()
  }

  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    entries: entries.filter(e => e.category === cat.value),
  })).filter(g => g.entries.length > 0 || adding)

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">AI Knowledge Base</h1>
          <p className="text-sm text-gray-400 mt-0.5">Rules injected into Haiku extraction + Sonnet analysis prompts</p>
        </div>
        {!adding && !editing && (
          <button onClick={() => { setAdding(true); setEditing(null) }}
            className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 active:scale-95 transition-all">
            + Add Rule
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {(adding || editing) && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">{editing ? 'Edit Rule' : 'New Rule'}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Applies to document type</label>
              <select value={form.doc_types[0] ?? ''} onChange={e => setForm(f => ({ ...f, doc_types: e.target.value ? [e.target.value] : [] }))}
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
              placeholder="Describe the rule clearly — this text is sent directly to Claude as instructions…"
              rows={8}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lemon-400 font-mono resize-y" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-2 block">AI Stage</label>
            <div className="flex gap-4">
              {APPLIES_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.applies_to.includes(opt.value)}
                    onChange={e => setForm(f => ({
                      ...f,
                      applies_to: e.target.checked
                        ? [...f.applies_to, opt.value]
                        : f.applies_to.filter(v => v !== opt.value),
                    }))}
                    className="accent-lemon-400" />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={saving || !form.title.trim() || !form.content.trim()}
              className="text-sm px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 active:scale-95 transition-all">
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Rule'}
            </button>
            <button onClick={resetForm}
              className="text-sm px-4 py-2 text-gray-500 hover:text-gray-800 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Entries by category */}
      {loadErr && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <p className="text-sm font-medium text-red-700">Failed to load rules</p>
          <p className="text-xs text-red-500 mt-1 font-mono">{loadErr}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-lemon-400 rounded-full animate-spin mr-3" />
          Loading knowledge base…
        </div>
      ) : (
        <div className="space-y-6">
          {entries.length === 0 && !adding && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-sm">No rules yet. Run the doc-v5 migration first, or add a rule manually.</p>
            </div>
          )}
          {grouped.map(group => (
            <div key={group.value}>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{group.label}</h3>
              <div className="space-y-3">
                {group.entries.map(entry => (
                  <div key={entry.id}
                    className={`bg-white rounded-xl border px-5 py-4 transition-all ${entry.is_active ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-medium text-gray-800">{entry.title}</p>
                          {entry.applies_to.map(a => (
                            <span key={a} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                              {a === 'extraction' ? 'Haiku' : 'Sonnet'}
                            </span>
                          ))}
                          {entry.doc_types && entry.doc_types.map(d => (
                            <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{d.replace('_', ' ')}</span>
                          ))}
                          {!entry.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Disabled</span>}
                        </div>
                        <p className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-3">{entry.content}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => startEdit(entry)}
                          className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded transition-colors">Edit</button>
                        <button onClick={() => toggleActive(entry)}
                          className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded transition-colors">
                          {entry.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => deleteEntry(entry)}
                          className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded transition-colors">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
