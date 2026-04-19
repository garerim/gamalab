import { Logo } from '@/components/Logo'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

export function StatusBar() {
  const { queryResult, queryHistory } = useAppStore()
  const { activeConnection } = useDatabase()

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-card px-3 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <Logo className="h-3.5 w-3.5" />
          GamaLab
        </span>
        {activeConnection && (
          <span>
            {activeConnection.user}@{activeConnection.host}:{activeConnection.port}/
            {activeConnection.database}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {queryResult?.rowCount != null && <span>{queryResult.rowCount} rows</span>}
        <span>{queryHistory.length} queries in history</span>
      </div>
    </div>
  )
}
