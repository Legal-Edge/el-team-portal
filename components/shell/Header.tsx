'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter }                    from 'next/navigation'
import { signOut }                      from 'next-auth/react'
import type { TeamRole }                from '@/lib/session'

const ROLE_COLORS: Record<TeamRole, string> = {
  admin:    'bg-red-100 text-red-700',
  attorney: 'bg-purple-100 text-purple-700',
  manager:  'bg-blue-100 text-blue-700',
  staff:    'bg-gray-100 text-gray-600',
}

interface SearchResult {
  id:          string
  dealId:      string
  clientName:  string
  vehicle:     string
  status:      string
}

interface HeaderProps {
  role:        TeamRole
  displayName: string
}

export function Header({ role, displayName }: HeaderProps) {
  const router       = useRouter()
  const searchRef    = useRef<HTMLInputElement>(null)
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen]           = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Keyboard shortcut: / → focus search ───────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape') {
        searchRef.current?.blur()
        setOpen(false)
        setQuery('')
        setResults([])
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Debounced search ───────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/cases/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.results ?? [])
        setOpen(true)
      } catch { /* silent */ }
      finally { setSearching(false) }
    }, 300)
  }, [query])

  function goToCase(dealId: string) {
    router.push(`/cases/${dealId}`)
    setQuery('')
    setResults([])
    setOpen(false)
    searchRef.current?.blur()
  }

  return (
    <header className="h-16 shrink-0 flex items-center gap-4 px-6 bg-white border-b border-gray-100 z-20">

      {/* Logo + title */}
      <div className="flex items-center gap-3 w-60 shrink-0 -ml-6 pl-6">
        <div className="w-8 h-8 bg-[#fde047] rounded-lg flex items-center justify-center shrink-0">
          <span className="text-sm font-black text-gray-900">EL</span>
        </div>
        <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">Staff Portal</span>
      </div>

      {/* Global search */}
      <div className="flex-1 max-w-lg relative">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => query && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search clients, phone, VIN…"
            className="w-full pl-9 pr-12 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent focus:bg-white transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-300 font-mono pointer-events-none">
            /
          </kbd>
        </div>

        {/* Search results dropdown */}
        {open && (query.trim().length > 0) && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden z-50 animate-slide-up">
            {searching ? (
              <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400">No results for "{query}"</div>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {results.map(r => (
                  <li key={r.id}>
                    <button
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                      onMouseDown={() => goToCase(r.dealId)}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{r.clientName}</p>
                          <p className="text-xs text-gray-500">{r.vehicle}</p>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{r.status}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 ml-auto">

        {/* Notification bell (placeholder — Phase 5) */}
        <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500" title="Notifications">
          <span className="text-lg leading-none">🔔</span>
        </button>

        {/* Role badge */}
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide ${ROLE_COLORS[role]}`}>
          {role}
        </span>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600">
          {displayName.slice(0, 1).toUpperCase()}
        </div>

        {/* Sign out */}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 py-1 rounded hover:bg-gray-100"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
