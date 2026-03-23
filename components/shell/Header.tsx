'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter }                    from 'next/navigation'
import { signOut }                      from 'next-auth/react'
import Image                            from 'next/image'
import type { TeamRole }                from '@/lib/session'

const ROLE_LABELS: Record<TeamRole, string> = {
  admin:     'Admin',
  attorney:  'Attorney',
  manager:   'Manager',
  paralegal: 'Paralegal',
  staff:     'Staff',
}

const ROLE_COLORS: Record<TeamRole, string> = {
  admin:     'bg-red-50 text-red-600',
  attorney:  'bg-purple-50 text-purple-600',
  manager:   'bg-blue-50 text-blue-600',
  paralegal: 'bg-indigo-50 text-indigo-600',
  staff:     'bg-gray-100 text-gray-500',
}

interface SearchResult {
  id:         string
  dealId:     string
  clientName: string
  vehicle:    string
  status:     string
}

interface HeaderProps {
  role:        TeamRole
  displayName: string
}

export function Header({ role, displayName }: HeaderProps) {
  const router    = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)
  const menuRef   = useRef<HTMLDivElement>(null)

  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open,      setOpen]      = useState(false)
  const [menuOpen,  setMenuOpen]  = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // / → focus search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); setOpen(true) }
      if (e.key === 'Escape') { searchRef.current?.blur(); setOpen(false); setQuery(''); setResults([]) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close avatar menu on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  // Debounced search
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
      finally  { setSearching(false) }
    }, 300)
  }, [query])

  function goToCase(dealId: string) {
    router.push(`/cases/${dealId}`)
    setQuery(''); setResults([]); setOpen(false); searchRef.current?.blur()
  }

  return (
    <header className="h-16 shrink-0 grid grid-cols-3 items-center px-6 bg-white border-b border-gray-100 z-20">

      {/* Left — wordmark */}
      <div className="flex items-center pl-8">
        <Image
          src="/logos/easylemon-wordmark.png"
          alt="Easy Lemon"
          width={160}
          height={40}
          className="h-9 w-auto object-contain"
          priority
        />
      </div>

      {/* Center — search (truly centered via grid) */}
      <div className="relative w-full max-w-sm mx-auto">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1116.65 16.65z" />
            </svg>
          </span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => query && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search clients, phone, VIN…"
            className="w-full pl-9 pr-10 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lemon-400 focus:border-lemon-400 focus:bg-white transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-300 font-mono pointer-events-none">/</kbd>
        </div>

        {/* Search dropdown */}
        {open && query.trim().length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-card-md overflow-hidden z-50 animate-slide-up">
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
                          <p className="text-xs text-gray-400">{r.vehicle}</p>
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

      {/* Right — avatar menu */}
      <div className="flex justify-end relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          className="w-8 h-8 rounded-full bg-lemon-400 flex items-center justify-center text-xs font-bold text-gray-900 hover:ring-2 hover:ring-lemon-400 hover:ring-offset-2 transition-all duration-150 active:scale-95"
        >
          {displayName.slice(0, 1).toUpperCase()}
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl border border-gray-200 shadow-card-md overflow-hidden z-50 animate-slide-up">
            {/* User info */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
              <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${ROLE_COLORS[role]}`}>
                {ROLE_LABELS[role]}
              </span>
            </div>
            {/* Actions */}
            <div className="p-1.5">
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all duration-150 active:scale-95"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
