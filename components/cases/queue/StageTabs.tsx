'use client'

import React from 'react'

export interface StageTab {
  id: string
  label: string
  count: number
}

export const STAGE_TABS: Omit<StageTab, 'count'>[] = [
  { id: '',                    label: 'All'          },
  { id: 'intake',              label: 'Intake'       },
  { id: 'nurture',             label: 'Nurture'      },
  { id: 'document_collection', label: 'Doc Collection' },
  { id: 'attorney_review',     label: 'Atty Review'  },
  { id: 'info_needed',         label: 'Info Needed'  },
  { id: 'sign_up',             label: 'Sign Up'      },
  { id: 'retained',            label: 'Retained'     },
  { id: 'settled',             label: 'Settled'      },
  { id: 'dropped',             label: 'Dropped'      },
]

interface Props {
  activeStage: string
  stageCounts: Record<string, number>
  total: number
  onSelect: (stage: string) => void
}

export function StageTabs({ activeStage, stageCounts, total, onSelect }: Props) {
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none border-b border-gray-200 pb-px">
      {STAGE_TABS.map(tab => {
        const count = tab.id === '' ? total : (stageCounts[tab.id] ?? 0)
        const isActive = activeStage === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`
              relative flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium whitespace-nowrap
              transition-colors duration-150 rounded-t
              ${isActive
                ? 'text-gray-900 after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-lemon-400'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }
            `}
          >
            {tab.label}
            <span className={`
              inline-flex items-center justify-center min-w-[1.2rem] h-4.5 px-1 rounded-full text-xs tabular-nums leading-none
              ${isActive ? 'bg-lemon-400 text-gray-900' : 'bg-gray-100 text-gray-500'}
            `}>
              {count.toLocaleString()}
            </span>
          </button>
        )
      })}
    </div>
  )
}
