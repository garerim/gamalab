import { History as HistoryIcon, Trash2, PlayCircle, XCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, formatDuration, timeAgo, truncate } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

export function HistoryList() {
  const queryHistory = useAppStore((s) => s.queryHistory)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const removeHistoryItem = useAppStore((s) => s.removeHistoryItem)
  const updateTabContent = useAppStore((s) => s.updateTabContent)
  const activeTabId = useAppStore((s) => s.activeTabId)

  if (queryHistory.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No queries yet"
        description="Your last 50 queries will be saved here."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[10px] text-muted-foreground">{queryHistory.length} entries</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
          onClick={clearHistory}
        >
          <Trash2 className="h-3 w-3" />
          Clear all
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {queryHistory.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-xs transition-colors hover:bg-accent/30'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {item.success ? (
                    <CheckCircle2 className="h-3 w-3 text-lab-green" />
                  ) : (
                    <XCircle className="h-3 w-3 text-destructive" />
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {timeAgo(item.timestamp)}
                  </span>
                  {item.success && item.rowCount != null && (
                    <span className="text-[10px] text-muted-foreground">
                      · {item.rowCount} row{item.rowCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {typeof item.duration === 'number' && (
                    <span className="text-[10px] text-muted-foreground">
                      · {formatDuration(item.duration)}
                    </span>
                  )}
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => {
                      if (activeTabId) updateTabContent(activeTabId, item.sql)
                    }}
                    title="Load in editor"
                  >
                    <PlayCircle className="h-3 w-3" />
                  </Button>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    className="h-5 w-5 text-destructive"
                    onClick={() => removeHistoryItem(item.id)}
                    title="Remove"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <code
                className="line-clamp-2 cursor-pointer font-mono text-[11px] leading-snug text-foreground/80"
                onClick={() => {
                  if (activeTabId) updateTabContent(activeTabId, item.sql)
                }}
                title={item.sql}
              >
                {truncate(item.sql.replace(/\s+/g, ' '), 140)}
              </code>
              {!item.success && item.error && (
                <div className="text-[10px] text-destructive">
                  {truncate(item.error, 120)}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
