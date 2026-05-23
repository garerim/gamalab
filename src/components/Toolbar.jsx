import { Plus, RefreshCw, Info, Play, Database, Sun, Moon, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Logo } from '@/components/Logo'
import { useAppStore } from '@/store/appStore'
import { useDocker } from '@/hooks/useDocker'
import { useDatabase } from '@/hooks/useDatabase'

export function Toolbar({ onRunQuery }) {
  const { dockerStatus } = useDocker()
  const { activeConnection } = useDatabase()
  const setCreateDialogOpen = useAppStore((s) => s.setCreateDialogOpen)
  const setAboutOpen = useAppStore((s) => s.setAboutOpen)
  const setWelcomeDialogOpen = useAppStore((s) => s.setWelcomeDialogOpen)
  const setSettingsDialogOpen = useAppStore((s) => s.setSettingsDialogOpen)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const activeTab = useAppStore((s) =>
    s.queryTabs.find((t) => t.id === s.activeTabId) ?? null
  )
  const currentQuery = activeTab?.content ?? ''
  const queryRunning = activeTab?.running ?? false

  const { refreshContainers } = useDocker()

  return (
    <div className="flex h-12 items-center justify-between border-b border-border bg-card px-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 pr-2">
          <Logo className="h-6 w-6" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">GamaLab</span>
            <span className="text-[10px] text-muted-foreground">Your Database Laboratory</span>
          </div>
        </div>

        <div className="mx-2 h-6 w-px bg-border" />

        <Button
          size="sm"
          variant="lab"
          onClick={() => setCreateDialogOpen(true)}
          disabled={!dockerStatus.running}
          title={
            dockerStatus.running
              ? 'Create a new Postgres Docker container'
              : 'Docker is not running — click the Docker badge for setup help'
          }
        >
          <Plus className="h-4 w-4" />
          New Database
        </Button>

        <Button size="sm" variant="ghost" onClick={refreshContainers}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>

        <div className="mx-2 h-6 w-px bg-border" />

        <Button
          size="sm"
          variant="labGreen"
          onClick={() => onRunQuery?.(currentQuery)}
          disabled={!activeConnection || queryRunning}
        >
          <Play className="h-4 w-4" />
          {queryRunning ? 'Running…' : 'Run'}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {activeConnection ? (
          <Badge variant="success" className="gap-1.5">
            <Database className="h-3 w-3" />
            {activeConnection.database}@{activeConnection.host}:{activeConnection.port}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            No connection
          </Badge>
        )}

        {dockerStatus.running ? (
          <Badge variant="success">Docker {dockerStatus.version}</Badge>
        ) : dockerStatus.checked ? (
          <button
            onClick={() => setWelcomeDialogOpen(true)}
            title="Docker not available — click for setup help"
          >
            <Badge variant="destructive" className="cursor-pointer hover:opacity-80">
              Docker offline
            </Badge>
          </button>
        ) : (
          <Badge variant="outline">Checking…</Badge>
        )}

        <Button
          size="iconSm"
          variant="ghost"
          onClick={() => setSettingsDialogOpen(true)}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>

        <Button
          size="iconSm"
          variant="ghost"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>

        <Button size="iconSm" variant="ghost" onClick={() => setAboutOpen(true)} title="About">
          <Info className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
