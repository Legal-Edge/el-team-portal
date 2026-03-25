'use client'

import React, { useState, useRef, useEffect, useId } from 'react'
import {
  FILTER_FIELDS,
  OPERATOR_LABELS,
  type FilterGroup,
  type FilterCondition,
  type FilterOperator,
} from '@/lib/cases/column-defs'

const OPERATORS: FilterOperator[] = [
  'is', 'is_not', 'contains', 'not_contains',
  'is_any_of', 'is_none_of', 'is_known', 'is_unknown',
  'greater_than', 'less_than',
]

function makeCondition(overrides?: Partial<FilterCondition>): FilterCondition {
  return {
    id:         Math.random().toString(36).slice(2),
    field:      'case_status',
    fieldLabel: 'Stage',
    operator:   'is',
    value:      '',
    ...overrides,
  }
}

function makeGroup(logic: 'AND' | 'OR' = 'AND'): FilterGroup {
  return {
    id:         Math.random().toString(36).slice(2),
    logic,
    conditions: [makeCondition()],
  }
}

interface Props {
  groups: FilterGroup[]
  onChange: (groups: FilterGroup[]) => void
  onClose: () => void
  onSaveView: () => void
  hasActiveFilters: boolean
}

export function FilterBuilder({ groups, onChange, onClose, onSaveView, hasActiveFilters }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fieldSearch, setFieldSearch] = useState<Record<string, string>>({})
  const [openFieldPicker, setOpenFieldPicker] = useState<string | null>(null)
  const uid = useId()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const localGroups = groups.length > 0 ? groups : [makeGroup()]

  function update(gs: FilterGroup[]) {
    onChange(gs)
  }

  function addGroup() {
    update([...localGroups, makeGroup()])
  }

  function removeGroup(gid: string) {
    update(localGroups.filter(g => g.id !== gid))
  }

  function toggleLogic(gid: string) {
    update(localGroups.map(g =>
      g.id === gid ? { ...g, logic: g.logic === 'AND' ? 'OR' : 'AND' } : g
    ))
  }

  function addCondition(gid: string) {
    update(localGroups.map(g =>
      g.id === gid ? { ...g, conditions: [...g.conditions, makeCondition()] } : g
    ))
  }

  function removeCondition(gid: string, cid: string) {
    update(localGroups.map(g => {
      if (g.id !== gid) return g
      const next = g.conditions.filter(c => c.id !== cid)
      return { ...g, conditions: next.length > 0 ? next : [makeCondition()] }
    }))
  }

  function updateCondition(gid: string, cid: string, patch: Partial<FilterCondition>) {
    update(localGroups.map(g => {
      if (g.id !== gid) return g
      return { ...g, conditions: g.conditions.map(c => c.id === cid ? { ...c, ...patch } : c) }
    }))
  }

  function clearAll() {
    onChange([])
    onClose()
  }

  // Field picker for a condition
  function FieldPicker({ gid, cond }: { gid: string; cond: FilterCondition }) {
    const key = `${gid}-${cond.id}`
    const search = fieldSearch[key] ?? ''
    const isOpen = openFieldPicker === key

    const groups = FILTER_FIELDS.reduce<Record<string, typeof FILTER_FIELDS>>((acc, f) => {
      if (!f.label.toLowerCase().includes(search.toLowerCase())) return acc
      if (!acc[f.group]) acc[f.group] = []
      acc[f.group].push(f)
      return acc
    }, {})

    return (
      <div className="relative">
        <button
          onClick={() => setOpenFieldPicker(isOpen ? null : key)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors min-w-[130px] max-w-[180px] truncate"
        >
          <span className="flex-1 text-left truncate">{cond.fieldLabel}</span>
          <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden"
            style={{ maxHeight: '300px' }}>
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={e => setFieldSearch(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder="Search fields…"
                className="w-full px-2 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lemon-400"
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
              {Object.entries(groups).map(([groupName, fields]) => (
                <div key={groupName}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {groupName}
                  </div>
                  {fields.map(f => (
                    <button
                      key={f.id}
                      onClick={() => {
                        updateCondition(gid, cond.id, { field: f.id, fieldLabel: f.label })
                        setOpenFieldPicker(null)
                        setFieldSearch(prev => ({ ...prev, [key]: '' }))
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-lemon-400/10 ${
                        cond.field === f.id ? 'bg-lemon-400/20 font-medium' : 'text-gray-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(groups).length === 0 && (
                <div className="px-3 py-4 text-xs text-gray-400 text-center">No fields match</div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const valueRequired = (op: FilterOperator) => !['is_known', 'is_unknown'].includes(op)

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full mt-2 bg-white rounded-xl border border-gray-200 shadow-xl z-50"
      style={{ minWidth: '540px', maxWidth: '680px' }}
      id={uid}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="font-semibold text-gray-800 text-sm">Filter Cases</span>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              onClick={clearAll}
              className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
            >
              Clear all
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter groups */}
      <div className="p-4 space-y-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
        {localGroups.map((group, gi) => (
          <div key={group.id} className="rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
            {/* Group header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-white">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Group {gi + 1}
              </span>
              <button
                onClick={() => toggleLogic(group.id)}
                className="px-2 py-0.5 text-xs font-semibold rounded border border-gray-200 hover:border-gray-300 bg-white transition-colors"
              >
                {group.logic}
              </button>
              <span className="flex-1" />
              {localGroups.length > 1 && (
                <button
                  onClick={() => removeGroup(group.id)}
                  className="p-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Conditions */}
            <div className="p-3 space-y-2">
              {group.conditions.map((cond, ci) => (
                <div key={cond.id} className="flex items-start gap-2">
                  {/* Logic connector label */}
                  <div className="w-6 flex-shrink-0 flex items-center justify-center pt-2">
                    {ci === 0
                      ? <span className="text-[9px] text-gray-400 uppercase font-semibold">IF</span>
                      : <span className="text-[9px] font-bold text-gray-500 uppercase">{group.logic}</span>
                    }
                  </div>

                  {/* Field picker */}
                  <FieldPicker gid={group.id} cond={cond} />

                  {/* Operator */}
                  <select
                    value={cond.operator}
                    onChange={e => updateCondition(group.id, cond.id, { operator: e.target.value as FilterOperator, value: '' })}
                    className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-lemon-400 cursor-pointer"
                  >
                    {OPERATORS.map(op => (
                      <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                    ))}
                  </select>

                  {/* Value input */}
                  {valueRequired(cond.operator) && (
                    <input
                      type="text"
                      value={cond.value}
                      onChange={e => updateCondition(group.id, cond.id, { value: e.target.value })}
                      placeholder={
                        ['is_any_of','is_none_of'].includes(cond.operator)
                          ? 'value1, value2…'
                          : 'value'
                      }
                      className="flex-1 px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lemon-400"
                    />
                  )}

                  {/* Remove condition */}
                  <button
                    onClick={() => removeCondition(group.id, cond.id)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              <button
                onClick={() => addCondition(group.id)}
                className="flex items-center gap-1.5 ml-8 text-xs text-gray-400 hover:text-gray-700 transition-colors py-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add condition
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={addGroup}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors py-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add filter group
        </button>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100">
        <button
          onClick={onSaveView}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h8l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
          </svg>
          Save view
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm font-medium bg-lemon-400 hover:bg-lemon-500 text-gray-900 rounded-lg transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
