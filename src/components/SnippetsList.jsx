// src/components/SnippetsList.jsx
import { useMemo, useState } from 'react'
import {
  Bookmark,
  Plus,
  Pencil,
  Trash2,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, truncate } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useSnippets } from '@/hooks/useSnippets'

function previewSql(sql) {
  if (!sql) return ''
  const firstNonBlank = sql.split('\n').find((l) => l.trim().length > 0) || sql
  return truncate(firstNonBlank.replace(/\s+/g, ' '), 140)
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
  if (state.snippetPaletteOpen) state.setSnippetPaletteOpen(false)
}

export function SnippetsList() {
  const { snippets, loading, deleteSnippet } = useSnippets()
  const openSaveSnippetDialog = useAppStore((s) => s.openSaveSnippetDialog)
  const showToast = useAppStore((s) => s.showToast)

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...snippets].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted
    return sorted.filter((s) => {
      const haystack = `${s.name}\n${s.description || ''}\n${(s.sql || '').slice(0, 100)}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [snippets, query])

  const handleNew = () => {
    const state = useAppStore.getState()
    const activeTab = state.queryTabs.find((t) => t.id === state.activeTabId)
    const sql = (activeTab?.content || '').trim()
    if (!sql) {
      showToast('Write some SQL first, then save as snippet', 'warning')
      return
    }
    openSaveSnippetDialog({ sql })
  }

  if (snippets.length === 0 && !loading) {
    return (
      <EmptyState
        icon={Bookmark}
        title="No snippets yet"
        description="Save SQL queries you reuse often."
        action={
          <Button size="sm" variant="lab" onClick={handleNew}>
            <Plus className="h-3.5 w-3.5" />
            New snippet
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px]"
          onClick={handleNew}
          title="Save the active tab's SQL as a snippet"
        >
          <Plus className="h-3 w-3" />
          New snippet
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {filtered.length} / {snippets.length}
        </span>
      </div>

      <div className="border-b border-border px-2 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search snippets…"
            className="h-7 pl-7 text-[11px]"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-[11px] italic text-muted-foreground">
              No snippets match &ldquo;{query}&rdquo;
            </div>
          )}
          {filtered.map((snippet) => (
            <div
              key={snippet.id}
              role="button"
              tabIndex={0}
              onClick={() => insertSnippetIntoActiveTab(snippet)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  insertSnippetIntoActiveTab(snippet)
                }
              }}
              className={cn(
                'group flex cursor-pointer flex-col gap-1 rounded-md border border-border bg-background p-2 text-xs transition-colors hover:bg-accent/30'
              )}
              title={`${snippet.name}${snippet.description ? ' — ' + snippet.description : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {snippet.name}
                </span>
                <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation()
                      openSaveSnippetDialog({ editing: snippet })
                    }}
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    className="h-5 w-5 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSnippet(snippet.id)
                    }}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {snippet.description && (
                <span className="line-clamp-2 text-[10px] text-muted-foreground">
                  {snippet.description}
                </span>
              )}
              <code className="line-clamp-1 font-mono text-[11px] text-foreground/80">
                {previewSql(snippet.sql)}
              </code>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
