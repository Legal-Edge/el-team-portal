'use client'

import React, { useState, useRef, useEffect } from 'react'
import { ALL_COLUMNS, type ColumnDef } from '@/lib/cases/column-defs'

interface Props {
  activeColumns: string[]          // ordered list of column IDs
  onChange: (cols: string[]) => void
  onClose: () => void
}

export function ColumnManager({ activeColumns, onChange, onClose }: Props) {
  const [search, setSearch]   = useState('')
  const [cols, setCols]       = useState<string[]>(activeColumns)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const filtered = ALL_COLUMNS.filter(c =>
    c.label.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  )

  function toggle(id: string) {
    const next = cols.includes(id)
      ? cols.filter(c => c !== id)
      : [...cols, id]
    setCols(next)
    onChange(next)
  }

  function moveUp(id: string) {
    const idx = cols.indexOf(id)
    if (idx <= 0) return
    const next = [...cols]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setCols(next)
    onChange(next)
  }

  function moveDown(id: string) {
    const idx = cols.indexOf(id)
    if (idx < 0 || idx >= cols.length - 1) return
    const next = [...cols]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setCols(next)
    onChange(next)
  }

  // Ordered active columns for reorder section
  const activeCols: ColumnDef[] = cols
    .map(id => ALL_COLUMNS.find(c => c.id === id))
    .filter(Boolean) as ColumnDef[]

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-xl z-50 flex flex-col"
      style={{ maxHeight: '80vh' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="font-semibold text-gray-800 text-sm">Edit Columns</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Active columns with reordering */}
      {activeCols.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Active ({activeCols.length})</p>
          <div className="space-y-1">
            {activeCols.map((col, i) => (
              <div key={col.id} className="flex items-center gap-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveUp(col.id)}
                    disabled={i === 0}
                    className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveDown(col.id)}
                    disabled={i === activeCols.length - 1}
                    className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <span className="flex-1 text-sm text-gray-700">{col.label}</span>
                <button
                  onClick={() => toggle(col.id)}
                  className="p-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + add columns */}
      <div className="px-4 py-2 border-b border-gray-100">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search columns…"
          className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lemon-400 focus:border-lemon-400"
        />
      </div>

      <div className="overflow-y-auto flex-1">
        {filtered.map(col => {
          const isActive = cols.includes(col.id)
          return (
            <button
              key={col.id}
              onClick={() => toggle(col.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-gray-50 ${isActive ? 'text-gray-900' : 'text-gray-500'}`}
            >
              <span className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 transition-colors ${
                isActive ? 'bg-lemon-400 border-lemon-400' : 'border-gray-300'
              }`}>
                {isActive && (
                  <svg className="w-3 h-3 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              {col.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
