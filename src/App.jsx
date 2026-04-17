import { useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toolbar } from '@/components/Toolbar'
import { Sidebar } from '@/components/Sidebar'
import { QueryEditor } from '@/components/QueryEditor'
import { ResultsTable } from '@/components/ResultsTable'
import { TableBrowser } from '@/components/TableBrowser'
import { CreateDbDialog } from '@/components/CreateDbDialog'
import { NewLogicalDbDialog } from '@/components/NewLogicalDbDialog'
import { CreateTableDialog } from '@/components/CreateTableDialog'
import { EditTableDialog } from '@/components/EditTableDialog'
import { AboutDialog } from '@/components/AboutDialog'
import { Toast } from '@/components/Toast'
import { StatusBar } from '@/components/StatusBar'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

export default function App() {
  const initialize = useAppStore((s) => s.initialize)
  const viewMode = useAppStore((s) => s.viewMode)
  const activeTable = useAppStore((s) => s.activeTable)
  const { runQuery } = useDatabase()

  useEffect(() => {
    initialize()
  }, [initialize])

  const handleRunQuery = async (sql) => {
    await runQuery(sql)
  }

  const showBrowser = viewMode === 'browse' && activeTable

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
              {showBrowser ? (
                <TableBrowser />
              ) : (
                <PanelGroup direction="vertical" autoSaveId="gamalab-editor">
                  <Panel defaultSize={50} minSize={20}>
                    <QueryEditor onRun={handleRunQuery} />
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
        <NewLogicalDbDialog />
        <CreateTableDialog />
        <EditTableDialog />
        <AboutDialog />
        <Toast />
      </div>
    </TooltipProvider>
  )
}
