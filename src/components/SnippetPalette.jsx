// src/components/SnippetPalette.jsx
// Floating modal invoked by Ctrl+Shift+P. Live-search + keyboard-driven insertion.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Bookmark } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

function previewSql(sql) {
  if (!sql) return ''
  const firstNonBlank = sql.split('\n').find((l) => l.trim().length > 0) || sql
  const collapsed = firstNonBlank.replace(/\s+/g, ' ')
  return collapsed.length > 100 ? collapsed.slice(0, 99) + '…' : collapsed
}

function insertSnippetIntoActiveTab(snippet) {
  const state = useAppStore.getState()
  const activeTab = state.queryTabs.find((t) => t.id === state.activeTabId)
  const tabIsAvailable =
    activeTab &&
    !activeTab.running &&
    (activeTab.content || '').trim().length === 0

  if (tabIsAvailable) {
    state.updateTabContent(activeTab.id, snippet.sql)
    state.renameTab(activeTab.id, snippet.name)
  } else {
    const newId = state.createTab({ content: snippet.sql })
    state.renameTab(newId, snippet.name)
  }

  if (state.viewMode !== 'sql') state.setViewMode('sql')
  state.setSnippetPaletteOpen(false)
}

export function SnippetPalette() {
  const open = useAppStore((s) => s.snippetPaletteOpen)
  const setOpen = useAppStore((s) => s.setSnippetPaletteOpen)
  const snippets = useAppStore((s) => s.snippets)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...snippets].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted
    return sorted.filter((s) => {
      const haystack = `${s.name}\n${s.description || ''}\n${(s.sql || '').slice(0, 100)}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [snippets, query])

  // Reset / focus when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // focus on next tick so the dialog has mounted
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Clamp activeIndex when filtered list shrinks
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, activeIndex])

  // Auto-scroll the active item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIndex}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  if (!open) return null

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length > 0) {
        setActiveIndex((i) => (i + 1) % filtered.length)
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length > 0) {
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[activeIndex]
      if (target) insertSnippetIntoActiveTab(target)
      return
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search snippets…"
            aria-label="Search snippets"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {snippets.length === 0 && (
            <div className="flex flex-col items-center gap-1 px-3 py-6 text-center text-xs text-muted-foreground">
              <Bookmark className="h-5 w-5 opacity-60" />
              <span>No snippets yet.</span>
              <span>Save your first one from the editor toolbar.</span>
            </div>
          )}
          {snippets.length > 0 && filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs italic text-muted-foreground">
              No snippets match &ldquo;{query}&rdquo;
            </div>
          )}
          {filtered.map((snippet, idx) => {
            const isActive = idx === activeIndex
            return (
              <div
                key={snippet.id}
                data-idx={idx}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => insertSnippetIntoActiveTab(snippet)}
                className={`flex cursor-pointer flex-col gap-0.5 px-3 py-2 ${
                  isActive ? 'bg-accent/40' : ''
                }`}
              >
                <span className="truncate text-sm font-medium text-foreground">
                  {snippet.name}
                </span>
                {snippet.description && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {snippet.description}
                  </span>
                )}
                <code className="truncate font-mono text-[11px] text-foreground/70">
                  {previewSql(snippet.sql)}
                </code>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-muted/20 px-3 py-1 text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>Enter insert</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  )
}
