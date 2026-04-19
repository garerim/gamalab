import { Database, Plug, Unplug, Plus, CheckCircle2, Server, Cable, Container } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { useDatabase } from '@/hooks/useDatabase'
import { useAppStore } from '@/store/appStore'

export function ConnectionList() {
  const { connections, activeConnectionId, activeConnection, setActiveConnectionId, connect, disconnect } = useDatabase()
  const { setCreateDialogOpen, setNewLogicalDbDialogOpen, setConnectRemoteDialogOpen, connectionHealth } = useAppStore()

  if (connections.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title="No connections yet"
        description="Create a Docker container or connect to an existing Postgres server."
        action={
          <div className="flex flex-col gap-2">
            <Button size="sm" variant="lab" onClick={() => setCreateDialogOpen(true)}>
              <Server className="h-4 w-4" />
              New Docker Database
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConnectRemoteDialogOpen(true)}>
              <Cable className="h-4 w-4" />
              Connect to existing
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1 border-b border-border p-2">
        <div className="flex items-center gap-1">
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
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-full justify-start px-2 text-[11px]"
          onClick={() => setConnectRemoteDialogOpen(true)}
          title="Connect to an existing Postgres (cloud, on-prem)"
        >
          <Cable className="h-3 w-3" />
          Connect to existing
        </Button>
      </div>
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-1 p-2">
        {connections.map((conn) => {
          const isActive = conn.id === activeConnectionId
          const isRemote = conn.kind === 'remote'
          const Icon = isRemote ? Cable : Container
          const health = connectionHealth[conn.id]
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
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-lab-blue' : 'text-muted-foreground'
                    )}
                  />
                  <span className="truncate font-medium">{conn.name || conn.database}</span>
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[9px] font-normal uppercase tracking-wider"
                  >
                    {isRemote ? 'remote' : 'docker'}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <HealthDot
                    isActive={isActive}
                    status={health?.status}
                    latencyMs={health?.latencyMs}
                  />
                  {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-lab-green" />}
                </div>
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

function HealthDot({ isActive, status, latencyMs }) {
  const forceHealthRefresh = useAppStore((s) => s.forceHealthRefresh)
  // Only show a status dot for the active connection — health checks only
  // run against the active one, so other entries' status would be stale.
  if (!isActive || !status) return null
  const colorClass = {
    healthy: 'bg-lab-green',
    degraded: 'bg-lab-orange',
    broken: 'bg-destructive animate-pulse',
    unknown: 'bg-muted-foreground/40',
  }[status] || 'bg-muted-foreground/40'
  const label = {
    healthy: latencyMs != null ? `Healthy · ${latencyMs}ms` : 'Healthy',
    degraded: latencyMs != null ? `Degraded · ${latencyMs}ms` : 'Degraded',
    broken: 'Connection lost — click to re-check',
    unknown: 'Pinging…',
  }[status] || 'Unknown'
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (forceHealthRefresh) forceHealthRefresh()
      }}
      className="rounded p-0.5 hover:bg-accent"
      title={label}
    >
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', colorClass)} />
    </button>
  )
}
