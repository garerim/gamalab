import { useMemo, useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Table as TableIcon,
  Eye,
  Database,
  RefreshCw,
  Search,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { useTables } from '@/hooks/useTables'
import { useAppStore } from '@/store/appStore'

export function TablesList() {
  const { tables, loading, refresh, openTable, dropTable, activeConnection } = useTables()
  const { activeTable, setCreateTableDialogOpen, openEditTableDialog } = useAppStore()
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState({})

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const filtered = q
      ? tables.filter(
          (t) =>
            t.name.toLowerCase().includes(q) || t.schema.toLowerCase().includes(q)
        )
      : tables
    return filtered.reduce((acc, t) => {
      if (!acc[t.schema]) acc[t.schema] = []
      acc[t.schema].push(t)
      return acc
    }, {})
  }, [tables, filter])

  const schemas = Object.keys(grouped).sort()

  if (!activeConnection) {
    return (
      <EmptyState
        icon={Database}
        title="Not connected"
        description="Connect to a database to see its tables."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 flex-1 justify-start px-2 text-[11px]"
          onClick={() => setCreateTableDialogOpen(true)}
          title="Create a new table"
        >
          <Plus className="h-3 w-3" />
          New Table
        </Button>
        <Button
          size="iconSm"
          variant="ghost"
          onClick={refresh}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {tables.length === 0 && !loading ? (
        <EmptyState
          icon={TableIcon}
          title="No tables yet"
          description="Design your first table with the visual builder."
          action={
            <Button size="sm" variant="lab" onClick={() => setCreateTableDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New Table
            </Button>
          }
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col p-1">
            {schemas.map((schema) => {
              const isCollapsed = collapsed[schema]
              const items = grouped[schema]
              return (
                <div key={schema} className="flex flex-col">
                  <button
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [schema]: !c[schema] }))
                    }
                    className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent/50"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    <span className="truncate">{schema}</span>
                    <span className="ml-auto text-[10px] font-normal normal-case text-muted-foreground/70">
                      {items.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="flex flex-col">
                      {items.map((t) => {
                        const isActive =
                          activeTable?.schema === schema && activeTable?.name === t.name
                        const isView = t.type === 'VIEW'
                        const Icon = isView ? Eye : TableIcon
                        return (
                          <div
                            key={`${schema}.${t.name}`}
                            className={cn(
                              'group flex items-center gap-1 rounded pl-5 pr-1 text-xs transition-colors',
                              isActive
                                ? 'bg-lab-blue/15 text-foreground'
                                : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
                            )}
                          >
                            <button
                              onClick={() => openTable(schema, t.name)}
                              className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                            >
                              <Icon
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0',
                                  isActive
                                    ? 'text-lab-blue'
                                    : isView
                                      ? 'text-lab-orange/70'
                                      : 'text-muted-foreground'
                                )}
                              />
                              <span className="truncate">{t.name}</span>
                              {isView && (
                                <span className="ml-auto text-[9px] uppercase tracking-wider text-lab-orange/80">
                                  view
                                </span>
                              )}
                            </button>
                            {!isView && (
                              <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openEditTableDialog(schema, t.name)
                                  }}
                                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                  title="Edit table"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    dropTable(schema, t.name)
                                  }}
                                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                                  title="Drop table"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
