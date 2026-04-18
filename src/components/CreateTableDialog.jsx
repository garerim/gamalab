import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Trash2,
  Key,
  Table as TableIcon,
  Loader2,
  Code2,
  GripVertical,
  Link2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

const PG_TYPES = [
  { group: 'Numeric', types: ['serial', 'bigserial', 'smallint', 'integer', 'bigint', 'real', 'double precision', 'numeric'] },
  { group: 'Text', types: ['text', 'varchar', 'char'] },
  { group: 'Boolean', types: ['boolean'] },
  { group: 'Date & Time', types: ['date', 'time', 'timestamp', 'timestamptz', 'interval'] },
  { group: 'JSON', types: ['json', 'jsonb'] },
  { group: 'UUID', types: ['uuid'] },
  { group: 'Binary', types: ['bytea'] },
]

const ALL_TYPES = PG_TYPES.flatMap((g) => g.types)
const AUTO_TYPES = new Set(['serial', 'bigserial'])
const FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

function newColumn(overrides = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    type: 'text',
    length: '',
    nullable: true,
    primaryKey: false,
    unique: false,
    defaultValue: '',
    ...overrides,
  }
}

function newFk() {
  return {
    id: `fk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceColumn: '',
    targetSchema: '',
    targetTable: '',
    targetColumn: '',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  }
}

function isValidFk(fk) {
  return !!(fk.sourceColumn && fk.targetSchema && fk.targetTable && fk.targetColumn)
}

function buildCreateSql(schema, name, columns, foreignKeys) {
  if (!name) return ''
  const colLines = columns
    .filter((c) => c.name.trim())
    .map((c) => {
      const parts = [quoteIdent(c.name)]
      let type = c.type
      if (['varchar', 'char'].includes(type) && c.length) {
        type = `${type}(${parseInt(c.length, 10) || 255})`
      }
      parts.push(type)
      if (c.primaryKey) parts.push('PRIMARY KEY')
      if (!c.nullable && !c.primaryKey) parts.push('NOT NULL')
      if (c.unique && !c.primaryKey) parts.push('UNIQUE')
      if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`)
      return '  ' + parts.join(' ')
    })

  const fkLines = (foreignKeys || [])
    .filter(isValidFk)
    .map((fk) => {
      const constraintName = `${name}_${fk.sourceColumn}_fkey`
      const tail = []
      if (fk.onDelete && fk.onDelete !== 'NO ACTION') tail.push(`ON DELETE ${fk.onDelete}`)
      if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') tail.push(`ON UPDATE ${fk.onUpdate}`)
      return (
        `  CONSTRAINT ${quoteIdent(constraintName)} FOREIGN KEY (${quoteIdent(fk.sourceColumn)})` +
        ` REFERENCES ${quoteIdent(fk.targetSchema)}.${quoteIdent(fk.targetTable)} (${quoteIdent(fk.targetColumn)})` +
        (tail.length ? ' ' + tail.join(' ') : '')
      )
    })

  const allLines = [...colLines, ...fkLines]
  return `CREATE TABLE ${quoteIdent(schema || 'public')}.${quoteIdent(name)} (\n${allLines.join(',\n')}\n);`
}

export function CreateTableDialog() {
  const {
    createTableDialogOpen,
    setCreateTableDialogOpen,
    showToast,
    bumpTablesRefresh,
    setSidebarTab,
  } = useAppStore()
  const { activeConnection } = useDatabase()

  const [schema, setSchema] = useState('public')
  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState([
    newColumn({ name: 'id', type: 'serial', primaryKey: true, nullable: false }),
    newColumn({ name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' }),
  ])
  const [submitting, setSubmitting] = useState(false)
  const [showSql, setShowSql] = useState(false)
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [foreignKeys, setForeignKeys] = useState([])
  const [allDbTables, setAllDbTables] = useState([])
  const [targetColsCache, setTargetColsCache] = useState({}) // "schema.table" -> columns[]

  useEffect(() => {
    if (createTableDialogOpen) {
      setSchema('public')
      setTableName('')
      setColumns([
        newColumn({ name: 'id', type: 'serial', primaryKey: true, nullable: false }),
        newColumn({ name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' }),
      ])
      setForeignKeys([])
      setTargetColsCache({})
      setSubmitting(false)
      setShowSql(false)
      if (activeConnection) {
        window.gamalab.db
          .listAllTables(activeConnection.id)
          .then((tables) => setAllDbTables(tables.filter((t) => t.type !== 'VIEW')))
          .catch(() => setAllDbTables([]))
      }
    }
  }, [createTableDialogOpen, activeConnection])

  const loadTargetColumns = async (targetSchema, targetTable) => {
    if (!activeConnection || !targetSchema || !targetTable) return
    const key = `${targetSchema}.${targetTable}`
    if (targetColsCache[key]) return
    try {
      const cols = await window.gamalab.db.listColumns(
        activeConnection.id,
        targetSchema,
        targetTable
      )
      setTargetColsCache((c) => ({ ...c, [key]: cols }))
    } catch {
      setTargetColsCache((c) => ({ ...c, [key]: [] }))
    }
  }

  const addFk = () => setForeignKeys((fks) => [...fks, newFk()])
  const removeFk = (id) => setForeignKeys((fks) => fks.filter((f) => f.id !== id))
  const updateFk = (id, patch) => {
    setForeignKeys((fks) => fks.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  const updateCol = (id, patch) => {
    setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const removeCol = (id) => {
    setColumns((cols) => cols.filter((c) => c.id !== id))
  }

  const addCol = () => {
    setColumns((cols) => [...cols, newColumn()])
  }

  const moveCol = (fromId, targetId) => {
    if (!fromId || !targetId || fromId === targetId) return
    setColumns((cols) => {
      const fromIdx = cols.findIndex((c) => c.id === fromId)
      const targetIdx = cols.findIndex((c) => c.id === targetId)
      if (fromIdx === -1 || targetIdx === -1) return cols
      const next = [...cols]
      const [moved] = next.splice(fromIdx, 1)
      // Always insert before the target (matches the top-border drop indicator)
      const newTargetIdx = next.findIndex((c) => c.id === targetId)
      next.splice(newTargetIdx, 0, moved)
      return next
    })
  }

  const togglePrimaryKey = (id) => {
    setColumns((cols) =>
      cols.map((c) =>
        c.id === id
          ? { ...c, primaryKey: !c.primaryKey, nullable: c.primaryKey ? c.nullable : false }
          : c
      )
    )
  }

  const sql = useMemo(
    () => buildCreateSql(schema, tableName, columns, foreignKeys),
    [schema, tableName, columns, foreignKeys]
  )

  const handleSubmit = async () => {
    if (!activeConnection) {
      showToast('Connect to a database first', 'warning')
      return
    }
    if (!tableName.trim()) {
      showToast('Table name is required', 'warning')
      return
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      showToast('Invalid table name', 'warning')
      return
    }
    if (columns.filter((c) => c.name.trim()).length === 0) {
      showToast('At least one column is required', 'warning')
      return
    }
    for (const c of columns) {
      if (c.name.trim() && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name)) {
        showToast(`Invalid column name: ${c.name}`, 'warning')
        return
      }
    }
    for (const fk of foreignKeys) {
      if (!isValidFk(fk)) {
        showToast('One or more foreign keys are incomplete', 'warning')
        return
      }
      if (!columns.some((c) => c.name === fk.sourceColumn)) {
        showToast(`FK source column "${fk.sourceColumn}" does not exist`, 'warning')
        return
      }
    }

    setSubmitting(true)
    try {
      await window.gamalab.db.query(activeConnection.id, sql)
      showToast(`Table "${tableName}" created`, 'success')
      bumpTablesRefresh()
      setSidebarTab('tables')
      setCreateTableDialogOpen(false)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={createTableDialogOpen}
      onOpenChange={(o) => !submitting && setCreateTableDialogOpen(o)}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TableIcon className="h-5 w-5 text-lab-blue" />
            New Table
          </DialogTitle>
          <DialogDescription>
            Design your table visually. GamaLab generates the CREATE TABLE for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schema">Schema</Label>
              <Input
                id="schema"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                placeholder="public"
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tname">Table name</Label>
              <Input
                id="tname"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="users"
                autoFocus
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Columns ({columns.length})
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => setShowSql((s) => !s)}
              >
                <Code2 className="h-3 w-3" />
                {showSql ? 'Hide SQL' : 'Preview SQL'}
              </Button>
            </div>

            <div className="rounded-md border border-border bg-muted/20">
              <div className="grid grid-cols-[20px_1fr_1fr_70px_60px_60px_60px_1fr_28px] gap-1 border-b border-border bg-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span />
                <span>Name</span>
                <span>Type</span>
                <span>Len</span>
                <span className="text-center">PK</span>
                <span className="text-center">NULL</span>
                <span className="text-center">UNIQ</span>
                <span>Default</span>
                <span />
              </div>
              <div className="flex flex-col">
                {columns.map((col) => {
                  const needsLength = ['varchar', 'char'].includes(col.type)
                  const isDragging = draggedId === col.id
                  const isDragOver = dragOverId === col.id && draggedId && draggedId !== col.id
                  return (
                    <div
                      key={col.id}
                      onDragOver={(e) => {
                        if (!draggedId) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dragOverId !== col.id) setDragOverId(col.id)
                      }}
                      onDragLeave={(e) => {
                        // Only clear if leaving the row, not entering a child
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          if (dragOverId === col.id) setDragOverId(null)
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        moveCol(draggedId, col.id)
                        setDraggedId(null)
                        setDragOverId(null)
                      }}
                      className={cn(
                        'grid grid-cols-[20px_1fr_1fr_70px_60px_60px_60px_1fr_28px] gap-1 border-b border-border px-2 py-1.5 text-xs last:border-b-0 transition-colors',
                        col.primaryKey && 'bg-lab-orange/5',
                        isDragging && 'opacity-40',
                        isDragOver && 'border-t-2 border-t-lab-blue'
                      )}
                    >
                      <div
                        draggable={!submitting}
                        onDragStart={(e) => {
                          setDraggedId(col.id)
                          e.dataTransfer.effectAllowed = 'move'
                          // Some browsers require data to be set to initiate drag
                          e.dataTransfer.setData('text/plain', col.id)
                        }}
                        onDragEnd={() => {
                          setDraggedId(null)
                          setDragOverId(null)
                        }}
                        className={cn(
                          'flex items-center justify-center text-muted-foreground',
                          !submitting && 'cursor-grab active:cursor-grabbing'
                        )}
                        title="Drag to reorder"
                      >
                        {col.primaryKey ? (
                          <Key className="h-3 w-3 text-lab-orange" />
                        ) : (
                          <GripVertical className="h-3 w-3 opacity-40 hover:opacity-100" />
                        )}
                      </div>
                      <Input
                        value={col.name}
                        onChange={(e) => updateCol(col.id, { name: e.target.value })}
                        placeholder="column_name"
                        className="h-7 text-xs"
                        disabled={submitting}
                      />
                      <select
                        value={col.type}
                        onChange={(e) => updateCol(col.id, { type: e.target.value })}
                        disabled={submitting}
                        className="h-7 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {PG_TYPES.map((g) => (
                          <optgroup key={g.group} label={g.group}>
                            {g.types.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <Input
                        value={col.length}
                        onChange={(e) => updateCol(col.id, { length: e.target.value })}
                        placeholder="255"
                        disabled={submitting || !needsLength}
                        className="h-7 text-xs tabular-nums"
                      />
                      <button
                        onClick={() => togglePrimaryKey(col.id)}
                        disabled={submitting}
                        className={cn(
                          'flex items-center justify-center rounded transition-colors',
                          col.primaryKey
                            ? 'text-lab-orange'
                            : 'text-muted-foreground/50 hover:text-foreground'
                        )}
                        title="Primary key"
                      >
                        <input
                          type="checkbox"
                          checked={col.primaryKey}
                          onChange={() => togglePrimaryKey(col.id)}
                          className="h-3.5 w-3.5 accent-lab-orange"
                        />
                      </button>
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          disabled={submitting || col.primaryKey || AUTO_TYPES.has(col.type)}
                          onChange={(e) => updateCol(col.id, { nullable: e.target.checked })}
                          className="h-3.5 w-3.5 accent-lab-blue"
                          title={col.primaryKey ? 'PK cannot be NULL' : 'Allow NULL'}
                        />
                      </div>
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={col.unique}
                          disabled={submitting || col.primaryKey}
                          onChange={(e) => updateCol(col.id, { unique: e.target.checked })}
                          className="h-3.5 w-3.5 accent-lab-green"
                          title="Unique"
                        />
                      </div>
                      <Input
                        value={col.defaultValue}
                        onChange={(e) => updateCol(col.id, { defaultValue: e.target.value })}
                        placeholder="now(), 'x', 0"
                        className="h-7 font-mono text-[11px]"
                        disabled={submitting}
                      />
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => removeCol(col.id)}
                        disabled={submitting || columns.length === 1}
                        className="h-7 w-7 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )
                })}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={addCol}
                disabled={submitting}
                className="w-full justify-start rounded-none text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Add column
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                <Link2 className="h-3 w-3" />
                Foreign keys ({foreignKeys.length})
              </Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={addFk}
                disabled={submitting || allDbTables.length === 0}
                className="h-7 px-2 text-[11px]"
                title={
                  allDbTables.length === 0
                    ? 'No tables in this database to reference'
                    : 'Add a foreign key'
                }
              >
                <Plus className="h-3 w-3" />
                Add FK
              </Button>
            </div>

            {foreignKeys.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2">
                {foreignKeys.map((fk) => {
                  const targetKey = `${fk.targetSchema}.${fk.targetTable}`
                  const targetCols = targetColsCache[targetKey] || []
                  const schemas = Array.from(
                    new Set(allDbTables.map((t) => t.schema))
                  ).sort()
                  const tablesForSchema = allDbTables.filter(
                    (t) => t.schema === fk.targetSchema
                  )
                  return (
                    <div
                      key={fk.id}
                      className="flex flex-col gap-1.5 rounded border border-border bg-background p-2 text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">From</span>
                        <select
                          value={fk.sourceColumn}
                          onChange={(e) =>
                            updateFk(fk.id, { sourceColumn: e.target.value })
                          }
                          disabled={submitting}
                          className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">(select column)</option>
                          {columns
                            .filter((c) => c.name.trim())
                            .map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                        <span className="text-muted-foreground">→</span>
                        <select
                          value={fk.targetSchema}
                          onChange={(e) =>
                            updateFk(fk.id, {
                              targetSchema: e.target.value,
                              targetTable: '',
                              targetColumn: '',
                            })
                          }
                          disabled={submitting}
                          className="h-7 w-24 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">schema</option>
                          {schemas.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <select
                          value={fk.targetTable}
                          onChange={(e) => {
                            const newTable = e.target.value
                            updateFk(fk.id, { targetTable: newTable, targetColumn: '' })
                            if (newTable) loadTargetColumns(fk.targetSchema, newTable)
                          }}
                          disabled={submitting || !fk.targetSchema}
                          className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">table</option>
                          {tablesForSchema.map((t) => (
                            <option key={t.name} value={t.name}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={fk.targetColumn}
                          onChange={(e) =>
                            updateFk(fk.id, { targetColumn: e.target.value })
                          }
                          disabled={submitting || !fk.targetTable}
                          className="h-7 w-28 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">column</option>
                          {targetCols.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="iconSm"
                          variant="ghost"
                          onClick={() => removeFk(fk.id)}
                          disabled={submitting}
                          className="h-7 w-7 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground">
                        <span className="uppercase tracking-wider">On delete</span>
                        <select
                          value={fk.onDelete}
                          onChange={(e) => updateFk(fk.id, { onDelete: e.target.value })}
                          disabled={submitting}
                          className="h-6 rounded border border-input bg-background px-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {FK_ACTIONS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                        <span className="ml-3 uppercase tracking-wider">On update</span>
                        <select
                          value={fk.onUpdate}
                          onChange={(e) => updateFk(fk.id, { onUpdate: e.target.value })}
                          disabled={submitting}
                          className="h-6 rounded border border-input bg-background px-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {FK_ACTIONS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {showSql && (
            <div className="rounded-md border border-border bg-background p-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-foreground/90">
                {sql || '-- Fill in the table name and at least one column'}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge variant="info">{columns.length} columns</Badge>
            {columns.some((c) => c.primaryKey) && (
              <Badge variant="warning">
                PK: {columns.filter((c) => c.primaryKey).map((c) => c.name).join(', ')}
              </Badge>
            )}
            {foreignKeys.filter(isValidFk).length > 0 && (
              <Badge variant="info">
                {foreignKeys.filter(isValidFk).length} FK
                {foreignKeys.filter(isValidFk).length === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setCreateTableDialogOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="lab" onClick={handleSubmit} disabled={submitting || !activeConnection}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <TableIcon className="h-4 w-4" />
                Create Table
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
