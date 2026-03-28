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
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [showFade, setShowFade] = React.useState(true)

  // Use sum of individual stage counts for "All" tab — stable across tab switches
  const stageCountSum = Object.values(stageCounts).reduce((a, b) => a + b, 0)
  const allCount = stageCountSum > 0 ? stageCountSum : total

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    setShowFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }

  // Scroll active tab into view when stage changes
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const activeBtn = el.querySelector('[data-active="true"]') as HTMLElement | null
    if (activeBtn) {
      activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
    handleScroll()
  }, [activeStage])

  return (
    <div className="relative border-b border-gray-200">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex items-center gap-0.5 overflow-x-auto scrollbar-none pb-px"
      >
        {STAGE_TABS.map(tab => {
          const count    = tab.id === '' ? allCount : (stageCounts[tab.id] ?? 0)
          const isActive = activeStage === tab.id
          return (
            <button
              key={tab.id}
              data-active={isActive}
              onClick={() => onSelect(tab.id)}
              className={`
                relative flex items-center gap-1.5 px-3 md:px-3.5 py-2 text-sm font-medium whitespace-nowrap
                transition-colors duration-150 rounded-t shrink-0
                ${isActive
                  ? 'text-gray-900 after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-lemon-400'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50 active:bg-gray-50'
                }
              `}
            >
              {tab.label}
              <span className={`
                inline-flex items-center justify-center min-w-[1.2rem] px-1 rounded-full text-xs tabular-nums leading-none py-0.5
                ${isActive ? 'bg-lemon-400 text-gray-900' : 'bg-gray-100 text-gray-500'}
              `}>
                {count.toLocaleString()}
              </span>
            </button>
          )
        })}
      </div>
      {/* Right fade — indicates more tabs to scroll */}
      {showFade && (
        <div className="absolute right-0 top-0 bottom-px w-8 bg-gradient-to-l from-white to-transparent pointer-events-none" />
      )}
    </div>
  )
}
