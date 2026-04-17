import { Database, Plug, Unplug, Plus, CheckCircle2, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { useDatabase } from '@/hooks/useDatabase'
import { useAppStore } from '@/store/appStore'

export function ConnectionList() {
  const { connections, activeConnectionId, activeConnection, setActiveConnectionId, connect, disconnect } = useDatabase()
  const { setCreateDialogOpen, setNewLogicalDbDialogOpen } = useAppStore()

  if (connections.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title="No connections yet"
        description="Create a PostgreSQL container to get started experimenting with GamaLab."
        action={
          <Button size="sm" variant="lab" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            New Database
          </Button>
        }
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
          onClick={() => setCreateDialogOpen(true)}
          title="New Docker container"
        >
          <Server className="h-3 w-3" />
          New Server
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 flex-1 justify-start px-2 text-[11px]"
          onClick={() => setNewLogicalDbDialogOpen(true)}
          disabled={!activeConnection}
          title={activeConnection ? 'Create DB in current server' : 'Connect first'}
        >
          <Plus className="h-3 w-3" />
          New DB
        </Button>
      </div>
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-1 p-2">
        {connections.map((conn) => {
          const isActive = conn.id === activeConnectionId
          return (
            <div
              key={conn.id}
              className={cn(
                'group flex cursor-pointer flex-col gap-1 rounded-md border p-2 text-xs transition-colors',
                isActive
                  ? 'border-lab-blue bg-lab-blue/10'
                  : 'border-border bg-background hover:bg-accent/50'
              )}
              onClick={() => setActiveConnectionId(conn.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Database className={cn('h-4 w-4 shrink-0', isActive ? 'text-lab-blue' : 'text-muted-foreground')} />
                  <span className="truncate font-medium">{conn.name || conn.database}</span>
                </div>
                {isActive && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-lab-green" />}
              </div>
              <div className="pl-6 text-muted-foreground">
                {conn.user}@{conn.host}:{conn.port}
              </div>
              <div className="flex gap-1 pl-6 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation()
                    connect(conn)
                  }}
                  title="Reconnect"
                >
                  <Plug className="h-3 w-3" />
                  Connect
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    disconnect(conn.id)
                  }}
                  title="Disconnect"
                >
                  <Unplug className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
    </div>
  )
}
