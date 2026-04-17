import { useState } from 'react'
import {
  Container,
  Play,
  Square,
  RotateCw,
  Trash2,
  Plug,
  AlertCircle,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, timeAgo } from '@/lib/utils'
import { useDocker } from '@/hooks/useDocker'
import { useDatabase } from '@/hooks/useDatabase'
import { useAppStore } from '@/store/appStore'

function stateBadge(state) {
  const map = {
    running: 'success',
    exited: 'destructive',
    paused: 'warning',
    created: 'info',
    restarting: 'warning',
  }
  return map[state] || 'outline'
}

export function DockerManager() {
  const {
    dockerStatus,
    containers,
    loadingContainers,
    startContainer,
    stopContainer,
    restartContainer,
    removeContainer,
  } = useDocker()
  const { connect } = useDatabase()
  const { setCreateDialogOpen, showToast } = useAppStore()
  const [busyId, setBusyId] = useState(null)

  const withBusy = (id, fn) => async () => {
    setBusyId(id)
    try {
      await fn()
    } finally {
      setBusyId(null)
    }
  }

  if (!dockerStatus.checked) {
    return <EmptyState icon={Container} title="Checking Docker…" />
  }

  if (!dockerStatus.running) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Docker is not running"
        description={
          dockerStatus.error ||
          'Please start Docker Desktop (or the Docker daemon) and refresh.'
        }
      />
    )
  }

  if (containers.length === 0) {
    return (
      <EmptyState
        icon={Container}
        title="No GamaLab containers"
        description="Spin up your first PostgreSQL database in 10 seconds."
        action={
          <Button size="sm" variant="lab" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            New Database
          </Button>
        }
      />
    )
  }

  const connectToContainer = async (c) => {
    if (c.state !== 'running') {
      showToast('Start the container first', 'warning')
      return
    }
    const user = c.labels?.['com.gamalab.user'] || 'postgres'
    const database = c.labels?.['com.gamalab.database'] || 'postgres'
    await connect({
      name: c.name,
      host: '127.0.0.1',
      port: c.port,
      user,
      password: 'postgres',
      database,
    })
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-2">
        {loadingContainers && (
          <div className="text-center text-xs text-muted-foreground">Refreshing…</div>
        )}
        {containers.map((c) => {
          const isBusy = busyId === c.id
          const isRunning = c.state === 'running'
          return (
            <div
              key={c.id}
              className={cn(
                'flex flex-col gap-2 rounded-md border border-border bg-background p-2.5 text-xs transition-colors hover:bg-accent/30',
                isBusy && 'opacity-60'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Container className="h-4 w-4 shrink-0 text-lab-blue" />
                  <span className="truncate font-medium">{c.name}</span>
                </div>
                <Badge variant={stateBadge(c.state)}>{c.state}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-1 pl-6 text-[10px] text-muted-foreground">
                <span>Port {c.port ?? '—'}</span>
                <span>{c.shortId}</span>
                <span className="col-span-2">{c.status}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {isRunning ? (
                  <>
                    <Button
                      size="sm"
                      variant="labGreen"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => connectToContainer(c)}
                      disabled={isBusy}
                    >
                      <Plug className="h-3 w-3" />
                      Connect
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[10px]"
                      onClick={withBusy(c.id, () => stopContainer(c.id))}
                      disabled={isBusy}
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[10px]"
                      onClick={withBusy(c.id, () => restartContainer(c.id))}
                      disabled={isBusy}
                    >
                      <RotateCw className="h-3 w-3" />
                      Restart
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="labGreen"
                    className="h-7 px-2 text-[10px]"
                    onClick={withBusy(c.id, () => startContainer(c.id))}
                    disabled={isBusy}
                  >
                    <Play className="h-3 w-3" />
                    Start
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[10px] text-destructive hover:text-destructive"
                  onClick={withBusy(c.id, () => removeContainer(c.id, true))}
                  disabled={isBusy}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
