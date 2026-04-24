import { useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { isDangerousSql } from '@/lib/utils'

export function useDatabase() {
  const connections = useAppStore((s) => s.connections)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const addConnection = useAppStore((s) => s.addConnection)
  const removeConnection = useAppStore((s) => s.removeConnection)
  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)
  const setTabResult = useAppStore((s) => s.setTabResult)
  const setTabRunning = useAppStore((s) => s.setTabRunning)
  const addHistoryItem = useAppStore((s) => s.addHistoryItem)
  const showToast = useAppStore((s) => s.showToast)

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
    async (sql, { tabId: explicitTabId } = {}) => {
      if (!activeConnection) {
        showToast('Connect to a database first', 'warning')
        return null
      }
      const tabId = explicitTabId ?? useAppStore.getState().activeTabId
      if (!tabId) {
        showToast('No active tab', 'error')
        return null
      }
      const trimmed = (sql || '').trim()
      if (!trimmed) {
        showToast('Query is empty', 'warning')
        return null
      }

      // Guard: don't double-run on the same tab
      const tabNow = useAppStore
        .getState()
        .queryTabs.find((t) => t.id === tabId)
      if (tabNow?.running) {
        showToast('Already running', 'info')
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

      setTabRunning(tabId, true)
      setTabResult(tabId, { result: null, error: null, duration: null })
      const start = Date.now()
      try {
        const result = await window.gamalab.db.query(activeConnection.id, trimmed)
        const duration = result.duration ?? Date.now() - start
        setTabResult(tabId, { result, error: null, duration })
        addHistoryItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sql: trimmed,
          connection: activeConnection.id,
          connectionName: activeConnection.name || activeConnection.database,
          duration,
          rowCount: result.rowCount ?? (result.rows?.length || 0),
          timestamp: Date.now(),
          success: true,
        })
        return result
      } catch (err) {
        const duration = Date.now() - start
        setTabResult(tabId, { result: null, error: err.message, duration })
        addHistoryItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sql: trimmed,
          connection: activeConnection.id,
          connectionName: activeConnection.name || activeConnection.database,
          duration,
          timestamp: Date.now(),
          success: false,
          error: err.message,
        })
        return null
      } finally {
        setTabRunning(tabId, false)
      }
    },
    [activeConnection, addHistoryItem, setTabResult, setTabRunning, showToast]
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
