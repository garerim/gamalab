import { useEffect } from 'react'
import { Container, Database, History as HistoryIcon, Network, Table as TableIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'
import { ConnectionList } from './ConnectionList'
import { DockerManager } from './DockerManager'
import { HistoryList } from './HistoryList'
import { TablesList } from './TablesList'

function SchemaTabInfo() {
  return (
    <div className="flex h-full flex-col p-3 text-xs text-muted-foreground">
      <p>The schema diagram is displayed in the main panel.</p>
      <p className="mt-2">Drag to arrange, click an FK to highlight, hover a table for the open button.</p>
    </div>
  )
}

const ALL_TABS = [
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'connections', label: 'Connections', icon: Database },
  { id: 'tables', label: 'Tables', icon: TableIcon, requiresConnection: true },
  { id: 'schema', label: 'Schema', icon: Network, requiresConnection: true },
  { id: 'history', label: 'History', icon: HistoryIcon },
]

export function Sidebar() {
  const { sidebarTab, setSidebarTab, setViewMode } = useAppStore()
  const { activeConnection } = useDatabase()

  const tabs = ALL_TABS.filter((t) => !t.requiresConnection || !!activeConnection)

  // If the current tab is hidden (e.g. user disconnects while on Tables), fall back
  useEffect(() => {
    if (!tabs.some((t) => t.id === sidebarTab)) {
      setSidebarTab('connections')
    }
  }, [tabs, sidebarTab, setSidebarTab])

  return (
    <div className="flex h-full w-full">
      <div className="flex w-12 flex-col items-center gap-1 border-r border-border bg-card py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = sidebarTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => {
                setSidebarTab(tab.id)
                if (tab.id === 'schema') setViewMode('schema')
              }}
              title={tab.label}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-md transition-colors',
                isActive
                  ? 'bg-accent text-lab-blue'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          )
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 items-center border-b border-border bg-card px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {ALL_TABS.find((t) => t.id === sidebarTab)?.label}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {sidebarTab === 'connections' && <ConnectionList />}
          {sidebarTab === 'tables' && <TablesList />}
          {sidebarTab === 'schema' && <SchemaTabInfo />}
          {sidebarTab === 'docker' && <DockerManager />}
          {sidebarTab === 'history' && <HistoryList />}
        </div>
      </div>
    </div>
  )
}
