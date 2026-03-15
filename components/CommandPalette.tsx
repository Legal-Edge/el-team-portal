'use client'

/**
 * Command Palette — opens on ⌘K or Ctrl+K.
 * Keyboard navigation: ↑/↓ to move, Enter to execute, Escape to close.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Command {
  id:     string
  label:  string
  icon:   string
  action: () => void
  kbd?:   string
}

interface CommandPaletteProps {
  role: string
}

export function CommandPalette({ role }: CommandPaletteProps) {
  const router             = useRouter()
  const [open, setOpen]    = useState(false)
  const [query, setQuery]  = useState('')
  const [idx, setIdx]      = useState(0)
  const inputRef           = useRef<HTMLInputElement>(null)

  const close = useCallback(() => { setOpen(false); setQuery(''); setIdx(0) }, [])

  // Build command list based on role
  const allCommands: Command[] = [
    { id: 'cases',     label: 'Go to Cases',       icon: '⚖',  action: () => router.push('/cases'),     kbd: 'C' },
    { id: 'dashboard', label: 'Go to Dashboard',   icon: '▦',  action: () => router.push('/dashboard') },
    { id: 'comms',     label: 'Go to Comms Inbox', icon: '💬', action: () => router.push('/comms') },
    ...(role !== 'staff' ? [
      { id: 'note',  label: 'Add Note',             icon: '📝', action: () => {}, kbd: 'N' },
      { id: 'intake', label: 'Intake Triage',       icon: '📋', action: () => router.push('/intake') },
    ] : []),
    ...(role === 'admin' || role === 'manager' ? [
      { id: 'docs',  label: 'Document Queue',       icon: '📂', action: () => router.push('/docs/queue') },
    ] : []),
    ...(role === 'admin' ? [
      { id: 'admin',    label: 'Admin Settings',    icon: '⚙',  action: () => router.push('/admin') },
      { id: 'pipeline', label: 'Pipeline Report',   icon: '📊', action: () => router.push('/pipeline') },
    ] : []),
  ]

  const filtered = query.trim()
    ? allCommands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : allCommands

  // ── Keyboard: ⌘K / Ctrl+K to open; C/N shortcuts when not focused ────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName

      // ⌘K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        return
      }

      if (!open) {
        // Global shortcuts (not in inputs)
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (e.key === 'C') { router.push('/cases'); return }
        if (e.key === 'N') { /* future: open note modal */ return }
        return
      }

      // Inside palette
      if (e.key === 'Escape') { close(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
      if (e.key === 'Enter') {
        e.preventDefault()
        filtered[idx]?.action()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, filtered, idx, close, router])

  // Focus input when opened
  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 10) } }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={close}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-slide-up">

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
          <span className="text-gray-400 text-sm">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setIdx(0) }}
            placeholder="Type a command…"
            className="flex-1 text-sm text-gray-900 placeholder-gray-400 outline-none bg-transparent"
          />
          <kbd className="text-xs text-gray-300 font-mono bg-gray-50 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Commands */}
        <ul className="py-1.5 max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-gray-400">No commands match</li>
          ) : (
            filtered.map((cmd, i) => (
              <li key={cmd.id}>
                <button
                  className={`w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    i === idx
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => { cmd.action(); close() }}
                >
                  <span className="text-base w-5 text-center">{cmd.icon}</span>
                  <span className="flex-1">{cmd.label}</span>
                  {cmd.kbd && (
                    <kbd className="text-xs text-gray-300 font-mono">{cmd.kbd}</kbd>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="px-4 py-2 border-t border-gray-50 flex items-center gap-4">
          <span className="text-xs text-gray-300">↑↓ navigate</span>
          <span className="text-xs text-gray-300">↵ select</span>
          <span className="text-xs text-gray-300">C → cases · N → note</span>
        </div>
      </div>
    </div>
  )
}
