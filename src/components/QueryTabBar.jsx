// src/components/QueryTabBar.jsx
import { useEffect, useRef, useState } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { cn } from '@/lib/utils'

export function QueryTabBar() {
  const queryTabs = useAppStore((s) => s.queryTabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const createTab = useAppStore((s) => s.createTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const setActiveTabId = useAppStore((s) => s.setActiveTabId)
  const renameTab = useAppStore((s) => s.renameTab)

  const [renamingId, setRenamingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const renameInputRef = useRef(null)

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const beginRename = (tab) => {
    setRenamingId(tab.id)
    setDraftName(tab.title)
  }

  const commitRename = () => {
    if (!renamingId) return
    const trimmed = draftName.trim()
    if (trimmed) renameTab(renamingId, trimmed)
    setRenamingId(null)
    setDraftName('')
  }

  const cancelRename = () => {
    setRenamingId(null)
    setDraftName('')
  }

  const handleClose = async (tab) => {
    if (tab.running) return
    const nonEmpty = (tab.content || '').trim().length > 0
    if (nonEmpty && queryTabs.length > 1) {
      const ok = await window.gamalab.dialog.confirm({
        title: `Close "${tab.title}"?`,
        message: 'You have unsaved SQL in this tab. Closing will discard it.',
        detail: 'This cannot be undone.',
      })
      if (!ok) return
    }
    closeTab(tab.id)
  }

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
      {/* Tabs list (horizontally scrollable) */}
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-none"
      >
        {queryTabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isRenaming = renamingId === tab.id
          const isLast = queryTabs.length === 1

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => !isRenaming && setActiveTabId(tab.id)}
              onDoubleClick={() => beginRename(tab)}
              onKeyDown={(e) => {
                if (isRenaming) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActiveTabId(tab.id)
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  handleClose(tab)
                }
              }}
              title={tab.title}
              className={cn(
                'group flex max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border px-2.5 text-[11px] transition-colors',
                isActive
                  ? 'border-t-2 border-t-lab-blue bg-background text-foreground'
                  : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground'
              )}
            >
              {tab.running && (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-lab-blue" />
              )}

              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  aria-label="Rename tab"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 bg-transparent outline-none ring-1 ring-lab-blue/50 rounded-sm px-1 text-[11px]"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate font-medium">{tab.title}</span>
              )}

              <button
                type="button"
                disabled={tab.running || isLast}
                onClick={(e) => {
                  e.stopPropagation()
                  handleClose(tab)
                }}
                title={
                  isLast
                    ? "Can't close last tab"
                    : tab.running
                      ? 'Running…'
                      : 'Close tab'
                }
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors',
                  isActive
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100',
                  'disabled:cursor-not-allowed disabled:opacity-30',
                  !isLast && !tab.running && 'hover:bg-muted'
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Fixed + button (right) */}
      <button
        type="button"
        onClick={() => createTab()}
        title="New query tab (Ctrl+T)"
        className="flex h-full w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}
