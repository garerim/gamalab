import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Trash2,
  Key,
  Table as TableIcon,
  Loader2,
  Code2,
  Undo2,
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
import { ScrollArea } from '@/components/ui/scroll-area'
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

const FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

function newColumn() {
  return {
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    isNew: true,
    originalName: null,
    name: '',
    type: 'text',
    length: '',
    nullable: true,
    unique: false,
    defaultValue: '',
    dropped: false,
  }
}

function normalizeExisting(col) {
  return {
    id: `existing-${col.name}`,
    isNew: false,
    originalName: col.name,
    name: col.name,
    type: col.udt_name || col.type || 'text',
    length: col.max_length || '',
    nullable: !!col.nullable,
    originalNullable: !!col.nullable,
    unique: false,
    defaultValue: col.default_value || '',
    originalDefaultValue: col.default_value || '',
    isPrimaryKey: !!col.is_primary_key,
    dropped: false,
  }
}

function buildAlterStatements(schema, oldName, newName, columns, foreignKeys) {
  const statements = []
  const qSchema = quoteIdent(schema)
  const qOld = `${qSchema}.${quoteIdent(oldName)}`

  // 0. Drop existing FKs marked for removal (do this before column drops,
  //    and always using the ORIGINAL table name since rename is last)
  for (const fk of foreignKeys || []) {
    if (!fk.isNew && fk.dropped && fk.constraintName) {
      statements.push(`ALTER TABLE ${qOld} DROP CONSTRAINT ${quoteIdent(fk.constraintName)}`)
    }
  }

  // 1. Column renames (use original name for now)
  for (const c of columns) {
    if (!c.isNew && !c.dropped && c.originalName && c.name && c.name !== c.originalName) {
      statements.push(
        `ALTER TABLE ${qOld} RENAME COLUMN ${quoteIdent(c.originalName)} TO ${quoteIdent(c.name)}`
      )
    }
  }

  // 2. Drop columns
  for (const c of columns) {
    if (!c.isNew && c.dropped && c.originalName) {
      statements.push(`ALTER TABLE ${qOld} DROP COLUMN ${quoteIdent(c.originalName)}`)
    }
  }

  // 3. Alter existing columns: nullable + default (use new name since rename already applied)
  for (const c of columns) {
    if (c.isNew || c.dropped) continue
    const colName = quoteIdent(c.name)
    if (c.nullable !== c.originalNullable) {
      statements.push(
        `ALTER TABLE ${qOld} ALTER COLUMN ${colName} ${c.nullable ? 'DROP' : 'SET'} NOT NULL`
      )
    }
    if ((c.defaultValue || '') !== (c.originalDefaultValue || '')) {
      if (!c.defaultValue) {
        statements.push(`ALTER TABLE ${qOld} ALTER COLUMN ${colName} DROP DEFAULT`)
      } else {
        statements.push(
          `ALTER TABLE ${qOld} ALTER COLUMN ${colName} SET DEFAULT ${c.defaultValue}`
        )
      }
    }
  }

  // 4. Add new columns
  for (const c of columns) {
    if (!c.isNew || c.dropped || !c.name.trim()) continue
    const parts = [quoteIdent(c.name)]
    let type = c.type
    if (['varchar', 'char'].includes(type) && c.length) {
      type = `${type}(${parseInt(c.length, 10) || 255})`
    }
    parts.push(type)
    if (!c.nullable) parts.push('NOT NULL')
    if (c.unique) parts.push('UNIQUE')
    if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`)
    statements.push(`ALTER TABLE ${qOld} ADD COLUMN ${parts.join(' ')}`)
  }

  // 5. Add new FKs (before table rename so we can use the original name)
  for (const fk of foreignKeys || []) {
    if (!fk.isNew || fk.dropped) continue
    if (!fk.sourceColumn || !fk.targetSchema || !fk.targetTable || !fk.targetColumn) continue
    const constraintName = `${oldName}_${fk.sourceColumn}_fkey`
    const tail = []
    if (fk.onDelete && fk.onDelete !== 'NO ACTION') tail.push(`ON DELETE ${fk.onDelete}`)
    if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') tail.push(`ON UPDATE ${fk.onUpdate}`)
    statements.push(
      `ALTER TABLE ${qOld} ADD CONSTRAINT ${quoteIdent(constraintName)}` +
        ` FOREIGN KEY (${quoteIdent(fk.sourceColumn)})` +
        ` REFERENCES ${quoteIdent(fk.targetSchema)}.${quoteIdent(fk.targetTable)} (${quoteIdent(fk.targetColumn)})` +
        (tail.length ? ' ' + tail.join(' ') : '')
    )
  }

  // 6. Rename table last
  if (newName && newName !== oldName) {
    statements.push(`ALTER TABLE ${qOld} RENAME TO ${quoteIdent(newName)}`)
  }

  return statements
}

export function EditTableDialog() {
  const {
    editTableDialogOpen,
    setEditTableDialogOpen,
    editTableTarget,
    showToast,
    bumpTablesRefresh,
    activeTable,
    setActiveTable,
  } = useAppStore()
  const { activeConnection } = useDatabase()

  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState([])
  const [foreignKeys, setForeignKeys] = useState([])
  const [allDbTables, setAllDbTables] = useState([])
  const [targetColsCache, setTargetColsCache] = useState({})
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showSql, setShowSql] = useState(false)

  useEffect(() => {
    if (!editTableDialogOpen || !editTableTarget || !activeConnection) return
    let cancelled = false
    setLoading(true)
    setTableName(editTableTarget.name)
    setShowSql(false)
    setTargetColsCache({})
    ;(async () => {
      try {
        const [cols, tables] = await Promise.all([
          window.gamalab.db.listColumns(
            activeConnection.id,
            editTableTarget.schema,
            editTableTarget.name
          ),
          window.gamalab.db.listAllTables(activeConnection.id),
        ])
        if (cancelled) return
        setColumns(cols.map(normalizeExisting))
        setAllDbTables(tables.filter((t) => t.type !== 'VIEW'))
        // Extract FKs from columns
        const fks = cols
          .filter((c) => c.foreign_table)
          .map((c) => ({
            id: `existing-fk-${c.fk_constraint_name}`,
            isNew: false,
            constraintName: c.fk_constraint_name,
            sourceColumn: c.name,
            targetSchema: c.foreign_schema,
            targetTable: c.foreign_table,
            targetColumn: c.foreign_column,
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
            dropped: false,
          }))
        setForeignKeys(fks)
      } catch (err) {
        if (!cancelled) showToast(err.message, 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editTableDialogOpen, editTableTarget, activeConnection, showToast])

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

  const addFk = () =>
    setForeignKeys((fks) => [
      ...fks,
      {
        id: `new-fk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        isNew: true,
        constraintName: null,
        sourceColumn: '',
        targetSchema: '',
        targetTable: '',
        targetColumn: '',
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
        dropped: false,
      },
    ])
  const updateFk = (id, patch) =>
    setForeignKeys((fks) => fks.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const toggleDropFk = (id) =>
    setForeignKeys((fks) =>
      fks
        .map((f) => (f.id === id ? { ...f, dropped: !f.dropped } : f))
        .filter((f) => !(f.isNew && f.dropped))
    )

  const updateCol = (id, patch) => {
    setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const toggleDropCol = (id) => {
    setColumns((cols) =>
      cols
        .map((c) => (c.id === id ? { ...c, dropped: !c.dropped } : c))
        // If user adds and then drops a brand-new column, just remove it
        .filter((c) => !(c.isNew && c.dropped))
    )
  }

  const addCol = () => {
    setColumns((cols) => [...cols, newColumn()])
  }

  const statements = useMemo(() => {
    if (!editTableTarget) return []
    return buildAlterStatements(
      editTableTarget.schema,
      editTableTarget.name,
      tableName.trim(),
      columns,
      foreignKeys
    )
  }, [editTableTarget, tableName, columns, foreignKeys])

  const sql = statements.map((s) => s + ';').join('\n')

  const handleSubmit = async () => {
    if (!activeConnection || !editTableTarget) return
    if (!tableName.trim()) {
      showToast('Table name is required', 'warning')
      return
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName.trim())) {
      showToast('Invalid table name', 'warning')
      return
    }
    for (const c of columns) {
      if (c.dropped) continue
      if (!c.name.trim()) {
        showToast('Column name cannot be empty', 'warning')
        return
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name)) {
        showToast(`Invalid column name: ${c.name}`, 'warning')
        return
      }
    }
    if (statements.length === 0) {
      showToast('No changes to apply', 'info')
      return
    }

    setSubmitting(true)
    try {
      // All ALTERs in a single transaction so partial failures roll back
      await window.gamalab.db.transaction(activeConnection.id, statements)
      showToast('Table updated', 'success')
      bumpTablesRefresh()
      // Re-point activeTable if it was the one we just renamed
      if (
        activeTable &&
        activeTable.schema === editTableTarget.schema &&
        activeTable.name === editTableTarget.name &&
        tableName.trim() !== editTableTarget.name
      ) {
        setActiveTable({ schema: editTableTarget.schema, name: tableName.trim() })
      }
      setEditTableDialogOpen(false)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!editTableTarget) return null

  const pendingChanges = statements.length

  return (
    <Dialog
      open={editTableDialogOpen}
      onOpenChange={(o) => !submitting && setEditTableDialogOpen(o)}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TableIcon className="h-5 w-5 text-lab-blue" />
            Edit table
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {editTableTarget.schema}.{editTableTarget.name}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-lab-blue" />
            Loading schema…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Schema</Label>
                <Input value={editTableTarget.schema} disabled readOnly />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tname">Table name</Label>
                <Input
                  id="tname"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Columns ({columns.filter((c) => !c.dropped).length})
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
                <div className="grid grid-cols-[20px_1fr_120px_60px_1fr_28px] gap-1 border-b border-border bg-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span />
                  <span>Name</span>
                  <span>Type</span>
                  <span className="text-center">NULL</span>
                  <span>Default</span>
                  <span />
                </div>
                <div className="flex flex-col">
                  {columns.map((col) => (
                    <div
                      key={col.id}
                      className={cn(
                        'grid grid-cols-[20px_1fr_120px_60px_1fr_28px] gap-1 border-b border-border px-2 py-1.5 text-xs last:border-b-0',
                        col.dropped && 'bg-destructive/10 opacity-60 line-through',
                        col.isPrimaryKey && !col.dropped && 'bg-lab-orange/5',
                        col.isNew && !col.dropped && 'bg-lab-green/5'
                      )}
                    >
                      <div className="flex items-center justify-center">
                        {col.isPrimaryKey ? (
                          <Key className="h-3 w-3 text-lab-orange" />
                        ) : col.isNew ? (
                          <Plus className="h-3 w-3 text-lab-green" />
                        ) : null}
                      </div>
                      <Input
                        value={col.name}
                        onChange={(e) => updateCol(col.id, { name: e.target.value })}
                        placeholder="column_name"
                        disabled={submitting || col.dropped}
                        className="h-7 text-xs"
                      />
                      {col.isNew ? (
                        <select
                          value={col.type}
                          onChange={(e) => updateCol(col.id, { type: e.target.value })}
                          disabled={submitting || col.dropped}
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
                      ) : (
                        <div
                          className="flex h-7 items-center rounded border border-dashed border-border px-2 font-mono text-[11px] text-muted-foreground"
                          title="Type changes are not supported here — use SQL"
                        >
                          {col.type}
                        </div>
                      )}
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          disabled={submitting || col.dropped || col.isPrimaryKey}
                          onChange={(e) => updateCol(col.id, { nullable: e.target.checked })}
                          className="h-3.5 w-3.5 accent-lab-blue"
                          title={col.isPrimaryKey ? 'PK cannot be NULL' : 'Allow NULL'}
                        />
                      </div>
                      <Input
                        value={col.defaultValue}
                        onChange={(e) =>
                          updateCol(col.id, { defaultValue: e.target.value })
                        }
                        placeholder="now(), 'x', 0"
                        disabled={submitting || col.dropped}
                        className="h-7 font-mono text-[11px]"
                      />
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => toggleDropCol(col.id)}
                        disabled={submitting || col.isPrimaryKey}
                        className={cn(
                          'h-7 w-7',
                          col.dropped
                            ? 'text-lab-blue hover:text-lab-blue'
                            : 'text-destructive hover:text-destructive'
                        )}
                        title={col.dropped ? 'Undo drop' : 'Drop column'}
                      >
                        {col.dropped ? (
                          <Undo2 className="h-3 w-3" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ))}
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
                  Foreign keys ({foreignKeys.filter((f) => !f.dropped).length})
                </Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={addFk}
                  disabled={submitting || allDbTables.length === 0}
                  className="h-7 px-2 text-[11px]"
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
                    const readOnly = !fk.isNew
                    return (
                      <div
                        key={fk.id}
                        className={cn(
                          'flex flex-col gap-1.5 rounded border border-border bg-background p-2 text-xs',
                          fk.dropped && 'bg-destructive/10 opacity-60 line-through',
                          fk.isNew && !fk.dropped && 'border-lab-green/40 bg-lab-green/5'
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {readOnly ? (
                            <div className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[11px]">
                              <span className="truncate text-muted-foreground">
                                {fk.constraintName}
                              </span>
                              <span className="mx-1 text-muted-foreground/60">·</span>
                              <span className="truncate">
                                {fk.sourceColumn}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="truncate">
                                {fk.targetSchema}.{fk.targetTable}.{fk.targetColumn}
                              </span>
                            </div>
                          ) : (
                            <>
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
                                  .filter((c) => !c.dropped && c.name.trim())
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
                                  updateFk(fk.id, {
                                    targetTable: e.target.value,
                                    targetColumn: '',
                                  })
                                  if (e.target.value)
                                    loadTargetColumns(fk.targetSchema, e.target.value)
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
                            </>
                          )}
                          <Button
                            size="iconSm"
                            variant="ghost"
                            onClick={() => toggleDropFk(fk.id)}
                            disabled={submitting}
                            className={cn(
                              'h-7 w-7',
                              fk.dropped
                                ? 'text-lab-blue hover:text-lab-blue'
                                : 'text-destructive hover:text-destructive'
                            )}
                            title={fk.dropped ? 'Undo drop' : 'Drop FK'}
                          >
                            {fk.dropped ? (
                              <Undo2 className="h-3 w-3" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        {fk.isNew && !fk.dropped && (
                          <div className="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground">
                            <span className="uppercase tracking-wider">On delete</span>
                            <select
                              value={fk.onDelete}
                              onChange={(e) =>
                                updateFk(fk.id, { onDelete: e.target.value })
                              }
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
                              onChange={(e) =>
                                updateFk(fk.id, { onUpdate: e.target.value })
                              }
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
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {showSql && (
              <div className="rounded-md border border-border bg-background p-3">
                <pre className="whitespace-pre-wrap font-mono text-[11px] text-foreground/90">
                  {sql || '-- No changes yet'}
                </pre>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {pendingChanges > 0 ? (
                <Badge variant="warning">
                  {pendingChanges} pending change{pendingChanges === 1 ? '' : 's'}
                </Badge>
              ) : (
                <Badge variant="info">No changes</Badge>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setEditTableDialogOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="lab"
            onClick={handleSubmit}
            disabled={submitting || loading || pendingChanges === 0}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying…
              </>
            ) : (
              <>
                <TableIcon className="h-4 w-4" />
                Apply changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
