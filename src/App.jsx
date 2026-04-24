import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toolbar } from '@/components/Toolbar'
import { Sidebar } from '@/components/Sidebar'
import { QueryEditor } from '@/components/QueryEditor'
import { QueryTabBar } from '@/components/QueryTabBar'
import { ResultsTable } from '@/components/ResultsTable'
import { TableBrowser } from '@/components/TableBrowser'
import { SchemaDiagram } from '@/components/SchemaDiagram'
import { CreateDbDialog } from '@/components/CreateDbDialog'
import { ConnectRemoteDialog } from '@/components/ConnectRemoteDialog'
import { NewLogicalDbDialog } from '@/components/NewLogicalDbDialog'
import { CreateTableDialog } from '@/components/CreateTableDialog'
import { EditTableDialog } from '@/components/EditTableDialog'
import { WelcomeDialog } from '@/components/WelcomeDialog'
import { AboutDialog } from '@/components/AboutDialog'
import { Toast } from '@/components/Toast'
import { StatusBar } from '@/components/StatusBar'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'
import { useHealthCheck } from '@/hooks/useHealthCheck'
import { useTabKeybindings } from '@/hooks/useTabKeybindings'

export default function App() {
  const initialize = useAppStore((s) => s.initialize)
  const viewMode = useAppStore((s) => s.viewMode)
  const activeTable = useAppStore((s) => s.activeTable)
  const dockerStatus = useAppStore((s) => s.dockerStatus)
  const onboardingCompleted = useAppStore((s) => s.onboardingCompleted)
  const setWelcomeDialogOpen = useAppStore((s) => s.setWelcomeDialogOpen)
  const { runQuery, activeConnection } = useDatabase()
  useHealthCheck()
  useTabKeybindings()

  useEffect(() => {
    initialize()
  }, [initialize])

  // First-launch onboarding: show Welcome once we know the Docker state, the
  // user hasn't completed onboarding, and there's no existing connection.
  useEffect(() => {
    if (!dockerStatus.checked) return
    if (onboardingCompleted) return
    if (activeConnection) return
    if (dockerStatus.running) return
    setWelcomeDialogOpen(true)
  }, [dockerStatus.checked, dockerStatus.running, onboardingCompleted, activeConnection, setWelcomeDialogOpen])

  const handleRunQuery = async (sql) => {
    await runQuery(sql)
  }

  const showBrowser = viewMode === 'browse' && activeTable
  const showSchema = viewMode === 'schema'

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <Toolbar onRunQuery={handleRunQuery} />

        <div className="min-h-0 flex-1">
          <PanelGroup direction="horizontal" autoSaveId="gamalab-main">
            <Panel defaultSize={22} minSize={15} maxSize={40}>
              <Sidebar />
            </Panel>
            <PanelResizeHandle className="w-1 bg-border transition-colors hover:bg-ring data-[resize-handle-active]:bg-ring" />
            <Panel defaultSize={78} minSize={40}>
              {showSchema ? (
                <SchemaDiagram />
              ) : showBrowser ? (
                <TableBrowser />
              ) : (
                <PanelGroup direction="vertical" autoSaveId="gamalab-editor">
                  <Panel defaultSize={50} minSize={20}>
                    <div className="flex h-full flex-col">
                      <QueryTabBar />
                      <div className="min-h-0 flex-1">
                        <QueryEditor onRun={handleRunQuery} />
                      </div>
                    </div>
                  </Panel>
                  <PanelResizeHandle className="h-1 bg-border transition-colors hover:bg-ring data-[resize-handle-active]:bg-ring" />
                  <Panel defaultSize={50} minSize={20}>
                    <ResultsTable />
                  </Panel>
                </PanelGroup>
              )}
            </Panel>
          </PanelGroup>
        </div>

        <StatusBar />

        <CreateDbDialog />
        <ConnectRemoteDialog />
        <NewLogicalDbDialog />
        <CreateTableDialog />
        <EditTableDialog />
        <WelcomeDialog />
        <AboutDialog />
        <Toast />
      </div>
    </TooltipProvider>
  )
}
