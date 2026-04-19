import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

/**
 * Fetches tables + columns for the active connection and refreshes
 * whenever tablesRefreshToken changes (i.e. after CREATE/DROP/ALTER).
 */
export function useSchemaInfo() {
  const { activeConnection } = useDatabase()
  const { tablesRefreshToken } = useAppStore()
  const [schemaInfo, setSchemaInfo] = useState([])

  useEffect(() => {
    let cancelled = false
    if (!activeConnection) {
      setSchemaInfo([])
      return
    }
    ;(async () => {
      try {
        const info = await window.gamalab.db.listSchemaInfo(activeConnection.id)
        if (!cancelled) setSchemaInfo(info)
      } catch {
        if (!cancelled) setSchemaInfo([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeConnection, tablesRefreshToken])

  return schemaInfo
}
