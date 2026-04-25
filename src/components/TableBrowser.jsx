import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  Code2,
  Copy,
  Key,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Loader2,
  AlertTriangle,
  Plus,
  Trash2,
  X,
  Pencil,
  Check,
  Filter as FilterIcon,
  Link2,
  Download,
  Table as TableIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatDuration } from '@/lib/utils'
import { confirm } from '@/lib/confirm'
import { useAppStore } from '@/store/appStore'
import { useTableBrowser } from '@/hooks/useTables'
import { useDatabase } from '@/hooks/useDatabase'
import { InsertRowDialog } from '@/components/InsertRowDialog'
import { formatExport } from '@/lib/exportFormatters'

const PAGE_SIZES = [25, 50, 100, 250, 500]

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

function isNumericType(col) {
  return /^(int|float|numeric|real|double|smallint|bigint)/i.test(col.udt_name)
}
function isBooleanType(col) {
  return col.udt_name === 'bool' || col.type === 'boolean'
}
function isJsonType(col) {
  return col.udt_name === 'json' || col.udt_name === 'jsonb'
}
function isComputedColumn(col) {
  return /nextval\(/i.test(col.default_value || '')
}
function cellToDraft(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function CellEditor({ editing, setEditing, saving, onSave, onCancel, inputRef }) {
  const col = editing.column
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }
  const toggleNull = () => {
    setEditing((prev) => ({ ...prev, isNull: !prev.isNull, draft: prev.isNull ? prev.draft : '' }))
  }
  const setDraft = (v) =>
    setEditing((prev) => ({ ...prev, draft: v, isNull: false }))

  const commonProps = {
    ref: inputRef,
    onKeyDown,
    disabled: saving || editing.isNull,
    onBlur: (e) => {
      // Save on blur unless focus moved to one of our control buttons
      const next = e.relatedTarget
      if (next && next.dataset?.cellEditorControl) return
      onSave()
    },
    className:
      'h-full w-full bg-background px-2 py-1 font-mono text-xs outline-none ring-0',
  }

  const input = editing.isNull ? (
    <div className="flex h-full w-full items-center px-2 text-[11px] italic text-muted-foreground">
      NULL
    </div>
  ) : col.udt_name === 'bool' || col.type === 'boolean' ? (
    <select
      {...commonProps}
      value={editing.draft || 'false'}
      onChange={(e) => setDraft(e.target.value)}
    >
      <option value="false">false</option>
      <option value="true">true</option>
    </select>
  ) : col.udt_name === 'json' || col.udt_name === 'jsonb' ? (
    <textarea
      {...commonProps}
      value={editing.draft}
      onChange={(e) => setDraft(e.target.value)}
      rows={3}
      className="w-full resize-y bg-background p-2 font-mono text-xs outline-none"
    />
  ) : /^(int|float|numeric|real|double|smallint|bigint)/i.test(col.udt_name) ? (
    <input
      {...commonProps}
      type="number"
      value={editing.draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  ) : (
    <input
      {...commonProps}
      type="text"
      value={editing.draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  )

  return (
    <div className="flex h-full w-full items-center gap-0">
      <div className="min-w-0 flex-1">{input}</div>
      <div className="flex items-center gap-0.5 bg-background pr-1">
        {col.nullable && (
          <button
            type="button"
            data-cell-editor-control="true"
            onClick={toggleNull}
            disabled={saving}
            className={cn(
              'rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider',
              editing.isNull
                ? 'bg-muted-foreground/20 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Toggle NULL"
          >
            null
          </button>
        )}
        <button
          type="button"
          data-cell-editor-control="true"
          onClick={onCancel}
          disabled={saving}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title="Cancel (Esc)"
        >
          <X className="h-3 w-3" />
        </button>
        <button
          type="button"
          data-cell-editor-control="true"
          onClick={onSave}
          disabled={saving}
          className="rounded p-1 text-lab-green hover:text-lab-green"
          title="Save (Enter)"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}

const OPS_TEXT = ['=', '!=', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL']
const OPS_NUMERIC = ['=', '!=', '<', '<=', '>', '>=', 'BETWEEN', 'IS NULL', 'IS NOT NULL']
const OPS_BOOL = ['IS TRUE', 'IS FALSE', 'IS NULL', 'IS NOT NULL']
const OPS_JSON = ['IS NULL', 'IS NOT NULL']

function opsForColumn(col) {
  if (!col) return OPS_TEXT
  if (isBooleanType(col)) return OPS_BOOL
  if (isJsonType(col)) return OPS_JSON
  if (isNumericType(col) || /date|timestamp|time/i.test(col.udt_name)) return OPS_NUMERIC
  return OPS_TEXT
}

function isNullaryOp(op) {
  return op === 'IS NULL' || op === 'IS NOT NULL' || op === 'IS TRUE' || op === 'IS FALSE'
}

function inputTypeForColumn(col) {
  if (!col) return 'text'
  if (isNumericType(col)) return 'number'
  if (col.udt_name === 'date') return 'date'
  if (/timestamp/i.test(col.udt_name)) return 'datetime-local'
  return 'text'
}

function FilterPanel({ columns, draftFilters, setDraftFilters, applyFilters, activeFilters }) {
  const updateFilter = (idx, patch) => {
    setDraftFilters((curr) => curr.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }
  const removeFilter = (idx) => {
    setDraftFilters((curr) => curr.filter((_, i) => i !== idx))
  }
  const addFilter = () => {
    const firstCol = columns[0]
    if (!firstCol) return
    const ops = opsForColumn(firstCol)
    setDraftFilters((curr) => [
      ...curr,
      { column: firstCol.name, op: ops[0], value: '', value2: '' },
    ])
  }

  // Deep-ish comparison against applied filters for the Apply button state
  const serialized = JSON.stringify(draftFilters)
  const activeSerialized = JSON.stringify(activeFilters)
  const hasChanges = serialized !== activeSerialized
  const canApply = draftFilters.every(
    (f) => f.column && f.op && (isNullaryOp(f.op) || String(f.value || '').length > 0)
  )

  return (
    <div className="border-b border-border bg-muted/20 px-3 py-2">
      <div className="flex flex-col gap-1.5">
        {draftFilters.length === 0 && (
          <div className="text-[11px] italic text-muted-foreground">
            No filters yet — add one to narrow the results.
          </div>
        )}
        {draftFilters.map((f, idx) => {
          const col = columns.find((c) => c.name === f.column)
          const ops = opsForColumn(col)
          const inputType = inputTypeForColumn(col)
          const showValue = !isNullaryOp(f.op)
          const showSecondValue = f.op === 'BETWEEN'
          return (
            <div key={idx} className="flex items-center gap-1.5 text-xs">
              <select
                value={f.column}
                onChange={(e) => {
                  const newCol = columns.find((c) => c.name === e.target.value)
                  const newOps = opsForColumn(newCol)
                  updateFilter(idx, {
                    column: e.target.value,
                    op: newOps.includes(f.op) ? f.op : newOps[0],
                  })
                }}
                className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={f.op}
                onChange={(e) => updateFilter(idx, { op: e.target.value })}
                className="h-7 w-28 shrink-0 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              {showValue && (
                <input
                  type={inputType}
                  value={f.value ?? ''}
                  onChange={(e) => updateFilter(idx, { value: e.target.value })}
                  placeholder={
                    f.op === 'LIKE' || f.op === 'ILIKE' ? 'e.g. %smith%' : 'value'
                  }
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
              {showSecondValue && (
                <input
                  type={inputType}
                  value={f.value2 ?? ''}
                  onChange={(e) => updateFilter(idx, { value2: e.target.value })}
                  placeholder="and"
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
              <button
                onClick={() => removeFilter(idx)}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                title="Remove filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={addFilter}
          className="h-7 text-[11px]"
          disabled={columns.length === 0}
        >
          <Plus className="h-3 w-3" />
          Add filter
        </Button>
        <div className="flex-1" />
        {activeFilters.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => applyFilters([])}
            className="h-7 text-[11px]"
            title="Clear all active filters"
          >
            Clear
          </Button>
        )}
        <Button
          size="sm"
          variant="lab"
          onClick={() => applyFilters(draftFilters)}
          disabled={!hasChanges || !canApply}
          className="h-7 text-[11px]"
        >
          Apply
        </Button>
      </div>
    </div>
  )
}

function renderValue(v) {
  if (v === null || v === undefined) {
    return <span className="italic text-muted-foreground/60">NULL</span>
  }
  if (typeof v === 'boolean') {
    return <span className={v ? 'text-lab-green' : 'text-lab-orange'}>{v ? 'true' : 'false'}</span>
  }
  if (typeof v === 'number') {
    return <span className="text-lab-blue">{v}</span>
  }
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    return <span className="text-lab-orange">{JSON.stringify(v)}</span>
  }
  return String(v)
}

function shortType(col) {
  const udt = col.udt_name
  const typeMap = {
    int4: 'int',
    int8: 'bigint',
    int2: 'smallint',
    float4: 'real',
    float8: 'double',
    bool: 'boolean',
    varchar: 'varchar',
    bpchar: 'char',
    timestamptz: 'timestamp',
    timestamp: 'timestamp',
    numeric: 'numeric',
  }
  const base = typeMap[udt] || udt || col.type
  if (col.max_length && ['varchar', 'char', 'bpchar'].includes(udt)) {
    return `${base}(${col.max_length})`
  }
  return base
}

export function TableBrowser() {
  const {
    activeTable,
    setActiveTable,
    setViewMode,
    showToast,
    setInsertRowDialogOpen,
    openEditTableDialog,
    bumpTablesRefresh,
    pendingTableFilters,
    consumePendingFilters,
    navigateToTableWithFilter,
  } = useAppStore()
  const updateTabContent = useAppStore((s) => s.updateTabContent)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const { activeConnection } = useDatabase()
  const {
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
  } = useTableBrowser(activeTable?.schema, activeTable?.name)

  const [selectedRow, setSelectedRow] = useState(null)
  const [selectedCell, setSelectedCell] = useState(null)
  const [selected, setSelected] = useState(() => new Map())
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(null) // { rowIdx, colName, draft, isNull, original }
  const [savingEdit, setSavingEdit] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [draftFilters, setDraftFilters] = useState([])
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportMenuRef = useRef(null)
  const selectAllRef = useRef(null)
  const editInputRef = useRef(null)

  // Sync draft with applied filters when they change externally (schema switch resets to [])
  useEffect(() => {
    setDraftFilters(filters)
  }, [filters])

  // Consume pending filters set by FK navigation once activeTable matches
  useEffect(() => {
    if (!pendingTableFilters || !activeTable) return
    if (
      pendingTableFilters.schema === activeTable.schema &&
      pendingTableFilters.name === activeTable.name
    ) {
      applyFilters(pendingTableFilters.filters)
      setShowFilters(true)
      consumePendingFilters()
    }
  }, [pendingTableFilters, activeTable, applyFilters, consumePendingFilters])

  const pkColumns = columns.filter((c) => c.is_primary_key)
  const hasPK = pkColumns.length > 0

  const rowKey = (row) => {
    if (!hasPK) return null
    const parts = pkColumns.map((c) => row[c.name])
    if (parts.some((v) => v === null || v === undefined)) return null
    return JSON.stringify(parts)
  }

  const allOnPageSelected =
    hasPK && rows.length > 0 && rows.every((r) => {
      const k = rowKey(r)
      return k != null && selected.has(k)
    })
  const someOnPageSelected =
    hasPK && rows.some((r) => {
      const k = rowKey(r)
      return k != null && selected.has(k)
    })

  useEffect(() => {
    setSelected(new Map())
  }, [activeTable?.schema, activeTable?.name, filters])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allOnPageSelected && someOnPageSelected
    }
  }, [allOnPageSelected, someOnPageSelected])

  const toggleRow = (row) => {
    const key = rowKey(row)
    if (key == null) return
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, row)
      return next
    })
  }

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (allOnPageSelected) {
        for (const r of rows) {
          const k = rowKey(r)
          if (k != null) next.delete(k)
        }
      } else {
        for (const r of rows) {
          const k = rowKey(r)
          if (k != null) next.set(k, r)
        }
      }
      return next
    })
  }

  const clearSelection = () => setSelected(new Map())

  const handleDeleteSelected = async () => {
    if (selected.size === 0 || !hasPK || !activeConnection || !activeTable) return
    const ok = await confirm({
      title: `Delete ${selected.size} row${selected.size === 1 ? '' : 's'}?`,
      message: `Permanently delete from ${activeTable.schema}.${activeTable.name}?`,
      detail: 'This cannot be undone.',
      variant: 'destructive',
      confirmLabel: 'Delete',
    })
    if (!ok) return

    const qualifiedTable = `${quoteIdent(activeTable.schema)}.${quoteIdent(activeTable.name)}`
    const params = []
    let sql

    if (pkColumns.length === 1) {
      const pk = pkColumns[0]
      const placeholders = []
      for (const row of selected.values()) {
        params.push(row[pk.name])
        placeholders.push(`$${params.length}`)
      }
      sql = `DELETE FROM ${qualifiedTable} WHERE ${quoteIdent(pk.name)} IN (${placeholders.join(', ')})`
    } else {
      const tuples = []
      for (const row of selected.values()) {
        const ph = pkColumns.map((c) => {
          params.push(row[c.name])
          return `$${params.length}`
        })
        tuples.push(`(${ph.join(', ')})`)
      }
      const cols = pkColumns.map((c) => quoteIdent(c.name)).join(', ')
      sql = `DELETE FROM ${qualifiedTable} WHERE (${cols}) IN (${tuples.join(', ')})`
    }

    setDeleting(true)
    try {
      const result = await window.gamalab.db.query(activeConnection.id, sql, params)
      const affected = result?.rowCount ?? selected.size
      showToast(`Deleted ${affected} row${affected === 1 ? '' : 's'}`, 'success')
      clearSelection()
      refresh()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  if (!activeTable) return null

  const copyCell = async (value) => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    try {
      await navigator.clipboard.writeText(text)
      showToast('Cell copied', 'info')
    } catch {
      showToast('Copy failed', 'error')
    }
  }

  const copyRow = async (row) => {
    const text = columns.map((c) => {
      const v = row[c.name]
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    }).join('\t')
    try {
      await navigator.clipboard.writeText(text)
      showToast('Row copied', 'info')
    } catch {
      showToast('Copy failed', 'error')
    }
  }

  const goToSql = () => {
    const order = orderBy ? ` ORDER BY "${orderBy.column}" ${orderBy.direction.toUpperCase()}` : ''
    const sql = `SELECT * FROM "${activeTable.schema}"."${activeTable.name}"${order} LIMIT ${pageSize} OFFSET ${page * pageSize};`
    if (activeTabId) updateTabContent(activeTabId, sql)
    setActiveTable(null)
  }

  const goBack = () => {
    setActiveTable(null)
  }

  const canEditCell = (col) => {
    if (!hasPK) return false
    if (col.is_primary_key) return false
    if (isComputedColumn(col)) return false
    return true
  }

  const startEdit = (row, idx, col) => {
    if (!canEditCell(col)) return
    const current = row[col.name]
    setEditing({
      rowIdx: idx,
      colName: col.name,
      row,
      column: col,
      draft: cellToDraft(current),
      isNull: current === null || current === undefined,
      original: current,
    })
  }

  const cancelEdit = () => setEditing(null)

  const saveEdit = async () => {
    if (!editing || savingEdit || !activeConnection || !activeTable) return
    const { column: col, row, draft, isNull, original } = editing

    let value
    if (isNull) {
      value = null
    } else if (isBooleanType(col)) {
      value = draft === 'true' || draft === true
    } else if (isNumericType(col)) {
      if (draft === '' && col.nullable) {
        value = null
      } else {
        const n = Number(draft)
        if (Number.isNaN(n)) {
          showToast(`Invalid number for ${col.name}`, 'warning')
          return
        }
        value = n
      }
    } else if (isJsonType(col)) {
      if (draft === '' && col.nullable) {
        value = null
      } else {
        try {
          JSON.parse(draft)
          value = draft
        } catch {
          showToast(`Invalid JSON for ${col.name}`, 'warning')
          return
        }
      }
    } else {
      value = draft === '' && col.nullable ? null : draft
    }

    // No-op if unchanged
    const originalDraft = cellToDraft(original)
    const originalIsNull = original === null || original === undefined
    if (isNull === originalIsNull && draft === originalDraft) {
      setEditing(null)
      return
    }

    // Build UPDATE ... WHERE <pk...>
    const params = [value]
    const setClause = `${quoteIdent(col.name)} = $1`
    const whereParts = pkColumns.map((c, i) => {
      params.push(row[c.name])
      return `${quoteIdent(c.name)} = $${i + 2}`
    })
    const sql = `UPDATE ${quoteIdent(activeTable.schema)}.${quoteIdent(activeTable.name)} SET ${setClause} WHERE ${whereParts.join(' AND ')}`

    setSavingEdit(true)
    try {
      const result = await window.gamalab.db.query(activeConnection.id, sql, params)
      if ((result?.rowCount ?? 0) === 0) {
        showToast('No row matched — maybe it was deleted elsewhere', 'warning')
      } else {
        showToast('Cell updated', 'success')
      }
      setEditing(null)
      refresh()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  useEffect(() => {
    setEditing(null)
  }, [activeTable?.schema, activeTable?.name, page, pageSize, orderBy, filters])

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus()
      if (typeof editInputRef.current.select === 'function') {
        editInputRef.current.select()
      }
    }
  }, [editing?.rowIdx, editing?.colName])

  useEffect(() => {
    if (!exportMenuOpen) return
    const handler = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportMenuOpen])

  const handleExport = async (format, scope) => {
    if (!activeConnection || !activeTable) return
    setExportMenuOpen(false)
    setExporting(true)
    try {
      let exportRows
      if (scope === 'page') {
        exportRows = rows
      } else {
        const result = await window.gamalab.db.exportRows(
          activeConnection.id,
          activeTable.schema,
          activeTable.name,
          { filters, orderBy }
        )
        exportRows = result.rows
      }
      const content = formatExport({
        format,
        schema: activeTable.schema,
        table: activeTable.name,
        columns,
        rows: exportRows,
      })
      const defaultPath = `${activeTable.schema}_${activeTable.name}.${format}`
      const result = await window.gamalab.dialog.saveExport({
        defaultPath,
        content,
        format,
      })
      if (!result.canceled) {
        showToast(`Exported ${exportRows.length} row${exportRows.length === 1 ? '' : 's'}`, 'success')
      }
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setExporting(false)
    }
  }

  const handleDropTable = async () => {
    if (!activeConnection || !activeTable) return
    const ok = await confirm({
      title: `Drop table "${activeTable.name}"?`,
      message: `Permanently delete ${activeTable.schema}.${activeTable.name} and all its data?`,
      detail: 'This cannot be undone.',
      variant: 'destructive',
      confirmLabel: 'Drop table',
    })
    if (!ok) return
    const sql = `DROP TABLE ${quoteIdent(activeTable.schema)}.${quoteIdent(activeTable.name)}`
    try {
      await window.gamalab.db.query(activeConnection.id, sql)
      showToast(`Table "${activeTable.name}" dropped`, 'success')
      setActiveTable(null)
      bumpTablesRefresh()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const startRow = page * pageSize + 1
  const endRow = Math.min((page + 1) * pageSize, rowCount ?? (page + 1) * pageSize)

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-11 items-center justify-between border-b border-border bg-card px-3">
        <div className="flex items-center gap-2 text-sm">
          <TableIcon className="h-4 w-4 text-lab-blue" />
          <span className="text-xs text-muted-foreground">{activeTable.schema}</span>
          <span className="text-muted-foreground/60">.</span>
          <span className="font-semibold">{activeTable.name}</span>
          {rowCount != null && (
            <Badge variant="info" className="ml-2 font-mono">
              {rowCount.toLocaleString()} rows
            </Badge>
          )}
          {typeof duration === 'number' && (
            <span className="text-[10px] text-muted-foreground">
              · {formatDuration(duration)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="lab"
            onClick={() => setInsertRowDialogOpen(true)}
            disabled={columns.length === 0}
            title="Insert a new row"
          >
            <Plus className="h-3.5 w-3.5" />
            Insert
          </Button>
          <Button
            size="sm"
            variant={showFilters || filters.length > 0 ? 'secondary' : 'ghost'}
            onClick={() => setShowFilters((s) => !s)}
            title="Filter rows"
          >
            <FilterIcon className="h-3.5 w-3.5" />
            Filter
            {filters.length > 0 && (
              <span className="ml-1 rounded bg-lab-blue/20 px-1 text-[10px] font-semibold text-lab-blue">
                {filters.length}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openEditTableDialog(activeTable.schema, activeTable.name)}
            title="Edit table schema"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <div className="relative" ref={exportMenuRef}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExportMenuOpen((o) => !o)}
              disabled={exporting || columns.length === 0}
              title="Export rows"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export
            </Button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[240px] rounded-md border border-border bg-popover p-1 text-xs shadow-lg">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Current page ({rows.length} row{rows.length === 1 ? '' : 's'})
                </div>
                {['csv', 'json', 'sql'].map((fmt) => (
                  <button
                    key={`page-${fmt}`}
                    onClick={() => handleExport(fmt, 'page')}
                    disabled={rows.length === 0}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span>As {fmt.toUpperCase()}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">.{fmt}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  All rows{filters.length > 0 ? ' (filtered)' : ''}
                  {rowCount != null && ` · ${rowCount.toLocaleString()}`}
                </div>
                {['csv', 'json', 'sql'].map((fmt) => (
                  <button
                    key={`all-${fmt}`}
                    onClick={() => handleExport(fmt, 'all')}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-accent"
                  >
                    <span>As {fmt.toUpperCase()}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">.{fmt}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={goToSql} title="Open as SQL">
            <Code2 className="h-3.5 w-3.5" />
            SQL
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDropTable}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Drop table"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Drop
          </Button>
          <Button size="sm" variant="ghost" onClick={goBack}>
            Back
          </Button>
        </div>
      </div>

      {showFilters && (
        <FilterPanel
          columns={columns}
          draftFilters={draftFilters}
          setDraftFilters={setDraftFilters}
          applyFilters={applyFilters}
          activeFilters={filters}
        />
      )}

      {selected.size > 0 && (
        <div className="flex h-9 items-center justify-between border-b border-lab-blue/30 bg-lab-blue/10 px-3 text-xs">
          <div className="flex items-center gap-2 text-foreground">
            <span className="font-semibold">{selected.size}</span>
            <span className="text-muted-foreground">
              row{selected.size === 1 ? '' : 's'} selected
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={deleting}
              className="h-7 text-[11px]"
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="h-7 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Delete selected
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="m-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="font-mono">{error}</span>
          </div>
        ) : columns.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading table schema…
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-card shadow-sm">
              <tr>
                <th className="sticky left-0 z-20 w-8 border-b border-r border-border bg-card px-2 py-2 text-center">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                    disabled={!hasPK || rows.length === 0}
                    title={hasPK ? 'Select all on page' : 'Table has no primary key'}
                    className="h-3.5 w-3.5 accent-lab-blue disabled:opacity-30"
                  />
                </th>
                <th className="sticky left-8 z-20 w-10 border-b border-r border-border bg-card px-2 py-2 text-right text-[10px] font-normal text-muted-foreground">
                  #
                </th>
                {columns.map((col) => {
                  const isSorted = orderBy?.column === col.name
                  const SortIcon =
                    !isSorted
                      ? ArrowUpDown
                      : orderBy.direction === 'asc'
                        ? ArrowUp
                        : ArrowDown
                  return (
                    <th
                      key={col.name}
                      className={cn(
                        'group select-none border-b border-r border-border px-3 py-2 text-left align-top',
                        isSorted && 'bg-lab-blue/5'
                      )}
                    >
                      <button
                        onClick={() => toggleSort(col.name)}
                        className="flex w-full items-center gap-1.5 text-left"
                        title={`Sort by ${col.name}`}
                      >
                        {col.is_primary_key && (
                          <Key className="h-3 w-3 shrink-0 text-lab-orange" />
                        )}
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-1 truncate font-semibold text-foreground">
                            {col.name}
                            {!col.nullable && !col.is_primary_key && (
                              <span className="text-destructive/70" title="NOT NULL">
                                *
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[10px] font-normal text-muted-foreground">
                            {shortType(col)}
                            {col.is_primary_key && (
                              <span className="ml-1 text-lab-orange/80">PK</span>
                            )}
                            {col.foreign_table && (
                              <span
                                className="ml-1 inline-flex items-center gap-0.5 text-lab-blue/80"
                                title={`→ ${col.foreign_schema}.${col.foreign_table}.${col.foreign_column}`}
                              >
                                <Link2 className="h-2.5 w-2.5" />
                                FK
                              </span>
                            )}
                          </span>
                        </div>
                        <SortIcon
                          className={cn(
                            'ml-auto h-3 w-3 shrink-0 transition-opacity',
                            isSorted ? 'text-lab-blue opacity-100' : 'opacity-0 group-hover:opacity-60'
                          )}
                        />
                      </button>
                    </th>
                  )
                })}
                <th className="sticky right-0 w-8 border-b border-border bg-card" />
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 3}
                    className="py-8 text-center text-xs text-muted-foreground"
                  >
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin text-lab-blue" />
                    Loading rows…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 3}
                    className="py-8 text-center text-xs text-muted-foreground"
                  >
                    No rows
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const idx = page * pageSize + i
                  const isSelected = selectedRow === idx
                  const key = rowKey(row)
                  const isChecked = key != null && selected.has(key)
                  return (
                    <tr
                      key={idx}
                      className={cn(
                        'group',
                        isChecked
                          ? 'bg-lab-blue/15'
                          : isSelected
                            ? 'bg-lab-blue/10'
                            : i % 2 === 0
                              ? 'bg-background'
                              : 'bg-card/30'
                      )}
                      onClick={() => setSelectedRow(idx)}
                    >
                      <td
                        className="sticky left-0 border-b border-r border-border bg-inherit px-2 py-1 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRow(row)}
                          disabled={key == null}
                          title={key == null ? 'No primary key' : 'Select row'}
                          className="h-3.5 w-3.5 accent-lab-blue disabled:opacity-30"
                        />
                      </td>
                      <td className="sticky left-8 border-b border-r border-border bg-inherit px-2 py-1 text-right font-mono text-[10px] text-muted-foreground">
                        {idx + 1}
                      </td>
                      {columns.map((col) => {
                        const cellId = `${idx}:${col.name}`
                        const isCellSelected = selectedCell === cellId
                        const isEditingThis =
                          editing?.rowIdx === idx && editing?.colName === col.name
                        const editable = canEditCell(col)
                        return (
                          <td
                            key={col.name}
                            className={cn(
                              'max-w-xs truncate border-b border-r border-border px-3 py-1 font-mono',
                              isCellSelected && !isEditingThis && 'ring-1 ring-inset ring-lab-blue',
                              isEditingThis && 'bg-lab-blue/10 p-0 ring-2 ring-inset ring-lab-blue'
                            )}
                            title={
                              isEditingThis
                                ? undefined
                                : !editable
                                  ? col.is_primary_key
                                    ? 'Primary key — not editable'
                                    : isComputedColumn(col)
                                      ? 'Auto-generated — not editable'
                                      : 'No primary key — not editable'
                                  : row[col.name] === null
                                    ? 'NULL (double-click to edit)'
                                    : typeof row[col.name] === 'object'
                                      ? JSON.stringify(row[col.name])
                                      : String(row[col.name])
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isEditingThis) return
                              setSelectedCell(cellId)
                              setSelectedRow(idx)
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              if (editable) startEdit(row, idx, col)
                              else copyCell(row[col.name])
                            }}
                          >
                            {isEditingThis ? (
                              <CellEditor
                                editing={editing}
                                setEditing={setEditing}
                                saving={savingEdit}
                                onSave={saveEdit}
                                onCancel={cancelEdit}
                                inputRef={editInputRef}
                              />
                            ) : col.foreign_table && row[col.name] !== null && row[col.name] !== undefined ? (
                              <div className="flex items-center gap-1">
                                <span className="min-w-0 flex-1 truncate text-lab-blue">
                                  {renderValue(row[col.name])}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigateToTableWithFilter(
                                      col.foreign_schema,
                                      col.foreign_table,
                                      [
                                        {
                                          column: col.foreign_column,
                                          op: '=',
                                          value: row[col.name],
                                        },
                                      ]
                                    )
                                  }}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  className="shrink-0 rounded p-0.5 text-lab-blue/60 transition-colors hover:bg-background hover:text-lab-blue"
                                  title={`Jump to ${col.foreign_schema}.${col.foreign_table}.${col.foreign_column} = ${row[col.name]}`}
                                >
                                  <Link2 className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              renderValue(row[col.name])
                            )}
                          </td>
                        )
                      })}
                      <td className="sticky right-0 w-8 border-b border-border bg-inherit px-1 py-1">
                        <Button
                          size="iconSm"
                          variant="ghost"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyRow(row)
                          }}
                          title="Copy row"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex h-10 items-center justify-between border-t border-border bg-card px-3 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          {rowCount != null && rows.length > 0 ? (
            <span>
              {startRow.toLocaleString()}–{endRow.toLocaleString()} of{' '}
              {rowCount.toLocaleString()}
            </span>
          ) : (
            <span>—</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="iconSm"
            variant="ghost"
            disabled={page === 0 || loading}
            onClick={() => setPage(0)}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="iconSm"
            variant="ghost"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-[70px] text-center text-[11px] tabular-nums">
            Page {page + 1}
            {totalPages ? ` / ${totalPages}` : ''}
          </span>
          <Button
            size="iconSm"
            variant="ghost"
            disabled={(totalPages != null && page >= totalPages - 1) || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="iconSm"
            variant="ghost"
            disabled={totalPages == null || page >= totalPages - 1 || loading}
            onClick={() => totalPages && setPage(totalPages - 1)}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(0)
            }}
            className="h-6 rounded border border-border bg-background px-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <InsertRowDialog
        schema={activeTable.schema}
        table={activeTable.name}
        columns={columns}
        onInserted={refresh}
      />
    </div>
  )
}
