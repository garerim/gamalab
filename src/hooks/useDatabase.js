import { useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { isDangerousSql } from '@/lib/utils'

export function useDatabase() {
  const {
    connections,
    activeConnectionId,
    addConnection,
    removeConnection,
    setActiveConnectionId,
    setQueryResult,
    setQueryError,
    setQueryRunning,
    addHistoryItem,
    showToast,
  } = useAppStore()

  const activeConnection = connections.find((c) => c.id === activeConnectionId) || null

  const connect = useCallback(
    async (config) => {
      try {
        const conn = await window.gamalab.db.connect(config)
        const merged = { ...config, ...conn, connectedAt: Date.now() }
        addConnection(merged)
        setActiveConnectionId(merged.id)
        showToast(`Connected to ${merged.database} as ${merged.user}`, 'success')
        return merged
      } catch (err) {
        showToast(err.message, 'error')
        throw err
      }
    },
    [addConnection, setActiveConnectionId, showToast]
  )

  const disconnect = useCallback(
    async (id) => {
      try {
        await window.gamalab.db.disconnect(id)
        removeConnection(id)
        showToast('Disconnected', 'info')
      } catch (err) {
        showToast(err.message, 'error')
      }
    },
    [removeConnection, showToast]
  )

  const runQuery = useCallback(
    async (sql) => {
      if (!activeConnection) {
        showToast('Connect to a database first', 'warning')
        return null
      }
      const trimmed = (sql || '').trim()
      if (!trimmed) {
        showToast('Query is empty', 'warning')
        return null
      }

      if (isDangerousSql(trimmed)) {
        const ok = await window.gamalab.dialog.confirm({
          title: 'Dangerous operation',
          message: 'This query may destroy data',
          detail: 'Contains DROP, TRUNCATE, or unconditional DELETE. Continue?',
        })
        if (!ok) return null
      }

      setQueryRunning(true)
      setQueryError(null)
      const start = Date.now()
      try {
        const result = await window.gamalab.db.query(activeConnection.id, trimmed)
        setQueryResult(result)
        addHistoryItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sql: trimmed,
          connection: activeConnection.id,
          connectionName: activeConnection.name || activeConnection.database,
          duration: result.duration ?? Date.now() - start,
          rowCount: result.rowCount ?? (result.rows?.length || 0),
          timestamp: Date.now(),
          success: true,
        })
        return result
      } catch (err) {
        setQueryError(err.message)
        addHistoryItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sql: trimmed,
          connection: activeConnection.id,
          connectionName: activeConnection.name || activeConnection.database,
          duration: Date.now() - start,
          timestamp: Date.now(),
          success: false,
          error: err.message,
        })
        return null
      } finally {
        setQueryRunning(false)
      }
    },
    [activeConnection, addHistoryItem, setQueryError, setQueryResult, setQueryRunning, showToast]
  )

  const listSchemas = useCallback(async () => {
    if (!activeConnection) return []
    try {
      return await window.gamalab.db.listSchemas(activeConnection.id)
    } catch (err) {
      showToast(err.message, 'error')
      return []
    }
  }, [activeConnection, showToast])

  const listTables = useCallback(
    async (schema = 'public') => {
      if (!activeConnection) return []
      try {
        return await window.gamalab.db.listTables(activeConnection.id, schema)
      } catch (err) {
        showToast(err.message, 'error')
        return []
      }
    },
    [activeConnection, showToast]
  )

  return {
    connections,
    activeConnection,
    activeConnectionId,
    setActiveConnectionId,
    connect,
    disconnect,
    runQuery,
    listSchemas,
    listTables,
  }
}
