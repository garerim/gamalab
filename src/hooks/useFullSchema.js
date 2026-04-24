import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

/**
 * Fetches full schema (tables + columns + FKs + indexes + row counts) for the
 * active connection. Refreshes on:
 *   - active connection change
 *   - tablesRefreshToken bump (CREATE/DROP/ALTER via existing dialogs)
 *   - schemaRefreshToken bump (manual "Refresh" button)
 *   - exactRowCounts toggle
 */
export function useFullSchema() {
  const { activeConnection } = useDatabase()
  const tablesRefreshToken = useAppStore((s) => s.tablesRefreshToken)
  const schemaRefreshToken = useAppStore((s) => s.schemaRefreshToken)
  const exactRowCounts = useAppStore((s) => s.exactRowCounts)

  const [data, setData] = useState({ tables: [], columns: [], indexes: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!activeConnection) {
      setData({ tables: [], columns: [], indexes: [] })
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const result = await window.gamalab.schema.getFull(activeConnection.id, {
          exactCounts: exactRowCounts,
        })
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load schema')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeConnection, tablesRefreshToken, schemaRefreshToken, exactRowCounts])

  return { ...data, loading, error }
}
