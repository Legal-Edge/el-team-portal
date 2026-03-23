'use client'

import { useTransition } from 'react'
import { useRouter }     from 'next/navigation'
import { stopImpersonationAction } from '@/lib/actions/impersonation'

interface Props {
  name:              string
  role:              string
  impersonatorEmail: string
}

const ROLE_LABELS: Record<string, string> = {
  attorney:  'Attorney',
  manager:   'Manager',
  paralegal: 'Paralegal',
  staff:     'Staff',
}

export function ImpersonationBanner({ name, role, impersonatorEmail }: Props) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function exit() {
    startTransition(async () => {
      await stopImpersonationAction()
      router.refresh()
    })
  }

  return (
    <div className="w-full bg-amber-400 px-4 py-2 flex items-center justify-between gap-4 z-50">
      <div className="flex items-center gap-2 text-amber-900 text-sm font-medium">
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span>
          Viewing as <strong>{name}</strong>
          <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500 rounded text-xs font-semibold">
            {ROLE_LABELS[role] ?? role}
          </span>
          <span className="hidden sm:inline ml-1.5 font-normal opacity-70">· logged in as {impersonatorEmail}</span>
        </span>
      </div>
      <button
        onClick={exit}
        disabled={isPending}
        className="shrink-0 px-3 py-1 text-xs font-semibold bg-amber-900 text-amber-100 rounded-lg hover:bg-amber-800 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  )
}
