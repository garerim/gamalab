import { Container, Database, History as HistoryIcon, Table as TableIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { ConnectionList } from './ConnectionList'
import { DockerManager } from './DockerManager'
import { HistoryList } from './HistoryList'
import { TablesList } from './TablesList'

const TABS = [
  { id: 'connections', label: 'Connections', icon: Database },
  { id: 'tables', label: 'Tables', icon: TableIcon },
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'history', label: 'History', icon: HistoryIcon },
]

export function Sidebar() {
  const { sidebarTab, setSidebarTab } = useAppStore()

  return (
    <div className="flex h-full w-full">
      <div className="flex w-12 flex-col items-center gap-1 border-r border-border bg-card py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = sidebarTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setSidebarTab(tab.id)}
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
            {TABS.find((t) => t.id === sidebarTab)?.label}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {sidebarTab === 'connections' && <ConnectionList />}
          {sidebarTab === 'tables' && <TablesList />}
          {sidebarTab === 'docker' && <DockerManager />}
          {sidebarTab === 'history' && <HistoryList />}
        </div>
      </div>
    </div>
  )
}
