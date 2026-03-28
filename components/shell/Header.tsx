'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter }                    from 'next/navigation'
import { signOut }                      from 'next-auth/react'
import Image                            from 'next/image'
import type { TeamRole }                from '@/lib/session'

const ROLE_LABELS: Record<TeamRole, string> = {
  admin:        'Admin',
  attorney:     'Attorney',
  manager:      'Manager',
  case_manager: 'Case Manager',
  paralegal:    'Paralegal',
  intake:       'Intake',
  support:      'Support',
  staff:        'Staff',
}

const ROLE_COLORS: Record<TeamRole, string> = {
  admin:        'bg-red-50 text-red-600',
  attorney:     'bg-purple-50 text-purple-600',
  manager:      'bg-blue-50 text-blue-600',
  case_manager: 'bg-teal-50 text-teal-700',
  paralegal:    'bg-indigo-50 text-indigo-600',
  intake:       'bg-orange-50 text-orange-700',
  support:      'bg-sky-50 text-sky-700',
  staff:        'bg-gray-100 text-gray-500',
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
  const mobileSearchRef = useRef<HTMLInputElement>(null)
  const menuRef   = useRef<HTMLDivElement>(null)

  const [query,           setQuery]           = useState('')
  const [results,         setResults]         = useState<SearchResult[]>([])
  const [searching,       setSearching]       = useState(false)
  const [open,            setOpen]            = useState(false)
  const [menuOpen,        setMenuOpen]        = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // / → focus search (desktop)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); setOpen(true) }
      if (e.key === 'Escape') {
        searchRef.current?.blur()
        mobileSearchRef.current?.blur()
        setOpen(false)
        setMobileSearchOpen(false)
        setQuery('')
        setResults([])
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Focus mobile search input when overlay opens
  useEffect(() => {
    if (mobileSearchOpen) {
      setTimeout(() => mobileSearchRef.current?.focus(), 50)
    } else {
      setQuery(''); setResults([])
    }
  }, [mobileSearchOpen])

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
    setQuery(''); setResults([]); setOpen(false)
    setMobileSearchOpen(false)
    searchRef.current?.blur()
    mobileSearchRef.current?.blur()
  }

  const searchDropdown = (
    open && query.trim().length > 0 ? (
      <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden z-50 animate-slide-up">
        {searching ? (
          <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
        ) : results.length === 0 ? (
          <div className="px-4 py-3 text-sm text-gray-400">No results for &quot;{query}&quot;</div>
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
    ) : null
  )

  return (
    <>
      <header className="h-14 md:h-16 shrink-0 flex items-center px-4 md:px-6 bg-white border-b border-gray-100 z-20">

        {/* Logo */}
        <div className="flex items-center pl-0 md:pl-8 shrink-0">
          <Image
            src="/logos/easylemon-wordmark.png"
            alt="Easy Lemon"
            width={140}
            height={36}
            className="h-8 md:h-9 w-auto object-contain"
            priority
          />
        </div>

        {/* Desktop search — centered */}
        <div className="hidden md:flex flex-1 justify-center px-6">
          <div className="relative w-full max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
            {searchDropdown}
          </div>
        </div>

        {/* Right — mobile search icon + avatar */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Mobile search button */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-50 active:scale-95 transition-all"
            onClick={() => setMobileSearchOpen(true)}
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {/* Avatar menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(prev => !prev)}
              className="w-8 h-8 rounded-full bg-lemon-400 flex items-center justify-center text-xs font-bold text-gray-900 hover:ring-2 hover:ring-lemon-400 hover:ring-offset-2 transition-all duration-150 active:scale-95"
            >
              {displayName.slice(0, 1).toUpperCase()}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden z-50 animate-slide-up">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
                  <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${ROLE_COLORS[role]}`}>
                    {ROLE_LABELS[role]}
                  </span>
                </div>
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
        </div>
      </header>

      {/* Mobile full-screen search overlay */}
      {mobileSearchOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-white flex flex-col">
          {/* Overlay header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                ref={mobileSearchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search clients, phone, VIN…"
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-lemon-400 focus:border-lemon-400 focus:bg-white transition-all"
              />
            </div>
            <button
              onClick={() => setMobileSearchOpen(false)}
              className="text-sm font-medium text-gray-500 active:text-gray-900 shrink-0 px-2 py-1"
            >
              Cancel
            </button>
          </div>

          {/* Search results */}
          <div className="flex-1 overflow-y-auto">
            {!query.trim() ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">
                Search by name, phone, email, or VIN
              </div>
            ) : searching ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">No results for &quot;{query}&quot;</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {results.map(r => (
                  <li key={r.id}>
                    <button
                      className="w-full text-left px-4 py-4 active:bg-gray-50 transition-colors"
                      onClick={() => goToCase(r.dealId)}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{r.clientName}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{r.vehicle}</p>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{r.status}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  )
}
