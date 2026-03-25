'use client'

import React from 'react'
import type { CaseView } from '@/lib/cases/column-defs'

interface Props {
  views: CaseView[]
  activeViewId: string | null
  onSelect: (view: CaseView) => void
  onDelete?: (view: CaseView) => void
  isAdmin: boolean
}

export function ViewTabs({ views, activeViewId, onSelect, onDelete, isAdmin }: Props) {
  if (views.length === 0) return null

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
      {views.map(view => {
        const isActive = activeViewId === view.id
        const canDelete = isAdmin || !view.is_team_preset

        return (
          <div key={view.id} className="relative group flex items-center">
            <button
              onClick={() => onSelect(view)}
              className={`
                relative flex items-center gap-1 px-3.5 py-2 text-sm font-medium whitespace-nowrap
                transition-colors duration-150 rounded-t pr-7
                ${isActive
                  ? 'text-gray-900 bg-white border border-b-white border-gray-200 -mb-px z-10'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }
              `}
            >
              {view.is_team_preset && (
                <span className="text-[10px] bg-blue-100 text-blue-600 px-1 rounded font-semibold uppercase tracking-wide">
                  Team
                </span>
              )}
              {view.name}
            </button>

            {/* Delete button */}
            {canDelete && onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(view) }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all"
                title="Delete view"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
