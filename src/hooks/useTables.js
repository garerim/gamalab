import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

export function useTables() {
  const { activeConnection } = useDatabase()
  const {
    setActiveTable,
    showToast,
    tablesRefreshToken,
    bumpTablesRefresh,
    activeTable,
  } = useAppStore()

  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!activeConnection) {
      setTables([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.gamalab.db.listAllTables(activeConnection.id)
      setTables(result)
    } catch (err) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [activeConnection, showToast])

  useEffect(() => {
    refresh()
  }, [refresh, tablesRefreshToken])

  const openTable = useCallback(
    (schema, name) => {
      setActiveTable({ schema, name })
    },
    [setActiveTable]
  )

  const dropTable = useCallback(
    async (schema, name, { cascade = false } = {}) => {
      if (!activeConnection) return false
      const ok = await window.gamalab.dialog.confirm({
        title: `Drop table "${name}"?`,
        message: `Permanently delete ${schema}.${name} and all its data?`,
        detail: cascade
          ? 'CASCADE: dependent objects (views, FKs) will also be dropped.'
          : 'This cannot be undone.',
      })
      if (!ok) return false
      const sql = `DROP TABLE ${quoteIdent(schema)}.${quoteIdent(name)}${cascade ? ' CASCADE' : ''}`
      try {
        await window.gamalab.db.query(activeConnection.id, sql)
        showToast(`Table "${name}" dropped`, 'success')
        if (activeTable?.schema === schema && activeTable?.name === name) {
          setActiveTable(null)
        }
        bumpTablesRefresh()
        return true
      } catch (err) {
        showToast(err.message, 'error')
        return false
      }
    },
    [activeConnection, activeTable, setActiveTable, showToast, bumpTablesRefresh]
  )

  return {
    tables,
    loading,
    error,
    refresh,
    openTable,
    dropTable,
    activeConnection,
  }
}

export function useTableBrowser(schema, name) {
  const { activeConnection } = useDatabase()
  const { showToast } = useAppStore()

  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [rowCount, setRowCount] = useState(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [orderBy, setOrderBy] = useState(null)
  const [filters, setFilters] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [duration, setDuration] = useState(null)

  const loadColumns = useCallback(async () => {
    if (!activeConnection || !schema || !name) return
    try {
      const cols = await window.gamalab.db.listColumns(activeConnection.id, schema, name)
      setColumns(cols)
    } catch (err) {
      showToast(err.message, 'error')
    }
  }, [activeConnection, schema, name, showToast])

  const loadRowCount = useCallback(async () => {
    if (!activeConnection || !schema || !name) return
    try {
      const count = await window.gamalab.db.countRows(
        activeConnection.id,
        schema,
        name,
        filters
      )
      setRowCount(count)
    } catch (err) {
      setRowCount(null)
    }
  }, [activeConnection, schema, name, filters])

  const loadData = useCallback(async () => {
    if (!activeConnection || !schema || !name) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.gamalab.db.browseTable(activeConnection.id, schema, name, {
        limit: pageSize,
        offset: page * pageSize,
        orderBy,
        filters,
      })
      setRows(result.rows)
      setDuration(result.duration)
    } catch (err) {
      setError(err.message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [activeConnection, schema, name, page, pageSize, orderBy, filters])

  useEffect(() => {
    setPage(0)
    setOrderBy(null)
    setFilters([])
    loadColumns()
  }, [schema, name, loadColumns])

  useEffect(() => {
    loadRowCount()
  }, [loadRowCount])

  useEffect(() => {
    loadData()
  }, [loadData])

  const refresh = useCallback(() => {
    loadColumns()
    loadRowCount()
    loadData()
  }, [loadColumns, loadRowCount, loadData])

  const totalPages = rowCount != null ? Math.max(1, Math.ceil(rowCount / pageSize)) : null

  const toggleSort = useCallback((column) => {
    setOrderBy((prev) => {
      if (!prev || prev.column !== column) return { column, direction: 'asc' }
      if (prev.direction === 'asc') return { column, direction: 'desc' }
      return null
    })
    setPage(0)
  }, [])

  const applyFilters = useCallback((next) => {
    setFilters(next)
    setPage(0)
  }, [])

  return {
    columns,
    rows,
    rowCount,
    page,
    pageSize,
    orderBy,
    filters,
    loading,
    error,
    duration,
    totalPages,
    setPage,
    setPageSize,
    toggleSort,
    applyFilters,
    refresh,
  }
}
